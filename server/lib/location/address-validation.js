/**
 * Address Validation API Integration
 *
 * Uses Google Address Validation API to:
 * 1. Verify addresses exist
 * 2. Standardize formatting
 * 3. Get precise lat/lng coordinates
 * 4. Detect and correct typos
 * 5. Provide confidence scoring (added 2026-02-02)
 *
 * @see https://developers.google.com/maps/documentation/address-validation
 *
 * Created: 2026-01-05
 * Enhanced: 2026-02-02 - Added confidence scoring integration
 */

import { calculateConfidenceScore, getConfidenceDescription } from './confidence-scorer.js';
import { reverseGeocode } from './geocode-enhanced.js';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const ADDRESS_VALIDATION_URL = 'https://addressvalidation.googleapis.com/v1:validateAddress';

/**
 * Validation result quality levels
 */
export const ValidationVerdict = {
  CONFIRMED: 'CONFIRMED',           // Address is fully confirmed
  UNCONFIRMED_COMPONENTS: 'UNCONFIRMED_COMPONENTS', // Some parts need review
  UNCONFIRMED_ADDRESS: 'UNCONFIRMED_ADDRESS',       // Address couldn't be validated
};

/**
 * Validate and standardize an address using Google Address Validation API
 *
 * @param {Object} address - Address components
 * @param {string} address.address1 - Street address
 * @param {string} [address.address2] - Unit/apt (optional)
 * @param {string} address.city - City
 * @param {string} address.state - State/province
 * @param {string} [address.zipCode] - Postal code (optional)
 * @param {string} [address.country='US'] - Country code
 * @returns {Promise<Object>} Validation result
 */
export async function validateAddress({ address1, address2, city, state, zipCode, country = 'US' }) {
  if (!GOOGLE_MAPS_API_KEY) {
    console.warn('[address-validation] GOOGLE_MAPS_API_KEY not set - skipping validation');
    return {
      valid: true, // Don't block registration if API key not set
      skipped: true,
      reason: 'API key not configured'
    };
  }

  // Build address lines
  const addressLines = [address1];
  if (address2) {
    addressLines[0] += `, ${address2}`;
  }

  try {
    const response = await fetch(`${ADDRESS_VALIDATION_URL}?key=${GOOGLE_MAPS_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        address: {
          regionCode: country,
          addressLines,
          locality: city,
          administrativeArea: state,
          postalCode: zipCode || undefined,
        },
        // Enable USPS validation for US addresses
        enableUspsCass: country === 'US',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[address-validation] API error:', response.status, errorText);
      return {
        valid: true, // Don't block on API errors
        skipped: true,
        reason: `API error: ${response.status}`,
      };
    }

    const data = await response.json();
    const result = data.result;

    if (!result) {
      return {
        valid: true,
        skipped: true,
        reason: 'No result from API',
      };
    }

    // Extract verdict
    const verdict = result.verdict;
    const geocode = result.geocode;
    const standardizedAddress = result.address;

    // Determine if address is valid enough
    const addressComplete = verdict?.addressComplete === true;
    const hasInferredComponents = verdict?.hasInferredComponents === true;
    const hasReplacedComponents = verdict?.hasReplacedComponents === true;

    // Build standardized address from components
    const postalAddress = standardizedAddress?.postalAddress || {};
    const formattedAddress = standardizedAddress?.formattedAddress || null;

    // Extract corrected components
    const correctedAddress = {
      address1: null,
      address2: null,
      city: postalAddress.locality || city,
      state: postalAddress.administrativeArea || state,
      zipCode: postalAddress.postalCode || zipCode,
      country: postalAddress.regionCode || country,
    };

    // Build corrected address1 from address lines
    if (postalAddress.addressLines?.length > 0) {
      correctedAddress.address1 = postalAddress.addressLines[0];
      if (postalAddress.addressLines.length > 1) {
        correctedAddress.address2 = postalAddress.addressLines.slice(1).join(', ');
      }
    }

    // Get precise coordinates
    const location = geocode?.location;
    const lat = location?.latitude || null;
    const lng = location?.longitude || null;

    // Determine validation status
    let validationStatus = ValidationVerdict.CONFIRMED;
    let warnings = [];

    if (!addressComplete) {
      validationStatus = ValidationVerdict.UNCONFIRMED_ADDRESS;
      warnings.push('Address could not be fully validated');
    } else if (hasInferredComponents || hasReplacedComponents) {
      validationStatus = ValidationVerdict.UNCONFIRMED_COMPONENTS;
      if (hasInferredComponents) warnings.push('Some address components were inferred');
      if (hasReplacedComponents) warnings.push('Some address components were corrected');
    }

    // Check for specific component issues
    const unconfirmedComponents = [];
    if (result.address?.addressComponents) {
      for (const comp of result.address.addressComponents) {
        if (comp.confirmationLevel === 'UNCONFIRMED_BUT_PLAUSIBLE' ||
            comp.confirmationLevel === 'UNCONFIRMED_AND_SUSPICIOUS') {
          unconfirmedComponents.push(comp.componentType);
        }
      }
    }

    if (unconfirmedComponents.length > 0) {
      warnings.push(`Unconfirmed: ${unconfirmedComponents.join(', ')}`);
    }

    console.log(`[address-validation] ${validationStatus}: ${formattedAddress || address1}`);

    return {
      valid: addressComplete || hasInferredComponents, // Allow inferred but valid addresses
      validationStatus,
      warnings,

      // Original input
      input: { address1, address2, city, state, zipCode, country },

      // Corrected/standardized output
      corrected: correctedAddress,
      formattedAddress,

      // Precise coordinates from validation
      lat,
      lng,

      // USPS data (US only)
      uspsData: result.uspsData || null,

      // Metadata
      geocodePrecision: geocode?.placeType || null, // ROOFTOP, RANGE_INTERPOLATED, etc.
    };
  } catch (err) {
    console.error('[address-validation] Exception:', err.message);
    return {
      valid: true, // Don't block on errors
      skipped: true,
      reason: err.message,
    };
  }
}

/**
 * Quick check if an address is deliverable (US only via USPS)
 *
 * @param {Object} address - Address to check
 * @returns {Promise<boolean>} True if deliverable
 */
export async function isAddressDeliverable(address) {
  const result = await validateAddress(address);

  if (result.skipped) return true; // Don't block if validation unavailable

  // Check USPS deliverability for US addresses
  if (result.uspsData) {
    const dpvConfirmation = result.uspsData.dpvConfirmation;
    // Y = confirmed, S = secondary missing, D = primary missing, N = not deliverable
    return dpvConfirmation === 'Y' || dpvConfirmation === 'S';
  }

  return result.valid;
}

/**
 * Validate a location using GPS coordinates
 * Returns reverse-geocoded address with confidence scoring
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Promise<Object>}
 */
export async function validateLocation(lat, lng) {
  const result = await reverseGeocode(lat, lng);

  if (!result.ok) {
    return {
      valid: false,
      address: null,
      components: null,
      confidence: null,
      message: result.error || 'Location could not be resolved',
    };
  }

  // Extract key address components
  const components = {};
  for (const c of result.address_components || []) {
    if (c.types?.includes('locality')) {
      components.city = c.long_name;
    } else if (c.types?.includes('administrative_area_level_1')) {
      components.state = c.short_name;
    } else if (c.types?.includes('country')) {
      components.country = c.short_name;
    } else if (c.types?.includes('postal_code')) {
      components.postalCode = c.long_name;
    } else if (c.types?.includes('street_number')) {
      components.streetNumber = c.long_name;
    } else if (c.types?.includes('route')) {
      components.street = c.long_name;
    }
  }

  return {
    valid: true,
    address: result.formatted_address,
    location: result.location,
    components,
    confidence: result.confidence,
    message: 'Location validated successfully',
  };
}

/**
 * Compare GPS location with entered address
 * Returns match status and distance
 *
 * @param {Object} gpsLocation - { lat, lng }
 * @param {Object} address - Address components
 * @returns {Promise<Object>}
 */
export async function compareGpsToAddress(gpsLocation, address) {
  // Get address from GPS
  const gpsResult = await reverseGeocode(gpsLocation.lat, gpsLocation.lng);
  if (!gpsResult.ok) {
    return {
      match: false,
      distance: null,
      gpsAddress: null,
      enteredAddress: address,
      message: 'Could not determine GPS address',
    };
  }

  // Validate entered address
  const addressResult = await validateAddress(address);

  if (!addressResult.valid) {
    return {
      match: false,
      distance: null,
      gpsAddress: gpsResult.formatted_address,
      enteredAddress: address,
      message: 'Could not validate entered address',
    };
  }

  // Calculate distance between the two points
  const distance = calculateDistanceKm(
    gpsLocation.lat,
    gpsLocation.lng,
    addressResult.lat,
    addressResult.lng
  );

  // Consider a match if within 500 meters
  const match = distance <= 0.5;

  return {
    match,
    distance,
    gpsAddress: gpsResult.formatted_address,
    gpsLocation,
    geocodedLocation: { lat: addressResult.lat, lng: addressResult.lng },
    enteredAddress: address,
    resolvedAddress: addressResult.formattedAddress,
    message: match
      ? 'GPS location matches entered address'
      : `GPS location is ${(distance * 1000).toFixed(0)}m from entered address`,
  };
}

/**
 * Calculate distance between two coordinates (Haversine)
 */
function calculateDistanceKm(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return Infinity;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default {
  validateAddress,
  isAddressDeliverable,
  validateLocation,
  compareGpsToAddress,
  ValidationVerdict,
};
