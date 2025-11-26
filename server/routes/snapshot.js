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
  
  const started = Date.now();

  try {
    // CRITICAL: Extract EVERYTHING from SnapshotV1 format sent by frontend
    // Frontend sends complete object with coord, resolved, time_context at top level
    const body = req.body || {};
    
    // Precise location coordinates (MUST be saved)
    const lat = body.coord?.lat ?? null;
    const lng = body.coord?.lng ?? null;
    
    // Resolved location address
    const city = body.resolved?.city ?? null;
    const state = body.resolved?.state ?? null;
    const country = body.resolved?.country ?? null;
    const formatted_address = body.resolved?.formattedAddress ?? null;
    const timezone = body.resolved?.timezone ?? null;
    
    // Time context (MUST be saved)
    const local_iso = body.time_context?.local_iso ?? null;
    const dow = body.time_context?.dow ?? null;
    const hour = body.time_context?.hour ?? null;
    const day_part_key = body.time_context?.day_part_key ?? null;
    
    // API enrichments
    const weather = body.weather ?? null;
    const air = body.air ?? null;
    
    // User/device tracking
    const bodyUserId = body.user_id ?? null;
    const bodyDeviceId = body.device_id ?? null;
    const bodySessionId = body.session_id ?? null;
    const deviceInfo = body.device ?? null;
    const permissionsInfo = body.permissions ?? null;
    
    // Log extraction
    console.log('[snapshot] ✅ EXTRACTED SnapshotV1:', {
      lat, lng, city, state, timezone, formatted_address,
      hour, dow, day_part_key,
      has_weather: !!weather, has_air: !!air
    });
    
    
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
      lat: lat !== null && lat !== undefined ? Number(lat) : null,
      lng: lng !== null && lng !== undefined ? Number(lng) : null,
      city: city || null,
      state: state || null,
      country: country || null,
      formatted_address: formatted_address || null,
      timezone: timezone || null,
      // Time context (authoritative at snapshot creation - stored as-is from frontend)
      local_iso: local_iso ? new Date(local_iso) : null,
      dow: dow !== null && dow !== undefined ? Number(dow) : null,
      hour: hour !== null && hour !== undefined ? Number(hour) : null,
      day_part_key: day_part_key || null,
      // API-enriched contextual data
      weather: weather || null,
      air: air || null,
      device: deviceInfo || null,
      permissions: permissionsInfo || null,
    };

    // CRITICAL: Log exactly what we're about to insert (before DB call)
    console.log('[snapshot] 🔥 ABOUT TO INSERT:', {
      lat_value: dbSnapshot.lat,
      lng_value: dbSnapshot.lng,
      city_value: dbSnapshot.city,
      timezone_value: dbSnapshot.timezone,
      hour_value: dbSnapshot.hour,
      dow_value: dbSnapshot.dow,
      formatted_address_value: dbSnapshot.formatted_address,
      local_iso_value: dbSnapshot.local_iso
    });

    // Persist to DB - ALL location and time data goes into snapshots table
    const result = await db.insert(snapshots).values(dbSnapshot);
    console.log('[snapshot] ✅ Snapshot persisted:', { snapshot_id, result: !!result });

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
