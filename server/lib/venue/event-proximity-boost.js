// server/lib/event-proximity-boost.js
// Event proximity scoring with impact/confidence/imminence decay
import { haversineDistanceMeters } from '../location/geo.js';

/**
 * Time decay function for event imminence
 * Returns ~1.0 if event is imminent/underway, decays exponentially with distance
 */
function timeDecay(startTimeIso, tauMin = 120) {
  if (!startTimeIso) return 0;
  
  const now = Date.now();
  const startTime = new Date(startTimeIso).getTime();
  const minutesUntilStart = Math.max(0, (startTime - now) / 60000);
  
  return Math.exp(-minutesUntilStart / Math.max(1, tauMin));
}

/**
 * Calculate event proximity boost for ranking
 * @param {Object} event - Event object from venue_events
 * @param {number} distanceMeters - Distance from candidate to event (0 for exact match)
 * @returns {number} Boost score (0-1+)
 */
function eventProximityBoost(event, distanceMeters = 0) {
  if (!event) return 0;
  
  // Environment configuration
  const W_EVENT = parseFloat(process.env.W_EVENT || '1.0');
  const EVENT_ASSOC_RADIUS_M = parseFloat(process.env.EVENT_ASSOC_RADIUS_M || '350');
  const EVENT_TAU_MIN = parseFloat(process.env.EVENT_TAU_MIN || '120');
  
  // Impact scoring
  const impactMap = {
    none: 0,
    low: 0.35,
    med: 0.65,
    high: 1.0
  };
  const impact = impactMap[event.impact_hint || 'none'] || 0;
  
  // Confidence (0-1)
  const confidence = Math.max(0, Math.min(1, event.confidence || 0.7));
  
  // Proximity factor (1.0 at exact match, decays to 0 at radius edge)
  const proximity = distanceMeters === 0 
    ? 1.0 
    : Math.max(0, Math.min(1, 1 - distanceMeters / EVENT_ASSOC_RADIUS_M));
  
  // Time imminence factor
  const imminence = timeDecay(event.start_time || event.start_time_iso, EVENT_TAU_MIN);
  
  // Badge presence bonus (small)
  const badgeBonus = event.badge ? 1 : 0;
  
  // Weighted combination
  const baseScore = (
    0.6 * impact +
    0.3 * imminence +
    0.1 * badgeBonus
  ) * confidence * Math.max(0.4, proximity);
  
  return W_EVENT * baseScore;
}

/**
 * Calculate staging node priority score
 * @param {Object} candidate - Candidate object
 * @param {number} nearbyVenuesOpenCount - Count of open venues within serve radius
 * @param {number} nearbyEventsHighCount - Count of high-impact events nearby
 * @returns {number} Staging priority boost (0-1+)
 */
function stagingPriority(candidate, nearbyVenuesOpenCount = 0, nearbyEventsHighCount = 0) {
  if (candidate.node_type !== 'staging') return 0;
  
  const W_STAGING = parseFloat(process.env.W_STAGING || '0.8');
  
  // Serve score: how many open venues this staging serves (saturates smoothly)
  const serveScore = Math.tanh(nearbyVenuesOpenCount / 6);
  
  // Events score: high-impact events boost staging priority
  const eventsScore = Math.min(1, nearbyEventsHighCount * 0.5);
  
  // Access status factor
  const accessMap = {
    available: 1.0,
    restricted: 0.4,
    unknown: 0.6
  };
  const access = accessMap[candidate.access_status] || 0.6;
  
  return W_STAGING * (
    0.6 * serveScore +
    0.3 * eventsScore +
    0.1 * access
  );
}

/**
 * Count open venues within radius of a point
 * @param {Object} anchorCoord - {lat, lng}
 * @param {Array} candidates - Array of candidate objects
 * @param {number} radiusMeters - Search radius
 * @returns {number} Count of open venues
 */
function countOpenVenuesWithinRadius(anchorCoord, candidates, radiusMeters = 250) {
  if (!anchorCoord?.lat || !anchorCoord?.lng) return 0;
  
  return candidates.filter(c => {
    if (c.node_type !== 'venue') return false;
    if (!c.is_open_now && c.is_open_now !== undefined) return false;
    if (!c.coords?.lat || !c.coords?.lng) return false;
    
    const dist = haversineDistanceMeters(
      anchorCoord.lat,
      anchorCoord.lng,
      c.coords.lat,
      c.coords.lng
    );
    
    return dist <= radiusMeters;
  }).length;
}

/**
 * Count high-impact events within radius
 * @param {Object} anchorCoord - {lat, lng}
 * @param {Array} candidates - Array of candidate objects with venue_events
 * @param {number} radiusMeters - Search radius
 * @returns {number} Count of high-impact events
 */
function countHighImpactEventsNearby(anchorCoord, candidates, radiusMeters = 350) {
  if (!anchorCoord?.lat || !anchorCoord?.lng) return 0;
  
  return candidates.filter(c => {
    if (!c.venue_events || !c.coords?.lat || !c.coords?.lng) return false;
    
    const dist = haversineDistanceMeters(
      anchorCoord.lat,
      anchorCoord.lng,
      c.coords.lat,
      c.coords.lng
    );
    
    if (dist > radiusMeters) return false;
    
    // Check if any events are high impact
    return c.venue_events.impact_hint === 'high' || c.venue_events.impact_hint === 'med';
  }).length;
}

export {
  eventProximityBoost,
  stagingPriority,
  countOpenVenuesWithinRadius,
  countHighImpactEventsNearby,
  timeDecay,
  haversineDistanceMeters as haversineDistance
};
