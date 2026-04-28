/**
 * server/lib/venue/venue-address-validator.js
 *
 * Lightweight address quality validation for venue pipeline.
 * String-parsing only — no API calls. Designed to catch bad Places (NEW) API results
 * like "Theatre, Frisco, TX 75034" (venue name fragment leaked into address)
 * or "Frisco, TX, USA" (city-only, no street).
 *
 * 2026-04-11: Created to fix root cause of bad venue addresses in event pipeline.
 * The existing pipeline (normalizeEvent → validateEvent → hashEvent → filterFreshEvents)
 * had ZERO address quality checks. venue-event-verifier.js only checks if events are
 * real/relevant, not if address data is correct.
 *
 * GLOBAL-AWARE: Checks are designed as soft signals, not hard US-only requirements.
 * International addresses may not have street numbers (Japan, rural Europe).
 *
 * @module server/lib/venue/venue-address-validator
 */

/**
 * Common street type suffixes (international).
 * Covers US, UK, Canada, Australia, and common international patterns.
 * Used as word-boundary regex matches to detect real street names.
 */
const STREET_PATTERNS = [
  // US/Canada/Australia
  'st', 'street', 'ave', 'avenue', 'blvd', 'boulevard', 'dr', 'drive',
  'rd', 'road', 'ln', 'lane', 'way', 'ct', 'court', 'pl', 'place',
  'pkwy', 'parkway', 'hwy', 'highway', 'cir', 'circle', 'trl', 'trail',
  'loop', 'plaza', 'terrace', 'ter', 'crescent', 'cres',
  // UK/International
  'close', 'mews', 'row', 'walk', 'path', 'gate', 'rise',
  // German
  'strasse', 'straße', 'weg', 'platz', 'allee',
  // French
  'rue', 'chemin', 'allée',
  // Spanish
  'calle', 'avenida', 'paseo', 'camino',
];

// Build regex: match any street pattern as a whole word (case-insensitive)
const STREET_REGEX = new RegExp(
  `\\b(${STREET_PATTERNS.join('|')})\\b\\.?`,
  'i'
);

/**
 * Words that are commonly venue TYPE names, not street names.
 * If the formatted_address starts with one of these words followed by a comma,
 * it's likely a venue name fragment that leaked into the address.
 *
 * Example: "Theatre, Frisco, TX 75034" — "Theatre" is a venue type, not an address.
 */
const GENERIC_VENUE_WORDS = [
  'theatre', 'theater', 'arena', 'stadium', 'center', 'centre',
  'hall', 'club', 'lounge', 'bar', 'pub', 'restaurant', 'cafe',
  'church', 'temple', 'mosque', 'park', 'garden', 'gardens',
  'museum', 'gallery', 'library', 'school', 'university', 'college',
  'hotel', 'motel', 'resort', 'inn', 'lodge', 'hostel',
  'cinema', 'ballroom', 'pavilion', 'amphitheatre', 'amphitheater',
  'coliseum', 'colosseum', 'auditorium', 'field', 'gym', 'gymnasium',
  'convention', 'expo', 'fairground', 'racetrack', 'raceway',
  'complex', 'facility', 'building', 'tower', 'suite', 'office',
];

const GENERIC_WORD_SET = new Set(GENERIC_VENUE_WORDS);

/**
 * Validate a venue's formatted address for quality.
 *
 * Returns an object with a validity flag and a list of specific issues found.
 * An address is considered INVALID if it fails 2+ checks (soft threshold) or
 * fails the ADDRESS_NOT_GENERIC check (hard fail — always indicates garbage data).
 *
 * @param {Object} params - Validation parameters
 * @param {string} params.formattedAddress - The address to validate
 * @param {string} [params.venueName] - Venue name (used for generic-word detection)
 * @param {number} [params.lat] - Venue latitude (for coord sanity check)
 * @param {number} [params.lng] - Venue longitude (for coord sanity check)
 * @param {string} [params.city] - City from address parsing (for coord sanity check)
 * @returns {{ valid: boolean, issues: string[] }}
 */
export function validateVenueAddress({ formattedAddress, venueName, lat, lng, city } = {}) {
  const issues = [];

  if (!formattedAddress || typeof formattedAddress !== 'string') {
    return { valid: false, issues: ['ADDRESS_MISSING: No formatted_address provided'] };
  }

  const addr = formattedAddress.trim();
  if (addr.length < 5) {
    return { valid: false, issues: ['ADDRESS_TOO_SHORT: Address is less than 5 characters'] };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Check (a): ADDRESS_HAS_STREET_NUMBER — soft signal
  // Real addresses usually contain at least one digit (street number, building number).
  // "1000 Ballpark Way" ✓   "Frisco, TX, USA" ✗
  // Soft signal: contributes to score but doesn't auto-fail alone (international addresses).
  // ─────────────────────────────────────────────────────────────────────────
  const hasDigit = /\d/.test(addr);
  if (!hasDigit) {
    issues.push('ADDRESS_HAS_STREET_NUMBER: No digits found in address (missing street/building number)');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Check (b): ADDRESS_NOT_GENERIC — HARD FAIL
  // Detects venue-type words leaked into the address.
  // "Theatre, Frisco, TX 75034" — first token "Theatre" is a generic venue word.
  // Also catches when the formatted_address is just "City, State, Country".
  // ─────────────────────────────────────────────────────────────────────────
  const firstCommaIdx = addr.indexOf(',');
  if (firstCommaIdx > 0) {
    const beforeComma = addr.substring(0, firstCommaIdx).trim().toLowerCase();
    // Check if the part before the first comma is a single generic venue word
    const words = beforeComma.split(/\s+/);
    if (words.length <= 2) {
      // Single word or two-word combo — check if ALL words are generic
      const allGeneric = words.every(w => GENERIC_WORD_SET.has(w));
      if (allGeneric) {
        issues.push(`ADDRESS_NOT_GENERIC: Address starts with generic venue word "${beforeComma}" — likely venue name leaked into address`);
      }
    }
  }

  // Also check: is the entire address just "City, State" or "City, State, Country"?
  // e.g., "Dallas, TX, USA" or "Frisco, TX"
  const commaParts = addr.split(',').map(p => p.trim());
  if (commaParts.length <= 3) {
    // If no part contains a digit AND no part has a street pattern, it's likely just city/state/country
    const anyPartHasStreet = commaParts.some(part => STREET_REGEX.test(part));
    const anyPartHasDigit = commaParts.some(part => /\d/.test(part));
    if (!anyPartHasStreet && !anyPartHasDigit && commaParts.length >= 2) {
      issues.push('ADDRESS_NOT_GENERIC: Address appears to be only city/state/country with no street information');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Check (c): ADDRESS_HAS_STREET_NAME — soft signal
  // Real addresses contain street type words (St, Ave, Blvd, Way, etc.)
  // "1925 Elm St, Dallas, TX 75201" ✓   "75034, USA" ✗
  // ─────────────────────────────────────────────────────────────────────────
  const hasStreetName = STREET_REGEX.test(addr);
  if (!hasStreetName) {
    issues.push('ADDRESS_HAS_STREET_NAME: No recognized street type pattern found (St, Ave, Blvd, Way, etc.)');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Check (d): COORD_SANITY — soft signal
  // If we have coords and a city, verify they're in the same general area.
  // This prevents "Fort Worth address with Dallas coordinates" mismatches.
  // Uses a rough bounding-box check (not precise, just sanity).
  // ─────────────────────────────────────────────────────────────────────────
  // Note: This check is intentionally simple. A full geocode comparison would
  // require API calls, which violates the "lightweight" requirement.
  // We only flag obvious mismatches where the address mentions a very different
  // location than the coordinates suggest.
  if (lat && lng && city && typeof city === 'string') {
    // We skip coord sanity for now — it requires a city→coord lookup table
    // which would be a separate concern. The other 3 checks catch the Majestic Theatre bug.
    // TODO: Implement when we have a metro-area bounding box table.
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Scoring: Determine validity
  // - ADDRESS_NOT_GENERIC (first word is venue type): HARD FAIL — always invalid
  // - ADDRESS_NOT_GENERIC (city-only): HARD FAIL — always invalid
  // - 2+ soft signal failures: INVALID
  // - 1 soft signal failure: VALID with warnings
  // ─────────────────────────────────────────────────────────────────────────
  const hasHardFail = issues.some(i => i.startsWith('ADDRESS_NOT_GENERIC'));
  const softFailCount = issues.filter(i =>
    i.startsWith('ADDRESS_HAS_STREET_NUMBER') ||
    i.startsWith('ADDRESS_HAS_STREET_NAME')
  ).length;

  const valid = !hasHardFail && softFailCount < 2;

  if (!valid && issues.length > 0) {
    console.warn(`[VENUE] Address quality FAILED for "${venueName || 'unknown'}": "${formattedAddress}" — ${issues.join('; ')}`);
  }

  return { valid, issues };
}

/**
 * Quick check: does this address look like a real street address?
 * Convenience wrapper that returns just a boolean.
 *
 * @param {string} formattedAddress - Address to check
 * @param {string} [venueName] - Optional venue name for better logging
 * @returns {boolean}
 */
export function isAddressValid(formattedAddress, venueName) {
  return validateVenueAddress({ formattedAddress, venueName }).valid;
}
