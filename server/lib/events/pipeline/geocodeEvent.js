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
 * Geocode a single event address via Google Geocoding API.
 *
 * @param {string} address - Venue name or street address to geocode
 * @param {string} city - City name
 * @param {string} state - State code (e.g. 'TX')
 * @returns {Promise<{lat: number, lng: number, place_id: string, formatted_address: string, address_components: Array}|null>}
 */
export async function geocodeEventAddress(address, city, state) {
  if (!address || !GOOGLE_MAPS_API_KEY) return null;

  try {
    const fullAddress = [address, city, state].filter(Boolean).join(', ');

    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', fullAddress);
    url.searchParams.set('key', GOOGLE_MAPS_API_KEY);

    const response = await fetch(url.toString());
    if (!response.ok) return null;

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
        address_components: result.address_components
      };
    }
    return null;
  } catch (_err) {
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
  const eventsNeedingGeocode = events.filter(e => !e.lat || !e.lng);

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
