// server/api/location/snapshot.js
import express, { Router } from 'express';
import crypto from "node:crypto";
import { db } from "../../db/drizzle.js";
import { sql, eq, and } from "drizzle-orm";
import { snapshots, coords_cache, users, rankings } from "../../../shared/schema.js";
import { validateSnapshotFields, validSnapshotDate, validSnapshotTimezone } from "../../util/validate-snapshot.js";
import { generateAndStoreBriefing } from "../../lib/briefing/briefing-aggregator.js";
// 2026-01-10: Use canonical coords-key module (consolidated from 4 duplicates)
import { makeCoordsKey } from "../../lib/location/coords-key.js";
// 2026-07-06: daypart adapter — never trust/store a client daypart string verbatim
import { normalizeDayPartKey, getDayPartKey, getLocalHour, getLocalDow, getLocalDateString, getLocalIso } from "../../lib/location/daypart.js";
// 2026-07-06: holiday detection lives in the briefing pipeline
// (server/lib/briefing/pipelines/holiday.js) — NOT at snapshot creation
// 2026-03-17: Moved import to top — now used by both POST and GET routes
import { requireAuth } from '../../middleware/auth.js';
import { normalizeCoordinates } from '../../../shared/coordinates.js';
import { latLngToCell } from 'h3-js';
import { resolveTimezoneFromMarket } from '../../lib/location/resolveTimezone.js';
import { getSnapshotReadiness } from '../../lib/location/snapshot-readiness.js';
import { snapshotEnvironment } from '../../lib/location/snapshot-environment.js';

const router = Router();

router.use(express.json({ limit: "1mb", strict: true }));

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

// 2026-01-14: validateSnapshotFields moved to shared module (server/util/validate-snapshot.js)
// Import above: import { validateSnapshotFields } from "../../util/validate-snapshot.js";

// 2026-03-17: SECURITY FIX (F-8) — Require authentication for snapshot creation.
// Previously unauthenticated, allowing anyone to create snapshots with arbitrary data.
router.post("/", requireAuth, async (req, res) => {
  const reqId = crypto.randomUUID();
  res.setHeader('x-req-id', reqId);

  const started = Date.now();

  try {
    const snap = req.body || {};

    // Direct extraction from request body
    const snapshot_id = snap.snapshot_id || uuid();
    const coords = normalizeCoordinates(snap.coord?.lat, snap.coord?.lng);
    if (!coords) return res.status(400).json({ ok: false, error: 'invalid_coordinates' });
    const { lat, lng } = coords;

    // ═══════════════════════════════════════════════════════════════════════════
    // LOCATION RESOLUTION: Get resolved address from coords_cache
    // 2026-01-10: Fixed comment - users table has NO location data (per SAVE-IMPORTANT.md)
    // Location authority is in snapshots table; coords_cache is fallback for resolution
    // NEVER send raw coords to strategists - they can't reverse geocode
    // ═══════════════════════════════════════════════════════════════════════════
    // Bind every location field to this exact resolved coordinate key. Client
    // labels, home market, or an earlier snapshot cannot change its identity.
    const coordKey = makeCoordsKey(lat, lng);
    const [cacheRow] = await db.select().from(coords_cache).where(eq(coords_cache.coord_key, coordKey)).limit(1);
    if (!cacheRow) return res.status(400).json({ ok: false, error: 'location_not_resolved', message: 'Resolve this location before creating a snapshot.' });
    const { city, state, country, formatted_address, timezone } = cacheRow;
    if (!validSnapshotTimezone(timezone)) return res.status(400).json({ ok: false, error: 'timezone_required' });
    if (snap.created_at !== undefined && !validSnapshotDate(snap.created_at)) {
      return res.status(400).json({ ok: false, error: 'invalid_created_at' });
    }
    const createdAtDate = new Date(Date.now());
    const hour = getLocalHour(createdAtDate, timezone);
    const dow = getLocalDow(createdAtDate, timezone);
    const day_part_key = getDayPartKey(hour);
    const local_iso = new Date(`${getLocalIso(createdAtDate, timezone)}Z`);
    const today = getLocalDateString(createdAtDate, timezone);
    let market = null;
    try {
      // This lookup supplies market identity only; timezone stays GPS-resolved.
      market = (await resolveTimezoneFromMarket(city, state, country))?.market_name ?? null;
    } catch (error) {
      console.error('[SNAPSHOT] Current market lookup failed; snapshot remains pending:', error.message);
    }

    // 2026-07-06: holiday detection moved to the briefing pipeline
    // (pipelines/holiday.js) — it runs with the COMPLETE snapshot row and a
    // model outage degrades the briefing with a recorded reason instead of
    // failing snapshot creation. The snapshot stays purely deterministic.

    let environment;
    try { environment = await snapshotEnvironment.both(lat, lng); }
    catch (error) {
      console.error('[SNAPSHOT] Verified environment unavailable:', error.message);
      return res.status(502).json({ ok: false, error: 'snapshot_environment_unavailable', message: 'Current weather and air quality are required. Retry for fresh data.' });
    }
    const dbSnapshot = {
      snapshot_id,
      // 2026-09-10 (found while verifying VP-007): this authenticated route wrote NULL-owned
      // rows, which the central ownership policy then rejects for everyone (orphans).
      user_id: req.auth.userId,
      created_at: createdAtDate,
      date: today,
      session_id: snap.session_id || uuid(),
      // Location coordinates
      lat: typeof lat === 'number' ? lat : null,
      lng: typeof lng === 'number' ? lng : null,
      // FK to coords_cache for location identity
      coord_key: coordKey,
      h3_r8: latLngToCell(lat, lng, 8),
      market,
      // Resolved address (source of truth from coords_cache)
      city: city || null,
      state: state || null,
      country: country || null,
      formatted_address: formatted_address || null,
      timezone: timezone || null,
      // Time context
      local_iso,
      dow: typeof dow === 'number' ? dow : null,
      hour: typeof hour === 'number' ? hour : null,
      day_part_key: day_part_key || null,
      // API data
      weather: environment.weather,
      air: environment.air,
      permissions: snap.permissions || null,
    };

    // 2026-04-28: pre-INSERT snapshot dump demoted to debug (memory 230 — chain
    // + snapshot ID locate the row; this object dump was repeating city/lat/lng
    // info already in the snapshot itself).
    if (String(process.env.LOG_LEVEL || 'info').toLowerCase() === 'debug') {
      console.log('[SNAPSHOT] [DB] [snapshots] INSERTING:', {
        lat: dbSnapshot.lat, lng: dbSnapshot.lng, city: dbSnapshot.city,
        timezone: dbSnapshot.timezone, hour: dbSnapshot.hour, dow: dbSnapshot.dow
      });
    }

    // Validate all required fields are present before INSERT (schema has NOT NULL constraints)
    validateSnapshotFields(dbSnapshot);
    const readiness = getSnapshotReadiness(dbSnapshot, snapshot_id, { requireStatus: false });
    dbSnapshot.status = readiness.ready ? 'ok' : 'pending';

    // Insert to DB
    await db.insert(snapshots).values(dbSnapshot);
    // 2026-09-10 (VP-007 / Astra P5b): precise lat/lng, the full address and the 6-decimal
    // coord_key no longer go to the normal log — agreement §15.8 (location payloads
    // become purpose clauses, not raw output). The row itself keeps the precision.
    console.log('[SNAPSHOT] SAVED TO DB:', { snapshot_id, city, state, timezone });

    // REMOVED: Placeholder strategy creation - strategy-generator-parallel.js creates the SINGLE strategy row
    // This prevents race conditions and ensures model_name attribution is preserved
    
    // Generate briefing data BEFORE responding (so data is ready when frontend queries)
    let briefingStatus = 'not_started';
    if (readiness.ready) {
      console.log(`[BRIEFING] starting`, { snapshot_id, city, state });
      // Pass the validated DB record itself (2026-09-10, VP-013 / Astra P1): the
      // former hand-built `fullSnapshot` literal used `hour || null` / `dow || null`,
      // which turned a stored midnight (hour 0) and Sunday (dow 0) into null on the
      // briefing handoff while the row kept the real value. One representation now —
      // the same object that passed validateSnapshotFields() and was inserted.
      try {
        const result = await generateAndStoreBriefing({ snapshotId: snapshot_id, snapshot: dbSnapshot });
        briefingStatus = result?.success === true && result?.complete === true ? 'complete' : 'failed';
        if (briefingStatus === 'complete') console.log('[BRIEFING] complete', { snapshot_id });
        else console.error('[BRIEFING] generation.failed', { snapshot_id });
      } catch (err) {
        briefingStatus = 'failed';
        console.error('[BRIEFING] generation.failed', { snapshot_id, err: String(err) });
      }
    }

    console.log('[SNAPSHOT] Saved', { snapshot_id, status: dbSnapshot.status, briefingStatus, city, timezone, hour, dow, ms: Date.now() - started });
    
    return res.status(201).json({ 
      ok: true, 
      snapshot_id,
      status: dbSnapshot.status,
      missing_fields: readiness.missingFields,
      briefing_status: briefingStatus,
      city,
      state,
      timezone,
      hour,
      dow,
      req_id: reqId 
    });
  } catch (err) {
    const msg = String(err && err.message || err);
    const code = err.code === 'SNAPSHOT_INCOMPLETE' || msg.startsWith("missing:") || msg.startsWith("invalid:") ? 400 : 500;
    console.warn("[SNAPSHOT] ERR", { msg, code, ms: Date.now() - started, req_id: reqId });
    return res.status(code).json({ ok: false, error: msg, req_id: reqId });
  }
});

// GET /:snapshotId - Fetch snapshot for Coach context (early engagement backup)
// Snapshot fields: city, state, weather (temp, condition), air (AQI), hour, dayPart, holiday, timezone, coordinates
// SECURITY: requireAuth enforces user must be signed in (GPS gating requires auth)
import { requireSnapshotOwnership } from '../../middleware/require-snapshot-ownership.js';

router.get("/:snapshotId", requireAuth, requireSnapshotOwnership, async (req, res) => {
  const { snapshotId } = req.params;
  
  if (!snapshotId) {
    return res.status(400).json({ ok: false, error: 'MISSING_SNAPSHOT_ID' });
  }
  
  try {
    const snapshot = await db.query.snapshots.findFirst({
      where: (t) => sql`${t.snapshot_id} = ${snapshotId}`,
    });
    
    if (!snapshot) {
      return res.status(404).json({ ok: false, error: 'SNAPSHOT_NOT_FOUND' });
    }
    
    // 2026-04-28: snapshot-fetch debug dump demoted; chain + snapshot ID
    // already locate the row, and this fired on every GET (noisy).
    if (String(process.env.LOG_LEVEL || 'info').toLowerCase() === 'debug') {
      console.log('[SNAPSHOT] GET fetched:', {
        snapshot_id: snapshot.snapshot_id, city: snapshot.city,
        weather: !!snapshot.weather, aqi: snapshot.air?.aqi ?? null,
        dayPart: snapshot.day_part_key
      });
    }
    
    // Return all snapshot fields for Coach context
    const readiness = getSnapshotReadiness(snapshot, snapshotId);
    // 2026-04-18: Include `status` so the client-side briefing readiness gate
    // (`useBriefingQueries` isEnabled check on snapshotStatus === 'ok') actually
    // works. Before today this field was silently omitted, which made the gate
    // permanently closed for every real (UUID) snapshot and froze the briefing
    // tab spinner forever. Root cause of the "briefing tab spins after login"
    // symptom per the UI audit on 2026-04-18.
    return res.json({
      snapshot_id: snapshot.snapshot_id,
      status: readiness.ready ? 'ok' : snapshot.status === 'ok' ? 'pending' : readiness.status,
      missing_fields: readiness.missingFields,
      city: snapshot.city,
      state: snapshot.state,
      country: snapshot.country,
      formatted_address: snapshot.formatted_address,
      timezone: snapshot.timezone,
      lat: snapshot.lat,
      lng: snapshot.lng,
      hour: snapshot.hour,
      dow: snapshot.dow,
      // 2026-07-06: normalize legacy keys on read (pre-rename rows); null only
      // if the stored value is corrupt, which the client treats as absent
      day_part_key: normalizeDayPartKey(snapshot.day_part_key),
      weather: snapshot.weather,
      air: snapshot.air,
      // 2026-01-14: airport_context dropped - now in briefings.airport_conditions
      // 2026-07-06: holiday dropped - now in briefings.holiday (aggregate endpoint)
      h3_r8: snapshot.h3_r8,
      created_at: snapshot.created_at?.toISOString()
    });
  } catch (err) {
    console.error('[SNAPSHOT] Error:', err);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR', message: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/snapshot/drop
// 2026-05-05: Drop the user's current snapshot (DELETE the row + null the pointer).
// Called by manual refresh and (in a follow-up) by logout. The DELETE cascades to
// briefings, events, traffic, ranking_candidates, etc. via onDelete:'cascade' FKs.
// On success, the next /location/resolve creates a fresh snapshot row → fires
// 'vecto-snapshot-saved' → existing observer triggers the waterfall.
// ═══════════════════════════════════════════════════════════════════════════
router.post('/drop', requireAuth, async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'no_auth', message: 'authenticated user required to drop snapshot' });
  }

  try {
    const userRow = await db.query.users.findFirst({ where: eq(users.user_id, userId) });
    const currentSnapshotId = userRow?.current_snapshot_id;

    if (!currentSnapshotId) {
      // Already in clean state — pointer null, nothing to drop. Idempotent success.
      return res.json({ ok: true, dropped: false, reason: 'no_current_snapshot' });
    }

    // 2026-05-05: rankings.snapshot_id FK lacked onDelete:'cascade', so rankings had to be
    // deleted first. 2026-09-13: migrations/20260913_schema_repair.sql adds the cascade; this
    // explicit delete is KEPT until that migration is confirmed applied to prod (todo #25) —
    // it is harmless once the cascade exists.
    await db.delete(rankings).where(eq(rankings.snapshot_id, currentSnapshotId));

    // DELETE the current snapshot; cascade handles all other dependent rows.
    // Scope to user_id as well so a stolen/forged snapshot_id can't delete another user's row.
    await db.delete(snapshots).where(
      and(eq(snapshots.snapshot_id, currentSnapshotId), eq(snapshots.user_id, userId))
    );

    // Null the pointer on users so the next resolve sees a clean slate.
    await db.update(users)
      .set({ current_snapshot_id: null, updated_at: new Date() })
      .where(eq(users.user_id, userId));

    console.log(`[SNAPSHOT] [DROP] user=${userId.slice(0, 8)} dropped snapshot=${currentSnapshotId.slice(0, 8)} (cascade)`);
    return res.json({ ok: true, dropped: true, snapshot_id: currentSnapshotId });
  } catch (err) {
    console.error('[SNAPSHOT] [DROP] error:', err);
    return res.status(500).json({ ok: false, error: 'drop_failed', message: String(err?.message || err) });
  }
});

export default router;
