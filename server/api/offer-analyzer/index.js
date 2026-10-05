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
import { migrateRuleset } from '../../lib/offers/rules-engine.js';
import { validateRuleset } from '../../lib/offers/ruleset-schema.js';
import { hashRuleset, generateShortcutToken, invalidateUser } from '../../lib/offers/ruleset-store.js';
import { parseOutcomeInput, offerPeriod } from '../../lib/offers/outcome-input.js';
import { initialRulesetFromProfile } from '../../lib/offers/profile-ruleset.js';
import { withDriverSettingsLock, MainRunAdmissionError } from '../../lib/main-run-admission.js';

const router = Router();
router.use(requireAuth);

function parseLocalDay(date, timezone) {
  if (typeof date !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('date must be a valid YYYY-MM-DD calendar date');
  }
  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw new Error('date must be a valid YYYY-MM-DD calendar date');
  }
  if (typeof timezone !== 'string' || timezone.length > 100) {
    throw new Error('timezone must be a valid IANA timezone');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(0);
  } catch {
    throw new Error('timezone must be a valid IANA timezone');
  }
  return { date, timezone };
}

function parseOfferListPage(query, daily) {
  const limit = query.limit === undefined ? (daily ? 100 : 25) : Number(query.limit);
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100
    || !Number.isSafeInteger(offset) || offset < 0 || offset > 2147483647) {
    throw new Error('limit must be 1–100 and offset must be a non-negative integer');
  }
  if (query.include_removed !== undefined && !['1', '0'].includes(query.include_removed)) {
    throw new Error('include_removed must be 1 or 0');
  }
  return { limit, offset, includeRemoved: query.include_removed === '1' };
}

function localDayBounds(day) {
  return sql`WITH day_bounds AS (
    SELECT (${day.date}::date::timestamp AT TIME ZONE ${day.timezone}) AS start_at,
      ((${day.date}::date + 1)::timestamp AT TIME ZONE ${day.timezone}) AS end_at
  )`;
}


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
      const profiles = await db.execute(sql`
        SELECT pref_shared, max_deadhead_mi FROM driver_profiles
        WHERE user_id = ${req.auth.userId} LIMIT 1
      `);
      const { config, sourceFields } = initialRulesetFromProfile(profiles.rows?.[0]);
      return res.json({
        config,
        version: null,
        hash: hashRuleset(config),
        is_default: true,
        source: sourceFields.length ? 'profile' : 'defaults',
        source_fields: sourceFields,
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
// An expected version is required; an older client must reload before saving.
// The response now returns the canonical stored config too, so the editor needs no
// second GET (whose form.reset() could clobber a slider moved during the round-trip).
router.put('/rules', async (req, res) => {
  try {
    const supplied = req.body?.config;
    // Migration fills older rules' missing fields and also supplies defaults
    // for absent input. At the write boundary, absent/malformed rules must not
    // reset the driver's choices or advance the saved revision.
    if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied) ||
        !supplied.global || typeof supplied.global !== 'object' || Array.isArray(supplied.global)) {
      return res.status(422).json({ error: 'Invalid ruleset', details: ['config: a rules object with a global rules object is required'] });
    }
    // Both fields belong to the original global contract. Older versions may
    // omit newer fields, basis or tiers; an empty core is not a saved decision.
    if (!Object.hasOwn(supplied.global, 'rating_floor') || !Object.hasOwn(supplied.global, 'require_verified')) {
      return res.status(422).json({ error: 'Invalid ruleset', details: ['config.global: rating_floor and require_verified are required'] });
    }
    const config = migrateRuleset(supplied);
    const validation = validateRuleset(config);
    if (!validation.ok) {
      return res.status(422).json({ error: 'Invalid ruleset', details: validation.errors });
    }
    const hasExpectation = req.body != null && Object.prototype.hasOwnProperty.call(req.body, 'expected_version');
    if (!hasExpectation) return res.status(400).json({ error: 'rules_version_required', message: 'Reload saved rules before saving changes.' });
    const rawExpected = hasExpectation ? req.body.expected_version : undefined;
    // Strict: a JSON number that is a non-negative int4, or null. No coercion (true → 1,
    // "" → 0, [7] → 7 would all sneak through Number()); out-of-int4 would 500 at the cast.
    if (hasExpectation && rawExpected !== null
      && !(typeof rawExpected === 'number' && Number.isInteger(rawExpected) && rawExpected >= 1 && rawExpected < 2147483647)) {
      return res.status(400).json({ error: 'expected_version must be a positive integer or null' });
    }
    const expectedVersion = hasExpectation && rawExpected !== null ? rawExpected : null;

    const hash = hashRuleset(validation.config);
    const configJson = JSON.stringify(validation.config);
    // IS NOT DISTINCT FROM: an expectation of null (client saw defaults) matches no
    // existing row → 409 if someone saved first; a stale integer likewise.
    const versionGuard = hasExpectation
      ? sql`offer_rulesets.version IS NOT DISTINCT FROM ${expectedVersion}::integer`
      : sql`TRUE`;
    const result = await withDriverSettingsLock(req.auth, async tx => {
      const current = await tx.execute(sql`SELECT version FROM offer_rulesets WHERE user_id = ${req.auth.userId} LIMIT 1`);
      if ((current.rows?.[0]?.version ?? null) !== expectedVersion) return { rows: [] };
      return tx.execute(sql`
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
    });

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
    if (err instanceof MainRunAdmissionError) return res.status(err.status).json({ error: err.code, message: err.message, ...err.details });
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

// Counts cover every owned offer received in the rolling [start, end) window.
// They are intentionally independent of the latest-25 editor list and its LIMIT.
router.get('/offers/stats', async (req, res) => {
  let day = null;
  let period;
  try {
    if (req.query.date !== undefined || req.query.timeZone !== undefined) {
      day = parseLocalDay(req.query.date, req.query.timeZone);
      period = { key: 'day', label: day.date, date: day.date, timeZone: day.timezone };
    } else {
      period = offerPeriod(req.query.period);
    }
  }
  catch (error) { return res.status(400).json({ error: error.message }); }
  try {
    const result = await db.execute(sql`
      ${day ? localDayBounds(day) : sql`WITH day_bounds AS (
        SELECT ${period.start}::timestamptz AS start_at, ${period.end}::timestamptz AS end_at
      )`}
      SELECT count(oi.id)::integer AS analyzed,
        count(*) FILTER (WHERE oi.decision = 'ACCEPT')::integer AS analyzer_accepted,
        count(*) FILTER (WHERE oi.decision = 'REJECT')::integer AS analyzer_rejected,
        count(*) FILTER (WHERE oi.decision = 'NO DATA')::integer AS analyzer_no_data,
        count(*) FILTER (WHERE oo.driver_decision IN ('Accepted', 'Completed'))::integer AS driver_accepted,
        count(*) FILTER (WHERE oo.driver_decision = 'Rejected')::integer AS driver_rejected,
        count(*) FILTER (WHERE oo.driver_decision = 'Cancelled')::integer AS cancelled,
        count(*) FILTER (WHERE oo.driver_decision = 'Other')::integer AS other,
        count(*) FILTER (WHERE oi.id IS NOT NULL AND oo.driver_decision IS NULL)::integer AS unrecorded,
        count(*) FILTER (WHERE oo.driver_decision IN ('Accepted', 'Completed') AND
          (oo.actual_pay IS NOT NULL OR oo.reimbursements IS NOT NULL OR oo.extras IS NOT NULL OR oo.other IS NOT NULL))::integer AS reported_count,
        coalesce(round(sum(CASE WHEN oo.driver_decision IN ('Accepted', 'Completed') THEN oo.total_earned ELSE 0 END)::numeric, 2), 0)::double precision AS reported_total,
        bounds.start_at, bounds.end_at
      FROM day_bounds bounds
      LEFT JOIN offer_intelligence oi ON oi.user_id = ${req.auth.userId}
        AND oi.removed_at IS NULL
        AND oi.created_at >= bounds.start_at AND oi.created_at < bounds.end_at
      LEFT JOIN offer_outcomes oo ON oo.offer_intelligence_id = oi.id AND oo.user_id = oi.user_id
      GROUP BY bounds.start_at, bounds.end_at
    `);
    if (!result.rows?.[0]) throw new Error('Offer summary was not returned');
    res.set('Cache-Control', 'private, no-store');
    const row = result.rows[0];
    res.json({
      success: true,
      ...(day ? { date: day.date, timeZone: day.timezone } : {}),
      period: day ? { ...period, start: row.start_at, end: row.end_at } : period,
      stats: {
        analyzed: row.analyzed,
        analyzer_accepted: row.analyzer_accepted,
        analyzer_rejected: row.analyzer_rejected,
        analyzer_no_data: row.analyzer_no_data,
        driver_accepted: row.driver_accepted,
        driver_rejected: row.driver_rejected,
        cancelled: row.cancelled,
        other: row.other,
        unrecorded: row.unrecorded,
        reported_count: row.reported_count,
        reported_total: row.reported_total,
      },
    });
  } catch (error) {
    console.error('[offer-analyzer/offers stats GET]', error.message);
    res.status(500).json({ error: 'Could not load offer statistics' });
  }
});

// GET /api/offer-analyzer/offers?date=YYYY-MM-DD&timeZone=IANA&include_removed=1
// A selected local day returns all matching offers. The legacy request continues
// to return the newest 25 by default, with optional bounded pagination.
router.get('/offers', async (req, res) => {
  try {
    const hasDayParameter = req.query.date !== undefined || req.query.timeZone !== undefined;
    const day = hasDayParameter ? parseLocalDay(req.query.date, req.query.timeZone) : null;
    const { limit, offset, includeRemoved } = parseOfferListPage(req.query, !!day);
    const dayFilter = day ? sql`AND oi.created_at >= (${day.date}::date::timestamp AT TIME ZONE ${day.timezone})
      AND oi.created_at < ((${day.date}::date + 1)::timestamp AT TIME ZONE ${day.timezone})` : sql``;
    const removedFilter = includeRemoved ? sql`` : sql`AND oi.removed_at IS NULL`;
    const conditions = sql`oi.user_id = ${req.auth.userId} ${dayFilter} ${removedFilter}`;
    // A complete local day needs only one read. A separate count can race an
    // arriving/removing offer and contradict the list's completeness contract.
    const countResult = day ? null : await db.execute(sql`
      SELECT count(*)::integer AS total FROM offer_intelligence oi WHERE ${conditions}
    `);
    const result = await db.execute(sql`
      SELECT oi.id, oi.price, oi.per_mile, oi.total_miles, oi.total_minutes,
             oi.pickup_minutes, oi.pickup_miles, oi.pickup_address, oi.dropoff_address,
             oi.product_type, oi.platform, oi.surge, oi.decision, oi.decision_reasoning,
             oi.confidence_score, oi.input_mode, oi.user_override, oi.response_time_ms,
             oi.ruleset_version, oi.ruleset_hash, oi.created_at, oi.removed_at, oi.removal_revision,
             -- v3.2 (2026-08-26): lane + provenance facts the Offers card renders (jsonb, no new columns)
             oi.parsed_data_json->>'offer_kind'      AS offer_kind,
             (oi.parsed_data_json->>'tip_included') IN ('true','t','1') AS tip_included,  -- tolerant: a legacy row could hold any json type
             oi.parsed_data_json->>'reason_kind'     AS reason_kind,
             oi.parsed_data_json->>'shortcut_system' AS shortcut_system,
             oo.id AS outcome_id, oo.revision AS outcome_revision, oo.driver_decision, oo.driver_reasoning,
             oo.actual_pay, oo.reimbursements, oo.extras, oo.other, oo.total_earned,
             -- Preserve Claude f09e8d58's timestamp contract without losing PG microseconds in JS Date.
             to_char(oo.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS outcome_updated_at
      FROM offer_intelligence oi
      LEFT JOIN offer_outcomes oo ON oo.offer_intelligence_id = oi.id AND oo.user_id = oi.user_id
      WHERE ${conditions}
      ORDER BY oi.created_at DESC, oi.id DESC
      ${day ? sql`` : sql`LIMIT ${limit} OFFSET ${offset}`}
    `);
    const offers = result.rows || [];
    const total = day ? offers.length : (countResult.rows?.[0]?.total ?? 0);
    const activeOffers = offers.filter((offer) => offer.removed_at == null);

    const stats = {
      analyzed: activeOffers.length,
      analyzer_accepted: activeOffers.filter((o) => o.decision === 'ACCEPT').length,
      analyzer_rejected: activeOffers.filter((o) => o.decision === 'REJECT').length,
      driver_accepted: activeOffers.filter((o) => o.driver_decision === 'Accepted' || o.driver_decision === 'Completed').length,
      disagreements: activeOffers.filter((o) =>
        o.driver_decision
        && ((o.decision === 'ACCEPT' && o.driver_decision === 'Rejected')
          || (o.decision === 'REJECT' && ['Accepted', 'Completed'].includes(o.driver_decision)))).length,
      // Realized dollars count only rides actually taken — earnings that linger
      // on a Rejected/Cancelled outcome row must not inflate the total.
      realized_total: Math.round(activeOffers.reduce((sum, o) =>
        sum + (['Accepted', 'Completed'].includes(o.driver_decision) ? (Number(o.total_earned) || 0) : 0), 0) * 100) / 100,
    };

    res.set('Cache-Control', 'private, no-store');
    res.json({
      success: true,
      stats,
      offers,
      ...(day ? {
        date: day.date,
        timeZone: day.timezone,
        total,
        include_removed: includeRemoved,
      } : {
        total,
        limit,
        offset,
        has_more: offset + offers.length < total,
      }),
    });
  } catch (err) {
    if (err instanceof Error && (err.message.startsWith('date must') || err.message.startsWith('timezone must')
      || err.message.startsWith('limit must') || err.message.startsWith('include_removed'))) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[offer-analyzer/offers GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Soft removal preserves the raw capture and any separately recorded outcome.
// Monotonic revisions serialize remove/restore actions and make stale Undo safe.
for (const action of ['remove', 'restore']) {
  router.post(`/offers/:id/${action}`, async (req, res) => {
    const offerId = req.params.id;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(offerId)) {
      return res.status(400).json({ error: 'A valid offer ID is required' });
    }
    const expectedRevision = req.body?.expected_removal_revision;
    if (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision)
      || expectedRevision < 0 || expectedRevision >= 2147483647) {
      return res.status(400).json({ error: 'expected_removal_revision must be the loaded non-negative integer revision' });
    }
    try {
      const statePredicate = action === 'remove' ? sql`removed_at IS NULL` : sql`removed_at IS NOT NULL`;
      const removedValue = action === 'remove' ? sql`NOW()` : sql`NULL`;
      const updated = await db.execute(sql`
        UPDATE offer_intelligence
        SET removed_at = ${removedValue}, removal_revision = removal_revision + 1
        WHERE id = ${offerId} AND user_id = ${req.auth.userId}
          AND removal_revision = ${expectedRevision} AND ${statePredicate}
        RETURNING id, removed_at, removal_revision
      `);
      res.set('Cache-Control', 'private, no-store');
      if (updated.rows?.[0]) return res.json({ success: true, offer: updated.rows[0] });

      const owned = await db.execute(sql`
        SELECT id, removed_at, removal_revision FROM offer_intelligence
        WHERE id = ${offerId} AND user_id = ${req.auth.userId} LIMIT 1
      `);
      if (!owned.rows?.[0]) return res.status(404).json({ error: 'Offer not found for this user' });
      return res.status(409).json({
        error: 'removal_conflict',
        message: 'This offer changed elsewhere. Review its current removal state before retrying.',
        current: owned.rows[0],
      });
    } catch (_error) {
      return res.status(500).json({ error: 'Could not update this offer. Its removal state was not confirmed.' });
    }
  });
}

// POST /api/offer-analyzer/offers/:id/outcome — record what I ACTUALLY did.
// "If I get a reject — I can tell our system I accepted it" (Melody, 2026-07-03).
router.post('/offers/:id/outcome', async (req, res) => {
  const offerId = req.params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(offerId)) {
    return res.status(400).json({ error: 'A valid offer ID is required' });
  }
  let input;
  try { input = parseOutcomeInput(req.body); }
  catch (error) { return res.status(400).json({ error: error.code || error.message, message: error.message }); }
  try {
    const { fields, expectedRevision, expectedUpdatedAt, versionKind, expectsNew } = input;
    const supplied = key => Object.hasOwn(fields, key);
    const owned = await db.execute(sql`
      SELECT id FROM offer_intelligence
      WHERE id = ${offerId} AND user_id = ${req.auth.userId} LIMIT 1
    `);
    if (!owned.rows?.length) return res.status(404).json({ error: 'Offer not found for this user' });
    // The conflict guard and field updates are one statement. A new outcome can
    // only insert with a null expectation; an existing one updates at its exact
    // revision. Decision-only changes never replay stale earnings or notes.
    const decision = sql`CASE WHEN ${supplied('driver_decision')} THEN EXCLUDED.driver_decision ELSE offer_outcomes.driver_decision END`;
    const earnings = key => sql`CASE WHEN (${decision}) IN ('Accepted', 'Completed')
      THEN CASE WHEN ${supplied(key)} THEN ${sql.raw(`EXCLUDED.${key}`)} ELSE ${sql.raw(`offer_outcomes.${key}`)} END
      ELSE NULL END`; // key is selected only from the four fixed calls below.
    const matchesVersion = alias => versionKind === 'revision'
      ? sql`${sql.raw(`${alias}.revision`)} = ${expectedRevision}::integer`
      : sql`${sql.raw(`${alias}.updated_at`)} = ${expectedUpdatedAt}::timestamptz`;
    const result = await db.execute(sql`
      INSERT INTO offer_outcomes
        (user_id, offer_intelligence_id, driver_decision, driver_reasoning,
         actual_pay, reimbursements, extras, other, outcome_source)
      SELECT ${req.auth.userId}, oi.id, ${fields.driver_decision ?? null}, ${fields.driver_reasoning ?? null},
        ${fields.actual_pay ?? null}, ${fields.reimbursements ?? null}, ${fields.extras ?? null}, ${fields.other ?? null}, 'web_app'
      FROM offer_intelligence oi WHERE oi.id = ${offerId} AND oi.user_id = ${req.auth.userId}
        AND (${expectsNew} OR EXISTS (
          SELECT 1 FROM offer_outcomes current WHERE current.offer_intelligence_id = oi.id
            AND current.user_id = ${req.auth.userId} AND ${matchesVersion('current')}
        ))
      ON CONFLICT (offer_intelligence_id) WHERE offer_intelligence_id IS NOT NULL
      DO UPDATE SET
        driver_decision = ${decision},
        driver_reasoning = CASE WHEN ${supplied('driver_reasoning')} THEN EXCLUDED.driver_reasoning ELSE offer_outcomes.driver_reasoning END,
        actual_pay = ${earnings('actual_pay')}, reimbursements = ${earnings('reimbursements')},
        extras = ${earnings('extras')}, other = ${earnings('other')},
        revision = offer_outcomes.revision + 1, updated_at = NOW()
      WHERE offer_outcomes.user_id = ${req.auth.userId} AND ${matchesVersion('offer_outcomes')}
        AND (${!['actual_pay', 'reimbursements', 'extras', 'other'].some(key => supplied(key) && fields[key] !== null)}
          OR (${decision}) IN ('Accepted', 'Completed'))
      RETURNING id, offer_intelligence_id, revision, driver_decision, driver_reasoning,
        actual_pay, reimbursements, extras, other, total_earned,
        to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
    `);
    const row = result.rows?.[0];
    res.set('Cache-Control', 'private, no-store');
    if (!row) {
      const current = await db.execute(sql`SELECT id, offer_intelligence_id, revision, driver_decision,
        driver_reasoning, actual_pay, reimbursements, extras, other, total_earned,
        to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
        FROM offer_outcomes WHERE offer_intelligence_id = ${offerId} AND user_id = ${req.auth.userId} LIMIT 1`);
      const canonical = current.rows?.[0] ?? null;
      return res.status(409).json({ error: 'outcome_conflict', message: 'This outcome changed elsewhere. Review the saved version before editing again.', current: canonical, outcome: canonical });
    }
    res.json({ success: true, outcome: row });
  } catch (_error) {
    res.status(500).json({ error: 'Could not save the outcome. Your entries have not been confirmed.' });
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
