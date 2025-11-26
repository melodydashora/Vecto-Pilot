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
    // RAW BODY DEBUG - Log exactly what arrived
    const rawBodyStr = JSON.stringify(req.body).substring(0, 2000);
    console.log('[snapshot] 📡 RAW REQUEST BODY:', rawBodyStr);
    console.log('[snapshot] 📡 BODY TOP-LEVEL KEYS:', Object.keys(req.body || {}));
    
    const body = req.body || {};
    
    // STRICT: Extract with NO defaults to null - use undefined if missing
    const lat = body.coord?.lat;
    const lng = body.coord?.lng;
    const city = body.resolved?.city;
    const state = body.resolved?.state;
    const country = body.resolved?.country;
    const formatted_address = body.resolved?.formattedAddress;
    const timezone = body.resolved?.timezone;
    const local_iso = body.time_context?.local_iso;
    const dow = body.time_context?.dow;
    const hour = body.time_context?.hour;
    const day_part_key = body.time_context?.day_part_key;
    
    // API enrichments (can be optional)
    const weather = body.weather;
    const air = body.air;
    
    // User/device tracking
    const bodyUserId = body.user_id;
    const bodyDeviceId = body.device_id;
    const bodySessionId = body.session_id;
    const deviceInfo = body.device;
    const permissionsInfo = body.permissions;
    
    // STRICT VALIDATION: REQUIRE all location and time fields
    const missing = [];
    if (typeof lat !== 'number' || !Number.isFinite(lat)) missing.push('coord.lat');
    if (typeof lng !== 'number' || !Number.isFinite(lng)) missing.push('coord.lng');
    if (typeof city !== 'string' || !city.trim()) missing.push('resolved.city');
    if (typeof state !== 'string' || !state.trim()) missing.push('resolved.state');
    if (typeof timezone !== 'string' || !timezone.trim()) missing.push('resolved.timezone');
    if (typeof formatted_address !== 'string' || !formatted_address.trim()) missing.push('resolved.formattedAddress');
    if (typeof hour !== 'number' || hour < 0 || hour > 23) missing.push('time_context.hour');
    if (typeof dow !== 'number' || dow < 0 || dow > 6) missing.push('time_context.dow');
    if (typeof day_part_key !== 'string' || !day_part_key.trim()) missing.push('time_context.day_part_key');
    if (typeof local_iso !== 'string' || !local_iso.trim()) missing.push('time_context.local_iso');
    
    if (missing.length > 0) {
      console.error('[snapshot] ❌ VALIDATION FAILED - Missing required fields:', { missing });
      return res.status(400).json({ 
        ok: false, 
        error: 'INCOMPLETE_SNAPSHOT',
        missing_fields: missing,
        req_id: reqId 
      });
    }
    
    console.log('[snapshot] ✅ EXTRACTED COMPLETE SnapshotV1:', {
      lat, lng, city, state, timezone, formatted_address,
      hour, dow, day_part_key,
      has_weather: !!weather, has_air: !!air
    });
    
    
    // Get userId - from body (SnapshotV1 format) or generate new
    const userId = uuidOrNull(bodyUserId) || uuid();
    const deviceId = bodyDeviceId || uuid();
    const sessionId = bodySessionId || uuid();
    const snapshot_id = uuid();

    // Build DB record - STRICT: All required location and time data from validated extraction
    const dbSnapshot = {
      snapshot_id,
      created_at: new Date(),
      user_id: userId,
      device_id: deviceId,
      session_id: sessionId,
      // Location data - REQUIRED fields from strict validation above
      lat: Number(lat), // lat is guaranteed to be a number at this point
      lng: Number(lng), // lng is guaranteed to be a number at this point
      city: String(city).trim(),
      state: String(state).trim(),
      country: country ? String(country).trim() : null,
      formatted_address: String(formatted_address).trim(),
      timezone: String(timezone).trim(),
      // Time context - REQUIRED fields from strict validation above
      local_iso: new Date(local_iso),
      dow: Number(dow), // dow is guaranteed to be valid number at this point
      hour: Number(hour), // hour is guaranteed to be valid number at this point
      day_part_key: String(day_part_key).trim(),
      // API-enriched contextual data (optional)
      weather: weather ? JSON.stringify(weather) : null,
      air: air ? JSON.stringify(air) : null,
      device: deviceInfo ? JSON.stringify(deviceInfo) : null,
      permissions: permissionsInfo ? JSON.stringify(permissionsInfo) : null,
    };

    console.log('[snapshot] 🔥 ABOUT TO INSERT WITH REQUIRED DATA:', {
      lat: dbSnapshot.lat,
      lng: dbSnapshot.lng,
      city: dbSnapshot.city,
      timezone: dbSnapshot.timezone,
      hour: dbSnapshot.hour,
      dow: dbSnapshot.dow,
      formatted_address: dbSnapshot.formatted_address,
      day_part_key: dbSnapshot.day_part_key
    });

    // Persist to DB - ALL location and time data saved
    await db.insert(snapshots).values(dbSnapshot);
    console.log('[snapshot] ✅ PRECISE LOCATION SAVED TO DATABASE:', { snapshot_id, lat, lng, city, timezone });

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
