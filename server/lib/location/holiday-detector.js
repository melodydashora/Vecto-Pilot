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
 * @param {Date} date - The date to check
 * @param {string} city - City name
 * @param {string} country - Country code
 * @returns {string} Cache key
 */
function getHolidayCacheKey(date, city, country) {
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
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

// @ts-ignore
import { callGemini } from '../ai/adapters/gemini-adapter.js';

/**
 * Detect holiday for a given date/location using BRIEFING_HOLIDAY role
 * @param {Object} context - { created_at, city, state, country, timezone }
 * @returns {Promise<{ holiday: string, is_holiday: boolean }>} holiday is 'none' or holiday name
 */
export async function detectHoliday(context) {
  const checkDate = context.created_at ? new Date(context.created_at) : new Date();

  // L1 Cache Check - before any API calls
  // Updated 2026-01-05: Reduces redundant Gemini API calls
  const cacheKey = getHolidayCacheKey(checkDate, context.city, context.country || 'us');
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
    // 3. Call Gemini via Adapter
    const response = await callGemini({
      model: 'gemini-3-pro-preview',
      user: prompt,
      maxTokens: 1024,
      temperature: 0.1,
      useSearch: true,
      thinkingLevel: "HIGH"
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
