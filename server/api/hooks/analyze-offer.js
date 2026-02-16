// server/api/hooks/analyze-offer.js
// Real-time ride offer analysis endpoint for Siri Shortcuts / Mobile Automation
//
// 2026-02-15: REWRITTEN for speed, location capture, and SSE notification.
// 2026-02-16: Added server-side OCR pre-parser, 6-decimal GPS, clearer decision rules,
//             voice $/mile, merged pre-parsed data into DB save, and VISION MODE.
//
// - Uses OFFER_ANALYZER role (Gemini 3 Flash) — 3-5x faster than Pro
// - Pre-parses OCR text server-side (regex) before LLM for reliable numeric extraction
// - LLM focuses on addresses, destination quality, and decision — not math
// - Captures driver location (6-decimal precision) for algorithm learning
// - Broadcasts offer_analyzed via pg NOTIFY for web app SSE updates
// - Voice response includes $/mile in spoken English for Siri TTS
// - VISION MODE: Accepts base64 screenshot — Gemini Flash extracts data directly from image
//
// Flow A (text): Siri "Vecto Analyze" → OCR → POST here → pre-parse → AI decision → Siri voice
// Flow B (vision): Siri "Vecto Vision" → screenshot → base64 → POST here → AI vision → Siri voice
// Auth: Explicitly public — Siri Shortcuts cannot send JWT tokens

import { Router } from 'express';
import { db } from '../../db/drizzle.js';
import { sql } from 'drizzle-orm';
import { intercepted_signals } from '../../../shared/schema.js';
import { callModel } from '../../lib/ai/adapters/index.js';
import { parseOfferText, formatPerMileForVoice } from '../../lib/offers/parse-offer-text.js';

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
      image_type,
      device_id,
      latitude,
      longitude,
      source = 'siri_shortcut'
    } = req.body;

    if (!text && !image) {
      return res.status(400).json({ error: 'Missing text or image payload' });
    }

    console.log(`[hooks/analyze-offer] 📱 Incoming from ${device_id || 'anonymous'} (${source})`);

    // 2026-02-16: Use 6-decimal precision (~11cm) per codebase standard (coords-key.js)
    // Previous 3-decimal (~110m) was too imprecise for algorithm learning
    const lat = latitude ? Math.round(latitude * 1000000) / 1000000 : null;
    const lng = longitude ? Math.round(longitude * 1000000) / 1000000 : null;

    // Market slug uses coarse 1-decimal buckets for geographic clustering
    const market = (lat && lng) ? `${lat.toFixed(1)}_${lng.toFixed(1)}` : null;

    // 1. PRE-PARSE OCR text server-side — regex extraction of price, miles, times
    // 2026-02-16: Deterministic, <1ms, more reliable than LLM math.
    // LLM still gets raw text for addresses, platform, and destination quality analysis.
    const preParsed = text ? parseOfferText(text) : null;
    if (preParsed) {
      console.log(`[hooks/analyze-offer] 📊 Pre-parsed: $${preParsed.price || '?'} / ${preParsed.total_miles || '?'}mi = $${preParsed.per_mile || '?'}/mi (${preParsed.parse_confidence})`);
    }

    // 2. Build the system prompt with pre-parsed data injected
    const locationContext = (lat && lng)
      ? `Driver location: ${lat}, ${lng} (market: ${market}).`
      : 'Driver location: unknown.';

    // 2026-02-16: Inject pre-parsed numeric data so LLM focuses on decision, not parsing
    const preParseBlock = preParsed && preParsed.parse_confidence !== 'minimal' ? `
PRE-PARSED DATA (server-verified, trust these numbers):
  Price: ${preParsed.price !== null ? `$${preParsed.price.toFixed(2)}` : 'NOT DETECTED'}
  Pickup: ${preParsed.pickup_minutes !== null ? `${preParsed.pickup_minutes} min, ${preParsed.pickup_miles} mi` : 'NOT DETECTED'}
  Ride: ${preParsed.ride_minutes !== null ? `${preParsed.ride_minutes} min, ${preParsed.ride_miles} mi` : 'NOT DETECTED'}
  Total: ${preParsed.total_miles !== null ? `${preParsed.total_miles.toFixed(1)} mi, ${preParsed.total_minutes} min` : 'NOT DETECTED'}
  $/mile: ${preParsed.per_mile !== null ? `$${preParsed.per_mile.toFixed(2)}` : 'CALCULATE FROM RAW TEXT'}
  Product: ${preParsed.product_type || 'DETECT FROM RAW TEXT'}
  Surge: ${preParsed.surge !== null ? `$${preParsed.surge}` : 'none detected'}
` : '';

    // 2026-02-16: Vision mode — tell the model it's reading a screenshot, not OCR text
    const visionBlock = (!text && image) ? `
NOTE: You are analyzing a SCREENSHOT of a ride offer, not OCR text.
Extract ALL data directly from the image: price, pickup time/distance, ride time/distance,
pickup address, dropoff address, platform (Uber/Lyft), and any surge/bonus.
Calculate $/mile = price / (pickup_miles + ride_miles).
` : '';

    const systemPrompt = `You are a rideshare offer analyst. Decide ACCEPT or REJECT.
${locationContext}
${preParseBlock}${visionBlock}
Return ONLY valid JSON:
{
  "parsed_data": {
    "price": number,
    "miles": number,
    "pickup_minutes": number,
    "ride_minutes": number,
    "pickup": "street/intersection",
    "dropoff": "street/intersection",
    "platform": "uber"|"lyft"|"unknown",
    "surge": number|null,
    "per_mile": number
  },
  "decision": "ACCEPT"|"REJECT",
  "reasoning": "1 sentence max",
  "confidence": 0-100
}

DECISION RULES (follow EXACTLY):
1. Above $1.00/mi with pickup under 10 min → ACCEPT (regardless of total payout)
2. $0.90-$1.00/mi for rides under 3 total miles → ACCEPT (short hop exception)
3. Below $0.90/mi → REJECT (unless surge multiplier detected)
4. Pickup over 10 min for ride under $10 → REJECT
5. Dead-end destination (deep suburb, rural, no return trips) → REJECT even if $/mi is good

CRITICAL: Do NOT reject offers above $1.00/mi because "total payout is too low".
The ONLY valid reasons to reject above-$1.00/mi: Rule 4 (long pickup) or Rule 5 (bad destination).
Short rides with good $/mi keep the driver in high-demand areas — that is a GOOD thing.

If pre-parsed data is provided, use those numbers. Only re-parse from raw text if marked "NOT DETECTED".
Focus your analysis on: pickup/dropoff ADDRESSES and DESTINATION QUALITY.`;

    const userMessage = text
      ? `Offer text: "${text}"`
      : 'Analyze the attached ride offer image.';

    // 2. Call AI — OFFER_ANALYZER uses Flash for speed (~1-3s vs Pro's ~5-10s)
    // 2026-02-16: Build images array for vision path (Siri Vision shortcut sends base64 screenshot)
    const images = [];
    if (image && !text) {
      const mimeType = image_type || 'image/jpeg';
      images.push({ mimeType, data: image });
      console.log(`[hooks/analyze-offer] 🖼️ Vision mode: ${Math.round(image.length / 1024)}KB base64 (${mimeType})`);
    }

    console.log(`[hooks/analyze-offer] 🧠 Calling OFFER_ANALYZER${images.length ? ' (vision)' : ''}...`);
    const aiResponse = await callModel('OFFER_ANALYZER', {
      system: systemPrompt,
      user: userMessage,
      images,
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
    // 2026-02-16: Voice includes $/mile in spoken English for immediate driver context.
    // Prefer server-calculated per_mile (regex, deterministic) over LLM-calculated.
    const perMileValue = preParsed?.per_mile ?? result.parsed_data?.per_mile ?? null;
    const perMileVoice = perMileValue !== null ? formatPerMileForVoice(perMileValue) : '';
    const perMileDisplay = perMileValue !== null ? `$${perMileValue.toFixed(2)}/mi` : '';

    const voiceText = perMileVoice
      ? `${result.decision === 'ACCEPT' ? 'Accept' : 'Reject'}. ${perMileVoice}.`
      : (result.decision === 'ACCEPT' ? 'Accept' : 'Reject');

    res.json({
      success: true,
      voice: voiceText,
      notification: perMileDisplay ? `${result.decision} ${perMileDisplay}` : result.decision,
      decision: result.decision,
      response_time_ms: responseTimeMs,
    });

    // 5. BACKGROUND — Save to DB + broadcast SSE (fire-and-forget after response sent)
    // Full analysis is preserved for ML/algorithm learning, driver doesn't wait for it
    const platform = preParsed?.platform_hint || result.parsed_data?.platform || 'unknown';
    const deviceId = device_id || 'anonymous_device';

    // 2026-02-16: Merge pre-parsed server data with AI-parsed data for complete record.
    // Server-side numeric values (regex) are more reliable than LLM math.
    const mergedParsedData = {
      ...(preParsed || {}),
      ...result.parsed_data,
      per_mile: preParsed?.per_mile ?? result.parsed_data?.per_mile,
      per_minute: preParsed?.per_minute ?? result.parsed_data?.per_minute,
    };

    // 2026-02-16: Use async IIFE — Drizzle requires .execute() or await to run queries.
    // Plain .then() on the query builder doesn't trigger execution.
    (async () => {
      try {
        await db.insert(intercepted_signals).values({
          device_id: deviceId,
          raw_text: text || `[Vision: ${Math.round((image?.length || 0) / 1024)}KB image]`,
          parsed_data: mergedParsedData,
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
        console.log(`[hooks/analyze-offer] ✅ ${result.decision} (${responseTimeMs}ms) — $${mergedParsedData?.price || '?'} / ${mergedParsedData?.total_miles || mergedParsedData?.miles || '?'}mi = $${perMileValue || '?'}/mi [saved]`);
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
