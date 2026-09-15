// server/api/concierge/concierge.js
// 2026-02-13: Concierge API routes — QR code sharing + public event discovery
// 2026-02-13: DB-first architecture — returns {venues, events} (not {items})
//
// Public anonymous bookmarks, weather, and local assistance (rate-limited).
// Driver profile, identity, and feedback endpoints are retired.

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createAnonymousToken, validateAnonymousToken, parseConciergeCoordinates } from '../../lib/concierge/anonymous-token.js';
import { getTimezoneForCoords } from '../../lib/location/geocode.js';
import { coordsKey } from '../../lib/location/coords-key.js';
import {
  searchNearby,
  askConcierge,
  buildConciergeSystemPrompt,
} from '../../lib/concierge/concierge-service.js';

const router = Router();

// All public calls validate an anonymous bookmark. No driver profile is read.
async function validateShareToken(req, res, next) {
  try {
    if (!validateAnonymousToken(req.params.token)) {
      return res.status(404).json({ ok: false, error: 'Bookmark unavailable. Open /c to start a new anonymous concierge.' });
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
  } catch {
    res.status(503).json({ ok: false, error: 'Concierge is temporarily unavailable' });
  }
}

const timezoneCache = new Map();
async function resolveContext(req, res, next) {
  try {
    const input = req.method === 'GET' ? req.query : req.body;
    const coords = parseConciergeCoordinates(input?.lat, input?.lng);
    const key = coordsKey(coords.lat, coords.lng);
    let timezone = timezoneCache.get(key);
    if (!timezone) {
      timezone = await getTimezoneForCoords(coords.lat, coords.lng, { signal: AbortSignal.timeout(8000) });
      if (!timezone) return res.status(502).json({ ok: false, error: 'Could not resolve your local timezone. Try location again.' });
      new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
      if (timezoneCache.size >= 200) timezoneCache.delete(timezoneCache.keys().next().value);
      timezoneCache.set(key, timezone);
    }
    req.conciergeContext = { ...coords, timezone };
    next();
  } catch {
    res.status(400).json({ ok: false, error: 'Valid GPS coordinates and local timezone are required' });
  }
}

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

// Legacy driver-sharing and feedback APIs are retired without changing stored rows.
router.all(['/token', '/preview', '/feedback', '/p/:token/feedback'], (_req, res) => {
  res.status(410).json({ ok: false, error: 'Driver sharing is retired. Open /c for the anonymous concierge.' });
});

router.post('/session', publicProfileLimiter, (_req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, token: createAnonymousToken() });
  } catch {
    res.status(503).json({ ok: false, error: 'Concierge is temporarily unavailable' });
  }
});

router.get('/p/:token', publicProfileLimiter, validateShareToken, (_req, res) => {
  res.json({ ok: true, anonymous: true });
});

router.get('/p/:token/context', weatherLimiter, validateShareToken, resolveContext, (req, res) => {
  res.json({ ok: true, ...req.conciergeContext });
});

/**
 * GET /api/concierge/p/:token/weather?lat=&lng=
 * Get weather + AQI for coordinates (proxied to Google Weather API)
 */
router.get('/p/:token/weather', weatherLimiter, validateShareToken, resolveContext, async (req, res) => {
  try {
    const { lat, lng } = req.conciergeContext;

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
      const tempF = tempC != null ? Math.round((tempC * 9 / 5) + 32) : null;
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
    console.error('[CONCIERGE] Weather error:', err.message);
    res.status(500).json({ error: 'weather-fetch-failed' });
  }
});

/**
 * POST /api/concierge/p/:token/explore
 * DB-first event/venue search near coordinates, Gemini fallback for uncatalogued areas
 * Body: { lat, lng, filter, timezone }
 * Returns: { ok, venues: [...], events: [...], filter, source: 'db'|'gemini'|'db+gemini' }
 */
router.post('/p/:token/explore', exploreLimiter, validateShareToken, resolveContext, async (req, res) => {
  try {
    const { filter } = req.body;
    const { lat, lng, timezone } = req.conciergeContext;

    if (!isFinite(Number(lat)) || !isFinite(Number(lng))) {
      return res.status(400).json({ ok: false, error: 'Valid lat/lng required' });
    }

    const result = await searchNearby({
      lat: Number(lat),
      lng: Number(lng),
      filter: filter || 'all',
      timezone,
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[CONCIERGE] Explore error:', err.message);
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
router.post('/p/:token/ask', askLimiter, validateShareToken, resolveContext, async (req, res) => {
  try {
    const { question, venueContext, eventContext } = req.body;
    const { lat, lng, timezone } = req.conciergeContext;

    if (typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ ok: false, error: 'Question is required' });
    }

    if (!isFinite(Number(lat)) || !isFinite(Number(lng))) {
      return res.status(400).json({ ok: false, error: 'Valid lat/lng required' });
    }

    // Bound untrusted client context. It is contextual data, never an instruction.
    const safeVenue = typeof venueContext === 'string' ? venueContext.slice(0, 2000).replace(/\n{3,}/g, '\n\n') : '';
    const safeEvent = typeof eventContext === 'string' ? eventContext.slice(0, 2000).replace(/\n{3,}/g, '\n\n') : '';

    const result = await askConcierge({
      question,
      lat: Number(lat),
      lng: Number(lng),
      timezone,
      venueContext: safeVenue,
      eventContext: safeEvent,
    });

    res.json(result);
  } catch (err) {
    console.error('[CONCIERGE] Ask error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to process question. Please try again.' });
  }
});

// ============================================================================
// PUBLIC ASK (STREAMING) — SSE streaming version of concierge chat
// 2026-04-02: Added streaming so passengers see tokens appear in real time
// ============================================================================

/**
 * POST /api/concierge/p/:token/ask-stream
 * Body: { question, lat, lng, timezone, venueContext?, eventContext? }
 * Returns: SSE stream with { delta } chunks, then { done: true }
 */
router.post('/p/:token/ask-stream', askLimiter, validateShareToken, resolveContext, async (req, res) => {
  const { question, venueContext, eventContext } = req.body;
  const { lat, lng, timezone } = req.conciergeContext;

  if (typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ ok: false, error: 'Question is required' });
  }
  if (!isFinite(Number(lat)) || !isFinite(Number(lng))) {
    return res.status(400).json({ ok: false, error: 'Valid lat/lng required' });
  }

  const safeQuestion = question.trim().slice(0, 500);
  const latNum = Number(lat);
  const lngNum = Number(lng);

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');

  try {
    console.log('[CONCIERGE] Streaming local assistance with verified location context');
    const startTime = Date.now();

    // 2026-04-10: SECURITY FIX (H-2) — Sanitize client-supplied context in streaming endpoint too
    const safeVenue = typeof venueContext === 'string' ? venueContext.slice(0, 2000).replace(/\n{3,}/g, '\n\n') : '';
    const safeEvent = typeof eventContext === 'string' ? eventContext.slice(0, 2000).replace(/\n{3,}/g, '\n\n') : '';

    const system = buildConciergeSystemPrompt({
      lat: latNum, lng: lngNum,
      timezone,
      venueContext: safeVenue,
      eventContext: safeEvent,
    });

    const { callModelStream } = await import('../../lib/ai/adapters/index.js');

    const response = await callModelStream('CONCIERGE_CHAT', {
      system,
      messageHistory: [{ role: 'user', parts: [{ text: safeQuestion }] }],
    });

    if (!response.ok) {
      console.error(`[CONCIERGE] Stream API error: ${response.status}`);
      res.write(`data: ${JSON.stringify({ error: 'AI service unavailable' })}\n\n`);
      return res.end();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let totalText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;

          try {
            const data = JSON.parse(jsonStr);
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              totalText += text;
              res.write(`data: ${JSON.stringify({ delta: text })}\n\n`);
            }
          } catch {
            // Skip unparseable chunks
          }
        }
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[CONCIERGE] Stream complete in ${elapsed}ms (${totalText.length} chars)`);

    if (!totalText) {
      res.write(`data: ${JSON.stringify({ delta: 'I had trouble generating a response. Try again?' })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[CONCIERGE] Stream error:', err.message);
    res.write(`data: ${JSON.stringify({ error: 'Something went wrong. Please try again.' })}\n\n`);
    res.end();
  }
});

export default router;
