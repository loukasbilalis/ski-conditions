// chat/chat.js
// Draws the chat widget (a floating 💬 button and a chat panel) and talks to /api/chat.
// The logic that needs no page lives in chat-logic.js.
//
// Text is always put on the page with textContent (never innerHTML), so nothing
// the AI or a visitor writes can ever be treated as page code.

import { CHAT, SUGGESTIONS, askChat, toolsLine } from "./chat-logic.js";

// Open the page with ?mock=1 for demo data. src/main.js reads the same switch,
// so the page and the chat always show the same data.
const mock = new URLSearchParams(location.search).get("mock") === "1";

const history = []; // what is sent to the server: { role, content }
let pending = false; // true while waiting for an answer

const finePointer = window.matchMedia("(pointer: fine)").matches; // a mouse, not a touch screen
const smallScreen = window.matchMedia("(max-width: 600px)");

// ---------------------------------------------------------------
// Building the widget
// ---------------------------------------------------------------
function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

const toggle = el("button", "chat-toggle", "💬");
toggle.type = "button";
toggle.setAttribute("aria-label", "Ask about ski conditions");
toggle.setAttribute("aria-expanded", "false");
toggle.setAttribute("aria-controls", "chat-panel");

const panel = el("section", "chat-panel");
panel.id = "chat-panel";
panel.hidden = true;
panel.setAttribute("role", "dialog");
panel.setAttribute("aria-label", "Ski conditions chat");

// Header: title, a "Demo data" badge, and a close button
const header = el("div", "chat-header");
const title = el("div", "chat-title");
title.append(el("strong", "", "Ask about conditions"));
if (mock) title.append(el("span", "chat-badge", "Demo data"));
const closeButton = el("button", "chat-close", "×");
closeButton.type = "button";
closeButton.setAttribute("aria-label", "Close chat");
header.append(title, closeButton);

// Messages
const messages = el("div", "chat-messages");
messages.setAttribute("role", "log");
messages.setAttribute("aria-live", "polite");

// Suggested questions
const chips = el("div", "chat-chips");
const chipButtons = SUGGESTIONS.map((question) => {
  const chip = el("button", "chat-chip", question);
  chip.type = "button";
  chip.addEventListener("click", () => send(question));
  chips.append(chip);
  return chip;
});

// The question box
const form = el("form", "chat-form");
const label = el("label", "visually-hidden", "Your question");
label.htmlFor = "chat-input";
const input = el("textarea", "chat-input");
input.id = "chat-input";
input.rows = 1;
input.maxLength = CHAT.maxChars;
input.placeholder = "Type your question…"; // short, so it fits on one line even on a small phone
const sendButton = el("button", "chat-send", "Send");
sendButton.type = "submit";
form.append(label, input, sendButton);

const counter = el("div", "chat-counter");
const note = el("p", "chat-note", "AI answers can be wrong. Check with the resort before you go.");

panel.append(header, messages, chips, form, counter, note);
document.body.append(toggle, panel);

// ---------------------------------------------------------------
// Showing messages
// ---------------------------------------------------------------
function scrollDown() {
  messages.scrollTop = messages.scrollHeight;
}

// kind: "user", "bot" or "error". Returns the message box.
function addMessage(kind, text, toolsText = "") {
  const wrapper = el("div", `chat-message chat-${kind}`);
  wrapper.append(el("div", "chat-bubble", text));
  if (toolsText) wrapper.append(el("div", "chat-tools", toolsText));
  messages.append(wrapper);
  scrollDown();
  return wrapper;
}

function showThinking() {
  const wrapper = el("div", "chat-message chat-bot chat-thinking");
  wrapper.setAttribute("role", "status");
  const bubble = el("div", "chat-bubble", "Thinking");
  const dots = el("span", "chat-dots");
  dots.append(el("span", "", "."), el("span", "", "."), el("span", "", "."));
  bubble.append(dots);
  wrapper.append(bubble);
  messages.append(wrapper);
  scrollDown();
  return wrapper;
}

addMessage(
  "bot",
  "Hi! Ask me about ski conditions at Parnassos, Vasilitsa, Velouchi and Kalavryta: the best time to go, wind, snow, or why an hour scores low." +
    (mock ? "\n\nDemo data is switched on, so the answers use made-up weather." : "")
);

// ---------------------------------------------------------------
// Sending a question
// ---------------------------------------------------------------
function setPending(on) {
  pending = on;
  input.disabled = on;
  sendButton.disabled = on;
  chipButtons.forEach((chip) => (chip.disabled = on));
  messages.setAttribute("aria-busy", String(on));
}

function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 110)}px`;
}

function updateCounter() {
  const length = input.value.length;
  counter.textContent = length >= CHAT.maxChars - 100 ? `${length}/${CHAT.maxChars}` : "";
}

async function send(text) {
  text = text.trim();
  if (!text || pending) return;

  chips.hidden = true;
  const userMessage = addMessage("user", text);
  history.push({ role: "user", content: text });
  input.value = "";
  resizeInput();
  updateCounter();

  setPending(true);
  const thinking = showThinking();
  const result = await askChat({ history, mock });
  thinking.remove();
  setPending(false);

  if (result.ok) {
    addMessage("bot", result.reply, toolsLine(result.toolsUsed));
    history.push({ role: "assistant", content: result.reply });
  } else {
    // Take the question back out, show the problem, and put the text back in the box to resend.
    history.pop();
    userMessage.remove();
    addMessage("error", result.error);
    input.value = text;
    resizeInput();
    updateCounter();
    if (history.length === 0) chips.hidden = false;
  }

  if (finePointer) input.focus();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  send(input.value);
});

input.addEventListener("input", () => {
  resizeInput();
  updateCounter();
});

// On a computer, Enter sends and Shift+Enter starts a new line.
// On a phone, Enter starts a new line and the Send button sends.
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && finePointer) {
    event.preventDefault();
    send(input.value);
  }
});

// ---------------------------------------------------------------
// Opening and closing
// ---------------------------------------------------------------
function isOpen() {
  return !panel.hidden;
}

function openChat() {
  panel.hidden = false;
  toggle.setAttribute("aria-expanded", "true");
  // On a small screen the panel fills the screen, so stop the page behind it from scrolling.
  document.documentElement.classList.toggle("chat-lock", smallScreen.matches);
  scrollDown();
  if (finePointer) input.focus();
}

function closeChat() {
  panel.hidden = true;
  toggle.setAttribute("aria-expanded", "false");
  document.documentElement.classList.remove("chat-lock");
  toggle.focus();
}

toggle.addEventListener("click", () => (isOpen() ? closeChat() : openChat()));
closeButton.addEventListener("click", closeChat);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isOpen()) closeChat();
});

// A link ending in #chat opens the chat straight away.
if (location.hash === "#chat") openChat();
