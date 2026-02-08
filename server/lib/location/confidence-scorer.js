/**
 * Location Confidence Scorer
 * Scores geocoding results based on precision and validation status
 */

// Precision scores by geocoding result type (Google Geocoding API)
export const PRECISION_SCORES = {
  ROOFTOP: 40,              // Precise street address
  RANGE_INTERPOLATED: 30,   // Interpolated between two points
  GEOMETRIC_CENTER: 20,     // Center of a region/polygon
  APPROXIMATE: 10,          // Approximate location
  UNKNOWN: 5,               // Unknown precision
};

// Validation scores by address validation status
export const VALIDATION_SCORES = {
  CONFIRMED: 30,            // Address validated and confirmed
  UNCONFIRMED_AND_CORRECTED: 25, // Corrected by validation API
  UNCONFIRMED_BUT_PLAUSIBLE: 20, // Plausible but not confirmed
  SUSPICIOUS: 10,           // Suspicious address
  INVALID: 0,               // Invalid address
};

// Additional scoring factors
export const FACTOR_SCORES = {
  HAS_STREET_NUMBER: 10,    // Has a specific street number
  HAS_ZIP_CODE: 5,          // Has a postal code
  GPS_VERIFIED: 15,         // GPS location matches geocode
  KNOWN_BUSINESS: 10,       // Matches a known place/business
};

// Grade thresholds (total score out of 100)
export const GRADE_THRESHOLDS = {
  A: 85,   // Excellent - highly reliable
  B: 70,   // Good - reliable
  C: 50,   // Fair - usable with caution
  D: 0,    // Poor - may be unreliable
};

/**
 * Calculate confidence score from geocoding result
 * @param {Object} geocodeResult - Result from Google Geocoding/Address Validation
 * @param {Object} [options] - Additional options
 * @returns {{ score: number, grade: string, factors: Object }}
 */
export function calculateConfidenceScore(geocodeResult, options = {}) {
  const factors = {};
  let totalScore = 0;

  // 1. Precision score (from location_type or geometry precision)
  const locationType = geocodeResult.location_type ||
    geocodeResult.geometry?.location_type ||
    'UNKNOWN';
  const precisionScore = PRECISION_SCORES[locationType] || PRECISION_SCORES.UNKNOWN;
  factors.precision = { type: locationType, score: precisionScore };
  totalScore += precisionScore;

  // 2. Validation score (if from Address Validation API)
  if (geocodeResult.verdict) {
    const verdict = geocodeResult.verdict;
    let validationKey = 'UNCONFIRMED_BUT_PLAUSIBLE';

    if (verdict.addressComplete && verdict.hasInferredComponents === false) {
      validationKey = 'CONFIRMED';
    } else if (verdict.hasReplacedComponents || verdict.hasInferredComponents) {
      validationKey = 'UNCONFIRMED_AND_CORRECTED';
    } else if (verdict.hasUnconfirmedComponents) {
      validationKey = 'UNCONFIRMED_BUT_PLAUSIBLE';
    } else if (verdict.inputGranularity === 'PREMISE' || verdict.inputGranularity === 'BUILDING') {
      validationKey = 'CONFIRMED';
    }

    const validationScore = VALIDATION_SCORES[validationKey];
    factors.validation = { status: validationKey, score: validationScore };
    totalScore += validationScore;
  } else {
    // Default validation score for non-validated results
    factors.validation = { status: 'NOT_VALIDATED', score: 15 };
    totalScore += 15;
  }

  // 3. Address component factors
  const addressComponents = geocodeResult.address_components || [];
  const formattedAddress = geocodeResult.formatted_address || '';

  // Check for street number
  const hasStreetNumber = addressComponents.some(c =>
    c.types?.includes('street_number')
  );
  if (hasStreetNumber) {
    factors.streetNumber = { present: true, score: FACTOR_SCORES.HAS_STREET_NUMBER };
    totalScore += FACTOR_SCORES.HAS_STREET_NUMBER;
  }

  // Check for postal code
  const hasPostalCode = addressComponents.some(c =>
    c.types?.includes('postal_code')
  );
  if (hasPostalCode) {
    factors.postalCode = { present: true, score: FACTOR_SCORES.HAS_ZIP_CODE };
    totalScore += FACTOR_SCORES.HAS_ZIP_CODE;
  }

  // 4. GPS verification (if provided)
  if (options.gpsLocation && geocodeResult.geometry?.location) {
    const distance = calculateDistance(
      options.gpsLocation.lat,
      options.gpsLocation.lng,
      geocodeResult.geometry.location.lat,
      geocodeResult.geometry.location.lng
    );

    // Within 100 meters is considered verified
    if (distance <= 0.1) {
      factors.gpsVerified = { distance, score: FACTOR_SCORES.GPS_VERIFIED };
      totalScore += FACTOR_SCORES.GPS_VERIFIED;
    } else {
      factors.gpsVerified = { distance, score: 0 };
    }
  }

  // 5. Known business (place_id indicates Google Places match)
  if (geocodeResult.place_id && geocodeResult.types?.includes('establishment')) {
    factors.knownBusiness = { present: true, score: FACTOR_SCORES.KNOWN_BUSINESS };
    totalScore += FACTOR_SCORES.KNOWN_BUSINESS;
  }

  // Cap at 100
  totalScore = Math.min(100, totalScore);

  // Determine grade
  let grade = 'D';
  if (totalScore >= GRADE_THRESHOLDS.A) grade = 'A';
  else if (totalScore >= GRADE_THRESHOLDS.B) grade = 'B';
  else if (totalScore >= GRADE_THRESHOLDS.C) grade = 'C';

  return {
    score: totalScore,
    grade,
    factors,
    formatted_address: formattedAddress,
    location: geocodeResult.geometry?.location || null,
  };
}

/**
 * Calculate distance between two points (Haversine formula)
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number} Distance in kilometers
 */
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

/**
 * Get a human-readable confidence description
 * @param {string} grade - A, B, C, or D
 * @returns {string}
 */
export function getConfidenceDescription(grade) {
  const descriptions = {
    A: 'High confidence - address verified at street level',
    B: 'Good confidence - address validated',
    C: 'Moderate confidence - use with caution',
    D: 'Low confidence - may need verification',
  };
  return descriptions[grade] || descriptions.D;
}

export default {
  calculateConfidenceScore,
  getConfidenceDescription,
  PRECISION_SCORES,
  VALIDATION_SCORES,
  GRADE_THRESHOLDS,
};
