// test.js
// Run in the terminal with:  node test.js
// Checks the functions without needing a browser.

import { resorts } from "./src/resorts.js";
import { getWeather } from "./src/weather.js";
import { scoreConditions } from "./src/scoring.js";
import { filterSkiHours } from "./src/skiHours.js";

// --- Test 1: scoring with made-up hours (no internet needed) ---
// Each example has the score we EXPECT, so mistakes show up as FAIL.
const examples = [
  { name: "perfect day", expected: 100, hour: { temperature: -6, windSpeed: 8, snowfall: 0, visibility: 20000 } },
  { name: "light fresh snow", expected: 100, hour: { temperature: -4, windSpeed: 10, snowfall: 0.5, visibility: 8000 } }, // 105 -> capped at 100
  { name: "windy", expected: 20, hour: { temperature: -5, windSpeed: 45, snowfall: 0, visibility: 20000 } },
  { name: "foggy", expected: 75, hour: { temperature: -5, windSpeed: 5, snowfall: 0, visibility: 500 } },
  { name: "warm day", expected: 40, hour: { temperature: 7, windSpeed: 5, snowfall: 0, visibility: 20000 } },
  { name: "storm", expected: 0, hour: { temperature: 7, windSpeed: 70, snowfall: 4, visibility: 100 } },
  { name: "missing data", expected: 100, hour: { temperature: -5, windSpeed: null, snowfall: 0, visibility: null } },
];

console.log("Scoring tests:");
for (const { name, expected, hour } of examples) {
  const actual = scoreConditions(hour);
  console.log(`  ${actual === expected ? "ok  " : "FAIL"} ${name}: got ${actual}, expected ${expected}`);
}

// --- Test 2: the 09:00-16:00 window, both ends included ---
const fakeDay = Array.from({ length: 24 }, (_, h) => ({
  time: `2026-11-11T${String(h).padStart(2, "0")}:00`,
}));
const kept = filterSkiHours(fakeDay).map((hour) => hour.time.slice(11, 13));
const windowOk = kept.length === 8 && kept[0] === "09" && kept[7] === "16";
console.log(`\nSki hours window: ${windowOk ? "ok  " : "FAIL"} kept ${kept.join(", ")}`);

// --- Test 3: real forecast, scored hour by hour (needs internet) ---
const resort = resorts[0];
const hours = await getWeather(resort);
const skiHours = filterSkiHours(hours);
const scored = skiHours.slice(0, 8).map((hour) => ({ ...hour, score: scoreConditions(hour) }));

console.log(`\n${resort.name}: ${hours.length} hours fetched, ${skiHours.length} inside 09:00-16:00. First 8:`);
console.table(scored);
