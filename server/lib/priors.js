/**
 * Demand Priors for Block Scoring
 * 
 * Applies multiplicative weights based on day-of-week, daypart, and location attributes.
 * These priors influence scoring even before we integrate real-time event data.
 */

/**
 * Calculate demand prior based on temporal and spatial features
 * @param {number} dow - Day of week (0=Sunday, 1=Monday, ..., 6=Saturday)
 * @param {string} dayPart - Time of day ("morning", "midday", "afternoon", "evening", "late_evening", "overnight")
 * @param {boolean} isAirport - Whether this is an airport location
 * @param {string} category - Block category (e.g., "airport", "entertainment", "business", "residential")
 * @returns {number} - Multiplicative prior weight (1.0 = neutral, >1.0 = boost, <1.0 = reduce)
 */
export function demandPrior(dow, dayPart, isAirport = false, category = null) {
  let weight = 1.0;
  
  // Airport-specific priors
  if (isAirport || category === 'airport') {
    // Monday morning airport boost (+25%)
    if (dow === 1 && dayPart === 'morning') {
      weight *= 1.25;
    }
    // Sunday late evening airport surge (+20%)
    if (dow === 0 && (dayPart === 'late_evening' || dayPart === 'evening')) {
      weight *= 1.20;
    }
  }
  
  // Weekday patterns
  if (dow >= 1 && dow <= 5) {
    // Wednesday morning dip (-10%)
    if (dow === 3 && dayPart === 'morning') {
      weight *= 0.90;
    }
    
    // Thursday evening boost (+15%)
    if (dow === 4 && dayPart === 'evening') {
      weight *= 1.15;
    }
    
    // Weekday lunch rush (midday +10%)
    if (dayPart === 'midday') {
      weight *= 1.10;
    }
  }
  
  // Weekend patterns
  if (dow === 5 || dow === 6) {
    // Friday/Saturday night surge (+30%)
    if (dayPart === 'evening' || dayPart === 'late_evening') {
      weight *= 1.30;
    }
    
    // Weekend brunch boost (+15%)
    if (dayPart === 'morning' || dayPart === 'midday') {
      weight *= 1.15;
    }
  }
  
  // Sunday evening dip (-10%)
  if (dow === 0 && dayPart === 'late_evening') {
    weight *= 0.90;
  }
  
  // Category-specific modifiers
  if (category === 'entertainment') {
    // Evening/late evening boost (+20%)
    if (dayPart === 'evening' || dayPart === 'late_evening') {
      weight *= 1.20;
    }
  }
  
  if (category === 'business') {
    // Weekday morning/afternoon boost (+10%)
    if (dow >= 1 && dow <= 5 && (dayPart === 'morning' || dayPart === 'afternoon')) {
      weight *= 1.10;
    }
    // Weekend business district penalty (-30%)
    if (dow === 0 || dow === 6) {
      weight *= 0.70;
    }
  }
  
  return weight;
}

/**
 * Get human-readable explanation of applied prior
 * @param {number} dow - Day of week
 * @param {string} dayPart - Time of day
 * @param {boolean} isAirport - Whether this is an airport location
 * @param {string} category - Block category
 * @returns {string|null} - Explanation or null if no significant prior
 */
export function explainPrior(dow, dayPart, isAirport, category) {
  const weight = demandPrior(dow, dayPart, isAirport, category);
  
  if (weight === 1.0) return null;
  
  const change = Math.round((weight - 1.0) * 100);
  const direction = change > 0 ? 'boost' : 'penalty';
  const pct = Math.abs(change);
  
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[dow] || 'Unknown';
  
  return `${pct}% ${direction} (${dayName} ${dayPart})`;
}
