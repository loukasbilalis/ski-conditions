// weather.js
// getWeather(resort) fetches hourly weather from Open-Meteo.
// It knows nothing about web pages, so it also works in Node and
// can later be used as a tool for an AI agent.

import { getMockWeekendWeather } from "./mockWeekend.js"; // TEMPORARY MOCK

// TEMPORARY MOCK: true = use the made-up weekend forecast in mockWeekend.js
// instead of real Open-Meteo data. Set to false to get real weather again.
const USE_MOCK_WEEKEND = true;

const API_URL = "https://api.open-meteo.com/v1/forecast";

// How many days to fetch from today on: today and tomorrow = 2 days.
// Days start at midnight. Change this later to expand the forecast (e.g. 3 or 7).
const FORECAST_DAYS = 2;

// Also fetch yesterday. The scoring needs it for the 24 h fresh-snow sum,
// the previous day's maximum temperature, and the overnight minimum (morning ice).
const PAST_DAYS = 1;

/**
 * Get hourly weather for one resort (yesterday + today + tomorrow = 72 hours).
 *
 * @param {{ latitude: number, longitude: number, elevation?: number }} resort
 *   Any object with latitude and longitude (elevation is optional).
 * @returns {Promise<Array<{
 *   time: string,                 // local Greek time, e.g. "2026-11-11T13:00"
 *   temperature: number,          // °C at 2 m
 *   apparentTemperature: number,  // °C "feels like"
 *   windGusts: number,            // km/h at 10 m
 *   visibility: number,           // metres
 *   humidity: number,             // relative humidity %
 *   snowDepth: number,            // metres (modelled natural snow)
 *   snowfall: number,             // cm of snow in that hour
 *   rain: number,                 // mm in that hour
 *   showers: number               // mm in that hour
 * }>>} Any value can be null if Open-Meteo has no data for it.
 */
export async function getWeather(resort) {
  if (USE_MOCK_WEEKEND) return getMockWeekendWeather(resort); // TEMPORARY MOCK

  // Step 1: build the web address (URL) with our question in it.
  const params = new URLSearchParams({
    latitude: resort.latitude,
    longitude: resort.longitude,
    hourly: [
      "temperature_2m",
      "apparent_temperature",
      "wind_gusts_10m",
      "visibility",
      "relative_humidity_2m",
      "snow_depth",
      "snowfall",
      "rain",
      "showers",
    ].join(","),
    past_days: PAST_DAYS,
    forecast_days: FORECAST_DAYS,
    timezone: "Europe/Athens",
  });

  // Tell Open-Meteo the real height of the base, so the temperature is adjusted for it.
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

  // Step 5: Open-Meteo returns parallel lists (one list per measurement).
  // We turn them into one object per hour, which is easier to work with.
  return hourly.time.map((time, i) => ({
    time,
    temperature: hourly.temperature_2m[i],
    apparentTemperature: hourly.apparent_temperature[i],
    windGusts: hourly.wind_gusts_10m[i],
    visibility: hourly.visibility[i],
    humidity: hourly.relative_humidity_2m[i],
    snowDepth: hourly.snow_depth[i],
    snowfall: hourly.snowfall[i],
    rain: hourly.rain[i],
    showers: hourly.showers[i],
  }));
}
