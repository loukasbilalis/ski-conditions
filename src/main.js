// main.js
// The ONLY file that touches the web page.
// It uses the logic files (resorts, weather, scoring, summary, config) and draws the result.

import { resorts } from "./resorts.js";
import { getWeather } from "./weather.js";
import { scoreForecast, resolveSettings } from "./scoring.js";
import { summarizeForecast } from "./summary.js";
import { CONFIG } from "./config.js";

// Demo data: open the page with ?mock=1 to use made-up weather (mock/weekend.js)
// instead of the real forecast. The chat widget reads the same switch, so the
// page and the chat always show the same data. The demo file is only downloaded
// when it is asked for.
const useMock = new URLSearchParams(location.search).get("mock") === "1";
const loadWeather = useMock ? (await import("../mock/weekend.js")).getMockWeather : getWeather;

// Under the legend: a clear warning when demo data is on, or a link to switch it on.
function showDemoNote() {
  const note = document.getElementById("demo-note");
  if (!note) return;
  const link = document.createElement("a");
  if (useMock) {
    note.className = "demo-note demo-on";
    note.textContent = "DEMO DATA: made-up weather for Sat 14 and Sun 15 Nov 2026, not a real forecast. ";
    link.href = location.pathname;
    link.textContent = "Back to real data";
  } else {
    note.textContent = "No snow right now? ";
    link.href = "?mock=1";
    link.textContent = "Try the demo data";
  }
  note.append(link);
}
showDemoNote();

// Which colour class a score gets (the classes are defined in style.css).
function scoreClass(score) {
  if (score === null) return "poor";
  if (score >= 70) return "good";
  if (score >= 40) return "ok";
  return "poor";
}

// "2026-11-11" -> "Wednesday 11 Nov"
function dayLabel(dateText) {
  return new Date(dateText + "T12:00").toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

// "2026-11-11T09:00" -> "09:00"
const clock = (time) => time.slice(11, 16);

// Round a number for display; shows "n/a" when the data is missing.
function show(value, digits = 0) {
  if (value === null || value === undefined) return "n/a";
  return digits === 0 ? String(Math.round(value)) : value.toFixed(digits);
}

// Small helper: make an HTML element with a class and some text.
// We use textContent (not innerHTML) so text is never treated as code.
function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

// The text shown when you hover over an hour box: why it scored what it did.
function makeTooltip(result) {
  const lines = [`${clock(result.time)}: score ${show(result.score)}`];

  if (result.vetoes.length > 0) {
    lines.push("", "VETO (score forced to 0):");
    for (const veto of result.vetoes) lines.push(`  - ${veto.message}`);
  }

  lines.push("", "Factor scores (0-100):");
  for (const [id, def] of Object.entries(CONFIG.factors)) {
    const group = def.group === "safety" ? "safety " : "quality";
    lines.push(`  ${def.label.padEnd(18)} ${show(result.factors[id]).padStart(3)}   (${group}, weight ${def.weight})`);
  }
  if (result.worstFactor) lines.push(`Worst factor: ${result.worstFactor.label} (${show(result.worstFactor.score)})`);
  if (result.missing.length > 0) {
    lines.push(`No data for: ${result.missing.map((id) => CONFIG.factors[id].label).join(", ")} (skipped)`);
  }

  const caps = Object.entries(result.caps).map(([group, cap]) => `${group} cap ${show(cap)}`);
  lines.push("", `Weighted average ${show(result.weightedAverage, 1)}; ${caps.join(", ")}`);

  const i = result.inputs;
  lines.push(
    "",
    "Weather used:",
    `  Temperature ${show(i.temperature, 1)} °C (feels like ${show(i.apparentTemperature, 1)} °C)`,
    `  Wind gusts ${show(i.windGusts)} km/h`,
    `  Visibility ${show(i.visibility)} m, humidity ${show(i.humidity)}%`,
    `  Snow depth ${show(i.snowDepth, 2)} m, snowfall ${show(i.snowfall, 1)} cm/h, last 24 h ${show(i.freshSnow24, 1)} cm`,
    `  Rain + showers ${show(i.rainPlusShowers, 1)} mm/h`
  );
  if (i.morningIceMin !== null) lines.push(`  Morning ice risk: overnight minimum ${show(i.morningIceMin, 1)} °C`);

  return lines.join("\n");
}

// Draw one hour box: time, score, and (if vetoed) a VETO tag.
function makeHourBox(result) {
  const vetoed = result.vetoes.length > 0;
  const box = makeElement("div", `hour ${scoreClass(result.score)}`);
  box.title = makeTooltip(result);

  box.append(
    makeElement("div", "time", clock(result.time)),
    makeElement("div", "score", show(result.score)),
    makeElement("div", "tag", vetoed ? "VETO" : `${show(result.inputs.temperature)}°C`),
    makeElement("div", "wind", `${show(result.inputs.windGusts)} km/h`)
  );
  return box;
}

// One line under the date: best window, worst hour and its cause, vetoes.
function makeSummaryLine(summary) {
  const { bestWindow, worstHour, vetoes } = summary;

  const cause = worstHour.vetoes.length
    ? worstHour.vetoes.map((v) => v.label).join(" + ")
    : worstHour.worstFactor
    ? worstHour.worstFactor.label
    : "n/a";

  const parts = [
    `Best ${bestWindow.hours} h: ${clock(bestWindow.startTime)}-${clock(bestWindow.endTime)} (average ${bestWindow.average})`,
    `Worst hour: ${clock(worstHour.time)}, score ${worstHour.score} - ${cause}`,
    vetoes.length
      ? `Vetoes: ${vetoes.map((v) => `${v.label} ${v.hours} h`).join(", ")}`
      : "No vetoes",
  ];
  return makeElement("p", "summary", parts.join("  |  "));
}

// Fill a resort card: for each day a summary line and a row of hour boxes.
function fillCard(card, scoredHours) {
  for (const day of summarizeForecast(scoredHours)) {
    const row = makeElement("div", "hours");
    for (const result of day.hours) row.append(makeHourBox(result));
    card.append(makeElement("h3", "", dayLabel(day.date)), makeSummaryLine(day.summary), row);
  }
}

// Build one card per resort, then load each resort's weather.
for (const resort of resorts) {
  const settings = resolveSettings(resort);
  const card = makeElement("section", "card");
  card.append(
    makeElement("h2", "", resort.name),
    makeElement(
      "p",
      "meta",
      `Base ${resort.elevation} m · lifts ${settings.liftHours.start}:00-${settings.liftHours.end}:00 · ` +
        `wind limit ${settings.windLimit} km/h · minimum snow depth ${settings.minSnowDepth} m`
    )
  );
  const status = makeElement("p", "", "Loading…");
  card.append(status);
  document.getElementById("resorts").append(card);

  // The resorts load at the same time, and a failure in one does not stop the others.
  loadWeather(resort)
    .then((hours) => {
      status.remove();
      fillCard(card, scoreForecast(hours, resort));
    })
    .catch((error) => {
      status.className = "error";
      status.textContent = `Could not load weather: ${error.message}`;
    });
}
