// server/lib/traffic/tomtom.js
// ============================================================================
// TOMTOM TRAFFIC API INTEGRATION
// ============================================================================
//
// PURPOSE: Fetch real-time traffic data from TomTom for Gemini processing
//
// ARCHITECTURE (2026-01-14):
//   1. fetchRawTraffic() - Returns raw TomTom API data for AI processing
//   2. getTomTomTraffic() - Returns processed/prioritized traffic data
//   3. getTomTomTrafficForCity() - Convenience wrapper with city context
//
// USAGE:
//   import { fetchRawTraffic, getTomTomTraffic } from '../traffic/tomtom.js';
//
//   // For Gemini processing (raw data)
//   const rawTraffic = await fetchRawTraffic(lat, lng, 10);
//   const briefing = await generateTrafficBriefing(rawTraffic);
//
//   // For direct use (pre-processed)
//   const { traffic } = await getTomTomTraffic({ lat, lon, city, state });
//
// DOCS: https://developer.tomtom.com/traffic-api/documentation/traffic-incidents
// FREE TIER: 2,500 requests/day
// ============================================================================

import { briefingLog, OP } from '../../logger/workflow.js';

const TOMTOM_API_KEY = process.env.TOMTOM_API_KEY;
const TOMTOM_BASE_URL = 'https://api.tomtom.com/traffic/services/5';
const TOMTOM_FLOW_URL = 'https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/10/json';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @returns {number} - Distance in miles
 */
function calculateDistanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Create a bounding box around coordinates
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {number} radiusMiles - Radius in miles (default 10)
 * @returns {string} - bbox string: minLon,minLat,maxLon,maxLat
 */
function createBoundingBox(lat, lon, radiusMiles = 10) {
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

// Road type priority for ranking (higher = more important to drivers)
const ROAD_PRIORITY = {
  'I-': 100, 'M-': 100, 'A-': 90, 'E-': 95,
  'US-': 90, 'SR-': 80, 'SH-': 80, 'HWY': 70, 'HIGHWAY': 70, 'ROUTE': 70,
  'TOLLWAY': 85, 'TOLL': 85, 'TURNPIKE': 85, 'PIKE': 80,
  'EXPRESSWAY': 80, 'EXPWY': 80, 'FREEWAY': 85, 'FWY': 85,
  'PKWY': 65, 'PARKWAY': 65, 'BLVD': 50, 'BOULEVARD': 50,
  'AVE': 35, 'AVENUE': 35, 'RD': 30, 'ROAD': 30,
  'DR': 25, 'DRIVE': 25, 'ST': 25, 'STREET': 25,
  'WAY': 20, 'LN': 15, 'LANE': 15, 'CT': 10, 'COURT': 10,
  'CIR': 10, 'CIRCLE': 10, 'PL': 10, 'PLACE': 10,
};

/**
 * Calculate road priority score based on road name/number
 */
function getRoadPriority(roadName, roadNumbers) {
  let maxPriority = 0;

  if (roadNumbers && roadNumbers.length > 0) {
    for (const road of roadNumbers) {
      const upperRoad = road.toUpperCase();
      for (const [prefix, priority] of Object.entries(ROAD_PRIORITY)) {
        if (upperRoad.includes(prefix) || upperRoad.startsWith(prefix)) {
          maxPriority = Math.max(maxPriority, priority);
        }
      }
      if (/^[A-Z]{2}-\d+/.test(upperRoad)) maxPriority = Math.max(maxPriority, 80);
      if (/^FM-\d+/.test(upperRoad)) maxPriority = Math.max(maxPriority, 60);
      if (/^(CR|CO)-\d+/.test(upperRoad)) maxPriority = Math.max(maxPriority, 45);
    }
  }

  if (roadName) {
    const upperName = roadName.toUpperCase();
    for (const [prefix, priority] of Object.entries(ROAD_PRIORITY)) {
      if (upperName.includes(prefix)) maxPriority = Math.max(maxPriority, priority);
    }
    if (upperName.includes('MOTORWAY') || upperName.includes('AUTOBAHN') ||
        upperName.includes('AUTOROUTE') || upperName.includes('AUTOPISTA')) {
      maxPriority = Math.max(maxPriority, 100);
    }
  }

  return maxPriority || 15;
}

/**
 * Calculate overall incident priority for sorting
 */
function calculateIncidentPriority(incident) {
  const roadPriority = getRoadPriority(incident.location, incident.road ? [incident.road] : []);
  const magnitudeScore = { 'Major': 40, 'Moderate': 25, 'Minor': 10, 'Unknown': 5 }[incident.magnitude] || 5;
  const categoryScore = {
    'Road Closed': 35, 'Road Works': 30, 'Accident': 25,
    'Lane Closed': 20, 'Jam': 15, 'Flooding': 30, 'Dangerous Conditions': 20,
  }[incident.category] || 10;
  const delayScore = Math.min(incident.delayMinutes || 0, 30);
  return roadPriority + magnitudeScore + categoryScore + delayScore;
}

// ============================================================================
// EXPORTED FUNCTIONS
// ============================================================================

/**
 * Fetch raw traffic data from TomTom (for Gemini processing)
 *
 * 2026-01-14: New function for AI pipeline integration
 * Returns raw API response data that can be passed to Gemini for analysis.
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} radiusMiles - Search radius (default 10 miles)
 * @returns {Promise<{flowSegmentData: Object|null, incidents: Array, bbox: string, fetchedAt: string}>}
 */
export async function fetchRawTraffic(lat, lng, radiusMeters = 5000) {
  // 2026-01-14: Phase 3 Intelligence Hardening - simplified raw data fetch for Gemini
  // Returns null instead of throwing to allow graceful degradation
  if (!TOMTOM_API_KEY) {
    console.warn('[TomTom] API Key missing. Returning null.');
    return null;
  }

  if (!lat || !lng) {
    console.warn('[TomTom] Coordinates required. Returning null.');
    return null;
  }

  try {
    // 1. Get Flow Segment Data (Current speed vs Free flow)
    const flowUrl = `${TOMTOM_FLOW_URL}?point=${lat},${lng}&unit=mph&key=${TOMTOM_API_KEY}`;
    const flowRes = await fetch(flowUrl);
    const flowData = flowRes.ok ? await flowRes.json() : null;

    // 2. Get Incidents (Accidents, Jams, Roadworks)
    // Convert radius meters to bbox (rough degree conversion)
    const offset = radiusMeters / 111320;
    const bbox = `${lng - offset},${lat - offset},${lng + offset},${lat + offset}`;

    const incidentsFields = '{incidents{type,geometry{type,coordinates},properties{iconCategory,magnitudeOfDelay,events{description},startTime,endTime,from,to,roadNumbers}}}';
    const incUrl = `${TOMTOM_BASE_URL}/incidentDetails?bbox=${bbox}&fields=${encodeURIComponent(incidentsFields)}&language=en-US&key=${TOMTOM_API_KEY}`;
    const incRes = await fetch(incUrl);
    const incData = incRes.ok ? await incRes.json() : null;

    briefingLog.phase(1, `TomTom raw: flow=${!!flowData?.flowSegmentData}, incidents=${incData?.incidents?.length || 0}`, OP.API);

    return {
      flow: flowData?.flowSegmentData || null,
      incidents: incData?.incidents || []
    };
  } catch (error) {
    console.error('[TomTom] Error fetching traffic:', error);
    return null;
  }
}

/**
 * Fetch raw traffic with extended metadata (backwards compatible)
 * Use this when you need bbox and metadata alongside raw data
 */
export async function fetchRawTrafficExtended(lat, lng, radiusMiles = 10) {
  const radiusMeters = radiusMiles * 1609.34;
  const rawData = await fetchRawTraffic(lat, lng, radiusMeters);

  if (!rawData) return null;

  const bbox = createBoundingBox(lat, lng, radiusMiles);

  return {
    flowSegmentData: rawData.flow,
    incidents: rawData.incidents,
    bbox,
    radiusMiles,
    driverLocation: { lat, lng },
    fetchedAt: new Date().toISOString()
  };
}

/**
 * Get real-time traffic incidents from TomTom (processed)
 *
 * Returns fully processed and prioritized traffic data ready for display.
 * Use this when you don't need AI analysis.
 *
 * @param {Object} params - Request parameters
 * @param {number} params.lat - Latitude
 * @param {number} params.lon - Longitude
 * @param {number} params.radiusMiles - Search radius in miles (default 10)
 * @param {number} params.maxDistanceMiles - Maximum distance from driver (default 10)
 * @param {string} params.city - City name (for logging)
 * @param {string} params.state - State name (for logging)
 * @returns {Promise<Object>} - Traffic incidents and conditions
 */
export async function getTomTomTraffic({ lat, lon, radiusMiles = 10, maxDistanceMiles = 10, city, state }) {
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

  const location = city && state ? `${city}, ${state}` : `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  briefingLog.ai(1, 'TomTom', `traffic for ${location}`);
  const startTime = Date.now();

  try {
    const bbox = createBoundingBox(lat, lon, radiusMiles);
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

    // Parse incidents into useful format with priority scoring
    const parsedIncidents = rawIncidents.map(inc => {
      const props = inc.properties || {};
      const category = CATEGORY_LABELS[props.iconCategory] || 'Unknown';
      const magnitude = MAGNITUDE_LABELS[props.magnitudeOfDelay] || 'Unknown';
      const description = props.events?.map(e => e.description).join('; ') || category;
      const roadNumbers = props.roadNumbers || [];
      const road = roadNumbers.join(', ') || '';
      const fromTo = props.from && props.to ? `${props.from} to ${props.to}` : '';
      const delayMinutes = props.delay ? Math.round(props.delay / 60) : 0;
      const lengthMiles = props.length ? parseFloat((props.length / 1609.34).toFixed(1)) : null;

      // Get incident coordinates
      let incidentLat = null;
      let incidentLon = null;
      if (inc.geometry?.coordinates) {
        const coords = inc.geometry.coordinates;
        if (Array.isArray(coords[0])) {
          incidentLon = coords[0][0];
          incidentLat = coords[0][1];
        } else {
          incidentLon = coords[0];
          incidentLat = coords[1];
        }
      }

      // Calculate distance from driver
      let distanceFromDriver = null;
      if (incidentLat !== null && incidentLon !== null && lat && lon) {
        distanceFromDriver = parseFloat(calculateDistanceMiles(lat, lon, incidentLat, incidentLon).toFixed(1));
      }

      const incident = {
        id: props.id, category, magnitude, description, road, roadNumbers,
        location: fromTo, from: props.from || '', to: props.to || '',
        delayMinutes, lengthMiles, startTime: props.startTime, endTime: props.endTime,
        city: city || null, state: state || null,
        distanceFromDriver, incidentLat, incidentLon,
      };

      incident.priority = calculateIncidentPriority(incident);
      incident.isHighway = getRoadPriority(incident.location, roadNumbers) >= 60;

      const distanceStr = distanceFromDriver !== null ? ` [${distanceFromDriver} mi]` : '';
      incident.displayDescription = road
        ? `${category}: ${road} (${fromTo})${distanceStr}`
        : `${category}: ${fromTo}${distanceStr}`;

      return incident;
    });

    // Deduplicate reverse-direction incidents
    const seenPairs = new Set();
    const deduplicatedIncidents = parsedIncidents.filter(inc => {
      if (!inc.from || !inc.to) return true;
      const endpoints = [inc.from.toLowerCase().trim(), inc.to.toLowerCase().trim()].sort();
      const pairKey = `${inc.category}|${endpoints[0]}|${endpoints[1]}`;
      if (seenPairs.has(pairKey)) return false;
      seenPairs.add(pairKey);
      return true;
    });

    // Filter by distance
    const distanceFilteredIncidents = deduplicatedIncidents.filter(inc => {
      if (inc.distanceFromDriver === null) return true;
      return inc.distanceFromDriver <= maxDistanceMiles;
    });

    const filteredOutCount = deduplicatedIncidents.length - distanceFilteredIncidents.length;
    if (filteredOutCount > 0) {
      briefingLog.phase(1, `Traffic: filtered ${filteredOutCount} incidents beyond ${maxDistanceMiles} mi`, OP.AI);
    }

    // Sort by priority
    const sortedIncidents = distanceFilteredIncidents.sort((a, b) => b.priority - a.priority);

    // Categorize
    const highwayIncidents = sortedIncidents.filter(i => i.isHighway);
    const constructionIncidents = sortedIncidents.filter(i => i.category === 'Road Works');
    const closureIncidents = sortedIncidents.filter(i => i.category === 'Road Closed' || i.category === 'Lane Closed');
    const jamIncidents = sortedIncidents.filter(i => i.category === 'Jam');
    const accidentIncidents = sortedIncidents.filter(i => i.category === 'Accident');

    // Calculate congestion level
    let congestionLevel = 'light';
    const majorIncidents = sortedIncidents.filter(i => i.magnitude === 'Major').length;
    const moderateIncidents = sortedIncidents.filter(i => i.magnitude === 'Moderate').length;
    const highwayClosures = closureIncidents.filter(i => i.isHighway).length;

    if (majorIncidents >= 2 || jamIncidents.length >= 5 || highwayClosures >= 1) {
      congestionLevel = 'heavy';
    } else if (majorIncidents >= 1 || moderateIncidents >= 3 || jamIncidents.length >= 2) {
      congestionLevel = 'moderate';
    }

    // Generate summary
    const locationContext = city ? ` near ${city}` : '';
    let summary = `${sortedIncidents.length} active traffic incidents${locationContext}`;
    if (jamIncidents.length > 0) summary += `, ${jamIncidents.length} traffic jams`;
    if (closureIncidents.length > 0) summary += `, ${closureIncidents.length} road closures`;
    if (constructionIncidents.length > 0) summary += `, ${constructionIncidents.length} construction zones`;
    if (sortedIncidents.length === 0) {
      summary = `Traffic flowing smoothly${locationContext}, no incidents reported`;
      congestionLevel = 'light';
    }

    const prioritizedForDisplay = sortedIncidents.slice(0, 15);
    const elapsedMs = Date.now() - startTime;
    briefingLog.done(1, `Traffic: ${congestionLevel}, ${sortedIncidents.length} incidents (${elapsedMs}ms)`, OP.AI);

    return {
      traffic: {
        summary,
        incidents: prioritizedForDisplay,
        allIncidents: sortedIncidents,
        congestionLevel,
        totalIncidents: sortedIncidents.length,
        stats: {
          total: sortedIncidents.length,
          highways: highwayIncidents.length,
          construction: constructionIncidents.length,
          closures: closureIncidents.length,
          jams: jamIncidents.length,
          accidents: accidentIncidents.length,
          major: majorIncidents,
        },
        majorIncidents,
        jams: jamIncidents.length,
        closures: closureIncidents.length,
        source: 'tomtom',
        city: city || null,
        state: state || null,
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
 * Get traffic for a city (convenience wrapper)
 * @param {Object} params - { city, state, lat, lon, radiusMiles }
 * @returns {Promise<Object>} - Traffic data
 */
export async function getTomTomTrafficForCity({ city, state, lat, lon, radiusMiles = 15 }) {
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
