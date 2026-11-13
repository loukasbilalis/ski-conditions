// test-chat.js
// Checks for the chatbot pieces (the shared prompt now; the API function later).
// Run with:  node test-chat.js     (needs no internet and no API key)
// Separate from test.js, which checks the scoring logic.

import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { athensDate, buildSystemPrompt } from "./agent/prompt.js";
import { LIMITS, createChatHandler, createRateLimiter, validateRequest } from "./api/chat.js";

let failures = 0;
function check(name, condition, detail = "") {
  if (!condition) failures++;
  console.log(`  ${condition ? "ok  " : "FAIL"} ${name}${condition ? "" : "  " + detail}`);
}

// ---------------------------------------------------------------
console.log("Shared prompt - today's date in Greek time:");

// 22:30 UTC on 12 Nov is 00:30 on 13 Nov in Greece (winter time is UTC+2).
const winter = athensDate(new Date("2026-11-12T22:30:00Z"));
check("just after Greek midnight in winter: 13 November, not 12", winter.iso === "2026-11-13" && winter.long === "Friday 13 November 2026", JSON.stringify(winter));

// 21:30 UTC on 1 Jul is 00:30 on 2 Jul in Greece (summer time is UTC+3).
const summer = athensDate(new Date("2026-07-01T21:30:00Z"));
check("just after Greek midnight in summer time: 2 July", summer.iso === "2026-07-02" && summer.long === "Thursday 2 July 2026", JSON.stringify(summer));

const midday = athensDate(new Date("2026-11-13T10:00:00Z"));
check("midday gives the same date", midday.iso === "2026-11-13");

// ---------------------------------------------------------------
console.log("\nShared prompt - contents:");

const real = buildSystemPrompt({ now: new Date("2026-11-12T22:30:00Z") });
const demo = buildSystemPrompt({ now: new Date("2026-11-12T22:30:00Z"), mock: true });

check("contains today's date in Greek time", real.includes("Friday 13 November 2026") && real.includes("2026-11-13"));
check("tells the model to reply in the user's language", /language the user writes in/.test(real));
check("tells the model to use only tool data and never invent numbers", /Use only data from the tools/.test(real) && /Never guess or invent/.test(real));
check("tells the model to decline off-topic questions briefly", /not about ski conditions[\s\S]*decline in one short sentence/.test(real));
check("asks for plain text, short answers", /plain text only/.test(real) && /under 120 words/.test(real));
check("keeps the earlier rules (score bands, factor readings, hour ranges)", /70-100 good/.test(real) && /"reading" text/.test(real) && /do not overlap/.test(real));
check("normal mode: says the first date in a tool result is today", /first date in a tool result is today/.test(real) && !/DEMO MODE/.test(real));
check("demo mode: says it is demo data and overrides 'first date is today'", /DEMO MODE/.test(demo) && /ignore it/.test(demo) && !/first date in a tool result is today/.test(demo));
check("works with no arguments (uses the real current date)", /Today is /.test(buildSystemPrompt()));

// ===============================================================
// The API function (api/chat.js), tested with a FAKE Claude: no internet, no cost.
// ===============================================================

// A fake Claude. `script` is a list of replies, used one after another
// (the last one repeats). It records every request it receives.
function fakeClient(script) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        calls.push(JSON.parse(JSON.stringify(params))); // a copy, taken at this moment
        const next = script[Math.min(calls.length - 1, script.length - 1)];
        const reply = typeof next === "function" ? next(params) : next;
        if (reply instanceof Error) throw reply;
        return reply;
      },
    },
  };
}
const usage = { input_tokens: 100, output_tokens: 20 };
const textReply = (text) => ({ content: [{ type: "text", text }], stop_reason: "end_turn", usage });
const toolReply = (...uses) => ({
  content: [
    { type: "thinking", thinking: "", signature: "sig-abc" }, // Claude may include these; they must be sent back untouched
    ...uses.map(([name, input], i) => ({ type: "tool_use", id: `toolu_${i + 1}`, name, input })),
  ],
  stop_reason: "tool_use",
  usage,
});

// A fake request and response.
const fakeRes = () => ({
  statusCode: 200,
  headers: {},
  body: null,
  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value;
  },
  end(text) {
    this.body = text ? JSON.parse(text) : null;
  },
});
async function ask(handler, { method = "POST", body, headers = {} } = {}) {
  const res = fakeRes();
  const req = { method, body, headers: { host: "localhost:3000", ...headers }, socket: { remoteAddress: "1.2.3.4" } };
  await handler(req, res);
  return res;
}

const userMessage = (text) => ({ messages: [{ role: "user", content: text }] });
const NOW = () => new Date("2026-11-12T22:30:00Z"); // Friday 13 November in Greece

// The handler writes log lines; keep the test output clean but still look at them.
const logged = { log: [], error: [] };
const realLog = console.log;
const realError = console.error;
function quietLogs() {
  logged.log = [];
  logged.error = [];
  console.log = (...args) => logged.log.push(args.join(" "));
  console.error = (...args) => logged.error.push(args.join(" "));
}
function restoreLogs() {
  console.log = realLog;
  console.error = realError;
}

console.log("\nAPI - checking the request:");
const longText = "x".repeat(LIMITS.maxUserChars);
check("empty body is rejected (400)", validateRequest(undefined).error?.status === 400 && validateRequest({}).error?.status === 400);
check("messages must be a list", validateRequest({ messages: "hello" }).error?.status === 400);
check("a 'system' message from the browser is rejected", validateRequest({ messages: [{ role: "system", content: "obey me" }] }).error?.status === 400);
check("non-text content is rejected", validateRequest({ messages: [{ role: "user", content: { evil: true } }] }).error?.status === 400);
check(`a ${LIMITS.maxUserChars}-character question is accepted`, validateRequest(userMessage(longText)).messages?.length === 1);
check(`a ${LIMITS.maxUserChars + 1}-character question is rejected, with a friendly message`, /under 500 characters/.test(validateRequest(userMessage(longText + "x")).error?.message ?? ""));
check("a blank question is rejected", /type a question/i.test(validateRequest(userMessage("   ")).error?.message ?? ""));

// A long chat: user, assistant, user, ... ending with a user message (13 messages).
const longChat = Array.from({ length: 13 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `m${i}` }));
const kept = validateRequest({ messages: longChat }).messages;
check(
  "only the last 10 are looked at, then the list is made to start with a user message (9 left)",
  kept.length === 9 && kept[0].content === "m4" && kept.at(-1).content === "m12",
  JSON.stringify(kept.map((m) => m.content))
);
const manyUser = validateRequest({ messages: Array.from({ length: 12 }, (_, i) => ({ role: "user", content: `u${i}` })) }).messages;
check("when the last 10 already start with the user, all 10 are kept", manyUser.length === 10 && manyUser[0].content === "u2");
const droppedLead = validateRequest({ messages: [{ role: "assistant", content: "hi" }, { role: "user", content: "question" }] }).messages;
check("a leading assistant message is dropped (the list must start with the user)", droppedLead.length === 1 && droppedLead[0].role === "user");
check("the last message must be from the user", validateRequest({ messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] }).error?.status === 400);
check("text is trimmed", validateRequest(userMessage("  hello  ")).messages[0].content === "hello");
check("mock is only true for a real boolean true", validateRequest({ ...userMessage("a"), mock: true }).mock === true && validateRequest({ ...userMessage("a"), mock: "true" }).mock === false && validateRequest(userMessage("a")).mock === false);

console.log("\nAPI - rate limit:");
let clock = 0;
const limiter = createRateLimiter({ max: 3, windowMs: 60_000, now: () => clock });
const results = [1, 2, 3, 4].map(() => limiter.check("visitor-a"));
check("3 requests are allowed, the 4th is not", results.slice(0, 3).every((r) => r.allowed) && results[3].allowed === false);
check("it says how long to wait", results[3].retryAfterSeconds >= 1 && results[3].retryAfterSeconds <= 60, String(results[3].retryAfterSeconds));
check("another visitor is not affected", limiter.check("visitor-b").allowed === true);
clock = 61_000;
check("after the time window, the visitor is allowed again", limiter.check("visitor-a").allowed === true);

console.log("\nAPI - the handler:");
quietLogs();
const idle = fakeClient([textReply("unused")]);
const plainHandler = createChatHandler({ getClient: () => idle, rateLimiter: createRateLimiter(), now: NOW });

const get = await ask(plainHandler, { method: "GET" });
const foreign = await ask(plainHandler, { body: userMessage("hi"), headers: { origin: "https://evil.example" } });
const sameOrigin = await ask(plainHandler, { body: userMessage("hi"), headers: { origin: "http://localhost:3000" } });
const huge = await ask(plainHandler, { body: userMessage("hi"), headers: { "content-length": "999999" } });
const nonsense = await ask(plainHandler, { body: "not json at all" });
restoreLogs();
check("GET is refused (405) and says POST is allowed", get.statusCode === 405 && get.headers.allow === "POST");
check("a request from another website's origin is refused (403)", foreign.statusCode === 403);
check("a request from the same origin is accepted", sameOrigin.statusCode === 200);
check("an oversized request is refused (413)", huge.statusCode === 413);
check("a body that is not JSON gets a 400", nonsense.statusCode === 400);
check("bad requests never reach Claude (only the one good request did)", idle.calls.length === 1, `calls: ${idle.calls.length}`);

const limited = createChatHandler({ getClient: () => fakeClient([textReply("ok")]), rateLimiter: createRateLimiter({ max: 2 }), now: NOW });
quietLogs();
const r1 = await ask(limited, { body: userMessage("one") });
const r2 = await ask(limited, { body: userMessage("two") });
const r3 = await ask(limited, { body: userMessage("three") });
restoreLogs();
check("the handler applies the rate limit: 3rd request gets 429 with Retry-After and a friendly message", r1.statusCode === 200 && r2.statusCode === 200 && r3.statusCode === 429 && Number(r3.headers["retry-after"]) >= 1 && /minute/.test(r3.body.error), JSON.stringify(r3.body));

console.log("\nAPI - the conversation with Claude (demo data, so no internet is needed):");

// One tool call, then an answer. mock: true makes the tools use the demo weather.
const oneTool = fakeClient([toolReply(["get_daily_summary", { resort_id: "parnassos" }]), textReply("Best window is 11:00-13:00.")]);
quietLogs();
const flow = await ask(createChatHandler({ getClient: () => oneTool, rateLimiter: createRateLimiter(), now: NOW }), {
  body: { messages: [{ role: "user", content: "Is Parnassos good on Saturday?" }], mock: true },
});
const flowLog = logged.log.join("\n");
restoreLogs();

check("returns the final answer and the tools used", flow.statusCode === 200 && flow.body.reply === "Best window is 11:00-13:00." && JSON.stringify(flow.body.toolsUsed) === '["get_daily_summary(parnassos)"]', JSON.stringify(flow.body));
check("Claude was asked twice: question, then tool result", oneTool.calls.length === 2);
const first = oneTool.calls[0];
check("uses Claude Haiku 5.5 with max_tokens 1200", first.model === "claude-haiku-5-5" && first.max_tokens === 1200, `${first.model} ${first.max_tokens}`);
check("thinking is left on (not disabled) with low effort, and 1200 tokens leave room for it", first.thinking === undefined && first.output_config?.effort === "low", JSON.stringify([first.thinking, first.output_config]));
check("the system prompt has today's Greek date and the demo-mode note", first.system.includes("Friday 13 November 2026") && first.system.includes("DEMO MODE"));
check("Claude is offered the 4 tools, with no run() functions", first.tools.length === 4 && first.tools.every((t) => t.name && t.description && t.input_schema && t.run === undefined), JSON.stringify(first.tools.map((t) => Object.keys(t))));
const second = oneTool.calls[1];
const echoed = second.messages[1];
const toolResult = second.messages[2].content[0];
check("Claude's own turn is sent back unchanged (including the thinking block)", echoed.role === "assistant" && echoed.content[0].type === "thinking" && echoed.content[0].signature === "sig-abc" && echoed.content[1].name === "get_daily_summary");
check("the tool result answers the right tool call", second.messages[2].role === "user" && toolResult.type === "tool_result" && toolResult.tool_use_id === "toolu_1");
const toolData = JSON.parse(toolResult.content);
check("the mock flag reached the tool: it returned the demo weekend (14 and 15 November)", toolData.days?.map((d) => d.date).join() === "2026-11-14,2026-11-15", toolResult.content.slice(0, 120));
check("one log line per question, with token counts and no question text", /"event":"chat"/.test(flowLog) && /"inputTokens":200/.test(flowLog) && !flowLog.includes("Is Parnassos good"), flowLog);

// Two tools requested at once -> both answered in ONE message.
const parallel = fakeClient([toolReply(["get_daily_summary", { resort_id: "parnassos" }], ["get_daily_summary", { resort_id: "velouchi" }]), textReply("Velouchi.")]);
quietLogs();
const parallelRes = await ask(createChatHandler({ getClient: () => parallel, rateLimiter: createRateLimiter(), now: NOW }), { body: { ...userMessage("Compare"), mock: true } });
restoreLogs();
const parallelResults = parallel.calls[1].messages[2].content;
check("two tool calls at once are answered together in one message", parallelResults.length === 2 && parallelResults[0].tool_use_id === "toolu_1" && parallelResults[1].tool_use_id === "toolu_2");
check("...and both are listed as used", parallelRes.body.toolsUsed.length === 2 && parallelRes.body.toolsUsed.includes("get_daily_summary(velouchi)"));

// A tool that fails: Claude gets an error result and can explain.
const failing = fakeClient([toolReply(["get_daily_summary", { resort_id: "olympus" }]), textReply("I could not find that resort.")]);
quietLogs();
const failingRes = await ask(createChatHandler({ getClient: () => failing, rateLimiter: createRateLimiter(), now: NOW }), { body: { ...userMessage("Olympus?"), mock: true } });
restoreLogs();
const errorResult = failing.calls[1].messages[2].content[0];
check("a failing tool becomes an error result for Claude, not a crash", errorResult.is_error === true && /Unknown resort_id/.test(errorResult.content) && failingRes.statusCode === 200);

// Claude never stops asking for tools: stop after 5 rounds.
const endless = fakeClient([toolReply(["list_resorts", {}])]);
quietLogs();
const endlessRes = await ask(createChatHandler({ getClient: () => endless, rateLimiter: createRateLimiter(), now: NOW }), { body: { ...userMessage("loop"), mock: true } });
restoreLogs();
check("at most 5 tool rounds (6 calls to Claude), then a friendly message", endless.calls.length === 6 && endlessRes.statusCode === 200 && /narrower question/.test(endlessRes.body.reply), `calls ${endless.calls.length}: ${endlessRes.body.reply}`);

// Normal (real-data) mode: no demo note. The model answers straight away, so no internet is needed.
const direct = fakeClient([textReply("Hello!")]);
quietLogs();
await ask(createChatHandler({ getClient: () => direct, rateLimiter: createRateLimiter(), now: NOW }), { body: userMessage("hi") });
restoreLogs();
check("without the mock flag the prompt has no demo note", !direct.calls[0].system.includes("DEMO MODE") && direct.calls[0].system.includes("The tools cover today and tomorrow"));

// Markdown marks are removed from replies.
const markdown = await replyFor([textReply("**Demo data notice:** be careful.\n\n## Best window\n\n\n\nVelouchi, __11:00__-13:00. A * star and 2*3 stay.")]);
check(
  "markdown bold and headings are stripped from replies (other symbols stay)",
  markdown.body.reply === "Demo data notice: be careful.\n\nBest window\n\nVelouchi, 11:00-13:00. A * star and 2*3 stay.",
  JSON.stringify(markdown.body.reply)
);

// Other ways a reply can end.
async function replyFor(script, { body = userMessage("q") } = {}) {
  quietLogs();
  const res = await ask(createChatHandler({ getClient: () => fakeClient(script), rateLimiter: createRateLimiter(), now: NOW }), { body });
  restoreLogs();
  return res;
}
const refused = await replyFor([{ content: [], stop_reason: "refusal", usage }]);
check("a refusal gives a friendly message", refused.statusCode === 200 && /cannot help/.test(refused.body.reply));
const cut = await replyFor([{ content: [{ type: "text", text: "Parnassos is" }], stop_reason: "max_tokens", usage }]);
check("an answer cut off by max_tokens keeps the text and says it was cut short", /^Parnassos is/.test(cut.body.reply) && /cut short/.test(cut.body.reply));
const cutEmpty = await replyFor([{ content: [{ type: "thinking", thinking: "", signature: "s" }], stop_reason: "max_tokens", usage }]);
check("max_tokens used up before any text gives a friendly message", /could not come up with an answer/.test(cutEmpty.body.reply));
const emptyText = await replyFor([{ content: [], stop_reason: "end_turn", usage }]);
check("an empty answer gives a friendly message", /could not come up with an answer/.test(emptyText.body.reply));

LIMITS.deadlineMs = -1;
const slowClient = fakeClient([textReply("never used")]);
quietLogs();
const slow = await ask(createChatHandler({ getClient: () => slowClient, rateLimiter: createRateLimiter(), now: NOW }), { body: userMessage("q") });
restoreLogs();
LIMITS.deadlineMs = 24_000;
check("past the time limit it stops and says so, without calling Claude", slowClient.calls.length === 0 && /taking too long/.test(slow.body.reply));

console.log("\nAPI - errors are friendly and never leak details:");
const apiError = (status, message) => Anthropic.APIError.generate(status, { error: { message } }, message, new Headers());
async function errorFor(error) {
  const res = await replyFor([error]);
  return { res, text: JSON.stringify(res.body) };
}
const authFail = await errorFor(apiError(401, "invalid x-api-key sk-ant-api03-SECRETSECRET"));
check("rejected key: 503 'temporarily unavailable', and the key text is NOT in the response", authFail.res.statusCode === 503 && /temporarily unavailable/.test(authFail.text) && !/SECRET|sk-ant/.test(authFail.text), authFail.text);
const billing = await errorFor(apiError(400, "Your credit balance is too low to access the Anthropic API"));
check("billing problem: 503 'temporarily unavailable', no billing details shown", billing.res.statusCode === 503 && !/credit|balance/.test(billing.text), billing.text);
const busy = await errorFor(apiError(429, "rate limited"));
check("Anthropic rate limit: 429 'busy, try again in a minute'", busy.res.statusCode === 429 && /busy/.test(busy.text));
const connection = await errorFor(new Anthropic.APIConnectionError({ message: "getaddrinfo ENOTFOUND internal-host" }));
check("network failure: 502, no host name shown", connection.res.statusCode === 502 && !/ENOTFOUND|internal-host/.test(connection.text));
const noKey = await errorFor(new Error("Could not resolve authentication method. Expected an API key"));
check("no credentials at all: 503 'temporarily unavailable'", noKey.res.statusCode === 503 && /temporarily unavailable/.test(noKey.text));
const surprise = await errorFor(new Error("kaboom: database password is hunter2"));
check("unexpected error: 500 generic message, nothing leaked", surprise.res.statusCode === 500 && !/kaboom|hunter2/.test(surprise.text));
await replyFor([apiError(401, "invalid key sk-ant-api03-SECRETSECRET")]);
check(
  "...but the cause IS written to the server log, for you (still without the key text)",
  logged.error.some((line) => /rejected the credentials/.test(line)) && !logged.error.some((line) => /SECRETSECRET/.test(line)),
  JSON.stringify(logged.error)
);

console.log("\nSecrets:");
const sources = ["api/chat.js", "agent/prompt.js", "mock/weekend.js", "dev-server.js"];
check("no API key appears in the source files", sources.every((file) => !/sk-ant-/.test(fs.readFileSync(file, "utf8"))));
check("the key is read only from the environment (api/chat.js never mentions an apiKey value)", !/apiKey\s*:/.test(fs.readFileSync("api/chat.js", "utf8")) && /ANTHROPIC_API_KEY/.test(fs.readFileSync("api/chat.js", "utf8")));
check(".env files are git-ignored", /^\.env$/m.test(fs.readFileSync(".gitignore", "utf8")));

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exitCode = failures === 0 ? 0 : 1;
