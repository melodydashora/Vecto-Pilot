/**
 * Type declarations for shared/dayparts.js — the time-context adapter.
 * Keep in sync with the implementation (it is the single source of truth
 * for daypart taxonomy; these types just describe it to TypeScript).
 */

export type DayPartKey =
  | 'overnight'        // 12:00 AM - 4:59 AM
  | 'morning'          // 5:00 AM - 11:59 AM
  | 'early_afternoon'  // 12:00 PM - 2:59 PM (legacy key: late_morning_noon)
  | 'late_afternoon'   // 3:00 PM - 4:59 PM  (legacy key: afternoon)
  | 'early_evening'    // 5:00 PM - 8:59 PM
  | 'evening';         // 9:00 PM - 11:59 PM

export type LegacyDayPartKey = 'late_morning_noon' | 'afternoon' | 'late_evening';

export declare const DAY_PART_KEYS: readonly DayPartKey[];
export declare const DAY_PART_LABELS: Readonly<Record<DayPartKey, string>>;
export declare const LEGACY_DAY_PART_KEYS: Readonly<Record<LegacyDayPartKey, DayPartKey>>;

export declare function normalizeDayPartKey(key: string | null | undefined): DayPartKey | null;
export declare function dayPartLabel(key: string | null | undefined): string | null;
export declare function getDayPartKey(hour: number): DayPartKey;
export declare function getLocalHour(date: Date, timeZone: string): number;
export declare function getLocalDow(date: Date, timeZone: string): number;
export declare function getLocalDateString(date: Date, timeZone: string): string;
export declare function getLocalIso(date: Date, timeZone: string): string;
export declare function classifyDayPart(
  date: Date,
  timeZone: string
): { key: DayPartKey; label: string; hour: number };
