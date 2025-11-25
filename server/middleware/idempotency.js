import { db } from '../db/drizzle.js';
import { http_idem } from '../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';

export function idempotency({ header = "x-idempotency-key", ttlMs = 60000 } = {}) {
  return async (req, res, next) => {
    const key = req.get(header);
    if (!key) return next();

    try {
      // Check for existing idempotency record within TTL  
      const hits = await db.select()
        .from(http_idem)
        .where(
          sql`${http_idem.key} = ${key} AND ${http_idem.created_at} > now() - interval '${sql.raw(String(ttlMs / 1000))} seconds'`
        )
        .limit(1);

      if (hits.length > 0) {
        const hit = hits[0];
        // Replay the cached response with proper status
        return res.status(hit.status).json(hit.body);
      }

      // Intercept res.json and res.send to save response
      const originalJson = res.json.bind(res);
      const originalSend = res.send.bind(res);
      let captured = false;

      const captureResponse = async (body, isJson = true) => {
        if (captured) return;
        captured = true;
        
        const s = res.statusCode || 200;
        // Only cache: 2xx success, 202 accepted, and deterministic 4xx like 400
        if ((s >= 200 && s < 300) || s === 202 || s === 400) {
          try {
            await db.insert(http_idem).values({
              key,
              status: s,
              body: isJson ? body : { text: body }
            }).onConflictDoNothing({ target: http_idem.key });
          } catch (err) {
            console.warn('[idempotency] Failed to save response:', err.message);
          }
        }
      };

      res.json = async function(body) {
        await captureResponse(body, true);
        return originalJson.call(this, body);
      };

      res.send = async function(body) {
        if (typeof body === 'object') {
          await captureResponse(body, true);
        } else {
          await captureResponse(body, false);
        }
        return originalSend.call(this, body);
      };

      next();
    } catch (err) {
      console.error('[idempotency] Middleware error:', err);
      next();
    }
  };
}
