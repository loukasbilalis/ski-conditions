// main.js
// The ONLY file that touches the web page.
// It uses the logic files (resorts, weather, skiHours, scoring) and draws the result.

import { resorts } from "./resorts.js";
import { getWeather } from "./weather.js";
import { filterSkiHours } from "./skiHours.js";
import { scoreConditions } from "./scoring.js";

// Which colour class a score gets (the classes are defined in style.css).
function scoreClass(score) {
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

// Small helper: make an HTML element with a class and some text.
// We use textContent (not innerHTML) so text is never treated as code.
function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

// Draw one hour box: time, score, temperature and wind.
function makeHourBox(hour) {
  const score = scoreConditions(hour);
  const box = makeElement("div", `hour ${scoreClass(score)}`);
  // The tooltip appears when you hover over the box.
  box.title =
    `${hour.time.slice(11, 16)}: score ${score}\n` +
    `Temperature ${hour.temperature} °C\n` +
    `Wind ${hour.windSpeed} km/h\n` +
    `Snowfall ${hour.snowfall} cm\n` +
    `Visibility ${Math.round(hour.visibility / 100) / 10} km`;

  box.append(
    makeElement("div", "time", hour.time.slice(11, 16)),
    makeElement("div", "score", score),
    makeElement("div", "temp", `${Math.round(hour.temperature)}°C`),
    makeElement("div", "wind", `${Math.round(hour.windSpeed)} km/h`)
  );
  return box;
}

// Fill a resort card with the hourly scores, grouped by day.
function fillCard(card, hours) {
  // Group the hours by date: { "2026-11-11": [...], "2026-11-12": [...] }
  const days = {};
  for (const hour of hours) {
    const date = hour.time.slice(0, 10);
    if (!days[date]) days[date] = [];
    days[date].push(hour);
  }

  for (const [date, dayHours] of Object.entries(days)) {
    const row = makeElement("div", "hours");
    for (const hour of dayHours) row.append(makeHourBox(hour));
    card.append(makeElement("h3", "", dayLabel(date)), row);
  }
}

// Build one card per resort, then load each resort's weather.
for (const resort of resorts) {
  const card = makeElement("section", "card");
  card.append(
    makeElement("h2", "", resort.name),
    makeElement("p", "meta", `Top lift ${resort.elevation} m`)
  );
  const status = makeElement("p", "", "Loading…");
  card.append(status);
  document.getElementById("resorts").append(card);

  // The four resorts load at the same time, and a failure in one
  // does not stop the others.
  getWeather(resort)
    .then((hours) => {
      status.remove();
      fillCard(card, filterSkiHours(hours));
    })
    .catch((error) => {
      status.className = "error";
      status.textContent = `Could not load weather: ${error.message}`;
    });
}
