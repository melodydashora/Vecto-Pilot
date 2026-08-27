// server/api/offer-analyzer/index.js
// 2026-07-03 (todo #10): Offer Analyzer editor API — per-driver rules, shortcut
// token (identity bridge), offers-with-outcomes, and the avoid-places picker.
// Doc: docs/architecture/OFFER_ANALYZER.md §12 (route contracts).
//
// All routes require Bearer auth (requireAuth → req.auth.userId). The PUBLIC
// ingest path stays in server/api/hooks/analyze-offer.js — nothing here widens
// that surface; the token minted here is what LINKS the public path to a user.

import { Router } from 'express';
import { db } from '../../db/drizzle.js';
import { sql } from 'drizzle-orm';
import { requireAuth } from '../../middleware/auth.js';
import { DEFAULT_RULESET, migrateRuleset } from '../../lib/offers/rules-engine.js';
import { validateRuleset } from '../../lib/offers/ruleset-schema.js';
import { hashRuleset, generateShortcutToken, invalidateUser } from '../../lib/offers/ruleset-store.js';

const router = Router();
router.use(requireAuth);

const OUTCOME_VALUES = ['Accepted', 'Rejected', 'Cancelled', 'Completed'];

// ── Rules ────────────────────────────────────────────────────────────────────

// GET /api/offer-analyzer/rules — my ruleset (migrated to v3) or the defaults.
router.get('/rules', async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT config, version, config_hash FROM offer_rulesets
      WHERE user_id = ${req.auth.userId} LIMIT 1
    `);
    const row = result.rows?.[0];
    if (!row) {
      return res.json({
        config: migrateRuleset(DEFAULT_RULESET),
        version: null,
        hash: null,
        is_default: true,
      });
    }
    return res.json({
      config: migrateRuleset(row.config),
      version: row.version,
      hash: row.config_hash,
      is_default: false,
    });
  } catch (err) {
    console.error('[offer-analyzer/rules GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/offer-analyzer/rules — validate strictly, upsert, bump version.
// This is the fail-loud write gate: an invalid config NEVER persists (OFFER_ANALYZER.md §7 fail posture).
// 2026-08-17 (race review finding #4): optimistic concurrency. The body may carry
// `expected_version` — the version the editor loaded (null = "no saved row yet").
// When present, the update applies ONLY if the stored version still matches;
// otherwise 409 with the current row so the client reloads instead of silently
// overwriting another tab's/device's save (last-write-wins was the old behavior).
// Absent (older clients / API callers) → unconditional, exactly as before.
// The response now returns the canonical stored config too, so the editor needs no
// second GET (whose form.reset() could clobber a slider moved during the round-trip).
router.put('/rules', async (req, res) => {
  try {
    const config = migrateRuleset(req.body?.config);
    const validation = validateRuleset(config);
    if (!validation.ok) {
      return res.status(422).json({ error: 'Invalid ruleset', details: validation.errors });
    }
    const hasExpectation = req.body != null && Object.prototype.hasOwnProperty.call(req.body, 'expected_version');
    const rawExpected = hasExpectation ? req.body.expected_version : undefined;
    // Strict: a JSON number that is a non-negative int4, or null. No coercion (true → 1,
    // "" → 0, [7] → 7 would all sneak through Number()); out-of-int4 would 500 at the cast.
    if (hasExpectation && rawExpected !== null
      && !(typeof rawExpected === 'number' && Number.isInteger(rawExpected) && rawExpected >= 0 && rawExpected <= 2147483647)) {
      return res.status(400).json({ error: 'expected_version must be a non-negative integer or null' });
    }
    const expectedVersion = hasExpectation && rawExpected !== null ? rawExpected : null;

    const hash = hashRuleset(validation.config);
    const configJson = JSON.stringify(validation.config);
    // IS NOT DISTINCT FROM: an expectation of null (client saw defaults) matches no
    // existing row → 409 if someone saved first; a stale integer likewise.
    const versionGuard = hasExpectation
      ? sql`offer_rulesets.version IS NOT DISTINCT FROM ${expectedVersion}::integer`
      : sql`TRUE`;
    const result = await db.execute(sql`
      INSERT INTO offer_rulesets (user_id, version, config, config_hash)
      VALUES (${req.auth.userId}, 1, ${configJson}::jsonb, ${hash})
      ON CONFLICT (user_id) DO UPDATE SET
        config = EXCLUDED.config,
        config_hash = EXCLUDED.config_hash,
        version = offer_rulesets.version + 1,
        updated_at = NOW()
      WHERE ${versionGuard}
      RETURNING version
    `);

    if (!result.rows?.length) {
      const current = await db.execute(sql`
        SELECT config, version, config_hash FROM offer_rulesets WHERE user_id = ${req.auth.userId} LIMIT 1
      `);
      const row = current.rows?.[0];
      console.warn(`[offer-analyzer] Rules save REJECTED (version conflict): user=${req.auth.userId} expected v${expectedVersion ?? 'none'}, stored v${row?.version ?? 'none'}`);
      return res.status(409).json({
        error: 'version_conflict',
        message: 'Your rules were changed elsewhere since this page loaded. Reload and re-apply your change.',
        current: row ? { config: migrateRuleset(row.config), version: row.version, hash: row.config_hash } : null,
      });
    }

    invalidateUser(req.auth.userId); // next Siri request on this instance sees the new rules
    const version = result.rows?.[0]?.version ?? 1;
    console.log(`[offer-analyzer] Rules saved: user=${req.auth.userId} v${version} ${hash.slice(0, 12)}`);
    res.json({ success: true, version, hash, config: validation.config });
  } catch (err) {
    console.error('[offer-analyzer/rules PUT]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Shortcut token (identity bridge) ─────────────────────────────────────────

// GET /api/offer-analyzer/shortcut-token — get-or-create my token.
router.get('/shortcut-token', async (req, res) => {
  try {
    const existing = await db.execute(sql`
      SELECT shortcut_token, shortcut_token_created_at, shortcut_device_label
      FROM driver_profiles WHERE user_id = ${req.auth.userId} LIMIT 1
    `);
    const row = existing.rows?.[0];
    if (!row) return res.status(404).json({ error: 'Driver profile not found' });

    if (row.shortcut_token) {
      return res.json({
        token: row.shortcut_token,
        created_at: row.shortcut_token_created_at,
        device_label: row.shortcut_device_label,
      });
    }

    // 2026-08-17 (race review): first-ever GET from two tabs used to mint two tokens —
    // the second UPDATE overwrote the first, leaving one displayed token dead. Mint
    // only into a still-NULL slot; if another request won, return what it minted.
    const token = generateShortcutToken();
    const minted = await db.execute(sql`
      UPDATE driver_profiles
      SET shortcut_token = ${token}, shortcut_token_created_at = NOW()
      WHERE user_id = ${req.auth.userId} AND shortcut_token IS NULL
      RETURNING shortcut_token, shortcut_token_created_at
    `);
    if (minted.rows?.length) {
      console.log(`[offer-analyzer] Shortcut token minted: user=${req.auth.userId}`);
      return res.json({ token, created_at: minted.rows[0].shortcut_token_created_at, device_label: null });
    }
    const winner = await db.execute(sql`
      SELECT shortcut_token, shortcut_token_created_at, shortcut_device_label
      FROM driver_profiles WHERE user_id = ${req.auth.userId} LIMIT 1
    `);
    const w = winner.rows?.[0];
    if (!w?.shortcut_token) return res.status(500).json({ error: 'token_mint_failed' });
    console.log(`[offer-analyzer] Shortcut token mint raced — returning the token another request minted: user=${req.auth.userId}`);
    res.json({ token: w.shortcut_token, created_at: w.shortcut_token_created_at, device_label: w.shortcut_device_label });
  } catch (err) {
    console.error('[offer-analyzer/shortcut-token GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/offer-analyzer/shortcut-token/regenerate — rotate (revoke lost device).
router.post('/shortcut-token/regenerate', async (req, res) => {
  try {
    const token = generateShortcutToken();
    const result = await db.execute(sql`
      UPDATE driver_profiles
      SET shortcut_token = ${token}, shortcut_token_created_at = NOW()
      WHERE user_id = ${req.auth.userId}
      RETURNING user_id
    `);
    if (!result.rows?.length) return res.status(404).json({ error: 'Driver profile not found' });

    invalidateUser(req.auth.userId); // the old token dies now, not at cache TTL
    console.log(`[offer-analyzer] Shortcut token ROTATED: user=${req.auth.userId}`);
    res.json({ token, created_at: new Date().toISOString() });
  } catch (err) {
    console.error('[offer-analyzer/shortcut-token/regenerate]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/offer-analyzer/shortcut-token/label — friendly device label (display only).
router.post('/shortcut-token/label', async (req, res) => {
  try {
    const label = typeof req.body?.label === 'string' ? req.body.label.slice(0, 80) : null;
    await db.execute(sql`
      UPDATE driver_profiles SET shortcut_device_label = ${label}
      WHERE user_id = ${req.auth.userId}
    `);
    res.json({ success: true, device_label: label });
  } catch (err) {
    console.error('[offer-analyzer/shortcut-token/label]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Offers + outcomes ────────────────────────────────────────────────────────

// GET /api/offer-analyzer/offers?limit= — my analyzed offers joined with my
// actual outcomes, plus stats that keep analyzer-vs-driver SEPARATE (the three-
// decisions rule, OFFER_ANALYZER.md §3: "accepted" never pretends the analyzer's ACCEPTs were taken).
router.get('/offers', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const result = await db.execute(sql`
      SELECT oi.id, oi.price, oi.per_mile, oi.total_miles, oi.total_minutes,
             oi.pickup_minutes, oi.pickup_miles, oi.pickup_address, oi.dropoff_address,
             oi.product_type, oi.platform, oi.surge, oi.decision, oi.decision_reasoning,
             oi.confidence_score, oi.input_mode, oi.user_override, oi.response_time_ms,
             oi.ruleset_version, oi.ruleset_hash, oi.created_at,
             -- v3.2 (2026-08-26): lane + provenance facts the Offers card renders (jsonb, no new columns)
             oi.parsed_data_json->>'offer_kind'      AS offer_kind,
             (oi.parsed_data_json->>'tip_included') IN ('true','t','1') AS tip_included,  -- tolerant: a legacy row could hold any json type
             oi.parsed_data_json->>'reason_kind'     AS reason_kind,
             oi.parsed_data_json->>'shortcut_system' AS shortcut_system,
             oo.id AS outcome_id, oo.driver_decision, oo.driver_reasoning,
             oo.actual_pay, oo.reimbursements, oo.extras, oo.other, oo.total_earned
      FROM offer_intelligence oi
      LEFT JOIN offer_outcomes oo ON oo.offer_intelligence_id = oi.id
      WHERE oi.user_id = ${req.auth.userId}
      ORDER BY oi.created_at DESC
      LIMIT ${limit}
    `);
    const offers = result.rows || [];

    const stats = {
      analyzed: offers.length,
      analyzer_accepted: offers.filter((o) => o.decision === 'ACCEPT').length,
      analyzer_rejected: offers.filter((o) => o.decision === 'REJECT').length,
      driver_accepted: offers.filter((o) => o.driver_decision === 'Accepted' || o.driver_decision === 'Completed').length,
      disagreements: offers.filter((o) =>
        o.driver_decision
        && ((o.decision === 'ACCEPT' && o.driver_decision === 'Rejected')
          || (o.decision === 'REJECT' && ['Accepted', 'Completed'].includes(o.driver_decision)))).length,
      // Realized dollars count only rides actually taken — earnings that linger
      // on a Rejected/Cancelled outcome row must not inflate the total.
      realized_total: Math.round(offers.reduce((sum, o) =>
        sum + (['Accepted', 'Completed'].includes(o.driver_decision) ? (Number(o.total_earned) || 0) : 0), 0) * 100) / 100,
    };

    res.json({ success: true, stats, offers });
  } catch (err) {
    console.error('[offer-analyzer/offers GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/offer-analyzer/offers/:id/outcome — record what I ACTUALLY did.
// "If I get a reject — I can tell our system I accepted it" (Melody, 2026-07-03).
router.post('/offers/:id/outcome', async (req, res) => {
  try {
    const offerId = req.params.id;
    const { driver_decision, driver_reasoning, actual_pay, reimbursements, extras, other } = req.body || {};

    if (driver_decision != null && !OUTCOME_VALUES.includes(driver_decision)) {
      return res.status(400).json({ error: `driver_decision must be one of ${OUTCOME_VALUES.join(', ')} or null` });
    }
    const num = (v) => (v == null || v === '' ? null : Number(v));
    for (const [k, v] of Object.entries({ actual_pay, reimbursements, extras, other })) {
      if (num(v) != null && (!Number.isFinite(num(v)) || num(v) < 0 || num(v) > 10000)) {
        return res.status(400).json({ error: `${k} must be a number between 0 and 10000` });
      }
    }

    // Ownership: the offer must be mine (user_id was stamped at ingest).
    const owned = await db.execute(sql`
      SELECT id FROM offer_intelligence
      WHERE id = ${offerId} AND user_id = ${req.auth.userId} LIMIT 1
    `);
    if (!owned.rows?.length) return res.status(404).json({ error: 'Offer not found for this user' });

    const result = await db.execute(sql`
      INSERT INTO offer_outcomes
        (user_id, offer_intelligence_id, driver_decision, driver_reasoning,
         actual_pay, reimbursements, extras, other, outcome_source)
      VALUES
        (${req.auth.userId}, ${offerId}, ${driver_decision ?? null}, ${driver_reasoning ?? null},
         ${num(actual_pay)}, ${num(reimbursements)}, ${num(extras)}, ${num(other)}, 'web_app')
      ON CONFLICT (offer_intelligence_id) WHERE offer_intelligence_id IS NOT NULL
      DO UPDATE SET
        driver_decision = EXCLUDED.driver_decision,
        driver_reasoning = EXCLUDED.driver_reasoning,
        actual_pay = EXCLUDED.actual_pay,
        reimbursements = EXCLUDED.reimbursements,
        extras = EXCLUDED.extras,
        other = EXCLUDED.other,
        updated_at = NOW()
      RETURNING id, driver_decision, total_earned
    `);

    const row = result.rows?.[0];
    console.log(`[offer-analyzer] Outcome: offer=${offerId} → ${row?.driver_decision ?? '(cleared)'} $${row?.total_earned ?? 0}`);
    res.json({ success: true, outcome: row });
  } catch (err) {
    console.error('[offer-analyzer/outcome POST]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Places picker (avoid-list editor) ────────────────────────────────────────

// Light per-user limiter: the picker fires on debounced keystrokes, not bursts.
const placesCalls = new Map(); // userId → { count, resetAt }
function placesLimited(userId) {
  const now = Date.now();
  const entry = placesCalls.get(userId);
  if (!entry || entry.resetAt < now) {
    placesCalls.set(userId, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count += 1;
  return entry.count > 20;
}

// GET /api/offer-analyzer/places/search?q= — Google Places Text Search (New),
// multi-result, biased toward the driver's home when known. Returns place_id +
// 6-decimal coords (determinism doctrine: exact keys, never name matching).
router.get('/places/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 3) return res.status(400).json({ error: 'Query must be at least 3 characters' });
    if (placesLimited(req.auth.userId)) return res.status(429).json({ error: 'Too many place searches — slow down' });

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'Places search unavailable (no GOOGLE_MAPS_API_KEY)' });

    // Bias toward home so "Denton" finds the driver's Denton, not another state's.
    const profile = await db.execute(sql`
      SELECT home_lat, home_lng FROM driver_profiles WHERE user_id = ${req.auth.userId} LIMIT 1
    `);
    const home = profile.rows?.[0];

    const body = { textQuery: q, maxResultCount: 5 };
    if (home?.home_lat != null && home?.home_lng != null) {
      body.locationBias = {
        circle: { center: { latitude: home.home_lat, longitude: home.home_lng }, radius: 50000 },
      };
    }

    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      console.warn(`[offer-analyzer/places] Places API ${response.status}`);
      return res.status(502).json({ error: 'Places search failed' });
    }

    const data = await response.json();
    const round6 = (n) => parseFloat(Number(n).toFixed(6));
    const results = (data.places || []).map((p) => ({
      place_id: p.id,
      label: p.displayName?.text || p.formattedAddress,
      formatted_address: p.formattedAddress,
      lat: p.location?.latitude != null ? round6(p.location.latitude) : null,
      lng: p.location?.longitude != null ? round6(p.location.longitude) : null,
      types: p.types || [],
    })).filter((p) => p.lat != null && p.lng != null);

    res.json({ success: true, results });
  } catch (err) {
    console.error('[offer-analyzer/places]', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
