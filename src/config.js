// config.js
// EVERY threshold, table and weight used for scoring lives in this one object.
// Change a number here and the scoring changes. No other file needs editing.
// Source: "Ski Lesson Conditions Score - Spec". All numbers are estimates.
//
// HOW A TABLE WORKS
// Each table is a list of [value, score] rows, sorted by value.
// The score is found by linear interpolation between the two nearest rows.
// Below the first row  -> the first row's score.
// Above the last row   -> the last row's score.
// Example: wind table has [25, 85] and [35, 60], so a 30 km/h gust scores 72.5.

export const CONFIG = {
  // ---------------------------------------------------------------
  // Per-resort settings. "defaults" apply to every resort. To change one
  // resort, add it under resortOverrides with only the settings that differ,
  // for example:  vasilitsa: { windLimit: 50 }
  // ---------------------------------------------------------------
  defaults: {
    windLimit: 60, // km/h. Gusts at or above this close the lifts (veto)
    minSnowDepth: 0.01, // metres. Kept low because the model ignores snowmaking and grooming
    liftHours: { start: 9, end: 16 }, // both included, local time (Europe/Athens)
  },
  resortOverrides: {
    // parnassos: { windLimit: 55 },
  },

  // ---------------------------------------------------------------
  // Layer 1: hard vetoes. If any is true, the hour scores 0.
  // (The wind limit and minimum snow depth are in "defaults" above.)
  // ---------------------------------------------------------------
  vetoes: {
    rainMmAtOrAbove: 0.5, // rain + showers, mm per hour
    visibilityBelowM: 100, // metres
    apparentTemperatureAtOrBelowC: -18, // degrees C
  },
  // Short names used when the page explains a veto.
  vetoLabels: {
    wind: "Wind gusts at lift limit",
    rain: "Rain",
    visibility: "Visibility too low",
    apparentTemperature: "Too cold (feels-like)",
    snowDepth: "Snow depth below minimum",
  },

  // ---------------------------------------------------------------
  // Layer 2: factors and weights. Weights should add up to 100.
  // (If a measurement is missing, that factor is skipped and the
  // remaining weights are re-scaled, so the sum is not enforced.)
  // group: "safety" or "quality". Used by the Layer 3 caps.
  // ---------------------------------------------------------------
  factors: {
    wind: {
      label: "Wind (gusts)",
      group: "safety",
      weight: 18,
      // wind_gusts_10m in km/h
      table: [[0, 100], [15, 100], [25, 85], [35, 60], [45, 35], [55, 15], [65, 0]],
    },
    visibility: {
      label: "Visibility",
      group: "safety",
      weight: 16,
      // Effective visibility = the LOWER of the two scores below.
      table: [[0, 0], [100, 10], [200, 30], [500, 60], [1000, 80], [2000, 95], [5000, 100]], // visibility in m
      fogProxyTable: [[85, 100], [90, 90], [95, 60], [98, 30], [100, 15]], // relative_humidity_2m in %
    },
    rain: {
      label: "Rain",
      group: "safety",
      weight: 14,
      // rain + showers, mm in the current hour
      table: [[0, 100], [0.1, 70], [0.5, 40], [1.0, 20], [2.0, 5], [4.0, 0]],
    },
    coldComfort: {
      label: "Cold comfort",
      group: "safety",
      weight: 14,
      // apparent_temperature in degrees C
      table: [[-20, 0], [-16, 10], [-13, 25], [-10, 45], [-8, 60], [-5, 80], [0, 95], [5, 100]],
    },
    morningIce: {
      label: "Morning ice",
      group: "safety",
      weight: 10,
      // Overnight minimum temperature in degrees C
      table: [[-10, 40], [-5, 55], [-2, 80], [0, 100]],
      // When it applies (otherwise the score is 100):
      thawMaxAtLeast: 1, // previous day's max temperature must be at least this (a thaw happened)
      overnightFromHour: 20, // overnight window: previous day from this hour...
      overnightToHour: 8, // ...until this hour today
      thawAbove: 0, // ice ends when the temperature first rises above this (looking from overnightToHour on)...
      endHour: 11, // ...or at this hour, whichever comes first. The ice window ends BEFORE that hour.
    },
    snowQuality: {
      label: "Snow quality",
      group: "quality",
      weight: 10,
      // temperature_2m in degrees C
      table: [[-20, 50], [-15, 65], [-10, 85], [-5, 100], [2, 100], [5, 60], [8, 25], [12, 0]],
    },
    snowDepth: {
      label: "Snow depth",
      group: "quality",
      weight: 10,
      // snow_depth in metres (modelled natural snow)
      table: [[0, 0], [0.1, 0], [0.3, 40], [0.5, 75], [0.8, 95], [1.0, 100]],
    },
    currentSnowfall: {
      label: "Current snowfall",
      group: "quality",
      weight: 4,
      // snowfall in cm in the current hour
      table: [[0, 100], [0.5, 95], [1, 80], [2, 55], [3, 30], [5, 10]],
    },
    freshSnow: {
      label: "Fresh snow",
      group: "quality",
      weight: 4,
      windowHours: 24, // sum of snowfall over the 24 hourly values ending at the current hour
      // cm in that window
      table: [[0, 80], [3, 90], [8, 100], [15, 90], [25, 65], [40, 40], [60, 25]],
    },
  },

  // ---------------------------------------------------------------
  // Layer 3: weakest-link caps, one per group.
  // final = min( weighted average,
  //              worst safety score  + margins.safety,
  //              worst quality score + margins.quality )
  // ---------------------------------------------------------------
  margins: { safety: 15, quality: 35 },

  // ---------------------------------------------------------------
  // Daily summary
  // ---------------------------------------------------------------
  summary: {
    bestWindowHours: 3, // length of the "best consecutive window"
  },
};

// Checks the config for typos. Returns a list of problems (empty list = fine).
export function validateConfig(config = CONFIG) {
  const problems = [];

  const checkTable = (name, table) => {
    if (!Array.isArray(table) || table.length < 2) {
      problems.push(`${name}: table needs at least 2 rows`);
      return;
    }
    for (let i = 1; i < table.length; i++) {
      if (!(table[i][0] > table[i - 1][0])) problems.push(`${name}: rows must be sorted by increasing value`);
    }
    for (const [, score] of table) {
      if (score < 0 || score > 100) problems.push(`${name}: scores must be between 0 and 100`);
    }
  };

  let weightSum = 0;
  for (const [id, factor] of Object.entries(config.factors)) {
    weightSum += factor.weight;
    checkTable(id, factor.table);
    if (factor.fogProxyTable) checkTable(`${id}.fogProxyTable`, factor.fogProxyTable);
    if (!(factor.group in config.margins)) problems.push(`${id}: group "${factor.group}" has no margin`);
  }
  if (weightSum !== 100) problems.push(`weights add up to ${weightSum}, expected 100`);

  return problems;
}
