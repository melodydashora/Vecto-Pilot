/**
 * STRATEGY TRIGGERS
 * 
 * Detects when to re-assess driver strategy:
 * 1. Day_part changes (morning → afternoon)
 * 2. Significant coord movement (>2 miles)
 * 3. Manual refresh
 */

import { haversineKm } from './geo.js';

const COORD_DELTA_THRESHOLD_KM = 3.2; // ~2 miles

/**
 * Detect if strategy needs re-assessment
 * @param {Object} currentSnapshot - Current location snapshot
 * @param {Object} lastSnapshot - Last snapshot used for strategy
 * @returns {Object} {shouldUpdate: boolean, reason: string, details: Object}
 */
export function detectStrategyTrigger(currentSnapshot, lastSnapshot) {
  // First request - always update
  if (!lastSnapshot) {
    return {
      shouldUpdate: true,
      reason: 'initial_load',
      details: { message: 'First strategy generation' }
    };
  }

  // Check 1: Day_part changed?
  const dayPartChanged = currentSnapshot.day_part_key !== lastSnapshot.last_strategy_day_part;
  if (dayPartChanged) {
    return {
      shouldUpdate: true,
      reason: 'day_part_change',
      details: {
        from: lastSnapshot.last_strategy_day_part,
        to: currentSnapshot.day_part_key,
        message: `Day part shifted from ${lastSnapshot.last_strategy_day_part} to ${currentSnapshot.day_part_key}`
      }
    };
  }

  // Check 2: Coords moved significantly?
  const distanceKm = haversineKm(
    { lat: lastSnapshot.lat, lng: lastSnapshot.lng },
    { lat: currentSnapshot.lat, lng: currentSnapshot.lng }
  );
  
  if (distanceKm >= COORD_DELTA_THRESHOLD_KM) {
    return {
      shouldUpdate: true,
      reason: 'coord_delta',
      details: {
        distance_km: distanceKm.toFixed(2),
        distance_miles: (distanceKm * 0.621371).toFixed(2),
        threshold_km: COORD_DELTA_THRESHOLD_KM,
        message: `Moved ${(distanceKm * 0.621371).toFixed(1)} miles (threshold: 2 miles)`
      }
    };
  }

  // No trigger met
  return {
    shouldUpdate: false,
    reason: 'no_trigger',
    details: {
      same_day_part: currentSnapshot.day_part_key,
      distance_km: distanceKm.toFixed(2),
      message: 'No significant change detected'
    }
  };
}

/**
 * Get human-readable trigger message for UI
 * @param {string} triggerReason - Trigger reason from detectStrategyTrigger
 * @param {Object} details - Details object from trigger
 * @returns {string} UI-friendly message
 */
export function getTriggerMessage(triggerReason, details) {
  switch (triggerReason) {
    case 'initial_load':
      return '📍 Finding best hotspots for your location...';
    
    case 'day_part_change':
      return `⏰ ${details.to} shift detected - Updating strategy...`;
    
    case 'coord_delta':
      return `🚗 You've moved ${details.distance_miles} mi - Finding new hotspots...`;
    
    case 'manual_refresh':
      return '🔄 Refreshing strategy with latest data...';
    
    default:
      return '💡 Analyzing current conditions...';
  }
}

/**
 * Determine if we should discover new venues (20% exploration rate)
 * @param {number} randomSeed - Random value 0-1 (use Math.random())
 * @returns {boolean} True if should explore new venues
 */
export function shouldExploreNewVenues(randomSeed = Math.random()) {
  const EXPLORATION_RATE = 0.2; // 20% of the time, ask LLM for new suggestions
  return randomSeed < EXPLORATION_RATE;
}

/**
 * Calculate time since last strategy update
 * @param {Date} lastUpdateTime - Last strategy generation time
 * @returns {Object} {minutes: number, shouldForceUpdate: boolean}
 */
export function timeSinceLastUpdate(lastUpdateTime) {
  if (!lastUpdateTime) {
    return { minutes: Infinity, shouldForceUpdate: true };
  }

  const now = new Date();
  const diffMs = now - new Date(lastUpdateTime);
  const diffMinutes = Math.floor(diffMs / 60000);

  // Force update after 30 minutes of no strategy change
  const shouldForceUpdate = diffMinutes >= 30;

  return {
    minutes: diffMinutes,
    shouldForceUpdate,
    message: shouldForceUpdate ? 'Strategy stale (>30 min) - forcing update' : null
  };
}

/**
 * Check if driver is near a major airport (within 15 miles)
 * @param {number} latitude - Driver latitude
 * @param {number} longitude - Driver longitude
 * @returns {Promise<Object|null>} Airport info if nearby, null otherwise
 */
export async function checkAirportProximity(latitude, longitude) {
  const { getNearestMajorAirport } = await import('./faa-asws.js');
  const AIRPORT_PROXIMITY_THRESHOLD = 25; // miles (expanded for suburban metro areas)
  
  const nearest = await getNearestMajorAirport(latitude, longitude, AIRPORT_PROXIMITY_THRESHOLD);
  return nearest;
}
