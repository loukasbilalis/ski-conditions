// test-chat.js
// Checks for the chatbot pieces (the shared prompt now; the API function later).
// Run with:  node test-chat.js     (needs no internet and no API key)
// Separate from test.js, which checks the scoring logic.

import { athensDate, buildSystemPrompt } from "./agent/prompt.js";

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

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exitCode = failures === 0 ? 0 : 1;
