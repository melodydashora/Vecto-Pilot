/**
 * STREET VIEW STATIC API
 *
 * Generates preview images of venues to help drivers:
 * - Identify staging areas
 * - Find parking spots
 * - Recognize venue entrances
 *
 * Cost: $7 per 1,000 requests
 */

const STREETVIEW_URL = 'https://maps.googleapis.com/maps/api/streetview';
const STREETVIEW_METADATA_URL = 'https://maps.googleapis.com/maps/api/streetview/metadata';

/**
 * Get Street View image URL for a location
 * @param {Object} location - {lat, lng} or {address}
 * @param {Object} options - {width, height, heading, pitch, fov}
 * @returns {string} Street View image URL
 */
export function getStreetViewUrl(location, options = {}) {
  const {
    width = 400,
    height = 300,
    heading = null,  // Auto-calculated if null
    pitch = 0,       // 0 = level, negative = down, positive = up
    fov = 90         // Field of view (zoom), 10-120
  } = options;

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return null;
  }

  const params = new URLSearchParams({
    size: `${width}x${height}`,
    key: apiKey,
    pitch: pitch.toString(),
    fov: fov.toString()
  });

  // Location can be lat/lng or address
  if (location.lat && location.lng) {
    params.set('location', `${location.lat},${location.lng}`);
  } else if (location.address) {
    params.set('location', location.address);
  } else {
    return null;
  }

  // Only set heading if explicitly provided (otherwise Google auto-orients)
  if (heading !== null) {
    params.set('heading', heading.toString());
  }

  return `${STREETVIEW_URL}?${params.toString()}`;
}

/**
 * Check if Street View imagery is available at a location
 * @param {Object} location - {lat, lng}
 * @returns {Promise<{available: boolean, panoId?: string, date?: string}>}
 */
export async function checkStreetViewAvailability(location) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return { available: false, reason: 'No API key' };
  }

  try {
    const params = new URLSearchParams({
      location: `${location.lat},${location.lng}`,
      key: apiKey
    });

    const response = await fetch(`${STREETVIEW_METADATA_URL}?${params.toString()}`);
    const data = await response.json();

    if (data.status === 'OK') {
      return {
        available: true,
        panoId: data.pano_id,
        date: data.date,  // e.g., "2023-05"
        location: data.location  // Actual panorama location (may differ slightly)
      };
    }

    return {
      available: false,
      reason: data.status  // ZERO_RESULTS, NOT_FOUND, etc.
    };
  } catch (error) {
    console.error('[Street View API] Metadata check failed:', error.message);
    return { available: false, reason: error.message };
  }
}

/**
 * Get Street View data for a venue (URL + availability check)
 * @param {Object} venue - {lat, lng, name, address}
 * @param {Object} options - {width, height, checkAvailability}
 * @returns {Promise<{url: string, available: boolean, date?: string}>}
 */
export async function getVenueStreetView(venue, options = {}) {
  const { checkAvailability = true, ...imageOptions } = options;

  const location = {
    lat: venue.lat,
    lng: venue.lng
  };

  // Generate URL
  const url = getStreetViewUrl(location, imageOptions);

  if (!checkAvailability) {
    return { url, available: true };  // Assume available
  }

  // Check if imagery exists
  const metadata = await checkStreetViewAvailability(location);

  return {
    url: metadata.available ? url : null,
    available: metadata.available,
    date: metadata.date,
    panoId: metadata.panoId
  };
}

/**
 * Batch check Street View availability for multiple venues
 * @param {Array} venues - [{lat, lng, name}, ...]
 * @returns {Promise<Map>} Map of venue index -> {available, url, date}
 */
export async function batchCheckStreetView(venues) {
  const results = new Map();

  // Process in parallel (metadata API is cheap and fast)
  const checks = await Promise.all(
    venues.map(async (venue, index) => {
      const data = await getVenueStreetView(venue, { checkAvailability: true });
      return { index, data };
    })
  );

  checks.forEach(({ index, data }) => {
    results.set(index, data);
  });

  return results;
}
