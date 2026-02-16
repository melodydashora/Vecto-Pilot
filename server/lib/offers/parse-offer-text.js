// server/lib/offers/parse-offer-text.js
// 2026-02-16: Server-side OCR pre-parser for Uber/Lyft ride offer screenshots.
// Extracts structured data via regex BEFORE sending to LLM.
// Pure CPU — no I/O, runs <1ms. Reduces LLM hallucination on numeric fields.
//
// Why pre-parse?
// 1. Regex is deterministic — same text always gives same numbers
// 2. LLM math is unreliable ("$9.43 / 4.6 mi" sometimes yields wrong $/mi)
// 3. Speed — pre-parsing <1ms, reduces tokens the LLM processes
// 4. Testable — pure functions with no dependencies

/**
 * Extract the primary ride price from OCR text.
 * Uber format: "$9.43" or "$18.67" — always the main price shown on the offer card.
 * Must exclude "$X.XX/active hr" (hourly estimate) and rating values like "* 4.94".
 *
 * @param {string} text - Raw OCR text
 * @returns {number|null}
 */
export function extractPrice(text) {
  // Match all dollar amounts: $X.XX or $ X.XX (OCR sometimes adds space)
  const allPrices = [...text.matchAll(/\$\s?(\d+\.?\d{0,2})/g)];
  for (const match of allPrices) {
    const value = parseFloat(match[1]);
    // Skip if this is part of "/active hr" (hourly rate estimate)
    const afterMatch = text.substring(match.index + match[0].length, match.index + match[0].length + 15);
    if (/\/active\s*hr/i.test(afterMatch)) continue;
    // Skip tiny values that are likely ratings or surge markers (under $2 with no decimal context)
    // But $3.63 is a valid short-ride price, so only skip if clearly not a price
    if (value > 0) return value;
  }
  return null;
}

/**
 * Extract estimated hourly rate from OCR text.
 * Uber format: "$23.58/active hr (est.)" or "$19.69/active hr (est.)"
 *
 * @param {string} text - Raw OCR text
 * @returns {number|null}
 */
export function extractHourlyRate(text) {
  const match = text.match(/\$\s?(\d+\.?\d{0,2})\/active\s*hr/i);
  return match ? parseFloat(match[1]) : null;
}

/**
 * Extract all "X min (Y.Z mi)" patterns from OCR text.
 * Uber shows two of these:
 *   1. Pickup: "8 min (3.2 mi)" — time/distance to reach passenger
 *   2. Ride:   "15 mins (6.8 mi)" — time/distance of the actual trip
 *
 * OCR sometimes drops the space or uses bullet: "• 17 mins (8.4 mi)"
 * Sometimes pickup time is separated: "9\n5 min (2.2 mi)" — the 9 is unrelated map UI
 *
 * @param {string} text - Raw OCR text
 * @returns {Array<{minutes: number, miles: number}>}
 */
export function extractTimeDistancePairs(text) {
  const pairs = [];
  // Pattern: X min/mins (Y.Z mi) — handles optional bullet, newline noise, plural
  const regex = /(\d+)\s*min(?:s|utes?)?\s*\((\d+\.?\d*)\s*mi\)/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    pairs.push({
      minutes: parseInt(match[1], 10),
      miles: parseFloat(match[2]),
    });
  }
  return pairs;
}

/**
 * Extract Uber/Lyft product type from OCR text.
 * Examples: "UberX", "UberX Priority", "UberXXL", "UberX\nExclusive",
 *           "Uberx Priority", "Share", "Lyft", "Comfort", "Black"
 *
 * @param {string} text - Raw OCR text
 * @returns {string|null}
 */
export function extractProductType(text) {
  // Normalize newlines for multi-line product names like "UberX\nExclusive"
  const normalized = text.replace(/\n/g, ' ');

  // Uber products (most specific first)
  const uberMatch = normalized.match(/Uber\s*X{0,2}\s*L?\s*(?:Priority|Exclusive)?/i);
  if (uberMatch) {
    // Clean up: collapse whitespace, title case
    return uberMatch[0].replace(/\s+/g, ' ').trim();
  }

  // Lyft products
  const lyftMatch = normalized.match(/Lyft\s*(?:XL|Lux|Black|Shared|Priority)?/i);
  if (lyftMatch) return lyftMatch[0].replace(/\s+/g, ' ').trim();

  // Standalone product names
  if (/\bComfort\b/i.test(text)) return 'Comfort';
  if (/\bBlack\b/i.test(text)) return 'Black';
  if (/\bShare\b/i.test(text)) return 'Share';

  return null;
}

/**
 * Extract surge/boost multiplier or bonus from OCR text.
 * Uber formats seen in production:
 *   "$ 4.75" — surge amount (space between $ and amount, separate from main price)
 *   "+$2.40 included for priority pick..." — priority pickup bonus
 *   "+$1.40 included for priority pickup" — priority pickup bonus
 *
 * @param {string} text - Raw OCR text
 * @returns {number|null}
 */
export function extractSurge(text) {
  // Priority pickup bonus: "+$X.XX included for priority"
  const priorityMatch = text.match(/\+\$\s?(\d+\.?\d{0,2})\s*included\s*for\s*priority/i);
  if (priorityMatch) return parseFloat(priorityMatch[1]);

  // Surge amount: "$ X.XX" with space (Uber's surge indicator in OCR)
  // Look for dollar amounts preceded by "* " or isolated "$ " patterns
  // that are NOT the main price and NOT the hourly rate
  const surgePatterns = [
    /\*\s*(\d+\.\d{2})/g,  // "* 4.75" or "*4.84"
    /\$\s+(\d+\.\d{2})/g,  // "$ 4.75" (space between $ and number = surge, not price)
  ];

  for (const pattern of surgePatterns) {
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      const value = parseFloat(match[1]);
      // Surge/rating values are typically 1.00-9.99 range
      // Skip if it looks like a driver rating (4.80-5.00 range)
      if (value >= 4.70 && value <= 5.00) continue;
      // Skip if near "/active hr"
      const after = text.substring(match.index + match[0].length, match.index + match[0].length + 15);
      if (/\/active\s*hr/i.test(after)) continue;
      if (value > 0 && value < 50) return value;
    }
  }

  return null;
}

/**
 * Extract Uber Pro advantage percentage from OCR text.
 * Format: "5% Advantage included" or "• 5% Advantage included"
 *
 * @param {string} text - Raw OCR text
 * @returns {number|null}
 */
export function extractAdvantage(text) {
  const match = text.match(/(\d+)%\s*Advantage/i);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Detect platform from OCR text and product type.
 *
 * @param {string} text - Raw OCR text
 * @param {string|null} productType - Extracted product type
 * @returns {string} 'uber' | 'lyft' | 'unknown'
 */
export function detectPlatform(text, productType) {
  if (productType && /uber/i.test(productType)) return 'uber';
  if (productType && /lyft/i.test(productType)) return 'lyft';
  if (/uber/i.test(text)) return 'uber';
  if (/lyft/i.test(text)) return 'lyft';
  return 'unknown';
}

/**
 * Main pre-parser. Extracts all structured data from Uber/Lyft OCR text.
 *
 * @param {string} rawText - Raw OCR text from Siri Shortcuts
 * @returns {Object} PreParsedOffer with extracted fields and confidence level
 */
export function parseOfferText(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return {
      price: null, hourly_rate: null,
      pickup_minutes: null, pickup_miles: null,
      ride_minutes: null, ride_miles: null,
      total_miles: null, total_minutes: null,
      per_mile: null, per_minute: null,
      surge: null, product_type: null, advantage_pct: null,
      platform_hint: null, parse_confidence: 'minimal',
    };
  }

  const price = extractPrice(rawText);
  const hourlyRate = extractHourlyRate(rawText);
  const pairs = extractTimeDistancePairs(rawText);
  const productType = extractProductType(rawText);
  const surge = extractSurge(rawText);
  const advantagePct = extractAdvantage(rawText);
  const platformHint = detectPlatform(rawText, productType);

  // Disambiguate pickup vs ride from the two time/distance pairs
  // Uber shows pickup first, ride second. If only one pair found, it's ambiguous.
  let pickupMinutes = null, pickupMiles = null;
  let rideMinutes = null, rideMiles = null;

  if (pairs.length >= 2) {
    // First pair = pickup, second pair = ride
    pickupMinutes = pairs[0].minutes;
    pickupMiles = pairs[0].miles;
    rideMinutes = pairs[1].minutes;
    rideMiles = pairs[1].miles;
  } else if (pairs.length === 1) {
    // Only one pair — could be either. If "Avg. wait time at pickup" appears
    // before it, it's the pickup. Check context.
    const pairIndex = rawText.search(/\d+\s*min(?:s|utes?)?\s*\(\d+\.?\d*\s*mi\)/i);
    const avgWaitIndex = rawText.search(/Avg\.?\s*wait\s*time/i);
    if (avgWaitIndex !== -1 && avgWaitIndex > pairIndex) {
      // The pair appears before "Avg. wait time" — it's pickup
      pickupMinutes = pairs[0].minutes;
      pickupMiles = pairs[0].miles;
    } else {
      // Ambiguous — treat as ride distance (more useful for $/mi calculation)
      rideMinutes = pairs[0].minutes;
      rideMiles = pairs[0].miles;
    }
  }

  const totalMiles = (pickupMiles || 0) + (rideMiles || 0) || null;
  const totalMinutes = (pickupMinutes || 0) + (rideMinutes || 0) || null;

  // Server-side calculations — deterministic, no LLM math needed
  const perMile = (price && totalMiles && totalMiles > 0)
    ? Math.round((price / totalMiles) * 100) / 100
    : null;
  const perMinute = (price && totalMinutes && totalMinutes > 0)
    ? Math.round((price / totalMinutes) * 100) / 100
    : null;

  // Confidence assessment
  let parseConfidence = 'minimal';
  if (price !== null && pairs.length >= 2) {
    parseConfidence = 'full';
  } else if (price !== null && pairs.length >= 1) {
    parseConfidence = 'partial';
  } else if (price !== null) {
    parseConfidence = 'partial';
  }

  return {
    price,
    hourly_rate: hourlyRate,
    pickup_minutes: pickupMinutes,
    pickup_miles: pickupMiles,
    ride_minutes: rideMinutes,
    ride_miles: rideMiles,
    total_miles: totalMiles,
    total_minutes: totalMinutes,
    per_mile: perMile,
    per_minute: perMinute,
    surge,
    product_type: productType,
    advantage_pct: advantagePct,
    platform_hint: platformHint,
    parse_confidence: parseConfidence,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// VOICE FORMATTING — Convert $/mile to spoken English for Siri TTS
// ═══════════════════════════════════════════════════════════════════════════

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/**
 * Convert a number 0-99 to English words.
 * @param {number} n - Integer 0-99
 * @returns {string}
 */
function numberToWords(n) {
  if (n < 0 || n > 99) return String(n);
  if (n < 20) return ONES[n];
  const ten = Math.floor(n / 10);
  const one = n % 10;
  return one === 0 ? TENS[ten] : `${TENS[ten]}-${ONES[one]}`;
}

/**
 * Convert a $/mile value to spoken English for Siri TTS.
 *
 * Examples:
 *   1.57 → "dollar fifty-seven per mile"
 *   0.93 → "ninety-three cents per mile"
 *   2.00 → "two dollars per mile"
 *   1.00 → "one dollar per mile"
 *   0.50 → "fifty cents per mile"
 *   3.10 → "three dollars ten cents per mile"
 *
 * @param {number} perMile - $/mile value
 * @returns {string} Spoken English representation
 */
export function formatPerMileForVoice(perMile) {
  if (perMile == null || isNaN(perMile)) return '';

  const dollars = Math.floor(perMile);
  const cents = Math.round((perMile - dollars) * 100);

  if (dollars === 0 && cents === 0) return 'zero per mile';

  let spoken = '';

  if (dollars > 0 && cents > 0) {
    if (dollars === 1) {
      spoken = `dollar ${numberToWords(cents)}`;
    } else {
      spoken = `${numberToWords(dollars)} dollars ${numberToWords(cents)}`;
    }
  } else if (dollars > 0) {
    spoken = dollars === 1 ? 'one dollar' : `${numberToWords(dollars)} dollars`;
  } else {
    spoken = `${numberToWords(cents)} cents`;
  }

  return `${spoken} per mile`;
}
