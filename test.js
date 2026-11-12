// test.js
// Run in the terminal with:  node test.js
// Checks the logic without a browser. Every expected number was worked out by
// hand from the spec's tables, so a FAIL means the code and the spec disagree.

import { resorts } from "./src/resorts.js";
import { getWeather } from "./src/weather.js";
import { CONFIG, validateConfig } from "./src/config.js";
import { interpolate, scoreConditions, scoreForecast, resolveSettings } from "./src/scoring.js";
import { summarizeDay, summarizeForecast } from "./src/summary.js";
import { createTools, runTool } from "./src/tools.js";

let failures = 0;
function check(name, condition, detail = "") {
  if (!condition) failures++;
  console.log(`  ${condition ? "ok  " : "FAIL"} ${name}${condition ? "" : "  " + detail}`);
}
const close = (a, b, tolerance = 0.01) => typeof a === "number" && Math.abs(a - b) <= tolerance;

// A "perfect-ish" hour. Each test changes only what it wants to test.
const baseHour = {
  time: "2026-03-10T10:00",
  temperature: -3,
  apparentTemperature: -6,
  windGusts: 10,
  visibility: 20000,
  humidity: 70,
  snowDepth: 0.5,
  snowfall: 0,
  rain: 0,
  showers: 0,
};
const baseContext = { freshSnow24: 0, morningIceMin: null };
const score = (changes = {}, context = baseContext) => scoreConditions({ ...baseHour, ...changes }, context, {});

// ---------------------------------------------------------------
console.log("Config:");
check("config has no problems (sorted tables, weights add up to 100)", validateConfig().length === 0, validateConfig().join("; "));
const brokenConfig = { ...CONFIG, factors: { ...CONFIG.factors, wind: { ...CONFIG.factors.wind, weight: 30 } } };
check("a wrong weight sum is detected", validateConfig(brokenConfig).length > 0);

// ---------------------------------------------------------------
console.log("\nInterpolation:");
check("wind 30 is halfway between 25->85 and 35->60 = 72.5", close(interpolate(30, CONFIG.factors.wind.table), 72.5));
check("below the first row gives the first score (wind -5 = 100)", interpolate(-5, CONFIG.factors.wind.table) === 100);
check("above the last row gives the last score (wind 100 = 0)", interpolate(100, CONFIG.factors.wind.table) === 0);
check("visibility 150 m = 20", close(interpolate(150, CONFIG.factors.visibility.table), 20));
check("missing value gives null", interpolate(null, CONFIG.factors.wind.table) === null);

// ---------------------------------------------------------------
console.log("\nFactor scores and the final score:");
const perfect = score();
check("cold comfort -6 is 73.33", close(perfect.factors.coldComfort, 73.33), `got ${perfect.factors.coldComfort}`);
check("snow depth 0.5 m is 75", perfect.factors.snowDepth === 75);
check("fresh snow 0 cm is 80", perfect.factors.freshSnow === 80);
check("weighted average is 92.97", close(perfect.weightedAverage, 92.97), `got ${perfect.weightedAverage}`);
check("good hour scores 88 (capped by cold comfort 73.33 + safety margin 15 = 88.33)", perfect.score === 88, `got ${perfect.score}`);
check("worst factor is cold comfort", perfect.worstFactor.id === "coldComfort");

const windy = score({ windGusts: 55 });
check("gusts 55 give wind factor 15", windy.factors.wind === 15);
check("weakest-link cap: score is 30 (15 + safety margin 15), not the 78 average",windy.score === 30, `got ${windy.score}, average ${windy.weightedAverage}`);

const ice = score({}, { freshSnow24: 0, morningIceMin: -6 });
check("morning ice with overnight min -6 is 52", close(ice.factors.morningIce, 52), `got ${ice.factors.morningIce}`);
check("...and it caps the score at 67 (52 + 15)", ice.score === 67, `got ${ice.score}`);
check("fresh snow 12 cm is 94.29", close(score({}, { freshSnow24: 12, morningIceMin: null }).factors.freshSnow, 94.29));

// ---------------------------------------------------------------
console.log("\nVetoes (each one exactly at its limit, and just inside it):");
const vetoIds = (changes) => score(changes).vetoes.map((v) => v.id);
check("gusts 60 -> veto, score 0", vetoIds({ windGusts: 60 }).includes("wind") && score({ windGusts: 60 }).score === 0);
check("gusts 59.9 -> no veto", !vetoIds({ windGusts: 59.9 }).includes("wind"));
check("rain + showers 0.5 -> veto", vetoIds({ rain: 0.3, showers: 0.2 }).includes("rain"));
check("rain + showers 0.4 -> no veto", !vetoIds({ rain: 0.3, showers: 0.1 }).includes("rain"));
check("visibility 99 -> veto", vetoIds({ visibility: 99 }).includes("visibility"));
check("visibility 100 -> no veto", !vetoIds({ visibility: 100 }).includes("visibility"));
check("feels-like -18 -> veto", vetoIds({ apparentTemperature: -18 }).includes("apparentTemperature"));
check("feels-like -17.9 -> no veto", !vetoIds({ apparentTemperature: -17.9 }).includes("apparentTemperature"));
check("snow depth 0 -> veto (below 0.01)", vetoIds({ snowDepth: 0 }).includes("snowDepth"));
check("snow depth 0.01 -> no veto", !vetoIds({ snowDepth: 0.01 }).includes("snowDepth"));
const twoVetoes = score({ windGusts: 70, visibility: 50 });
check("two vetoes are both recorded, and factors are still listed", twoVetoes.vetoes.length === 2 && twoVetoes.factors.wind === 0);

// ---------------------------------------------------------------
console.log("\nMissing data (skip the factor, re-scale the weights):");
const noVis = score({ visibility: null, humidity: null });
check("visibility factor is null and listed as missing", noVis.factors.visibility === null && noVis.missing.includes("visibility"));
check("remaining weights (84) are re-scaled: average 91.63, not 92.97", close(noVis.weightedAverage, 91.63), `got ${noVis.weightedAverage}`);
check("...and the final score is still capped at 88", noVis.score === 88, `got ${noVis.score}`);
check("only humidity missing: visibility alone is used, same score 88", score({ humidity: null }).score === 88);

// ---------------------------------------------------------------
console.log("\nPer-resort settings:");
const customConfig = { ...CONFIG, resortOverrides: { demo: { windLimit: 50, liftHours: { start: 10, end: 12 } } } };
const demo = resolveSettings({ id: "demo" }, customConfig);
check("override changes the wind limit", demo.windLimit === 50 && resolveSettings({ id: "other" }, customConfig).windLimit === 60);
check("gusts 55 are a veto with limit 50", scoreConditions({ ...baseHour, windGusts: 55 }, baseContext, demo, customConfig).vetoes.length === 1);

// ---------------------------------------------------------------
// A made-up 3-day series (yesterday, today, tomorrow) to test the logic that needs other hours.
console.log("\nForecast logic (made-up 3-day series):");
function makeSeries() {
  const hours = [];
  for (const date of ["2026-03-09", "2026-03-10", "2026-03-11"]) {
    for (let h = 0; h < 24; h++) {
      let temperature = 0;
      if (date === "2026-03-09") temperature = h >= 20 ? -6 : h >= 17 ? -1 : h >= 10 ? 3 : -1; // thaw at midday, freezing overnight
      if (date === "2026-03-10") temperature = h <= 8 ? -6 : h === 9 ? -4 : h === 10 ? -1 : h === 11 ? 1 : h <= 16 ? 2 : -3;
      if (date === "2026-03-11") temperature = h <= 8 ? -3 : 1;
      hours.push({
        ...baseHour,
        time: `${date}T${String(h).padStart(2, "0")}:00`,
        temperature,
        snowfall: date === "2026-03-09" && h >= 10 && h <= 13 ? 1 : 0, // 4 cm of snow yesterday late morning
      });
    }
  }
  return hours;
}
const results = scoreForecast(makeSeries(), { id: "demo-none" });
const at = (time) => results.find((r) => r.time === time);

check("16 hours scored: 09:00-16:00 today and tomorrow (yesterday is background only)", results.length === 16, `got ${results.length}`);
check("first scored hour is today 09:00", results[0].time === "2026-03-10T09:00");
check("thaw yesterday: ice at 09:00 uses overnight min -6 -> 52", close(at("2026-03-10T09:00").factors.morningIce, 52));
check("ice also applies at 10:00 (temp still below 0)", close(at("2026-03-10T10:00").factors.morningIce, 52));
check("ice ends at 11:00 when temperature rises above 0 -> 100", at("2026-03-10T11:00").factors.morningIce === 100);
check("tomorrow: it rises above 0 at 09:00, so no ice hours are scored", results.filter((r) => r.time.startsWith("2026-03-11")).every((r) => r.factors.morningIce === 100));
check("fresh snow at 09:00 = 4 cm (24 h window) -> 92", close(at("2026-03-10T09:00").factors.freshSnow, 92), `got ${at("2026-03-10T09:00").factors.freshSnow}`);
check("fresh snow at 12:00 = 1 cm -> 83.33", close(at("2026-03-10T12:00").factors.freshSnow, 83.33));
check("fresh snow at 14:00 = 0 cm -> 80", at("2026-03-10T14:00").factors.freshSnow === 80);

const shortDay = scoreForecast(makeSeries(), { id: "demo" }, customConfig);
check("per-resort lift hours 10-12 give 3 hours per day", shortDay.length === 6, `got ${shortDay.length}`);

// ---------------------------------------------------------------
console.log("\nDaily summary:");
const fakeDay = [10, 20, 80, 90, 70, 30, 40, 50].map((s, i) => ({
  time: `2026-03-10T${String(9 + i).padStart(2, "0")}:00`,
  score: s,
  vetoes: i < 2 ? [{ id: "wind", label: "Wind gusts at lift limit" }] : [],
  worstFactor: { id: "wind", label: "Wind (gusts)", score: s },
}));
const summary = summarizeDay(fakeDay);
check("best 3-hour window is 11:00-13:00 (80, 90, 70)", summary.bestWindow.startTime.endsWith("11:00") && summary.bestWindow.endTime.endsWith("13:00"), JSON.stringify(summary.bestWindow));
check("...with average 80", summary.bestWindow.average === 80);
check("worst hour is 09:00 with score 10", summary.worstHour.time.endsWith("09:00") && summary.worstHour.score === 10);
check("veto reasons: wind, 2 hours", summary.vetoes.length === 1 && summary.vetoes[0].id === "wind" && summary.vetoes[0].hours === 2);
check("a day split gives one summary per date", summarizeForecast(results).length === 2);

// ---------------------------------------------------------------
// The AI-agent tools, run against the made-up weather (no internet needed).
console.log("\nAgent tools (made-up weather):");
let weatherDownloads = 0;
const fakeWeather = async () => {
  weatherDownloads++;
  return makeSeries();
};
const toolList = createTools({ getWeather: fakeWeather });
const byName = Object.fromEntries(toolList.map((t) => [t.name, t]));

check(
  "four tools, each with a name, description, object input schema and run()",
  toolList.length === 4 &&
    toolList.every((t) => t.name && t.description.length > 40 && t.input_schema.type === "object" && typeof t.run === "function"),
  toolList.map((t) => t.name).join(", ")
);
check(
  "resort tools only accept the real resort ids (enum) and require resort_id",
  ["get_hourly_weather", "score_hourly_conditions", "get_daily_summary"].every(
    (n) =>
      byName[n].input_schema.required.includes("resort_id") &&
      JSON.stringify(byName[n].input_schema.properties.resort_id.enum) === JSON.stringify(resorts.map((r) => r.id))
  )
);

const listed = await byName.list_resorts.run({});
check("list_resorts returns all 4 resorts with their limits", listed.length === 4 && listed[0].lift_wind_limit_kmh === 60 && listed[0].lift_hours === "09:00-16:00");

const weatherOut = await byName.get_hourly_weather.run({ resort_id: "parnassos" });
check("get_hourly_weather: 16 lift hours, starting today 09:00", weatherOut.hours.length === 16 && weatherOut.hours[0].time === "2026-03-10T09:00");
check("...with readable field names and units", weatherOut.hours[0].feels_like === -6 && weatherOut.units.wind_gusts === "km/h");

const scoreOut = await byName.score_hourly_conditions.run({ resort_id: "parnassos" });
check("score_hourly_conditions: 16 hours, scores match scoreForecast", scoreOut.hours.length === 16 && scoreOut.hours[0].score === scoreForecast(makeSeries(), resorts[0])[0].score);
check("...factors are left out by default", scoreOut.hours[0].factors === undefined);
const withFactors = await byName.score_hourly_conditions.run({ resort_id: "parnassos", include_factors: true });
check(
  "...and included with include_factors: true, each with a score and a reading",
  typeof withFactors.hours[0].factors["Wind (gusts)"].score === "number" && typeof withFactors.hours[0].factors["Wind (gusts)"].reading === "string"
);
check("...the wind reading gives the real gust speed, not the score (10 km/h gusts)", withFactors.hours[0].factors["Wind (gusts)"].reading === "gusts 10 km/h", withFactors.hours[0].factors["Wind (gusts)"].reading);
check(
  "...the weakest factor also comes with its reading (first hour: morning ice, overnight minimum -6 °C)",
  scoreOut.hours[0].weakest_factor.name === "Morning ice" && scoreOut.hours[0].weakest_factor.reading === "overnight minimum -6 °C",
  JSON.stringify(scoreOut.hours[0].weakest_factor)
);
check("...and the tool description warns that a low factor score is not a low reading", /HIGHER IS BETTER/.test(byName.score_hourly_conditions.description));

const dailyOut = await byName.get_daily_summary.run({ resort_id: "parnassos" });
check("get_daily_summary: 2 days, each with a 3-hour best window", dailyOut.days.length === 2 && dailyOut.days.every((d) => d.best_window.hours === 3));

const sizes = [weatherOut, scoreOut, withFactors, dailyOut].map((o) => JSON.stringify(o).length);
console.log(`       output sizes in characters: weather ${sizes[0]}, scores ${sizes[1]}, scores+factors ${sizes[2]}, summary ${sizes[3]}`);
check("default outputs stay compact (under 8000 characters each)", [sizes[0], sizes[1], sizes[3]].every((s) => s < 8000));
check("the detailed factor output stays under 14000 characters (about 4000 tokens)", sizes[2] < 14000);

// Errors come back as data the AI can read, never as crashes.
const badResort = await runTool("score_hourly_conditions", { resort_id: "olympus" }, toolList);
check("unknown resort: returns an error that lists the valid ids", badResort.error?.includes("parnassos") && badResort.error.includes("olympus"), JSON.stringify(badResort));
check("missing resort_id: returns an error", (await runTool("get_daily_summary", {}, toolList)).error !== undefined);
check("unknown tool name: returns an error", (await runTool("book_a_hotel", {}, toolList)).error !== undefined);
check("runTool runs a tool by name", (await runTool("list_resorts", {}, toolList)).length === 4);

// The same resort asked 3 times downloads the weather once.
weatherDownloads = 0;
const cachedTools = createTools({ getWeather: fakeWeather });
await runTool("get_hourly_weather", { resort_id: "vasilitsa" }, cachedTools);
await runTool("score_hourly_conditions", { resort_id: "vasilitsa" }, cachedTools);
await runTool("get_daily_summary", { resort_id: "vasilitsa" }, cachedTools);
check("3 tool calls for one resort download the weather once", weatherDownloads === 1, `downloads: ${weatherDownloads}`);
weatherDownloads = 0;
const uncachedTools = createTools({ getWeather: fakeWeather, cacheMinutes: 0 });
await runTool("get_hourly_weather", { resort_id: "vasilitsa" }, uncachedTools);
await runTool("get_daily_summary", { resort_id: "vasilitsa" }, uncachedTools);
check("with cacheMinutes: 0 every call downloads again", weatherDownloads === 2, `downloads: ${weatherDownloads}`);

// ---------------------------------------------------------------
console.log("\nLive forecast (needs internet):");
for (const resort of resorts) {
  const hours = await getWeather(resort);
  const scored = scoreForecast(hours, resort);
  const days = summarizeForecast(scored);
  check(`${resort.name}: ${hours.length} hours fetched, ${scored.length} scored, ${days.length} days`, hours.length === 72 && scored.length === 16 && days.length === 2);
  for (const day of days) {
    const { bestWindow, worstHour, vetoes } = day.summary;
    const worstCause = worstHour.vetoes.length ? worstHour.vetoes.map((v) => v.label).join(" + ") : worstHour.worstFactor?.label;
    console.log(
      `       ${day.date}: best ${bestWindow.startTime.slice(11)}-${bestWindow.endTime.slice(11)} avg ${bestWindow.average}` +
        ` | worst ${worstHour.time.slice(11)} = ${worstHour.score} (${worstCause})` +
        ` | vetoes: ${vetoes.map((v) => `${v.label} ${v.hours}h`).join(", ") || "none"}`
    );
  }
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exitCode = failures === 0 ? 0 : 1;
