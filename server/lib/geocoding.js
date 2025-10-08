/**
 * GEOCODING API - Coordinate ⇄ Address Resolution
 * 
 * Purpose: Convert between coordinates and addresses, obtain place_id
 * Cost: Basic (lower rate than Places API)
 * 
 * Split of duties:
 * - Geocoding API: coords ⇄ address + place_id
 * - Places API: business metadata (hours, status) ONLY
 * - Routes API: distance/time calculations
 */

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

/**
 * Reverse geocode coordinates to get address and place_id
 * @param {Object} params
 * @param {number} params.lat - Latitude
 * @param {number} params.lng - Longitude
 * @param {string} [params.apiKey] - Google Maps API key
 * @returns {Promise<{place_id, formatted_address, lat, lng}>}
 */
export async function reverseGeocode({ lat, lng, apiKey = process.env.GOOGLE_MAPS_API_KEY }) {
  try {
    const url = new URL(GEOCODE_URL);
    url.searchParams.set('latlng', `${lat},${lng}`);
    url.searchParams.set('key', apiKey);

    const response = await fetch(url.toString());
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Geocoding API] Error ${response.status}: ${errorText}`);
      throw new Error(`Geocoding API failed: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.status !== 'OK') {
      throw new Error(`Geocoding API status: ${data.status}`);
    }

    const best = data.results?.[0];
    if (!best) {
      throw new Error('geocode_no_results');
    }

    console.log(`🗺️ [Geocoding] Reverse geocoded (${lat}, ${lng}) → place_id: ${best.place_id}, address: ${best.formatted_address}`);

    return {
      place_id: best.place_id,
      formatted_address: best.formatted_address,
      lat: best.geometry?.location?.lat || lat,
      lng: best.geometry?.location?.lng || lng
    };
  } catch (error) {
    console.error('[Geocoding API] reverseGeocode failed:', error.message);
    throw error;
  }
}

/**
 * Forward geocode address to get coordinates and place_id
 * @param {Object} params
 * @param {string} params.address - Address string
 * @param {string} [params.apiKey] - Google Maps API key
 * @returns {Promise<{place_id, formatted_address, lat, lng}>}
 */
export async function forwardGeocode({ address, apiKey = process.env.GOOGLE_MAPS_API_KEY }) {
  try {
    const url = new URL(GEOCODE_URL);
    url.searchParams.set('address', address);
    url.searchParams.set('key', apiKey);

    const response = await fetch(url.toString());
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Geocoding API] Error ${response.status}: ${errorText}`);
      throw new Error(`Geocoding API failed: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.status !== 'OK') {
      throw new Error(`Geocoding API status: ${data.status}`);
    }

    const best = data.results?.[0];
    if (!best) {
      throw new Error('geocode_no_results');
    }

    console.log(`🗺️ [Geocoding] Forward geocoded "${address}" → place_id: ${best.place_id}, coords: (${best.geometry.location.lat}, ${best.geometry.location.lng})`);

    return {
      place_id: best.place_id,
      formatted_address: best.formatted_address,
      lat: best.geometry?.location?.lat,
      lng: best.geometry?.location?.lng
    };
  } catch (error) {
    console.error('[Geocoding API] forwardGeocode failed:', error.message);
    throw error;
  }
}
