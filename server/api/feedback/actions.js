import express from 'express';
import { validate, schemas } from '../../middleware/validation.js';
import { db } from '../../db/drizzle.js';
import { actions, snapshots, rankings, venue_catalog, venue_metrics } from '../../../shared/schema.js';
import { desc, eq, sql } from 'drizzle-orm';
import crypto from 'crypto'; // Ensure crypto is imported
// 2026-01-09: Added optionalAuth to properly derive user_id from JWT
import { optionalAuth } from '../../middleware/auth.js';

const router = express.Router();

// In-memory idempotency cache (5-minute TTL)
const idempotencyCache = new Map();
const IDEMPOTENCY_TTL = 5 * 60 * 1000; // 5 minutes

function cleanExpiredKeys() {
  const now = Date.now();
  for (const [key, value] of idempotencyCache.entries()) {
    if (now - value.timestamp > IDEMPOTENCY_TTL) {
      idempotencyCache.delete(key);
    }
  }
}

// Clean expired keys every minute
setInterval(cleanExpiredKeys, 60000);

// POST /api/actions
// Log user actions (clicks, dwells, views) for ML training
// 2026-01-09: Added optionalAuth middleware to derive user_id from JWT (not request body)
router.post('/', optionalAuth, validate(schemas.action), async (req, res) => {
  try {
    const {
      ranking_id,
      action,
      block_id,
      dwell_ms,
      from_rank,
      // 2026-01-09: SECURITY FIX - user_id now derived from JWT, not request body
      // Body user_id is ignored for security (prevents spoofing)
      raw,
    } = req.validatedBody; // Use validatedBody

    // 2026-01-09: SECURITY FIX - Always use authenticated user_id from JWT
    // Never trust user_id from request body (auth contract violation)
    const authUserId = req.auth?.userId || null;

    // Check idempotency key to prevent duplicate actions
    const idempotencyKey = req.header('X-Idempotency-Key');
    if (idempotencyKey) {
      const cached = idempotencyCache.get(idempotencyKey);
      if (cached) {
        console.log(`⚡ Idempotent request detected - returning cached response`);
        return res.json(cached.response);
      }
    }

    // Anchor to exact snapshot via ranking lookup (ensures action ↔ ranking ↔ snapshot integrity)
    let snapshot_id = null;

    if (ranking_id) {
      // Lookup ranking to get its snapshot_id
      const ranking = await db
        .select({ snapshot_id: rankings.snapshot_id })
        .from(rankings)
        .where(eq(rankings.ranking_id, ranking_id))
        .limit(1);

      snapshot_id = ranking[0]?.snapshot_id || null;

      if (snapshot_id) {
        console.log(`📸 Action anchored to ranking's snapshot: ${snapshot_id}`);
      }
    }

    // 2026-01-09: DATA INTEGRITY FIX - Removed global fallback to latest snapshot
    // Global fallback was cross-contaminating action attribution across users
    // Actions without ranking_id cannot be properly attributed and should fail
    if (!snapshot_id) {
      console.warn('[actions] No ranking_id provided or ranking not found, action not logged');
      return res.status(400).json({
        error: 'ranking_id is required',
        message: 'Actions must be anchored to a ranking for proper attribution'
      });
    }

    // Create action record with retry logic for replication lag
    const action_id = crypto.randomUUID();
    const actionData = {
      action_id,
      created_at: new Date(),
      ranking_id: ranking_id || null,
      snapshot_id,
      // 2026-01-09: Use authenticated user_id (null for anonymous)
      user_id: authUserId,
      action,
      block_id: block_id || null,
      dwell_ms: dwell_ms || null,
      from_rank: from_rank || null,
      raw: raw || null,
    };

    // Retry logic for foreign key constraint errors (replication lag)
    const maxRetries = 8;
    const retryDelayMs = 150; // Start with 150ms, grows exponentially
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await db.insert(actions).values(actionData);
        console.log(`📊 Action logged: ${action}${block_id ? ` on ${block_id}` : ''}${dwell_ms ? ` (${dwell_ms}ms)` : ''}${attempt > 1 ? ` (retry ${attempt})` : ''}`);

        // Bump venue_metrics.times_chosen for clicks (best-effort, non-blocking)
        if (action === 'click' && block_id) {
          try {
            const result = await db.execute(sql`
              UPDATE venue_metrics vm
              SET times_chosen = vm.times_chosen + 1
              FROM venue_catalog vc
              WHERE (vc.venue_id = vm.venue_id) 
                AND (vc.venue_id::text = ${block_id} OR vc.place_id = ${block_id})
            `);
            if (result.rowCount > 0) {
              console.log(`📈 Bumped times_chosen for ${block_id}`);
            }
          } catch (metricsErr) {
            console.warn(`⚠️ Metrics bump skipped for ${block_id}:`, metricsErr.message);
          }
        }

        const response = { 
          success: true, 
          action_id,
        };

        // Cache response for idempotency
        if (idempotencyKey) {
          idempotencyCache.set(idempotencyKey, {
            response,
            timestamp: Date.now()
          });
        }

        return res.json(response);
      } catch (err) {
        lastError = err;

        // Check if it's a foreign key constraint error (replication lag for ranking_id or snapshot_id)
        const isRankingFKError = err.code === '23503' && err.constraint === 'actions_ranking_id_rankings_ranking_id_fk';
        const isSnapshotFKError = err.code === '23503' && err.constraint === 'actions_snapshot_id_snapshots_snapshot_id_fk';

        if (isRankingFKError || isSnapshotFKError) {
          if (attempt < maxRetries) {
            // Exponential backoff with jitter: 150ms, 300ms, 600ms, 1200ms, 2400ms, 4800ms, 9600ms
            const delay = Math.min(retryDelayMs * Math.pow(2, attempt - 1), 10000);
            const constraint = isRankingFKError ? 'ranking_id' : 'snapshot_id';
            console.warn(`⚠️ Foreign key error on ${constraint} (replication lag), retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }

          // If all retries exhausted
          if (isRankingFKError) {
            // For ranking_id, log action without it
            console.warn(`⚠️ Replication lag persists after ${maxRetries} retries, logging without ranking_id`);
            actionData.ranking_id = null;
            try {
              await db.insert(actions).values(actionData);
              console.log(`📊 Action logged (no ranking): ${action}${block_id ? ` on ${block_id}` : ''}`);

              const response = { 
                success: true, 
                action_id,
                warning: 'logged_without_ranking_id'
              };

              if (idempotencyKey) {
                idempotencyCache.set(idempotencyKey, {
                  response,
                  timestamp: Date.now()
                });
              }

              return res.json(response);
            } catch (finalErr) {
              lastError = finalErr;
              break;
            }
          } else {
            // For snapshot_id, we can't log without it (it's required), so fail
            console.error(`❌ Snapshot ${snapshot_id} not found after ${maxRetries} retries - cannot log action without snapshot`);
            break;
          }
        }
        // For other errors, break immediately
        break;
      }
    }

    // If we get here, all retries failed
    throw lastError;

  } catch (error) {
    console.error('❌ Action logging error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

export default router;