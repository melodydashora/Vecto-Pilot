// server/routes/snapshot.js
import express from "express";
import crypto from "node:crypto";
import { db } from "../db/drizzle.js";
import { snapshots, strategies } from "../../shared/schema.js";

const router = express.Router();

router.use(express.json({ limit: "1mb", strict: true }));

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function requireStr(v, name) {
  if (typeof v !== "string" || !v.trim()) throw new Error(`missing:${name}`);
  return v.trim();
}

router.post("/", async (req, res) => {
  console.log("[snapshot] handler ENTER", { url: req.originalUrl });

  const started = Date.now();
  const reqId = req.get("x-request-id") || uuid();

  try {
    // Get userId from header or body
    const userId = req.headers["x-user-id"] || req.body?.user_id || null;
    const deviceId = req.body?.device_id || uuid();
    const sessionId = req.body?.session_id || uuid();
    
    const { lat, lng, context, meta } = req.body || {};
    
    if (typeof lat !== "number" || typeof lng !== "number") {
      throw new Error("invalid:latlng");
    }

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
        console.log(`[triad] start id=${snapshot_id}`);
        
        // Trigger background strategy generation
        import('../lib/strategy-generator.js').then(module => {
          module.generateStrategyForSnapshot(snapshot_id).catch(err => {
            console.warn(`[triad] strategist.err id=${snapshot_id} reason=${err.message}`);
          });
        }).catch(err => {
          console.warn(`[triad] import.err id=${snapshot_id} reason=${err.message}`);
        });
      } catch (e) {
        console.warn(`[triad] enqueue.err id=${snapshot_id} reason=${String(e)}`);
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
