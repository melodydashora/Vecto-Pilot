// server/lib/external/tomtom-traffic.js
// TomTom Traffic API integration for real-time traffic conditions
//
// Docs: https://developer.tomtom.com/traffic-api/documentation/traffic-incidents/incident-details
// Free tier: 2,500 requests/day
// Updates: Every minute with latest traffic data

import { briefingLog, OP } from '../../logger/workflow.js';

const TOMTOM_API_KEY = process.env.TOMTOM_API_KEY;
const TOMTOM_BASE_URL = 'https://api.tomtom.com/traffic/services/5';

// Incident category mapping for display
const CATEGORY_LABELS = {
  0: 'Unknown',
  1: 'Accident',
  2: 'Fog',
  3: 'Dangerous Conditions',
  4: 'Rain',
  5: 'Ice',
  6: 'Jam',
  7: 'Lane Closed',
  8: 'Road Closed',
  9: 'Road Works',
  10: 'Wind',
  11: 'Flooding',
  14: 'Broken Down Vehicle',
};

// Severity/magnitude mapping
const MAGNITUDE_LABELS = {
  0: 'Unknown',
  1: 'Minor',
  2: 'Moderate',
  3: 'Major',
  4: 'Undefined',
};

/**
 * Create a bounding box around coordinates
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {number} radiusMiles - Radius in miles (default 10)
 * @returns {string} - bbox string: minLon,minLat,maxLon,maxLat
 */
function createBoundingBox(lat, lon, radiusMiles = 10) {
  // Approximate degrees per mile
  const latDegPerMile = 1 / 69;
  const lonDegPerMile = 1 / (69 * Math.cos(lat * Math.PI / 180));

  const latDelta = radiusMiles * latDegPerMile;
  const lonDelta = radiusMiles * lonDegPerMile;

  const minLon = (lon - lonDelta).toFixed(6);
  const minLat = (lat - latDelta).toFixed(6);
  const maxLon = (lon + lonDelta).toFixed(6);
  const maxLat = (lat + latDelta).toFixed(6);

  return `${minLon},${minLat},${maxLon},${maxLat}`;
}

/**
 * Get real-time traffic incidents from TomTom
 * @param {Object} params - Request parameters
 * @param {number} params.lat - Latitude
 * @param {number} params.lon - Longitude
 * @param {number} params.radiusMiles - Search radius in miles (default 10)
 * @param {string} params.city - City name (for logging)
 * @param {string} params.state - State name (for logging)
 * @returns {Promise<Object>} - Traffic incidents and conditions
 */
export async function getTomTomTraffic({ lat, lon, radiusMiles = 10, city, state }) {
  if (!TOMTOM_API_KEY) {
    return {
      traffic: {
        summary: 'Traffic data unavailable (TomTom not configured)',
        incidents: [],
        congestionLevel: 'unknown',
        source: 'tomtom',
      },
      error: 'TOMTOM_API_KEY not configured',
    };
  }

  const location = city && state ? `${city}, ${state}` : `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  briefingLog.ai(1, 'TomTom', `traffic for ${location}`);
  const startTime = Date.now();

  try {
    const bbox = createBoundingBox(lat, lon, radiusMiles);

    // Fields parameter to get road names and details
    const fields = '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code},startTime,endTime,from,to,length,delay,roadNumbers}}}';
    const url = `${TOMTOM_BASE_URL}/incidentDetails?key=${TOMTOM_API_KEY}&bbox=${bbox}&language=en-US&timeValidityFilter=present&fields=${encodeURIComponent(fields)}`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[TomTom] API error: ${response.status} - ${errorText}`);
      return {
        traffic: {
          summary: `Traffic data error for ${location}`,
          incidents: [],
          congestionLevel: 'unknown',
          source: 'tomtom',
        },
        error: `TomTom API error: ${response.status}`,
      };
    }

    const data = await response.json();
    const rawIncidents = data.incidents || [];

    // Parse incidents into useful format
    const parsedIncidents = rawIncidents.map(inc => {
      const props = inc.properties || {};
      const category = CATEGORY_LABELS[props.iconCategory] || 'Unknown';
      const magnitude = MAGNITUDE_LABELS[props.magnitudeOfDelay] || 'Unknown';

      // Get description from events
      const description = props.events?.map(e => e.description).join('; ') || category;

      // Format road info
      const road = props.roadNumbers?.join(', ') || '';
      const fromTo = props.from && props.to ? `${props.from} to ${props.to}` : '';

      // Delay in minutes
      const delayMinutes = props.delay ? Math.round(props.delay / 60) : 0;

      // Length in miles
      const lengthMiles = props.length ? (props.length / 1609.34).toFixed(1) : null;

      return {
        id: props.id,
        category,
        magnitude,
        description,
        road,
        location: fromTo,
        from: props.from || '',
        to: props.to || '',
        delayMinutes,
        lengthMiles,
        startTime: props.startTime,
        endTime: props.endTime,
      };
    });

    // Deduplicate reverse-direction incidents (e.g., "A to B" and "B to A" are the same closure)
    const seenPairs = new Set();
    const incidents = parsedIncidents.filter(inc => {
      if (!inc.from || !inc.to) return true; // Keep incidents without from/to

      // Create a normalized key that's the same regardless of direction
      // Sort the two endpoints alphabetically to get consistent key
      const endpoints = [inc.from.toLowerCase().trim(), inc.to.toLowerCase().trim()].sort();
      const pairKey = `${inc.category}|${endpoints[0]}|${endpoints[1]}`;

      if (seenPairs.has(pairKey)) {
        return false; // Skip this duplicate
      }

      seenPairs.add(pairKey);
      return true;
    });

    // Calculate overall congestion level based on incidents
    let congestionLevel = 'light';
    const majorIncidents = incidents.filter(i => i.magnitude === 'Major').length;
    const moderateIncidents = incidents.filter(i => i.magnitude === 'Moderate').length;
    const jams = incidents.filter(i => i.category === 'Jam').length;
    const closures = incidents.filter(i => i.category === 'Road Closed' || i.category === 'Lane Closed').length;

    if (majorIncidents >= 2 || jams >= 5 || closures >= 2) {
      congestionLevel = 'heavy';
    } else if (majorIncidents >= 1 || moderateIncidents >= 3 || jams >= 2) {
      congestionLevel = 'moderate';
    }

    // Generate summary
    let summary = `${incidents.length} active traffic incidents`;
    if (jams > 0) summary += `, ${jams} traffic jams`;
    if (closures > 0) summary += `, ${closures} road closures`;
    if (incidents.length === 0) {
      summary = 'Traffic flowing smoothly, no incidents reported';
      congestionLevel = 'light';
    }

    const elapsedMs = Date.now() - startTime;
    briefingLog.done(1, `Traffic: ${congestionLevel}, ${incidents.length} incidents (${elapsedMs}ms)`, OP.AI);

    return {
      traffic: {
        summary,
        incidents,
        congestionLevel,
        totalIncidents: incidents.length,
        majorIncidents,
        jams,
        closures,
        source: 'tomtom',
        bbox,
        radiusMiles,
        fetchedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    console.error('[TomTom] Traffic request failed:', error);
    briefingLog.warn(1, `TomTom error: ${error.message}`, OP.AI);

    return {
      traffic: {
        summary: `Traffic data error for ${location}`,
        incidents: [],
        congestionLevel: 'unknown',
        source: 'tomtom',
      },
      error: error.message,
    };
  }
}

/**
 * Get traffic for a city using geocoding
 * Falls back to city center coordinates if no lat/lon provided
 * @param {Object} params - Request parameters
 * @param {string} params.city - City name
 * @param {string} params.state - State name
 * @param {number} params.lat - Optional latitude (uses city center if not provided)
 * @param {number} params.lon - Optional longitude
 * @param {number} params.radiusMiles - Search radius (default 15 for city-wide)
 * @returns {Promise<Object>} - Traffic data
 */
export async function getTomTomTrafficForCity({ city, state, lat, lon, radiusMiles = 15 }) {
  // If no coordinates provided, we'd need to geocode
  // For now, require coordinates (they should come from the snapshot)
  if (!lat || !lon) {
    return {
      traffic: {
        summary: `Traffic data unavailable - no coordinates for ${city}, ${state}`,
        incidents: [],
        congestionLevel: 'unknown',
        source: 'tomtom',
      },
      error: 'Coordinates required for TomTom traffic lookup',
    };
  }

  return getTomTomTraffic({ lat, lon, radiusMiles, city, state });
}
