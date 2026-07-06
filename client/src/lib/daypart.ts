// client/src/lib/daypart.ts
//
// 2026-07-06: All daypart/time-context logic lives in shared/dayparts.js —
// ONE adapter for server and client, so the label the driver sees in the
// header and the key stored in snapshots/read by the AI pipeline can never
// drift apart again. (Previously this file carried its own copy, whose
// "late morning" label for 12-3 PM confused both drivers and the models.)
//
// The GPS-resolved IANA timezone is REQUIRED by every function here — there
// is deliberately no device-timezone fallback. If you don't have a timezone
// from LocationContext yet, render a syncing state; do not guess.

export {
  DAY_PART_KEYS,
  DAY_PART_LABELS,
  LEGACY_DAY_PART_KEYS,
  normalizeDayPartKey,
  dayPartLabel,
  getDayPartKey,
  getLocalHour,
  getLocalDow,
  getLocalDateString,
  getLocalIso,
  classifyDayPart,
} from '@shared/dayparts';

export type { DayPartKey, LegacyDayPartKey } from '@shared/dayparts';

// Back-compat alias for existing imports (`DayPart` was the old type name).
export type { DayPartKey as DayPart } from '@shared/dayparts';
