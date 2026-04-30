// server/lib/location/resolveTimezone.js
// ============================================================================
// SHARED TIMEZONE RESOLUTION MODULE
// ============================================================================
//
// 2026-02-17: Extracted from location.js (private lookupMarketTimezone) and
// geocode.js (getTimezoneForCoords) into a shared module.
//
// Pattern: Same as geocodeEvent.js — simple exports, multiple consumers.
//
// Source of truth: markets.timezone (102 global markets, IANA format)
// Fallback: Google Timezone API (for locations not in any known market)
//
// Consumers:
//   - location.js — snapshot timezone resolution
//   - venue-cache.js — venue timezone on creation
//   - backfill-timezone.js — one-time migration script
// ============================================================================

import { db } from '../../db/drizzle.js';
import { markets } from '../../../shared/schema.js';
import { sql } from 'drizzle-orm';
import { locationLog, OP } from '../../logger/workflow.js';
import { getTimezoneForCoords } from './geocode.js';

/**
 * Resolve timezone for a city/state by looking up the markets table.
 * Uses 4 progressive strategies:
 *   1. primary_city + state exact match
 *   2. city_aliases JSONB + state
 *   3. primary_city only (international city-states)
 *   4. city_aliases only (international suburbs)
 *
 * Returns market metadata alongside timezone so callers can also set
 * market_slug and market_name without a second query.
 *
 * @param {string} city
 * @param {string} [state]
 * @param {string} [country]
 * @returns {Promise<{timezone: string, market_slug: string, market_name: string} | null>}
 */
export async function resolveTimezoneFromMarket(city, state, country) {
  if (!city) return null;

  try {
    // Strategy 1: Exact match on primary_city + state (best for US markets)
    // 2026-02-17: FIX - Also match state_abbr since snapshots use 'TX' not 'Texas'
    if (state) {
      const isAbbr = state.length <= 3; // 'TX', 'AL', 'PR'
      const stateQuery = isAbbr
        ? sql`(${markets.state} = ${state} OR ${markets.state_abbr} = ${state.toUpperCase()}) AND ${markets.is_active} = true`
        : sql`${markets.state} = ${state} AND ${markets.is_active} = true`;

      const [market] = await db
        .select({ timezone: markets.timezone, market_slug: markets.market_slug, market_name: markets.market_name })
        .from(markets)
        .where(sql`${markets.primary_city} = ${city} AND ${stateQuery}`)
        .limit(1);

      if (market) {
        locationLog.done(2, `Market timezone hit: ${market.market_name} → ${market.timezone}`, OP.DB);
        return market;
      }

      // Strategy 2: City aliases + state
      const aliasResult = await db
        .select({ timezone: markets.timezone, market_slug: markets.market_slug, market_name: markets.market_name })
        .from(markets)
        .where(sql`${markets.city_aliases} @> ${JSON.stringify([city])}::jsonb AND ${stateQuery}`)
        .limit(1);

      if (aliasResult.length > 0) {
        locationLog.done(2, `Market timezone hit (alias): ${aliasResult[0].market_name} → ${aliasResult[0].timezone}`, OP.DB);
        return aliasResult[0];
      }
    }

    // Strategy 3: Match by primary_city + country (prevents cross-country collisions)
    // 2026-02-17: FIX - Added country_code filter. Without it, "Birmingham" (AL) could
    // match "Birmingham" (UK) — the "Birmingham Paradox". Uses country if provided,
    // otherwise defaults to 'US' since this app primarily serves US markets.
    const countryFilter = country
      ? sql`AND ${markets.country_code} = ${country}`
      : sql`AND ${markets.country_code} = 'US'`;

    const [cityOnlyMarket] = await db
      .select({ timezone: markets.timezone, market_slug: markets.market_slug, market_name: markets.market_name })
      .from(markets)
      .where(sql`${markets.primary_city} = ${city} AND ${markets.is_active} = true ${countryFilter}`)
      .limit(1);

    if (cityOnlyMarket) {
      locationLog.done(2, `Market timezone hit (city+country): ${cityOnlyMarket.market_name} → ${cityOnlyMarket.timezone}`, OP.DB);
      return cityOnlyMarket;
    }

    // Strategy 4: City aliases + country (for international suburbs)
    const aliasOnlyResult = await db
      .select({ timezone: markets.timezone, market_slug: markets.market_slug, market_name: markets.market_name })
      .from(markets)
      .where(sql`${markets.city_aliases} @> ${JSON.stringify([city])}::jsonb AND ${markets.is_active} = true ${countryFilter}`)
      .limit(1);

    if (aliasOnlyResult.length > 0) {
      locationLog.done(2, `Market timezone hit (alias+country): ${aliasOnlyResult[0].market_name} → ${aliasOnlyResult[0].timezone}`, OP.DB);
      return aliasOnlyResult[0];
    }

    return null;
  } catch (err) {
    console.warn('[resolveTimezone] Market lookup failed:', err.message);
    return null;
  }
}

/**
 * Resolve timezone for coordinates via Google Timezone API.
 * This is the SLOW PATH fallback when market lookup misses (~200-300ms).
 *
 * Wraps getTimezoneForCoords from geocode.js for consistent API.
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Promise<string | null>} IANA timezone string (e.g., "America/Chicago")
 */
export async function resolveTimezoneFromCoords(lat, lng) {
  return getTimezoneForCoords(lat, lng);
}

/**
 * Full timezone resolution: market-first, Google Timezone API fallback.
 * Returns timezone + market info if resolved from market.
 *
 * @param {Object} location
 * @param {string} location.city - City name
 * @param {string} [location.state] - State/province
 * @param {string} [location.country] - Country code
 * @param {number} location.lat - Latitude (for Google API fallback)
 * @param {number} location.lng - Longitude (for Google API fallback)
 * @returns {Promise<{timezone: string, market_slug?: string, market_name?: string, source: 'market' | 'google_api'}>}
 * @throws {Error} If timezone cannot be resolved (NO FALLBACKS)
 */
export async function resolveTimezone({ city, state, country, lat, lng }) {
  // Fast path: market lookup (no API call, ~5ms)
  const marketResult = await resolveTimezoneFromMarket(city, state, country);
  if (marketResult) {
    return {
      timezone: marketResult.timezone,
      market_slug: marketResult.market_slug,
      market_name: marketResult.market_name,
      source: 'market'
    };
  }

  // Slow path: Google Timezone API (~200-300ms)
  const timezone = await resolveTimezoneFromCoords(lat, lng);
  if (timezone) {
    return { timezone, source: 'google_api' };
  }

  // NO FALLBACKS — timezone is required
  throw new Error(`Cannot resolve timezone for ${city}, ${state} (${lat}, ${lng}) — NO FALLBACKS`);
}
