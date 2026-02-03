// server/api/location/snapshot.js
import express, { Router } from 'express';
import crypto from "node:crypto";
import { db } from "../../db/drizzle.js";
import { sql, eq } from "drizzle-orm";
import { snapshots, strategies, coords_cache } from "../../../shared/schema.js";
import { generateStrategyForSnapshot } from "../../lib/strategy/strategy-generator.js";
import { validateIncomingSnapshot, validateSnapshotFields } from "../../util/validate-snapshot.js";
import { uuidOrNull } from "../../util/uuid.js";
import { generateAndStoreBriefing } from "../../lib/briefing/briefing-service.js";
import { httpError } from "../utils/http-helpers.js";
// 2026-01-10: Use canonical coords-key module (consolidated from 4 duplicates)
import { makeCoordsKey } from "../../lib/location/coords-key.js";

const router = Router();

router.use(express.json({ limit: "1mb", strict: true }));

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

// 2026-01-14: validateSnapshotFields moved to shared module (server/util/validate-snapshot.js)
// Import above: import { validateSnapshotFields } from "../../util/validate-snapshot.js";

function requireStr(v, name) {
  if (typeof v !== "string" || !v.trim()) throw new Error(`missing:${name}`);
  return v.trim();
}

router.post("/", async (req, res) => {
  const reqId = crypto.randomUUID();
  res.setHeader('x-req-id', reqId);

  const started = Date.now();

  try {
    const snap = req.body || {};

    // Direct extraction from request body
    const snapshot_id = snap.snapshot_id || uuid();
    const lat = snap.coord?.lat;
    const lng = snap.coord?.lng;

    // ═══════════════════════════════════════════════════════════════════════════
    // LOCATION RESOLUTION: Get resolved address from coords_cache
    // 2026-01-10: Fixed comment - users table has NO location data (per SAVE-IMPORTANT.md)
    // Location authority is in snapshots table; coords_cache is fallback for resolution
    // NEVER send raw coords to strategists - they can't reverse geocode
    // ═══════════════════════════════════════════════════════════════════════════
    let city = snap.resolved?.city;
    let state = snap.resolved?.state;
    let country = snap.resolved?.country;
    let formatted_address = snap.resolved?.formattedAddress;
    let timezone = snap.resolved?.timezone;
    let coordKey = null;

    // If resolved data missing from request, lookup coords_cache
    if ((!city || !formatted_address) && typeof lat === 'number' && typeof lng === 'number') {
      coordKey = coordKey || makeCoordsKey(lat, lng);
      console.log(`[snapshot] 🔍 Still missing resolved data, checking coords_cache for ${coordKey}`);
      try {
        const [cacheRow] = await db.select().from(coords_cache).where(eq(coords_cache.coord_key, coordKey)).limit(1);
        if (cacheRow) {
          city = city || cacheRow.city;
          state = state || cacheRow.state;
          country = country || cacheRow.country;
          formatted_address = formatted_address || cacheRow.formatted_address;
          timezone = timezone || cacheRow.timezone;
          console.log(`[snapshot] ✅ Got resolved data from coords_cache:`, {
            city, state, country, formatted_address, timezone
          });
        } else {
          console.error(`[snapshot] ❌ CRITICAL: coords_cache miss for ${coordKey} - location not resolved!`);
        }
      } catch (cacheLookupErr) {
        console.warn(`[snapshot] ⚠️ Coords cache lookup failed:`, cacheLookupErr.message);
      }
    }

    // Calculate coord_key if not already set
    if (!coordKey && typeof lat === 'number' && typeof lng === 'number') {
      coordKey = makeCoordsKey(lat, lng);
    }

    const hour = snap.time_context?.hour;
    const dow = snap.time_context?.dow;
    const day_part_key = snap.time_context?.day_part_key;
    const local_iso = snap.time_context?.local_iso;
    
    // Build DB record
    const createdAtDate = snap.created_at ? new Date(snap.created_at) : new Date();
    
    // Calculate "today" in the driver's local timezone (not server timezone)
    // This ensures Hawaii, Alaska, etc. get the correct date
    // NO FALLBACK - timezone is required for accurate date calculation
    if (!timezone) {
      console.error('[snapshot] ❌ Cannot create snapshot: timezone is required');
      return res.status(400).json({
        ok: false,
        error: 'timezone_required',
        message: 'Timezone must be provided in snapshot data'
      });
    }
    const driverTimezone = timezone;
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: driverTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = formatter.formatToParts(createdAtDate);
    const today = `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value}`;

    const dbSnapshot = {
      snapshot_id,
      created_at: createdAtDate,
      date: today,
      device_id: snap.device_id || uuid(),
      session_id: snap.session_id || uuid(),
      // Location coordinates
      lat: typeof lat === 'number' ? lat : null,
      lng: typeof lng === 'number' ? lng : null,
      // FK to coords_cache for location identity
      coord_key: coordKey,
      // Resolved address (source of truth from coords_cache)
      city: city || null,
      state: state || null,
      country: country || null,
      formatted_address: formatted_address || null,
      timezone: timezone || null,
      // Time context
      local_iso: local_iso ? new Date(local_iso) : null,
      dow: typeof dow === 'number' ? dow : null,
      hour: typeof hour === 'number' ? hour : null,
      day_part_key: day_part_key || null,
      // API data
      weather: snap.weather || null,
      air: snap.air || null,
      permissions: snap.permissions || null,
    };

    console.log('[snapshot] 🔥 INSERTING:', {
      lat: dbSnapshot.lat,
      lng: dbSnapshot.lng,
      city: dbSnapshot.city,
      timezone: dbSnapshot.timezone,
      hour: dbSnapshot.hour,
      dow: dbSnapshot.dow
    });

    // Validate all required fields are present before INSERT (schema has NOT NULL constraints)
    validateSnapshotFields(dbSnapshot);

    // Insert to DB
    await db.insert(snapshots).values(dbSnapshot);
    console.log('[snapshot] ✅ SAVED TO DB:', { snapshot_id, lat, lng, city, state, formatted_address, timezone, coord_key: coordKey });

    // REMOVED: Placeholder strategy creation - strategy-generator-parallel.js creates the SINGLE strategy row
    // This prevents race conditions and ensures model_name attribution is preserved
    
    // Generate briefing data BEFORE responding (so data is ready when frontend queries)
    if (lat && lng) {
      console.log(`[briefing] starting`, { snapshot_id, city, state });
      // Pass the full DB record (not individual fields) so all snapshot context is available
      // fullSnapshot uses already-validated timezone (validated above)
      const fullSnapshot = {
        snapshot_id,
        lat,
        lng,
        city: city || null,
        state: state || null,
        country: country || null,
        formatted_address: formatted_address || null,
        timezone: timezone,  // NO FALLBACK - validated above
        date: today,
        hour: hour || null,
        dow: dow || null,
        day_part_key: day_part_key || null,
        local_iso: local_iso || null
      };
      await generateAndStoreBriefing({
        snapshotId: snapshot_id,
        snapshot: fullSnapshot
      }).catch(err => {
        console.warn(`[briefing] generation.failed`, { snapshot_id, err: String(err) });
      });
      console.log(`[briefing] ✅ complete`, { snapshot_id });
    }

    // Fire-and-forget: enqueue triad planning; do NOT block the HTTP response
    // CRITICAL: Pass full snapshot to avoid redundant DB fetch - LLMs need formatted_address
    queueMicrotask(() => {
      try {
        console.log(`[triad] enqueue`, { snapshot_id, formatted_address });
        generateStrategyForSnapshot(snapshot_id, { snapshot: dbSnapshot }).catch(err => {
          console.warn(`[triad] enqueue.failed`, { snapshot_id, err: String(err) });
        });
      } catch (e) {
        console.warn(`[triad] enqueue.err`, { snapshot_id, err: String(e) });
      }
    });

    console.log("[snapshot] ✅ OK", { snapshot_id, city, timezone, hour, dow, ms: Date.now() - started });
    
    return res.status(201).json({ 
      ok: true, 
      snapshot_id,
      city,
      state,
      timezone,
      hour,
      dow,
      req_id: reqId 
    });
  } catch (err) {
    const msg = String(err && err.message || err);
    const code = msg.startsWith("missing:") || msg.startsWith("invalid:") ? 400 : 500;
    console.warn("[snapshot] ERR", { msg, code, ms: Date.now() - started, req_id: reqId });
    return res.status(code).json({ ok: false, error: msg, req_id: reqId });
  }
});

// GET /:snapshotId - Fetch snapshot for Coach context (early engagement backup)
// Snapshot fields: city, state, weather (temp, condition), air (AQI), hour, dayPart, holiday, timezone, coordinates
// SECURITY: requireAuth enforces user must be signed in (GPS gating requires auth)
import { requireAuth } from '../../middleware/auth.js';
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
    
    console.log('[snapshot-get]', {
      snapshot_id: snapshot.snapshot_id,
      city: snapshot.city,
      weather: !!snapshot.weather,
      aqi: snapshot.air?.aqi || null,
      dayPart: snapshot.day_part_key
    });
    
    // Return all snapshot fields for Coach context
    return res.json({
      snapshot_id: snapshot.snapshot_id,
      city: snapshot.city,
      state: snapshot.state,
      country: snapshot.country,
      formatted_address: snapshot.formatted_address,
      timezone: snapshot.timezone,
      lat: snapshot.lat,
      lng: snapshot.lng,
      hour: snapshot.hour,
      dow: snapshot.dow,
      day_part_key: snapshot.day_part_key,
      weather: snapshot.weather,
      air: snapshot.air,
      // 2026-01-14: airport_context dropped - now in briefings.airport_conditions
      holiday: snapshot.holiday,
      is_holiday: snapshot.is_holiday,
      h3_r8: snapshot.h3_r8,
      created_at: snapshot.created_at?.toISOString()
    });
  } catch (err) {
    console.error('[snapshot-get] Error:', err);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR', message: String(err) });
  }
});

export default router;
