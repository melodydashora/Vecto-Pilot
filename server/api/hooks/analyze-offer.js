// server/api/hooks/analyze-offer.js
// Real-time ride offer analysis endpoint for Siri Shortcuts / Mobile Automation
//
// 2026-02-28: TWO-PHASE ARCHITECTURE
//   Phase 1 (Sync):  Gemini Flash with ultra-lean prompt → instant Siri response (<2s target)
//   Phase 2 (Async):  Gemini 3.1 Pro deep analysis → rich reasoning saved to DB (fire-and-forget)
//
// Previous history:
// 2026-02-15: REWRITTEN for speed, location capture, and SSE notification.
// 2026-02-16: Added server-side OCR pre-parser, 6-decimal GPS, VISION MODE.
// 2026-02-17: Migrated to offer_intelligence table — structured columns replace JSONB blob.
//
// Auth: Explicitly public — Siri Shortcuts cannot send JWT tokens

import { Router } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import { db } from '../../db/drizzle.js';
import { sql } from 'drizzle-orm';
import { offer_intelligence } from '../../../shared/schema.js';
import { callModel } from '../../lib/ai/adapters/index.js';
import { parseOfferText, formatPerMileForVoice, classifyTier } from '../../lib/offers/parse-offer-text.js';
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

// 2026-03-29: Phase 1 ultra-lean prompt — minimal tokens for 3s trip radar / 9s regular.
// Rules produce ACCEPT/REJECT. Reason = terse: "$1.14 8.2mi" or "$0.78 14mi too far".
// Phase 2 handles all deep analysis and DB enrichment — Phase 1 just decides.
// Tier is injected at runtime from pre-parsed product_type via classifyTier().
const PHASE1_PROMPTS = {
  share: `Raw JSON only. No markdown/backticks.
REJECT. Share rides always rejected.
{"price":0,"per_mile":0,"total_miles":0,"total_minutes":0,"decision":"REJECT","reason":"share"}`,

  standard: `Raw JSON only. No markdown/backticks.

Math: total_miles=pickup_mi+ride_mi. total_min=pickup_min+ride_min. per_mile=price/total_miles.

Rules (first match wins):
1. REJECT if rating visible and <4.85.
2. REJECT if "Verified" missing.
3. REJECT if $/mi<0.90.
4. ACCEPT if $/mi>=0.90, total_min<=20.
5. ACCEPT if $/mi>=1.10, total_min<=25.
6. ACCEPT if $/mi>=1.75, total_min<30.
7. ACCEPT if $/mi>=2.00, total_min 30-40.
8. ACCEPT if $/mi>=2.00, total_min>40.
9. REJECT.

reason: terse. "$1.14 8.3mi" or "$0.78 14.0mi low". No sentences.

{"price":0,"per_mile":0,"total_miles":0,"total_minutes":0,"decision":"REJECT","reason":"$0.00 0.0mi"}`,

  premium: `Raw JSON only. No markdown/backticks.

Math: total_miles=pickup_mi+ride_mi. total_min=pickup_min+ride_min. per_mile=price/total_miles.

PREMIUM ride (Comfort/VIP/XL/Black). Higher floor, more time allowed.
Rules (first match wins):
1. REJECT if rating visible and <4.85.
2. REJECT if "Verified" missing.
3. REJECT if $/mi<1.10.
4. ACCEPT if $/mi>=1.10, total_min<=25.
5. ACCEPT if $/mi>=1.40, total_min<=30.
6. ACCEPT if $/mi>=1.75, total_min<=40.
7. ACCEPT if $/mi>=2.00, total_min>40.
8. REJECT.

reason: terse. "$1.21 13.7mi" or "$1.05 18mi low". No sentences.

{"price":0,"per_mile":0,"total_miles":0,"total_minutes":0,"decision":"REJECT","reason":"$0.00 0.0mi"}`,
};

// 2026-02-28: Phase 2 deep prompt — full reasoning for DB enrichment.
// Runs async after Siri response is sent. No time pressure.
const PHASE2_SYSTEM_PROMPT = `You are a rideshare offer analyst for a Dallas-Fort Worth DFW-area driver based in Frisco, TX.
Provide DEEP analysis. Return ONLY valid JSON.

{
  "parsed_data": {
    "price": number, "miles": number, "pickup_minutes": number, "ride_minutes": number,
    "pickup": "street/intersection", "dropoff": "street/intersection",
    "platform": "uber"|"lyft"|"unknown", "surge": number|null, "per_mile": number,
    "rider_rating": number|null, "product_type": string|null
  },
  "decision": "ACCEPT"|"REJECT",
  "reasoning": "2-3 sentences: location quality, return-trip viability, economic assessment",
  "confidence": 0-100,
  "location_analysis": {
    "dropoff_zone": "core"|"deadhead"|"fringe",
    "return_difficulty": "easy"|"moderate"|"hard",
    "area_demand": "high"|"medium"|"low"
  }
}

RULES (tier-aware — check TIER tag below):
STANDARD (UberX/Exclusive/Priority/Lyft):
  1. $/mi >= $0.90 + under 20 min → ACCEPT.
  2. $/mi >= $1.10 + under 25 min → ACCEPT.
  3. $/mi >= $1.75 + under 30 min → ACCEPT.
  4. $/mi >= $2.00 + 30-40 min → ACCEPT.
  5. $/mi >= $2.00 + >40 min → ACCEPT.
  6. Below $0.90/mi → REJECT always.
PREMIUM (Comfort/VIP/Black/XL):
  1. $/mi >= $1.10 + under 25 min → ACCEPT.
  2. $/mi >= $1.40 + under 30 min → ACCEPT.
  3. $/mi >= $1.75 + under 40 min → ACCEPT.
  4. $/mi >= $2.00 + >40 min → ACCEPT.
  5. Below $1.10/mi → REJECT always.
SHARE: Always REJECT.
GENERAL:
  7. Rider rating < 4.85 → REJECT. Short rides with good $/mi = GOOD.
  8. Home base: Frisco, TX. Reject rides west of DFW Airport, Fort Worth, Denton outskirts, Anna, rural areas.
  9. Deadhead zones (west of airport or south of 635) need >= $2.00/mi.
  10. Consider driver's CURRENT LOCATION when evaluating deadhead. If already near dropoff area, deadhead is near-zero.

Trust pre-parsed numbers if provided. Focus on ADDRESSES and DESTINATION QUALITY.`;

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

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 1 — SYNCHRONOUS: Fast Flash decision for Siri (<2s target)
    // 2026-02-28: Lean prompt, compressed pre-parse, minimal tokens
    // ═══════════════════════════════════════════════════════════════════════

    // Compressed pre-parse injection — single line to minimize tokens
    const preParseOneLiner = preParsed && preParsed.parse_confidence !== 'minimal'
      ? `PRE-PARSED: $${preParsed.price ?? '?'} | ${preParsed.pickup_minutes ?? '?'}min/${preParsed.pickup_miles ?? '?'}mi pickup | ${preParsed.ride_minutes ?? '?'}min/${preParsed.ride_miles ?? '?'}mi ride | $${preParsed.per_mile ?? '?'}/mi | ${preParsed.product_type || '?'}`
      : '';

    // Build lean user message — text path gets compressed pre-parse + raw text
    const phase1UserMessage = text
      ? `${preParseOneLiner ? preParseOneLiner + '\n' : ''}Offer text: "${text}"`
      : 'Analyze this ride offer screenshot.';

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
        }
      }
      // Remove any whitespace/newlines that break base64 decoding
      imageData = imageData.replace(/\s/g, '');
      images.push({ mimeType, data: imageData });
      console.log(`[hooks/analyze-offer] 🖼️ Vision mode: ${Math.round(imageData.length / 1024)}KB base64 (${mimeType})`);
    }

    // 2026-03-29: Tier-aware prompt selection — share/standard/premium
    const tier = classifyTier(preParsed?.product_type);
    const phase1SystemPrompt = PHASE1_PROMPTS[tier];

    // Share = instant reject, skip AI call entirely
    if (tier === 'share') {
      const responseTimeMs = Date.now() - startTime;
      console.log(`[hooks/analyze-offer] 🚫 Share tier auto-reject (${responseTimeMs}ms)`);
      return res.json({
        success: true,
        voice: '',
        notification: 'REJECT: share',
        decision: 'REJECT',
        response_time_ms: responseTimeMs,
      });
    }

    // Phase 1 AI call — OFFER_ANALYZER (Flash) for speed
    console.log(`[hooks/analyze-offer] ⚡ PHASE 1: Calling OFFER_ANALYZER (Flash) [${tier}]${images.length ? ' [vision]' : ''}...`);
    const phase1Response = await callModel('OFFER_ANALYZER', {
      system: phase1SystemPrompt,
      user: phase1UserMessage,
      images,
    });

    if (!phase1Response.success) {
      throw new Error(`Phase 1 AI analysis failed: ${phase1Response.error}`);
    }

    // 2026-03-02: Robust JSON extraction — two-tier approach
    // Tier 1: Direct parse (clean JSON from adapter)
    // Tier 2: Extract first JSON object from prose (Gemini sometimes adds preamble)
    let phase1Result;
    try {
      const cleaned = phase1Response.text
        .replace(/```json/g, '').replace(/```/g, '').trim();
      try {
        const raw = JSON.parse(cleaned);
        phase1Result = raw.parsed_data || raw;
      } catch {
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          const extracted = cleaned.slice(firstBrace, lastBrace + 1);
          const raw = JSON.parse(extracted);
          phase1Result = raw.parsed_data || raw;
          console.log(`[hooks/analyze-offer] 🧹 Extracted JSON from preamble (${firstBrace} chars stripped)`);
        } else {
          throw new Error('No JSON object found in response');
        }
      }
    } catch (_parseErr) {
      console.warn('[hooks/analyze-offer] ⚠️ Phase 1 JSON parse failed, raw:', phase1Response.text?.substring(0, 200));
      // Tier 3: Deterministic rule engine using pre-parsed data
      // 2026-03-02: When AI fails to return JSON, apply the user's rules in code.
      // Pre-parser already has price, miles, minutes — we just need the decision.
      if (preParsed && preParsed.per_mile !== null) {
        const pm = preParsed.per_mile;
        const totalMin = preParsed.total_minutes ?? 999;
        const rating = phase1Result?.rider_rating ?? null;
        let fallbackDecision = 'REJECT';
        let fallbackReason = '';

        // 2026-03-29: Tier-aware $/mi + duration fallback — three tiers from DFW data.
        // Format: "$X.XX X.Xmi" for accepts, "$X.XX X.Xmi low/floor/too far" for rejects.
        // Phase 2 handles geographic deep analysis — this just does math.
        const totalMi = preParsed.total_miles?.toFixed(1) ?? '?';
        const tierTag = tier === 'premium' ? ' prem' : '';

        if (rating !== null && rating < 4.85) {
          fallbackReason = `$${pm.toFixed(2)} ${totalMi}mi rating`;
        } else if (tier === 'premium') {
          // 2026-03-29: Premium tier — higher floor ($1.10), relaxed time limits
          if (pm < 1.10) {
            fallbackReason = `$${pm.toFixed(2)} ${totalMi}mi floor${tierTag}`;
          } else if (pm >= 1.10 && totalMin <= 25) {
            fallbackDecision = 'ACCEPT';
            fallbackReason = `$${pm.toFixed(2)} ${totalMi}mi${tierTag}`;
          } else if (pm >= 1.40 && totalMin <= 30) {
            fallbackDecision = 'ACCEPT';
            fallbackReason = `$${pm.toFixed(2)} ${totalMi}mi${tierTag}`;
          } else if (pm >= 1.75 && totalMin <= 40) {
            fallbackDecision = 'ACCEPT';
            fallbackReason = `$${pm.toFixed(2)} ${totalMi}mi${tierTag}`;
          } else if (pm >= 2.00 && totalMin > 40) {
            fallbackDecision = 'ACCEPT';
            fallbackReason = `$${pm.toFixed(2)} ${totalMi}mi${tierTag}`;
          } else if (totalMin > 40) {
            fallbackReason = `$${pm.toFixed(2)} ${totalMi}mi too far${tierTag}`;
          } else {
            fallbackReason = `$${pm.toFixed(2)} ${totalMi}mi low${tierTag}`;
          }
        } else {
          // 2026-03-29: Standard tier — same thresholds as before
          if (pm < 0.90) {
            fallbackReason = `$${pm.toFixed(2)} ${totalMi}mi floor`;
          } else if (pm >= 0.90 && totalMin <= 20) {
            fallbackDecision = 'ACCEPT';
            fallbackReason = `$${pm.toFixed(2)} ${totalMi}mi`;
          } else if (pm >= 1.10 && totalMin <= 25) {
            fallbackDecision = 'ACCEPT';
            fallbackReason = `$${pm.toFixed(2)} ${totalMi}mi`;
          } else if (pm >= 1.75 && totalMin < 30) {
            fallbackDecision = 'ACCEPT';
            fallbackReason = `$${pm.toFixed(2)} ${totalMi}mi`;
          } else if (totalMin >= 30 && totalMin <= 40 && pm >= 2.00) {
            fallbackDecision = 'ACCEPT';
            fallbackReason = `$${pm.toFixed(2)} ${totalMi}mi`;
          } else if (totalMin > 40 && pm >= 2.00) {
            fallbackDecision = 'ACCEPT';
            fallbackReason = `$${pm.toFixed(2)} ${totalMi}mi`;
          } else if (totalMin > 40) {
            fallbackReason = `$${pm.toFixed(2)} ${totalMi}mi too far`;
          } else {
            fallbackReason = `$${pm.toFixed(2)} ${totalMi}mi low`;
          }
        }

        console.log(`[hooks/analyze-offer] 🔧 Deterministic fallback: ${fallbackDecision} — ${fallbackReason}`);
        phase1Result = {
          decision: fallbackDecision,
          reason: fallbackReason,
          confidence: 80,
          ...preParsed,
        };
      } else {
        // 2026-03-29: No pre-parsed data — "no data" not "REJECT".
        // REJECT is reserved for rule-evaluated offers only.
        phase1Result = {
          decision: 'NO DATA',
          reason: 'no data',
          confidence: 0,
        };
      }
    }

    // Extract decision fields from normalized result
    const decision = phase1Result.decision || 'REJECT';
    // 2026-03-29: Accept both "reason" (new terse) and "reasoning" (legacy) field names
    const reason = phase1Result.reason || phase1Result.reasoning || '';
    const confidence = phase1Result.confidence || 0;

    const responseTimeMs = Date.now() - startTime;

    // 2026-03-29: Terse notification for 3s trip radar / 9s regular offers.
    // Format: "ACCEPT: $1.14 8.2mi core" or "REJECT: $0.78 14.0mi too far"
    // Server builds from pre-parsed data when AI reason is missing/verbose.
    const perMileValue = preParsed?.per_mile ?? phase1Result.per_mile ?? null;
    const totalMi = preParsed?.total_miles ?? phase1Result.total_miles ?? null;
    const terseReason = reason || (perMileValue !== null && totalMi !== null
      ? `$${perMileValue.toFixed(2)} ${totalMi.toFixed(1)}mi`
      : '');
    const notification = terseReason
      ? `${decision}: ${terseReason}`
      : decision;

    // ══════════════════════════════════════════════════════════════
    // RESPOND TO SIRI — driver is waiting, every ms counts
    // ══════════════════════════════════════════════════════════════
    res.json({
      success: true,
      voice: '',
      notification,
      decision,
      response_time_ms: responseTimeMs,
    });

    console.log(`[hooks/analyze-offer] ⚡ Phase 1 responded in ${responseTimeMs}ms: ${decision} $${perMileValue || '?'}/mi [${tier}]`);

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 2 — ASYNC: Deep Pro 3.1 analysis for DB enrichment
    // 2026-02-28: Fire-and-forget after res.json(). Images stay in closure scope.
    // If Pro fails, Phase 1 Flash result is saved to DB instead — data never lost.
    // ═══════════════════════════════════════════════════════════════════════
    const platform = preParsed?.platform_hint || phase1Result.platform || 'unknown';
    const deviceId = device_id || 'anonymous_device';

    (async () => {
      try {
        // Build rich context for Phase 2 deep analysis
        const locationContext = (lat && lng)
          ? `\nDriver GPS: ${lat}, ${lng} (market: ${market}).`
          : '';

        const preParseBlock = preParsed && preParsed.parse_confidence !== 'minimal' ? `
PRE-PARSED DATA (server-verified):
  Price: ${preParsed.price !== null ? `$${preParsed.price.toFixed(2)}` : 'NOT DETECTED'}
  Pickup: ${preParsed.pickup_minutes !== null ? `${preParsed.pickup_minutes} min, ${preParsed.pickup_miles} mi` : 'NOT DETECTED'}
  Ride: ${preParsed.ride_minutes !== null ? `${preParsed.ride_minutes} min, ${preParsed.ride_miles} mi` : 'NOT DETECTED'}
  Total: ${preParsed.total_miles !== null ? `${preParsed.total_miles.toFixed(1)} mi, ${preParsed.total_minutes} min` : 'NOT DETECTED'}
  $/mile: ${preParsed.per_mile !== null ? `$${preParsed.per_mile.toFixed(2)}` : 'CALCULATE'}
  Product: ${preParsed.product_type || 'DETECT'}
  Surge: ${preParsed.surge !== null ? `$${preParsed.surge}` : 'none'}` : '';

        // 2026-03-29: Inject tier so Phase 2 applies correct rule set
        const tierContext = `\nTIER: ${tier.toUpperCase()} (${preParsed?.product_type || 'unknown'}). Apply ${tier} rules above.`;
        const phase2System = PHASE2_SYSTEM_PROMPT + locationContext + tierContext + preParseBlock;

        const phase2UserMessage = text
          ? `Offer text: "${text}"`
          : 'Analyze this ride offer screenshot in detail.';

        // Phase 2 AI call — OFFER_ANALYZER_DEEP (Pro 3.1) for rich reasoning
        // 2026-02-28: 45s timeout — callGemini SDK has no built-in timeout, so we wrap with Promise.race
        // to prevent the async IIFE from hanging forever if Pro 3.1 is slow or unresponsive.
        const PHASE2_TIMEOUT_MS = 45000;
        console.log(`[hooks/analyze-offer] 🔬 PHASE 2: Calling OFFER_ANALYZER_DEEP (Pro 3.1, ${PHASE2_TIMEOUT_MS / 1000}s timeout)...`);
        const phase2Start = Date.now();

        let deepResult = null;
        let aiModelUsed = 'gemini-3-flash'; // Default: Phase 1 model (used if Phase 2 fails)
        let phase2RawText = null;

        try {
          const phase2Promise = callModel('OFFER_ANALYZER_DEEP', {
            system: phase2System,
            user: phase2UserMessage,
            images,
          });
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Phase 2 timed out after ${PHASE2_TIMEOUT_MS / 1000}s`)), PHASE2_TIMEOUT_MS)
          );
          const phase2Response = await Promise.race([phase2Promise, timeoutPromise]);

          if (phase2Response.success) {
            phase2RawText = phase2Response.text;
            const cleaned = phase2Response.text
              .replace(/```json/g, '').replace(/```/g, '').trim();
            deepResult = JSON.parse(cleaned);
            aiModelUsed = 'gemini-3.1-pro';
            console.log(`[hooks/analyze-offer] 🔬 PHASE 2 DONE (${Date.now() - phase2Start}ms): ai_model=${aiModelUsed}, decision=${deepResult.decision}`);
          } else {
            console.warn(`[hooks/analyze-offer] ⚠️ Phase 2 AI call failed: ${phase2Response.error} — falling back to Phase 1 result`);
          }
        } catch (phase2Err) {
          console.warn(`[hooks/analyze-offer] ⚠️ Phase 2 error: ${phase2Err.message} — falling back to Phase 1 result`);
        }

        // Use deep result if available, otherwise fall back to Phase 1
        const dbParsedData = deepResult?.parsed_data || phase1Result;
        const dbDecision = deepResult?.decision || decision;
        const dbReasoning = deepResult?.reasoning || reason;
        const dbConfidence = deepResult?.confidence || confidence;
        const locationAnalysis = deepResult?.location_analysis || null;

        // Merge all parsed data for the raw JSON column
        const mergedParsedData = {
          ...(preParsed || {}),
          ...dbParsedData,
          per_mile: preParsed?.per_mile ?? dbParsedData?.per_mile,
          per_minute: preParsed?.per_minute ?? dbParsedData?.per_minute,
          location_analysis: locationAnalysis,
        };

        // 2026-02-17: Compute geographic columns
        const coordKeyValue = (lat && lng) ? coordsKey(lat, lng) : null;
        const h3Index = (lat && lng) ? latLngToCell(lat, lng, 8) : null;

        // 2026-02-17: Compute temporal columns from current time
        const now = new Date();
        const localHour = now.getUTCHours();
        const dayOfWeek = now.getUTCDay();
        const dayPart = getDayPartKey(localHour);
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const localDate = now.toISOString().split('T')[0];

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

        // 2026-02-28: INSERT with Phase 2 deep data (or Phase 1 fallback)
        // ai_model records which model actually provided the stored analysis
        await db.insert(offer_intelligence).values({
          device_id: deviceId,

          // Offer metrics — prefer server pre-parsed (regex) over AI-parsed (LLM math)
          price: preParsed?.price ?? dbParsedData?.price ?? null,
          per_mile: perMileValue,
          per_minute: preParsed?.per_minute ?? dbParsedData?.per_minute ?? null,
          hourly_rate: preParsed?.hourly_rate ?? null,
          surge: preParsed?.surge ?? dbParsedData?.surge ?? null,
          advantage_pct: preParsed?.advantage_pct ?? null,
          pickup_minutes: preParsed?.pickup_minutes ?? dbParsedData?.pickup_minutes ?? null,
          pickup_miles: preParsed?.pickup_miles ?? null,
          ride_minutes: preParsed?.ride_minutes ?? dbParsedData?.ride_minutes ?? null,
          ride_miles: preParsed?.ride_miles ?? null,
          total_miles: preParsed?.total_miles ?? dbParsedData?.miles ?? null,
          total_minutes: preParsed?.total_minutes ?? null,
          product_type: preParsed?.product_type ?? dbParsedData?.product_type ?? null,
          platform,

          // Addresses (from AI parsing — regex doesn't extract these)
          pickup_address: dbParsedData?.pickup ?? null,
          dropoff_address: dbParsedData?.dropoff ?? null,

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

          // AI analysis — Phase 2 deep reasoning (or Phase 1 fallback)
          decision: dbDecision,
          decision_reasoning: dbReasoning,
          confidence_score: dbConfidence,
          ai_model: aiModelUsed,
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
          raw_ai_response: phase2RawText || phase1Response.text || null,
          parsed_data_json: mergedParsedData,
        });

        console.log(`[hooks/analyze-offer] ✅ Saved: ${dbDecision} (Phase1: ${responseTimeMs}ms, Phase2: ${Date.now() - phase2Start}ms) — $${mergedParsedData?.price || '?'} / ${mergedParsedData?.total_miles || mergedParsedData?.miles || '?'}mi = $${perMileValue || '?'}/mi [ai_model: ${aiModelUsed}]`);

        // SSE broadcast for web app
        const notifyPayload = JSON.stringify({
          device_id: deviceId,
          decision: dbDecision,
          reasoning: dbReasoning,
          price: dbParsedData?.price,
          per_mile: perMileValue,
          platform,
          response_time_ms: responseTimeMs,
          ai_model: aiModelUsed,
        });
        await db.execute(sql`SELECT pg_notify('offer_analyzed', ${notifyPayload})`);
      } catch (err) {
        console.error(`[hooks/analyze-offer] ⚠️ Phase 2 background error: ${err.message}`);
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
// 2026-03-17: SECURITY FIX (F-3) — Require device_id ownership scope.
// Previously deleted arbitrary rows by id with no auth or ownership check.
router.post('/offer-cleanup', async (req, res) => {
  try {
    const { ids, device_id } = req.body;

    if (!device_id || typeof device_id !== 'string' || device_id.length > 128) {
      return res.status(400).json({ error: 'Valid device_id required' });
    }

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Missing ids array' });
    }

    if (ids.length > 50) {
      return res.status(400).json({ error: 'Max 50 IDs per request' });
    }

    const result = await db.execute(
      sql`DELETE FROM offer_intelligence WHERE id = ANY(${ids}) AND device_id = ${device_id} RETURNING id`
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
