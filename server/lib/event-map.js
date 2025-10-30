// server/lib/event-map.js
// Canonical event lookup with placeId primary + name|address fallback
// Fixes "NO event data found in map" errors from placeId mismatches

/**
 * Normalize string for comparison
 * @param {string} s - String to normalize
 * @returns {string} Trimmed, lowercase string
 */
const norm = s => String(s ?? '').trim();

/**
 * Generate secondary key from venue name and address
 * @param {string} name - Venue name
 * @param {string} address - Venue address
 * @returns {string} Normalized "name|address" key
 */
const key2 = (name, address) => (norm(name) + '|' + norm(address)).toLowerCase();

/**
 * Build event lookup maps from fetched events
 * Creates two indexes: placeId and name|address
 * 
 * @param {Array} events - Array of event objects with placeId, name, address
 * @returns {Object} { byPlaceId: Map, byNameAddr: Map }
 */
export function buildEventMap(events) {
  const byPlaceId = new Map();
  const byNameAddr = new Map();
  
  for (const ev of events) {
    // Primary index: placeId
    const pid = norm(ev.placeId);
    if (pid) {
      byPlaceId.set(pid, ev);
    }
    
    // Secondary index: name|address (fallback for missing placeIds)
    const k2 = key2(ev.name, ev.address);
    if (k2 && k2 !== '|') {  // Avoid empty key
      byNameAddr.set(k2, ev);
    }
  }
  
  return { byPlaceId, byNameAddr };
}

/**
 * Find events for a venue using canonical lookup chain
 * 
 * Lookup order:
 * 1. Direct placeId match
 * 2. Alias placeId match (if provided)
 * 3. Fallback to name|address match
 * 
 * @param {Object} venue - Venue object { placeId, name, address }
 * @param {Object} map - Event map from buildEventMap()
 * @param {Map} aliases - Optional placeId alias map (for variations)
 * @returns {Object|null} Event object or null if not found
 */
export function findEventsForVenue(venue, map, aliases = new Map()) {
  const pid = norm(venue.placeId);
  const alias = aliases.get(pid);
  
  // Try direct placeId + alias
  for (const id of [pid, norm(alias)].filter(Boolean)) {
    const hit = map.byPlaceId.get(id);
    if (hit) {
      return hit;
    }
  }
  
  // Fallback to name|address
  const fallbackKey = key2(venue.name, venue.address);
  const fallbackHit = map.byNameAddr.get(fallbackKey);
  
  if (fallbackHit) {
    return fallbackHit;
  }
  
  // No match found
  return null;
}

/**
 * Log a sample of keys for debugging mismatches
 * Call this when findEventsForVenue returns null to understand why
 * 
 * @param {Object} venue - Venue that failed to match
 * @param {Object} map - Event map
 */
export function logMissForDebug(venue, map) {
  const pid = norm(venue.placeId);
  const k2 = key2(venue.name, venue.address);
  
  console.warn(`[event-map] MISS for venue:`, {
    placeId: pid,
    nameAddrKey: k2,
    availablePlaceIds: Array.from(map.byPlaceId.keys()).slice(0, 5),
    availableNameAddrKeys: Array.from(map.byNameAddr.keys()).slice(0, 5)
  });
}
