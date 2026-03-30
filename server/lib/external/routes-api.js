/**
 * ROUTES API - Traffic-Aware Distance & ETA Calculations
 *
 * Replaces haversine estimates with Google Maps Routes API for:
 * - Real-time traffic-aware ETAs
 * - Accurate road distance (not straight-line)
 * - Traffic models: TRAFFIC_AWARE (balanced speed/accuracy)
 *
 * Cost: $10 per 1,000 requests (Advanced tier with traffic)
 */

const ROUTES_API_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

// Simple in-memory cache for route calculations (prevents redundant API calls)
// Cache key format: "lat1,lng1|lat2,lng2" rounded to 3 decimals (~110m precision)
const routeCache = new Map();
const ROUTE_CACHE_TTL = 600000; // 10 minutes (traffic changes frequently)
const ROUTE_CACHE_MAX_SIZE = 500; // Max cache entries

/**
 * Calculate traffic-aware distance and ETA using Routes API
 * @param {Object} origin - {lat, lng}
 * @param {Object} destination - {lat, lng}
 * @param {Object} options - {departureTime, trafficModel, travelMode}
 * @returns {Promise<{distanceMeters: number, durationSeconds: number, staticDurationSeconds: number, trafficDelaySeconds: number}>}
 */
export async function getRouteWithTraffic(origin, destination, options = {}) {
  // 2026-01-05: Use 6-decimal precision to match canonical coord_key format
  // Previously used 3 decimals (~110m) but this caused inconsistencies
  const cacheKey = `${Number(origin.lat).toFixed(6)},${Number(origin.lng).toFixed(6)}|${Number(destination.lat).toFixed(6)},${Number(destination.lng).toFixed(6)}`;
  
  // Check cache first (with TTL check)
  const cached = routeCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < ROUTE_CACHE_TTL) {
    console.log(`[Routes API] Cache hit for ${cacheKey}`);
    return cached.data;
  }

  // Default to 30 seconds in the future (Routes API requires future timestamp)
  const futureTime = new Date(Date.now() + 30000).toISOString();

  const {
    departureTime = futureTime,
    trafficModel = 'TRAFFIC_AWARE', // TRAFFIC_UNAWARE, TRAFFIC_AWARE, TRAFFIC_AWARE_OPTIMAL
    travelMode = 'DRIVE'
  } = options;

  const requestBody = {
    origin: {
      location: {
        latLng: {
          latitude: origin.lat,
          longitude: origin.lng
        }
      }
    },
    destination: {
      location: {
        latLng: {
          latitude: destination.lat,
          longitude: destination.lng
        }
      }
    },
    travelMode,
    routingPreference: trafficModel,
    departureTime,
    computeAlternativeRoutes: false,
    routeModifiers: {
      avoidTolls: false,
      avoidHighways: false,
      avoidFerries: false
    }
  };

  try {
    const response = await fetch(ROUTES_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.staticDuration'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Routes API] Error ${response.status}: ${errorText}`);
      throw new Error(`Routes API failed: ${response.status}`);
    }

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      throw new Error('No routes found');
    }

    const route = data.routes[0];

    // Parse duration strings (e.g., "1234s" -> 1234)
    const durationSeconds = parseInt(route.duration?.replace('s', '') || '0');
    const staticDuration = parseInt(route.staticDuration?.replace('s', '') || durationSeconds);

    const result = {
      distanceMeters: route.distanceMeters || 0,
      durationSeconds, // With traffic
      staticDurationSeconds: staticDuration, // Without traffic
      trafficDelaySeconds: durationSeconds - staticDuration
    };
    
    // Cache the result
    routeCache.set(cacheKey, { data: result, timestamp: Date.now() });

    // Batch LRU eviction: remove 10% of oldest entries when cache exceeds limit
    // This prevents memory leaks under burst traffic
    if (routeCache.size > ROUTE_CACHE_MAX_SIZE) {
      const entriesToRemove = Math.ceil(ROUTE_CACHE_MAX_SIZE * 0.1);
      const keysToRemove = Array.from(routeCache.keys()).slice(0, entriesToRemove);
      keysToRemove.forEach(key => routeCache.delete(key));
      console.log(`[Routes API] Cache eviction: removed ${keysToRemove.length} entries, size now ${routeCache.size}`);
    }
    
    return result;
  } catch (error) {
    console.error('[Routes API] Request failed:', error.message);
    throw error;
  }
}

/**
 * Calculate multiple routes in batch (Compute Route Matrix)
 * OPTIMIZATION: 1 API call for N destinations instead of N calls
 *
 * @param {Array} origins - [{lat, lng}, ...] (typically just 1 - driver location)
 * @param {Array} destinations - [{lat, lng}, ...] (venue locations)
 * @param {Object} options - {departureTime, trafficModel, travelMode}
 * @returns {Promise<Array>} Array of {originIndex, destinationIndex, distanceMeters, durationSeconds}
 */
export async function getRouteMatrix(origins, destinations, options = {}) {
  // Default to 30 seconds in the future (Routes API requires future timestamp)
  const futureTime = new Date(Date.now() + 30000).toISOString();

  const {
    departureTime = futureTime,
    trafficModel = 'TRAFFIC_AWARE',
    travelMode = 'DRIVE'
  } = options;

  const requestBody = {
    origins: origins.map(o => ({
      waypoint: {
        location: {
          latLng: {
            latitude: o.lat,
            longitude: o.lng
          }
        }
      }
    })),
    destinations: destinations.map(d => ({
      waypoint: {
        location: {
          latLng: {
            latitude: d.lat,
            longitude: d.lng
          }
        }
      }
    })),
    travelMode,
    routingPreference: trafficModel,
    departureTime
  };

  try {
    const response = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,status,condition'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Route Matrix API] Error ${response.status}: ${errorText}`);
      throw new Error(`Route Matrix API failed: ${response.status}`);
    }

    // Route Matrix API can return either:
    // 1. JSON array (pretty-printed) - single parseable JSON
    // 2. NDJSON (newline-delimited) - each line is a JSON object
    const text = await response.text();

    let items = [];

    // First, try parsing as a complete JSON array
    try {
      const parsed = JSON.parse(text);
      items = Array.isArray(parsed) ? parsed : [parsed];
    } catch (_jsonErr) {
      // Fallback: Try NDJSON format (one JSON object per line)
      const lines = text.trim().split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          items.push(item);
        } catch (_lineErr) {
          // Skip unparseable lines (could be partial JSON from pretty-printing)
        }
      }
    }

    if (items.length === 0) {
      console.error('[Route Matrix API] Could not parse response:', text.substring(0, 500));
      throw new Error('Route Matrix API returned no valid results');
    }

    // Normalize the results
    const results = items.map(item => ({
      originIndex: item.originIndex || 0,
      destinationIndex: item.destinationIndex || 0,
      distanceMeters: item.distanceMeters || 0,
      durationSeconds: parseInt(item.duration?.replace('s', '') || '0'),
      status: item.status?.code || item.condition || 'OK'
    }));

    return results;
  } catch (error) {
    console.error('[Route Matrix API] Request failed:', error.message);
    throw error;
  }
}

/**
 * Convenience wrapper: Get drive time in minutes with traffic
 * @param {Object} origin - {lat, lng}
 * @param {Object} destination - {lat, lng}
 * @returns {Promise<{minutes, distanceMiles, trafficDelayMinutes}>}
 */
export async function predictDriveMinutesWithTraffic(origin, destination) {
  try {
    const result = await getRouteWithTraffic(origin, destination, {
      trafficModel: 'TRAFFIC_AWARE' // Balanced speed/accuracy
    });

    return {
      minutes: Math.round(result.durationSeconds / 60),
      distanceMiles: (result.distanceMeters / 1609.344).toFixed(1),
      trafficDelayMinutes: Math.round(result.trafficDelaySeconds / 60),
      distanceMeters: result.distanceMeters
    };
  } catch (error) {
    console.error('[predictDriveMinutesWithTraffic] Failed:', error.message);
    throw error;
  }
}
