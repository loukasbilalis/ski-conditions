// api/chat.js
// The chatbot's back end: a Vercel serverless function.
//
// The browser sends:   POST /api/chat   { "messages": [...], "mock": false }
// This function:
//   1. checks the request (size, rate limit, message rules),
//   2. asks Claude Haiku 5.5 the question, giving it our ski tools,
//   3. runs any tool Claude asks for (here, on the server) and sends the result back,
//   4. repeats until Claude gives a final answer (at most 5 tool rounds),
//   5. returns  { "reply": "...", "toolsUsed": ["get_daily_summary(parnassos)"] }.
//
// The API key is read ONLY from the ANTHROPIC_API_KEY environment variable
// (set in the Vercel project settings). It is never in the browser code or the repo.
// Locally, the Anthropic SDK also accepts a login made with `ant auth login`.

import Anthropic from "@anthropic-ai/sdk";
import { createTools, runTool } from "../src/tools.js";
import { getMockWeather } from "../mock/weekend.js";
import { buildSystemPrompt } from "../agent/prompt.js";

// ---------------------------------------------------------------
// Settings. Change a number here to change the limits.
// ---------------------------------------------------------------
export const LIMITS = {
  model: "claude-haiku-5-5",
  maxTokens: 600, // the longest answer Claude may write in one reply
  maxUserChars: 500, // the longest question a user may send
  maxAssistantChars: 4000, // the longest earlier answer we accept back in the history
  maxMessages: 10, // only the last 10 messages are sent to Claude
  maxToolRounds: 5, // how many times Claude may ask for tools before it must answer
  maxBodyBytes: 40_000, // reject requests bigger than this
  rateLimit: { max: 10, windowMs: 10 * 60 * 1000 }, // 10 questions per 10 minutes per IP
  callTimeoutMs: 20_000, // give up on one call to Claude after this long
  deadlineMs: 24_000, // stop starting new calls after this long (the function limit is 30 s)
};

// The texts people see. Technical details are never shown, only logged on the server.
const TEXT = {
  notPost: "Please send your question with POST.",
  forbidden: "This request is not allowed.",
  tooLarge: "That request is too large.",
  badRequest: "Sorry, I could not read that request.",
  emptyQuestion: "Please type a question.",
  tooLong: `Please keep your question under ${LIMITS.maxUserChars} characters.`,
  unavailable: "The assistant is temporarily unavailable. Please try again later.",
  busy: "The assistant is busy right now. Please try again in a minute.",
  unreachable: "I could not reach the assistant service. Please try again.",
  failed: "Something went wrong on our side. Please try again.",
  tooSlow: "That is taking too long. Please try a simpler question.",
  tooManyTools: "I could not finish looking that up. Please try a narrower question.",
  refused: "Sorry, I cannot help with that request.",
  noAnswer: "Sorry, I could not come up with an answer. Please try asking in a different way.",
  cutShort: "(The answer was cut short. Ask a narrower question to get the details.)",
  rateLimited: (seconds) =>
    `You have asked a lot of questions. Please try again in ${Math.max(1, Math.ceil(seconds / 60))} minute(s).`,
};

// ---------------------------------------------------------------
// The tools. Real weather is downloaded from Open-Meteo; demo weather comes
// from mock/weekend.js. Both are created once, so a warm server remembers the
// weather for 10 minutes instead of downloading it for every question.
// ---------------------------------------------------------------
const realTools = createTools();
const mockTools = createTools({ getWeather: getMockWeather });

const toolSetFor = (mock) => (mock ? mockTools : realTools);

// What Claude is told about each tool (our own run() function stays on the server).
const describeTools = (toolList) =>
  toolList.map(({ name, description, input_schema }) => ({ name, description, input_schema }));

// ---------------------------------------------------------------
// Checking the request
// ---------------------------------------------------------------

/**
 * Check what the browser sent and clean it up.
 * @returns {{ error: { status: number, message: string } } | { messages: Array, mock: boolean }}
 */
export function validateRequest(body) {
  const bad = (message, status = 400) => ({ error: { status, message } });

  if (!body || typeof body !== "object" || !Array.isArray(body.messages) || body.messages.length === 0) {
    return bad(TEXT.badRequest);
  }

  // Only the last messages matter. The list must start with a user message.
  const recent = body.messages.slice(-LIMITS.maxMessages);
  while (recent.length > 0 && recent[0]?.role === "assistant") recent.shift();
  if (recent.length === 0) return bad(TEXT.badRequest);

  const messages = [];
  for (const message of recent) {
    // Browsers can send anything, so only plain user/assistant text is accepted.
    // (No "system" messages, no tool calls: those could be used to trick the model.)
    if (!message || (message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string") {
      return bad(TEXT.badRequest);
    }
    const content = message.content.trim();
    if (content.length === 0) return bad(TEXT.emptyQuestion);
    if (message.role === "user" && content.length > LIMITS.maxUserChars) return bad(TEXT.tooLong);
    if (message.role === "assistant" && content.length > LIMITS.maxAssistantChars) return bad(TEXT.badRequest);
    messages.push({ role: message.role, content });
  }

  if (messages.at(-1).role !== "user") return bad(TEXT.badRequest);

  return { messages, mock: body.mock === true };
}

// ---------------------------------------------------------------
// Rate limit: a simple counter per visitor, kept in the server's memory.
// "Best effort": a restarted server forgets the counts, and several servers
// each count separately. A spending limit in the Anthropic console is the
// real safety net.
// ---------------------------------------------------------------
export function createRateLimiter({ max = LIMITS.rateLimit.max, windowMs = LIMITS.rateLimit.windowMs, now = Date.now } = {}) {
  const visits = new Map(); // visitor -> times of their recent requests

  return {
    /** Record a request. Returns { allowed, retryAfterSeconds }. */
    check(visitor) {
      const time = now();
      const recent = (visits.get(visitor) ?? []).filter((t) => time - t < windowMs);

      if (recent.length >= max) {
        visits.set(visitor, recent);
        return { allowed: false, retryAfterSeconds: Math.ceil((recent[0] + windowMs - time) / 1000) };
      }

      recent.push(time);
      visits.set(visitor, recent);

      // Tidy up: forget visitors who have not been seen for a while.
      if (visits.size > 500) {
        for (const [key, times] of visits) {
          if (times.every((t) => time - t >= windowMs)) visits.delete(key);
        }
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

// ---------------------------------------------------------------
// The conversation with Claude
// ---------------------------------------------------------------

// "get_daily_summary(parnassos)", or just the name when the tool has no resort.
const labelFor = (name, input) => (input?.resort_id ? `${name}(${input.resort_id})` : name);

// The chat box shows plain text, so markdown marks would appear as stray symbols.
// The prompt asks for plain text, but a prompt is a request, not a guarantee, so we also clean the reply.
export function tidyReply(text) {
  return text
    .replace(/\*\*(.+?)\*\*/gs, "$1") // **bold**
    .replace(/__(.+?)__/gs, "$1") // __bold__
    .replace(/^#{1,6}\s+/gm, "") // # headings
    .replace(/\n{3,}/g, "\n\n") // never more than one blank line
    .trim();
}

const textOf = (response) =>
  tidyReply(
    response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
  );

/**
 * Ask Claude, run the tools it asks for, and repeat until it answers.
 * Returns { reply, toolsUsed, usage, toolRounds }.
 */
export async function runConversation({ client, messages, mock, now = () => new Date() }) {
  const started = Date.now();
  const toolList = toolSetFor(mock);
  const tools = describeTools(toolList);
  const system = buildSystemPrompt({ now: now(), mock });

  const conversation = messages.map((m) => ({ ...m }));
  const toolsUsed = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let toolRounds = 0;

  const done = (reply) => ({ reply, toolsUsed, usage, toolRounds });

  while (true) {
    if (Date.now() - started > LIMITS.deadlineMs) return done(TEXT.tooSlow);

    const response = await client.messages.create(
      {
        model: LIMITS.model,
        max_tokens: LIMITS.maxTokens,
        // Thinking is switched off. It is on by default, and Claude's hidden thinking counts
        // towards max_tokens: with a 600-token limit it used almost all of it, so answers were
        // cut off or empty (measured: 3 of 3 failed). Switched off, answers use about 350 tokens.
        thinking: { type: "disabled" },
        output_config: { effort: "low" }, // short, fast answers
        system,
        tools,
        messages: conversation,
      },
      { timeout: LIMITS.callTimeoutMs }
    );
    usage.inputTokens += response.usage?.input_tokens ?? 0;
    usage.outputTokens += response.usage?.output_tokens ?? 0;

    // Always look at WHY Claude stopped before using its answer.
    if (response.stop_reason === "refusal") return done(TEXT.refused);

    if (response.stop_reason === "max_tokens") {
      const text = textOf(response);
      return done(text ? `${text}\n\n${TEXT.cutShort}` : TEXT.noAnswer);
    }

    if (response.stop_reason !== "tool_use") {
      return done(textOf(response) || TEXT.noAnswer);
    }

    // Claude wants to use tools.
    if (toolRounds >= LIMITS.maxToolRounds) return done(TEXT.tooManyTools);
    toolRounds += 1;

    // Send Claude's turn back exactly as it was (including any thinking blocks).
    conversation.push({ role: "assistant", content: response.content });

    // Run all requested tools at the same time, then answer them all in ONE message.
    const requests = response.content.filter((block) => block.type === "tool_use");
    const results = await Promise.all(
      requests.map(async (request) => {
        const label = labelFor(request.name, request.input);
        if (!toolsUsed.includes(label)) toolsUsed.push(label);

        const output = await runTool(request.name, request.input, toolList); // never throws
        return {
          type: "tool_result",
          tool_use_id: request.id,
          content: JSON.stringify(output),
          ...(output && output.error ? { is_error: true } : {}),
        };
      })
    );
    conversation.push({ role: "user", content: results });
  }
}

// ---------------------------------------------------------------
// Turning errors into friendly messages (details go to the server log only)
// ---------------------------------------------------------------
function explainError(error) {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return { status: 503, message: TEXT.unavailable, note: "Anthropic rejected the credentials: check ANTHROPIC_API_KEY" };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { status: 429, message: TEXT.busy, note: "Anthropic rate limit" };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { status: 502, message: TEXT.unreachable, note: "could not connect to Anthropic" };
  }
  if (error instanceof Anthropic.APIError) {
    // 400 here usually means a billing or configuration problem (for example no credit left).
    const note = `Anthropic API error ${error.status}: ${error.message}`;
    return { status: 503, message: error.status === 529 ? TEXT.busy : TEXT.unavailable, note };
  }
  if (/authentication|api key|credentials/i.test(error?.message ?? "")) {
    return { status: 503, message: TEXT.unavailable, note: "no Anthropic credentials found: set ANTHROPIC_API_KEY" };
  }
  return { status: 500, message: TEXT.failed, note: `unexpected error: ${error?.stack ?? error}` };
}

// ---------------------------------------------------------------
// The handler: what Vercel runs for each request
// ---------------------------------------------------------------

// Works with Vercel's request/response objects and with plain Node ones.
function send(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value);
  res.end(JSON.stringify(body));
}

// Who is asking? Vercel puts the visitor's address in x-forwarded-for.
function visitorOf(req) {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  return forwarded || req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown";
}

// Browsers send an Origin header. If it names a different website than the one
// serving this API, refuse. (This stops other websites from using your chatbot
// through their visitors' browsers. It does not stop tools like curl.)
function originIsForeign(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

let sharedClient;
const defaultClient = () => (sharedClient ??= new Anthropic({ maxRetries: 1 })); // reads ANTHROPIC_API_KEY

export function createChatHandler({
  getClient = defaultClient,
  rateLimiter = createRateLimiter(),
  now = () => new Date(),
} = {}) {
  return async function handler(req, res) {
    if (req.method !== "POST") {
      return send(res, 405, { error: TEXT.notPost }, { Allow: "POST" });
    }
    if (originIsForeign(req)) {
      return send(res, 403, { error: TEXT.forbidden });
    }
    if (Number(req.headers["content-length"] ?? 0) > LIMITS.maxBodyBytes) {
      return send(res, 413, { error: TEXT.tooLarge });
    }

    const limit = rateLimiter.check(visitorOf(req));
    if (!limit.allowed) {
      return send(res, 429, { error: TEXT.rateLimited(limit.retryAfterSeconds) }, { "Retry-After": String(limit.retryAfterSeconds) });
    }

    // Vercel has already turned a JSON body into an object; be safe if it is text.
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        return send(res, 400, { error: TEXT.badRequest });
      }
    }

    const checked = validateRequest(body);
    if (checked.error) return send(res, checked.error.status, { error: checked.error.message });

    const started = Date.now();
    try {
      const result = await runConversation({ client: getClient(), messages: checked.messages, mock: checked.mock, now });

      // One log line per question, to watch usage and cost. It holds no question text and no visitor address.
      console.log(
        JSON.stringify({
          event: "chat",
          mock: checked.mock,
          toolRounds: result.toolRounds,
          toolsUsed: result.toolsUsed.length,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          ms: Date.now() - started,
        })
      );

      return send(res, 200, { reply: result.reply, toolsUsed: result.toolsUsed });
    } catch (error) {
      const explained = explainError(error);
      console.error(JSON.stringify({ event: "chat_error", status: explained.status, note: explained.note }));
      return send(res, explained.status, { error: explained.message });
    }
  };
}

// Vercel runs the default export.
export default createChatHandler();
