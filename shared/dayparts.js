/**
 * shared/dayparts.js — THE time-context adapter (single source of truth).
 *
 * Every hour / day-of-week / daypart / label derivation in the app flows
 * through this module — server imports it directly, the client imports it
 * via the `@shared` alias (client/src/lib/daypart.ts re-exports it). Do NOT
 * write inline Intl/toLocaleString time math anywhere else.
 *
 * HARD RULES (2026-07-06, Melody):
 *   - The IANA timezone MUST come from GPS coords via the Google Timezone API
 *     (resolved server-side in /api/location/resolve). Device/browser timezone,
 *     UTC, and home-profile timezone are NEVER acceptable substitutes — a
 *     driver may be working outside their home market (Indiana incident:
 *     device tz ≠ market tz corrupted field data).
 *   - No fallbacks. Missing timezone → throw. Unknown daypart key → null so
 *     the caller omits the field; never fabricate a value.
 *
 * Daypart taxonomy (renamed 2026-07-06 — keys are stored in
 * snapshots.day_part_key and offer_intelligence.day_part, and are read
 * verbatim by the AI pipeline, so they must be semantically accurate):
 *
 * | Key             | Hours       | Label             | Legacy key (pre-2026-07) |
 * |-----------------|-------------|-------------------|--------------------------|
 * | overnight       | 0:00-4:59   | overnight         | overnight                |
 * | morning         | 5:00-11:59  | morning           | morning                  |
 * | early_afternoon | 12:00-14:59 | early afternoon   | late_morning_noon        |
 * | late_afternoon  | 15:00-16:59 | late afternoon    | afternoon                |
 * | early_evening   | 17:00-20:59 | early evening     | early_evening            |
 * | evening         | 21:00-23:59 | evening           | evening                  |
 *
 * The old `late_morning_noon` key labeled 12:00 PM-2:59 PM "late morning" in
 * the header and in LLM prompts — semantically wrong, and it fed the models
 * bad time-of-day context. Legacy keys in existing rows are normalized on
 * read via normalizeDayPartKey(); migrations/20260706_daypart_key_rename.sql
 * remaps stored rows.
 *
 * @module shared/dayparts
 */

export const DAY_PART_KEYS = Object.freeze([
  'overnight',
  'morning',
  'early_afternoon',
  'late_afternoon',
  'early_evening',
  'evening',
]);

export const DAY_PART_LABELS = Object.freeze({
  overnight: 'overnight',
  morning: 'morning',
  early_afternoon: 'early afternoon',
  late_afternoon: 'late afternoon',
  early_evening: 'early evening',
  evening: 'evening',
});

/** Pre-2026-07 keys that may exist in stored rows → canonical key. */
export const LEGACY_DAY_PART_KEYS = Object.freeze({
  late_morning_noon: 'early_afternoon',
  afternoon: 'late_afternoon',
  late_evening: 'evening', // declared "future use" in old types; never produced, mapped defensively
});

/**
 * Normalize a stored daypart key to the canonical taxonomy.
 * Returns null for missing/unknown values — callers must omit the field
 * (or throw, per their own contract), never substitute a made-up daypart.
 *
 * @param {string|null|undefined} key
 * @returns {string|null}
 */
export function normalizeDayPartKey(key) {
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(DAY_PART_LABELS, key)) return key;
  return LEGACY_DAY_PART_KEYS[key] ?? null;
}

/**
 * Human/LLM-facing label for a (possibly legacy) daypart key, or null.
 *
 * @param {string|null|undefined} key
 * @returns {string|null}
 */
export function dayPartLabel(key) {
  const canonical = normalizeDayPartKey(key);
  return canonical ? DAY_PART_LABELS[canonical] : null;
}

/**
 * Classify an hour (integer 0-23) into a canonical daypart key.
 * Throws on anything else — a NaN/24 reaching this function means an
 * upstream extraction bug that must surface, not classify as 'evening'
 * (which is exactly what the old unguarded chain silently did).
 *
 * @param {number} hour
 * @returns {string}
 */
export function getDayPartKey(hour) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError(`getDayPartKey: hour must be an integer 0-23, got ${hour}`);
  }
  if (hour < 5) return 'overnight';
  if (hour < 12) return 'morning';
  if (hour < 15) return 'early_afternoon';
  if (hour < 17) return 'late_afternoon';
  if (hour < 21) return 'early_evening';
  return 'evening';
}

function requireTimeZone(timeZone, fn) {
  if (!timeZone || typeof timeZone !== 'string') {
    throw new Error(
      `${fn}: IANA timeZone is required (got ${JSON.stringify(timeZone)}). ` +
      'Resolve it from GPS coords via the Google Timezone API — ' +
      'device/browser/UTC fallbacks are not allowed.'
    );
  }
}

/**
 * Wall-clock hour (0-23) at `date` in `timeZone`.
 * Uses hourCycle 'h23' explicitly: the old `hour12: false` pattern maps to
 * hourCycle 'h24' on older ICU builds, formatting midnight as "24" — which
 * then fell through every daypart branch and displayed "evening" at 12 AM.
 * The % 24 guard covers any engine that still emits "24".
 *
 * @param {Date} date
 * @param {string} timeZone - IANA timezone from GPS resolve (required)
 * @returns {number}
 */
export function getLocalHour(date, timeZone) {
  requireTimeZone(timeZone, 'getLocalHour');
  const raw = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(date);
  const hour = parseInt(raw, 10) % 24;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`getLocalHour: could not derive hour for tz "${timeZone}" (Intl returned "${raw}")`);
  }
  return hour;
}

const DOW_BY_NAME = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });

/**
 * Day of week (0=Sunday … 6=Saturday) at `date` in `timeZone`.
 * Replaces the `new Date(date.toLocaleString(...))` round-trip, whose
 * re-parse is implementation-defined and yielded NaN/wrong values on some
 * engines.
 *
 * @param {Date} date
 * @param {string} timeZone - IANA timezone from GPS resolve (required)
 * @returns {number}
 */
export function getLocalDow(date, timeZone) {
  requireTimeZone(timeZone, 'getLocalDow');
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  const dow = DOW_BY_NAME[name];
  if (dow === undefined) {
    throw new Error(`getLocalDow: unexpected weekday "${name}" for tz "${timeZone}"`);
  }
  return dow;
}

/**
 * Local calendar date (YYYY-MM-DD) at `date` in `timeZone`.
 *
 * @param {Date} date
 * @param {string} timeZone - IANA timezone from GPS resolve (required)
 * @returns {string}
 */
export function getLocalDateString(date, timeZone) {
  requireTimeZone(timeZone, 'getLocalDateString');
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Local wall-clock timestamp as `YYYY-MM-DDTHH:mm:ss` (no zone suffix).
 * Matches the repo convention for snapshots.local_iso: wall-clock time
 * stored as a naive timestamp (see formatLocalTime in
 * server/lib/location/getSnapshotTimeContext.js).
 *
 * @param {Date} date
 * @param {string} timeZone - IANA timezone from GPS resolve (required)
 * @returns {string}
 */
export function getLocalIso(date, timeZone) {
  requireTimeZone(timeZone, 'getLocalIso');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const p = {};
  for (const { type, value } of parts) p[type] = value;
  const hour = String(parseInt(p.hour, 10) % 24).padStart(2, '0');
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:${p.second}`;
}

/**
 * Full classification at `date` in `timeZone`.
 * timeZone is REQUIRED — there is deliberately no device-timezone default.
 *
 * @param {Date} date
 * @param {string} timeZone - IANA timezone from GPS resolve (required)
 * @returns {{ key: string, label: string, hour: number }}
 */
export function classifyDayPart(date, timeZone) {
  const hour = getLocalHour(date, timeZone);
  const key = getDayPartKey(hour);
  return { key, label: DAY_PART_LABELS[key], hour };
}
