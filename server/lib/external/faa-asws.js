// Using Node.js built-in fetch (available in Node 18+)
import { parseStringPromise } from 'xml2js';

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

      // 2026-08-06: the feed's other two list types were silently ignored —
      // verified live: an active MCO/DCA/LGA ground stop and 43-90min SFO/JFK
      // ground delays were invisible to the app. Ground stops mean no arrivals
      // (no pickup queue) — the most driver-relevant signal in the feed.
      if (delayType?.Ground_Stop_List?.Program) {
        const programs = Array.isArray(delayType.Ground_Stop_List.Program)
          ? delayType.Ground_Stop_List.Program
          : [delayType.Ground_Stop_List.Program];

        programs.forEach(program => {
          if (program.ARPT) {
            airportData.push(parseGroundStopData(program));
          }
        });
      }

      if (delayType?.Ground_Delay_List?.Ground_Delay) {
        const groundDelays = Array.isArray(delayType.Ground_Delay_List.Ground_Delay)
          ? delayType.Ground_Delay_List.Ground_Delay
          : [delayType.Ground_Delay_List.Ground_Delay];

        groundDelays.forEach(gd => {
          if (gd.ARPT) {
            airportData.push(parseGroundDelayData(gd));
          }
        });
      }
    });

    // 2026-08-06: one airport can appear in multiple lists (e.g. a ground stop
    // AND arrival delays). The downstream merges use find()/Map.set() which take
    // one entry per code — combine here so nothing is dropped.
    const byCode = new Map();
    for (const entry of airportData) {
      const existing = byCode.get(entry.airport_code);
      if (!existing) {
        byCode.set(entry.airport_code, { ground_stops: [], ...entry });
        continue;
      }
      existing.delay_minutes = Math.max(existing.delay_minutes || 0, entry.delay_minutes || 0);
      existing.ground_delay_programs = [...(existing.ground_delay_programs || []), ...(entry.ground_delay_programs || [])];
      existing.ground_stops = [...(existing.ground_stops || []), ...(entry.ground_stops || [])];
      if (existing.closure_status === 'open' && entry.closure_status !== 'open') {
        existing.closure_status = entry.closure_status;
      }
      existing.delay_reason = existing.delay_reason || entry.delay_reason;
      if (entry.closure_start) existing.closure_start = entry.closure_start;
      if (entry.closure_end) existing.closure_end = entry.closure_end;
    }

    return Array.from(byCode.values());
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

    // 2026-07-06: US majors from the airports table (Google-seeded), not a
    // hardcoded list. Dynamic import avoids a module cycle at load time.
    const { db } = await import('../../db/drizzle.js');
    const { airports: airportsTable } = await import('../../../shared/schema.js');
    const { eq } = await import('drizzle-orm');
    const usAirports = await db
      .select({ code: airportsTable.iata })
      .from(airportsTable)
      .where(eq(airportsTable.country, 'US'));
    const requests = usAirports.map(airport =>
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

// 2026-08-06: "1 hour and 32 minutes" / "43 minutes" → total minutes
function parseDurationMinutes(text) {
  if (!text) return 0;
  const hours = text.match(/(\d+)\s*hour/);
  const minutes = text.match(/(\d+)\s*minute/);
  return (hours ? parseInt(hours[1], 10) * 60 : 0) + (minutes ? parseInt(minutes[1], 10) : 0);
}

function parseGroundStopData(program) {
  return {
    airport_code: program.ARPT,
    delay_minutes: 0,
    ground_delay_programs: [],
    ground_stops: [{
      reason: program.Reason || 'Unknown',
      end_time: program.End_Time || null
    }],
    closure_status: 'ground-stop',
    delay_reason: program.Reason
  };
}

function parseGroundDelayData(gd) {
  const avgMinutes = parseDurationMinutes(gd.Avg);
  return {
    airport_code: gd.ARPT,
    delay_minutes: avgMinutes,
    ground_delay_programs: [{
      reason: gd.Reason || 'Unknown',
      min_delay: avgMinutes,
      max_delay: parseDurationMinutes(gd.Max),
      trend: null,
      type: 'Ground Delay Program'
    }],
    ground_stops: [],
    closure_status: 'open',
    delay_reason: gd.Reason
  };
}

function parseAuthAirportData(data) {
  if (!data) return null;
  
  const weather = data.Weather ? {
    temperature: data.Weather.Temp?.[0] ?? null,
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
    ground_stops: publicInfo?.ground_stops || [],
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
      ground_stops: airport.ground_stops || [],
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
    ground_stops: airport.ground_stops || [],
    last_updated: new Date().toISOString()
  }));

  return result;
}

// 2026-07-06 (todo #22): getMajorUSAirports + getNearestMajorAirport DELETED.
// They were a hardcoded 20-airport US-only list with coordinates baked into
// code (app_rules no-hardcoded-location violation; Austin/Nashville/San Diego
// missing entirely). Airport identity now lives in the airports table (seeded
// from Google Places by scripts/seed-airports.mjs) and selection goes through
// server/lib/location/airports.js findNearbyAirports (AIRPORT_RADIUS_MILES).
