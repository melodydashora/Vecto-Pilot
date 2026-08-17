/**
 * Event Geocoding — ETL Phase 3: TRANSFORM-B
 *
 * Forward-geocodes event addresses via Google Geocoding API.
 * Returns lat/lng + place_id + formatted_address for venue identification.
 *
 * Shared module used by briefing-service.js (per-snapshot Gemini pipeline).
 *
 * Why not reuse server/lib/location/geocode.js?
 *   - That module takes structured {address1, stateTerritory} objects
 *   - Calls Timezone API (unnecessary overhead for event geocoding)
 *   - Does NOT return place_id (critical for venue identification)
 *
 * @module server/lib/events/pipeline/geocodeEvent
 */

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

/**
 * Build a Geocoding-API `bounds` viewport (SW|NE corners) around a point.
 * Google treats `bounds` as a BIAS, never a restriction: an unambiguous address
 * ("Colfax Ave & Broadway, Denver") still resolves where it truly is; only an
 * ambiguous one ("Terminal B", "Main St & 1st Ave") is pulled toward the box.
 * Pure geometry, exported for tests.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusMi - half-width of the box, in miles
 * @returns {string|null} "swLat,swLng|neLat,neLng" or null when the point is unusable
 */
export function viewportBounds(lat, lng, radiusMi) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusMi) || !(radiusMi > 0)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const dLat = radiusMi / 69.0; // ~69 mi per degree of latitude
  if (dLat >= 45) return null; // a box wider than a hemisphere is not a bias (also rejects absurd radii)
  const cosLat = Math.cos((lat * Math.PI) / 180);
  if (cosLat < 0.05) return null; // polar: a longitude box is meaningless there
  const dLng = radiusMi / (69.17 * cosLat);
  if (dLng >= 180) return null;
  const clampLat = (v) => Math.max(-90, Math.min(90, v));
  const wrapLng = (v) => ((((v + 180) % 360) + 360) % 360) - 180; // SW lng > NE lng = box crosses the antimeridian (Google accepts)
  const f = (v) => v.toFixed(6);
  return `${f(clampLat(lat - dLat))},${f(wrapLng(lng - dLng))}|${f(clampLat(lat + dLat))},${f(wrapLng(lng + dLng))}`;
}

/**
 * Geocode a single event address via Google Geocoding API.
 *
 * @param {string} address - Venue name or street address to geocode
 * @param {string} [city] - City name
 * @param {string} [state] - State code (e.g. 'TX')
 * @param {{bias?: {lat: number, lng: number, radius_mi?: number}, signal?: AbortSignal}} [opts]
 *   bias — 2026-08-17: optional viewport bias (Geocoding `bounds`, see viewportBounds).
 *   Used by the Offer Analyzer, whose card addresses are often city-less
 *   ("Terminal B, Departures: Zone 14"): biasing toward the driver's GPS / last
 *   snapshot makes Google prefer the nearby match. Bias only — never a restriction.
 *   signal — optional AbortSignal (e.g. AbortSignal.timeout(ms)) so a hung Google request
 *   cannot stall the caller; the Offer Analyzer bounds each call this way.
 *   Existing callers pass nothing and are unchanged.
 * @returns {Promise<{lat: number, lng: number, place_id: string, formatted_address: string, address_components: Array, partial_match: boolean, location_type: string|null, types: string[]}|null>}
 */
export async function geocodeEventAddress(address, city, state, opts = {}) {
  if (!address || !GOOGLE_MAPS_API_KEY) return null;

  try {
    const fullAddress = [address, city, state].filter(Boolean).join(', ');

    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', fullAddress);
    const bounds = opts?.bias ? viewportBounds(opts.bias.lat, opts.bias.lng, opts.bias.radius_mi ?? 60) : null;
    if (bounds) url.searchParams.set('bounds', bounds);
    url.searchParams.set('key', GOOGLE_MAPS_API_KEY);

    const response = await fetch(url.toString(), opts?.signal ? { signal: opts.signal } : undefined);
    if (!response.ok) {
      // 2026-08-17: fail loud — a 4xx/5xx is not "no such address" (review finding).
      console.warn(`[GEOCODE] Geocoding API HTTP ${response.status} for "${fullAddress}"`);
      return null;
    }

    const data = await response.json();
    if (data.status === 'OK' && data.results?.[0]?.geometry?.location) {
      const result = data.results[0];
      const { lat, lng } = result.geometry.location;

      // 2026-01-10: Return full result — place_id enables venue identification
      return {
        lat,
        lng,
        place_id: result.place_id,
        formatted_address: result.formatted_address,
        address_components: result.address_components,
        // 2026-08-17: Google's own "I matched only part of this" flag — callers log it
        // so an inexact geocode is visible in the audit trail (never silently trusted).
        partial_match: result.partial_match === true,
        // ROOFTOP | RANGE_INTERPOLATED | GEOMETRIC_CENTER | APPROXIMATE — recorded as
        // provenance by the Offer Analyzer (a route/locality centroid is not a doorstep).
        location_type: result.geometry.location_type ?? null,
        types: Array.isArray(result.types) ? result.types : [],
      };
    }
    if (data.status && data.status !== 'ZERO_RESULTS') {
      // OVER_QUERY_LIMIT / REQUEST_DENIED / INVALID_REQUEST are outages, not misses.
      console.warn(`[GEOCODE] Geocoding API status ${data.status} for "${fullAddress}"${data.error_message ? `: ${data.error_message}` : ''}`);
    }
    return null;
  } catch (err) {
    console.warn(`[GEOCODE] Geocoding request failed for "${address}": ${err.message}`);
    return null;
  }
}

/**
 * Batch geocode events that are missing coordinates.
 * Processes in batches of 5 with 100ms inter-batch delay to avoid rate limits.
 * Mutates events in-place by adding lat, lng, and _geocoded_* fields.
 *
 * @param {Array<Object>} events - Events to geocode (requires venue_name or address, city, state)
 * @returns {Promise<Array<Object>>} Same array with coordinates populated where possible
 */
export async function geocodeMissingCoordinates(events) {
  const eventsNeedingGeocode = events.filter(e => !Number.isFinite(e.lat) || !Number.isFinite(e.lng));

  if (eventsNeedingGeocode.length === 0) {
    return events;
  }

  for (let i = 0; i < eventsNeedingGeocode.length; i += 5) {
    const batch = eventsNeedingGeocode.slice(i, i + 5);

    await Promise.all(batch.map(async (event) => {
      const searchQuery = event.venue_name || event.address;
      const geocodeResult = await geocodeEventAddress(searchQuery, event.city, event.state);

      if (geocodeResult) {
        event.lat = geocodeResult.lat;
        event.lng = geocodeResult.lng;

        if (geocodeResult.place_id) {
          event._geocoded_place_id = geocodeResult.place_id;
        }
        if (geocodeResult.formatted_address) {
          event._geocoded_formatted_address = geocodeResult.formatted_address;
        }
        if (geocodeResult.address_components) {
          event._geocoded_address_components = geocodeResult.address_components;
        }
      }
    }));

    // Rate limit: 100ms between batches
    if (i + 5 < eventsNeedingGeocode.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  return events;
}
