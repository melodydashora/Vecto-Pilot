// server/api/location/location.js
import { Router } from 'express';
import { db } from '../../db/drizzle.js';
import { snapshots } from '../../../shared/schema.js';
import { eq, and } from 'drizzle-orm';
import { matrixLog } from '../../logger/workflow.js';
import { normalizeCoordinates } from '../../../shared/coordinates.js';
import { getSnapshotReadiness } from '../../lib/location/snapshot-readiness.js';
import { snapshotEnvironment } from '../../lib/location/snapshot-environment.js';
import { enrichSnapshot } from '../../lib/location/enrich-snapshot.js';
import { pickAddressParts, pickBestGeocodeResult, getTimezoneDataForCoords } from '../../lib/location/geocode.js';
import { portalSnapshotHandler, sendSnapshotError } from '../../lib/location/main-run-snapshot.js';
import { assertCurrentMainRun, assertMainRunForSnapshot } from '../../lib/main-run-admission.js';
import { makeCircuit } from '../../util/circuit.js';
import { validateBody } from '../../middleware/validate.js';
import { snapshotMinimalSchema } from '../../validation/schemas.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireSnapshotOwnership } from '../../middleware/require-snapshot-ownership.js';

const router = Router();

// 2026-02-12: SECURITY FIX - All location routes now require authentication
// Previously these were completely open, allowing geocoding, snapshot creation, etc. without auth
router.use(requireAuth);

// Circuit breakers for external APIs (fail-fast, no fallbacks)
const googleMapsCircuit = makeCircuit({
  name: 'google-maps',
  failureThreshold: 3,
  resetAfterMs: 30000,
  timeoutMs: 5000
});


const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// UNIFIED: Accept manual city overrides consistently (test and debug feature)

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

// Historical snapshot evidence is retained. Replacement requires a new Continue intent.
router.post('/release-snapshot', (_req, res) => res.status(409).json({
  ok: false, error: 'explicit_continue_required', message: 'Review saved setup and choose Continue with saved preferences.',
}));

// GET /api/location/geocode/reverse?lat=&lng=
// Reverse geocode coordinates to city/state/country + place_id
// Enhanced: Plus Code filtering, rate limiting, place_id return
router.get('/geocode/reverse', async (req, res) => {
  try {
    const coords = normalizeCoordinates(req.query.lat, req.query.lng);
    const { lat, lng } = coords || {};
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

    // Rate limiting check
    const rateCheck = checkGeoRateLimit(clientIp);
    if (!rateCheck.allowed) {
      console.warn(`[LOCATION] Rate limit exceeded for IP: ${clientIp}`);
      return res.status(429).json({
        error: 'RATE_LIMIT_EXCEEDED',
        message: `Too many geocoding requests. Try again in ${rateCheck.resetIn} seconds.`,
        resetIn: rateCheck.resetIn
      });
    }

    if (!coords) {
      return res.status(400).json({ error: 'lat/lng required' });
    }

    if (!GOOGLE_MAPS_API_KEY) {
      console.warn('[LOCATION] No Google Maps API key configured');
      return res.status(503).json({ error: 'LOCATION_UNAVAILABLE', message: 'Google location provider is not configured.' });
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
      console.error('[LOCATION] Geocoding error:', data.status);
      console.error('[LOCATION] Google API response:', JSON.stringify(data, null, 2));
      return res.status(500).json({ error: `Geocoding failed: ${data.status}`, details: data.error_message });
    }

    // Use Plus Code filtering to get best result (prefers street addresses)
    const best = pickBestGeocodeResult(data.results);
    if (typeof best?.formatted_address !== 'string' || !best.formatted_address.trim()) {
      return res.status(502).json({ error: 'reverse-geocode-incomplete' });
    }
    const { city, state, country } = best
      ? pickAddressParts(best.address_components)
      : { city: undefined, state: undefined, country: undefined };

    res.json({
      city,
      state,
      country,
      place_id: best?.place_id || undefined,
      formattedAddress: best.formatted_address,
      // Include coordinates from Google (may be slightly adjusted for accuracy)
      lat: best?.geometry?.location?.lat ?? lat,
      lng: best?.geometry?.location?.lng ?? lng,
    });
  } catch (err) {
    console.error('[LOCATION] reverse geocode error', err);
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
      console.warn(`[LOCATION] Rate limit exceeded for IP: ${clientIp}`);
      return res.status(429).json({
        error: 'RATE_LIMIT_EXCEEDED',
        message: `Too many geocoding requests. Try again in ${rateCheck.resetIn} seconds.`,
        resetIn: rateCheck.resetIn
      });
    }

    if (typeof cityName !== 'string' || !cityName.trim()) {
      return res.status(400).json({ error: 'city query parameter required' });
    }

    if (!GOOGLE_MAPS_API_KEY) {
      console.warn('[LOCATION] No Google Maps API key configured');
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
      console.error('[LOCATION] Forward geocoding error:', data.status);
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
    console.error('[LOCATION] forward geocode error', err);
    res.status(500).json({ error: 'forward-geocode-failed' });
  }
});

// GET /api/location/timezone?lat=&lng=
// Get timezone for coordinates
router.get('/timezone', async (req, res) => {
  try {
    const coords = normalizeCoordinates(req.query.lat, req.query.lng);
    const { lat, lng } = coords || {};

    if (!coords) {
      return res.status(400).json({ error: 'lat/lng required' });
    }

    if (!GOOGLE_MAPS_API_KEY) {
      // 2026-01-06: NO FALLBACKS - Cannot guess timezone from server
      console.error('[LOCATION] No Google Maps API key configured - cannot resolve timezone');
      return res.status(503).json({
        error: 'TIMEZONE_UNAVAILABLE',
        message: 'Google Maps API key not configured. Timezone lookup unavailable.',
        code: 'missing_api_key'
      });
    }

    const data = await googleMapsCircuit(signal => getTimezoneDataForCoords(lat, lng, { signal }));

    res.json({
      timeZone: data.timeZoneId,
      timeZoneName: data.timeZoneName,
    });
  } catch (err) {
    // 2026-01-09: P0-1 FIX - NO FALLBACKS - Return error instead of server timezone
    // Server timezone would silently poison all downstream strategy/briefing logic
    // Client must retry or surface a "GPS/timezone required" state
    console.error('[LOCATION] timezone error', err);
    return res.status(502).json({
      error: 'TIMEZONE_LOOKUP_FAILED',
      message: 'Failed to resolve timezone from coordinates',
      code: 'lookup_error',
      details: err.message
    });
  }
});

// This GET creates a snapshot, so it uses the same admission as both legacy POSTs.
router.get('/resolve', portalSnapshotHandler);

// Header and persistence use the same server-only, exact-coordinate results.
// The Briefing weather pipeline owns the forecast; this route returns current conditions.
async function readRunEnvironment(req, res, field) {
  try {
    const coords = normalizeCoordinates(req.query.lat, req.query.lng);
    if (!coords) return res.status(400).json({ available: false, error: 'invalid_coordinates' });
    const admission = await assertCurrentMainRun(req.auth, req.query.runId);
    let value;
    if (admission.snapshot_id) {
      const [snapshot] = await db.select().from(snapshots).where(and(
        eq(snapshots.snapshot_id, admission.snapshot_id), eq(snapshots.user_id, req.auth.userId),
      )).limit(1);
      if (!snapshot || snapshot.lat !== coords.lat || snapshot.lng !== coords.lng) {
        return res.status(409).json({ available: false, error: 'run_coordinates_changed' });
      }
      value = snapshot[field];
    } else {
      value = await snapshotEnvironment[field](coords.lat, coords.lng, { scope: admission.run_id });
    }
    await assertCurrentMainRun(req.auth, admission.run_id);
    if (!value) return res.status(502).json({ available: false, error: field + '_unavailable' });
    return res.json(value);
  } catch (error) { return sendSnapshotError(res, error); }
}
router.get('/weather', (req, res) => readRunEnvironment(req, res, 'weather'));
router.get('/airquality', (req, res) => readRunEnvironment(req, res, 'air'));

// GET /api/location/pollen?lat=&lng=
// Get pollen forecast for coordinates (useful for drivers with allergies)
// 2026-01-05: Added using Google Pollen API
router.get('/pollen', async (req, res) => {
  try {
    const coords = normalizeCoordinates(req.query.lat, req.query.lng);
    const { lat, lng } = coords || {};
    const days = req.query.days === undefined ? 1 : Number(req.query.days);

    if (!coords) {
      return res.status(400).json({ error: 'lat/lng required' });
    }
    if (!Number.isInteger(days) || days < 1 || days > 5) return res.status(400).json({ error: 'days must be an integer from 1 to 5' });

    if (!GOOGLE_MAPS_API_KEY) {
      console.warn('[LOCATION] No Google Maps API key configured for Pollen');
      return res.json({
        available: false,
        error: 'API key not configured'
      });
    }

    const url = `https://pollen.googleapis.com/v1/forecast:lookup?location.latitude=${lat}&location.longitude=${lng}&days=${days}&key=${GOOGLE_MAPS_API_KEY}`;

    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[LOCATION] Pollen API error:', response.status, errorData);
      return res.json({
        available: false,
        error: errorData.error?.message || `API error: ${response.status}`
      });
    }

    const data = await response.json();

    // Extract pollen data
    const dailyInfo = data.dailyInfo || [];
    const pollenTypes = data.pollenTypeInfo || [];

    // Find today's info
    const today = dailyInfo[0];
    if (!today?.date || !Array.isArray(today.pollenTypeInfo) || !today.pollenTypeInfo.some(p => Number.isInteger(p.indexInfo?.value) && p.indexInfo.value >= 0 && p.indexInfo.value <= 5)) {
      return res.status(502).json({ available: false, error: 'pollen-measurements-unavailable' });
    }

    // Calculate overall severity (1-5 scale)
    let maxSeverity = 0;
    let dominantType = null;
    const alerts = [];

    if (today?.pollenTypeInfo) {
      for (const pollen of today.pollenTypeInfo) {
        const severity = pollen.indexInfo?.value;
        if (!Number.isInteger(severity) || severity < 0 || severity > 5) continue;
        if (severity > maxSeverity) {
          maxSeverity = severity;
          dominantType = pollen.code;
        }

        // Add alerts for high pollen (severity 3+)
        if (severity >= 3) {
          alerts.push({
            type: pollen.code,
            name: pollen.displayName || pollen.code,
            severity,
            category: pollen.indexInfo?.category || 'Unknown',
            healthRecommendations: pollen.healthRecommendations || []
          });
        }
      }
    }

    // Severity category mapping
    const severityLabels = ['None', 'Very Low', 'Low', 'Moderate', 'High', 'Very High'];

    const pollenData = {
      available: true,
      date: today?.date,
      overallSeverity: maxSeverity,
      overallCategory: severityLabels[Math.min(maxSeverity, 5)] || 'Unknown',
      dominantPollen: dominantType,
      alerts, // High pollen alerts
      forecast: dailyInfo.slice(0, days).map(day => ({
        date: day.date,
        types: (day.pollenTypeInfo || []).map(p => ({
          type: p.code,
          name: p.displayName || p.code,
          severity: Number.isInteger(p.indexInfo?.value) && p.indexInfo.value >= 0 && p.indexInfo.value <= 5 ? p.indexInfo.value : null,
          category: p.indexInfo?.category || 'Unknown'
        }))
      })),
      // Summary for drivers
      driverAlert: maxSeverity >= 3
        ? `High ${dominantType || 'pollen'} levels today. Consider keeping windows closed.`
        : maxSeverity >= 2
        ? `Moderate pollen levels. Allergy sufferers may want to take precautions.`
        : null
    };

    matrixLog.info({
      category: 'LOCATION',
      connection: 'API',
      action: 'POLLEN_COMPLETE',
      location: 'location.js:getPollen',
    }, `Pollen fetched (severity ${maxSeverity})`);

    res.json(pollenData);
  } catch (err) {
    console.error('[LOCATION] pollen error', err);
    res.status(500).json({
      available: false,
      error: 'pollen-fetch-failed'
    });
  }
});

// Legacy inputs share the fresh admitted snapshot collector; body labels are not provenance.
router.post('/snapshot', validateBody(snapshotMinimalSchema), portalSnapshotHandler);

// Explicit owned snapshot lineage also applies to the older news entry point.
router.post('/news-briefing', async (req, res) => {
  try {
    const snapshotId = req.body?.snapshotId;
    await assertMainRunForSnapshot(snapshotId, { auth: req.auth, runId: req.body?.runId,
      ...(!req.body?.runId && { allowUpstream: true }) });
    const [snapshot] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
    const { generateAndStoreBriefing } = await import('../../lib/briefing/briefing-aggregator.js');
    const result = await generateAndStoreBriefing({ snapshotId, snapshot });
    if (!result.success || !result.complete) return res.status(502).json({ ok: false, error: 'briefing_incomplete' });
    return res.json(result);
  } catch (error) { return sendSnapshotError(res, error); }
});

// No current client uses IP location. Keep an explicit retirement response for
// older callers; approximate IP coordinates cannot substitute for the GPS fix.
router.get('/ip', (_req, res) => res.status(410).json({
  ok: false, error: 'gps_required', message: 'Use a fresh precise GPS location to continue.',
}));

// 2026-04-25 (P2-7): GET /users/me removed. Documented as `/api/users/me` but
// router is mounted at /api/location, so the documented URL never resolved
// here anyway. Zero callers per audit.

// PATCH /api/location/snapshot/:snapshotId/enrich
// Fetch and persist verified weather/air for the owned snapshot's saved coordinates.
// Auth: requireAuth (global, line 30) + requireSnapshotOwnership (per-route).
// The middleware validates snapshotId presence, snapshot existence, and that
// snapshot.user_id matches req.auth.userId. req.snapshot is populated for
// the handler if downstream needs it.
router.patch('/snapshot/:snapshotId/enrich', requireSnapshotOwnership, async (req, res) => {
  try {
    // Request body is intentionally unused: only the saved snapshot's
    // coordinates can select provider data, and only the server can supply it.
    await assertMainRunForSnapshot(req.snapshot.snapshot_id, { auth: req.auth, runId: req.body?.runId,
      ...(!req.body?.runId && { allowUpstream: true }) });
    const saved = await enrichSnapshot(req.snapshot, req.auth.userId);
    const readiness = getSnapshotReadiness(saved, saved.snapshot_id);
    res.json({ ok: true, enriched: ['weather', 'air'], status: saved.status,
      missingFields: readiness.missingFields, weather: saved.weather, air: saved.air });
  } catch (err) {
    console.error('[LOCATION] snapshot enrich error:', err);
    return sendSnapshotError(res, err);
  }
});

export default router;
