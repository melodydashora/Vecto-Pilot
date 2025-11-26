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

  const started = Date.now();

  try {
    // Accept lat/lng from query params OR body
    const latFromQuery = req.query.lat ? Number(req.query.lat) : null;
    const lngFromQuery = req.query.lng ? Number(req.query.lng) : null;
    
    // Map both SnapshotV1 format (resolved) and internal format (context) for compatibility
    const { lat: latFromBody, lng: lngFromBody, context, resolved, meta, coord, device, permissions } = req.body || {};
    
    const lat = latFromQuery ?? latFromBody ?? coord?.lat;
    const lng = lngFromQuery ?? lngFromBody ?? coord?.lng;
    
    // Map resolved → context for SnapshotV1 format compatibility
    // CRITICAL: Normalize camelCase fields from frontend (timeZone) to snake_case (timezone)
    const resolvedNormalized = resolved ? {
      ...resolved,
      timezone: resolved.timeZone || resolved.timezone, // Frontend sends camelCase timeZone
      formatted_address: resolved.formattedAddress || resolved.formatted_address
    } : {};
    const contextData = context || resolvedNormalized || {};
    
    console.log('[snapshot] contextData extracted:', {
      city: contextData?.city,
      state: contextData?.state,
      timezone: contextData?.timezone,
      formatted_address: contextData?.formatted_address,
      source: context ? 'context' : resolved ? 'resolved' : 'empty'
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
    
    // Get userId from header or body - must be valid UUID or null
    const userIdRaw = req.headers["x-user-id"] || req.body?.user_id || null;
    const userId = uuidOrNull(userIdRaw);
    
    if (userIdRaw && !userId) {
      console.warn("[snapshot] Invalid user_id format (not UUID), setting to null", { userId: userIdRaw });
    }
    
    const deviceId = req.body?.device_id || uuid();
    const sessionId = req.body?.session_id || uuid();

    const snapshot_id = uuid();

    // Build DB record - store denormalized location AND API-enriched fields for production reliability
    const dbSnapshot = {
      snapshot_id,
      created_at: new Date(),
      user_id: userId,
      device_id: deviceId,
      session_id: sessionId,
      // Denormalized precise location (stored at snapshot creation)
      lat: lat || null,
      lng: lng || null,
      city: contextData?.city || null,
      state: contextData?.state || null,
      country: contextData?.country || null,
      formatted_address: contextData?.formatted_address || null,
      timezone: contextData?.timezone || null,
      h3_r8: contextData?.h3_r8 || null,
      // API-enriched contextual data only
      weather: contextData?.weather || null,
      air: contextData?.air || null,
      airport_context: contextData?.airport_context || null,
      device: (meta || device)?.device || device || null,
      permissions: (meta || permissions)?.permissions || permissions || null,
      extras: contextData?.extras || null,
    };

    // Persist to DB
    await db.insert(snapshots).values(dbSnapshot);

    // CRITICAL: Also update users table so getSnapshotContext() finds location data
    // Users table is the source of truth for location data that providers need
    if (userId && (contextData?.city || contextData?.state || contextData?.timezone || contextData?.formatted_address)) {
      console.log(`[snapshot] Updating users table for ${userId} with location context`, {
        city: contextData?.city,
        state: contextData?.state,
        timezone: contextData?.timezone,
        formatted_address: contextData?.formatted_address
      });
      try {
        await db.insert(users).values({
          user_id: userId,
          device_id: deviceId,
          session_id: sessionId,
          lat: lat || 0,
          lng: lng || 0,
          city: contextData?.city || null,
          state: contextData?.state || null,
          country: contextData?.country || null,
          formatted_address: contextData?.formatted_address || null,
          timezone: contextData?.timezone || null,
          coord_source: 'api'
        }).onConflictDoUpdate({
          target: users.user_id,
          set: {
            city: contextData?.city,
            state: contextData?.state,
            country: contextData?.country,
            formatted_address: contextData?.formatted_address,
            timezone: contextData?.timezone,
            updated_at: sql`NOW()`
          }
        });
        console.log(`[snapshot] ✅ Users table updated with location data`);
      } catch (userError) {
        console.error(`[snapshot] ⚠️ Failed to update users table:`, userError.message);
        // Don't fail the snapshot if users update fails - snapshot is still valid
      }
    }

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

    console.log("[snapshot] OK", { snapshot_id, ms: Date.now() - started });
    
    // Return 201 with artifact metadata for parity
    return res.status(201).json({ 
      ok: true, 
      artifactId: snapshot_id,
      artifactPath: `database://snapshots/${snapshot_id}`,
      snapshot: {
        snapshot_id,
        lat,
        lng,
        city: dbSnapshot.city,
        state: dbSnapshot.state,
        timezone: dbSnapshot.timezone,
        created_at: dbSnapshot.created_at.toISOString()
      },
      received_at: started, 
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
