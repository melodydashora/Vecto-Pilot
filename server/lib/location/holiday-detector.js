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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// L1 CACHE - In-memory cache for holiday detection results
// Key: "YYYY-MM-DD|City|Country", Value: { result, expiresAt }
// TTL: 24 hours (86400000 ms)
// Updated 2026-01-05: Reduces redundant Gemini API calls
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
  // Use timezone-aware date to avoid UTC date mismatch
  const dateStr = timezone
    ? new Date(date.toLocaleString('en-US', { timeZone: timezone })).toLocaleDateString('en-CA') // YYYY-MM-DD
    : date.toISOString().split('T')[0]; // Fallback to UTC if no timezone
  return `${dateStr}|${city?.toLowerCase() || 'unknown'}|${country?.toLowerCase() || 'us'}`;
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

  console.log(`[holiday-detector] 🎯 Cache HIT: ${key}`);
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
  console.log(`[holiday-detector] 💾 Cache SET: ${key} (TTL: 24h)`);
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
    console.log(`[holiday-detector] 🧹 Cleaned ${cleaned} expired cache entries`);
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
    const configPath = join(__dirname, '../config/holiday-override.json');

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
    console.log(`[holiday-detector] 🎄 Override active: "${override.holiday_name}" (${override.id})`);

    return {
      holiday: override.holiday_name,
      is_holiday: true,
      superseded_by_actual: override.superseded_by_actual !== false // default true
    };
  } catch (error) {
    console.warn('[holiday-detector] Error reading override config:', error.message);
    return null;
  }
}

// 2026-02-13: Migrated from direct callGemini to callModel adapter (hedged router + fallback)
import { callModel } from '../ai/adapters/index.js';

// ============================================================================
// 2026-04-05: LOCAL STATIC HOLIDAY DETECTOR
// Runs BEFORE the Gemini API call — zero cost, zero latency, 100% reliable
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
function detectStaticHoliday(dateStr, countryCode = 'US') {
  const [year, month, day] = dateStr.split('-').map(Number);
  const dateMs = Date.UTC(year, month - 1, day);
  const mmdd = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const cc = (countryCode || 'US').toUpperCase();

  // === GLOBAL FIXED-DATE HOLIDAYS ===
  if (GLOBAL_FIXED_HOLIDAYS[mmdd]) {
    return { holiday: GLOBAL_FIXED_HOLIDAYS[mmdd], is_holiday: true };
  }

  // === COUNTRY-SPECIFIC FIXED-DATE HOLIDAYS ===
  const countryHolidays = COUNTRY_FIXED_HOLIDAYS[cc] || {};
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
 * Detect holiday for a given date/location using BRIEFING_HOLIDAY role
 * @param {Object} context - { created_at, city, state, country, timezone }
 * @returns {Promise<{ holiday: string, is_holiday: boolean }>} holiday is 'none' or holiday name
 */
export async function detectHoliday(context) {
  const checkDate = context.created_at ? new Date(context.created_at) : new Date();

  // L1 Cache Check - before any API calls
  // Updated 2026-01-05: Reduces redundant Gemini API calls
  // 2026-02-17: FIX - Pass timezone for local-date-aware cache key
  const cacheKey = getHolidayCacheKey(checkDate, context.city, context.country || 'us', context.timezone);
  const cached = getFromHolidayCache(cacheKey);
  if (cached) {
    return cached;
  }

  // Check for holiday override first
  const override = getHolidayOverride(checkDate);

  // If override exists and is NOT superseded by actual holidays, return immediately
  if (override && !override.superseded_by_actual) {
    return { holiday: override.holiday, is_holiday: true };
  }

  // 2026-04-05: Static holiday detection — zero cost, zero latency, 100% reliable
  // Runs BEFORE any API call. Covers US federal holidays, Easter, Thanksgiving,
  // and major holidays for CA, GB, AU, MX. Uses snapshot's country field.
  {
    const localDateStr = context.timezone
      ? new Date(checkDate.toLocaleString('en-US', { timeZone: context.timezone })).toLocaleDateString('en-CA')
      : checkDate.toISOString().split('T')[0];
    const countryCode = context.country || 'US';
    const staticResult = detectStaticHoliday(localDateStr, countryCode);
    if (staticResult) {
      console.log(`[holiday-detector] 📅 Static detection: ${staticResult.holiday} (${localDateStr}, ${countryCode})`);
      setHolidayCache(cacheKey, staticResult);
      return staticResult;
    }
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[holiday-detector] ⚠️ GEMINI_API_KEY not set - skipping holiday detection');
    // Use override if available when API key is missing
    if (override) {
      return { holiday: override.holiday, is_holiday: true };
    }
    return { holiday: 'none', is_holiday: false };
  }

  // 1. Format date for the user's specific timezone - NO FALLBACK
  let formattedDate;
  try {
    if (!context.timezone) {
      console.warn('[holiday-detector] Missing timezone - cannot accurately detect holidays');
      return { holiday: 'none', is_holiday: false, reason: 'timezone_missing' };
    }
    const utcTime = new Date(context.created_at || new Date());
    formattedDate = new Intl.DateTimeFormat('en-US', {
      timeZone: context.timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }).format(utcTime);
  } catch (e) {
    console.warn('[holiday-detector] Date formatting error:', e.message);
    formattedDate = new Date().toISOString();
  }

  // 2. Strict JSON Prompt
  const prompt = `Use Google Search to determine if ${formattedDate} is a significant holiday in ${context.city}, ${context.state}.

  CRITERIA for "Significant":
  - Federal/National holidays (e.g. Thanksgiving, Christmas, Memorial Day)
  - Major religious observances (e.g. Easter, Eid, Yom Kippur)
  - Major cultural events affecting traffic/business (e.g. Mardi Gras)

  EXCLUDE:
  - Minor awareness days (e.g. Pizza Day, Siblings Day)
  - Time changes (e.g. Daylight Savings)

  RETURN ONLY JSON:
  {
    "is_holiday": boolean,
    "name": "Holiday Name" or null,
    "type": "federal" | "religious" | "cultural" | "none"
  }`;

  try {
    // 2026-02-13: Uses BRIEFING_HOLIDAY role via callModel adapter (hedged router + fallback)
    // Registry config: gemini-3.1-pro-preview, thinkingLevel HIGH, google_search enabled
    const response = await callModel('BRIEFING_HOLIDAY', {
      user: prompt
    });

    if (!response.ok) {
      console.error(`[holiday-detector] Gemini API Error: ${response.error}`);
      // Fall back to override if API fails
      if (override) {
        return { holiday: override.holiday, is_holiday: true };
      }
      return { holiday: 'none', is_holiday: false };
    }

    const text = response.output;

    if (!text) {
      console.warn('[holiday-detector] Empty response from Gemini');
      // Fall back to override if no response
      if (override) {
        return { holiday: override.holiday, is_holiday: true };
      }
      return { holiday: 'none', is_holiday: false };
    }

    // 4. Parse Strict JSON
    try {
      const parsed = JSON.parse(text);

      const isHoliday = parsed.is_holiday === true;
      const holidayName = isHoliday ? parsed.name : 'none';

      console.log(`[holiday-detector] 📅 ${formattedDate}: ${holidayName} (Is Holiday: ${isHoliday})`);

      // If an actual holiday is detected, it supersedes the override
      if (isHoliday) {
        console.log(`[holiday-detector] 🎉 Actual holiday "${holidayName}" supersedes any override`);
        const result = { holiday: holidayName, is_holiday: true };
        setHolidayCache(cacheKey, result); // Cache successful API result
        return result;
      }

      // No actual holiday detected - use override if available
      if (override) {
        console.log(`[holiday-detector] 📌 No actual holiday, using override: "${override.holiday}"`);
        const result = { holiday: override.holiday, is_holiday: true };
        setHolidayCache(cacheKey, result); // Cache override result
        return result;
      }

      const result = { holiday: 'none', is_holiday: false };
      setHolidayCache(cacheKey, result); // Cache no-holiday result
      return result;
    } catch (parseErr) {
      console.error('[holiday-detector] JSON Parse Failed:', parseErr.message, 'Raw:', text.substring(0, 100));
      // Fall back to override on parse error
      if (override) {
        return { holiday: override.holiday, is_holiday: true };
      }
      return { holiday: 'none', is_holiday: false };
    }

  } catch (error) {
    console.error('[holiday-detector] Network/System Error:', error.message);
    // Fall back to override on network error
    if (override) {
      return { holiday: override.holiday, is_holiday: true };
    }
    return { holiday: 'none', is_holiday: false };
  }
}
