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
import { createSnapshotEnvironment } from '../../lib/location/snapshot-environment.js';
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
const timezoneRequests = new Map();
const TIMEZONE_CACHE_MS = 15 * 60_000;
// The parsing/transport is shared; public failures do not trip MAIN's breakers.
const conciergeEnvironment = createSnapshotEnvironment();
function requestScope(req, res) {
  const controller = new AbortController();
  const disconnected = () => { if (!res.writableEnded) controller.abort(); };
  req.once('aborted', disconnected);
  res.once('close', disconnected);
  if (req.aborted || res.destroyed) controller.abort();
  const deadline = setTimeout(() => controller.abort(), 90_000);
  return { controller, dispose() {
    clearTimeout(deadline);
    req.off('aborted', disconnected); res.off('close', disconnected);
  } };
}
async function resolveContext(req, res, next) {
  let coords;
  try {
    const input = req.method === 'GET' ? req.query : req.body;
    coords = parseConciergeCoordinates(input?.lat, input?.lng);
  } catch {
    return res.status(400).json({ ok: false, error: 'Valid GPS coordinates are required' });
  }
  try {
    const key = JSON.stringify([coords.lat, coords.lng]);
    const cached = timezoneCache.get(key);
    let timezone = cached && Date.now() - cached.resolvedAt < TIMEZONE_CACHE_MS ? cached.timezone : null;
    if (!timezone) {
      let pending = timezoneRequests.get(key);
      if (!pending) {
        pending = getTimezoneForCoords(coords.lat, coords.lng, { signal: AbortSignal.timeout(8000) });
        timezoneRequests.set(key, pending);
      }
      try { timezone = await pending; }
      finally { if (timezoneRequests.get(key) === pending) timezoneRequests.delete(key); }
      if (!timezone) throw new Error('Timezone unavailable');
      new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
      if (timezoneCache.size >= 200) timezoneCache.delete(timezoneCache.keys().next().value);
      timezoneCache.set(key, { timezone, resolvedAt: Date.now() });
    }
    // Shared timezone work may outlive this guest. Do not start a downstream
    // provider request after the HTTP response has already been abandoned.
    if (req.aborted || res.destroyed) return;
    req.conciergeContext = { ...coords, timezone };
    next();
  } catch {
    if (!req.aborted && !res.destroyed) res.status(502).json({ ok: false, error: 'Could not resolve your local timezone. Try location again.' });
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

    const scope = 'concierge:' + req.params.token;
    const [weather, air] = await Promise.allSettled([
      conciergeEnvironment.weather(lat, lng, { scope }), conciergeEnvironment.air(lat, lng, { scope }),
    ]);
    const errors = {};
    if (weather.status === 'rejected') errors.weather = 'Current weather is unavailable';
    if (air.status === 'rejected') errors.airQuality = 'Current air quality is unavailable';
    res.json({ available: weather.status === 'fulfilled' || air.status === 'fulfilled',
      weather: weather.status === 'fulfilled' ? weather.value : null,
      airQuality: air.status === 'fulfilled' ? air.value : null, errors });
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
  const scope = requestScope(req, res);
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
      signal: scope.controller.signal,
    });

    scope.controller.signal.throwIfAborted();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[CONCIERGE] Explore error:', err.message);
    if (!res.destroyed && !res.writableEnded) res.status(500).json({ ok: false, error: 'Search failed. Please try again.' });
  } finally { scope.dispose(); }
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
  const scope = requestScope(req, res);
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
      signal: scope.controller.signal,
    });

    scope.controller.signal.throwIfAborted();
    res.json(result);
  } catch (err) {
    console.error('[CONCIERGE] Ask error:', err.message);
    if (!res.destroyed && !res.writableEnded) res.status(500).json({ ok: false, error: 'Failed to process question. Please try again.' });
  } finally { scope.dispose(); }
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

  const { controller, dispose } = requestScope(req, res);
  let reader;
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
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      console.error(`[CONCIERGE] Stream API error: ${response.status}`);
      res.write(`data: ${JSON.stringify({ error: 'AI service unavailable' })}\n\n`);
      return res.end();
    }

    controller.signal.throwIfAborted();
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let totalText = '';
    const consume = line => {
      if (!line.startsWith('data:')) return;
      const json = line.slice(5).trim();
      if (!json || json === '[DONE]') return;
      let data;
      try { data = JSON.parse(json); } catch { throw new Error('Malformed upstream stream'); }
      if (data.error) throw new Error('Concierge provider stream failed');
      const text = (data.candidates?.[0]?.content?.parts || []).filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('');
      if (text) { totalText += text; res.write(`data: ${JSON.stringify({ delta: text })}\n\n`); }
    };
    while (true) {
      const { done, value } = await reader.read();
      controller.signal.throwIfAborted();
      if (done) { buffer += decoder.decode(); if (buffer.trim()) consume(buffer); break; }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const line of lines) consume(line);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[CONCIERGE] Stream complete in ${elapsed}ms (${totalText.length} chars)`);

    if (!totalText.trim()) throw new Error('Concierge returned no answer');

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[CONCIERGE] Stream error:', err.message);
    if (!res.destroyed && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: 'The answer could not be completed. Please try again.' })}\n\n`);
      res.end();
    }
  } finally {
    dispose();
    if (reader) await reader.cancel().catch(() => {});
  }
});

export default router;
