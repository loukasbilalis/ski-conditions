// mockWeather.js
// TEMPORARY. Made-up "perfect" weather, only for checking how the page looks
// (high scores, hover tooltips). It is NOT a forecast.
// To remove the mock later: delete this file, the "MOCK" blocks in main.js,
// and the mock lines in index.html and style.css.

// The mock weather. Change a number to try other made-up conditions.
export const MOCK_WEATHER = {
  temperature: -5, // °C
  apparentTemperature: -5, // °C "feels like"
  windGusts: 5, // km/h
  visibility: 30000, // m (clear)
  humidity: 60, // %
  snowDepth: 1.0, // m (= 100 cm)
  snowfall: 0, // cm per hour
  rain: 0, // mm per hour
  showers: 0, // mm per hour
};

// Today's date in Greece as "2026-11-11"
function todayInAthens() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Athens" });
}

// Move a "2026-11-11" date forward or back by some days.
function addDays(date, days) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Same shape as getWeather(): 72 hourly objects (yesterday, today, tomorrow),
 * but every hour has the same perfect weather.
 * The resort argument is ignored. It's there so this can replace getWeather().
 */
export async function getMockWeather(resort) {
  const today = todayInAthens();
  const hours = [];
  for (const date of [addDays(today, -1), today, addDays(today, 1)]) {
    for (let h = 0; h < 24; h++) {
      hours.push({ time: `${date}T${String(h).padStart(2, "0")}:00`, ...MOCK_WEATHER });
    }
  }
  return hours;
}
