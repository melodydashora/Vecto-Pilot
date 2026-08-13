// server/lib/location/resolveTimezone.js
// ============================================================================
// MARKET IDENTITY LOOKUP + COORD-BASED TIMEZONE RESOLUTION
// ============================================================================
//
// 2026-02-17: Extracted from location.js (private lookupMarketTimezone) and
// geocode.js (getTimezoneForCoords) into a shared module.
//
// 2026-08-11: Header corrected — it previously declared "Source of truth:
// markets.timezone" with Google as fallback, the INVERSE of doctrine.
// DOCTRINE (app_rules gps-only-timezone, Melody-authored 2026-07-06):
// timezones ALWAYS come from GPS coords via the Google Timezone API — never
// a market's blanket timezone (markets can span zone borders; blanket tz
// corrupts open/closed math near them). Both consumers were fixed to comply
// on 2026-07-06:
//   - resolveTimezoneFromMarket() — used for market IDENTITY only
//     (market_slug / market_name). Its timezone field rides along in the
//     return shape but MUST NOT be stored as a snapshot/venue/profile tz.
//   - resolveTimezoneFromCoords() — the doctrine-compliant tz path
//     (GPS coords → Google Timezone API).
// The old market-first resolveTimezone() combinator had zero callers and was
// deleted the same day.
//
// Consumers:
//   - location.js — market identity for snapshots (tz comes from Google)
//   - venue-cache.js — venue tz from coords; market for slug only
//   - analyze-offer.js — driver tz from offer coords
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
        locationLog.done(2, `Market identity hit: ${market.market_name} (market tz ${market.timezone} — identity only, snapshot tz is GPS→Google)`, OP.DB);
        return market;
      }

      // Strategy 2: City aliases + state
      const aliasResult = await db
        .select({ timezone: markets.timezone, market_slug: markets.market_slug, market_name: markets.market_name })
        .from(markets)
        .where(sql`${markets.city_aliases} @> ${JSON.stringify([city])}::jsonb AND ${stateQuery}`)
        .limit(1);

      if (aliasResult.length > 0) {
        locationLog.done(2, `Market identity hit (alias): ${aliasResult[0].market_name} (market tz ${aliasResult[0].timezone} — identity only, snapshot tz is GPS→Google)`, OP.DB);
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
      locationLog.done(2, `Market identity hit (city+country): ${cityOnlyMarket.market_name} (market tz ${cityOnlyMarket.timezone} — identity only, snapshot tz is GPS→Google)`, OP.DB);
      return cityOnlyMarket;
    }

    // Strategy 4: City aliases + country (for international suburbs)
    const aliasOnlyResult = await db
      .select({ timezone: markets.timezone, market_slug: markets.market_slug, market_name: markets.market_name })
      .from(markets)
      .where(sql`${markets.city_aliases} @> ${JSON.stringify([city])}::jsonb AND ${markets.is_active} = true ${countryFilter}`)
      .limit(1);

    if (aliasOnlyResult.length > 0) {
      locationLog.done(2, `Market identity hit (alias+country): ${aliasOnlyResult[0].market_name} (market tz ${aliasOnlyResult[0].timezone} — identity only, snapshot tz is GPS→Google)`, OP.DB);
      return aliasOnlyResult[0];
    }

    return null;
  } catch (err) {
    console.warn('[resolveTimezone] Market lookup failed:', err.message);
    return null;
  }
}

/**
 * Resolve timezone for coordinates via Google Timezone API (~200-300ms).
 * THE doctrine-compliant timezone path: GPS coords → Google Timezone API
 * (app_rules gps-only-timezone). Not a fallback.
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

// 2026-08-11: deleted the market-first resolveTimezone() combinator (market tz
// with Google as "fallback" — the inverse of the gps-only-timezone rule). It
// had zero callers; both live consumers use the two explicit paths above.
