// server/api/concierge/concierge.js
// 2026-02-13: Concierge API routes — QR code sharing + public event discovery
// 2026-02-13: DB-first architecture — returns {venues, events} (not {items})
//
// Authenticated endpoints: Token management, driver preview
// Public endpoints: Profile lookup, weather, event search (rate-limited)

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../../middleware/auth.js';
import {
  generateShareToken,
  getShareToken,
  getDriverPublicProfile,
  getDriverPreview,
  searchNearby,
  askConcierge,
  submitFeedback,
  getFeedbackSummary,
} from '../../lib/concierge/concierge-service.js';

const router = Router();

// ============================================================================
// RATE LIMITERS (for public endpoints — no auth means we must limit aggressively)
// ============================================================================

const publicProfileLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { ok: false, error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
});

const weatherLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { ok: false, error: 'Weather request limit exceeded. Please wait.' },
  standardHeaders: true,
});

const exploreLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { ok: false, error: 'Search limit exceeded. Please wait before searching again.' },
  standardHeaders: true,
});

// ============================================================================
// AUTHENTICATED ENDPOINTS (driver manages their concierge)
// ============================================================================

/**
 * GET /api/concierge/token
 * Get the driver's current share token
 */
router.get('/token', requireAuth, async (req, res) => {
  try {
    // 2026-02-13: Auth middleware sets req.auth, not req.user
    const { token, profileId } = await getShareToken(req.auth.userId);
    res.json({ ok: true, token, profileId });
  } catch (err) {
    console.error('[concierge] Get token error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to get share token' });
  }
});

/**
 * POST /api/concierge/token
 * Generate or regenerate the driver's share token
 */
router.post('/token', requireAuth, async (req, res) => {
  try {
    const { profileId } = await getShareToken(req.auth.userId);
    const token = await generateShareToken(profileId);
    res.json({ ok: true, token });
  } catch (err) {
    console.error('[concierge] Generate token error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to generate share token' });
  }
});

/**
 * GET /api/concierge/preview
 * Get the driver's own card data (for preview on concierge tab)
 */
router.get('/preview', requireAuth, async (req, res) => {
  try {
    const preview = await getDriverPreview(req.auth.userId);
    res.json({ ok: true, ...preview });
  } catch (err) {
    console.error('[concierge] Preview error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load preview' });
  }
});

// ============================================================================
// PUBLIC ENDPOINTS (passenger scans QR code — no auth required)
// ============================================================================

/**
 * GET /api/concierge/p/:token
 * Get driver's public profile by share token
 */
router.get('/p/:token', publicProfileLimiter, async (req, res) => {
  try {
    const { token } = req.params;

    if (!token || token.length > 12) {
      return res.status(400).json({ ok: false, error: 'Invalid token' });
    }

    const profile = await getDriverPublicProfile(token);
    if (!profile) {
      return res.status(404).json({ ok: false, error: 'Driver not found' });
    }

    res.json({ ok: true, driver: profile });
  } catch (err) {
    console.error('[concierge] Public profile error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load profile' });
  }
});

/**
 * GET /api/concierge/p/:token/weather?lat=&lng=
 * Get weather + AQI for coordinates (proxied to Google Weather API)
 */
router.get('/p/:token/weather', weatherLimiter, async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);

    if (!isFinite(lat) || !isFinite(lng)) {
      return res.status(400).json({ error: 'lat/lng required' });
    }

    const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    if (!GOOGLE_MAPS_API_KEY) {
      return res.json({ available: false, error: 'API key not configured' });
    }

    // Fetch current weather from Google Weather API
    const weatherRes = await fetch(
      `https://weather.googleapis.com/v1/currentConditions:lookup?location.latitude=${lat}&location.longitude=${lng}&key=${GOOGLE_MAPS_API_KEY}`,
      { headers: { 'X-Goog-Api-Client': 'gl-node/' } }
    );

    let weather = null;
    if (weatherRes.ok) {
      const data = await weatherRes.json();
      const tempC = data.temperature?.degrees ?? data.temperature;
      const tempF = tempC ? Math.round((tempC * 9 / 5) + 32) : null;
      weather = {
        available: true,
        temperature: tempF,
        tempF,
        conditions: data.weatherCondition?.description?.text || 'Unknown',
        humidity: data.relativeHumidity?.value ?? data.relativeHumidity,
      };
    }

    // Fetch air quality
    const GOOGLEAQ_API_KEY = process.env.GOOGLEAQ_API_KEY;
    let airQuality = null;
    if (GOOGLEAQ_API_KEY) {
      try {
        const aqRes = await fetch(
          `https://airquality.googleapis.com/v1/currentConditions:lookup?key=${GOOGLEAQ_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ location: { latitude: lat, longitude: lng } }),
          }
        );
        if (aqRes.ok) {
          const aqData = await aqRes.json();
          const usIndex = aqData.indexes?.find(i => i.code === 'uaqi' || i.code === 'us_aqi');
          if (usIndex) {
            airQuality = {
              aqi: usIndex.aqi,
              category: usIndex.category,
            };
          }
        }
      } catch {
        // AQI is optional — don't fail the whole request
      }
    }

    res.json({ weather, airQuality });
  } catch (err) {
    console.error('[concierge] Weather error:', err.message);
    res.status(500).json({ error: 'weather-fetch-failed' });
  }
});

/**
 * POST /api/concierge/p/:token/explore
 * DB-first event/venue search near coordinates, Gemini fallback for uncatalogued areas
 * Body: { lat, lng, filter, timezone }
 * Returns: { ok, venues: [...], events: [...], filter, source: 'db'|'gemini'|'db+gemini' }
 */
router.post('/p/:token/explore', exploreLimiter, async (req, res) => {
  try {
    const { lat, lng, filter, timezone } = req.body;

    if (!isFinite(Number(lat)) || !isFinite(Number(lng))) {
      return res.status(400).json({ ok: false, error: 'Valid lat/lng required' });
    }

    const result = await searchNearby({
      lat: Number(lat),
      lng: Number(lng),
      filter: filter || 'all',
      timezone: timezone || 'UTC',
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[concierge] Explore error:', err.message);
    res.status(500).json({ ok: false, error: 'Search failed. Please try again.' });
  }
});

// ============================================================================
// PUBLIC AI Q&A — Passenger asks questions about the local area
// ============================================================================

const askLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  message: { ok: false, error: 'Question limit exceeded. Please wait before asking again.' },
  standardHeaders: true,
});

/**
 * POST /api/concierge/p/:token/ask
 * 2026-02-13: Public AI Q&A — passenger asks about local area, Gemini answers
 * Body: { question, lat, lng, timezone, venueContext?, eventContext? }
 * Returns: { ok, answer }
 */
router.post('/p/:token/ask', askLimiter, async (req, res) => {
  try {
    const { question, lat, lng, timezone, venueContext, eventContext } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ ok: false, error: 'Question is required' });
    }

    if (!isFinite(Number(lat)) || !isFinite(Number(lng))) {
      return res.status(400).json({ ok: false, error: 'Valid lat/lng required' });
    }

    const result = await askConcierge({
      question,
      lat: Number(lat),
      lng: Number(lng),
      timezone: timezone || 'UTC',
      venueContext: venueContext || '',
      eventContext: eventContext || '',
    });

    res.json(result);
  } catch (err) {
    console.error('[concierge] Ask error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to process question. Please try again.' });
  }
});

// ============================================================================
// PUBLIC FEEDBACK — Passenger rates their driver
// ============================================================================

const feedbackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 2,
  message: { ok: false, error: 'Feedback already submitted. Please wait.' },
  standardHeaders: true,
});

/**
 * POST /api/concierge/p/:token/feedback
 * 2026-02-13: Passenger submits star rating + optional comment for their driver
 * Body: { rating: 1-5, comment?: string }
 * Returns: { ok }
 */
router.post('/p/:token/feedback', feedbackLimiter, async (req, res) => {
  try {
    const { token } = req.params;
    const { rating, comment } = req.body;

    if (!rating || !Number.isInteger(Number(rating)) || Number(rating) < 1 || Number(rating) > 5) {
      return res.status(400).json({ ok: false, error: 'Rating must be 1-5' });
    }

    const result = await submitFeedback({
      token,
      rating: Number(rating),
      comment: comment || null,
    });

    if (!result.ok) {
      return res.status(400).json(result);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[concierge] Feedback error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to submit feedback' });
  }
});

// ============================================================================
// AUTHENTICATED FEEDBACK SUMMARY — Driver views their passenger ratings
// ============================================================================

/**
 * GET /api/concierge/feedback
 * 2026-02-13: Driver views aggregate rating + recent comments from passengers
 */
router.get('/feedback', requireAuth, async (req, res) => {
  try {
    const summary = await getFeedbackSummary(req.auth.userId);
    res.json(summary);
  } catch (err) {
    console.error('[concierge] Feedback summary error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load feedback' });
  }
});

export default router;
