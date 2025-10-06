// server/routes/snapshot.js
import { Router } from 'express';
import crypto from "node:crypto";
import { db } from "../db/drizzle.js";
import { snapshots, strategies } from "../../shared/schema.js";
import { generateStrategyForSnapshot } from "../lib/strategy-generator.js";
import { validateIncomingSnapshot } from "../util/validate-snapshot.js";

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
    const { lat, lng, context, meta } = req.body || {};
    
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
    let userId = req.headers["x-user-id"] || req.body?.user_id || null;
    
    // Validate user_id is a valid UUID format, otherwise set to null
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (userId && !uuidRegex.test(userId)) {
      console.warn("[snapshot] Invalid user_id format (not UUID), setting to null", { userId });
      userId = null;
    }
    
    const deviceId = req.body?.device_id || uuid();
    const sessionId = req.body?.session_id || uuid();

    const snapshot_id = uuid();

    // Build DB record
    const dbSnapshot = {
      snapshot_id,
      created_at: new Date(),
      user_id: userId,
      device_id: deviceId,
      session_id: sessionId,
      lat,
      lng,
      accuracy_m: context?.accuracy || null,
      coord_source: context?.source || 'api',
      city: context?.city || null,
      state: context?.state || null,
      country: context?.country || null,
      formatted_address: context?.formattedAddress || null,
      timezone: context?.timezone || null,
      local_iso: context?.local_iso ? new Date(context.local_iso) : null,
      dow: context?.dow !== undefined ? context.dow : null,
      hour: context?.hour !== undefined ? context.hour : null,
      day_part_key: context?.day_part_key || null,
      h3_r8: context?.h3_r8 || null,
      weather: context?.weather || null,
      air: context?.air || null,
      airport_context: context?.airport_context || null,
      device: meta?.device || null,
      permissions: meta?.permissions || null,
      extras: meta?.extras || null,
    };

    // Persist to DB
    await db.insert(snapshots).values(dbSnapshot);

    // Immediately create placeholder strategy row so GET endpoint can return "pending" instead of "not_found"
    await db.insert(strategies).values({
      snapshot_id,
      status: 'pending',
      attempt: 1,
      created_at: new Date(),
      updated_at: new Date(),
    }).onConflictDoNothing();

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
    return res.status(200).json({ ok: true, snapshot_id, received_at: started, req_id: reqId });
  } catch (err) {
    const msg = String(err && err.message || err);
    const code = msg.startsWith("missing:") || msg.startsWith("invalid:") ? 400 : 500;
    console.warn("[snapshot] ERR", { msg, code, ms: Date.now() - started, req_id: reqId });
    return res.status(code).json({ ok: false, error: msg, req_id: reqId });
  }
});

export default router;
