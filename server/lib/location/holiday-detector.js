// server/lib/location/holiday-detector.js
// Fast holiday detection using BRIEFING_HOLIDAY role with Google Search
// explicitly configured with tools and safety overrides.
//
// Supports holiday overrides via server/config/holiday-override.json
// Overrides can be superseded by actual holidays (e.g., Christmas overrides "Happy Holidays")
//
// Updated 2026-01-05: Added L1 cache with 24h TTL to reduce API costs

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
// 2026-07-06: local-date derivation via the shared time-context adapter
// (h23-safe, throws without a timezone — no UTC-date fallback)
import { getLocalDateString } from './daypart.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 2026-07-06: Holiday is a REQUIRED snapshot field (Melody): it drives the
 * driver-facing header aesthetics AND rides the snapshot row into every LLM
 * call in the waterfall. Detection failure must therefore FAIL the snapshot —
 * a silently-defaulted 'none' is bad data downstream. 'none' now means
 * "verified not a holiday", never "we couldn't tell".
 */
export class HolidayDetectionError extends Error {
  constructor(reason) {
    super(`Holiday detection failed: ${reason}`);
    this.name = 'HolidayDetectionError';
    this.code = 'HOLIDAY_DETECTION_FAILED';
  }
}

// ============================================================================
// L1 CACHE - In-memory cache for holiday detection results
// Key: "YYYY-MM-DD|City|Country", Value: { result, expiresAt }
// TTL: 24 hours (86400000 ms)
// Updated 2026-01-05: Reduces redundant BRIEFING_HOLIDAY model calls
// ============================================================================
const HOLIDAY_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const holidayCache = new Map();

/**
 * Generate cache key for holiday detection
 * 2026-02-17: FIX - Uses timezone-aware local date, NOT UTC date
 * UTC date can be a day ahead of driver's local date (e.g., 10 PM CST = Feb 16, but UTC = Feb 17)
 * @param {Date} date - The date to check (UTC)
 * @param {string} city - City name
 * @param {string} country - Country code
 * @param {string} timezone - IANA timezone (e.g., 'America/Chicago')
 * @returns {string} Cache key
 */
function getHolidayCacheKey(date, city, country, timezone) {
  // getLocalDateString throws without a timezone — no UTC-date fallback
  // (UTC can be a day ahead of the driver's local date)
  const dateStr = getLocalDateString(date, timezone);
  return `${dateStr}|${city?.toLowerCase() || 'unknown'}|${country?.toLowerCase() || 'unknown'}`;
}

/**
 * Check L1 cache for holiday result
 * @param {string} key - Cache key
 * @returns {{ holiday: string, is_holiday: boolean } | null}
 */
function getFromHolidayCache(key) {
  const cached = holidayCache.get(key);
  if (!cached) return null;

  if (Date.now() > cached.expiresAt) {
    holidayCache.delete(key);
    return null;
  }

  console.log(`[BRIEFING] [HOLIDAY] Cache HIT: ${key}`);
  return cached.result;
}

/**
 * Store holiday result in L1 cache
 * @param {string} key - Cache key
 * @param {{ holiday: string, is_holiday: boolean }} result - Detection result
 */
function setHolidayCache(key, result) {
  holidayCache.set(key, {
    result,
    expiresAt: Date.now() + HOLIDAY_CACHE_TTL
  });
  console.log(`[BRIEFING] [HOLIDAY] Cache SET: ${key} (TTL: 24h)`);
}

/**
 * Clear expired entries from holiday cache (garbage collection)
 * Called periodically to prevent memory leaks
 */
function cleanupHolidayCache() {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, value] of holidayCache.entries()) {
    if (now > value.expiresAt) {
      holidayCache.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`[BRIEFING] [HOLIDAY] Cleaned ${cleaned} expired cache entries`);
  }
}

// Run cleanup every hour
setInterval(cleanupHolidayCache, 60 * 60 * 1000);

/**
 * Check if there's an active holiday override for the current date
 * @param {Date} date - The date to check
 * @returns {{ holiday: string, is_holiday: boolean, superseded_by_actual: boolean } | null}
 */
function getHolidayOverride(date) {
  try {
    // 2026-07-06: FIX — the config lives at server/config/holiday-override.json;
    // the old '../config/' resolved to server/lib/config/ (nonexistent), so
    // overrides SILENTLY never loaded. This is why holiday aesthetics never fired.
    const configPath = join(__dirname, '../../config/holiday-override.json');

    if (!existsSync(configPath)) {
      return null;
    }

    const config = JSON.parse(readFileSync(configPath, 'utf-8'));

    if (!config.active || !Array.isArray(config.overrides)) {
      return null;
    }

    const now = date instanceof Date ? date : new Date(date);

    // Find matching override (highest priority first)
    const matchingOverrides = config.overrides
      .filter(override => {
        const start = new Date(override.start_date);
        const end = new Date(override.end_date);
        return now >= start && now <= end;
      })
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    if (matchingOverrides.length === 0) {
      return null;
    }

    const override = matchingOverrides[0];
    console.log(`[BRIEFING] [HOLIDAY] 🎄 Override active: "${override.holiday_name}" (${override.id})`);

    return {
      holiday: override.holiday_name,
      is_holiday: true,
      superseded_by_actual: override.superseded_by_actual !== false // default true
    };
  } catch (error) {
    // A corrupt override file is a config bug that must surface, not vanish
    throw new HolidayDetectionError(`corrupt holiday-override.json: ${error.message}`);
  }
}

// 2026-02-13: Migrated to the callModel adapter (hedged router + fallback) — model-agnostic, role-addressed
import { callModel } from '../ai/adapters/index.js';

// ============================================================================
// 2026-04-05: LOCAL STATIC HOLIDAY DETECTOR
// Runs BEFORE the BRIEFING_HOLIDAY model call — zero cost, zero latency, 100% reliable
// for well-known US holidays and Easter (which requires dynamic computation).
// ============================================================================

/**
 * Compute Easter Sunday for a given year using the Anonymous Gregorian algorithm (Computus).
 * Returns a Date object in UTC for Easter Sunday.
 * @param {number} year - The year (e.g., 2026)
 * @returns {Date} Easter Sunday
 */
function computeEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Get the Nth occurrence of a weekday in a given month/year.
 * @param {number} year - Year
 * @param {number} month - Month (0-indexed: 0=Jan, 11=Dec)
 * @param {number} dayOfWeek - Day of week (0=Sunday, 1=Monday, ..., 6=Saturday)
 * @param {number} n - Which occurrence (1=first, 2=second, etc.)
 * @returns {Date} The date in UTC
 */
function nthWeekdayOfMonth(year, month, dayOfWeek, n) {
  const first = new Date(Date.UTC(year, month, 1));
  let offset = (dayOfWeek - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month, 1 + offset + 7 * (n - 1)));
}

/**
 * Get the last occurrence of a weekday in a given month/year.
 * @param {number} year - Year
 * @param {number} month - Month (0-indexed)
 * @param {number} dayOfWeek - Day of week (0=Sunday, ..., 6=Saturday)
 * @returns {Date} The date in UTC
 */
function lastWeekdayOfMonth(year, month, dayOfWeek) {
  const last = new Date(Date.UTC(year, month + 1, 0)); // Last day of month
  let offset = (last.getUTCDay() - dayOfWeek + 7) % 7;
  return new Date(Date.UTC(year, month + 1, -offset));
}

// === GLOBAL HOLIDAYS (observed in all countries) ===
const GLOBAL_FIXED_HOLIDAYS = {
  '01-01': "New Year's Day",
  '12-25': 'Christmas Day',
};

// === COUNTRY-SPECIFIC FIXED-DATE HOLIDAYS ===
// Key: ISO 3166-1 alpha-2 country code (uppercase)
// Extensible: add new countries by adding entries here.
const COUNTRY_FIXED_HOLIDAYS = {
  US: {
    '06-19': 'Juneteenth',
    '07-04': 'Independence Day',
    '11-11': "Veterans Day",
    '12-24': 'Christmas Eve',
    '12-31': "New Year's Eve",
  },
  CA: {
    '07-01': 'Canada Day',
    '11-11': 'Remembrance Day',
    '12-24': 'Christmas Eve',
    '12-26': 'Boxing Day',
    '12-31': "New Year's Eve",
  },
  GB: {
    '12-24': 'Christmas Eve',
    '12-26': 'Boxing Day',
    '12-31': "New Year's Eve",
  },
  AU: {
    '01-26': 'Australia Day',
    '04-25': 'Anzac Day',
    '12-26': 'Boxing Day',
    '12-31': "New Year's Eve",
  },
  MX: {
    '02-05': 'Constitution Day',
    '09-16': 'Independence Day',
    '11-20': 'Revolution Day',
    '12-24': 'Nochebuena',
    '12-31': "New Year's Eve",
  },
};

/**
 * Check if a date matches a known holiday for the given country.
 * Uses static computation (no API calls) for well-known holidays.
 * @param {string} dateStr - Date in YYYY-MM-DD format (local date)
 * @param {string} countryCode - ISO 3166-1 alpha-2 code (e.g., 'US', 'GB', 'CA')
 * @returns {{ holiday: string, is_holiday: boolean } | null}
 */
function detectStaticHoliday(dateStr, countryCode = null) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const dateMs = Date.UTC(year, month - 1, day);
  const mmdd = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // 2026-07-06: no 'US' default — unknown country means only global holidays
  // and Easter can be statically confirmed (never a guessed nationality)
  const cc = countryCode ? countryCode.toUpperCase() : null;

  // === GLOBAL FIXED-DATE HOLIDAYS ===
  if (GLOBAL_FIXED_HOLIDAYS[mmdd]) {
    return { holiday: GLOBAL_FIXED_HOLIDAYS[mmdd], is_holiday: true };
  }

  // === COUNTRY-SPECIFIC FIXED-DATE HOLIDAYS ===
  const countryHolidays = (cc && COUNTRY_FIXED_HOLIDAYS[cc]) || {};
  if (countryHolidays[mmdd]) {
    return { holiday: countryHolidays[mmdd], is_holiday: true };
  }

  // === EASTER WEEKEND (universal — observed worldwide) ===
  const easter = computeEasterSunday(year);
  const easterMs = easter.getTime();
  const dayMs = 86400000;

  if (dateMs === easterMs - 2 * dayMs) return { holiday: 'Good Friday', is_holiday: true };
  if (dateMs === easterMs - dayMs) return { holiday: 'Holy Saturday (Easter Weekend)', is_holiday: true };
  if (dateMs === easterMs) return { holiday: 'Easter Sunday', is_holiday: true };
  if (dateMs === easterMs + dayMs) return { holiday: 'Easter Monday', is_holiday: true };

  // === MOVABLE US-SPECIFIC HOLIDAYS ===
  if (cc === 'US') {
    const movable = [
      { date: nthWeekdayOfMonth(year, 0, 1, 3), name: 'Martin Luther King Jr. Day' },
      { date: nthWeekdayOfMonth(year, 1, 1, 3), name: "Presidents' Day" },
      { date: lastWeekdayOfMonth(year, 4, 1), name: 'Memorial Day' },
      { date: nthWeekdayOfMonth(year, 8, 1, 1), name: 'Labor Day' },
      { date: nthWeekdayOfMonth(year, 9, 1, 2), name: "Indigenous Peoples' Day" },
    ];

    for (const { date, name } of movable) {
      if (dateMs === date.getTime()) return { holiday: name, is_holiday: true };
    }

    // Thanksgiving: 4th Thursday in November + Black Friday
    const thanksgiving = nthWeekdayOfMonth(year, 10, 4, 4);
    if (dateMs === thanksgiving.getTime()) return { holiday: 'Thanksgiving Day', is_holiday: true };
    if (dateMs === thanksgiving.getTime() + dayMs) return { holiday: 'Black Friday', is_holiday: true };

    // Super Bowl Sunday: 1st Sunday in February
    const superBowl = nthWeekdayOfMonth(year, 1, 0, 1);
    if (dateMs === superBowl.getTime()) return { holiday: 'Super Bowl Sunday', is_holiday: true };
  }

  // === MOVABLE CA-SPECIFIC HOLIDAYS ===
  if (cc === 'CA') {
    // Thanksgiving: 2nd Monday in October
    const caThanksgiving = nthWeekdayOfMonth(year, 9, 1, 2);
    if (dateMs === caThanksgiving.getTime()) return { holiday: 'Thanksgiving Day', is_holiday: true };
    // Victoria Day: Last Monday before May 25
    const may25 = Date.UTC(year, 4, 25);
    const may25Date = new Date(may25);
    const daysBefore = (may25Date.getUTCDay() + 6) % 7 || 7; // Monday before May 25
    if (dateMs === may25 - daysBefore * dayMs) return { holiday: 'Victoria Day', is_holiday: true };
  }

  // === MOVABLE GB-SPECIFIC HOLIDAYS ===
  if (cc === 'GB') {
    // Early May bank holiday: 1st Monday in May
    const earlyMay = nthWeekdayOfMonth(year, 4, 1, 1);
    if (dateMs === earlyMay.getTime()) return { holiday: 'Early May Bank Holiday', is_holiday: true };
    // Spring bank holiday: Last Monday in May
    const springBank = lastWeekdayOfMonth(year, 4, 1);
    if (dateMs === springBank.getTime()) return { holiday: 'Spring Bank Holiday', is_holiday: true };
    // Summer bank holiday: Last Monday in August
    const summerBank = lastWeekdayOfMonth(year, 7, 1);
    if (dateMs === summerBank.getTime()) return { holiday: 'Summer Bank Holiday', is_holiday: true };
  }

  return null; // Not a known static holiday
}

/**
 * Detect holiday for a given date/location using the BRIEFING_HOLIDAY role.
 * Pass everything the snapshot has resolved so far — richer location context
 * grounds the search better for a global app.
 * @param {Object} context - { created_at, city, state, country, timezone,
 *                             formattedAddress?, lat?, lng? }
 * @returns {Promise<{ holiday: string, is_holiday: boolean }>} holiday is 'none' (verified) or holiday name
 * @throws {HolidayDetectionError} on any detection failure (no fallbacks)
 */
export async function detectHoliday(context) {
  // 2026-07-06: timezone is REQUIRED (GPS coords → Google Timezone API).
  // Without it the "local date" is a guess, and holidays land on wrong days.
  if (!context?.timezone) {
    throw new HolidayDetectionError(
      'timezone is required (GPS-resolved IANA zone) — holiday is a required snapshot field'
    );
  }

  const checkDate = context.created_at ? new Date(context.created_at) : new Date();

  // L1 Cache Check - before any API calls
  // Updated 2026-01-05: Reduces redundant BRIEFING_HOLIDAY model calls
  // 2026-02-17: FIX - Pass timezone for local-date-aware cache key
  const cacheKey = getHolidayCacheKey(checkDate, context.city, context.country, context.timezone);
  const cached = getFromHolidayCache(cacheKey);
  if (cached) {
    return cached;
  }

  // Check for holiday override first (explicit human config — throws if corrupt)
  const override = getHolidayOverride(checkDate);

  // If override exists and is NOT superseded by actual holidays, return immediately
  if (override && !override.superseded_by_actual) {
    return { holiday: override.holiday, is_holiday: true };
  }

  // 2026-04-05: Static holiday detection — zero cost, zero latency, 100% reliable
  // Runs BEFORE any API call. Covers US federal holidays, Easter, Thanksgiving,
  // and major holidays for CA, GB, AU, MX. Uses snapshot's country field —
  // 2026-07-06: no 'US' default; unknown country limits static detection to
  // global holidays + Easter (truthful, not a guessed nationality).
  {
    const localDateStr = getLocalDateString(checkDate, context.timezone);
    const staticResult = detectStaticHoliday(localDateStr, context.country || null);
    if (staticResult) {
      console.log(`[BRIEFING] [HOLIDAY] 📅 Static detection: ${staticResult.holiday} (${localDateStr}, ${context.country || 'no-country'})`);
      setHolidayCache(cacheKey, staticResult);
      return staticResult;
    }
  }

  // 2026-07-06 (Melody): model-agnostic — no vendor env-key gate here. The
  // BRIEFING_HOLIDAY role is dispatched by the callModel adapter, which owns
  // provider auth; if the role's provider is unconfigured the call fails and
  // we throw below with the ROLE name, never a vendor name.

  // Format date for the user's specific timezone (validated above — no fallback)
  const utcTime = new Date(context.created_at || new Date());
  const formattedDate = new Intl.DateTimeFormat('en-US', {
    timeZone: context.timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(utcTime);

  // 2. Strict JSON Prompt
  // 2026-07-06: asks about observed dates and holiday WEEKENDS too — on
  // July 5 after a Saturday July 4, drivers still see holiday demand and the
  // header should greet "Independence Day Weekend", not silently show nothing.
  // 2026-07-06 (Melody): model-agnostic ("web search", not a vendor's search
  // product — the registry wires whichever search tool the role's provider
  // has) and GLOBAL (country-relative criteria, no US-only examples). Location
  // grounding uses the richest snapshot fields available: formatted address
  // and 6-decimal GPS coords beat "city, state" everywhere outside the US.
  const locationParts = [];
  if (context.formattedAddress) {
    locationParts.push(context.formattedAddress);
  } else {
    const cityLine = [context.city, context.state, context.country].filter(Boolean).join(', ');
    if (cityLine) locationParts.push(cityLine);
  }
  const latNum = Number(context.lat);
  const lngNum = Number(context.lng);
  if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
    locationParts.push(`(GPS: ${latNum.toFixed(6)}, ${lngNum.toFixed(6)})`);
  }
  const locationDescriptor = locationParts.join(' ');
  if (!locationDescriptor) {
    throw new HolidayDetectionError('no location context provided (need formattedAddress, city, or coords from the snapshot)');
  }

  const prompt = `Use web search to determine if ${formattedDate} is a significant holiday, an observed holiday date, or part of a major holiday weekend for this location: ${locationDescriptor}.

  CRITERIA for "Significant" (relative to that location's country/region):
  - National/public holidays of that country or region
  - OBSERVED dates when such a holiday falls on a weekend
  - The surrounding holiday WEEKEND of a major holiday (e.g. the Sunday after a Saturday national day → "<Holiday> Weekend")
  - Major religious observances (e.g. Easter, Eid, Diwali, Yom Kippur, Lunar New Year)
  - Major cultural events affecting that city's traffic/business (e.g. Carnival, Mardi Gras, Oktoberfest)

  EXCLUDE:
  - Minor awareness days (e.g. Pizza Day, Siblings Day)
  - Time changes (e.g. Daylight Savings)

  NAMING: use the holiday's common English name; for weekend/observed continuation days, append "Weekend" or "(Observed)" so greetings read naturally (e.g. "Independence Day Weekend").

  RETURN ONLY JSON:
  {
    "is_holiday": boolean,
    "name": "Holiday Name" or null,
    "type": "federal" | "religious" | "cultural" | "none"
  }`;

  try {
    // 2026-02-13: Uses BRIEFING_HOLIDAY role via callModel adapter (hedged router + fallback)
    // Model/params come from the registry entry for BRIEFING_HOLIDAY (model-registry.js) — never named here
    const response = await callModel('BRIEFING_HOLIDAY', {
      user: prompt
    });

    if (!response.ok) {
      console.error(`[BRIEFING] [HOLIDAY] BRIEFING_HOLIDAY role error: ${response.error}`);
      // Explicit override config still satisfies the requirement; otherwise
      // an API failure must surface — never silently stored as 'none'.
      if (override) {
        return { holiday: override.holiday, is_holiday: true };
      }
      throw new HolidayDetectionError(`BRIEFING_HOLIDAY model call failed: ${response.error}`);
    }

    const text = response.output;

    if (!text) {
      console.warn('[BRIEFING] [HOLIDAY] Empty response from BRIEFING_HOLIDAY role');
      if (override) {
        return { holiday: override.holiday, is_holiday: true };
      }
      throw new HolidayDetectionError('empty response from BRIEFING_HOLIDAY model');
    }

    // 4. Parse Strict JSON
    try {
      const parsed = JSON.parse(text);

      const isHoliday = parsed.is_holiday === true;
      const holidayName = isHoliday ? parsed.name : 'none';

      console.log(`[BRIEFING] [HOLIDAY] 📅 ${formattedDate}: ${holidayName} (Is Holiday: ${isHoliday})`);

      // If an actual holiday is detected, it supersedes the override
      if (isHoliday) {
        console.log(`[BRIEFING] [HOLIDAY] 🎉 Actual holiday "${holidayName}" supersedes any override`);
        const result = { holiday: holidayName, is_holiday: true };
        setHolidayCache(cacheKey, result); // Cache successful API result
        return result;
      }

      // No actual holiday detected - use override if available
      if (override) {
        console.log(`[BRIEFING] [HOLIDAY] 📌 No actual holiday, using override: "${override.holiday}"`);
        const result = { holiday: override.holiday, is_holiday: true };
        setHolidayCache(cacheKey, result); // Cache override result
        return result;
      }

      const result = { holiday: 'none', is_holiday: false };
      setHolidayCache(cacheKey, result); // Cache no-holiday result
      return result;
    } catch (parseErr) {
      console.error('[BRIEFING] [HOLIDAY] JSON Parse Failed:', parseErr.message, 'Raw:', text.substring(0, 100));
      if (override) {
        return { holiday: override.holiday, is_holiday: true };
      }
      throw new HolidayDetectionError(`unparseable model response: ${parseErr.message}`);
    }

  } catch (error) {
    if (error instanceof HolidayDetectionError) throw error;
    console.error('[BRIEFING] [HOLIDAY] Network/System Error:', error.message);
    if (override) {
      return { holiday: override.holiday, is_holiday: true };
    }
    throw new HolidayDetectionError(`network/system error: ${error.message}`);
  }
}
