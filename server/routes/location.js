// server/routes/location.js
import { Router } from 'express';
import crypto from 'node:crypto';
import { latLngToCell } from 'h3-js';
import { db } from '../db/drizzle.js';
import { snapshots, strategies } from '../../shared/schema.js';
import { sql, eq } from 'drizzle-orm';
import { generateStrategyForSnapshot } from '../lib/strategy-generator.js';
import { validateSnapshotV1 } from '../util/validate-snapshot.js';
import { uuidOrNull } from '../util/uuid.js';
import { makeCircuit } from '../util/circuit.js';
import { jobQueue } from '../lib/job-queue.js';
import { generateNewsBriefing } from '../lib/gemini-news-briefing.js';

const router = Router();

// Helper to classify day part from hour
function getDayPartKey(hour) {
  if (hour >= 0 && hour < 5) return 'overnight';
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 15) return 'late_morning_noon';
  if (hour >= 15 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'early_evening';
  return 'evening';
}

// Circuit breakers for external APIs (fail-fast, no fallbacks)
const googleMapsCircuit = makeCircuit({ 
  name: 'google-maps', 
  failureThreshold: 3, 
  resetAfterMs: 30000, 
  timeoutMs: 5000 
});

const openWeatherCircuit = makeCircuit({ 
  name: 'openweather', 
  failureThreshold: 3, 
  resetAfterMs: 30000, 
  timeoutMs: 3000 
});

const googleAQCircuit = makeCircuit({ 
  name: 'google-airquality', 
  failureThreshold: 3, 
  resetAfterMs: 30000, 
  timeoutMs: 3000 
});

// Helper for consistent error responses with correlation ID
function httpError(res, status, code, message, reqId, extra = {}) {
  return res.status(status).json({ ok: false, error: code, message, req_id: reqId, ...extra });
}

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const GOOGLEAQ_API_KEY = process.env.GOOGLEAQ_API_KEY;

// Production gate: Disallow manual city overrides (test-only feature)
router.use((req, res, next) => {
  const isProd = process.env.NODE_ENV === 'production';
  const manualCityProvided = !!(req.query?.city || req.query?.cityName || req.body?.city || req.body?.cityName);

  if (isProd && manualCityProvided) {
    console.warn('🚫 Manual city override blocked in production');
    return res.status(400).json({ error: 'manual-city-disabled-in-prod' });
  }

  next();
});

// Helper to extract city, state, country from Google Geocoding response
function pickAddressParts(components) {
  let city;
  let state;
  let country;

  for (const c of components || []) {
    const types = c.types || [];
    if (types.includes("locality")) city = c.long_name;
    if (types.includes("administrative_area_level_1")) state = c.short_name;
    if (types.includes("country")) country = c.long_name;
  }
  return { city, state, country };
}

// GET /api/location/geocode/reverse?lat=&lng=
// Reverse geocode coordinates to city/state/country
router.get('/geocode/reverse', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);

    if (!isFinite(lat) || !isFinite(lng)) {
      return res.status(400).json({ error: 'lat/lng required' });
    }

    if (!GOOGLE_MAPS_API_KEY) {
      console.warn('[location] No Google Maps API key configured');
      return res.json({ 
        city: undefined, 
        state: undefined, 
        country: undefined,
        formattedAddress: `${lat.toFixed(4)}, ${lng.toFixed(4)}`
      });
    }

    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('latlng', `${lat},${lng}`);
    url.searchParams.set('key', GOOGLE_MAPS_API_KEY);

    const data = await googleMapsCircuit(async (signal) => {
      const response = await fetch(url.toString(), { signal });
      if (!response.ok) {
        throw new Error(`Google Maps API error: ${response.status}`);
      }
      return await response.json();
    });

    if (data.status !== 'OK') {
      console.error('[location] Geocoding error:', data.status);
      console.error('[location] Google API response:', JSON.stringify(data, null, 2));
      return res.status(500).json({ error: `Geocoding failed: ${data.status}`, details: data.error_message });
    }

    const first = data.results?.[0];
    const { city, state, country } = first
      ? pickAddressParts(first.address_components)
      : { city: undefined, state: undefined, country: undefined };

    res.json({
      city,
      state,
      country,
      formattedAddress: first?.formatted_address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    });
  } catch (err) {
    console.error('[location] reverse geocode error', err);
    res.status(500).json({ error: 'reverse-geocode-failed' });
  }
});

// GET /api/location/geocode/forward?city=Dallas,TX
// Forward geocode city name to coordinates
router.get('/geocode/forward', async (req, res) => {
  try {
    const cityName = req.query.city;

    if (!cityName) {
      return res.status(400).json({ error: 'city query parameter required' });
    }

    if (!GOOGLE_MAPS_API_KEY) {
      console.warn('[location] No Google Maps API key configured');
      return res.status(500).json({ error: 'Google Maps API key not configured' });
    }

    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', cityName);
    url.searchParams.set('key', GOOGLE_MAPS_API_KEY);

    const data = await googleMapsCircuit(async (signal) => {
      const response = await fetch(url.toString(), { signal });
      if (!response.ok) {
        throw new Error(`Google Maps API error: ${response.status}`);
      }
      return await response.json();
    });

    if (data.status !== 'OK') {
      console.error('[location] Forward geocoding error:', data.status);
      return res.status(404).json({ error: `City not found: ${data.status}` });
    }

    const first = data.results?.[0];
    if (!first || !first.geometry?.location) {
      return res.status(404).json({ error: 'No coordinates found for city' });
    }

    const { city, state, country } = pickAddressParts(first.address_components);

    res.json({
      city: city || cityName,
      state,
      country,
      coordinates: {
        lat: first.geometry.location.lat,
        lng: first.geometry.location.lng
      },
      formattedAddress: first.formatted_address
    });
  } catch (err) {
    console.error('[location] forward geocode error', err);
    res.status(500).json({ error: 'forward-geocode-failed' });
  }
});

// GET /api/location/timezone?lat=&lng=
// Get timezone for coordinates
router.get('/timezone', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);

    if (!isFinite(lat) || !isFinite(lng)) {
      return res.status(400).json({ error: 'lat/lng required' });
    }

    if (!GOOGLE_MAPS_API_KEY) {
      console.warn('[location] No Google Maps API key configured');
      // Return browser timezone as fallback
      return res.json({ 
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      });
    }

    const ts = Math.floor(Date.now() / 1000);
    const url = new URL('https://maps.googleapis.com/maps/api/timezone/json');
    url.searchParams.set('location', `${lat},${lng}`);
    url.searchParams.set('timestamp', String(ts));
    url.searchParams.set('key', GOOGLE_MAPS_API_KEY);

    const data = await googleMapsCircuit(async (signal) => {
      const response = await fetch(url.toString(), { signal });
      if (!response.ok) {
        throw new Error(`Google Maps API error: ${response.status}`);
      }
      return await response.json();
    });

    if (data.status !== 'OK') {
      console.error('[location] Timezone error:', data.status);
      return res.json({ 
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      });
    }

    res.json({
      timeZone: data.timeZoneId,
      timeZoneName: data.timeZoneName,
    });
  } catch (err) {
    console.error('[location] timezone error', err);
    res.json({ 
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    });
  }
});

// GET /api/location/resolve?lat=&lng=
// Combined endpoint - get both geocoding and timezone in one call
router.get('/resolve', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);

    if (!isFinite(lat) || !isFinite(lng)) {
      return res.status(400).json({ error: 'lat/lng required' });
    }

    if (!GOOGLE_MAPS_API_KEY) {
      console.warn('[location] No Google Maps API key configured');
      return res.json({ 
        city: undefined, 
        state: undefined, 
        country: undefined,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        formattedAddress: `${lat.toFixed(4)}, ${lng.toFixed(4)}`
      });
    }

    // Make both API calls in parallel using circuit breaker protection
    const [geocodeData, timezoneData] = await Promise.all([
      googleMapsCircuit(async (signal) => {
        const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`, { signal });
        if (!response.ok) {
          throw new Error(`Google Maps API error: ${response.status}`);
        }
        return await response.json();
      }),
      googleMapsCircuit(async (signal) => {
        const response = await fetch(`https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${Math.floor(Date.now() / 1000)}&key=${GOOGLE_MAPS_API_KEY}`, { signal });
        if (!response.ok) {
          throw new Error(`Google Maps API error: ${response.status}`);
        }
        return await response.json();
      })
    ]);

    // Extract location data
    let city, state, country, formattedAddress;
    if (geocodeData.status === 'OK') {
      const first = geocodeData.results?.[0];
      ({ city, state, country } = first ? pickAddressParts(first.address_components) : {});
      formattedAddress = first?.formatted_address;
      console.log(`[Location API] 🗺️ Geocode resolved:`, {
        lat,
        lng,
        city,
        state,
        country,
        formattedAddress
      });
    }

    // Extract timezone
    let timeZone;
    if (timezoneData && timezoneData.status === 'OK' && timezoneData.timeZoneId) {
      timeZone = timezoneData.timeZoneId;
      console.log(`[Location API] 🕐 Timezone resolved: ${timeZone}`);
    } else {
      console.error('[location] Timezone API failed:', {
        status: timezoneData.status,
        errorMessage: timezoneData.errorMessage,
        timeZoneId: timezoneData.timeZoneId
      });
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      console.log(`[location] Using fallback timezone: ${timeZone}`);
    }

    const resolvedData = {
      city,
      state,
      country,
      timeZone,
      formattedAddress: formattedAddress || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    };
    
    console.log(`[Location API] ✅ Complete resolution:`, resolvedData);
    res.json(resolvedData);
  } catch (err) {
    console.error('[location] resolve error', err);
    res.status(500).json({ error: 'location-resolve-failed' });
  }
});

// GET /api/location/weather?lat=&lng=
// Get current weather conditions for coordinates
router.get('/weather', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);

    if (!isFinite(lat) || !isFinite(lng)) {
      return res.status(400).json({ error: 'lat/lng required' });
    }

    if (!OPENWEATHER_API_KEY) {
      console.warn('[location] No OpenWeather API key configured');
      return res.json({ 
        available: false,
        error: 'API key not configured' 
      });
    }

    const url = new URL('https://api.openweathermap.org/data/2.5/weather');
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lng));
    url.searchParams.set('appid', OPENWEATHER_API_KEY);
    url.searchParams.set('units', 'imperial'); // Fahrenheit, mph

    const data = await openWeatherCircuit(async (signal) => {
      const response = await fetch(url.toString(), { signal });
      if (!response.ok) {
        throw new Error(`OpenWeather API error: ${response.status}`);
      }
      return await response.json();
    });

    if (data.cod !== 200) {
      console.error('[location] Weather API error:', data.message);
      return res.status(500).json({ 
        available: false,
        error: data.message 
      });
    }

    const weatherData = {
      available: true,
      temperature: Math.round(data.main?.temp || 0),
      feelsLike: Math.round(data.main?.feels_like || 0),
      conditions: data.weather?.[0]?.main || 'Unknown',
      description: data.weather?.[0]?.description || '',
      humidity: data.main?.humidity || 0,
      windSpeed: Math.round(data.wind?.speed || 0),
      precipitation: data.rain?.['1h'] || data.snow?.['1h'] || 0,
      icon: data.weather?.[0]?.icon || '',
    };
    
    console.log(`[Location API] 🌤️ Weather fetched:`, {
      lat,
      lng,
      temp: weatherData.temperature,
      feelsLike: weatherData.feelsLike,
      conditions: weatherData.conditions,
      humidity: weatherData.humidity,
      windSpeed: weatherData.windSpeed
    });
    
    res.json(weatherData);
  } catch (err) {
    console.error('[location] weather error', err);
    res.status(500).json({ 
      available: false,
      error: 'weather-fetch-failed' 
    });
  }
});

// GET /api/location/airquality?lat=&lng=
// Get current air quality index for coordinates
router.get('/airquality', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);

    if (!isFinite(lat) || !isFinite(lng)) {
      return res.status(400).json({ error: 'lat/lng required' });
    }

    if (!GOOGLEAQ_API_KEY) {
      console.warn('[location] No Google Air Quality API key configured');
      return res.json({ 
        available: false,
        error: 'API key not configured' 
      });
    }

    const url = 'https://airquality.googleapis.com/v1/currentConditions:lookup';
    const requestBody = {
      location: {
        latitude: lat,
        longitude: lng
      }
    };

    const data = await googleAQCircuit(async (signal) => {
      const response = await fetch(`${url}?key=${GOOGLEAQ_API_KEY}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || `API error: ${response.status}`);
      }

      return await response.json();
    });

    // Check if data contains an error (circuit breaker might have returned error state)
    if (data?.error) {
      console.error('[location] Air Quality API error:', data);
      return res.status(500).json({ 
        available: false,
        error: data.error?.message || 'Air quality fetch failed' 
      });
    }

    // Extract AQI and pollutant data
    const aqi = data.indexes?.find(idx => idx.code === 'uaqi') || data.indexes?.[0];
    const dominantPollutant = data.pollutants?.reduce((max, p) => 
      p.concentration?.value > (max?.concentration?.value || 0) ? p : max, 
      null
    );

    const aqData = {
      available: true,
      aqi: aqi?.aqi || 0,
      category: aqi?.category || 'Unknown',
      dominantPollutant: aqi?.dominantPollutant || dominantPollutant?.code || 'unknown',
      healthRecommendations: aqi?.healthRecommendations || {},
      dateTime: data.dateTime,
      regionCode: data.regionCode,
    };
    
    console.log(`[Location API] 🌫️ Air Quality fetched:`, {
      lat,
      lng,
      aqi: aqData.aqi,
      category: aqData.category,
      dominantPollutant: aqData.dominantPollutant
    });
    
    res.json(aqData);
  } catch (err) {
    console.error('[location] air quality error', err);
    res.status(500).json({ 
      available: false,
      error: 'airquality-fetch-failed' 
    });
  }
});

// POST /api/location/snapshot
// Save a context snapshot for ML/analytics (SnapshotV1 format)
// Supports minimal mode: if only lat/lng provided, resolves city/timezone server-side
router.post('/snapshot', async (req, res) => {
  const reqId = crypto.randomUUID();
  res.setHeader('x-req-id', reqId);

  console.log('[snapshot] handler ENTER', { url: req.originalUrl, method: req.method, hasBody: !!req.body, req_id: reqId });
  try {
    console.log('[snapshot] processing snapshot...');
    const snapshotV1 = req.body;

    // Minimal mode support for curl/preflight tests
    const isMinimalMode = snapshotV1?.lat && snapshotV1?.lng && !snapshotV1?.resolved;
    
    if (isMinimalMode) {
      console.log('[snapshot] Minimal mode detected - resolving city/timezone server-side');
      const { lat, lng, userId } = snapshotV1;
      
      if (!lat || !lng) {
        return httpError(res, 400, 'missing_lat_lng', 'Coordinates required', reqId);
      }
      
      // Validate userId is a valid UUID or null/undefined
      const isValidUUID = userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
      const validatedUserId = isValidUUID ? userId : null;

      // Call internal resolver to get city/timezone
      const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
      const resolveUrl = `${baseUrl}/api/location/resolve?lat=${lat}&lng=${lng}`;
      
      const resolveRes = await fetch(resolveUrl);
      if (!resolveRes.ok) {
        return httpError(res, 502, 'resolve_failed', 'Failed to resolve location', reqId);
      }
      
      const resolved = await resolveRes.json();
      if (!resolved.timeZone || !(resolved.city || resolved.formattedAddress)) {
        return httpError(res, 400, 'resolve_incomplete', 'Location resolution incomplete', reqId);
      }

      // Build minimal SnapshotV1 with resolved data
      const now = new Date();
      const snapshot_id = crypto.randomUUID();
      
      snapshotV1.snapshot_id = snapshot_id;
      snapshotV1.created_at = now.toISOString();
      snapshotV1.device_id = snapshotV1.device_id || crypto.randomUUID();
      snapshotV1.session_id = snapshotV1.session_id || crypto.randomUUID();
      snapshotV1.user_id = validatedUserId;
      snapshotV1.coord = { lat, lng, source: 'manual' };
      snapshotV1.resolved = {
        city: resolved.city,
        state: resolved.state,
        country: resolved.country,
        formattedAddress: resolved.formattedAddress,
        timezone: resolved.timeZone
      };
      
      // Add time context
      // Use proper timezone conversion instead of locale string parsing
      const localTimeStr = now.toLocaleString('en-US', { 
        timeZone: resolved.timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      
      // Extract the hour directly from the locale string
      const [datePart, timePart] = localTimeStr.split(', ');
      const [hour] = timePart.split(':').map(Number);
      const localDow = new Date(now.toLocaleString('en-US', { timeZone: resolved.timeZone })).getDay() || now.getDay();
      
      snapshotV1.time_context = {
        local_iso: now.toISOString(), // Use the actual ISO timestamp
        dow: localDow,
        hour: hour,
        day_part_key: getDayPartKey(hour)
      };
      
      console.log('[snapshot] Minimal mode enriched with:', { 
        city: resolved.city, 
        timezone: resolved.timeZone,
        snapshot_id 
      });
    } else {
      // Full SnapshotV1 validation
      const v = validateSnapshotV1(snapshotV1);

      if (!v.ok) {
        console.warn('[snapshot] INCOMPLETE_SNAPSHOT_V1 - possible web crawler or incomplete client', { 
          fields_missing: v.errors,
          hasUserAgent: !!req.get("user-agent"),
          userAgent: req.get("user-agent"),
          snapshot_id: snapshotV1?.snapshot_id,
          req_id: reqId
        });
        return httpError(res, 400, 'refresh_required', 'Please refresh location permission and retry.', reqId, { 
          fields_missing: v.errors
        });
      }
    }

    console.log('[snapshot] Calculating H3 geohash...');
    // Calculate H3 geohash at resolution 8 (~0.46 km² hexagons)
    const h3_r8 = latLngToCell(snapshotV1.coord.lat, snapshotV1.coord.lng, 8);

    // Check for nearby airport disruptions
    console.log('[snapshot] Fetching airport context...');
    const { getNearestMajorAirport, fetchFAADelayData } = await import('../lib/faa-asws.js');
    let airportContext = null;

    try {
      console.log('[Airport API] 🛫 Searching for nearby airports within 25 miles...');
      const nearbyAirport = await getNearestMajorAirport(
        snapshotV1.coord.lat, 
        snapshotV1.coord.lng, 
        25 // 25 mile threshold for suburban metro areas
      );

      if (nearbyAirport) {
        console.log('[Airport API] 🛫 Found airport:', {
          code: nearbyAirport.code,
          name: nearbyAirport.name,
          distance_miles: nearbyAirport.distance.toFixed(1)
        });
        
        console.log('[Airport API] 🛫 Fetching FAA delay data for', nearbyAirport.code);
        const airportData = await fetchFAADelayData(nearbyAirport.code);
        
        if (airportData) {
          console.log('[Airport API] 🛫 FAA data received:', {
            delay_minutes: airportData.delay_minutes || 0,
            delay_reason: airportData.delay_reason || 'none',
            closure_status: airportData.closure_status,
            weather: airportData.weather
          });
          
          airportContext = {
            airport_code: nearbyAirport.code,
            airport_name: nearbyAirport.name,
            distance_miles: parseFloat(nearbyAirport.distance.toFixed(1)),
            delay_minutes: airportData.delay_minutes || 0,
            delay_reason: airportData.delay_reason,
            closure_status: airportData.closure_status,
            has_delays: airportData.delay_minutes > 0,
            has_closures: airportData.closure_status !== 'open',
            weather: airportData.weather ? {
              temperature: airportData.weather.temperature,
              conditions: airportData.weather.conditions,
              wind: airportData.weather.wind
            } : null
          };
          
          console.log('[Airport API] ✅ Airport context prepared for DB:', airportContext);
        } else {
          // Issue #29 Fix: Preserve basic airport proximity even when FAA API fails
          console.log('[Airport API] ⚠️ No FAA data available for', nearbyAirport.code, '- saving proximity data only');
          airportContext = {
            airport_code: nearbyAirport.code,
            airport_name: nearbyAirport.name,
            distance_miles: parseFloat(nearbyAirport.distance.toFixed(1)),
            delay_minutes: 0,
            delay_reason: null,
            closure_status: 'unknown',
            has_delays: false,
            has_closures: false,
            weather: null
          };
          console.log('[Airport API] ✅ Basic airport context prepared (FAA unavailable):', airportContext);
        }
      } else {
        console.log('[Airport API] ℹ️ No airports found within 25 miles');
      }
    } catch (airportErr) {
      console.warn('[snapshot] Airport context fetch failed:', airportErr.message);
    }

    // Fetch rideshare news briefing using Gemini (60-minute actionable intel)
    console.log('[snapshot] Generating news briefing with Gemini...');
    let localNews = null;
    
    try {
      // Build temporary snapshot object for briefing (needs formatted_address, city, state, timezone, created_at, airport_context)
      const tempSnapshot = {
        snapshot_id: snapshotV1.snapshot_id,
        formatted_address: snapshotV1.resolved?.formattedAddress || null,
        city: snapshotV1.resolved?.city || null,
        state: snapshotV1.resolved?.state || null,
        timezone: snapshotV1.resolved?.timezone || null,
        created_at: snapshotV1.created_at,
        airport_context: airportContext
      };
      
      const briefingResult = await generateNewsBriefing(tempSnapshot);
      
      if (briefingResult.ok) {
        localNews = {
          briefing: briefingResult.briefing,
          fetched_at: new Date().toISOString(),
          latency_ms: briefingResult.latency_ms,
          model: briefingResult.model,
          type: 'gemini_structured'
        };
        console.log('📰 [GEMINI] News Briefing Generated:', {
          airports: briefingResult.briefing.airports.length,
          traffic: briefingResult.briefing.traffic_construction.length,
          events: briefingResult.briefing.major_events.length,
          policy: briefingResult.briefing.policy_safety.length,
          takeaways: briefingResult.briefing.driver_takeaway.length,
          latency_ms: briefingResult.latency_ms
        });
      } else {
        // Store fallback briefing
        localNews = {
          briefing: briefingResult.briefing,
          fetched_at: new Date().toISOString(),
          error: briefingResult.error,
          model: 'gemini_fallback',
          type: 'gemini_structured'
        };
        console.warn('[snapshot] Gemini briefing failed (non-blocking), using fallback:', briefingResult.error);
      }
    } catch (newsErr) {
      console.warn('[snapshot] News briefing generation failed (non-blocking):', newsErr.message);
    }

    // Transform SnapshotV1 to Postgres schema
    // Helper to safely parse dates, returning null for invalid dates
    const safeDate = (value) => {
      if (!value) return null;
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    };

    const dbSnapshot = {
      snapshot_id: snapshotV1.snapshot_id,
      created_at: safeDate(snapshotV1.created_at) || new Date(),
      user_id: snapshotV1.user_id || null,
      device_id: snapshotV1.device_id,
      session_id: snapshotV1.session_id,
      lat: snapshotV1.coord.lat,
      lng: snapshotV1.coord.lng,
      accuracy_m: snapshotV1.coord.accuracyMeters || null,
      coord_source: snapshotV1.coord.source || 'gps',
      city: snapshotV1.resolved?.city || null,
      state: snapshotV1.resolved?.state || null,
      country: snapshotV1.resolved?.country || null,
      formatted_address: snapshotV1.resolved?.formattedAddress || null,
      timezone: snapshotV1.resolved?.timezone || null,
      local_iso: safeDate(snapshotV1.time_context?.local_iso),
      dow: snapshotV1.time_context?.dow !== undefined ? snapshotV1.time_context.dow : null,
      hour: snapshotV1.time_context?.hour !== undefined ? snapshotV1.time_context.hour : null,
      day_part_key: snapshotV1.time_context?.day_part_key || null,
      h3_r8,
      weather: snapshotV1.weather ? {
        tempF: snapshotV1.weather.tempF,
        conditions: snapshotV1.weather.conditions,
        description: snapshotV1.weather.description
      } : null,
      air: snapshotV1.air ? {
        aqi: snapshotV1.air.aqi,
        category: snapshotV1.air.category
      } : null,
      airport_context: airportContext,
      news_briefing: localNews, // Gemini-generated 60-minute briefing
      device: snapshotV1.device || null,
      permissions: snapshotV1.permissions || null,
      extras: snapshotV1.extras || null,
    };

    // Save to Postgres using Drizzle
    const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    console.info(`[db] pool tag @snapshot`, dbUrl?.slice(0, 32));
    console.log('[Snapshot DB] 💾 Writing to snapshots table - Field Mapping:');
    console.log('  → snapshot_id:', dbSnapshot.snapshot_id);
    console.log('  → user_id:', dbSnapshot.user_id);
    console.log('  → device_id:', dbSnapshot.device_id);
    console.log('  → lat:', dbSnapshot.lat);
    console.log('  → lng:', dbSnapshot.lng);
    console.log('  → city:', dbSnapshot.city);
    console.log('  → state:', dbSnapshot.state);
    console.log('  → timezone:', dbSnapshot.timezone);
    console.log('  → day_part_key:', dbSnapshot.day_part_key);
    console.log('  → h3_r8:', dbSnapshot.h3_r8);
    console.log('  → weather:', dbSnapshot.weather);
    console.log('  → air:', dbSnapshot.air);
    console.log('  → airport_context:', dbSnapshot.airport_context);
    console.log('  → local_news:', dbSnapshot.local_news ? dbSnapshot.local_news.summary?.slice(0, 100) + '...' : 'none');
    console.log('  → news_briefing:', dbSnapshot.news_briefing ? JSON.stringify(dbSnapshot.news_briefing.briefing?.driver_takeaway || dbSnapshot.news_briefing.briefing).slice(0, 150) + '...' : 'none');
    
    await db.insert(snapshots).values(dbSnapshot);
    
    console.log('[Snapshot DB] ✅ Snapshot successfully written to database');

    // Log travel disruptions for airports with delays (non-blocking)
    if (airportContext && airportContext.airport_code && (airportContext.delay_minutes || airportContext.closure_status !== 'open')) {
      try {
        const { travel_disruptions } = await import('../../shared/schema.js');
        const { randomUUID } = await import('crypto');
        
        await db.insert(travel_disruptions).values({
          id: randomUUID(),
          country_code: 'US',
          airport_code: airportContext.airport_code,
          airport_name: airportContext.airport_name || null,
          delay_minutes: Number(airportContext.delay_minutes || 0),
          ground_stops: airportContext.ground_stops || [],
          ground_delay_programs: airportContext.ground_delay_programs || [],
          closure_status: airportContext.closure_status || 'open',
          delay_reason: airportContext.delay_reason || null,
          ai_summary: airportContext.ai_summary || null,
          impact_level: airportContext.impact_level || (airportContext.delay_minutes > 30 ? 'high' : airportContext.delay_minutes > 0 ? 'medium' : 'none'),
          data_source: 'FAA',
          last_updated: new Date(),
          next_update_at: null
        });
        console.log(`✈️ Travel disruption logged for ${airportContext.airport_code}: ${airportContext.delay_minutes}min delay`);
      } catch (disruptionErr) {
        console.warn(`⚠️ Travel disruption logging failed (non-blocking):`, disruptionErr.message);
      }
    }

    // Also save to filesystem for backup/debugging
    const fs = await import('fs/promises');
    const path = await import('path');
    const dataDir = path.join(process.cwd(), 'data', 'context-snapshots');
    await fs.mkdir(dataDir, { recursive: true });

    const filename = `snapshot_${snapshotV1.device_id}_${Date.now()}.json`;
    await fs.writeFile(
      path.join(dataDir, filename),
      JSON.stringify(snapshotV1, null, 2)
    );

    // Convert dow to day name
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = dayNames[snapshotV1.time_context?.dow] || 'unknown';

    // Format date from local_iso
    const localDate = snapshotV1.time_context?.local_iso ? new Date(snapshotV1.time_context.local_iso).toISOString().split('T')[0] : 'unknown';

    console.log('[location] ✅ Snapshot saved - Summary:');
    console.log('  📍 Location: city =', snapshotV1.resolved?.city, ', state =', snapshotV1.resolved?.state);
    console.log('  🕐 Time: day_part =', snapshotV1.time_context?.day_part_key, ', hour =', snapshotV1.time_context?.hour);
    console.log('  🌤️ Weather: weather =', snapshotV1.weather ? `${snapshotV1.weather.tempF}°F ${snapshotV1.weather.conditions}` : 'none');
    console.log('  🌫️ Air: air_quality =', snapshotV1.air ? `AQI ${snapshotV1.air.aqi}` : 'none');
    console.log('  🛫 Airport: airport_context =', airportContext ? `${airportContext.airport_code} (${airportContext.distance_miles}mi, ${airportContext.delay_minutes}min delays)` : 'none');

    // Create or claim strategy row without a race; only the winner proceeds
    const now = new Date();
    await db.insert(strategies).values({
      snapshot_id: snapshotV1.snapshot_id,
      status: 'pending',
      attempt: 1,
      created_at: now,
      updated_at: now
    }).onConflictDoUpdate({
      target: strategies.snapshot_id,
      set: { 
        updated_at: now
      }
    });

    // Claim the pending job using SKIP LOCKED; only one request will own it
    let iOwnTheJob = false;
    if (snapshotV1.resolved?.formattedAddress || snapshotV1.resolved?.city) {
      const rows = await db.execute(sql`
        with c as (
          select snapshot_id
          from ${strategies}
          where ${strategies.snapshot_id} = ${snapshotV1.snapshot_id}
            and ${strategies.status} in ('pending', 'queued')
          for update skip locked
        )
        select snapshot_id from c
      `);
      iOwnTheJob = rows?.rows?.length === 1;

      if (iOwnTheJob) {
        // Enqueue strategy generation via database table (for triad-worker.js)
        const { triad_jobs } = await import('../../shared/schema.js');
        await db.insert(triad_jobs).values({
          snapshot_id: snapshotV1.snapshot_id,
          kind: 'triad',
          status: 'queued'
        }).onConflictDoNothing();
        console.log(`[location] ✅ Strategy job enqueued in database for snapshot ${snapshotV1.snapshot_id}`);
      }
    }

    res.json({ 
      success: true, 
      snapshot_id: snapshotV1.snapshot_id,
      h3_r8,
      status: iOwnTheJob ? 'enqueued' : 'already_enqueued',
      req_id: reqId
    });
  } catch (err) {
    console.error('[location] snapshot error', err);
    return httpError(res, 500, 'snapshot_failed', String(err?.message || err), reqId);
  }
});

// GET /api/location/snapshot/latest
// Fetch latest context snapshot for a user
router.get('/snapshot/latest', async (req, res) => {
  try {
    const userId = req.query.userId || 'default';

    const fs = await import('fs/promises');
    const path = await import('path');
    const dataDir = path.join(process.cwd(), 'data', 'context-snapshots');
    const filename = path.join(dataDir, `latest_${userId}.json`);

    const data = await fs.readFile(filename, 'utf-8');
    const snapshot = JSON.parse(data);

    res.json(snapshot);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'No snapshot found' });
    }
    console.error('[location] snapshot fetch error', err);
    res.status(500).json({ error: 'snapshot-fetch-failed' });
  }
});

// POST /api/location/news-briefing
// Generate local news briefing for rideshare drivers
router.post('/news-briefing', async (req, res) => {
  try {
    const { latitude, longitude, address, city, state, radius = 10 } = req.body;
    
    if (!latitude || !longitude || !address) {
      return res.status(400).json({ 
        ok: false, 
        error: 'missing_params',
        message: 'latitude, longitude, and address are required'
      });
    }

    // Create snapshot-like object for Gemini briefing
    const snapshot = {
      snapshot_id: `briefing-${Date.now()}`,
      latitude,
      longitude,
      formatted_address: address,
      city: city || address.split(',')[0]?.trim() || 'Unknown',
      state: state || address.split(',')[1]?.trim() || 'TX',
      timezone: 'America/Chicago', // Default to Central Time for Texas
      created_at: new Date().toISOString(),
      airport_context: null // Will be determined by Gemini
    };

    // Generate news briefing using Gemini
    const briefing = await generateNewsBriefing(snapshot);

    res.json({
      ok: true,
      briefing,
      generated_at: new Date().toISOString(),
      location: { 
        latitude, 
        longitude, 
        address, 
        city: snapshot.city,
        state: snapshot.state,
        radius 
      }
    });

  } catch (err) {
    console.error('[location] news-briefing error:', err);
    res.status(500).json({ 
      ok: false, 
      error: 'briefing_failed',
      message: String(err?.message || err)
    });
  }
});

export default router;