// server/api/location/location.js
import { Router } from 'express';
import crypto from 'node:crypto';
import { latLngToCell } from 'h3-js';
import { db } from '../../db/drizzle.js';
import { snapshots, strategies, users, coords_cache } from '../../../shared/schema.js';
import { sql, eq } from 'drizzle-orm';
import { locationLog, snapshotLog, OP } from '../../logger/workflow.js';

// Helper: Generate cache key from coordinates (4 decimal places = ~11m precision)
function makeCoordsKey(lat, lng) {
  const lat4d = lat.toFixed(4);
  const lng4d = lng.toFixed(4);
  return `${lat4d}_${lng4d}`;
}
import { generateStrategyForSnapshot } from '../../lib/strategy/strategy-generator.js';
import { validateSnapshotV1 } from '../../util/validate-snapshot.js';
import { haversineDistanceMeters } from '../../lib/location/geo.js';
import { validateLocationFreshness } from '../../lib/location/validation-gates.js';
import { uuidOrNull } from '../../util/uuid.js';
import { makeCircuit } from '../../util/circuit.js';
import { jobQueue } from '../../lib/infrastructure/job-queue.js';
import { validateBody, validateQuery } from '../../middleware/validate.js';
import { snapshotMinimalSchema, locationResolveSchema, newsBriefingSchema } from '../../validation/schemas.js';

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

// Helper: Validate all required snapshot fields are present before INSERT
// These fields are NOT NULL in the database schema
function validateSnapshotFields(record) {
  const required = [
    'lat', 'lng', 'city', 'state', 'country',
    'formatted_address', 'timezone', 'local_iso',
    'dow', 'hour', 'day_part_key'
  ];
  const missing = required.filter(f => record[f] === null || record[f] === undefined);
  if (missing.length > 0) {
    const error = new Error(`SNAPSHOT_VALIDATION_FAILED: Missing required fields: ${missing.join(', ')}`);
    error.missingFields = missing;
    error.code = 'SNAPSHOT_INCOMPLETE';
    throw error;
  }
  return true;
}

// Circuit breakers for external APIs (fail-fast, no fallbacks)
const googleMapsCircuit = makeCircuit({ 
  name: 'google-maps', 
  failureThreshold: 3, 
  resetAfterMs: 30000, 
  timeoutMs: 5000 
});

const googleAQCircuit = makeCircuit({ 
  name: 'google-airquality', 
  failureThreshold: 3, 
  resetAfterMs: 30000, 
  timeoutMs: 3000 
});

import { httpError } from '../utils/http-helpers.js';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GOOGLEAQ_API_KEY = process.env.GOOGLEAQ_API_KEY;

// UNIFIED: Accept manual city overrides consistently (test and debug feature)

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

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMITING: Prevent geocoding API abuse (10 requests/minute per IP)
// Merged from geocode-proxy.js
// ═══════════════════════════════════════════════════════════════════════════
const geocodeRateLimit = new Map();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;

function checkGeoRateLimit(ip) {
  const now = Date.now();
  const userRequests = geocodeRateLimit.get(ip) || [];

  // Clean old requests outside the window
  const recentRequests = userRequests.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS);

  if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
    return { allowed: false, remaining: 0, resetIn: Math.ceil((recentRequests[0] + RATE_LIMIT_WINDOW_MS - now) / 1000) };
  }

  recentRequests.push(now);
  geocodeRateLimit.set(ip, recentRequests);
  return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - recentRequests.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// PLUS CODE FILTERING: Prefer street addresses over Plus Codes
// Merged from geocoding.js - improves address quality for venues
// ═══════════════════════════════════════════════════════════════════════════
function pickBestGeocodeResult(results) {
  if (!results || results.length === 0) return null;

  // Filter out Plus Codes (format: "XXXX+XX" like "35WJ+64") and prefer street addresses
  const streetAddress = results.find(result => {
    const addr = result.formatted_address || '';
    // Skip Plus Codes - they start with alphanumeric pattern like "35WJ+64"
    if (/^[A-Z0-9]{4}\+[A-Z0-9]{2,}/.test(addr)) {
      console.log(`[location] Skipping Plus Code result: ${addr}`);
      return false;
    }
    // Prefer street_address, premise, route, or establishment types
    const preferredTypes = ['street_address', 'premise', 'route', 'establishment', 'point_of_interest'];
    return result.types?.some(type => preferredTypes.includes(type));
  });

  // Fall back to first result if no street address found
  const best = streetAddress || results[0];

  if (streetAddress) {
    console.log(`[location] Selected street address: ${best.formatted_address}`);
  } else {
    console.log(`[location] Using fallback result (no street address found): ${best.formatted_address}`);
  }

  return best;
}

// GET /api/location/geocode/reverse?lat=&lng=
// Reverse geocode coordinates to city/state/country + place_id
// Enhanced: Plus Code filtering, rate limiting, place_id return
router.get('/geocode/reverse', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

    // Rate limiting check
    const rateCheck = checkGeoRateLimit(clientIp);
    if (!rateCheck.allowed) {
      console.warn(`[location] Rate limit exceeded for IP: ${clientIp}`);
      return res.status(429).json({
        error: 'RATE_LIMIT_EXCEEDED',
        message: `Too many geocoding requests. Try again in ${rateCheck.resetIn} seconds.`,
        resetIn: rateCheck.resetIn
      });
    }

    if (!isFinite(lat) || !isFinite(lng)) {
      return res.status(400).json({ error: 'lat/lng required' });
    }

    if (!GOOGLE_MAPS_API_KEY) {
      console.warn('[location] No Google Maps API key configured');
      return res.json({
        city: undefined,
        state: undefined,
        country: undefined,
        place_id: undefined,
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

    // Use Plus Code filtering to get best result (prefers street addresses)
    const best = pickBestGeocodeResult(data.results);
    const { city, state, country } = best
      ? pickAddressParts(best.address_components)
      : { city: undefined, state: undefined, country: undefined };

    res.json({
      city,
      state,
      country,
      place_id: best?.place_id || undefined,
      formattedAddress: best?.formatted_address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      // Include coordinates from Google (may be slightly adjusted for accuracy)
      lat: best?.geometry?.location?.lat || lat,
      lng: best?.geometry?.location?.lng || lng,
    });
  } catch (err) {
    console.error('[location] reverse geocode error', err);
    res.status(500).json({ error: 'reverse-geocode-failed' });
  }
});

// GET /api/location/geocode/forward?city=CityName,StateCode
// Forward geocode city name to coordinates + place_id
// Enhanced: Plus Code filtering, rate limiting, place_id return
router.get('/geocode/forward', async (req, res) => {
  try {
    const cityName = req.query.city;
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

    // Rate limiting check
    const rateCheck = checkGeoRateLimit(clientIp);
    if (!rateCheck.allowed) {
      console.warn(`[location] Rate limit exceeded for IP: ${clientIp}`);
      return res.status(429).json({
        error: 'RATE_LIMIT_EXCEEDED',
        message: `Too many geocoding requests. Try again in ${rateCheck.resetIn} seconds.`,
        resetIn: rateCheck.resetIn
      });
    }

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

    // Use Plus Code filtering to get best result
    const best = pickBestGeocodeResult(data.results);
    if (!best || !best.geometry?.location) {
      return res.status(404).json({ error: 'No coordinates found for city' });
    }

    const { city, state, country } = pickAddressParts(best.address_components);

    res.json({
      city: city || cityName,
      state,
      country,
      place_id: best.place_id || undefined,
      coordinates: {
        lat: best.geometry.location.lat,
        lng: best.geometry.location.lng
      },
      formattedAddress: best.formatted_address
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

/**
 * GET /api/location/resolve
 * Resolves GPS coordinates to formatted address and timezone in a single call
 * 
 * Query Parameters:
 *   - lat (number, required): Latitude coordinate
 *   - lng (number, required): Longitude coordinate
 *   - device_id (string, optional): Device identifier for tracking across sessions
 *   - accuracy (number, optional): GPS accuracy radius in meters
 *   - session_id (string, optional): Session identifier for telemetry
 *   - coord_source (string, optional): Source of coordinates (default: "gps")
 * 
 * Returns:
 *   - city, state, country: Resolved address components
 *   - formattedAddress: Full street address from Google Geocoding API
 *   - timeZone: IANA timezone identifier
 *   - user_id: UUID of created/updated user record in users table
 * 
 * Side Effects:
 *   - Creates or updates user record in users table with rich telemetry
 *   - Validates formatted_address is not null before database write
 *   - Throws 502 error if address resolution fails (prevents bad data)
 * 
 * Data Quality:
 *   - Captures accuracy_m, session_id, coord_source for density analysis
 *   - Computes local time context (dow, hour, day_part) in user's timezone
 *   - Single source of truth for driver location (replaces legacy methods)
 */
router.get('/resolve', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);

    // Dev fallback: Generate deterministic device_id from coords if not provided
    // Uses 6 decimal precision (~0.1m) to ensure unique user per exact address
    // This ensures user records are created even in dev/testing without a real device
    let deviceId = req.query.device_id;
    const isProduction = process.env.NODE_ENV === 'production' && !process.env.REPLIT_DEPLOYMENT;

    if (!deviceId && !isProduction) {
      deviceId = `dev-admin-${lat.toFixed(6)}_${lng.toFixed(6)}`;
    }

    const accuracy = req.query.accuracy ? Number(req.query.accuracy) : null;
    const sessionId = req.query.session_id || null;
    const coordSource = req.query.coord_source || (deviceId?.startsWith('dev-') ? 'dev-coords' : 'gps');

    if (!isFinite(lat) || !isFinite(lng)) {
      console.error('[Location API] INVALID COORDINATES - lat/lng required for precise location resolution', {
        lat,
        lng,
        isLatFinite: isFinite(lat),
        isLngFinite: isFinite(lng),
        rawLat: req.query.lat,
        rawLng: req.query.lng
      });
      return res.status(400).json({ error: 'lat/lng required for precise location resolution', ok: false });
    }

    locationLog.phase(1, `Resolving ${lat.toFixed(4)}, ${lng.toFixed(4)}`, OP.API);

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

    // ═══════════════════════════════════════════════════════════════════════════
    // USERS TABLE: Check if same device has resolved location nearby (~100m)
    // This is the FIRST check - reuse resolved addresses when device hasn't moved
    // ═══════════════════════════════════════════════════════════════════════════
    if (deviceId) {
      try {
        const existingUser = await db.query.users.findFirst({
          where: eq(users.device_id, deviceId),
        });

        if (existingUser?.city && existingUser?.formatted_address) {
          // Check if coords are within ~100m (reuse threshold)
          const existingLat = existingUser.new_lat || existingUser.lat;
          const existingLng = existingUser.new_lng || existingUser.lng;

          if (existingLat && existingLng) {
            const distance = haversineDistanceMeters(lat, lng, existingLat, existingLng);

            if (distance < 100) {
              locationLog.done(1, `Users cache hit (${distance.toFixed(0)}m away)`, OP.CACHE);

              // Update coords but reuse resolved address data
              const now = new Date();
              const tz = existingUser.timezone || 'America/Chicago';
              const hour = new Date(now.toLocaleString('en-US', { timeZone: tz })).getHours();
              const dow = new Date(now.toLocaleString('en-US', { timeZone: tz })).getDay();
              const dayPartKey = getDayPartKey(hour);

              // ═══════════════════════════════════════════════════════════════════════
              // CREATE SNAPSHOT: Even when reusing location, create NEW snapshot
              // User is requesting fresh data (new session)
              // ═══════════════════════════════════════════════════════════════════════
              const snapshotId = crypto.randomUUID();
              snapshotLog.phase(1, `Creating for ${existingUser.city}, ${existingUser.state}`, OP.DB);

              try {
                // Calculate date in user's timezone
                const dateFormatter = new Intl.DateTimeFormat('en-CA', {
                  timeZone: tz,
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit'
                });
                const localDate = dateFormatter.format(now);

                // Create snapshot pulling location identity from users table
                const snapshotRecord = {
                  snapshot_id: snapshotId,
                  created_at: now,
                  date: localDate,
                  user_id: existingUser.user_id,
                  device_id: deviceId,
                  session_id: sessionId || crypto.randomUUID(),
                  // Location coordinates
                  lat,
                  lng,
                  // FK to coords_cache for location identity (from users table)
                  coord_key: existingUser.coord_key,
                  // LEGACY: Location identity (from users table - cached, reused)
                  city: existingUser.city,
                  state: existingUser.state,
                  country: existingUser.country,
                  formatted_address: existingUser.formatted_address,
                  timezone: tz,
                  // Time context (calculated fresh for THIS request)
                  local_iso: now,
                  dow,
                  hour,
                  day_part_key: dayPartKey,
                  // H3 geohash
                  h3_r8: latLngToCell(lat, lng, 8),
                  // Weather/air will be enriched separately
                  weather: null,
                  air: null,
                  device: { platform: 'web' },
                  permissions: { geolocation: 'granted' }
                };

                // Validate all required fields are present before INSERT (schema has NOT NULL constraints)
                validateSnapshotFields(snapshotRecord);

                await db.insert(snapshots).values(snapshotRecord);
                snapshotLog.done(1, `${snapshotId.slice(0, 8)}`, OP.DB);

                // Update users table: coords + current_snapshot_id + location fields (ensure they stay populated)
                await db.update(users)
                  .set({
                    new_lat: lat,
                    new_lng: lng,
                    accuracy_m: accuracy,
                    local_iso: now,
                    dow,
                    hour,
                    day_part_key: dayPartKey,
                    current_snapshot_id: snapshotId,
                    updated_at: now,
                    // CRITICAL: Preserve location fields from existing user (ensures /api/users/me returns them)
                    city: existingUser.city,
                    state: existingUser.state,
                    country: existingUser.country,
                    formatted_address: existingUser.formatted_address,
                    timezone: tz,
                    coord_key: existingUser.coord_key,
                  })
                  .where(eq(users.device_id, deviceId));

              } catch (snapshotErr) {
                snapshotLog.error(1, `Failed to create`, snapshotErr, OP.DB);
                // Update coords anyway (non-blocking)
                db.update(users)
                  .set({
                    new_lat: lat,
                    new_lng: lng,
                    accuracy_m: accuracy,
                    updated_at: now,
                  })
                  .where(eq(users.device_id, deviceId))
                  .catch(() => {});
              }

              // Return cached user data + new snapshot_id
              return res.json({
                city: existingUser.city,
                state: existingUser.state,
                country: existingUser.country,
                timeZone: existingUser.timezone,
                formattedAddress: existingUser.formatted_address,
                user_id: existingUser.user_id,
                snapshot_id: snapshotId,
                source: 'users_table'
              });
            } else {
              locationLog.phase(1, `Device moved ${distance.toFixed(0)}m - re-geocoding`, OP.API);
            }
          }
        }
      } catch (userLookupErr) {
        console.warn(`[LOCATION] Users table lookup failed (continuing):`, userLookupErr.message);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // COORDS CACHE: Check if we've resolved these coordinates before (~11m match)
    // ═══════════════════════════════════════════════════════════════════════════
    const coordKey = makeCoordsKey(lat, lng);
    let cacheHit = null;
    let city, state, country, formattedAddress, timeZone;
    
    try {
      cacheHit = await db.query.coords_cache.findFirst({
        where: eq(coords_cache.coord_key, coordKey),
      });
    } catch (cacheErr) {
      console.warn(`[Location API] ⚠️ Cache lookup failed (continuing with API):`, cacheErr.message);
    }
    
    if (cacheHit) {
      // CACHE HIT: Use cached geocode/timezone data, skip API calls
      locationLog.done(1, `Coords cache hit: ${cacheHit.city}, ${cacheHit.state}`, OP.CACHE);
      city = cacheHit.city;
      state = cacheHit.state;
      country = cacheHit.country;
      formattedAddress = cacheHit.formatted_address;
      timeZone = cacheHit.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone; // Fallback if cache missing timezone
      
      // SAFETY: Validate cached formattedAddress (same guard as live API path)
      if (!formattedAddress || formattedAddress.trim() === '') {
        console.warn(`[Location API] ⚠️ Cache entry has empty formatted_address, using fallback`);
        if (city && state) {
          formattedAddress = `${city}, ${state}`;
        } else {
          formattedAddress = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        }
      }
      
      // Increment hit count (fire and forget)
      db.update(coords_cache)
        .set({ hit_count: sql`${coords_cache.hit_count} + 1` })
        .where(eq(coords_cache.coord_key, coordKey))
        .catch(() => {});
    } else {
      // CACHE MISS: Call APIs in parallel, then store in cache
      locationLog.phase(2, `Calling Google Geocode + Timezone APIs`, OP.API);
      
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

      // Extract location data from geocode response
      // Use Plus Code filtering to prefer street addresses over Plus Codes
      if (geocodeData.status === 'OK') {
        const best = pickBestGeocodeResult(geocodeData.results);
        ({ city, state, country } = best ? pickAddressParts(best.address_components) : {});
        formattedAddress = best?.formatted_address;
        
        // CRITICAL FIX: Validate formatted_address is not empty (Google API can return empty string)
        if (!formattedAddress || formattedAddress.trim() === '') {
          console.warn(`[Location API] ⚠️ Google API returned empty formatted_address for coords [${lat}, ${lng}]`, {
            city,
            state,
            country,
            rawAddress: formattedAddress,
            accuracy: 'low - coordinates may be too approximate'
          });
          // Use fallback: City, State if available
          if (city && state) {
            formattedAddress = `${city}, ${state}`;
            console.log(`[Location API] 📍 Using city/state fallback: "${formattedAddress}"`);
          } else {
            console.error(`[Location API] ❌ CRITICAL: No fallback available - cannot determine address at coords [${lat}, ${lng}]`);
            formattedAddress = null; // Let validation gate catch this
          }
        }
        
        locationLog.done(2, `Geocode: ${city}, ${state}`, OP.API);
      } else {
        locationLog.error(2, `Geocode failed: ${geocodeData.status}`, null, OP.API);
      }

      // Extract timezone from API response
      if (timezoneData && timezoneData.status === 'OK' && timezoneData.timeZoneId) {
        timeZone = timezoneData.timeZoneId;
      } else {
        timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        locationLog.warn(2, `Timezone API failed - using fallback: ${timeZone}`, OP.API);
      }
      
      // ═══════════════════════════════════════════════════════════════════════════
      // STORE IN CACHE: Save resolved data for future lookups (6-decimal precision)
      // All 5 fields must be present: city, state, country, formatted_address, timezone
      // ═══════════════════════════════════════════════════════════════════════════
      const cacheFields = { city, state, country, formatted_address: formattedAddress, timezone: timeZone };
      const missingCacheFields = Object.entries(cacheFields)
        .filter(([_, v]) => !v)
        .map(([k]) => k);

      if (missingCacheFields.length === 0) {
        try {
          await db.insert(coords_cache).values({
            coord_key: coordKey,
            lat: Number(lat.toFixed(6)),
            lng: Number(lng.toFixed(6)),
            formatted_address: formattedAddress,
            city,
            state,
            country,
            timezone: timeZone,
            hit_count: 0,
          }).onConflictDoNothing();

          locationLog.done(3, `Cached: ${city}, ${state}`, OP.DB);
        } catch (cacheWriteErr) {
          locationLog.warn(3, `Cache write failed: ${cacheWriteErr.message}`, OP.DB);
        }
      }
    } // End of cache miss block

    let userId = null;
    const resolvedData = {
      city,
      state,
      country,
      timeZone,
      formattedAddress: formattedAddress || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      user_id: userId,
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // COORDS CACHE VALIDATION: Ensure consistency between cache and resolved values
    // If cache has data, prefer cached values for consistency across requests
    // ═══════════════════════════════════════════════════════════════════════════
    if (cacheHit) {
      const fieldsToValidate = ['city', 'state', 'country', 'formatted_address', 'timezone'];
      for (const field of fieldsToValidate) {
        const cacheValue = field === 'formatted_address' ? cacheHit.formatted_address :
                          field === 'timezone' ? cacheHit.timezone : cacheHit[field];
        const localValue = field === 'formatted_address' ? formattedAddress :
                          field === 'timezone' ? timeZone :
                          field === 'city' ? city :
                          field === 'state' ? state : country;
        if (cacheValue && localValue !== cacheValue) {
          console.warn(`[location] CONSISTENCY: ${field} mismatch - cache="${cacheValue}" vs resolved="${localValue}" - using cache value`);
          // Use cache value for consistency
          if (field === 'formatted_address') formattedAddress = cacheValue;
          else if (field === 'timezone') timeZone = cacheValue;
          else if (field === 'city') city = cacheValue;
          else if (field === 'state') state = cacheValue;
          else if (field === 'country') country = cacheValue;
        }
      }
      // Update resolvedData with cache-validated values
      resolvedData.city = city;
      resolvedData.state = state;
      resolvedData.country = country;
      resolvedData.timeZone = timeZone;
      resolvedData.formattedAddress = formattedAddress || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }

    // Save to users table if device_id provided
    if (deviceId) {
      try {
        const now = new Date();
        const tz = timeZone || 'America/Chicago';
        const hour = new Date(now.toLocaleString('en-US', { timeZone: tz })).getHours();
        const dow = new Date(now.toLocaleString('en-US', { timeZone: tz })).getDay();
        const dayPartKey = getDayPartKey(hour);
        
        const existingUser = await db.query.users.findFirst({
          where: eq(users.device_id, deviceId),
        }).catch(() => null);
        
        if (existingUser) {
          userId = existingUser.user_id;
          
          try {
            // CRITICAL FIX: Validate formatted_address is not null before database write
            if (!formattedAddress) {
              console.error('[location] ❌ CRITICAL: formattedAddress is null/empty - refusing to update users table', {
                lat, lng, city, state, accuracy, deviceId, coordSource,
                reason: 'Google API may have returned empty string or reverse-geocoding failed'
              });
              return res.status(502).json({
                ok: false,
                error: 'location_persistence_failed',
                message: 'Location could not be resolved to precise address. Try allowing GPS permissions or moving to a different location.'
              });
            }
            
            // CRITICAL FIX Finding #4: Verify database write committed before returning
            // Use raw query with RETURNING to get confirmation row was updated
            const updateResult = await db.update(users)
              .set({
                new_lat: lat,
                new_lng: lng,
                accuracy_m: accuracy,
                session_id: sessionId,
                coord_key: coordKey, // FK to coords_cache for location identity
                formatted_address: formattedAddress,
                city,
                state,
                country,
                timezone: tz,
                coord_source: coordSource,
                local_iso: now,
                dow,
                hour,
                day_part_key: dayPartKey,
                updated_at: now,
              })
              .where(eq(users.device_id, deviceId));
            
            // CRITICAL: Verify at least 1 row was updated (write committed)
            if (!updateResult || (Array.isArray(updateResult) && updateResult.length === 0)) {
              locationLog.error(1, `Users UPDATE failed - no rows affected`, null, OP.DB);
              return res.status(502).json({
                ok: false,
                error: 'location_persistence_failed',
                message: 'Database write did not commit - no rows updated'
              });
            }
          } catch (updateErr) {
            locationLog.error(1, `Users UPDATE failed`, updateErr, OP.DB);
            return res.status(502).json({
              ok: false,
              error: 'location_persistence_failed',
              message: 'Failed to save location to database',
              details: updateErr.message
            });
          }
        } else {
          userId = crypto.randomUUID();
          const newUser = {
            user_id: userId,
            device_id: deviceId,
            lat,
            lng,
            accuracy_m: accuracy,
            session_id: sessionId,
            coord_source: coordSource,
            coord_key: coordKey, // FK to coords_cache for location identity
            formatted_address: formattedAddress,
            city,
            state,
            country,
            timezone: tz,
            local_iso: now,
            dow,
            hour,
            day_part_key: dayPartKey,
            created_at: now,
            updated_at: now,
          };
          
          try {
            await db.insert(users).values(newUser);
          } catch (insertErr) {
            locationLog.error(1, `Users INSERT failed`, insertErr, OP.DB);
            return res.status(502).json({
              ok: false,
              error: 'location_persistence_failed',
              message: 'Failed to save location to database',
              details: insertErr.message
            });
          }
        }

        // Update response with user_id for client-side tracking
        resolvedData.user_id = userId;
        locationLog.done(1, `Users table: ${city}, ${state}`, OP.DB);

        // ═══════════════════════════════════════════════════════════════════════════
        // CREATE SNAPSHOT: Server generates snapshot_id, pulls from users table
        // Each resolve request = new snapshot (user requesting fresh data)
        // ═══════════════════════════════════════════════════════════════════════════
        const snapshotId = crypto.randomUUID();
        snapshotLog.phase(1, `Creating for ${city}, ${state}`, OP.DB);

        try {
          // Calculate date in user's timezone
          const dateFormatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: timeZone || 'America/Chicago',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          });
          const localDate = dateFormatter.format(now);

          // Create snapshot with location identity from users table
          const snapshotRecord = {
            snapshot_id: snapshotId,
            created_at: now,
            date: localDate,
            user_id: userId,
            device_id: deviceId,
            session_id: sessionId || crypto.randomUUID(),
            // Location coordinates
            lat,
            lng,
            // FK to coords_cache for location identity
            coord_key: coordKey,
            // LEGACY: Location identity (kept for backward compat)
            city,
            state,
            country,
            formatted_address: formattedAddress,
            timezone: timeZone,
            // Time context (calculated fresh)
            local_iso: now,
            dow,
            hour,
            day_part_key: dayPartKey,
            // H3 geohash for density analysis
            h3_r8: latLngToCell(lat, lng, 8),
            // Weather/air will be enriched by client or separate call
            weather: null,
            air: null,
            // Device info
            device: { platform: 'web' },
            permissions: { geolocation: 'granted' }
          };

          // Validate all required fields are present before INSERT (schema has NOT NULL constraints)
          validateSnapshotFields(snapshotRecord);

          await db.insert(snapshots).values(snapshotRecord);
          snapshotLog.done(1, `${snapshotId.slice(0, 8)}`, OP.DB);

          // Update users.current_snapshot_id to link user to this session
          await db.update(users)
            .set({ current_snapshot_id: snapshotId })
            .where(eq(users.device_id, deviceId));

          // Add snapshot_id to response
          resolvedData.snapshot_id = snapshotId;

        } catch (snapshotErr) {
          snapshotLog.error(1, `Failed to create`, snapshotErr, OP.DB);
          // Don't fail the whole request - location is resolved, snapshot is optional
          // Client can still create snapshot via POST /api/location/snapshot
        }

      } catch (err) {
        console.warn('[location] Failed to save user location:', err.message);
      }
    }

    // Always explicitly set JSON content-type to prevent HTML leaks
    res.setHeader('Content-Type', 'application/json');
    res.json(resolvedData);
  } catch (err) {
    console.error('[location] resolve error', err);
    // Always set JSON content-type to prevent HTML leaks on error
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ error: 'location-resolve-failed', message: err.message });
  }
});

// GET /api/location/weather?lat=&lng=
// Get current weather conditions for coordinates using Google Weather API
router.get('/weather', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);

    if (!isFinite(lat) || !isFinite(lng)) {
      return res.status(400).json({ error: 'lat/lng required' });
    }

    if (!GOOGLE_MAPS_API_KEY) {
      console.warn('[location] No Google Maps API key configured');
      return res.json({ 
        available: false,
        error: 'API key not configured' 
      });
    }

    // Use Google Weather API with all required fields
    const [currentRes, forecastRes] = await Promise.all([
      fetch(`https://weather.googleapis.com/v1/currentConditions:lookup?location.latitude=${lat}&location.longitude=${lng}&key=${GOOGLE_MAPS_API_KEY}`, {
        headers: { 'X-Goog-Api-Client': 'gl-node/' }
      }),
      fetch(`https://weather.googleapis.com/v1/forecast/hours:lookup?location.latitude=${lat}&location.longitude=${lng}&hours=6&key=${GOOGLE_MAPS_API_KEY}`, {
        headers: { 'X-Goog-Api-Client': 'gl-node/' }
      })
    ]);

    let current = null;
    let forecast = [];

    if (currentRes.ok) {
      const currentData = await currentRes.json();
      
      // Google Weather API returns Celsius in nested structure: {degrees: 8.2, unit: "CELSIUS"}
      const tempC = currentData.temperature?.degrees ?? currentData.temperature;
      const tempF = tempC ? Math.round((tempC * 9/5) + 32) : null;
      const feelsLikeC = currentData.feelsLikeTemperature?.degrees ?? currentData.feelsLikeTemperature;
      const feelsLikeF = feelsLikeC ? Math.round((feelsLikeC * 9/5) + 32) : null;
      
      current = {
        available: true,
        temperature: tempF,
        tempF: tempF,
        feelsLike: feelsLikeF,
        conditions: currentData.weatherCondition?.description?.text,
        description: currentData.weatherCondition?.description?.text || 'Unknown',
        humidity: currentData.relativeHumidity?.value ?? currentData.relativeHumidity,
        windSpeed: currentData.windSpeed?.value ?? currentData.windSpeed,
        windDirection: currentData.wind?.direction?.cardinal,
        uvIndex: currentData.uvIndex,
        precipitation: currentData.precipitation,
        visibility: currentData.visibility,
        isDaytime: currentData.isDaytime
      };
    }

    if (forecastRes.ok) {
      const forecastData = await forecastRes.json();
      forecast = (forecastData.forecastHours || []).slice(0, 6).map((hour) => {
        const tempC = hour.temperature?.degrees ?? hour.temperature;
        const tempF = tempC ? Math.round((tempC * 9/5) + 32) : null;
        return {
          time: hour.time,
          temperature: tempF,
          tempF: tempF,
          conditions: hour.condition?.text ?? hour.weatherCondition?.description?.text,
          precipitationProbability: hour.precipitationProbability?.value ?? hour.precipitation?.probability?.percent,
          windSpeed: hour.windSpeed?.value ?? hour.wind?.speed,
          isDaytime: hour.isDaytime
        };
      });
    }

    locationLog.done(1, `Weather: ${current?.tempF}°F ${current?.conditions || ''}`, OP.API);

    res.json({
      ...current,
      forecast
    });
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

    locationLog.done(1, `Air Quality: AQI ${aqData.aqi} (${aqData.category})`, OP.API);

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
router.post('/snapshot', validateBody(snapshotMinimalSchema), async (req, res) => {
  const cid = req.cid || req.get('x-correlation-id') || crypto.randomUUID();
  res.setHeader('x-correlation-id', cid);

  // Import ndjson and getAgentState
  const { ndjson } = await import('../../logger/ndjson.js');
  const { getAgentState } = await import('../../db/connection-manager.js');
  
  ndjson('snapshot.req', { 
    cid, 
    path: req.path, 
    deploy_mode: process.env.DEPLOY_MODE,
    agent_state: getAgentState().degraded ? 'degraded' : 'healthy'
  });

  // Check if agent is degraded
  const { degraded, currentBackoffDelay } = getAgentState();
  if (degraded) {
    const retryAfter = Math.ceil((currentBackoffDelay || 2000) / 1000);
    ndjson('snapshot.rejected', { cid, reason: 'degraded', retry_after: retryAfter });
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(503).json({ 
      cid,
      state: 'degraded',
      error: 'Database temporarily unavailable. Please retry.',
      retry_after: retryAfter
    });
  }

  console.log('[snapshot] handler ENTER', { url: req.originalUrl, method: req.method, hasBody: !!req.body, cid });
  try {
    console.log('[snapshot] processing snapshot...');
    const snapshotV1 = req.body;

    // Minimal mode support for curl/preflight tests
    const isMinimalMode = snapshotV1?.lat && snapshotV1?.lng && !snapshotV1?.resolved;
    
    if (isMinimalMode) {
      console.log('[snapshot] Minimal mode detected - resolving city/timezone server-side');
      const { lat, lng, userId } = snapshotV1;
      
      if (!lat || !lng) {
        ndjson('snapshot.bad_payload', { cid, reason: 'missing_lat_lng' });
        return httpError(res, 400, 'missing_lat_lng', 'Coordinates required', cid);
      }
      
      // Validate coordinate ranges
      if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        ndjson('snapshot.bad_payload', { cid, reason: 'invalid_coordinates', lat, lng });
        return httpError(res, 400, 'invalid_coordinates', 'Coordinates out of valid range', cid);
      }
      
      // Validate userId is a valid UUID or null/undefined
      const isValidUUID = userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
      const validatedUserId = isValidUUID ? userId : null;

      // CRITICAL: Call resolver logic directly instead of making internal HTTP request
      // Internal HTTP requests can cause deadlocks when middleware is blocking
      let resolved;
      try {
        // Get city/timezone from Google Geocoding API directly
        const geocodeUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json');
        geocodeUrl.searchParams.set('latlng', `${lat},${lng}`);
        geocodeUrl.searchParams.set('key', GOOGLE_MAPS_API_KEY);
        
        const geocodeRes = await googleMapsCircuit(async (signal) => {
          const response = await fetch(geocodeUrl.toString(), { signal });
          if (!response.ok) throw new Error(`Geocode API error: ${response.status}`);
          return await response.json();
        });
        
        if (geocodeRes.status !== 'OK' || !geocodeRes.results?.[0]) {
          console.error('[snapshot] Geocoding API error:', geocodeRes.status, geocodeRes.error_message);
          return httpError(res, 502, 'resolve_failed', `Google Maps API error: ${geocodeRes.error_message || geocodeRes.status}`, cid);
        }
        
        const { city, state, country } = pickAddressParts(geocodeRes.results[0].address_components);
        const formattedAddress = geocodeRes.results[0].formatted_address;
        
        // Get timezone
        const tzUrl = new URL('https://maps.googleapis.com/maps/api/timezone/json');
        tzUrl.searchParams.set('location', `${lat},${lng}`);
        tzUrl.searchParams.set('timestamp', Math.floor(Date.now() / 1000).toString());
        tzUrl.searchParams.set('key', GOOGLE_MAPS_API_KEY);
        
        const tzRes = await googleMapsCircuit(async (signal) => {
          const response = await fetch(tzUrl.toString(), { signal });
          if (!response.ok) throw new Error(`Timezone API error: ${response.status}`);
          return await response.json();
        });
        
        const timeZone = tzRes.status === 'OK' ? tzRes.timeZoneId : 'America/Chicago';
        
        resolved = { city, state, country, formattedAddress, timeZone };
        
      } catch (err) {
        console.error('[snapshot] Location resolution failed:', err.message);
        return httpError(res, 502, 'resolve_failed', 'Failed to resolve location', cid);
      }
      
      if (!resolved.timeZone || !(resolved.city || resolved.formattedAddress)) {
        return httpError(res, 400, 'resolve_incomplete', 'Location resolution incomplete', cid);
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
      
      // Add time context with proper timezone handling
      // Extract hour using Intl.DateTimeFormat with the target timezone
      const hourFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: resolved.timeZone,
        hour: 'numeric',
        hour12: false
      });
      const hour = parseInt(hourFormatter.format(now));
      
      // Extract day of week using Intl.DateTimeFormat with the target timezone
      const dayFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: resolved.timeZone,
        weekday: 'long'
      });
      const dayName = dayFormatter.format(now);
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const localDow = dayNames.indexOf(dayName);
      
      snapshotV1.time_context = {
        local_iso: now.toISOString(),
        dow: localDow >= 0 ? localDow : now.getDay(), // Fallback to UTC day if parse fails
        hour: hour,
        day_part_key: getDayPartKey(hour)
      };
      
      console.log('[snapshot] Minimal mode enriched with:', { 
        city: resolved.city, 
        timezone: resolved.timeZone,
        snapshot_id 
      });
    } else {
      // ═══════════════════════════════════════════════════════════════════════════
      // USERS TABLE FALLBACK: If client has device_id but missing resolved data,
      // try to pull from users table (source of truth for location identity)
      // ═══════════════════════════════════════════════════════════════════════════
      if (snapshotV1.device_id && (!snapshotV1.resolved?.city || !snapshotV1.resolved?.formattedAddress)) {
        try {
          const existingUser = await db.query.users.findFirst({
            where: eq(users.device_id, snapshotV1.device_id),
          });

          if (existingUser?.city && existingUser?.formatted_address) {
            console.log(`📍 [SNAPSHOT] ✅ Pulling location from users table for device ${snapshotV1.device_id.slice(0, 8)}`);
            snapshotV1.resolved = {
              ...snapshotV1.resolved,
              city: existingUser.city,
              state: existingUser.state,
              country: existingUser.country,
              formattedAddress: existingUser.formatted_address,
              timezone: existingUser.timezone
            };
            // Update coords from users table if available
            if (existingUser.new_lat && existingUser.new_lng) {
              snapshotV1.coord = {
                ...snapshotV1.coord,
                lat: existingUser.new_lat,
                lng: existingUser.new_lng
              };
            }
          }
        } catch (userLookupErr) {
          console.warn('[SNAPSHOT] Users table lookup failed:', userLookupErr.message);
        }
      }

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

      // CRITICAL: If client sent resolved location data, ensure it's properly structured
      // This handles the full SnapshotV1 path where client sends complete location context
      if (snapshotV1.resolved && !snapshotV1.resolved.formattedAddress && snapshotV1.coord) {
        console.log('[snapshot] ⚠️ Client sent resolved but missing formattedAddress - resolving server-side');
        try {
          const { lat, lng } = snapshotV1.coord;
          const geocodeUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json');
          geocodeUrl.searchParams.set('latlng', `${lat},${lng}`);
          geocodeUrl.searchParams.set('key', GOOGLE_MAPS_API_KEY);
          
          const geocodeRes = await googleMapsCircuit(async (signal) => {
            const response = await fetch(geocodeUrl.toString(), { signal });
            if (!response.ok) throw new Error(`Geocode API error: ${response.status}`);
            return await response.json();
          });
          
          if (geocodeRes.status === 'OK' && geocodeRes.results?.[0]) {
            const { city, state, country } = pickAddressParts(geocodeRes.results[0].address_components);
            const formattedAddress = geocodeRes.results[0].formatted_address;
            snapshotV1.resolved.city = city;
            snapshotV1.resolved.state = state;
            snapshotV1.resolved.country = country;
            snapshotV1.resolved.formattedAddress = formattedAddress;
            console.log('[snapshot] ✅ Resolved missing address fields:', { city, state, formattedAddress });
          }
        } catch (resolveErr) {
          console.warn('[snapshot] Could not resolve missing address:', resolveErr.message);
        }
      }
      
      // Log what we're about to save
      console.log('[snapshot] Full mode - client sent resolved location:', {
        formattedAddress: snapshotV1.resolved?.formattedAddress,
        city: snapshotV1.resolved?.city,
        state: snapshotV1.resolved?.state,
        country: snapshotV1.resolved?.country,
        timezone: snapshotV1.resolved?.timezone
      });
    }

    console.log('[snapshot] Calculating H3 geohash...');
    // Calculate H3 geohash at resolution 8 (~0.46 km² hexagons)
    const h3_r8 = latLngToCell(snapshotV1.coord.lat, snapshotV1.coord.lng, 8);

    // Fetch holiday and airport context in parallel (both are fast enrichments)
    console.log('[snapshot] Fetching airport context and holiday info in parallel...');
    const { getNearestMajorAirport, fetchFAADelayData } = await import('../../lib/external/faa-asws.js');
    const { detectHoliday } = await import('../../lib/location/holiday-detector.js');
    
    let airportContext = null;
    let holidayInfo = { holiday: 'none', is_holiday: false };

    // Run airport and holiday detection in parallel
    const [airportResult, holidayResult] = await Promise.allSettled([
      // Airport detection
      (async () => {
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
          return airportContext;
        } catch (airportErr) {
          console.warn('[snapshot] Airport context fetch failed:', airportErr.message);
          return null;
        }
      })(),
      // Holiday detection
      detectHoliday({
        created_at: snapshotV1.created_at,
        city: snapshotV1.resolved?.city,
        state: snapshotV1.resolved?.state,
        country: snapshotV1.resolved?.country || 'United States',
        timezone: snapshotV1.resolved?.timezone
      })
    ]);

    // Extract results from parallel promises
    if (airportResult.status === 'fulfilled') {
      airportContext = airportResult.value;
    }
    if (holidayResult.status === 'fulfilled') {
      holidayInfo = holidayResult.value;
    }
    
    console.log('[snapshot] ✅ Parallel enrichment complete:', {
      airport: airportContext ? `${airportContext.airport_code} (${airportContext.distance_miles}mi)` : 'none',
      holiday: holidayInfo.holiday || 'none',
      is_holiday: holidayInfo.is_holiday
    });

    // NOTE: Briefing data is now stored in separate 'briefings' table (generated via blocks-fast pipeline)

    // Transform SnapshotV1 to Postgres schema
    // Helper to safely parse dates, returning null for invalid dates
    const safeDate = (value) => {
      if (!value) return null;
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    };

    const createdAtDate = safeDate(snapshotV1.created_at) || new Date();
    
    // Calculate "today" in the driver's local timezone (not server timezone)
    // This ensures Hawaii, Alaska, etc. get the correct date
    const driverTimezone = snapshotV1.resolved?.timezone || 'America/Chicago';
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: driverTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = formatter.formatToParts(createdAtDate);
    const today = `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value}`;

    // Calculate coord_key from coordinates for coords_cache lookup
    const snapLat = snapshotV1.coord?.lat;
    const snapLng = snapshotV1.coord?.lng;
    const snapCoordKey = (snapLat && snapLng) ? makeCoordsKey(snapLat, snapLng) : null;

    const dbSnapshot = {
      snapshot_id: snapshotV1.snapshot_id,
      created_at: createdAtDate,
      date: today,
      user_id: (snapshotV1.user_id && snapshotV1.user_id.trim() !== '') ? snapshotV1.user_id : null,
      device_id: snapshotV1.device_id,
      session_id: snapshotV1.session_id,
      // Location coordinates
      lat: snapLat ?? null,
      lng: snapLng ?? null,
      // FK to coords_cache for location identity
      coord_key: snapCoordKey,
      // LEGACY: Location data (kept for backward compat)
      city: snapshotV1.resolved?.city ?? null,
      state: snapshotV1.resolved?.state ?? null,
      country: snapshotV1.resolved?.country ?? null,
      formatted_address: snapshotV1.resolved?.formattedAddress ?? null,
      timezone: snapshotV1.resolved?.timezone ?? null,
      // Time context from client
      local_iso: safeDate(snapshotV1.time_context?.local_iso) ?? null,
      hour: typeof snapshotV1.time_context?.hour === 'number' ? snapshotV1.time_context.hour : null,
      dow: typeof snapshotV1.time_context?.dow === 'number' ? snapshotV1.time_context.dow : null,
      day_part_key: snapshotV1.time_context?.day_part_key ?? null,
      h3_r8,
      // API-enriched contextual data ONLY
      weather: (snapshotV1.weather && typeof snapshotV1.weather === 'object' && snapshotV1.weather.tempF !== undefined) ? {
        tempF: snapshotV1.weather.tempF,
        conditions: snapshotV1.weather.conditions,
        description: snapshotV1.weather.description
      } : null,
      air: (snapshotV1.air && typeof snapshotV1.air === 'object' && snapshotV1.air.aqi !== undefined) ? {
        aqi: snapshotV1.air.aqi,
        category: snapshotV1.air.category
      } : null,
      airport_context: airportContext,
      holiday: holidayInfo.holiday,
      is_holiday: holidayInfo.is_holiday,
      device: snapshotV1.device || null,
      permissions: snapshotV1.permissions || null,
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SELF-CONTAINED VALIDATION: Verify snapshot has complete location identity
    // Users table = source of truth. Snapshot must have ALL resolved fields.
    // ═══════════════════════════════════════════════════════════════════════════
    const validationErrors = [];

    // GPS coordinates (required)
    if (!dbSnapshot.lat || !dbSnapshot.lng) {
      validationErrors.push('lat/lng');
    }

    // Resolved location identity (from users table)
    if (!dbSnapshot.city) validationErrors.push('city');
    if (!dbSnapshot.state) validationErrors.push('state');
    if (!dbSnapshot.formatted_address) validationErrors.push('formatted_address');
    if (!dbSnapshot.timezone) validationErrors.push('timezone');

    // Time context (required for AI models)
    if (dbSnapshot.hour === undefined || dbSnapshot.hour === null) validationErrors.push('hour');
    if (dbSnapshot.dow === undefined || dbSnapshot.dow === null) validationErrors.push('dow');
    if (!dbSnapshot.day_part_key) validationErrors.push('day_part_key');

    if (validationErrors.length > 0) {
      console.error('[Snapshot] ❌ VALIDATION FAILED: Missing fields:', validationErrors);
      console.error('[Snapshot] Received data:', {
        lat: dbSnapshot.lat,
        lng: dbSnapshot.lng,
        city: dbSnapshot.city,
        state: dbSnapshot.state,
        formatted_address: dbSnapshot.formatted_address,
        timezone: dbSnapshot.timezone,
        hour: dbSnapshot.hour,
        dow: dbSnapshot.dow,
        day_part_key: dbSnapshot.day_part_key
      });
      return httpError(res, 400, 'incomplete_snapshot',
        `Location not fully resolved. Missing: ${validationErrors.join(', ')}. Call /api/location/resolve first.`, cid);
    }

    console.log('[Snapshot] ✅ Self-contained validation passed:', {
      lat: dbSnapshot.lat,
      lng: dbSnapshot.lng,
      city: dbSnapshot.city,
      state: dbSnapshot.state,
      formatted_address: dbSnapshot.formatted_address?.substring(0, 30) + '...',
      timezone: dbSnapshot.timezone,
      hour: dbSnapshot.hour,
      dow: dbSnapshot.dow,
      day_part_key: dbSnapshot.day_part_key
    });

    // Save to Replit PostgreSQL using Drizzle ORM
    // Uses DATABASE_URL automatically injected by Replit for both dev and production
    console.log('[Snapshot DB] 💾 Writing SELF-CONTAINED snapshot to database:');
    console.log('  → snapshot_id:', dbSnapshot.snapshot_id);
    console.log('  → LOCATION: lat=%s lng=%s city=%s state=%s timezone=%s', 
      dbSnapshot.lat, dbSnapshot.lng, dbSnapshot.city, dbSnapshot.state, dbSnapshot.timezone);
    console.log('  → TIME: date=%s hour=%s dow=%s day_part=%s', dbSnapshot.date, dbSnapshot.hour, dbSnapshot.dow, dbSnapshot.day_part_key);
    console.log('  → weather:', dbSnapshot.weather);
    console.log('  → air:', dbSnapshot.air);
    console.log('  → airport_context:', dbSnapshot.airport_context);
    
    try {
      // Validate all required fields are present before INSERT (schema has NOT NULL constraints)
      validateSnapshotFields(dbSnapshot);

      await db.insert(snapshots).values(dbSnapshot);
      console.log('[Snapshot DB] ✅ Snapshot successfully written to database');
    } catch (dbError) {
      console.error('[Snapshot DB] ❌ Database insert failed:', dbError);
      console.error('[Snapshot DB] Failed snapshot data:', JSON.stringify(dbSnapshot, null, 2));
      throw dbError;
    }

    // Log travel disruptions for airports with delays (non-blocking)
    if (airportContext && airportContext.airport_code && (airportContext.delay_minutes || airportContext.closure_status !== 'open')) {
      try {
        const { travel_disruptions } = await import('../../../shared/schema.js');
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

    // Convert dow to day name
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = dayNames[snapshotV1.time_context?.dow] || 'unknown';

    // Format date from local_iso
    const localDate = snapshotV1.time_context?.local_iso ? new Date(snapshotV1.time_context.local_iso).toISOString().split('T')[0] : 'unknown';

    console.log('[location] ✅ Snapshot saved - Summary:');
    console.log('  📍 Location: city =', snapshotV1.resolved?.city, ', state =', snapshotV1.resolved?.state);
    console.log('  🕐 Time: date =', localDate, ', day_part =', snapshotV1.time_context?.day_part_key, ', hour =', snapshotV1.time_context?.hour);
    console.log('  🌤️ Weather: weather =', snapshotV1.weather ? `${snapshotV1.weather.tempF}°F ${snapshotV1.weather.conditions}` : 'none');
    console.log('  🌫️ Air: air_quality =', snapshotV1.air ? `AQI ${snapshotV1.air.aqi}` : 'none');
    console.log('  🛫 Airport: airport_context =', airportContext ? `${airportContext.airport_code} (${airportContext.distance_miles}mi, ${airportContext.delay_minutes}min delays)` : 'none');

    // REMOVED: Strategy row creation - strategy-generator-parallel.js creates the SINGLE strategy row
    // The strategy generator will fetch all enriched data from the complete snapshot row
    // This ensures: 1) No race conditions, 2) model_name preserved, 3) Full snapshot context available

    // Call parallel providers directly instead of enqueueing job
    console.log(`[location] 📍 Snapshot created: ${snapshotV1.snapshot_id}`, {
      hasAddress: !!snapshotV1.resolved?.formattedAddress,
      hasCity: !!snapshotV1.resolved?.city,
      address: snapshotV1.resolved?.formattedAddress,
      city: snapshotV1.resolved?.city,
      state: snapshotV1.resolved?.state
    });
    
    // NOTE: Strategy pipeline is triggered by blocks-fast POST endpoint (not here)
    // This prevents race conditions between two parallel triggers
    // blocks-fast ensures: 1) Briefing completes before consolidation
    //                      2) Proper fail-fast if briefing fails
    //                      3) Single pipeline execution path
    console.log(`[location] 📍 Snapshot ready for strategy pipeline: ${snapshotV1.snapshot_id} (triggered via /api/blocks-fast)`);

    res.json({
      success: true,
      snapshot_id: snapshotV1.snapshot_id,
      h3_r8,
      status: 'snapshot_created',
      req_id: cid
    });
  } catch (err) {
    console.error('[location] snapshot error', err);
    return httpError(res, 500, 'snapshot_failed', String(err?.message || err), cid);
  }
});

// POST /api/location/news-briefing
// Generate local news briefing for rideshare drivers
router.post('/news-briefing', validateBody(newsBriefingSchema), async (req, res) => {
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
      state: state || address.split(',')[1]?.trim() || null,
      timezone: null, // Will be resolved via Google Timezone API if needed
      created_at: new Date().toISOString(),
      airport_context: null // Will be determined by Gemini
    };

    // Generate news briefing using briefing-service
    const { generateAndStoreBriefing } = await import('../../lib/briefing/briefing-service.js');
    const result = await generateAndStoreBriefing({
      snapshotId: snapshot.snapshot_id,
      lat: latitude,
      lng: longitude,
      city: snapshot.city,
      state: snapshot.state,
      country: 'United States',
      formattedAddress: address
    });

    res.json({
      ok: true,
      briefing: result.briefing || {},
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

// GET /api/users/me
// CRITICAL FIX Issue #5: Fetch current user's latest location directly from users table
// Header can call this instead of relying on cached context state
// Always returns fresh data from authoritative source
router.get('/users/me', async (req, res) => {
  try {
    const deviceId = req.query.device_id;
    
    if (!deviceId) {
      return res.status(400).json({ 
        ok: false,
        error: 'device_id_required',
        message: 'device_id query parameter required'
      });
    }
    
    console.log('[users/me] Fetching latest location for device:', deviceId);
    
    const [userRecord] = await db
      .select()
      .from(users)
      .where(eq(users.device_id, deviceId))
      .limit(1);
    
    if (!userRecord) {
      console.warn('[users/me] No user found for device:', deviceId);
      return res.status(404).json({
        ok: false,
        error: 'user_not_found',
        message: 'No location data found for this device'
      });
    }

    // FALLBACK: If users table missing city/state, lookup from coords_cache via coord_key
    let city = userRecord.city;
    let state = userRecord.state;
    let country = userRecord.country;
    let formattedAddress = userRecord.formatted_address;

    if ((!city || !formattedAddress) && userRecord.coord_key) {
      console.log('[users/me] ⚠️ Users table missing city/state, checking coords_cache...');
      try {
        const [cacheRecord] = await db
          .select()
          .from(coords_cache)
          .where(eq(coords_cache.coord_key, userRecord.coord_key))
          .limit(1);

        if (cacheRecord) {
          city = city || cacheRecord.city;
          state = state || cacheRecord.state;
          country = country || cacheRecord.country;
          formattedAddress = formattedAddress || cacheRecord.formatted_address;
          console.log('[users/me] ✅ Populated from coords_cache:', { city, state, formattedAddress });

          // Backfill users table for next time (fire and forget)
          db.update(users)
            .set({ city, state, country, formatted_address: formattedAddress })
            .where(eq(users.device_id, deviceId))
            .catch(() => {});
        }
      } catch (cacheErr) {
        console.warn('[users/me] coords_cache lookup failed:', cacheErr.message);
      }
    }

    // Return latest location data from authoritative users table
    console.log('[users/me] ✅ Returning latest location:', {
      user_id: userRecord.user_id,
      formatted_address: formattedAddress,
      city,
      state,
      updated_at: userRecord.updated_at
    });

    // CRITICAL FIX Finding #2: Return camelCase to match /api/location/resolve contract
    res.json({
      ok: true,
      user_id: userRecord.user_id,
      device_id: userRecord.device_id,
      formattedAddress: formattedAddress,
      city,
      state,
      country,
      timeZone: userRecord.timezone,
      lat: userRecord.new_lat || userRecord.lat,
      lng: userRecord.new_lng || userRecord.lng,
      accuracy_m: userRecord.accuracy_m,
      dow: userRecord.dow,
      hour: userRecord.hour,
      day_part_key: userRecord.day_part_key,
      updated_at: userRecord.updated_at
    });
  } catch (err) {
    console.error('[users/me] fetch error:', err);
    res.status(500).json({
      ok: false,
      error: 'fetch_failed',
      message: String(err?.message || err)
    });
  }
});

// PATCH /api/location/snapshot/:snapshotId/enrich
// Enrich an existing snapshot with weather/air data
router.patch('/snapshot/:snapshotId/enrich', async (req, res) => {
  try {
    const { snapshotId } = req.params;
    const { weather, air } = req.body;

    if (!snapshotId) {
      return res.status(400).json({ error: 'snapshot_id_required' });
    }

    // Verify snapshot exists
    const [existing] = await db
      .select({ snapshot_id: snapshots.snapshot_id })
      .from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: 'snapshot_not_found' });
    }

    // Build update payload (only include provided fields)
    const updatePayload = {};
    if (weather !== undefined) updatePayload.weather = weather;
    if (air !== undefined) updatePayload.air = air;

    if (Object.keys(updatePayload).length === 0) {
      return res.status(400).json({ error: 'no_fields_to_update' });
    }

    await db.update(snapshots)
      .set(updatePayload)
      .where(eq(snapshots.snapshot_id, snapshotId));

    snapshotLog.done(2, `Enriched ${snapshotId.slice(0, 8)}: ${Object.keys(updatePayload).join(', ')}`, OP.DB);

    res.json({ ok: true, enriched: Object.keys(updatePayload) });
  } catch (err) {
    console.error('[location] snapshot enrich error:', err);
    res.status(500).json({
      error: 'enrich_failed',
      message: String(err?.message || err)
    });
  }
});

// GET /api/snapshots/:snapshotId
// Fetch snapshot data including airport context
router.get('/snapshots/:snapshotId', async (req, res) => {
  try {
    const { snapshotId } = req.params;
    
    if (!snapshotId) {
      return res.status(400).json({ error: 'snapshot_id_required' });
    }
    
    const [snapshot] = await db
      .select()
      .from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId))
      .limit(1);
    
    if (!snapshot) {
      return res.status(404).json({ error: 'snapshot_not_found' });
    }
    
    res.json(snapshot);
  } catch (err) {
    console.error('[location] snapshot fetch error:', err);
    res.status(500).json({ 
      error: 'fetch_failed',
      message: String(err?.message || err)
    });
  }
});

export default router;