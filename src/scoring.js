// scoring.js
// scoreConditions(hour) turns one hour of weather into a score from 0 to 100.
// It knows nothing about web pages, so it can later be an AI agent tool.
//
// HOW IT WORKS
// Every hour starts at 100 points. Each rule below can take points away
// (a "penalty") or, for light fresh snow, add a few back (a "bonus").
// At the end the score is kept between 0 and 100.
//
// CHANGE THE RULES HERE: edit the numbers in RULES. No other code needs to change.
// In each list, the FIRST matching line wins, so keep the most severe line first.

export const RULES = {
  // Temperature in °C. Warm air means wet, slushy or no snow.
  temperature: [
    { above: 5, penalty: 60 }, // far too warm
    { above: 2, penalty: 40 },
    { above: 0, penalty: 20 }, // around freezing: snow gets heavy and sticky
    { below: -15, penalty: 15 }, // painfully cold
  ],

  // Wind speed in km/h. Strong wind is unpleasant and can close the lifts.
  windSpeed: [
    { above: 60, penalty: 100 }, // lifts closed: not skiable
    { above: 40, penalty: 80 }, // lifts likely closed
    { above: 25, penalty: 35 },
    { above: 15, penalty: 10 },
  ],

  // Visibility in metres. Fog makes it hard to see the slope.
  visibility: [
    { below: 200, penalty: 40 }, // thick fog
    { below: 1000, penalty: 25 },
    { below: 3000, penalty: 10 },
  ],

  // Snowfall in cm per hour. Very heavy snow cuts visibility.
  snowfall: [{ above: 3, penalty: 15 }],

  // A little fresh snow is nice, but only if it is cold enough to be real snow.
  freshSnowBonus: {
    minSnowfall: 0.1, // cm per hour
    maxTemperature: 1, // °C
    bonus: 5,
  },
};

// Looks through a list of rules and returns the penalty of the first one
// that matches the value. Returns 0 if none match.
function findPenalty(value, rules) {
  for (const rule of rules) {
    if (rule.above !== undefined && value > rule.above) return rule.penalty;
    if (rule.below !== undefined && value < rule.below) return rule.penalty;
  }
  return 0;
}

/**
 * Score one hour of ski conditions.
 *
 * @param {{ temperature: number, windSpeed: number, snowfall: number, visibility: number }} hour
 *   One item from getWeather(). Missing (null) values are ignored.
 * @returns {number} Whole number from 0 (terrible) to 100 (perfect).
 */
export function scoreConditions(hour) {
  let score = 100;

  // Take away points for each weather measurement that is available.
  if (hour.temperature != null) {
    score -= findPenalty(hour.temperature, RULES.temperature);
  }
  if (hour.windSpeed != null) {
    score -= findPenalty(hour.windSpeed, RULES.windSpeed);
  }
  if (hour.visibility != null) {
    score -= findPenalty(hour.visibility, RULES.visibility);
  }
  if (hour.snowfall != null) {
    score -= findPenalty(hour.snowfall, RULES.snowfall);
  }

  // Add the small bonus for light fresh snow.
  const bonus = RULES.freshSnowBonus;
  if (
    hour.snowfall >= bonus.minSnowfall &&
    hour.temperature <= bonus.maxTemperature
  ) {
    score += bonus.bonus;
  }

  // Keep the score between 0 and 100, as a whole number.
  return Math.round(Math.min(100, Math.max(0, score)));
}
