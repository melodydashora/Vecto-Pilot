// server/lib/location/geocode.js
// Google Geocoding API utility for converting addresses to coordinates

import { normalizeCoordinates } from '../../../shared/coordinates.js';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GEOCODE_API_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

/**
 * Geocode an address to get lat/lng coordinates
 * @param {Object} address - Address components
 * @param {string} address.address1 - Street address line 1
 * @param {string} [address.address2] - Street address line 2
 * @param {string} address.city - City
 * @param {string} address.stateTerritory - State/Province
 * @param {string} [address.zipCode] - ZIP/Postal code
 * @param {string} [address.country] - Country (default: US)
 * @returns {Promise<{lat: number, lng: number, formattedAddress: string, timezone: string} | null>}
 */
export async function geocodeAddress(address) {
  if (!GOOGLE_MAPS_API_KEY) {
    console.warn('[LOCATION] [GEOCODE] Google Maps API key not configured');
    return null;
  }

  // Build the address string
  const addressParts = [
    address.address1,
    address.address2,
    address.city,
    address.stateTerritory,
    address.zipCode,
    address.country || 'US'
  ].filter(Boolean);

  const addressString = addressParts.join(', ');

  try {
    // Call Google Geocoding API
    const geocodeUrl = `${GEOCODE_API_URL}?address=${encodeURIComponent(addressString)}&key=${GOOGLE_MAPS_API_KEY}`;
    const response = await fetch(geocodeUrl);

    if (!response.ok) {
      console.error('[LOCATION] [GEOCODE] API request failed:', response.status);
      return null;
    }

    const data = await response.json();

    if (data.status !== 'OK' || !data.results || data.results.length === 0) {
      console.warn('[LOCATION] [GEOCODE] No results; provider status:', data.status);
      return null;
    }

    const result = data.results[0];
    const { lat, lng } = result.geometry.location;
    const formattedAddress = result.formatted_address;

    // Get timezone for the coordinates
    const timezone = await getTimezoneForCoords(lat, lng);

    console.log('[LOCATION] [GEOCODE] Address resolved by provider');

    return {
      lat,
      lng,
      formattedAddress,
      timezone
    };
  } catch (error) {
    console.error('[LOCATION] [GEOCODE] Failed to geocode address:', error.message);
    return null;
  }
}

/**
 * Get timezone for coordinates using Google Time Zone API
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<string | null>} IANA timezone string
 */
export async function getTimezoneForCoords(lat, lng, opts = {}) {
  try { return (await getTimezoneDataForCoords(lat, lng, opts)).timeZoneId; }
  catch (error) {
    console.warn('[LOCATION] Google timezone unavailable:', error.message);
    return null;
  }
}

/** One Google Time Zone transport and validation boundary for all pipelines. */
export async function getTimezoneDataForCoords(lat, lng, { signal, fetchImpl = fetch, now = Date.now } = {}) {
  const coords = normalizeCoordinates(lat, lng);
  if (!coords) throw new Error('Timezone requires valid coordinates');
  if (!GOOGLE_MAPS_API_KEY) throw new Error('Google location provider is not configured');
  const url = new URL('https://maps.googleapis.com/maps/api/timezone/json');
  url.searchParams.set('location', coords.lat + ',' + coords.lng);
  url.searchParams.set('timestamp', String(Math.floor(now() / 1000)));
  url.searchParams.set('key', GOOGLE_MAPS_API_KEY);
  const requestSignal = signal ?? AbortSignal.timeout(8000);
  requestSignal.throwIfAborted();
  const response = await fetchImpl(url, { signal: requestSignal });
  if (!response.ok) throw new Error('Google timezone provider returned HTTP ' + response.status);
  const data = await response.json();
  requestSignal.throwIfAborted();
  if (data.status !== 'OK') throw new Error('Google timezone provider returned ' + (data.status || 'missing status'));
  if (typeof data.timeZoneId !== 'string' || !data.timeZoneId.trim()) throw new Error('Google timezone response is missing timeZoneId');
  try { new Intl.DateTimeFormat('en', { timeZone: data.timeZoneId }); }
  catch { throw new Error('Google timezone response is invalid'); }
  return { timeZoneId: data.timeZoneId, timeZoneName: data.timeZoneName };
}

// Venue address resolution and a fresh driver snapshot have different owners.
// They share provider address parsing below; neither can replace the other's GPS.

// Helper to extract city, state, country from Google Geocoding response
// 2026-01-10: D-011 Fix - Use short_name for country to get ISO 3166-1 alpha-2 codes (US, CA, GB)
// instead of long_name which returns full names (United States, Canada, United Kingdom)
export function pickAddressParts(components) {
  let city;
  let state;
  let country;
  // 2026-02-01: Fallback components for locations without "locality" (rural areas, etc.)
  let sublocality;
  let neighborhood;
  let adminLevel2; // County

  for (const c of components || []) {
    const types = c.types || [];
    if (types.includes("locality")) city = c.long_name;
    if (types.includes("sublocality") || types.includes("sublocality_level_1")) sublocality = c.long_name;
    if (types.includes("neighborhood")) neighborhood = c.long_name;
    if (types.includes("administrative_area_level_2")) adminLevel2 = c.long_name;
    if (types.includes("administrative_area_level_1")) state = c.short_name;
    // 2026-01-10: D-011 Fix - short_name gives ISO alpha-2 code (US), long_name gave "United States"
    if (types.includes("country")) country = c.short_name;
  }

  // 2026-02-01: Fallback chain for city - prevents "undefined, undefined" display
  // Priority: locality > sublocality > neighborhood > county
  if (!city) {
    city = sublocality || neighborhood || adminLevel2;
    if (city) {
      console.log('[LOCATION] Using a fallback address component (no locality found)');
    }
  }

  return { city, state, country };
}


export function pickBestGeocodeResult(results) {
  if (!results || results.length === 0) return null;

  // Filter out Plus Codes (format: "XXXX+XX" like "35WJ+64") and prefer street addresses
  const streetAddress = results.find(result => {
    const addr = result.formatted_address || '';
    // Skip Plus Codes - they start with alphanumeric pattern like "35WJ+64"
    if (/^[A-Z0-9]{4}\+[A-Z0-9]{2,}/.test(addr)) {
      console.log('[LOCATION] Skipping Plus Code result in favor of a street address');
      return false;
    }
    // Prefer street_address, premise, route, or establishment types
    const preferredTypes = ['street_address', 'premise', 'route', 'establishment', 'point_of_interest'];
    return result.types?.some(type => preferredTypes.includes(type));
  });

  // Fall back to first result if no street address found
  const best = streetAddress || results[0];

  // 2026-09-10: the driver's street address is not log content (agreement §15.8; the log
  // tail is readable by operators, and was readable by every driver — security finding [2]).
  if (streetAddress) {
    console.log('[LOCATION] Selected a provider street-address result');
  } else {
    console.log(`[LOCATION] Using fallback geocode result (no street address found; types=${(best.types || []).join('|') || 'n/a'})`);
  }

  return best;
}

/** Fresh deterministic GPS context. Neither coordinate cache nor model output supplies required values. */
export async function resolveFreshGpsLocation(lat, lng, { fetchImpl = fetch, now = Date.now } = {}) {
  if (!GOOGLE_MAPS_API_KEY) throw new Error('Google location provider is not configured');
  const request = async (path, params) => {
    const url = new URL(path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    url.searchParams.set('key', GOOGLE_MAPS_API_KEY);
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error('Google location provider returned HTTP ' + response.status);
    const data = await response.json();
    if (data.status !== 'OK') throw new Error('Google location provider returned ' + (data.status || 'missing status'));
    return data;
  };
  const data = await request(GEOCODE_API_URL, { latlng: lat + ',' + lng });
  const best = pickBestGeocodeResult(data.results);
  const parts = pickAddressParts(best?.address_components);
  const formattedAddress = best?.formatted_address;
  if (!parts.city || !parts.state || !parts.country || !formattedAddress?.trim()) {
    throw new Error('Google reverse geocoding is incomplete: city, state, country and full address are required');
  }
  const zone = await getTimezoneDataForCoords(lat, lng, { fetchImpl, now });
  return { ...parts, formattedAddress, timeZone: zone.timeZoneId };
}
