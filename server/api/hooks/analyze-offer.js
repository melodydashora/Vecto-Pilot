// server/api/hooks/analyze-offer.js
// Real-time ride offer analysis endpoint for Siri Shortcuts / Mobile Automation
//
// 2026-02-15: REWRITTEN for speed, location capture, and SSE notification.
// 2026-02-16: Added server-side OCR pre-parser, 6-decimal GPS, clearer decision rules,
//             voice $/mile, merged pre-parsed data into DB save, and VISION MODE.
// 2026-02-17: Migrated to offer_intelligence table — structured columns replace JSONB blob.
//             Added H3 geohashing, daypart classification, session tracking for analytics.
//
// - Uses OFFER_ANALYZER role (Gemini 3 Flash) — 3-5x faster than Pro
// - Pre-parses OCR text server-side (regex) before LLM for reliable numeric extraction
// - LLM focuses on addresses, destination quality, and decision — not math
// - Captures driver location (6-decimal precision) for algorithm learning
// - Broadcasts offer_analyzed via pg NOTIFY for web app SSE updates
// - Voice response includes $/mile in spoken English for Siri TTS
// - VISION MODE: Accepts base64 screenshot — Gemini Flash extracts data directly from image
//
// Flow A (text):   Siri "Vecto Analyze" → OCR → POST here → pre-parse → AI decision → Siri voice
// Flow B (vision): Siri "Vecto Vision" → screenshot → base64 JSON → POST here → AI vision → Siri voice
// Flow C (fast):   Siri "Vecto Vision" → screenshot → multipart upload → POST here → server encodes → AI vision → Siri voice
//                  (2026-02-17: Eliminates base64 encoding on Siri side — server handles it in <1ms)
// Auth: Explicitly public — Siri Shortcuts cannot send JWT tokens

import { Router } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import { db } from '../../db/drizzle.js';
import { sql } from 'drizzle-orm';
import { offer_intelligence } from '../../../shared/schema.js';
import { callModel } from '../../lib/ai/adapters/index.js';
import { parseOfferText, formatPerMileForVoice } from '../../lib/offers/parse-offer-text.js';
// 2026-02-17: Shared utilities for structured analytics columns
import { getDayPartKey } from '../../lib/location/daypart.js';
import { coordsKey } from '../../lib/location/coords-key.js';
import { latLngToCell } from 'h3-js';

const router = Router();

// 2026-02-17: Multer for multipart form-data uploads (Siri sends raw image, no base64)
// Memory storage — no disk writes, image stays in RAM as Buffer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max (matches express.json limit)
});

// POST /api/hooks/analyze-offer
// Accepts THREE input modes:
//   1. JSON with text (OCR):       { text, device_id, latitude, longitude }
//   2. JSON with base64 image:     { image, image_type, device_id, latitude, longitude }
//   3. Multipart form-data:        image file + device_id/latitude/longitude form fields
//      (2026-02-17: Fastest — Siri skips base64 encoding, server handles it in <1ms)
//
// Multipart detection: multer runs first. If no file uploaded, falls through to JSON body.
router.post('/analyze-offer', upload.single('image'), async (req, res) => {
  const startTime = Date.now();

  try {
    // 2026-02-17: Normalize input from either JSON body or multipart form fields
    // Multipart: req.file has the image buffer, req.body has text fields
    // JSON: req.body has everything including base64 image string
    let text, image, image_type, device_id, latitude, longitude, source;

    if (req.file) {
      // MULTIPART PATH — image came as file upload (raw bytes, no base64 from Siri)
      // Server encodes to base64 here — <1ms on server vs ~200ms on iOS
      image = req.file.buffer.toString('base64');
      image_type = req.file.mimetype || 'image/jpeg';
      // Form fields come through req.body even with multer
      text = req.body.text || null;
      device_id = req.body.device_id;
      latitude = req.body.latitude ? parseFloat(req.body.latitude) : undefined;
      longitude = req.body.longitude ? parseFloat(req.body.longitude) : undefined;
      source = req.body.source || 'siri_vision';
      const sizeKB = Math.round(req.file.size / 1024);
      console.log(`[hooks/analyze-offer] 📸 Multipart upload: ${sizeKB}KB ${image_type} (server-encoded base64 in <1ms)`);
    } else {
      // JSON PATH — existing flow (base64 image or OCR text in JSON body)
      ({ text, image, image_type, device_id, latitude, longitude, source = 'siri_shortcut' } = req.body);
    }

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
      // Strip data URL prefix if present (Siri Shortcuts may send "data:image/jpeg;base64,...")
      let imageData = image;
      let mimeType = image_type || 'image/jpeg';
      if (typeof imageData === 'string' && imageData.startsWith('data:')) {
        const match = imageData.match(/^data:([^;]+);base64,(.+)$/s);
        if (match) {
          mimeType = match[1];
          imageData = match[2];
          console.log(`[hooks/analyze-offer] 🖼️ Stripped data URL prefix, detected ${mimeType}`);
        }
      }
      // Remove any whitespace/newlines that break base64 decoding
      imageData = imageData.replace(/\s/g, '');
      images.push({ mimeType, data: imageData });
      console.log(`[hooks/analyze-offer] 🖼️ Vision mode: ${Math.round(imageData.length / 1024)}KB base64 (${mimeType})`);
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
    // 2026-02-16: Prefer server-calculated per_mile (regex, deterministic) over LLM-calculated.
    const perMileValue = preParsed?.per_mile ?? result.parsed_data?.per_mile ?? null;
    const perMileVoice = perMileValue !== null ? formatPerMileForVoice(perMileValue) : '';
    const perMileDisplay = perMileValue !== null ? `$${perMileValue.toFixed(2)}/mi` : '';

    // 2026-02-16: Voice = decision + spoken $/mile for Siri TTS
    const voiceText = perMileVoice
      ? `${result.decision === 'ACCEPT' ? 'Accept' : 'Reject'}. ${perMileVoice}.`
      : (result.decision === 'ACCEPT' ? 'Accept' : 'Reject');

    // 2026-02-16: Notification = scannable line with $/mi, pickup time, total miles
    // Format: "REJECT $0.86/mi · 11min · 10.3mi" — all 3 key numbers at a glance
    const pickupMin = preParsed?.pickup_minutes ?? result.parsed_data?.pickup_minutes ?? null;
    const totalMiles = preParsed?.total_miles ?? result.parsed_data?.miles ?? null;
    const notifParts = [result.decision];
    if (perMileDisplay) notifParts.push(perMileDisplay);
    if (pickupMin !== null) notifParts.push(`${pickupMin}min`);
    if (totalMiles !== null) notifParts.push(`${totalMiles}mi`);
    const notification = notifParts.join(' · ');

    res.json({
      success: true,
      voice: voiceText,
      notification,
      decision: result.decision,
      response_time_ms: responseTimeMs,
    });

    // 5. BACKGROUND — Save to offer_intelligence + broadcast SSE (fire-and-forget after response sent)
    // 2026-02-17: All structured columns populated for SQL analytics — no more JSONB-only storage
    const platform = preParsed?.platform_hint || result.parsed_data?.platform || 'unknown';
    const deviceId = device_id || 'anonymous_device';

    // 2026-02-16: Merge pre-parsed server data with AI-parsed data for complete record.
    const mergedParsedData = {
      ...(preParsed || {}),
      ...result.parsed_data,
      per_mile: preParsed?.per_mile ?? result.parsed_data?.per_mile,
      per_minute: preParsed?.per_minute ?? result.parsed_data?.per_minute,
    };

    (async () => {
      try {
        // 2026-02-17: Compute geographic columns
        const coordKeyValue = (lat && lng) ? coordsKey(lat, lng) : null;
        const h3Index = (lat && lng) ? latLngToCell(lat, lng, 8) : null;

        // 2026-02-17: Compute temporal columns from current time
        // Uses UTC as base — timezone resolved from coords_cache if available
        const now = new Date();
        const localHour = now.getUTCHours(); // Will be refined when timezone is known
        const dayOfWeek = now.getUTCDay();   // 0=Sunday
        const dayPart = getDayPartKey(localHour);
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const localDate = now.toISOString().split('T')[0]; // YYYY-MM-DD UTC

        // 2026-02-17: Session tracking — group offers within 30-min windows
        let offerSessionId = crypto.randomUUID();
        let offerSequenceNum = 1;
        let secondsSinceLast = null;

        try {
          const lastOfferResult = await db.execute(
            sql`SELECT offer_session_id, offer_sequence_num, created_at
                FROM offer_intelligence
                WHERE device_id = ${deviceId}
                ORDER BY created_at DESC LIMIT 1`
          );
          const lastOffer = lastOfferResult.rows?.[0];
          if (lastOffer) {
            secondsSinceLast = Math.round((Date.now() - new Date(lastOffer.created_at).getTime()) / 1000);
            if (secondsSinceLast <= 1800 && lastOffer.offer_session_id) { // 30 min = same session
              offerSessionId = lastOffer.offer_session_id;
              offerSequenceNum = (lastOffer.offer_sequence_num || 0) + 1;
            }
          }
        } catch (seqErr) {
          console.warn(`[hooks/analyze-offer] Session tracking failed (non-fatal): ${seqErr.message}`);
        }

        // 2026-02-17: INSERT into offer_intelligence with all structured columns
        await db.insert(offer_intelligence).values({
          device_id: deviceId,

          // Offer metrics — prefer server pre-parsed (regex) over AI-parsed (LLM math)
          price: preParsed?.price ?? result.parsed_data?.price ?? null,
          per_mile: perMileValue,
          per_minute: preParsed?.per_minute ?? result.parsed_data?.per_minute ?? null,
          hourly_rate: preParsed?.hourly_rate ?? null,
          surge: preParsed?.surge ?? result.parsed_data?.surge ?? null,
          advantage_pct: preParsed?.advantage_pct ?? null,
          pickup_minutes: preParsed?.pickup_minutes ?? result.parsed_data?.pickup_minutes ?? null,
          pickup_miles: preParsed?.pickup_miles ?? null,
          ride_minutes: preParsed?.ride_minutes ?? result.parsed_data?.ride_minutes ?? null,
          ride_miles: preParsed?.ride_miles ?? null,
          total_miles: preParsed?.total_miles ?? result.parsed_data?.miles ?? null,
          total_minutes: preParsed?.total_minutes ?? null,
          product_type: preParsed?.product_type ?? result.parsed_data?.product_type ?? null,
          platform,

          // Addresses (from AI parsing — regex doesn't extract these)
          pickup_address: result.parsed_data?.pickup ?? null,
          dropoff_address: result.parsed_data?.dropoff ?? null,

          // Driver location (6-decimal precision)
          driver_lat: lat,
          driver_lng: lng,
          coord_key: coordKeyValue,
          h3_index: h3Index,
          market,

          // Temporal
          local_date: localDate,
          local_hour: localHour,
          day_of_week: dayOfWeek,
          day_part: dayPart,
          is_weekend: isWeekend,

          // AI analysis
          decision: result.decision,
          decision_reasoning: result.reasoning,
          confidence_score: result.confidence,
          ai_model: 'gemini-3-flash',
          response_time_ms: responseTimeMs,

          // Sequence tracking
          offer_session_id: offerSessionId,
          offer_sequence_num: offerSequenceNum,
          seconds_since_last: secondsSinceLast,

          // Parse quality
          parse_confidence: preParsed?.parse_confidence ?? 'minimal',
          source,
          input_mode: image ? 'vision' : 'text',

          // Raw data preservation
          raw_text: text || `[Vision: ${Math.round((image?.length || 0) / 1024)}KB image]`,
          raw_ai_response: aiResponse.text || null,
          parsed_data_json: mergedParsedData,
        });

        console.log(`[hooks/analyze-offer] ✅ ${result.decision} (${responseTimeMs}ms) — $${mergedParsedData?.price || '?'} / ${mergedParsedData?.total_miles || mergedParsedData?.miles || '?'}mi = $${perMileValue || '?'}/mi [saved to offer_intelligence]`);

        // SSE broadcast for web app
        const notifyPayload = JSON.stringify({
          device_id: deviceId,
          decision: result.decision,
          reasoning: result.reasoning,
          price: result.parsed_data?.price,
          per_mile: perMileValue,
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
// 2026-02-17: Updated to use offer_intelligence with structured columns
router.get('/offer-history', async (req, res) => {
  try {
    const { device_id, limit = 20 } = req.query;

    if (!device_id) {
      return res.status(400).json({ error: 'Missing device_id query parameter' });
    }

    const maxLimit = Math.min(parseInt(limit, 10) || 20, 100);

    const history = await db
      .select({
        id: offer_intelligence.id,
        price: offer_intelligence.price,
        per_mile: offer_intelligence.per_mile,
        total_miles: offer_intelligence.total_miles,
        total_minutes: offer_intelligence.total_minutes,
        pickup_minutes: offer_intelligence.pickup_minutes,
        pickup_miles: offer_intelligence.pickup_miles,
        ride_minutes: offer_intelligence.ride_minutes,
        ride_miles: offer_intelligence.ride_miles,
        pickup_address: offer_intelligence.pickup_address,
        dropoff_address: offer_intelligence.dropoff_address,
        product_type: offer_intelligence.product_type,
        platform: offer_intelligence.platform,
        surge: offer_intelligence.surge,
        decision: offer_intelligence.decision,
        decision_reasoning: offer_intelligence.decision_reasoning,
        confidence_score: offer_intelligence.confidence_score,
        user_override: offer_intelligence.user_override,
        response_time_ms: offer_intelligence.response_time_ms,
        local_date: offer_intelligence.local_date,
        day_part: offer_intelligence.day_part,
        h3_index: offer_intelligence.h3_index,
        offer_session_id: offer_intelligence.offer_session_id,
        offer_sequence_num: offer_intelligence.offer_sequence_num,
        created_at: offer_intelligence.created_at,
      })
      .from(offer_intelligence)
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
      avg_per_mile: history.length > 0
        ? Math.round(history.reduce((sum, h) => sum + (h.per_mile || 0), 0) / history.length * 100) / 100
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
// 2026-02-17: Updated to use offer_intelligence table
router.post('/offer-override', async (req, res) => {
  try {
    const { id, user_override, device_id } = req.body;

    if (!id || !user_override || !['ACCEPT', 'REJECT'].includes(user_override)) {
      return res.status(400).json({ error: 'Missing id or valid user_override (ACCEPT/REJECT)' });
    }

    // 2026-02-15: Only allow the same device to override its own analyses
    const updated = await db.execute(
      sql`UPDATE offer_intelligence
          SET user_override = ${user_override}, updated_at = NOW()
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

// POST /api/hooks/offer-cleanup
// Batch delete test/duplicate entries from offer_intelligence
// 2026-02-17: Updated to use offer_intelligence table
router.post('/offer-cleanup', async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Missing ids array' });
    }

    if (ids.length > 50) {
      return res.status(400).json({ error: 'Max 50 IDs per request' });
    }

    const result = await db.execute(
      sql`DELETE FROM offer_intelligence WHERE id = ANY(${ids}) RETURNING id`
    );

    console.log(`[hooks/offer-cleanup] 🗑️ Deleted ${result.rows?.length || 0} of ${ids.length} requested`);

    res.json({
      success: true,
      deleted: result.rows?.length || 0,
      requested: ids.length,
    });

  } catch (error) {
    console.error('[hooks/offer-cleanup] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
