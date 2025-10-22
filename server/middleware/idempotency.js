import { db } from '../db/index.js';
import { http_idem } from '../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';

export function idempotency({ header = "x-idempotency-key", ttlMs = 60000 } = {}) {
  return async (req, res, next) => {
    const key = req.get(header);
    if (!key) return next();

    try {
      // Check for existing idempotency record within TTL
      const hit = await db.select()
        .from(http_idem)
        .where(
          sql`${http_idem.key} = ${key} AND ${http_idem.created_at} > now() - interval '${sql.raw(String(ttlMs / 1000))} seconds'`
        )
        .limit(1);

      if (hit.length > 0) {
        return res.status(hit[0].status).json(hit[0].body);
      }

      // Intercept res.json to save response (only cache good outcomes, not 5xx errors)
      const originalJson = res.json.bind(res);
      res.json = async (body) => {
        const s = res.statusCode || 200;
        // Only cache: 2xx success, 202 accepted, and deterministic 4xx like 400
        if ((s >= 200 && s < 300) || s === 202 || s === 400) {
          try {
            await db.insert(http_idem).values({
              key,
              status: s,
              body
            }).onConflictDoNothing();
          } catch (err) {
            console.warn('[idempotency] Failed to save response:', err.message);
          }
        }
        return originalJson(body);
      };

      next();
    } catch (err) {
      console.error('[idempotency] Middleware error:', err);
      next();
    }
  };
}
