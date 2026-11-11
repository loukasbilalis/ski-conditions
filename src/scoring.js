// scoring.js
// Implements "Ski Lesson Conditions Score - Spec". All numbers come from config.js.
// Nothing here touches a web page, so it can later be used as an AI agent tool.
//
// Three layers, for every hour:
//   1. Hard vetoes      - if any is true, the score is 0.
//   2. Weighted average - of the factor scores (each 0-100).
//   3. Weakest-link caps - the final score can't be much higher than the
//                          worst safety factor or the worst quality factor.

import { CONFIG } from "./config.js";

// ---------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------

// Turns a value into a 0-100 score using a [value, score] table.
// Linear interpolation between rows; clamped to the first/last row outside the table.
// Returns null if the value is missing.
export function interpolate(value, table) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;

  const first = table[0];
  const last = table[table.length - 1];
  if (value <= first[0]) return first[1];
  if (value >= last[0]) return last[1];

  for (let i = 1; i < table.length; i++) {
    const [x0, y0] = table[i - 1];
    const [x1, y1] = table[i];
    if (value <= x1) return y0 + ((y1 - y0) * (value - x0)) / (x1 - x0);
  }
}

// Adds up the values that are not null. Returns null if all are missing.
function sumAvailable(...values) {
  const present = values.filter((v) => v !== null && v !== undefined);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

// Smallest of the values that are not null. Returns null if all are missing.
function minAvailable(...values) {
  const present = values.filter((v) => v !== null && v !== undefined);
  return present.length ? Math.min(...present) : null;
}

const hourOf = (hour) => Number(hour.time.slice(11, 13)); // "2026-11-11T09:00" -> 9
const dateOf = (hour) => hour.time.slice(0, 10); // "2026-11-11T09:00" -> "2026-11-11"

// "2026-11-11" -> "2026-11-10"
function previousDate(date) {
  const d = new Date(date + "T12:00:00Z"); // noon UTC avoids daylight-saving surprises
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The settings for one resort: the defaults from config.js plus
 * anything listed for this resort under resortOverrides.
 */
export function resolveSettings(resort, config = CONFIG) {
  const override = (resort && config.resortOverrides[resort.id]) || {};
  return {
    ...config.defaults,
    ...override,
    liftHours: { ...config.defaults.liftHours, ...(override.liftHours || {}) },
  };
}

// ---------------------------------------------------------------
// Context: facts about an hour that need OTHER hours
// ---------------------------------------------------------------

/**
 * Works out the two things an hour can't know by itself:
 *   freshSnow24   - sum of snowfall over the 24 hourly values ending at this hour
 *   morningIceMin - overnight minimum temperature IF morning ice applies to this hour,
 *                   otherwise null (meaning "no ice risk")
 *
 * @param {Array} hours  The whole series from getWeather() (needs yesterday too).
 * @param {number} index Position of the hour inside that series.
 */
export function buildContext(hours, index, config = CONFIG) {
  const hour = hours[index];
  const date = dateOf(hour);
  const prevDate = previousDate(date);

  // Fresh snow: the 24 hourly values ending at this hour.
  const windowHours = config.factors.freshSnow.windowHours;
  let freshSnow24 = null;
  for (let j = Math.max(0, index - windowHours + 1); j <= index; j++) {
    const snow = hours[j].snowfall;
    if (snow !== null && snow !== undefined) freshSnow24 = (freshSnow24 ?? 0) + snow;
  }

  // Morning ice: only after a thaw (previous day's max temperature high enough)...
  const ice = config.factors.morningIce;
  const temps = (list) => list.map((h) => h.temperature).filter((t) => t !== null && t !== undefined);

  const prevDayMax = Math.max(...temps(hours.filter((h) => dateOf(h) === prevDate)), -Infinity);
  let morningIceMin = null;

  if (prevDayMax >= ice.thawMaxAtLeast) {
    // ...the overnight minimum: previous day from 20:00 until 08:00 today...
    const overnight = temps(
      hours.filter(
        (h) =>
          (dateOf(h) === prevDate && hourOf(h) >= ice.overnightFromHour) ||
          (dateOf(h) === date && hourOf(h) <= ice.overnightToHour)
      )
    );

    // ...and only until the temperature first rises above freezing, or endHour.
    const firstWarm = hours.find(
      (h) => dateOf(h) === date && hourOf(h) >= ice.overnightToHour && h.temperature > ice.thawAbove
    );
    const iceEnds = Math.min(ice.endHour, firstWarm ? hourOf(firstWarm) : Infinity);

    if (overnight.length && hourOf(hour) < iceEnds) morningIceMin = Math.min(...overnight);
  }

  return { freshSnow24, morningIceMin };
}

// ---------------------------------------------------------------
// The score for ONE hour
// ---------------------------------------------------------------

/**
 * Score one hour of ski conditions.
 *
 * @param {object} hour     One item from getWeather().
 * @param {object} context  From buildContext(): { freshSnow24, morningIceMin }.
 * @param {object} settings From resolveSettings(): { windLimit, minSnowDepth, ... }.
 * @returns {{
 *   time: string,
 *   score: number|null,           // 0-100 (always 0 if there is a veto)
 *   vetoes: Array<{ id: string, label: string, message: string }>,
 *   factors: object,              // every factor's score (null = no data)
 *   worstFactor: { id: string, label: string, score: number }|null,
 *   missing: string[],            // factors skipped because data was missing
 *   weightedAverage: number|null, // Layer 2 result
 *   caps: object,                 // Layer 3 limits, e.g. { safety: 30, quality: 110 }
 *   inputs: object                // the weather values this hour used
 * }}
 */
export function scoreConditions(hour, context = {}, settings = {}, config = CONFIG) {
  const rules = { ...config.defaults, ...settings };
  const cf = config.factors;
  const isNum = (v) => v !== null && v !== undefined;

  // ----- Layer 1: hard vetoes -----
  const vetoes = [];
  const addVeto = (id, message) => vetoes.push({ id, label: config.vetoLabels[id], message });
  const rainTotal = sumAvailable(hour.rain, hour.showers);

  if (isNum(hour.windGusts) && hour.windGusts >= rules.windLimit) {
    addVeto("wind", `Wind gusts ${hour.windGusts} km/h are at or above the lift limit of ${rules.windLimit} km/h`);
  }
  if (isNum(rainTotal) && rainTotal >= config.vetoes.rainMmAtOrAbove) {
    addVeto("rain", `Rain + showers ${rainTotal.toFixed(1)} mm/h is at or above ${config.vetoes.rainMmAtOrAbove} mm/h`);
  }
  if (isNum(hour.visibility) && hour.visibility < config.vetoes.visibilityBelowM) {
    addVeto("visibility", `Visibility ${hour.visibility} m is below ${config.vetoes.visibilityBelowM} m`);
  }
  if (isNum(hour.apparentTemperature) && hour.apparentTemperature <= config.vetoes.apparentTemperatureAtOrBelowC) {
    addVeto("apparentTemperature", `Feels like ${hour.apparentTemperature} °C is at or below ${config.vetoes.apparentTemperatureAtOrBelowC} °C`);
  }
  if (isNum(hour.snowDepth) && hour.snowDepth < rules.minSnowDepth) {
    addVeto("snowDepth", `Snow depth ${hour.snowDepth} m is below the minimum of ${rules.minSnowDepth} m`);
  }

  // ----- The score of each factor (0-100, or null if its data is missing) -----
  const factors = {
    wind: interpolate(hour.windGusts, cf.wind.table),
    // Effective visibility = the lower of the visibility score and the fog-proxy (humidity) score.
    visibility: minAvailable(
      interpolate(hour.visibility, cf.visibility.table),
      interpolate(hour.humidity, cf.visibility.fogProxyTable)
    ),
    rain: interpolate(rainTotal, cf.rain.table),
    coldComfort: interpolate(hour.apparentTemperature, cf.coldComfort.table),
    // null means "morning ice does not apply to this hour", which scores 100.
    morningIce: isNum(context.morningIceMin) ? interpolate(context.morningIceMin, cf.morningIce.table) : 100,
    snowQuality: interpolate(hour.temperature, cf.snowQuality.table),
    snowDepth: interpolate(hour.snowDepth, cf.snowDepth.table),
    currentSnowfall: interpolate(hour.snowfall, cf.currentSnowfall.table),
    freshSnow: interpolate(context.freshSnow24, cf.freshSnow.table),
  };

  // ----- Layer 2: weighted average (factors without data are skipped, weights re-scaled) -----
  let weightedTotal = 0;
  let weightUsed = 0;
  const missing = [];
  const worstInGroup = {}; // lowest factor score per group, e.g. { safety: 15, quality: 75 }
  let worstFactor = null;

  for (const [id, def] of Object.entries(cf)) {
    const factorScore = factors[id];
    if (factorScore === null || factorScore === undefined) {
      missing.push(id);
      continue;
    }
    weightedTotal += factorScore * def.weight;
    weightUsed += def.weight;

    if (worstInGroup[def.group] === undefined || factorScore < worstInGroup[def.group]) {
      worstInGroup[def.group] = factorScore;
    }
    if (worstFactor === null || factorScore < worstFactor.score) {
      worstFactor = { id, label: def.label, score: factorScore };
    }
  }
  const weightedAverage = weightUsed > 0 ? weightedTotal / weightUsed : null;

  // ----- Layer 3: weakest-link caps, one per group -----
  const caps = {};
  for (const [group, worst] of Object.entries(worstInGroup)) {
    caps[group] = worst + config.margins[group];
  }

  // ----- Final score -----
  let score = null;
  if (vetoes.length > 0) {
    score = 0;
  } else if (weightedAverage !== null) {
    score = Math.round(Math.min(100, Math.max(0, Math.min(weightedAverage, ...Object.values(caps)))));
  }

  return {
    time: hour.time,
    score,
    vetoes,
    factors,
    worstFactor,
    missing,
    weightedAverage,
    caps,
    inputs: {
      temperature: hour.temperature,
      apparentTemperature: hour.apparentTemperature,
      windGusts: hour.windGusts,
      visibility: hour.visibility,
      humidity: hour.humidity,
      snowDepth: hour.snowDepth,
      snowfall: hour.snowfall,
      rainPlusShowers: rainTotal,
      freshSnow24: context.freshSnow24 ?? null,
      morningIceMin: context.morningIceMin ?? null,
    },
  };
}

// ---------------------------------------------------------------
// The scores for a whole forecast
// ---------------------------------------------------------------

/**
 * Score every lift-operating hour of a forecast, for one resort.
 *
 * @param {Array} hours  The full list from getWeather() (including yesterday).
 * @param {object} resort  A resort from resorts.js (used for its id and config overrides).
 * @returns {Array} One detailed result per lift hour (see scoreConditions).
 *   Days that have no previous day in the list (normally yesterday) are
 *   used as background data only and are not scored.
 */
export function scoreForecast(hours, resort, config = CONFIG) {
  const settings = resolveSettings(resort, config);
  const { start, end } = settings.liftHours;
  const dates = new Set(hours.map(dateOf));
  const results = [];

  hours.forEach((hour, index) => {
    const h = hourOf(hour);
    if (h < start || h > end) return; // outside lift hours
    if (!dates.has(previousDate(dateOf(hour)))) return; // no previous-day data to score with

    const context = buildContext(hours, index, config);
    results.push(scoreConditions(hour, context, settings, config));
  });

  return results;
}
