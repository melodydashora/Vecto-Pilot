// server/api/hooks/analyze-offer.js
// Real-time ride offer analysis endpoint for Siri Shortcuts / Mobile Automation
//
// 2026-02-15: REWRITTEN for speed, location capture, and SSE notification.
// - Uses OFFER_ANALYZER role (Gemini 3 Flash) instead of COACH_CHAT (Pro) — 3-5x faster
// - Captures driver location (3-decimal precision) for algorithm learning
// - Broadcasts offer_analyzed via pg NOTIFY for web app SSE updates
// - Response optimized for Siri "Show Notification" action
//
// Flow: Siri "Vecto Analyze" → OCR → POST here → AI decision → Siri notification
// Auth: Explicitly public — Siri Shortcuts cannot send JWT tokens

import { Router } from 'express';
import { db } from '../../db/drizzle.js';
import { sql } from 'drizzle-orm';
import { intercepted_signals } from '../../../shared/schema.js';
import { callModel } from '../../lib/ai/adapters/index.js';

const router = Router();

// POST /api/hooks/analyze-offer
// Accepts OCR text from Siri Shortcuts with optional GPS location
// Returns ACCEPT/REJECT decision optimized for iOS notification display
router.post('/analyze-offer', async (req, res) => {
  const startTime = Date.now();

  try {
    const {
      text,
      image,
      device_id,
      latitude,
      longitude,
      source = 'siri_shortcut'
    } = req.body;

    if (!text && !image) {
      return res.status(400).json({ error: 'Missing text or image payload' });
    }

    console.log(`[hooks/analyze-offer] 📱 Incoming from ${device_id || 'anonymous'} (${source})`);

    // 2026-02-15: Round coords to 3 decimals (~110m) — driver is moving, exact GPS unnecessary
    const lat = latitude ? Math.round(latitude * 1000) / 1000 : null;
    const lng = longitude ? Math.round(longitude * 1000) / 1000 : null;

    // 2026-02-15: Derive market slug from coordinates (simple lat/lng bucket for now)
    // Future: use reverse geocoding to get actual city, but that adds latency
    const market = (lat && lng) ? `${lat.toFixed(1)}_${lng.toFixed(1)}` : null;

    // 1. Build the system prompt — full analysis for algorithm learning
    const locationContext = (lat && lng)
      ? `Driver location: ${lat}, ${lng} (market: ${market}).`
      : 'Driver location: unknown.';

    const systemPrompt = `You are a rideshare offer analyst. Parse the offer and decide ACCEPT or REJECT.
${locationContext}

Return ONLY valid JSON:
{
  "parsed_data": {
    "price": number,
    "miles": number,
    "time_minutes": number,
    "pickup": "string",
    "dropoff": "string",
    "platform": "uber"|"lyft"|"unknown",
    "surge": number|null,
    "per_mile": number
  },
  "decision": "ACCEPT"|"REJECT",
  "reasoning": "1 sentence max",
  "confidence": 0-100
}

Rules:
- Under $1/mile = REJECT (unless surge or very short)
- Pickup >10 min for ride <$10 = REJECT
- Long dead-end destinations (deep suburbs, no return trips) = REJECT
- Calculate per_mile = price / miles`;

    const userMessage = text
      ? `Offer text: "${text}"`
      : 'Analyze the attached ride offer image.';

    // 2. Call AI — OFFER_ANALYZER uses Flash for speed (~1-3s vs Pro's ~5-10s)
    console.log(`[hooks/analyze-offer] 🧠 Calling OFFER_ANALYZER...`);
    const aiResponse = await callModel('OFFER_ANALYZER', {
      system: systemPrompt,
      user: userMessage,
    });

    if (!aiResponse.success) {
      throw new Error(`AI analysis failed: ${aiResponse.error}`);
    }

    // 3. Parse AI response
    let result;
    try {
      const cleaned = aiResponse.text
        .replace(/```json/g, '').replace(/```/g, '').trim();
      result = JSON.parse(cleaned);
    } catch (_parseErr) {
      console.warn('[hooks/analyze-offer] ⚠️ JSON parse failed, saving raw:', aiResponse.text?.substring(0, 200));
      result = {
        parsed_data: {},
        decision: 'UNKNOWN',
        reasoning: aiResponse.text || 'Failed to parse AI response',
        confidence: 0,
      };
    }

    const responseTimeMs = Date.now() - startTime;

    // 4. RESPOND IMMEDIATELY — driver is waiting, every ms counts
    // 2026-02-15: Send decision the instant AI responds. DB/SSE happen in background.
    const perMile = result.parsed_data?.per_mile
      ? `$${result.parsed_data.per_mile.toFixed(2)}/mi`
      : '';

    res.json({
      success: true,
      voice: result.decision === 'ACCEPT' ? 'Accept' : 'Reject',
      notification: perMile ? `${result.decision} ${perMile}` : result.decision,
      decision: result.decision,
      response_time_ms: responseTimeMs,
    });

    // 5. BACKGROUND — Save to DB + broadcast SSE (fire-and-forget after response sent)
    // Full analysis is preserved for ML/algorithm learning, driver doesn't wait for it
    const platform = result.parsed_data?.platform || 'unknown';
    const deviceId = device_id || 'anonymous_device';

    // 2026-02-16: Use async IIFE — Drizzle requires .execute() or await to run queries.
    // Plain .then() on the query builder doesn't trigger execution.
    (async () => {
      try {
        await db.insert(intercepted_signals).values({
          device_id: deviceId,
          raw_text: text || '[Image Data]',
          parsed_data: result.parsed_data,
          decision: result.decision,
          decision_reasoning: result.reasoning,
          confidence_score: result.confidence,
          latitude: lat,
          longitude: lng,
          market,
          platform,
          response_time_ms: responseTimeMs,
          source,
        });
        console.log(`[hooks/analyze-offer] ✅ ${result.decision} (${responseTimeMs}ms) — $${result.parsed_data?.price || '?'} / ${result.parsed_data?.miles || '?'}mi [saved]`);
        // SSE broadcast for web app
        const notifyPayload = JSON.stringify({
          device_id: deviceId,
          decision: result.decision,
          reasoning: result.reasoning,
          price: result.parsed_data?.price,
          platform,
          response_time_ms: responseTimeMs,
        });
        await db.execute(sql`SELECT pg_notify('offer_analyzed', ${notifyPayload})`);
      } catch (err) {
        console.error(`[hooks/analyze-offer] ⚠️ Background save failed: ${err.message}`);
      }
    })();

  } catch (error) {
    const responseTimeMs = Date.now() - startTime;
    console.error(`[hooks/analyze-offer] ❌ Error (${responseTimeMs}ms):`, error.message);
    res.status(500).json({
      success: false,
      notification: 'Analysis failed — decide manually',
      error: error.message,
      response_time_ms: responseTimeMs,
    });
  }
});

// GET /api/hooks/offer-history
// Returns recent offer analyses for a device — no auth required (device_id based)
// Used by the web app to show past analyses when driver returns
router.get('/offer-history', async (req, res) => {
  try {
    const { device_id, limit = 20 } = req.query;

    if (!device_id) {
      return res.status(400).json({ error: 'Missing device_id query parameter' });
    }

    const maxLimit = Math.min(parseInt(limit, 10) || 20, 100);

    const history = await db
      .select()
      .from(intercepted_signals)
      .where(sql`device_id = ${device_id}`)
      .orderBy(sql`created_at DESC`)
      .limit(maxLimit);

    // 2026-02-15: Compute aggregate stats for algorithm learning
    const stats = {
      total: history.length,
      accepted: history.filter(h => h.decision === 'ACCEPT').length,
      rejected: history.filter(h => h.decision === 'REJECT').length,
      avg_response_ms: history.length > 0
        ? Math.round(history.reduce((sum, h) => sum + (h.response_time_ms || 0), 0) / history.length)
        : 0,
      avg_confidence: history.length > 0
        ? Math.round(history.reduce((sum, h) => sum + (h.confidence_score || 0), 0) / history.length)
        : 0,
    };

    res.json({
      success: true,
      device_id,
      stats,
      offers: history,
    });

  } catch (error) {
    console.error('[hooks/offer-history] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/hooks/offer-override
// Driver disagreed with AI decision — record the override for training data
router.post('/offer-override', async (req, res) => {
  try {
    const { id, user_override, device_id } = req.body;

    if (!id || !user_override || !['ACCEPT', 'REJECT'].includes(user_override)) {
      return res.status(400).json({ error: 'Missing id or valid user_override (ACCEPT/REJECT)' });
    }

    // 2026-02-15: Only allow the same device to override its own analyses
    const updated = await db.execute(
      sql`UPDATE intercepted_signals
          SET user_override = ${user_override}
          WHERE id = ${id} AND device_id = ${device_id}
          RETURNING id, decision, user_override`
    );

    if (updated.rows?.length === 0) {
      return res.status(404).json({ error: 'Offer not found or device mismatch' });
    }

    const record = updated.rows[0];
    console.log(`[hooks/offer-override] 🔄 Override: AI said ${record.decision}, driver says ${user_override}`);

    res.json({
      success: true,
      original_decision: record.decision,
      user_override: record.user_override,
    });

  } catch (error) {
    console.error('[hooks/offer-override] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
