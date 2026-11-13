// chat/chat-logic.js
// The chat widget's logic, with NO page code in it (no document, no buttons).
// chat/chat.js uses it to draw the widget, and test-chat.js tests it in Node.

export const CHAT = {
  endpoint: "/api/chat",
  maxChars: 500, // the longest question (the server enforces this too)
  maxMessages: 10, // how many recent messages are sent (the server trims to this as well)
  timeoutMs: 35_000, // give up waiting after this long (the server stops at 30 s)
};

// The three example questions shown as chips.
export const SUGGESTIONS = [
  "Which resort is best tomorrow?",
  "Is it windy at Vasilitsa tomorrow?",
  "Why does Parnassos score low in the morning?",
];

/** The last few messages, as plain { role, content } objects. */
export function trimHistory(history, max = CHAT.maxMessages) {
  return history.slice(-max).map(({ role, content }) => ({ role, content }));
}

/** What is sent to the server. */
export function buildRequestBody(history, mock) {
  return { messages: trimHistory(history), mock: Boolean(mock) };
}

/** The small grey line under a reply: "Tools used: get_daily_summary(parnassos), ..." (or nothing). */
export function toolsLine(toolsUsed) {
  return Array.isArray(toolsUsed) && toolsUsed.length > 0 ? `Tools used: ${toolsUsed.join(", ")}` : "";
}

/**
 * A friendly message for something that went wrong.
 * @param {{ status?: number, body?: any, timedOut?: boolean, networkError?: boolean }} problem
 */
export function errorMessageFor({ status, body, timedOut, networkError } = {}) {
  if (timedOut) return "That took too long. Please try again, or ask a simpler question.";
  if (networkError) return "I could not reach the server. Please check your connection and try again.";

  // The server writes its own friendly messages (too many questions, question too long, ...).
  if (typeof body?.error === "string" && body.error.length > 0 && body.error.length < 300) return body.error;

  if (status === 404) return "The chat is not available on this site yet.";
  if (status >= 500) return "The assistant is temporarily unavailable. Please try again later.";
  return "Something went wrong. Please try again.";
}

/**
 * Send the conversation to the server and wait for the answer.
 * Never throws: it returns { ok: true, reply, toolsUsed } or { ok: false, error }.
 *
 * @param {object} options
 * @param {Array<{ role: string, content: string }>} options.history  The conversation so far, ending with the user's question.
 * @param {boolean} options.mock  True to use the demo data.
 * @param {Function} [options.fetchFn]  Only tests change this.
 * @param {number} [options.timeoutMs]
 */
export async function askChat({ history, mock, fetchFn = fetch, timeoutMs = CHAT.timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(CHAT.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildRequestBody(history, mock)),
      signal: controller.signal,
    });

    let body = null;
    try {
      body = await response.json();
    } catch {
      // not JSON (for example an error page): handled below
    }

    if (!response.ok || typeof body?.reply !== "string") {
      return { ok: false, error: errorMessageFor({ status: response.status, body }) };
    }

    const toolsUsed = Array.isArray(body.toolsUsed) ? body.toolsUsed.filter((name) => typeof name === "string") : [];
    return { ok: true, reply: body.reply, toolsUsed };
  } catch (error) {
    return { ok: false, error: errorMessageFor(error?.name === "AbortError" ? { timedOut: true } : { networkError: true }) };
  } finally {
    clearTimeout(timer);
  }
}
