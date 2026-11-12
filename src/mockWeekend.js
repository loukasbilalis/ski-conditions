// mockWeekend.js
// TEMPORARY. A made-up, hard-coded weather forecast for the weekend of
// Sat 14 and Sun 15 November 2026, used to test how the page and the scoring
// look with realistic, changing weather. It is NOT a real forecast.
//
// To stop using it: set USE_MOCK_WEEKEND to false in weather.js
// (or delete this file and the two "TEMPORARY MOCK" lines in weather.js).
//
// THE STORY
//   Fri 13  mild thaw at midday (up to +4 °C), then a cold front; light snow in the evening
//   Sat 14  frozen, foggy morning (morning ice + low visibility) clearing by midday,
//           wind building all afternoon
//   Sun 15  very cold start (morning ice), then a warm front brings rain around lunchtime
// Friday is only background: the scoring needs the previous day for morning ice
// and for the 24-hour snow total. The scored days are Saturday and Sunday.
//
// Each resort gets the same weather with small differences (see PROFILES):
// temperature follows altitude, and wind, rain and snow depth differ per resort.

// ---------------------------------------------------------------
// The weather tables. One list of 24 numbers per day, one number per hour
// (the first is 00:00, the last is 23:00).
// ---------------------------------------------------------------

const fill = (value, patches = {}) => Array.from({ length: 24 }, (_, hour) => patches[hour] ?? value);

// Weather at the reference altitude (1950 m, the Parnassos base).
const WEATHER = {
  // °C
  temperature: {
    fri: [-1, -1, -2, -2, -2, -1, 0, 1, 2, 3, 4, 4, 4, 4, 3, 3, 2, 1, 0, -1, -2, -3, -4, -4],
    sat: [-7, -7, -8, -8, -8, -7, -7, -7, -6, -5, -3, -1, 0, 1, 2, 1, 0, -1, -2, -3, -3, -4, -4, -5],
    sun: [-9, -9, -10, -10, -9, -8, -7, -6, -5, -3, -1, 1, 3, 4, 5, 4, 3, 2, 1, 0, 0, -1, -1, -2],
  },
  // wind gusts, km/h
  windGusts: {
    fri: [15, 15, 15, 12, 12, 12, 15, 18, 20, 22, 25, 28, 30, 30, 32, 35, 38, 40, 35, 30, 28, 25, 22, 20],
    sat: [28, 25, 22, 20, 18, 16, 15, 15, 16, 18, 20, 24, 28, 32, 38, 44, 48, 45, 40, 35, 30, 28, 25, 22],
    sun: [20, 20, 22, 22, 24, 25, 25, 28, 30, 32, 35, 38, 40, 36, 32, 30, 28, 26, 24, 22, 20, 20, 18, 18],
  },
  // metres. Fog on Saturday morning, and rain-cloud on Sunday around lunchtime.
  visibility: {
    fri: fill(25000, { 20: 6000, 21: 3000, 22: 4000, 23: 8000 }),
    sat: [18000, 15000, 12000, 9000, 7000, 5000, 3000, 1200, 400, 600, 1800, 6000, 15000, 20000, 25000, 30000, 30000, 30000, 30000, 28000, 25000, 25000, 25000, 25000],
    sun: fill(25000, { 11: 6000, 12: 3000, 13: 2000, 14: 2500, 15: 4000, 16: 8000 }),
  },
  // relative humidity, %. Near 100 means fog or cloud.
  humidity: {
    fri: [80, 82, 85, 85, 86, 85, 82, 78, 72, 68, 66, 65, 66, 68, 70, 74, 78, 82, 86, 90, 93, 94, 92, 90],
    sat: [90, 92, 94, 96, 97, 98, 98, 99, 99, 99, 96, 90, 84, 80, 78, 76, 78, 80, 82, 84, 85, 86, 86, 87],
    sun: [70, 72, 74, 76, 78, 80, 80, 82, 84, 86, 88, 92, 96, 97, 98, 97, 95, 92, 90, 88, 86, 84, 82, 80],
  },
  // snowfall, cm per hour
  snowfall: {
    fri: fill(0, { 20: 0.4, 21: 0.8, 22: 0.6, 23: 0.3 }),
    sat: fill(0, { 6: 0.3, 7: 0.4, 8: 0.3, 9: 0.2, 10: 0.1 }),
    sun: fill(0, { 3: 0.2, 4: 0.3, 5: 0.2, 6: 0.1 }),
  },
  // rain, mm per hour (at the reference altitude; resorts scale it, see PROFILES)
  rain: {
    fri: fill(0),
    sat: fill(0),
    sun: fill(0, { 11: 0.1, 12: 0.3, 13: 0.4, 14: 0.4, 15: 0.2, 16: 0.1 }),
  },
  // showers, mm per hour (scaled like rain)
  showers: {
    fri: fill(0),
    sat: fill(0),
    sun: fill(0, { 13: 0.1, 14: 0.1 }),
  },
};

// ---------------------------------------------------------------
// What differs between resorts
//   gustFactor      multiplies the wind gusts
//   rainFactor      multiplies rain and showers
//   startSnowDepth  snow depth in metres at the start of Friday
//   visibility      exact visibility values to use at specific hours (instead of the table)
// ---------------------------------------------------------------
const PROFILES = {
  parnassos: { gustFactor: 1.0, rainFactor: 0.3, startSnowDepth: 0.55, visibility: {} },
  // Windier: gusts reach the 60 km/h lift limit on Saturday afternoon.
  vasilitsa: { gustFactor: 1.35, rainFactor: 0.8, startSnowDepth: 0.7, visibility: {} },
  // Thick fog on Saturday morning, and rain on Sunday.
  velouchi: {
    gustFactor: 0.9,
    rainFactor: 1.0,
    startSnowDepth: 0.55,
    visibility: { "2026-11-14T08:00": 60, "2026-11-14T09:00": 80, "2026-11-14T10:00": 400 },
  },
  // The most rain on Sunday, and the thinnest snow, which melts away.
  kalavryta: { gustFactor: 1.05, rainFactor: 2.0, startSnowDepth: 0.22, visibility: {} },
};

const REFERENCE_ELEVATION = 1950; // metres: the altitude the temperature table is for
const COOLING_PER_METRE = 0.0065; // °C lost per metre of height (about 6.5 °C per 1000 m)
const MELT_PER_DEGREE_HOUR = 0.003; // metres of snow lost per hour for each °C above 0

const DATES = { fri: "2026-11-13", sat: "2026-11-14", sun: "2026-11-15" };
const DAY_KEYS = ["fri", "sat", "sun"];

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * Same shape as getWeather(): 72 hourly objects (Fri, Sat, Sun), but with the
 * made-up weather above, adjusted for this resort.
 */
export async function getMockWeekendWeather(resort) {
  const profile = PROFILES[resort.id] ?? PROFILES.parnassos;
  const temperatureShift = (REFERENCE_ELEVATION - resort.elevation) * COOLING_PER_METRE; // lower = warmer
  const hours = [];
  let snowDepth = profile.startSnowDepth;

  for (const day of DAY_KEYS) {
    for (let hour = 0; hour < 24; hour++) {
      const time = `${DATES[day]}T${String(hour).padStart(2, "0")}:00`;
      const temperature = WEATHER.temperature[day][hour] + temperatureShift;
      const windGusts = WEATHER.windGusts[day][hour] * profile.gustFactor;
      const snowfall = WEATHER.snowfall[day][hour];

      // Snow depth: grows with snowfall, and melts when the temperature is above 0.
      snowDepth += snowfall / 100;
      if (temperature > 0) snowDepth -= MELT_PER_DEGREE_HOUR * temperature;
      snowDepth = Math.max(0, snowDepth);

      hours.push({
        time,
        temperature: round(temperature, 1),
        // "Feels like": colder when it is windy.
        apparentTemperature: round(temperature - 0.12 * windGusts - 1, 1),
        windGusts: round(windGusts, 1),
        visibility: profile.visibility[time] ?? WEATHER.visibility[day][hour],
        humidity: WEATHER.humidity[day][hour],
        snowDepth: round(snowDepth, 2),
        snowfall,
        rain: round(WEATHER.rain[day][hour] * profile.rainFactor, 2),
        showers: round(WEATHER.showers[day][hour] * profile.rainFactor, 2),
      });
    }
  }

  return hours;
}
