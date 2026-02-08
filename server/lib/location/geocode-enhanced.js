/**
 * Enhanced Geocoding with Confidence Scoring
 * Tries Address Validation API first, falls back to Geocoding API
 */

import { calculateConfidenceScore } from './confidence-scorer.js';

const GEOCODING_API_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const ADDRESS_VALIDATION_URL = 'https://addressvalidation.googleapis.com/v1:validateAddress';

/**
 * Geocode an address with enhanced confidence scoring
 * @param {string} address - Address to geocode
 * @param {Object} [options] - Options
 * @param {Object} [options.gpsLocation] - GPS location for verification { lat, lng }
 * @param {boolean} [options.useValidationApi] - Try Address Validation API first
 * @returns {Promise<{
 *   ok: boolean,
 *   location: { lat: number, lng: number },
 *   formatted_address: string,
 *   confidence: { score: number, grade: string, factors: Object },
 *   source: string,
 *   error?: string
 * }>}
 */
export async function geocodeWithConfidence(address, options = {}) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      error: 'Google API key not configured',
    };
  }

  // Try Address Validation API first if enabled
  if (options.useValidationApi !== false) {
    try {
      const validationResult = await validateAddress(address, apiKey);
      if (validationResult.ok) {
        const confidence = calculateConfidenceScore(validationResult.result, {
          gpsLocation: options.gpsLocation,
        });

        return {
          ok: true,
          location: confidence.location,
          formatted_address: confidence.formatted_address || validationResult.result.address?.formattedAddress,
          confidence,
          source: 'address_validation',
          raw: validationResult.result,
        };
      }
    } catch (validationError) {
      console.warn('Address Validation API error, falling back to Geocoding:', validationError.message);
    }
  }

  // Fall back to standard Geocoding API
  try {
    const geocodeResult = await geocodeAddress(address, apiKey);
    if (geocodeResult.ok) {
      const confidence = calculateConfidenceScore(geocodeResult.result, {
        gpsLocation: options.gpsLocation,
      });

      return {
        ok: true,
        location: geocodeResult.result.geometry.location,
        formatted_address: geocodeResult.result.formatted_address,
        confidence,
        source: 'geocoding',
        raw: geocodeResult.result,
      };
    }

    return {
      ok: false,
      error: geocodeResult.error || 'Geocoding failed',
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
    };
  }
}

/**
 * Validate address using Google Address Validation API
 * @param {string} address
 * @param {string} apiKey
 * @returns {Promise<{ ok: boolean, result?: Object, error?: string }>}
 */
async function validateAddress(address, apiKey) {
  const response = await fetch(`${ADDRESS_VALIDATION_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      address: {
        addressLines: [address],
      },
      enableUspsCass: false, // US-only, disable for international
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Address Validation API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();

  if (!data.result || !data.result.geocode) {
    return {
      ok: false,
      error: 'No geocode result from validation',
    };
  }

  // Transform to common format
  const geocode = data.result.geocode;
  const result = {
    geometry: {
      location: {
        lat: geocode.location.latitude,
        lng: geocode.location.longitude,
      },
      location_type: geocode.locationType || 'UNKNOWN',
    },
    formatted_address: data.result.address?.formattedAddress,
    address_components: transformAddressComponents(data.result.address?.addressComponents),
    verdict: data.result.verdict,
    place_id: geocode.placeId,
    types: geocode.placeTypes || [],
  };

  return {
    ok: true,
    result,
  };
}

/**
 * Geocode address using standard Geocoding API
 * @param {string} address
 * @param {string} apiKey
 * @returns {Promise<{ ok: boolean, result?: Object, error?: string }>}
 */
async function geocodeAddress(address, apiKey) {
  const params = new URLSearchParams({
    address,
    key: apiKey,
  });

  const response = await fetch(`${GEOCODING_API_URL}?${params}`);

  if (!response.ok) {
    throw new Error(`Geocoding API error: ${response.status}`);
  }

  const data = await response.json();

  if (data.status !== 'OK' || !data.results || data.results.length === 0) {
    return {
      ok: false,
      error: data.status || 'No results',
    };
  }

  return {
    ok: true,
    result: data.results[0],
  };
}

/**
 * Transform Address Validation API components to Geocoding API format
 * @param {Array} components
 * @returns {Array}
 */
function transformAddressComponents(components) {
  if (!components) return [];

  return components.map(c => ({
    long_name: c.componentName?.text || '',
    short_name: c.componentName?.text || '',
    types: [c.componentType?.toLowerCase() || 'unknown'],
  }));
}

/**
 * Reverse geocode coordinates to an address
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{
 *   ok: boolean,
 *   formatted_address?: string,
 *   address_components?: Array,
 *   confidence?: Object,
 *   error?: string
 * }>}
 */
export async function reverseGeocode(lat, lng) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      error: 'Google API key not configured',
    };
  }

  try {
    const params = new URLSearchParams({
      latlng: `${lat},${lng}`,
      key: apiKey,
    });

    const response = await fetch(`${GEOCODING_API_URL}?${params}`);

    if (!response.ok) {
      throw new Error(`Reverse geocoding error: ${response.status}`);
    }

    const data = await response.json();

    if (data.status !== 'OK' || !data.results || data.results.length === 0) {
      return {
        ok: false,
        error: data.status || 'No results',
      };
    }

    const result = data.results[0];
    const confidence = calculateConfidenceScore(result, {
      gpsLocation: { lat, lng },
    });

    return {
      ok: true,
      formatted_address: result.formatted_address,
      address_components: result.address_components,
      location: result.geometry.location,
      confidence,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
    };
  }
}

export default {
  geocodeWithConfidence,
  reverseGeocode,
};
