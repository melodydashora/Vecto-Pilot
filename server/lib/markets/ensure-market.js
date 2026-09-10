// server/lib/markets/ensure-market.js
// 2026-09-10: ONE place that creates a driver-declared market (markets + market_cities).
//
// Why it exists (Astra product finding #16, verified): the signup page POSTed
// /api/intelligence/add-market BEFORE the account existed, and that endpoint sits
// behind requireAuth, so every "Other market" registration failed. Registration now
// creates the market itself (server/api/auth/auth.js) and the authenticated
// add-market route (SettingsPage) uses the same helper.
//
// Why no placeholder timezone: markets.timezone is NOT NULL and add-market used to
// write 'America/Chicago' "to be resolved later" — nothing ever resolved it
// (app_rules timezone-gps-only, no-hardcoded-location). The timezone comes from the
// Google Timezone API for the market's coordinates: the registering driver's
// geocoded home coordinates when available, else a geocode of "city, state".
// If neither resolves, this throws — callers decide whether that is fatal.

import { db } from '../../db/drizzle.js';
import { markets, market_cities } from '../../../shared/schema.js';
import { ilike } from 'drizzle-orm';
import { geocodeAddress } from '../location/geocode.js';
import { resolveTimezoneFromCoords } from '../location/resolveTimezone.js';

export function marketSlug(marketName, stateAbbr) {
  const base = String(marketName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return stateAbbr ? `${base}-${String(stateAbbr).toLowerCase()}` : base;
}

/**
 * @param {object} args
 * @param {string} args.market_name   driver-typed market name (≥ 2 chars)
 * @param {string} [args.city]        defaults to market_name
 * @param {string} [args.state]       full state/territory name
 * @param {string} [args.state_abbr]
 * @param {string} [args.country_code='US']
 * @param {number} [args.lat]         coordinates already known for this market (e.g. the driver's geocoded home)
 * @param {number} [args.lng]
 * @param {string} [args.source_ref='user_signup']
 * @returns {Promise<{already_existed: boolean, market_name: string, market_slug: string, timezone: string|null}>}
 */
export async function ensureMarket({ market_name, city, state, state_abbr, country_code = 'US', lat, lng, source_ref = 'user_signup' }) {
  const trimmedMarket = typeof market_name === 'string' ? market_name.trim() : '';
  if (trimmedMarket.length < 2) {
    const err = new Error('market_name is required (min 2 characters)');
    err.code = 'MARKET_NAME_INVALID';
    throw err;
  }

  const [existing] = await db.select().from(market_cities).where(ilike(market_cities.market_name, trimmedMarket)).limit(1);
  if (existing) {
    return { already_existed: true, market_name: existing.market_name, market_slug: existing.market_slug, timezone: null };
  }

  const cityName = (typeof city === 'string' && city.trim()) || trimmedMarket;
  const stateName = (typeof state === 'string' && state.trim()) || null;
  const stateAbbr = (typeof state_abbr === 'string' && state_abbr.trim()) || null;
  if (!stateName) {
    const err = new Error('state is required to create a market (no "Unknown" placeholders)');
    err.code = 'MARKET_STATE_REQUIRED';
    throw err;
  }

  let timezone = null;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    timezone = await resolveTimezoneFromCoords(lat, lng);
  }
  if (!timezone) {
    const geo = await geocodeAddress({ address1: '', address2: '', city: cityName, stateTerritory: stateName, zipCode: '', country: country_code });
    timezone = geo?.timezone || (Number.isFinite(geo?.lat) && Number.isFinite(geo?.lng) ? await resolveTimezoneFromCoords(geo.lat, geo.lng) : null);
  }
  if (!timezone) {
    const err = new Error(`market timezone could not be resolved for ${cityName}, ${stateName} — market not created`);
    err.code = 'MARKET_TIMEZONE_UNRESOLVED';
    throw err;
  }

  const slug = marketSlug(trimmedMarket, stateAbbr);
  await db.insert(markets).values({
    market_slug: slug,
    market_name: trimmedMarket,
    primary_city: cityName,
    state: stateName,
    state_abbr: stateAbbr,
    country_code,
    timezone,
    has_uber: true,
    has_lyft: true,
    is_active: true,
  }).onConflictDoNothing();
  await db.insert(market_cities).values({
    market_slug: slug,
    market_name: trimmedMarket,
    city: cityName,
    state: stateName,
    state_abbr: stateAbbr,
    country_code,
    region_type: 'Core',
    source_ref,
  }).onConflictDoNothing();

  return { already_existed: false, market_name: trimmedMarket, market_slug: slug, timezone };
}
