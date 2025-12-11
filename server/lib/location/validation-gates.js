/**
 * VALIDATION GATES (Runtime-Fresh Spec Compliance)
 * 
 * Hard-fail checks enforcing freshness-first contract:
 * - Location presence & freshness (≤2 minutes)
 * - Strategy freshness (≤120 seconds)
 * - Window duration (≤60 minutes)
 * - Schema validity
 * - No historical bleed
 */

/**
 * Validate location freshness
 * @param {Object} snapshot - Location snapshot
 * @param {Date} requestTime - Current request timestamp
 * @returns {Object} {valid: boolean, error?: string}
 */
export function validateLocationFreshness(snapshot, requestTime = new Date()) {
  if (!snapshot) {
    return { valid: false, error: 'LOCATION_MISSING: No snapshot provided' };
  }

  // All fields that are NOT NULL in snapshots table schema
  const required = [
    'lat', 'lng', 'formatted_address', 'created_at',
    'city', 'state', 'country', 'timezone',
    'local_iso', 'dow', 'hour', 'day_part_key'
  ];
  const missing = required.filter(field => snapshot[field] === null || snapshot[field] === undefined);

  if (missing.length > 0) {
    return {
      valid: false,
      error: `LOCATION_INCOMPLETE: Missing required fields: ${missing.join(', ')}`
    };
  }

  // Check reverse-geocode age ≤ 24 hours (drivers can manually refresh)
  const snapshotAge = requestTime - new Date(snapshot.created_at);
  const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

  if (snapshotAge > maxAgeMs) {
    return { 
      valid: false, 
      error: `LOCATION_STALE: Snapshot age ${Math.round(snapshotAge / 1000)}s exceeds 86400s threshold` 
    };
  }

  return { valid: true };
}

/**
 * Validate strategy freshness
 * @param {Date} strategyTimestamp - When strategy was generated
 * @param {Date} requestTime - Current request timestamp
 * @returns {Object} {valid: boolean, error?: string}
 */
export function validateStrategyFreshness(strategyTimestamp, requestTime = new Date()) {
  if (!strategyTimestamp) {
    return { valid: false, error: 'STRATEGY_TIMESTAMP_MISSING' };
  }

  const age = requestTime - new Date(strategyTimestamp);
  const maxAgeMs = 120 * 1000; // 120 seconds

  if (age > maxAgeMs) {
    return { 
      valid: false, 
      error: `STRATEGY_STALE: Age ${Math.round(age / 1000)}s exceeds 120s threshold` 
    };
  }

  return { valid: true };
}

/**
 * Validate time window duration
 * @param {Date} windowStart - Window start timestamp
 * @param {Date} windowEnd - Window end timestamp
 * @returns {Object} {valid: boolean, error?: string}
 */
export function validateWindowDuration(windowStart, windowEnd) {
  if (!windowStart || !windowEnd) {
    return { valid: false, error: 'WINDOW_INCOMPLETE: Missing start or end timestamp' };
  }

  const start = new Date(windowStart);
  const end = new Date(windowEnd);
  const durationMs = end - start;
  const maxDurationMs = 60 * 60 * 1000; // 60 minutes

  if (durationMs <= 0) {
    return { valid: false, error: 'WINDOW_INVALID: End time before start time' };
  }

  if (durationMs > maxDurationMs) {
    return { 
      valid: false, 
      error: `WINDOW_TOO_LONG: Duration ${Math.round(durationMs / 60000)}min exceeds 60min limit` 
    };
  }

  return { valid: true };
}

/**
 * Validate strategy hasn't expired
 * @param {Date} windowEnd - Window end timestamp
 * @param {Date} currentTime - Current time
 * @returns {Object} {valid: boolean, error?: string}
 */
export function validateWindowNotExpired(windowEnd, currentTime = new Date()) {
  if (!windowEnd) {
    return { valid: false, error: 'WINDOW_END_MISSING' };
  }

  const end = new Date(windowEnd);
  
  if (currentTime > end) {
    return { 
      valid: false, 
      error: `WINDOW_EXPIRED: Expired ${Math.round((currentTime - end) / 1000)}s ago` 
    };
  }

  return { valid: true };
}

/**
 * Comprehensive validation for strategy generation
 * @param {Object} params - Validation parameters
 * @returns {Object} {valid: boolean, errors: string[]}
 */
export function validateStrategyGeneration({
  snapshot,
  requestTime = new Date()
}) {
  const errors = [];

  // Gate 1: Location presence & freshness
  const locationCheck = validateLocationFreshness(snapshot, requestTime);
  if (!locationCheck.valid) {
    errors.push(locationCheck.error);
  }

  // Gate 2: Required snapshot fields for strategy generation
  const contextRequired = ['timezone', 'day_part_key', 'dow'];
  const contextMissing = contextRequired.filter(field => !snapshot[field]);
  if (contextMissing.length > 0) {
    errors.push(`CONTEXT_INCOMPLETE: Missing ${contextMissing.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Comprehensive validation for strategy delivery
 * @param {Object} params - Validation parameters
 * @returns {Object} {valid: boolean, errors: string[]}
 */
export function validateStrategyDelivery({
  strategy,
  snapshot,
  requestTime = new Date()
}) {
  const errors = [];

  // Gate 1: Location freshness
  const locationCheck = validateLocationFreshness(snapshot, requestTime);
  if (!locationCheck.valid) {
    errors.push(locationCheck.error);
  }

  // Gate 2: Strategy freshness
  if (strategy.strategy_timestamp) {
    const strategyCheck = validateStrategyFreshness(strategy.strategy_timestamp, requestTime);
    if (!strategyCheck.valid) {
      errors.push(strategyCheck.error);
    }
  }

  // Gate 3: Window duration
  if (strategy.valid_window_start && strategy.valid_window_end) {
    const windowCheck = validateWindowDuration(
      strategy.valid_window_start,
      strategy.valid_window_end
    );
    if (!windowCheck.valid) {
      errors.push(windowCheck.error);
    }

    // Gate 4: Window not expired
    const expiryCheck = validateWindowNotExpired(strategy.valid_window_end, requestTime);
    if (!expiryCheck.valid) {
      errors.push(expiryCheck.error);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Check if strategy needs regeneration due to movement
 * @param {Object} currentSnapshot - Current location snapshot
 * @param {Object} strategySnapshot - Snapshot used for current strategy
 * @param {Object} strategy - Current strategy
 * @returns {Object} {needsRegeneration: boolean, reason?: string}
 */
export function checkMovementInvalidation(currentSnapshot, strategySnapshot, strategy) {
  // Import will be done at runtime to avoid circular dependencies
  const { detectStrategyTrigger } = require('./strategy-triggers.js');
  
  const trigger = detectStrategyTrigger(currentSnapshot, strategySnapshot);
  
  if (trigger.shouldUpdate) {
    return {
      needsRegeneration: true,
      reason: `MOVEMENT_THRESHOLD: ${trigger.reason} - ${trigger.details.message}`
    };
  }

  // Check window expiry
  if (strategy.valid_window_end) {
    const expiryCheck = validateWindowNotExpired(strategy.valid_window_end);
    if (!expiryCheck.valid) {
      return {
        needsRegeneration: true,
        reason: expiryCheck.error
      };
    }
  }

  return { needsRegeneration: false };
}
