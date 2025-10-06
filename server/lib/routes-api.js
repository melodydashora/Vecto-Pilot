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

/**
 * Calculate traffic-aware distance and ETA using Routes API
 * @param {Object} origin - {lat, lng}
 * @param {Object} destination - {lat, lng}
 * @param {Object} options - {departureTime, trafficModel, travelMode}
 * @returns {Promise<{distanceMeters, durationSeconds, durationInTrafficSeconds}>}
 */
export async function getRouteWithTraffic(origin, destination, options = {}) {
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

    return {
      distanceMeters: route.distanceMeters || 0,
      durationSeconds, // With traffic
      staticDurationSeconds: staticDuration, // Without traffic
      trafficDelaySeconds: durationSeconds - staticDuration
    };
  } catch (error) {
    console.error('[Routes API] Request failed:', error.message);
    throw error;
  }
}

/**
 * Calculate multiple routes in batch (Compute Route Matrix)
 * @param {Array} origins - [{lat, lng}, ...]
 * @param {Array} destinations - [{lat, lng}, ...]
 * @param {Object} options - {departureTime, trafficModel, travelMode}
 * @returns {Promise<Array>} Array of {originIndex, destinationIndex, distanceMeters, durationSeconds}
 */
export async function getRouteMatrix(origins, destinations, options = {}) {
  const {
    departureTime = new Date().toISOString(),
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
        'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,status'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Route Matrix API] Error ${response.status}: ${errorText}`);
      throw new Error(`Route Matrix API failed: ${response.status}`);
    }

    const data = await response.json();

    return data.map(item => ({
      originIndex: item.originIndex,
      destinationIndex: item.destinationIndex,
      distanceMeters: item.distanceMeters || 0,
      durationSeconds: parseInt(item.duration?.replace('s', '') || '0'),
      status: item.status
    }));
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
