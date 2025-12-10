// Using Node.js built-in fetch (available in Node 18+)
import { parseStringPromise } from 'xml2js';
import { haversineDistanceMiles } from '../location/geo.js';

const PUBLIC_API_URL = 'https://nasstatus.faa.gov/api/airport-status-information';
const AUTH_API_BASE = 'https://external-api.faa.gov/asws';

export async function fetchFAADelayData(airportCode = null) {
  try {
    const [publicData, authData] = await Promise.all([
      fetchPublicAPI(),
      fetchAuthenticatedAPI(airportCode)
    ]);

    if (airportCode) {
      return mergeAirportData(airportCode, publicData, authData);
    }

    return mergeAllAirportData(publicData, authData);
  } catch (error) {
    console.error('[FAA Hybrid] Fetch error:', error.message);
    return null;
  }
}

async function fetchPublicAPI() {
  try {
    const response = await fetch(PUBLIC_API_URL, {
      headers: { 'Accept': 'application/xml' }
    });

    if (!response.ok) return null;

    const xmlData = await response.text();
    const parsedData = await parseStringPromise(xmlData, { 
      explicitArray: false,
      mergeAttrs: true 
    });

    const airportData = [];
    const root = parsedData.AIRPORT_STATUS_INFORMATION;
    
    const delayTypes = Array.isArray(root.Delay_type) ? root.Delay_type : [root.Delay_type];
    
    delayTypes.forEach(delayType => {
      if (delayType?.Arrival_Departure_Delay_List?.Delay) {
        const delays = Array.isArray(delayType.Arrival_Departure_Delay_List.Delay) 
          ? delayType.Arrival_Departure_Delay_List.Delay 
          : [delayType.Arrival_Departure_Delay_List.Delay];
        
        delays.forEach(delay => {
          if (delay.ARPT) {
            airportData.push(parseDelayData(delay));
          }
        });
      }
      
      if (delayType?.Airport_Closure_List?.Airport) {
        const closures = Array.isArray(delayType.Airport_Closure_List.Airport) 
          ? delayType.Airport_Closure_List.Airport 
          : [delayType.Airport_Closure_List.Airport];
        
        closures.forEach(closure => {
          if (closure.ARPT) {
            airportData.push(parseClosureData(closure));
          }
        });
      }
    });

    return airportData;
  } catch (error) {
    console.error('[FAA Public API] Error:', error.message);
    return null;
  }
}

async function fetchAuthenticatedAPI(specificAirport = null) {
  try {
    const clientId = process.env.FAA_ASWS_CLIENT_ID;
    const clientSecret = process.env.FAA_ASWS_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      console.warn('[FAA Auth API] Credentials not found, skipping weather data');
      return null;
    }

    const authHeader = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    
    if (specificAirport) {
      const response = await fetch(`${AUTH_API_BASE}/api/airport/status/${specificAirport}`, {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) return null;
      const data = await response.json();
      return [parseAuthAirportData(data)];
    }

    const airports = await getMajorUSAirports();
    const requests = airports.map(airport => 
      fetch(`${AUTH_API_BASE}/api/airport/status/${airport.code}`, {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json'
        }
      }).then(r => r.ok ? r.json() : null).catch(() => null)
    );

    const results = await Promise.all(requests);
    return results.filter(r => r !== null).map(parseAuthAirportData);
  } catch (error) {
    console.error('[FAA Auth API] Error:', error.message);
    return null;
  }
}

function parseDelayData(delay) {
  const ad = delay.Arrival_Departure;
  const minMatch = ad?.Min?.match(/(\d+)/);
  const maxMatch = ad?.Max?.match(/(\d+)/);
  const minDelay = minMatch ? parseInt(minMatch[1]) : 0;
  const maxDelay = maxMatch ? parseInt(maxMatch[1]) : 0;
  
  return {
    airport_code: delay.ARPT,
    delay_minutes: maxDelay,
    ground_delay_programs: [{
      reason: delay.Reason || 'Unknown',
      min_delay: minDelay,
      max_delay: maxDelay,
      trend: ad?.Trend || null,
      type: ad?.Type || 'General'
    }],
    closure_status: 'open',
    delay_reason: delay.Reason
  };
}

function parseClosureData(closure) {
  return {
    airport_code: closure.ARPT,
    delay_minutes: 0,
    ground_delay_programs: [],
    closure_status: 'restricted',
    delay_reason: closure.Reason,
    closure_start: closure.Start,
    closure_end: closure.Reopen
  };
}

function parseAuthAirportData(data) {
  if (!data) return null;
  
  const weather = data.Weather ? {
    temperature: data.Weather.Temp?.[0] || null,
    conditions: data.Weather.Weather?.[0]?.Temp?.[0] || null,
    visibility: data.Weather.Visibility?.[0] || null,
    wind: data.Weather.Wind?.[0] || null,
    last_updated: data.Weather.Meta?.[0]?.Updated || null
  } : null;

  return {
    airport_code: data.IATA,
    airport_name: data.Name,
    city: data.City,
    state: data.State,
    weather
  };
}

function mergeAirportData(airportCode, publicData, authData) {
  const code = airportCode.toUpperCase();
  const publicInfo = publicData?.find(a => a.airport_code === code);
  const authInfo = authData?.find(a => a.airport_code === code);

  if (!publicInfo && !authInfo) return null;

  return {
    airport_code: code,
    airport_name: authInfo?.airport_name || code,
    city: authInfo?.city || null,
    state: authInfo?.state || null,
    delay_minutes: publicInfo?.delay_minutes || 0,
    ground_stops: [],
    ground_delay_programs: publicInfo?.ground_delay_programs || [],
    closure_status: publicInfo?.closure_status || 'open',
    delay_reason: publicInfo?.delay_reason || null,
    closure_start: publicInfo?.closure_start || null,
    closure_end: publicInfo?.closure_end || null,
    weather: authInfo?.weather || null,
    last_updated: new Date().toISOString()
  };
}

function mergeAllAirportData(publicData, authData) {
  const mergedMap = new Map();

  publicData?.forEach(airport => {
    mergedMap.set(airport.airport_code, {
      airport_code: airport.airport_code,
      delay_minutes: airport.delay_minutes,
      ground_delay_programs: airport.ground_delay_programs,
      closure_status: airport.closure_status,
      delay_reason: airport.delay_reason,
      closure_start: airport.closure_start,
      closure_end: airport.closure_end
    });
  });

  authData?.forEach(airport => {
    if (airport) {
      const existing = mergedMap.get(airport.airport_code);
      if (existing) {
        existing.airport_name = airport.airport_name;
        existing.city = airport.city;
        existing.state = airport.state;
        existing.weather = airport.weather;
      } else {
        mergedMap.set(airport.airport_code, {
          airport_code: airport.airport_code,
          airport_name: airport.airport_name,
          city: airport.city,
          state: airport.state,
          delay_minutes: 0,
          ground_stops: [],
          ground_delay_programs: [],
          closure_status: 'open',
          delay_reason: null,
          weather: airport.weather
        });
      }
    }
  });

  const result = Array.from(mergedMap.values()).map(airport => ({
    ...airport,
    ground_stops: [],
    last_updated: new Date().toISOString()
  }));

  return result;
}

export async function getMajorUSAirports() {
  // Alphabetically ordered to avoid location bias
  return [
    { code: 'ATL', name: 'Hartsfield-Jackson Atlanta International' },
    { code: 'BOS', name: 'Logan International' },
    { code: 'DAL', name: 'Dallas Love Field' },
    { code: 'DEN', name: 'Denver International' },
    { code: 'DFW', name: 'Dallas/Fort Worth International' },
    { code: 'DTW', name: 'Detroit Metropolitan Wayne County' },
    { code: 'EWR', name: 'Newark Liberty International' },
    { code: 'IAH', name: 'George Bush Intercontinental' },
    { code: 'JFK', name: 'John F. Kennedy International' },
    { code: 'LAS', name: 'Harry Reid International' },
    { code: 'LAX', name: 'Los Angeles International' },
    { code: 'LGA', name: 'LaGuardia' },
    { code: 'MCO', name: 'Orlando International' },
    { code: 'MDW', name: 'Chicago Midway International' },
    { code: 'MIA', name: 'Miami International' },
    { code: 'MSP', name: 'Minneapolis-St. Paul International' },
    { code: 'ORD', name: "Chicago O'Hare International" },
    { code: 'PHX', name: 'Phoenix Sky Harbor International' },
    { code: 'SEA', name: 'Seattle-Tacoma International' },
    { code: 'SFO', name: 'San Francisco International' }
  ];
}

/**
 * Find nearest major airport within rideshare-relevant proximity
 * @param {number} latitude - User's current latitude
 * @param {number} longitude - User's current longitude
 * @param {number} maxDistanceMiles - Maximum straight-line distance in miles (default 50)
 * @returns {Object|null} Nearest airport with distance, or null if none within range
 */
export async function getNearestMajorAirport(latitude, longitude, maxDistanceMiles = 50) {
  const airports = await getMajorUSAirports();
  
  // Alphabetically ordered to match airport list - no location preference
  const airportCoordinates = {
    'ATL': { lat: 33.6407, lon: -84.4277 },
    'BOS': { lat: 42.3656, lon: -71.0096 },
    'DAL': { lat: 32.8471, lon: -96.8518 },
    'DEN': { lat: 39.8561, lon: -104.6737 },
    'DFW': { lat: 32.8968, lon: -97.0380 },
    'DTW': { lat: 42.2162, lon: -83.3554 },
    'EWR': { lat: 40.6895, lon: -74.1745 },
    'IAH': { lat: 29.9902, lon: -95.3368 },
    'JFK': { lat: 40.6413, lon: -73.7781 },
    'LAS': { lat: 36.0840, lon: -115.1537 },
    'LAX': { lat: 33.9416, lon: -118.4085 },
    'LGA': { lat: 40.7769, lon: -73.8740 },
    'MCO': { lat: 28.4312, lon: -81.3081 },
    'MDW': { lat: 41.7868, lon: -87.7522 },
    'MIA': { lat: 25.7959, lon: -80.2870 },
    'MSP': { lat: 44.8848, lon: -93.2223 },
    'ORD': { lat: 41.9742, lon: -87.9073 },
    'PHX': { lat: 33.4352, lon: -112.0101 },
    'SEA': { lat: 47.4502, lon: -122.3088 },
    'SFO': { lat: 37.6213, lon: -122.3790 }
  };

  // Calculate distance to ALL airports, then filter and sort by proximity
  const distances = airports.map(airport => {
    const coords = airportCoordinates[airport.code];
    if (!coords) return null;
    
    const distance = haversineDistanceMiles(latitude, longitude, coords.lat, coords.lon);
    return { ...airport, distance };
  }).filter(a => a && a.distance <= maxDistanceMiles);

  // Sort by distance (nearest first) - truly location-agnostic
  distances.sort((a, b) => a.distance - b.distance);
  
  return distances[0] || null;
}
