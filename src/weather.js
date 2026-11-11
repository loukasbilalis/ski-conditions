// weather.js
// getWeather(resort) fetches hourly weather from Open-Meteo.
// It knows nothing about web pages, so it also works in Node and
// can later be used as a tool for an AI agent.

const API_URL = "https://api.open-meteo.com/v1/forecast";

// How many days to fetch: today and tomorrow = 2 days = 48 hours.
// Days start at midnight, so every skiing hour (09:00-16:00) of today is included.
// Change this number later to expand the forecast (e.g. 3 or 7).
const FORECAST_DAYS = 2;

/**
 * Get hourly weather for one resort.
 *
 * @param {{ latitude: number, longitude: number, elevation?: number }} resort
 *   Any object with latitude and longitude (elevation is optional).
 * @returns {Promise<Array<{
 *   time: string,        // local Greek time, e.g. "2026-11-11T13:00"
 *   temperature: number, // degrees Celsius
 *   windSpeed: number,   // km/h
 *   snowfall: number,    // cm of snow in that hour
 *   visibility: number   // metres
 * }>>}
 */
export async function getWeather(resort) {
  // Step 1: build the web address (URL) with our question in it.
  const params = new URLSearchParams({
    latitude: resort.latitude,
    longitude: resort.longitude,
    hourly: "temperature_2m,wind_speed_10m,snowfall,visibility",
    forecast_days: FORECAST_DAYS,
    timezone: "Europe/Athens",
  });

  // Tell Open-Meteo the mountain height, so the temperature is adjusted for it.
  if (resort.elevation !== undefined) {
    params.set("elevation", resort.elevation);
  }

  // Step 2: send the request and wait for the answer.
  const response = await fetch(`${API_URL}?${params}`);

  // Step 3: stop with a clear message if something went wrong.
  if (!response.ok) {
    throw new Error(`Open-Meteo request failed with status ${response.status}`);
  }

  // Step 4: turn the answer from text into a JavaScript object.
  const data = await response.json();
  const hourly = data.hourly;

  // Step 5: Open-Meteo returns parallel lists (one list per measurement):
  //   time:        [t0, t1, t2, ...]
  //   temperature: [a0, a1, a2, ...]
  // We turn them into one object per hour, which is easier to work with:
  //   [{ time: t0, temperature: a0, ... }, { time: t1, ... }, ...]
  return hourly.time.map((time, i) => ({
    time,
    temperature: hourly.temperature_2m[i],
    windSpeed: hourly.wind_speed_10m[i],
    snowfall: hourly.snowfall[i],
    visibility: hourly.visibility[i],
  }));
}
