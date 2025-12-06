// server/routes/snapshot.js
import express, { Router } from 'express';
import crypto from "node:crypto";
import { db } from "../db/drizzle.js";
import { sql, eq } from "drizzle-orm";
import { snapshots, strategies, users } from "../../shared/schema.js";
import { generateStrategyForSnapshot } from "../lib/strategy-generator.js";
import { validateIncomingSnapshot } from "../util/validate-snapshot.js";
import { uuidOrNull } from "../util/uuid.js";
import { generateAndStoreBriefing } from "../lib/briefing-service.js";

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
    const snap = req.body || {};
    
    // SECURITY FIX: Use authenticated user_id from JWT, NOT from request body
    const user_id = req.auth?.userId || uuid();
    
    // Direct extraction
    const snapshot_id = snap.snapshot_id || uuid();
    const lat = snap.coord?.lat;
    const lng = snap.coord?.lng;
    const city = snap.resolved?.city;
    const state = snap.resolved?.state;
    const country = snap.resolved?.country;
    const formatted_address = snap.resolved?.formattedAddress;
    const timezone = snap.resolved?.timezone;
    const hour = snap.time_context?.hour;
    const dow = snap.time_context?.dow;
    const day_part_key = snap.time_context?.day_part_key;
    const local_iso = snap.time_context?.local_iso;
    
    // Build DB record
    const createdAtDate = snap.created_at ? new Date(snap.created_at) : new Date();
    
    // Calculate "today" in the driver's local timezone (not server timezone)
    // This ensures Hawaii, Alaska, etc. get the correct date
    const driverTimezone = timezone || 'America/Chicago';
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
      user_id,
      device_id: snap.device_id || uuid(),
      session_id: snap.session_id || uuid(),
      // Precise location coordinates (GPS)
      lat: typeof lat === 'number' ? lat : null,
      lng: typeof lng === 'number' ? lng : null,
      // Resolved address
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
      device: snap.device || null,
      permissions: snap.permissions || null,
      // DEBUG: Store entire raw body to see what was received
      extras: { raw_body: snap, extracted: { lat, lng, city, state, timezone, hour, dow } },
    };

    console.log('[snapshot] 🔥 INSERTING:', {
      lat: dbSnapshot.lat,
      lng: dbSnapshot.lng,
      city: dbSnapshot.city,
      timezone: dbSnapshot.timezone,
      hour: dbSnapshot.hour,
      dow: dbSnapshot.dow
    });

    // Insert to DB
    await db.insert(snapshots).values(dbSnapshot);
    console.log('[snapshot] ✅ SAVED TO DB:', { snapshot_id, lat, lng, city, timezone });

    // REMOVED: Placeholder strategy creation - strategy-generator-parallel.js creates the SINGLE strategy row
    // This prevents race conditions and ensures model_name attribution is preserved
    
    // Generate briefing data BEFORE responding (so data is ready when frontend queries)
    if (lat && lng) {
      console.log(`[briefing] starting`, { snapshot_id, city, state });
      await generateAndStoreBriefing({
        snapshotId: snapshot_id,
        lat,
        lng,
        city: city || 'Unknown',
        state: state || '',
        formattedAddress: formatted_address || null
      }).catch(err => {
        console.warn(`[briefing] generation.failed`, { snapshot_id, err: String(err) });
      });
      console.log(`[briefing] ✅ complete`, { snapshot_id });
    }

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
import { requireAuth } from '../middleware/auth.js';

router.get("/:snapshotId", requireAuth, async (req, res) => {
  const { snapshotId } = req.params;
  
  if (!snapshotId) {
    return res.status(400).json({ ok: false, error: 'MISSING_SNAPSHOT_ID' });
  }
  
  try {
    const snapshot = await db.query.snapshots.findFirst({
      where: (t) => sql`${t.snapshot_id} = ${snapshotId}`,
    });
    
    if (!snapshot || snapshot.user_id !== req.auth.userId) {
      return res.status(404).json({ ok: false, error: 'SNAPSHOT_NOT_FOUND' }); // 404 prevents enumeration
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
