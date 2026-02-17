/**
 * server/lib/location/daypart.js
 *
 * Shared daypart classification utility.
 * Extracted from server/api/location/location.js:30-37 for reuse
 * across offer intelligence, snapshot creation, and other temporal analysis.
 *
 * 2026-02-17: Extracted to shared module for offer_intelligence table.
 *
 * @module server/lib/location/daypart
 */

/**
 * Classify an hour (0-23) into a daypart key.
 *
 * | Key                | Hours      |
 * |--------------------|------------|
 * | overnight          | 0:00-4:59  |
 * | morning            | 5:00-11:59 |
 * | late_morning_noon  | 12:00-14:59|
 * | afternoon          | 15:00-16:59|
 * | early_evening      | 17:00-20:59|
 * | evening            | 21:00-23:59|
 *
 * @param {number} hour - Hour of day (0-23)
 * @returns {string} Daypart key
 */
export function getDayPartKey(hour) {
  if (hour >= 0 && hour < 5) return 'overnight';
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 15) return 'late_morning_noon';
  if (hour >= 15 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'early_evening';
  return 'evening';
}
