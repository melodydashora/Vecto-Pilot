// server/lib/external/tomtom-traffic.js
// TomTom Traffic API integration for real-time traffic conditions
//
// Docs: https://developer.tomtom.com/traffic-api/documentation/traffic-incidents/incident-details
// Free tier: 2,500 requests/day
// Updates: Every minute with latest traffic data

import { briefingLog, OP } from '../../logger/workflow.js';

const TOMTOM_API_KEY = process.env.TOMTOM_API_KEY;
const TOMTOM_BASE_URL = 'https://api.tomtom.com/traffic/services/5';

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
// Global patterns that work across US/international roads
const ROAD_PRIORITY = {
  // Interstates & Motorways (highest priority)
  'I-': 100,       // US Interstate (I-35, I-95)
  'M-': 100,       // UK Motorway (M1, M25)
  'A-': 90,        // European A-roads / UK A-roads
  'E-': 95,        // European E-roads

  // US Highways
  'US-': 90,       // US Highway (US-75, US-1)
  'SR-': 80,       // State Route (generic)
  'SH-': 80,       // State Highway
  'HWY': 70,       // Generic highway
  'HIGHWAY': 70,
  'ROUTE': 70,

  // State-specific patterns (handled dynamically)
  // Two-letter state codes followed by dash (TX-, CA-, NY-, FL-)
  // Will be matched by pattern check below

  // Toll roads (high priority - usually major arterials)
  'TOLLWAY': 85,
  'TOLL': 85,
  'TURNPIKE': 85,
  'PIKE': 80,
  'EXPRESSWAY': 80,
  'EXPWY': 80,
  'FREEWAY': 85,
  'FWY': 85,

  // Secondary roads
  'PKWY': 65,      // Parkway
  'PARKWAY': 65,
  'BLVD': 50,      // Boulevard
  'BOULEVARD': 50,
  'AVE': 35,       // Avenue
  'AVENUE': 35,
  'RD': 30,        // Road
  'ROAD': 30,
  'DR': 25,        // Drive
  'DRIVE': 25,
  'ST': 25,        // Street
  'STREET': 25,
  'WAY': 20,       // Way
  'LN': 15,        // Lane
  'LANE': 15,
  'CT': 10,        // Court
  'COURT': 10,
  'CIR': 10,       // Circle
  'CIRCLE': 10,
  'PL': 10,        // Place
  'PLACE': 10,
};

/**
 * Calculate road priority score based on road name/number
 * Higher score = more important road for drivers
 * Works globally - handles US interstates, state highways, UK motorways, European routes
 */
function getRoadPriority(roadName, roadNumbers) {
  let maxPriority = 0;

  // Check road numbers first (TX-114, I-35, M25, A1, etc.)
  if (roadNumbers && roadNumbers.length > 0) {
    for (const road of roadNumbers) {
      const upperRoad = road.toUpperCase();

      // Check against known patterns
      for (const [prefix, priority] of Object.entries(ROAD_PRIORITY)) {
        if (upperRoad.includes(prefix) || upperRoad.startsWith(prefix)) {
          maxPriority = Math.max(maxPriority, priority);
        }
      }

      // Dynamic state highway detection: [A-Z]{2}-\d+ (TX-114, CA-1, NY-17, FL-528)
      if (/^[A-Z]{2}-\d+/.test(upperRoad)) {
        maxPriority = Math.max(maxPriority, 80); // State highway priority
      }

      // Farm-to-Market roads (FM-) - common in rural US
      if (/^FM-\d+/.test(upperRoad)) {
        maxPriority = Math.max(maxPriority, 60);
      }

      // County roads (CR-, CO-)
      if (/^(CR|CO)-\d+/.test(upperRoad)) {
        maxPriority = Math.max(maxPriority, 45);
      }
    }
  }

  // Check road name for patterns
  if (roadName) {
    const upperName = roadName.toUpperCase();

    for (const [prefix, priority] of Object.entries(ROAD_PRIORITY)) {
      if (upperName.includes(prefix)) {
        maxPriority = Math.max(maxPriority, priority);
      }
    }

    // Check for major road keywords (global)
    if (upperName.includes('MOTORWAY') || upperName.includes('AUTOBAHN') ||
        upperName.includes('AUTOROUTE') || upperName.includes('AUTOPISTA')) {
      maxPriority = Math.max(maxPriority, 100);
    }

    // Check for tollway keywords (global)
    if (upperName.includes('TOLLWAY') || upperName.includes('TOLL') ||
        upperName.includes('TURNPIKE') || upperName.includes('EXPRESSWAY') ||
        upperName.includes('PEAGE') || upperName.includes('MAUT')) {
      maxPriority = Math.max(maxPriority, 85);
    }
  }

  return maxPriority || 15; // Default to low priority for unknown roads
}

/**
 * Calculate overall incident priority for sorting
 * Combines road importance + incident severity + type
 */
function calculateIncidentPriority(incident) {
  const roadPriority = getRoadPriority(incident.location, incident.road ? [incident.road] : []);

  // Magnitude score
  const magnitudeScore = {
    'Major': 40,
    'Moderate': 25,
    'Minor': 10,
    'Unknown': 5,
  }[incident.magnitude] || 5;

  // Category score (construction and closures affect routes more)
  const categoryScore = {
    'Road Closed': 35,
    'Road Works': 30,  // Construction
    'Accident': 25,
    'Lane Closed': 20,
    'Jam': 15,
    'Flooding': 30,
    'Dangerous Conditions': 20,
  }[incident.category] || 10;

  // Delay score (longer delays = higher priority)
  const delayScore = Math.min(incident.delayMinutes || 0, 30);

  return roadPriority + magnitudeScore + categoryScore + delayScore;
}

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
 * @param {number} params.radiusMiles - Search radius in miles (default 10 for bounding box)
 * @param {number} params.maxDistanceMiles - Maximum distance from driver to include (default 10)
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

    // Parse incidents into useful format with priority scoring
    const parsedIncidents = rawIncidents.map(inc => {
      const props = inc.properties || {};
      const category = CATEGORY_LABELS[props.iconCategory] || 'Unknown';
      const magnitude = MAGNITUDE_LABELS[props.magnitudeOfDelay] || 'Unknown';

      // Get description from events
      const description = props.events?.map(e => e.description).join('; ') || category;

      // Format road info - prefer road numbers for clarity
      const roadNumbers = props.roadNumbers || [];
      const road = roadNumbers.join(', ') || '';

      // Create location string
      const fromTo = props.from && props.to ? `${props.from} to ${props.to}` : '';

      // Delay in minutes
      const delayMinutes = props.delay ? Math.round(props.delay / 60) : 0;

      // Length in miles
      const lengthMiles = props.length ? parseFloat((props.length / 1609.34).toFixed(1)) : null;

      // Get incident coordinates (first point of geometry for distance calc)
      // TomTom returns coordinates as [lon, lat] (GeoJSON format)
      let incidentLat = null;
      let incidentLon = null;
      if (inc.geometry?.coordinates) {
        const coords = inc.geometry.coordinates;
        // Handle LineString (array of coordinate pairs) or Point (single pair)
        if (Array.isArray(coords[0])) {
          // LineString: take midpoint or first point
          incidentLon = coords[0][0];
          incidentLat = coords[0][1];
        } else {
          // Point
          incidentLon = coords[0];
          incidentLat = coords[1];
        }
      }

      // Calculate actual distance from driver to incident
      let distanceFromDriver = null;
      if (incidentLat !== null && incidentLon !== null && lat && lon) {
        distanceFromDriver = parseFloat(calculateDistanceMiles(lat, lon, incidentLat, incidentLon).toFixed(1));
      }

      const incident = {
        id: props.id,
        category,
        magnitude,
        description,
        road,
        roadNumbers,
        location: fromTo,
        from: props.from || '',
        to: props.to || '',
        delayMinutes,
        lengthMiles,
        startTime: props.startTime,
        endTime: props.endTime,
        // Add city context from the request
        city: city || null,
        state: state || null,
        // Add distance from driver's position
        distanceFromDriver,
        incidentLat,
        incidentLon,
      };

      // Calculate priority score for sorting
      incident.priority = calculateIncidentPriority(incident);

      // Determine if this is a major arterial/highway
      incident.isHighway = getRoadPriority(incident.location, roadNumbers) >= 60;

      // Format display description with road context and distance
      const distanceStr = distanceFromDriver !== null ? ` [${distanceFromDriver} mi]` : '';
      if (road) {
        incident.displayDescription = `${category}: ${road} (${fromTo})${distanceStr}`;
      } else {
        incident.displayDescription = `${category}: ${fromTo}${distanceStr}`;
      }

      return incident;
    });

    // Deduplicate reverse-direction incidents (e.g., "A to B" and "B to A" are the same closure)
    const seenPairs = new Set();
    const deduplicatedIncidents = parsedIncidents.filter(inc => {
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

    // Filter by actual distance from driver (not just bounding box)
    // This removes incidents that are technically in the bbox but farther than maxDistanceMiles
    const distanceFilteredIncidents = deduplicatedIncidents.filter(inc => {
      // Keep incidents without distance (couldn't calculate) - they're likely relevant
      if (inc.distanceFromDriver === null) return true;
      return inc.distanceFromDriver <= maxDistanceMiles;
    });

    // Log how many were filtered out
    const filteredOutCount = deduplicatedIncidents.length - distanceFilteredIncidents.length;
    if (filteredOutCount > 0) {
      briefingLog.phase(1, `Traffic: filtered ${filteredOutCount} incidents beyond ${maxDistanceMiles} mi`, OP.AI);
    }

    // Sort by priority (highest first) - highways and major incidents first
    const sortedIncidents = distanceFilteredIncidents.sort((a, b) => b.priority - a.priority);

    // Categorize incidents for better display
    const highwayIncidents = sortedIncidents.filter(i => i.isHighway);
    const constructionIncidents = sortedIncidents.filter(i => i.category === 'Road Works');
    const closureIncidents = sortedIncidents.filter(i => i.category === 'Road Closed' || i.category === 'Lane Closed');
    const jamIncidents = sortedIncidents.filter(i => i.category === 'Jam');
    const accidentIncidents = sortedIncidents.filter(i => i.category === 'Accident');

    // Calculate overall congestion level based on incidents
    let congestionLevel = 'light';
    const majorIncidents = sortedIncidents.filter(i => i.magnitude === 'Major').length;
    const moderateIncidents = sortedIncidents.filter(i => i.magnitude === 'Moderate').length;
    const highwayClosures = closureIncidents.filter(i => i.isHighway).length;

    if (majorIncidents >= 2 || jamIncidents.length >= 5 || highwayClosures >= 1) {
      congestionLevel = 'heavy';
    } else if (majorIncidents >= 1 || moderateIncidents >= 3 || jamIncidents.length >= 2) {
      congestionLevel = 'moderate';
    }

    // Generate summary with city context
    const locationContext = city ? ` near ${city}` : '';
    let summary = `${sortedIncidents.length} active traffic incidents${locationContext}`;
    if (jamIncidents.length > 0) summary += `, ${jamIncidents.length} traffic jams`;
    if (closureIncidents.length > 0) summary += `, ${closureIncidents.length} road closures`;
    if (constructionIncidents.length > 0) summary += `, ${constructionIncidents.length} construction zones`;
    if (sortedIncidents.length === 0) {
      summary = `Traffic flowing smoothly${locationContext}, no incidents reported`;
      congestionLevel = 'light';
    }

    // Create prioritized list: highways first, then by category importance
    // Take top 10 most important for display
    const prioritizedForDisplay = sortedIncidents.slice(0, 15);

    const elapsedMs = Date.now() - startTime;
    briefingLog.done(1, `Traffic: ${congestionLevel}, ${sortedIncidents.length} incidents (${elapsedMs}ms)`, OP.AI);

    return {
      traffic: {
        summary,
        // Return prioritized incidents (sorted by importance)
        incidents: prioritizedForDisplay,
        // Also provide full sorted list for detailed views
        allIncidents: sortedIncidents,
        congestionLevel,
        totalIncidents: sortedIncidents.length,
        // Categorized counts
        stats: {
          total: sortedIncidents.length,
          highways: highwayIncidents.length,
          construction: constructionIncidents.length,
          closures: closureIncidents.length,
          jams: jamIncidents.length,
          accidents: accidentIncidents.length,
          major: majorIncidents,
        },
        // Legacy fields for backwards compatibility
        majorIncidents,
        jams: jamIncidents.length,
        closures: closureIncidents.length,
        // Metadata
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
