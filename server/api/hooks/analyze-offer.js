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
import { parseOfferText, formatPerMileForVoice } from '../../lib/offers/parse-offer-text.js';
import { normalizeOfferBody } from '../../lib/offers/normalize-offer-body.js';
import { downscaleOfferImage } from '../../lib/offers/downscale-offer-image.js';
import { parseModelJson } from '../../lib/offers/parse-model-json.js';
// 2026-06-20: Unified rules engine — single source for the prompts AND the
// deterministic fallback (replaces the inline PHASE1_PROMPTS + JS ladder below).
// 2026-07-03 (todo #10): v3 — per-driver rules. classifyTier now comes from the
// engine (ruleset-aware comfort/xl split); buildPhase1VisionPrompt renders a
// multi-tier prompt for image-only requests (previously they were silently
// judged by standard-tier rules); buildPhase2Prompt replaces the hardcoded
// English ladder that used to live in this file and drift from Phase 1.
import {
  buildPhase1Prompt,
  buildPhase1VisionPrompt,
  buildPhase2Prompt,
  evaluateDeterministic,
  evaluateGeoRules,
  classifyTier,
  NOTICE_LABELS,
  DEFAULT_RULESET,
} from '../../lib/offers/rules-engine.js';
import { resolveRuleset } from '../../lib/offers/ruleset-store.js';
import { geocodeEventAddress } from '../../lib/events/pipeline/geocodeEvent.js';
// 2026-08-17: card-address hygiene (placeholders like "Unknown" never reach the geocoder)
import { usableOfferAddress, resolveCardPoints } from '../../lib/offers/offer-address.js';
// 2026-08-17 (Melody: "get details like we do for venues"): the venue Places adapter is the
// fallback resolver for partial card addresses ("Terminal B, Departures: Zone 14").
import { searchPlaceWithTextSearch } from '../../lib/venue/venue-address-resolver.js';
import { haversineDistanceMiles } from '../../lib/location/geo.js';
// 2026-02-17: Shared utilities for structured analytics columns
import { getDayPartKey, getLocalHour, getLocalDow, getLocalDateString } from '../../lib/location/daypart.js';
import { coordsKey } from '../../lib/location/coords-key.js';
import { latLngToCell } from 'h3-js';
// 2026-04-16: FIX — resolve driver timezone from coords so temporal columns are local, not UTC
// 2026-08-17: also from the geocoded pickup address (first address on the card) — see Phase 2
import { resolveTimezoneFromCoords } from '../../lib/location/resolveTimezone.js';
import { offerHookLimiter } from '../../middleware/rate-limit.js';

// Auth model (2026-08-11, auth-hardening Item 7 partially closed): Siri
// Shortcuts can't send JWTs, so identity here is the per-user shortcut token
// (x-shortcut-token). /analyze-offer stays token-OPTIONAL (an untokened legacy
// Shortcut still gets a decision; its offer just isn't stored per-user); the
// read/mutate endpoints below are token-REQUIRED. All four are rate-limited.
const router = Router();

// 2026-08-11: Shortcut-token auth for the offer read/mutate endpoints below.
// The Shortcut already sends this token for /analyze-offer; the same token is
// the identity for history/override/cleanup. device_id is NOT a credential —
// it was the only "ownership" scope here before, which let anyone read or
// delete any device's offers (multi-user scoping sweep, Phase A finding 2).
async function requireShortcutUser(req, res, next) {
  const token = req.get('x-shortcut-token') || req.body?.shortcut_token || req.query?.shortcut_token || null;
  if (!token) {
    return res.status(401).json({ error: 'shortcut_token required (header x-shortcut-token or shortcut_token field)' });
  }
  try {
    const { userId } = await resolveRuleset(token);
    if (!userId) {
      return res.status(401).json({ error: 'invalid shortcut token' });
    }
    req.shortcutUserId = userId;
    next();
  } catch (err) {
    console.error('[HOOKS] shortcut token resolution failed:', err.message);
    res.status(500).json({ error: 'token_resolution_failed' });
  }
}

// 2026-04-16: Build TTS-friendly voice line for Siri Shortcuts "Speak Text" action.
// Composes: "<Decision>. <perMileSpoken>, <N> mile(s)[, <qualifier>]."
// Examples:
//   ACCEPT, $1.12, 8mi              → "Accept. dollar twelve per mile, 8 miles."
//   REJECT, $0.78, 14mi, "too far"  → "Reject. seventy-eight cents per mile, 14 miles, too far."
//   NO DATA                         → "No data. Decide manually."
// Qualifier is sniffed from the terse Phase-1 reason ("low"/"floor"/"too far"/"rating") and
// rendered as a natural-language tail. Siri's TTS handles bare digits ("14 miles") as words.
function buildVoiceLine(decision, perMile, totalMiles, reason) {
  const decisionWord = decision === 'ACCEPT' ? 'Accept'
    : decision === 'REJECT' ? 'Reject'
    : String(decision || '').toLowerCase().replace(/^./, c => c.toUpperCase());

  // 2026-04-16: FIX — produce an actionable message when offer data couldn't be parsed,
  // instead of bare "Unknown." which gives Siri nothing useful to speak.
  if (perMile == null || totalMiles == null || isNaN(perMile) || isNaN(totalMiles)) {
    return 'No data. Decide manually.';
  }

  const perMileSpoken = formatPerMileForVoice(perMile);
  const milesRounded = Math.round(totalMiles);
  const milesPhrase = `${milesRounded} mile${milesRounded === 1 ? '' : 's'}`;

  // Map terse Phase-1 reason tokens → spoken qualifier phrases.
  // Order matters (first match wins): 'too far' before 'time', 'fallback' before 'low'.
  const qualifierMap = [
    ['too far', 'too far'],
    ['rating', 'low rider rating'],
    ['fallback', 'fallback accept'],
    ['pickup', 'long pickup'],
    ['over time', 'too long'],
    ['floor', 'below floor'],
    ['low', 'rate too low'],
  ];
  let qualifier = '';
  const reasonLower = (reason || '').toLowerCase();
  for (const [token, phrase] of qualifierMap) {
    if (reasonLower.includes(token)) { qualifier = `, ${phrase}`; break; }
  }

  return `${decisionWord}. ${perMileSpoken}, ${milesPhrase}${qualifier}.`;
}

// 2026-06-20: Build the terse Phase-1 reason string from the rules-engine reasonKind,
// preserving the legacy format exactly: "$1.14 8.3mi" (accept), "$0.78 14.0mi low",
// "$1.05 18.0mi floor prem", "$0.90 22.0mi too far", "$1.00 5.0mi rating".
// Premium appends " prem" to every kind except "rating" (matches legacy fallback).
function terseReason(reasonKind, perMile, totalMiles, tier) {
  const base = `$${perMile.toFixed(2)} ${totalMiles}mi`;
  const tag = tier === 'premium' ? ' prem'
    : tier === 'comfort' ? ' comf'
    : tier === 'xl' ? ' xl'
    : '';
  switch (reasonKind) {
    case 'accept':          return `${base}${tag}`;
    case 'accept_fallback': return `${base} fallback${tag}`;   // v3 ARP (spec: ACCEPT (FALLBACK))
    case 'floor':           return `${base} floor${tag}`;
    case 'min_floor':       return `${base} min${tag}`;
    case 'pickup':          return `${base} pickup${tag}`;     // v3 pickup limits
    case 'time_limit':      return `${base} over time${tag}`;  // v3 total-time limit
    case 'too_far':         return `${base} too far${tag}`;
    case 'rating':          return `${base} rating`;
    case 'low':
    default:                return `${base} low${tag}`;
  }
}

// 2026-02-17: Multer for multipart form-data uploads (Siri sends raw image, no base64)
// Memory storage — no disk writes, image stays in RAM as Buffer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max (matches express.json limit)
});

// 2026-06-20: Phase-1 prompts now come from server/lib/offers/rules-engine.js
// (buildPhase1Prompt) — ONE source renders the prompt AND drives the deterministic
// fallback. buildPhase1Prompt(tier, DEFAULT_RULESET) is byte-identical to the old
// inline PHASE1_PROMPTS (proven in tests/offers/rules-engine-parity.test.js), so the
// live Siri path is unchanged until a per-user ruleset is loaded.

// 2026-07-03 (todo #10): the Phase-2 deep prompt now comes from the rules engine
// (buildPhase2Prompt) — it renders the driver's ACTUAL ruleset, replacing the
// hardcoded English ladder that lived here and drifted from Phase 1 by
// construction the moment per-driver rules existed. The dead `location` param
// (never passed at the call site) is gone with it.

// POST /api/hooks/analyze-offer
// Accepts THREE input modes:
//   1. JSON with text (OCR):       { text, device_id, latitude, longitude }
//   2. JSON with base64 image:     { image, image_type, device_id, latitude, longitude }
//   3. Multipart form-data:        image file + device_id/latitude/longitude form fields
//      (2026-02-17: Fastest — Siri skips base64 encoding, server handles it in <1ms)
//
// Multipart detection: multer runs first. If no file uploaded, falls through to JSON body.
router.post('/analyze-offer', offerHookLimiter, upload.single('image'), async (req, res) => {
  const startTime = Date.now();

  try {
    // 2026-02-17: Normalize input from either JSON body or multipart form fields
    // Multipart: req.file has the image buffer, req.body has text fields
    // JSON: req.body has everything including base64 image string
    //
    // 2026-08-14: field names pass through the deterministic alias table
    // (normalize-offer-body.js) so a hand-built shortcut still gets an answer.
    // A safety net, not silence — a wrong key on a known shortcut is something to
    // TELL the owner about (Melody 2026-08-17: "fix me first"). Supersedes the
    // 2026-07-03 one-off 'lattitude' patch; same fail-loud contract (every remap
    // warn-logged), generalized to all enumerated variants.
    const { body: offerBody, remapped } = normalizeOfferBody(req.body);
    if (remapped.length) {
      console.warn(`[HOOKS] Field aliases accepted: ${remapped.join(', ')} — update the Shortcut key names`);
    }

    let text, image, image_type, device_id, latitude, longitude, source;

    if (req.file) {
      // MULTIPART PATH — image came as file upload (raw bytes, no base64 from Siri)
      // Server encodes to base64 here — <1ms on server vs ~200ms on iOS
      image = req.file.buffer.toString('base64');
      image_type = req.file.mimetype || 'image/jpeg';
      // Form fields come through req.body even with multer
      text = offerBody.text || null;
      device_id = offerBody.device_id;
      latitude = offerBody.latitude ? parseFloat(offerBody.latitude) : undefined;
      longitude = offerBody.longitude ? parseFloat(offerBody.longitude) : undefined;
      source = offerBody.source || 'siri_vision';
      const sizeKB = Math.round(req.file.size / 1024);
      console.log(`[HOOKS] Multipart upload: ${sizeKB}KB ${image_type} (server-encoded base64 in <1ms)`);
    } else {
      // JSON PATH — existing flow (base64 image or OCR text in JSON body)
      ({ text, image, image_type, device_id, latitude, longitude, source = 'siri_shortcut' } = offerBody);
    }

    // 2026-07-03 (todo #10): identity bridge — an unguessable per-user token
    // resolves user_id + per-driver ruleset. Header preferred; form field
    // accepted (Shortcuts dictionaries are easier to edit than headers).
    // No/invalid token → DEFAULT_RULESET + null user_id (legacy behavior).
    const shortcutToken = req.get('x-shortcut-token') || offerBody.shortcut_token || null;

    if (!text && !image) {
      return res.status(400).json({ error: 'Missing text or image payload' });
    }

    console.log(`[HOOKS] 📱 Incoming from ${device_id || 'anonymous'} (${source})`);

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
      console.log(`[HOOKS] 📊 Pre-parsed: $${preParsed.price || '?'} / ${preParsed.total_miles || '?'}mi = $${preParsed.per_mile || '?'}/mi (${preParsed.parse_confidence})`);
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
    // 2026-07-03: image is included whenever present — previously text+image
    // requests dropped the screenshot. Spec Data Priority: use BOTH Vision and OCR.
    const images = [];
    if (image) {
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
      // 2026-08-14 (todo #43 <3s target): downscale before the model call —
      // live payloads run 900KB-1.3MB and every byte past ~820px width is pure
      // upload latency. Phase 2 shares this images[] closure by design: the
      // card stays fully legible for deep extraction. Fail-open — the original
      // proceeds on any downscale error. raw_text keeps the ORIGINAL size
      // marker (what the device actually sent).
      const originalKB = Math.round(imageData.length / 1024);
      const ds = await downscaleOfferImage(Buffer.from(imageData, 'base64'), mimeType);
      if (ds.downscaled) {
        imageData = ds.buffer.toString('base64');
        mimeType = ds.mimeType;
      }
      images.push({ mimeType, data: imageData });
      console.log(`[HOOKS] Vision mode: ${Math.round(imageData.length / 1024)}KB base64 (${mimeType})${ds.downscaled ? ` — downscaled from ${originalKB}KB` : ''}`);
    }

    // 2026-07-03 (todo #10): the per-user ruleset bridge. Token → user + rules;
    // no token → DEFAULT_RULESET (zero change for un-migrated devices). The
    // store fail-opens loudly and caches 15s, so this read is hot-path safe
    // (measured Phase-1 p50 is 5.3s; this is ~10ms once per burst).
    const { ruleset, userId, version: rulesetVersion, hash: rulesetHash } = await resolveRuleset(shortcutToken);
    if (userId) console.log(`[HOOKS] Ruleset resolved: user=${userId} v${rulesetVersion ?? 'default'}`);

    // 2026-03-29: Tier-aware prompt selection — share/standard/premium (+ v3 comfort/xl)
    // 2026-07-03: share.auto_reject wired — explicitly false routes share offers
    // through standard rules instead of the short-circuit (engine self-remaps too).
    let tier = classifyTier(preParsed?.product_type, ruleset);
    if (tier === 'share' && ruleset.share?.auto_reject === false) tier = 'standard';
    // Vision-only requests can't classify tier before the model looks at the
    // screenshot, so they get the multi-tier vision prompt (the model identifies
    // the product and applies that tier's rules). Text requests keep the exact
    // per-tier prompt (byte-pinned at defaults).
    const phase1SystemPrompt = text
      ? buildPhase1Prompt(tier, ruleset)
      : buildPhase1VisionPrompt(ruleset);

    // Share = instant reject, skip AI call entirely
    if (tier === 'share') {
      const responseTimeMs = Date.now() - startTime;
      console.log(`[HOOKS] Share tier auto-reject (${responseTimeMs}ms)`);
      return res.json({
        success: true,
        // 2026-04-16: TTS line for Siri "Speak Text" — no per-mile data on share path.
        voice: 'Reject. Share tier.',
        notification: 'REJECT: share',
        decision: 'REJECT',
        response_time_ms: responseTimeMs,
        // 2026-04-15: Phase-1 reason exposed independently from notification so Siri
        // Shortcuts can speak decision + display reason separately. Literal 'share'
        // because terseReason is not yet in scope on this early-return path.
        reason: 'share',
      });
    }

    // Tier 3 of the extraction ladder AND the answer of last resort: the
    // deterministic rule engine over the regex pre-parse. Decision-parity with
    // the legacy ladder is proven in tests/offers/rules-engine-parity.test.js.
    // 2026-08-14: takes an optional precomputed verdict + log label so the
    // fast lane below can reuse it without double-evaluating.
    const deterministicPhase1 = (fb = evaluateDeterministic(tier, preParsed || {}, ruleset), label = 'Deterministic fallback') => {
      if (fb.decision === 'NO DATA') {
        // No usable per_mile — "no data", not "REJECT" (reserved for rule-evaluated offers).
        return { decision: 'NO DATA', reason: 'no data', confidence: 0 };
      }
      const totalMi = preParsed.total_miles?.toFixed(1) ?? '?';
      const result = {
        decision: fb.decision,
        reason: terseReason(fb.reasonKind, preParsed.per_mile, totalMi, tier),
        confidence: 80,
        ...(fb.fallback ? { fallback: true } : {}),
        ...preParsed,
      };
      console.log(`[HOOKS] 🔧 ${label}: ${fb.decision} — ${result.reason}`);
      return result;
    };

    // ═══ FAST LANE — deterministic REJECT (2026-08-14, todo #43 <3s target) ═══
    // A confident text pre-parse that the rules engine REJECTS answers Siri in
    // ~1ms with NO model in the sync path. REJECT-only is parity-safe under ANY
    // ruleset: every prompt-side judgment rule (avoid zones, safety_road_types,
    // round-trip/multi-stop, require_verified, rating) is REJECT-ONLY in a
    // first-match ladder, so nothing the model sees can rescue an engine REJECT.
    // Engine ACCEPTs and NO DATA still go to the model, which owns the judgment
    // rules. parse_confidence 'full' required: as the PRIMARY decider the
    // pre-parse must have price + both leg pairs (stricter than the fallback role).
    let phase1Response = null;
    let phase1Result = null;
    if (text && preParsed?.parse_confidence === 'full' && preParsed.per_mile != null) {
      const fastVerdict = evaluateDeterministic(tier, preParsed, ruleset);
      if (fastVerdict.decision === 'REJECT') {
        phase1Result = deterministicPhase1(fastVerdict, 'Fast lane (model skipped)');
        // Driver-enabled notices, detected from the SAME text the model would
        // read — regex beats model observation for fixed card strings.
        // deadhead_reduction is a map visual ("…"), undetectable on the text
        // lane for the model too, so its absence here is parity, not regression.
        const enabledNotices = ruleset.global?.notices || {};
        const fastNotices = [
          ['on_the_way_filter', /\bon the way\b/i],
          ['verified_rider', /\bverified\b/i],
        ].filter(([key, re]) => enabledNotices[key] && re.test(text))
          .map(([key]) => NOTICE_LABELS[key]);
        if (fastNotices.length) phase1Result.notices = fastNotices;
      }
    }

    // Phase 1 AI call — OFFER_ANALYZER (Flash) for speed. Skipped entirely when
    // the fast lane above already answered.
    // 2026-07-03: wrapped in a 20s race (the Shortcut gives up at ~30s; the SDK
    // has no built-in timeout) and made failure-proof — a model failure or
    // timeout now falls through to the deterministic engine instead of a 500.
    // The rules always answer; NO DATA is the honest floor when nothing parsed.
    if (!phase1Result) {
      console.log(`[HOOKS] ⚡ PHASE 1: Calling OFFER_ANALYZER (Flash) [${tier}]${images.length ? ' [vision]' : ''}...`);
      const PHASE1_TIMEOUT_MS = 20000;
      try {
        phase1Response = await Promise.race([
          callModel('OFFER_ANALYZER', {
            system: phase1SystemPrompt,
            user: phase1UserMessage,
            images,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Phase 1 timed out after ${PHASE1_TIMEOUT_MS / 1000}s`)), PHASE1_TIMEOUT_MS)
          ),
        ]);
      } catch (aiErr) {
        console.warn(`[HOOKS] Phase 1 model call failed (${aiErr.message}) — deterministic fallback`);
      }
      if (phase1Response && !phase1Response.success) {
        console.warn(`[HOOKS] Phase 1 AI analysis failed (${phase1Response.error}) — deterministic fallback`);
      }

      // Tolerant JSON extraction (parse-model-json.js): clean → brace-slice → repair a
      // missing closing brace (live-observed 2026-08-17). Anything worse → rules engine.
      if (!phase1Response?.success) {
        phase1Result = deterministicPhase1();
      } else {
        const parsed = parseModelJson(phase1Response.text);
        if (parsed.ok) {
          phase1Result = parsed.value;
          if (parsed.tier > 1) console.log(`[HOOKS] Phase 1 JSON recovered (tier ${parsed.tier})`);
        } else {
          console.warn('[HOOKS] Phase 1 JSON parse failed, raw:', phase1Response.text?.substring(0, 200));
          phase1Result = deterministicPhase1();
        }
      }

      // Honest floor (2026-08-17): a reply that parsed but carries no decision, or that
      // describes no ride at all (every metric zero — every vision model answers a
      // non-offer screenshot this way), is NOT a verdict. Hand it to the rules engine,
      // which answers from the pre-parse when there is one and NO DATA otherwise —
      // never a fabricated REJECT ("Reject. zero per mile, 0 miles.").
      if (phase1Result && phase1Response?.success) {
        const z = (v) => v == null || Number(v) === 0;
        const noRide = z(phase1Result.per_mile) && z(phase1Result.total_miles) && z(phase1Result.price);
        if (!phase1Result.decision || noRide) {
          console.warn(`[HOOKS] Phase 1 reply ${!phase1Result.decision ? 'has no decision' : 'describes no ride'} — deterministic engine answers`);
          phase1Result = deterministicPhase1();
        }
      }
    }

    // Vision path: the model identified the product (multi-tier prompt) — refine
    // the tier for the terse tags, Phase-2 context, and stored product_type.
    if (!phase1Result.product_type && typeof phase1Result.product === 'string' && phase1Result.product) {
      phase1Result.product_type = phase1Result.product;
    }
    const effectiveTier = (!text && phase1Result.product_type)
      ? classifyTier(phase1Result.product_type, ruleset)
      : tier;

    // ═══ VISION ARBITRATION (2026-08-17, Melody: "get vision working") ═══════
    // Code owns the arithmetic. The vision model both extracts and decides in one
    // call, and live cards showed its own $/mi wobbling across the driver's floor
    // (1.9 + 4.2 mi summed as ~6.3 → $1.34 vs the true $1.40 against a $1.35 floor
    // → wrong REJECT). So on the image-only path we recompute per_mile from the
    // extracted price/miles and re-run the deterministic engine on the extracted
    // numbers. Engine REJECT (floor / pickup / time / max-miles / ARP miss) can never
    // be rescued by anything the model saw — it wins. Engine ACCEPT beats a model
    // REJECT ONLY when the model did not name a judgment rule (judgment_reject in
    // the vision template: avoid area, road safety, Verified missing, stops, round
    // trip, share) — those are the model's to make. NO DATA from the engine (no
    // usable numbers) leaves the model's answer alone.
    if (!text && phase1Response?.success && phase1Result) {
      const n = (v) => { const x = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(x) ? x : null; };
      const mPrice = n(phase1Result.price);
      const mMiles = n(phase1Result.total_miles);
      const mMinutes = n(phase1Result.total_minutes);
      if (mPrice > 0 && mMiles > 0) phase1Result.per_mile = Math.round((mPrice / mMiles) * 100) / 100;
      const extracted = {
        price: mPrice,
        total_miles: mMiles,
        total_minutes: mMinutes,
        per_mile: n(phase1Result.per_mile),
        per_minute: (mPrice > 0 && mMinutes > 0) ? Math.round((mPrice / mMinutes) * 100) / 100 : null,
        pickup_miles: n(phase1Result.pickup_miles),
        pickup_minutes: n(phase1Result.pickup_minutes),
        rating: (() => { const r = n(phase1Result.rating ?? phase1Result.rider_rating); return r > 0 ? r : null; })(), // 0 = not shown
      };
      const judgment = typeof phase1Result.judgment_reject === 'string' ? phase1Result.judgment_reject.trim() : '';
      // Only arbitrate when the model actually extracted price + miles (else NO DATA territory).
      const engine = (mPrice > 0 && mMiles > 0)
        ? evaluateDeterministic(effectiveTier, extracted, ruleset)
        : { decision: 'NO DATA', reasonKind: 'no_data' };
      const modelDecision = phase1Result.decision;
      if (engine.decision === 'REJECT' && modelDecision === 'ACCEPT') {
        console.warn(`[HOOKS] Vision arbitration: engine REJECT (${engine.reasonKind}) overrides model ACCEPT`);
        phase1Result.decision = 'REJECT';
        phase1Result.reason = terseReason(engine.reasonKind, extracted.per_mile, mMiles.toFixed(1), effectiveTier);
        delete phase1Result.fallback;
      } else if (engine.decision === 'ACCEPT' && modelDecision === 'REJECT' && !judgment) {
        console.warn(`[HOOKS] Vision arbitration: engine ACCEPT (${engine.reasonKind}) overrides model REJECT with no judgment reason (model reason: ${phase1Result.reason || '-'})`);
        phase1Result.decision = 'ACCEPT';
        phase1Result.reason = terseReason(engine.reasonKind, extracted.per_mile, mMiles.toFixed(1), effectiveTier);
        if (engine.fallback) phase1Result.fallback = true; else delete phase1Result.fallback;
      } else if (engine.decision === 'ACCEPT' && modelDecision === 'ACCEPT' && engine.fallback && !phase1Result.fallback) {
        phase1Result.fallback = true; // ARP accept — label it honestly
      }
    }

    // Extract decision fields from normalized result
    const decision = phase1Result.decision || 'REJECT';
    // 2026-03-29: Accept both "reason" (new terse) and "reasoning" (legacy) field names
    let reason = phase1Result.reason || phase1Result.reasoning || '';
    const confidence = phase1Result.confidence || 0;

    const responseTimeMs = Date.now() - startTime;

    // 2026-03-29: Terse notification for 3s trip radar / 9s regular offers.
    // Format: "ACCEPT: $1.14 8.2mi core" or "REJECT: $0.78 14.0mi too far"
    // Server builds from pre-parsed data when AI reason is missing/verbose.
    // 2026-07-03: coerce model-sourced numerics — vision JSON can carry numbers
    // as strings ("1.14"), and .toFixed on a string threw a TypeError → 500,
    // violating the always-answer contract (adversarial review finding).
    const toNum = (v) => {
      const n = typeof v === 'string' ? parseFloat(v) : v;
      return Number.isFinite(n) ? n : null;
    };
    const perMileValue = toNum(preParsed?.per_mile ?? phase1Result.per_mile);
    const totalMi = toNum(preParsed?.total_miles ?? phase1Result.total_miles);
    // Keep the model-authored terse reason ("$1.34 6.1mi …") consistent with the recomputed
    // figure so voice and notification never disagree on the $/mi.
    if (!preParsed?.per_mile && perMileValue != null && typeof reason === 'string') {
      reason = reason.replace(/^\$\d+(?:\.\d{1,2})?(?=\s|\/|$)/, `$${perMileValue.toFixed(2)}`);
    }
    // 2026-07-03: renamed from `terseReason` — that const shadowed the module-level
    // terseReason() FUNCTION across this whole handler scope (temporal dead zone),
    // so the deterministic fallback crashed with a ReferenceError → 500 to Siri
    // exactly when it was needed. Confirmed live bug (ground-truth sweep 2026-07-03).
    const terseReasonText = reason || (perMileValue !== null && totalMi !== null
      ? `$${perMileValue.toFixed(2)} ${totalMi.toFixed(1)}mi`
      : '');

    // v3: ACCEPT (FALLBACK) label (spec: Acceptance Rate Protection) + observed
    // notices ("Verified Rider" / "Filter Detected" / "Deadhead Reduction Pickup").
    // The `decision` FIELD stays plain ACCEPT/REJECT/NO DATA — only display strings change.
    const isFallbackAccept = decision === 'ACCEPT' && phase1Result.fallback === true;
    const decisionLabel = isFallbackAccept ? 'ACCEPT (FALLBACK)' : decision;
    const noticesArr = Array.isArray(phase1Result.notices)
      ? phase1Result.notices.filter((n) => typeof n === 'string' && n.length <= 40).slice(0, 4)
      : [];
    // v3.1 (2026-08-17, Melody D4): optional $/hr readout — pay ÷ total minutes × 60,
    // computed here from the numbers we already trust (never asked of the model, never a
    // decider — hourly is telemetry per the 2026-08-11/14 doctrine). Rendered on the
    // notification and spoken as a short tail when the driver enabled it.
    let hourlyPhrase = null;
    if (ruleset.global?.notices?.hourly_rate) {
      const hrPrice = toNum(preParsed?.price ?? phase1Result.price);
      const hrMinutes = toNum(preParsed?.total_minutes ?? phase1Result.total_minutes);
      if (hrPrice > 0 && hrMinutes > 0 && decision !== 'NO DATA') {
        const perHour = Math.round((hrPrice / hrMinutes) * 60);
        noticesArr.push(`$${perHour}/hr`);
        hourlyPhrase = `about ${perHour} dollars an hour`;
      }
    }
    const notificationBase = terseReasonText
      ? `${decisionLabel}: ${terseReasonText}`
      : decisionLabel;
    const notification = noticesArr.length
      ? `${notificationBase} | ${noticesArr.join(' | ')}`
      : notificationBase;

    // ══════════════════════════════════════════════════════════════
    // RESPOND TO SIRI — driver is waiting, every ms counts
    // ══════════════════════════════════════════════════════════════
    // 2026-04-16: TTS line for Siri "Speak Text" — composes decision + spoken $/mi
    // + miles + optional reason qualifier. Uses formatPerMileForVoice() for the dollar
    // amount and falls back to a bare decision word when pre-parse data is unavailable.
    let voice = buildVoiceLine(decision, perMileValue, totalMi, terseReasonText);
    if (hourlyPhrase && perMileValue != null && totalMi != null) {
      voice = voice.replace(/\.$/, `, ${hourlyPhrase}.`);
    }

    res.json({
      success: true,
      voice,
      notification,
      decision,
      response_time_ms: responseTimeMs,
      // 2026-04-15: Phase-1 reason exposed independently from notification.
      // Same value embedded after the colon in `notification`, but available
      // standalone for Siri Shortcuts that speak decision + display reason
      // separately. For the no-data path this is 'no data'.
      reason: terseReasonText || '',
      // v3: observed notices (empty unless the driver enabled them in their rules).
      notices: noticesArr,
    });

    console.log(`[HOOKS] ⚡ Phase 1 responded in ${responseTimeMs}ms: ${decision} $${perMileValue || '?'}/mi [${effectiveTier}]`);

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
        const tierContext = `\nTIER: ${effectiveTier.toUpperCase()} (${phase1Result.product_type || preParsed?.product_type || 'unknown'}). Apply ${effectiveTier} rules above.`;
        // 2026-07-03: Phase-2 prompt rendered from the SAME ruleset as Phase 1
        // (rules-engine.buildPhase2Prompt) — per-driver rules govern the stored
        // reasoning too, not just what Siri speaks.
        const phase2System = buildPhase2Prompt(ruleset) + locationContext + tierContext + preParseBlock;

        const phase2UserMessage = text
          ? `Offer text: "${text}"`
          : 'Analyze this ride offer screenshot in detail.';

        // Phase 2 AI call — OFFER_ANALYZER_DEEP (Pro 3.1) for rich reasoning
        // 2026-02-28: 45s timeout — callGemini SDK has no built-in timeout, so we wrap with Promise.race
        // to prevent the async IIFE from hanging forever if Pro 3.1 is slow or unresponsive.
        const PHASE2_TIMEOUT_MS = 45000;
        console.log(`[HOOKS] 🔬 PHASE 2: Calling OFFER_ANALYZER_DEEP (Pro 3.1, ${PHASE2_TIMEOUT_MS / 1000}s timeout)...`);
        const phase2Start = Date.now();

        let deepResult = null;
        // 2026-06-11: derive from the model callModel ACTUALLY resolved (captures a Phase-1 503→flash
        // fallback too) instead of a hardcoded literal that silently lies after a fleet migration.
        // 2026-07-03: when the model never answered (timeout/failure), the deterministic
        // engine decided — record that honestly instead of naming a model that didn't run.
        let aiModelUsed = phase1Response?.model
          || (phase1Response?.success ? 'gemini-3.5-flash' : 'rules-engine-deterministic');
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
            const parsedDeep = parseModelJson(phase2Response.text, { unwrap: false }); // keep the envelope
            if (!parsedDeep.ok) throw new Error(`Phase 2 reply was not JSON (raw: ${JSON.stringify(String(phase2Response.text ?? '').slice(0, 240))})`); // 2026-08-17: snippet — Phase 1 already logs its raw text on parse-fail
            deepResult = parsedDeep.value;
            aiModelUsed = phase2Response.model || 'gemini-3.1-pro-preview'; // 2026-06-11: the model Phase 2 ACTUALLY ran (a 503 fallback correctly reports flash here)
            console.log(`[HOOKS] 🔬 PHASE 2 DONE (${Date.now() - phase2Start}ms): ai_model=${aiModelUsed}, decision=${deepResult.decision}`);
          } else {
            console.warn(`[HOOKS] Phase 2 AI call failed: ${phase2Response.error} — falling back to Phase 1 result`);
          }
        } catch (phase2Err) {
          console.warn(`[HOOKS] Phase 2 error: ${phase2Err.message} — falling back to Phase 1 result`);
        }

        // Use deep result for EXTRACTION, but the stored decision is what Siri
        // SPOKE (Phase 1 under the driver's rules). 2026-07-03: previously
        // deepResult.decision silently replaced it — the e2e run caught Phase 2
        // overriding a spoken time-limit REJECT with ACCEPT, which would make the
        // outcomes card show a recommendation that never happened. Deep dissent
        // is preserved as data (deep_decision + prefixed reasoning), not history.
        const dbParsedData = deepResult?.parsed_data || phase1Result;
        const dbDecision = decision;
        const deepDisagrees = deepResult?.decision != null && deepResult.decision !== decision;
        const dbReasoning = deepResult?.reasoning
          ? (deepDisagrees ? `[deep model dissents: ${deepResult.decision}] ${deepResult.reasoning}` : deepResult.reasoning)
          : reason;
        const dbConfidence = deepResult?.confidence ?? confidence; // ?? not || — a legit model confidence of 0 must survive
        const locationAnalysis = deepResult?.location_analysis || null;

        // Merge all parsed data for the raw JSON column
        const mergedParsedData = {
          ...(preParsed || {}),
          ...dbParsedData,
          per_mile: preParsed?.per_mile ?? dbParsedData?.per_mile,
          per_minute: preParsed?.per_minute ?? dbParsedData?.per_minute,
          location_analysis: locationAnalysis,
          // Phase-2's independent verdict — training signal, never the record.
          deep_decision: deepResult?.decision ?? null,
          deep_disagrees: deepDisagrees,
        };

        // 2026-02-17: Compute geographic columns
        const coordKeyValue = (lat && lng) ? coordsKey(lat, lng) : null;
        const h3Index = (lat && lng) ? latLngToCell(lat, lng, 8) : null;

        // ═══ TIMEZONE + CARD-ADDRESS GEOCODE ═════════════════════════════════════
        // 2026-04-16: FIX — temporal columns must reflect driver's local time, not UTC.
        // 2026-07-06 (Melody): NO NULLS, NO FALLBACKS — a row without real local-time
        // context poisons time-of-day analytics (Indiana incident). If nothing real
        // resolves, the row is NOT stored (we're post-response, fire-and-forget).
        // 2026-08-17 (Melody: "resolve the timezone from the offer['s] address — that is
        // the first address on the screen"): the canonical shortcuts send NO GPS (prod
        // audit 2026-08-17: 0 of 69 recent rows), so every stored row's timezone rode on
        // the driver's LAST APP SNAPSHOT — session-scoped, stale the moment they work
        // away from where they last opened the app. The pickup address (first address on
        // the card — parse contract, docs/OFFER_ANALYZER_DRIVER_RULESET.md) is
        // offer-scoped truth printed on every card. Ladder, freshest REAL evidence first:
        //   1. Offer's own GPS coords            → Google Timezone API
        //   2. Pickup address → Google Geocoding → Google Timezone API   [2026-08-17]
        //   3. Tokened driver's current SNAPSHOT row (GPS-resolved when the app was opened)
        //   4. Nothing real → the row is NOT stored.
        // Every path is coords → Google Timezone API (app_rules timezone-gps-only);
        // provenance lands in parsed_data_json.timezone_source ('gps' | 'pickup_address'
        // | 'snapshot'). All derivation goes through the shared/dayparts.js adapter (h23-safe).

        // Tokened driver's current app snapshot: (a) timezone source #3, (b) the ANCHOR
        // (geocode bias + Places distance gate) — but only while fresh: a snapshot older
        // than SNAPSHOT_ANCHOR_MAX_HOURS says nothing about where the driver is NOW, and
        // anchoring city-less card strings to it would fabricate coordinates near a place
        // they left (review finding 2026-08-17). Its timezone still serves as source #3
        // (Melody's 2026-07-06 ladder), just not as an anchor.
        const SNAPSHOT_ANCHOR_MAX_HOURS = 12;
        let snapshot = null; // { timezone, lat, lng, ageHours, fresh }
        if (userId) {
          try {
            const snapRes = await db.execute(sql`
              SELECT s.timezone, s.lat, s.lng, s.created_at
              FROM users u
              JOIN snapshots s ON s.snapshot_id = u.current_snapshot_id
              WHERE u.user_id = ${userId}
              LIMIT 1`);
            const row = snapRes.rows?.[0];
            if (row) {
              // created_at is the phone's clock (snapshot.js) — a device a minute ahead yields a
              // negative age; that is a FRESH snapshot, not a stale one (review 2026-08-17).
              const rawAge = row.created_at ? (Date.now() - new Date(row.created_at).getTime()) / 3600000 : null;
              const ageHours = Number.isFinite(rawAge) ? Math.max(0, rawAge) : null;
              snapshot = {
                timezone: row.timezone || null,
                lat: Number(row.lat), lng: Number(row.lng),
                ageHours,
                fresh: ageHours != null && ageHours <= SNAPSHOT_ANCHOR_MAX_HOURS,
              };
              if (!snapshot.fresh) console.log(`[HOOKS] Snapshot is ${ageHours == null ? 'undated' : `${ageHours.toFixed(1)}h old`} — timezone source only, not a geocode anchor`);
            }
          } catch (snapErr) {
            console.warn(`[HOOKS] Snapshot lookup failed (${snapErr.message}) — no snapshot timezone / geocode anchor`);
          }
        }

        // Geocode the card addresses ONCE: pickup coords feed timezone step 2, and both
        // feed the pickup/dropoff columns + geography audit in the INSERT below.
        // Placeholders ("Unknown", "not visible") never reach Google (usableOfferAddress) —
        // Places would happily return "Parts Unknown, Fort Worth" for "Unknown".
        // Bias toward the driver's GPS when sent, else their last snapshot: ~15% of live
        // pickup strings are city-less ("Terminal B, Departures: Zone 14") and Google's
        // `bounds` is a BIAS, never a restriction — "…, Denver" still resolves to Denver.
        const pickupAddr = usableOfferAddress(dbParsedData?.pickup);
        const dropoffAddr = usableOfferAddress(dbParsedData?.dropoff);
        if ((dbParsedData?.pickup && !pickupAddr) || (dbParsedData?.dropoff && !dropoffAddr)) {
          console.warn(`[HOOKS] Card address placeholder(s) skipped for geocoding (pickup="${dbParsedData?.pickup ?? ''}", dropoff="${dbParsedData?.dropoff ?? ''}")`);
        }
        // ANCHOR = the driver's last known position + how old that knowledge is: GPS (age 0)
        // else a fresh snapshot. It biases the geocoder and bounds what is physically plausible.
        const geoBias = (lat && lng) ? { lat, lng, ageHours: 0 }
          : (snapshot?.fresh && Number.isFinite(snapshot.lat) && Number.isFinite(snapshot.lng)) ? { lat: snapshot.lat, lng: snapshot.lng, ageHours: snapshot.ageHours }
          : null;
        // Every Google call on this path is bounded (review 2026-08-17): a hung request must
        // delay, never stall, the row — the fire-and-forget block has no outer timeout.
        const GOOGLE_CALL_TIMEOUT_MS = 8000;
        const bounded = () => AbortSignal.timeout(GOOGLE_CALL_TIMEOUT_MS);
        const geoOpts = { ...(geoBias ? { bias: { lat: geoBias.lat, lng: geoBias.lng, radius_mi: 60 } } : {}) };
        const [puGeo, drGeo] = await Promise.all([
          pickupAddr ? geocodeEventAddress(pickupAddr, undefined, undefined, { ...geoOpts, signal: bounded() }) : null,
          dropoffAddr ? geocodeEventAddress(dropoffAddr, undefined, undefined, { ...geoOpts, signal: bounded() }) : null,
        ]);

        // Resolve BOTH card addresses to at most one trusted point each (place_id + 6-decimal
        // coords), the way venues are resolved — resolveCardPoints (offer-address.js, unit-tested
        // with fakes; rules in OFFER_ANALYZER.md §10.6). A trust CLASS (whole-string match /
        // partial-inside-card-city) is never enough by itself: with an anchor every point must be
        // physically plausible (60 mi + 75 mph × anchor age — "Terminal E, Arrivals" → Boston is
        // refused even though Google called it exact), else the venue Places adapter around the
        // anchor (≤60 mi, kind + name must match the string); with NO anchor the pickup and
        // dropoff must corroborate each other (both city-confirmed, ≤60 mi apart), and Places is
        // never called. Otherwise text-only. Never a fabricated point.
        const PLACES_TRUST_RADIUS_MI = 60;
        const searchPlaces = (blat, blng, text) => searchPlaceWithTextSearch(blat, blng, text, { radius: 50000, signal: bounded() });
        const { pickup: pickupPoint, dropoff: dropoffPoint } = await resolveCardPoints({
          pickup: { address: pickupAddr, geo: puGeo },
          dropoff: { address: dropoffAddr, geo: drGeo },
          anchor: geoBias,
          searchPlaces,
          distanceMi: haversineDistanceMiles,
          nearMi: PLACES_TRUST_RADIUS_MI,
        });

        let driverTimezone = null;
        let timezoneSource = null;
        if (lat && lng) {
          try {
            driverTimezone = await resolveTimezoneFromCoords(lat, lng, { signal: bounded() });
            if (driverTimezone) timezoneSource = 'gps';
          } catch (tzErr) {
            console.warn(`[HOOKS] Coord timezone resolution failed (${tzErr.message}) — trying pickup address`);
          }
        }
        if (!driverTimezone && pickupPoint) {
          try {
            const puTz = await resolveTimezoneFromCoords(pickupPoint.lat, pickupPoint.lng, { signal: bounded() });
            if (puTz) {
              driverTimezone = puTz;
              timezoneSource = 'pickup_address';
              console.log(`[HOOKS] Timezone ${puTz} from pickup address ("${pickupAddr}" → ${pickupPoint.formatted_address}; via ${pickupPoint.via}, trust=${pickupPoint.trust}, corroborated by ${pickupPoint.corroboration}${pickupPoint.distance_mi != null ? ` at ${pickupPoint.distance_mi} mi` : ''})`);
              // Audit line, NOT a switch: the snapshot is GPS-truth for where the app was
              // LAST OPENED; the pickup is where THIS offer is. A trusted pickup in another
              // zone means the driver moved since (road trip) — visible here, not silent.
              if (snapshot?.timezone && snapshot.timezone !== puTz) {
                console.warn(`[HOOKS] Pickup-address timezone ${puTz} ≠ snapshot timezone ${snapshot.timezone} — storing the offer-scoped (pickup) value`);
              }
            }
          } catch (tzErr) {
            console.warn(`[HOOKS] Pickup-address timezone resolution failed (${tzErr.message}) — trying snapshot row`);
          }
        }
        if (!driverTimezone && snapshot?.timezone) {
          driverTimezone = snapshot.timezone;
          timezoneSource = 'snapshot';
          console.log('[HOOKS] Timezone from current snapshot row');
        }
        if (!driverTimezone) {
          console.error(
            `[HOOKS] ❌ No timezone derivable (coords: ${lat && lng ? 'present but API failed' : 'absent'}, ` +
            `pickup address: ${pickupAddr ? (pickupPoint ? 'resolved but Timezone API failed' : 'unresolvable (no trusted geocode/place)') : 'absent'}, ` +
            `user: ${userId ? 'tokened but no session snapshot' : 'un-tokened device'}) — offer NOT stored. ` +
            'No fallbacks: a row without real local-time context is bad waterfall data.'
          );
          return; // fire-and-forget scope — refuse the INSERT; the decision was already delivered
        }
        mergedParsedData.timezone_source = timezoneSource;

        const now = new Date();
        const localHour = getLocalHour(now, driverTimezone);
        const dayOfWeek = getLocalDow(now, driverTimezone);
        const dayPart = getDayPartKey(localHour);
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const localDate = getLocalDateString(now, driverTimezone);

        // 2026-02-17: Session tracking — group offers within 30-min windows.
        // 2026-08-11: chain by user_id when tokened (a driver may switch
        // phones), by device_id only for a REAL untokened device. Untokened
        // AND deviceless requests get a fresh session — previously they all
        // shared the literal 'anonymous_device' bucket, stitching different
        // drivers into one sequence and poisoning seconds_since_last.
        let offerSessionId = crypto.randomUUID();
        let offerSequenceNum = 1;
        let secondsSinceLast = null;

        try {
          const lastOfferResult = userId
            ? await db.execute(
                sql`SELECT offer_session_id, offer_sequence_num, created_at
                    FROM offer_intelligence
                    WHERE user_id = ${userId}
                    ORDER BY created_at DESC LIMIT 1`)
            : device_id
              ? await db.execute(
                  sql`SELECT offer_session_id, offer_sequence_num, created_at
                      FROM offer_intelligence
                      WHERE device_id = ${deviceId} AND user_id IS NULL
                      ORDER BY created_at DESC LIMIT 1`)
              : { rows: [] };
          const lastOffer = lastOfferResult.rows?.[0];
          if (lastOffer) {
            secondsSinceLast = Math.round((Date.now() - new Date(lastOffer.created_at).getTime()) / 1000);
            if (secondsSinceLast <= 1800 && lastOffer.offer_session_id) { // 30 min = same session
              offerSessionId = lastOffer.offer_session_id;
              offerSequenceNum = (lastOffer.offer_sequence_num || 0) + 1;
            }
          }
        } catch (seqErr) {
          console.warn(`[HOOKS] Session tracking failed (non-fatal): ${seqErr.message}`);
        }

        // 2026-07-03 (todo #10): the pings/patterns dataset — geography audit of the
        // resolved pickup/dropoff points against the driver's avoid rules. Vision said its
        // piece in Phase 1; geometry gets the audit row. Disagreements between the two
        // are exactly the training signal. Only TRUSTED, PRECISE points enter (resolveCardPoints):
        // live case 2026-08-17, an untrusted "Main St & 1st Ave" → West Haven, CT would
        // otherwise have produced a spurious geo_violated=true.
        // Only PRECISE points become coordinates / audit inputs (a locality centroid may source
        // the timezone above but is not a doorstep).
        const round6 = (n) => Math.round(n * 1000000) / 1000000;
        const pickupPt = pickupPoint?.precise ? { lat: round6(pickupPoint.lat), lng: round6(pickupPoint.lng) } : null;
        const dropPt = dropoffPoint?.precise ? { lat: round6(dropoffPoint.lat), lng: round6(dropoffPoint.lng) } : null;
        if ((pickupPoint && !pickupPt) || (dropoffPoint && !dropPt)) {
          console.log(`[HOOKS] Area-level point(s) kept out of coords/audit: ${[pickupPoint && !pickupPt ? `pickup → ${pickupPoint.formatted_address}` : null, dropoffPoint && !dropPt ? `dropoff → ${dropoffPoint.formatted_address}` : null].filter(Boolean).join('; ')}`);
        }
        if (pickupPt || dropPt) {
          const geoAudit = (ruleset.avoid || []).length
            ? evaluateGeoRules(ruleset, { pickup: pickupPt, dropoff: dropPt })
            : null;
          const geoViolated = geoAudit?.some((r) => r.result === 'violated') ?? false;
          Object.assign(mergedParsedData, {
            geo_audit: geoAudit,
            geo_violated: geoViolated,
            geo_disagreement: geoAudit ? (geoViolated && dbDecision === 'ACCEPT') : null,
          });
        } else if (pickupAddr || dropoffAddr) {
          console.warn(`[HOOKS] No trusted point for either card address (pickup="${pickupAddr || ''}", dropoff="${dropoffAddr || ''}") — stored as text only`);
        }
        // Resolution provenance for every stored row (audit + analytics filters).
        Object.assign(mergedParsedData, {
          pickup_place_id: pickupPoint?.place_id ?? null,
          dropoff_place_id: dropoffPoint?.place_id ?? null,
          pickup_geo_via: pickupPoint?.via ?? null,       // 'geocode' | 'places' | null
          pickup_geo_trust: pickupPoint?.trust ?? null,   // 'exact' | 'exact_near' | 'card_city' | 'places_near' | null
          pickup_geo_corroboration: pickupPoint?.corroboration ?? null, // 'anchor' | 'other_address'
          pickup_geo_precise: pickupPoint ? pickupPoint.precise : null,
          pickup_anchor_distance_mi: pickupPoint?.distance_mi ?? null,
          dropoff_geo_via: dropoffPoint?.via ?? null,
          dropoff_geo_trust: dropoffPoint?.trust ?? null,
          dropoff_geo_corroboration: dropoffPoint?.corroboration ?? null,
          dropoff_geo_precise: dropoffPoint ? dropoffPoint.precise : null,
          dropoff_anchor_distance_mi: dropoffPoint?.distance_mi ?? null,
          anchor_source: geoBias ? ((lat && lng) ? 'gps' : 'snapshot') : null,
          anchor_age_hours: geoBias ? Math.round((geoBias.ageHours ?? 0) * 10) / 10 : null,
          pickup_partial_match: puGeo ? puGeo.partial_match : null,   // raw Geocoding flags
          dropoff_partial_match: drGeo ? drGeo.partial_match : null,
          pickup_location_type: puGeo?.location_type ?? null,          // ROOFTOP … APPROXIMATE (a route/locality centroid is not a doorstep)
          dropoff_location_type: drGeo?.location_type ?? null,
        });

        // 2026-02-28: INSERT with Phase 2 deep data (or Phase 1 fallback)
        // ai_model records which model actually provided the stored analysis
        const inserted = await db.insert(offer_intelligence).values({
          device_id: deviceId,
          // 2026-07-03 (todo #10): identity + rules provenance. NULL user_id =
          // un-tokened legacy device; NULL ruleset_hash = defaults were applied.
          user_id: userId,
          ruleset_version: rulesetVersion,
          ruleset_hash: rulesetHash,

          // Offer metrics — prefer server pre-parsed (regex) over AI-parsed (LLM math).
          // 2026-07-03: vision-only requests have NO pre-parse, so every metric now
          // falls back to the vision extraction (Phase-2 deep, then Phase-1) —
          // previously total_minutes/pickup_miles/ride_miles stored NULL for the
          // exact modality that is becoming primary.
          price: toNum(preParsed?.price ?? dbParsedData?.price),
          per_mile: perMileValue,
          per_minute: toNum(preParsed?.per_minute ?? dbParsedData?.per_minute ?? phase1Result?.per_minute),
          hourly_rate: toNum(preParsed?.hourly_rate),
          surge: toNum(preParsed?.surge ?? dbParsedData?.surge),
          advantage_pct: toNum(preParsed?.advantage_pct),
          pickup_minutes: toNum(preParsed?.pickup_minutes ?? dbParsedData?.pickup_minutes ?? phase1Result?.pickup_minutes),
          pickup_miles: toNum(preParsed?.pickup_miles ?? dbParsedData?.pickup_miles ?? phase1Result?.pickup_miles),
          ride_minutes: toNum(preParsed?.ride_minutes ?? dbParsedData?.ride_minutes),
          ride_miles: toNum(preParsed?.ride_miles ?? dbParsedData?.ride_miles),
          total_miles: toNum(preParsed?.total_miles ?? dbParsedData?.miles ?? phase1Result?.total_miles),
          total_minutes: toNum(preParsed?.total_minutes ?? phase1Result?.total_minutes)
            ?? ((toNum(dbParsedData?.pickup_minutes) != null && toNum(dbParsedData?.ride_minutes) != null)
              ? toNum(dbParsedData.pickup_minutes) + toNum(dbParsedData.ride_minutes)
              : null),
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

          // Card addresses resolved above (trusted place_id + 6-decimal coords). 2026-08-17:
          // written in the INSERT (was a follow-up UPDATE) — the row is complete when pg_notify fires.
          pickup_lat: pickupPt?.lat ?? null,
          pickup_lng: pickupPt?.lng ?? null,
          dropoff_lat: dropPt?.lat ?? null,
          dropoff_lng: dropPt?.lng ?? null,
          geocoded_at: (pickupPt || dropPt) ? new Date() : null, // a TRUSTED point resolved (idx_oi_need_geocode stays true otherwise)

          // Temporal — 2026-04-16: now timezone-aware (was UTC)
          local_date: localDate,
          local_hour: localHour,
          day_of_week: dayOfWeek,
          day_part: dayPart,
          is_weekend: isWeekend,
          timezone: driverTimezone,

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
          raw_ai_response: phase2RawText || phase1Response?.text || null,
          parsed_data_json: mergedParsedData,
        }).returning({ id: offer_intelligence.id });
        const insertedId = inserted?.[0]?.id ?? null;

        console.log(`[HOOKS] Saved: ${dbDecision} (Phase1: ${responseTimeMs}ms, Phase2: ${Date.now() - phase2Start}ms) — $${mergedParsedData?.price || '?'} / ${mergedParsedData?.total_miles || mergedParsedData?.miles || '?'}mi = $${perMileValue || '?'}/mi [ai_model: ${aiModelUsed}] [tz: ${driverTimezone} via ${timezoneSource}] [points: pickup=${pickupPoint?.via ?? 'none'} dropoff=${dropoffPoint?.via ?? 'none'}${mergedParsedData.geo_audit ? ` geo_violated=${mergedParsedData.geo_violated}` : ''}]`);

        // SSE broadcast for web app
        const notifyPayload = JSON.stringify({
          device_id: deviceId,
          user_id: userId,
          offer_id: insertedId,
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
        console.error(`[HOOKS] Phase 2 background error: ${err.message}`);
      }
    })();

  } catch (error) {
    const responseTimeMs = Date.now() - startTime;
    console.error(`[HOOKS] Error (${responseTimeMs}ms):`, error.message);
    res.status(500).json({
      success: false,
      // 2026-04-16: TTS line for Siri — em-dash in notification doesn't speak well, so use period.
      voice: 'Analysis failed. Decide manually.',
      notification: 'Analysis failed — decide manually',
      error: error.message,
      response_time_ms: responseTimeMs,
      // 2026-04-15: Reason field present even on the failure path for shape
      // consistency with the success responses. Literal because terseReason is
      // unreachable here (the catch block can fire before it's computed).
      reason: 'analysis failed',
    });
  }
});

// GET /api/hooks/offer-history
// Recent offer analyses for the tokened driver (user-scoped since 2026-08-11)
router.get('/offer-history', offerHookLimiter, requireShortcutUser, async (req, res) => {
  try {
    const { limit = 20 } = req.query;
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
        ai_model: offer_intelligence.ai_model,        // 2026-06-11: surface the model that decided (telemetry verification)
        input_mode: offer_intelligence.input_mode,    // 2026-06-11: 'vision' | 'text'
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
      .where(sql`user_id = ${req.shortcutUserId}`)
      .orderBy(sql`created_at DESC`)
      .limit(maxLimit);

    // 2026-02-15: Compute aggregate stats for algorithm learning.
    // 2026-07-03: `accepted`/`rejected` count the ANALYZER's decisions, not the
    // driver's actions (the three-decisions rule, OFFER_ANALYZER.md §3). The keys
    // stay for backward compatibility; analyzer_* aliases make the meaning
    // explicit, and driver-actual outcomes live in /api/offer-analyzer/offers.
    const stats = {
      total: history.length,
      accepted: history.filter(h => h.decision === 'ACCEPT').length,
      rejected: history.filter(h => h.decision === 'REJECT').length,
      analyzer_accepted: history.filter(h => h.decision === 'ACCEPT').length,
      analyzer_rejected: history.filter(h => h.decision === 'REJECT').length,
      no_data: history.filter(h => h.decision === 'NO DATA').length,
      avg_response_ms: history.length > 0
        ? Math.round(history.reduce((sum, h) => sum + (h.response_time_ms || 0), 0) / history.length)
        : 0,
      avg_per_mile: history.length > 0
        ? Math.round(history.reduce((sum, h) => sum + (h.per_mile || 0), 0) / history.length * 100) / 100
        : 0,
    };

    res.json({
      success: true,
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
// (user-scoped since 2026-08-11: only the owning driver can override)
router.post('/offer-override', offerHookLimiter, requireShortcutUser, async (req, res) => {
  try {
    const { id, user_override } = req.body;

    if (!id || !user_override || !['ACCEPT', 'REJECT'].includes(user_override)) {
      return res.status(400).json({ error: 'Missing id or valid user_override (ACCEPT/REJECT)' });
    }

    const updated = await db.execute(
      sql`UPDATE offer_intelligence
          SET user_override = ${user_override}, updated_at = NOW()
          WHERE id = ${id} AND user_id = ${req.shortcutUserId}
          RETURNING id, decision, user_override`
    );

    if (updated.rows?.length === 0) {
      return res.status(404).json({ error: 'Offer not found or not owned by this driver' });
    }

    const record = updated.rows[0];
    console.log(`[hooks/offer-override] Override: AI said ${record.decision}, driver says ${user_override}`);

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
// (user-scoped since 2026-08-11: a device_id is not a credential)
router.post('/offer-cleanup', offerHookLimiter, requireShortcutUser, async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Missing ids array' });
    }

    if (ids.length > 50) {
      return res.status(400).json({ error: 'Max 50 IDs per request' });
    }

    const result = await db.execute(
      sql`DELETE FROM offer_intelligence WHERE id = ANY(${ids}) AND user_id = ${req.shortcutUserId} RETURNING id`
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
