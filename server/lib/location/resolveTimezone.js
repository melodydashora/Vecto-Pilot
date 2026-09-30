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
//   - analyze-offer.js — offer tz from GPS coords, else from the geocoded pickup
//     address (first address on the card; 2026-08-17), else the snapshot row
//   - backfill-timezone.js — one-time migration script
// ============================================================================

import { db } from '../../db/drizzle.js';
import { markets, market_cities } from '../../../shared/schema.js';
import { sql } from 'drizzle-orm';
import { locationLog, OP } from '../../logger/workflow.js';
import { getTimezoneForCoords } from './geocode.js';

/**
 * Resolve market identity from provider-resolved address parts. The historical
 * export name and return shape remain compatible; its timezone is metadata only.
 * Explicit market_cities mappings allow a metro to span states without dropping
 * the driver's actual state/country. Missing or ambiguous identities stay null.
 */
export async function resolveTimezoneFromMarket(city, state, country) {
  const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
  const cityName = text(city);
  const stateName = text(state);
  const countryCode = text(country)?.toUpperCase();
  if (!cityName || (state != null && !stateName) || (country != null && !/^[A-Z]{2}$/.test(countryCode || ''))) return null;
  const identity = { timezone: markets.timezone, market_slug: markets.market_slug, market_name: markets.market_name };
  const countryFilter = countryCode ? sql`AND upper(${markets.country_code}) = ${countryCode}` : sql``;
  const stateFilter = table => stateName
    ? sql`AND (lower(${table.state}) = lower(${stateName}) OR lower(${table.state_abbr}) = lower(${stateName}))`
    : sql``;

  try {
    const mapped = await db.selectDistinct(identity).from(market_cities)
      .innerJoin(markets, sql`${market_cities.market_slug} = ${markets.market_slug}`)
      .where(sql`lower(${market_cities.city}) = lower(${cityName})
        AND upper(${market_cities.country_code}) = upper(${markets.country_code})
        AND ${markets.is_active} = true ${countryFilter} ${stateFilter(market_cities)}`)
      .limit(2);
    if (mapped.length) {
      if (mapped.length > 1) {
        locationLog.warn(2, 'Market identity mapping is ambiguous; current market remains unresolved', OP.DB);
        return null;
      }
      locationLog.done(2, 'Market identity resolved through a scoped city mapping', OP.DB);
      return mapped[0];
    }

    // Legacy markets without city mappings can still match their own scoped
    // primary city/aliases. Never discard a supplied state or invent a country.
    const matches = await db.selectDistinct(identity).from(markets)
      .where(sql`${markets.is_active} = true ${countryFilter} ${stateFilter(markets)}
        AND (lower(${markets.primary_city}) = lower(${cityName}) OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(${markets.city_aliases}) = 'array' THEN ${markets.city_aliases} ELSE '[]'::jsonb END
          ) AS alias(city) WHERE lower(alias.city) = lower(${cityName})
        ))`).limit(2);
    if (matches.length !== 1) {
      if (matches.length > 1) locationLog.warn(2, 'Market identity is ambiguous; current market remains unresolved', OP.DB);
      return null;
    }
    locationLog.done(2, 'Market identity resolved from a scoped primary city or alias', OP.DB);
    return matches[0];
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
 * @param {{signal?: AbortSignal}} [opts] - optional abort (2026-08-17; forwarded)
 * @returns {Promise<string | null>} IANA timezone string (e.g., "America/Chicago")
 */
export async function resolveTimezoneFromCoords(lat, lng, opts = {}) {
  return getTimezoneForCoords(lat, lng, opts);
}

// 2026-08-11: deleted the market-first resolveTimezone() combinator (market tz
// with Google as "fallback" — the inverse of the gps-only-timezone rule). It
// had zero callers; both live consumers use the two explicit paths above.
