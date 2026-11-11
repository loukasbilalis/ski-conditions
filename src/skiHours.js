// skiHours.js
// Keeps only the hours when the lifts are usually running.
// Like the other logic files, it knows nothing about the page.

// Change these two numbers to change the window. Both hours are INCLUDED,
// so start 9 and end 16 keeps 09:00, 10:00, ... 16:00 (8 hours per day).
export const SKI_HOURS = { start: 9, end: 16 };

/**
 * Keep only the hours inside the skiing window.
 *
 * @param {Array<{ time: string }>} hours  The list from getWeather().
 *   Each time looks like "2026-11-11T13:00".
 * @param {{ start: number, end: number }} [window]  Optional different window.
 * @returns {Array} A new, shorter list. The original list is not changed.
 */
export function filterSkiHours(hours, window = SKI_HOURS) {
  return hours.filter((hour) => {
    // "2026-11-11T13:00" -> characters 11 and 12 are the hour -> 13
    const hourOfDay = Number(hour.time.slice(11, 13));
    return hourOfDay >= window.start && hourOfDay <= window.end;
  });
}
