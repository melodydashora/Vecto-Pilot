// server/routes/snapshot.js
import express, { Router } from 'express';
import crypto from "node:crypto";
import { db } from "../db/drizzle.js";
import { sql, eq } from "drizzle-orm";
import { snapshots, strategies, users } from "../../shared/schema.js";
import { generateStrategyForSnapshot } from "../lib/strategy-generator.js";
import { validateIncomingSnapshot } from "../util/validate-snapshot.js";
import { uuidOrNull } from "../util/uuid.js";

const router = Router();

// Helper for consistent error responses with correlation ID
function httpError(res, status, code, message, reqId, extra = {}) {
  return res.status(status).json({ ok: false, error: code, message, req_id: reqId, ...extra });
}

router.use(express.json({ limit: "1mb", strict: true }));

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function requireStr(v, name) {
  if (typeof v !== "string" || !v.trim()) throw new Error(`missing:${name}`);
  return v.trim();
}

router.post("/", async (req, res) => {
  const reqId = crypto.randomUUID();
  res.setHeader('x-req-id', reqId);
  
  console.log("[snapshot] handler ENTER", { url: req.originalUrl, req_id: reqId });
  console.log("[snapshot] ❌ FULL REQUEST BODY:", JSON.stringify(req.body).substring(0, 1000));
  console.log("[snapshot] Body keys:", Object.keys(req.body || {}));

  const started = Date.now();

  try {
    // Extract everything from request body
    const {
      coord,
      resolved,
      time_context,
      weather,
      air,
      user_id: bodyUserId,
      device_id: bodyDeviceId,
      session_id: bodySessionId,
      device: deviceInfo,
      permissions: permissionsInfo
    } = req.body || {};
    
    console.log("[snapshot] Destructured values:", { 
      has_coord: !!coord, 
      has_resolved: !!resolved, 
      has_time_context: !!time_context,
      coord: JSON.stringify(coord),
      resolved: JSON.stringify(resolved),
      time_context: JSON.stringify(time_context)
    });
    
    // Extract coordinates from coord object (SnapshotV1 format)
    const lat = coord?.lat ?? null;
    const lng = coord?.lng ?? null;
    
    // Extract location from resolved object (frontend sends snake_case)
    const city = resolved?.city ?? null;
    const state = resolved?.state ?? null;
    const country = resolved?.country ?? null;
    const formatted_address = resolved?.formattedAddress ?? null;
    const timezone = resolved?.timezone ?? null; // Frontend sends snake_case 'timezone'
    
    // Extract time context
    const local_iso = time_context?.local_iso ?? null;
    const dow = time_context?.dow ?? null;
    const hour = time_context?.hour ?? null;
    const day_part_key = time_context?.day_part_key ?? null;
    
    // Log full extracted data AND what was received to verify correctness
    console.log('[snapshot] Request received - full resolved object:', JSON.stringify(resolved));
    console.log('[snapshot] ✅ EXTRACTED SnapshotV1 data:', {
      lat, lng, city, state, timezone, formatted_address,
      hour, dow, day_part_key, local_iso
    });
    
    // Validate snapshot data completeness using dedicated validator
    const { ok, errors, warnings } = validateIncomingSnapshot(req.body ?? {});
    
    if (!ok) {
      console.warn("[snapshot] INCOMPLETE_DATA - possible web crawler or incomplete client", { 
        fields_missing: errors,
        warnings,
        hasUserAgent: !!req.get("user-agent"),
        userAgent: req.get("user-agent"),
        req_id: reqId
      });
      return httpError(res, 400, 'refresh_required', 'Please refresh location permission and retry.', reqId, {
        fields_missing: errors
      });
    }
    
    // Log warnings for optional fields
    if (warnings.length > 0) {
      console.info("[snapshot] Missing optional fields", { warnings });
    }
    
    // Get userId - from body (SnapshotV1 format) or generate new
    const userId = uuidOrNull(bodyUserId) || uuid();
    const deviceId = bodyDeviceId || uuid();
    const sessionId = bodySessionId || uuid();
    const snapshot_id = uuid();

    // Build DB record - store ALL snapshot data (location, time, weather, air)
    const dbSnapshot = {
      snapshot_id,
      created_at: new Date(),
      user_id: userId,
      device_id: deviceId,
      session_id: sessionId,
      // Location data (denormalized from frontend at snapshot creation)
      lat: lat || null,
      lng: lng || null,
      city: city || null,
      state: state || null,
      country: country || null,
      formatted_address: formatted_address || null,
      timezone: timezone || null,
      // Time context (authoritative at snapshot creation - stored as-is from frontend)
      local_iso: local_iso ? new Date(local_iso) : null,
      dow: dow ?? null,
      hour: hour ?? null,
      day_part_key: day_part_key || null,
      // API-enriched contextual data
      weather: weather || null,
      air: air || null,
      device: deviceInfo || null,
      permissions: permissionsInfo || null,
    };

    // Persist to DB - ALL location and time data goes into snapshots table
    await db.insert(snapshots).values(dbSnapshot);
    console.log('[snapshot] ✅ Snapshot persisted with all location/time data');

    // REMOVED: Placeholder strategy creation - strategy-generator-parallel.js creates the SINGLE strategy row
    // This prevents race conditions and ensures model_name attribution is preserved
    
    // Fire-and-forget: enqueue triad planning; do NOT block the HTTP response
    queueMicrotask(() => {
      try {
        console.log(`[triad] enqueue`, { snapshot_id });
        generateStrategyForSnapshot(snapshot_id).catch(err => {
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
router.get("/:snapshotId", async (req, res) => {
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
      local_news: snapshot.local_news,
      airport_context: snapshot.airport_context,
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
