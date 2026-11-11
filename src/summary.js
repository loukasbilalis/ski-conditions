// summary.js
// Daily summary for one resort. Hours are NOT averaged into one day score.
// For each day we report:
//   - the best consecutive window (length set in config.summary.bestWindowHours) and its average
//   - the worst hour and what caused it (veto or weakest factor)
//   - the veto reasons, if any
// No page code here, so it can be reused as an AI agent tool.

import { CONFIG } from "./config.js";

/**
 * Summarise one day.
 *
 * @param {Array} dayResults  Scored hours of ONE day (from scoreForecast), in time order.
 * @returns {{
 *   bestWindow: { startTime: string, endTime: string, hours: number, average: number },
 *   worstHour: { time: string, score: number, vetoes: Array, worstFactor: object|null },
 *   vetoes: Array<{ id: string, label: string, hours: number }>
 * }|null}
 */
export function summarizeDay(dayResults, config = CONFIG) {
  if (dayResults.length === 0) return null;

  const scoreOf = (r) => r.score ?? 0;

  // Best consecutive window: try every start position, keep the highest average.
  // (On a tie the earlier window wins.)
  const length = Math.min(config.summary.bestWindowHours, dayResults.length);
  let best = null;
  for (let i = 0; i + length <= dayResults.length; i++) {
    const windowHours = dayResults.slice(i, i + length);
    const average = windowHours.reduce((sum, r) => sum + scoreOf(r), 0) / length;
    if (best === null || average > best.average) {
      best = {
        startTime: windowHours[0].time,
        endTime: windowHours[length - 1].time,
        hours: length,
        average: Math.round(average),
      };
    }
  }

  // Worst hour (on a tie the earlier hour wins) and what caused it.
  let worst = dayResults[0];
  for (const r of dayResults) {
    if (scoreOf(r) < scoreOf(worst)) worst = r;
  }

  // Veto reasons: how many hours each one affected.
  const counts = new Map();
  for (const r of dayResults) {
    for (const veto of r.vetoes) {
      const entry = counts.get(veto.id) || { id: veto.id, label: veto.label, hours: 0 };
      entry.hours += 1;
      counts.set(veto.id, entry);
    }
  }

  return {
    bestWindow: best,
    worstHour: { time: worst.time, score: scoreOf(worst), vetoes: worst.vetoes, worstFactor: worst.worstFactor },
    vetoes: [...counts.values()],
  };
}

/**
 * Split scored hours by day and summarise each day.
 *
 * @param {Array} results  The list from scoreForecast().
 * @returns {Array<{ date: string, hours: Array, summary: object }>}
 */
export function summarizeForecast(results, config = CONFIG) {
  const days = new Map();
  for (const r of results) {
    const date = r.time.slice(0, 10);
    if (!days.has(date)) days.set(date, []);
    days.get(date).push(r);
  }
  return [...days.entries()].map(([date, hours]) => ({ date, hours, summary: summarizeDay(hours, config) }));
}
