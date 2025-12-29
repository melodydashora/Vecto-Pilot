// server/lib/location/geocode.js
// Google Geocoding API utility for converting addresses to coordinates

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
    console.warn('[geocode] Google Maps API key not configured');
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
      console.error('[geocode] API request failed:', response.status);
      return null;
    }

    const data = await response.json();

    if (data.status !== 'OK' || !data.results || data.results.length === 0) {
      console.warn('[geocode] No results for address:', addressString, 'Status:', data.status);
      return null;
    }

    const result = data.results[0];
    const { lat, lng } = result.geometry.location;
    const formattedAddress = result.formatted_address;

    // Get timezone for the coordinates
    const timezone = await getTimezoneForCoords(lat, lng);

    console.log('[geocode] Address geocoded:', {
      input: addressString,
      lat,
      lng,
      formattedAddress,
      timezone
    });

    return {
      lat,
      lng,
      formattedAddress,
      timezone
    };
  } catch (error) {
    console.error('[geocode] Failed to geocode address:', error.message);
    return null;
  }
}

/**
 * Get timezone for coordinates using Google Time Zone API
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Promise<string | null>} IANA timezone string
 */
export async function getTimezoneForCoords(lat, lng) {
  if (!GOOGLE_MAPS_API_KEY) {
    return null;
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const url = `https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${timestamp}&key=${GOOGLE_MAPS_API_KEY}`;

    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (data.status === 'OK') {
      return data.timeZoneId; // e.g., "America/Chicago"
    }

    return null;
  } catch (error) {
    console.error('[geocode] Failed to get timezone:', error.message);
    return null;
  }
}

/**
 * Reverse geocode coordinates to get address
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Promise<{formattedAddress: string, city: string, state: string, country: string, zipCode: string} | null>}
 */
export async function reverseGeocode(lat, lng) {
  if (!GOOGLE_MAPS_API_KEY) {
    console.warn('[geocode] Google Maps API key not configured');
    return null;
  }

  try {
    const url = `${GEOCODE_API_URL}?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error('[geocode] Reverse geocode API request failed:', response.status);
      return null;
    }

    const data = await response.json();

    if (data.status !== 'OK' || !data.results || data.results.length === 0) {
      console.warn('[geocode] No results for coordinates:', lat, lng);
      return null;
    }

    const result = data.results[0];
    const components = result.address_components;

    // Extract address components
    const getComponent = (type) => {
      const comp = components.find(c => c.types.includes(type));
      return comp ? comp.long_name : null;
    };

    const getComponentShort = (type) => {
      const comp = components.find(c => c.types.includes(type));
      return comp ? comp.short_name : null;
    };

    return {
      formattedAddress: result.formatted_address,
      streetNumber: getComponent('street_number'),
      streetName: getComponent('route'),
      city: getComponent('locality') || getComponent('sublocality') || getComponent('administrative_area_level_2'),
      state: getComponent('administrative_area_level_1'),
      stateCode: getComponentShort('administrative_area_level_1'),
      country: getComponent('country'),
      countryCode: getComponentShort('country'),
      zipCode: getComponent('postal_code')
    };
  } catch (error) {
    console.error('[geocode] Failed to reverse geocode:', error.message);
    return null;
  }
}
