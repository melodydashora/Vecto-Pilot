import { Router } from 'express';
import { db } from '../db/drizzle.js';
import { actions, snapshots, rankings } from '../../shared/schema.js';
import { desc, eq } from 'drizzle-orm';

const router = Router();

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
router.post('/', async (req, res) => {
  try {
    const {
      ranking_id,
      action,
      block_id,
      dwell_ms,
      from_rank,
      user_id = 'default',
      raw,
    } = req.body;

    // Check idempotency key to prevent duplicate actions
    const idempotencyKey = req.header('X-Idempotency-Key');
    if (idempotencyKey) {
      const cached = idempotencyCache.get(idempotencyKey);
      if (cached) {
        console.log(`⚡ Idempotent request detected - returning cached response`);
        return res.json(cached.response);
      }
    }

    // Validate required fields
    if (!action) {
      return res.status(400).json({ error: 'action is required' });
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
    
    // Fallback to latest snapshot if no ranking_id provided (backward compatibility)
    if (!snapshot_id) {
      const latestSnapshot = await db
        .select({ snapshot_id: snapshots.snapshot_id })
        .from(snapshots)
        .orderBy(desc(snapshots.created_at))
        .limit(1);

      snapshot_id = latestSnapshot[0]?.snapshot_id || null;
    }

    if (!snapshot_id) {
      console.warn('[actions] No snapshot found, action not logged');
      return res.status(400).json({ error: 'No snapshot available' });
    }

    // Create action record with retry logic for replication lag
    const action_id = crypto.randomUUID();
    const actionData = {
      action_id,
      created_at: new Date(),
      ranking_id: ranking_id || null,
      snapshot_id,
      user_id: user_id !== 'default' ? user_id : null,
      action,
      block_id: block_id || null,
      dwell_ms: dwell_ms || null,
      from_rank: from_rank || null,
      raw: raw || null,
    };

    // Retry logic for foreign key constraint errors (replication lag)
    const maxRetries = 5;
    const retryDelayMs = 200; // Start with 200ms
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await db.insert(actions).values(actionData);
        console.log(`📊 Action logged: ${action}${block_id ? ` on ${block_id}` : ''}${dwell_ms ? ` (${dwell_ms}ms)` : ''}${attempt > 1 ? ` (retry ${attempt})` : ''}`);
        
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
        
        // Check if it's a foreign key constraint error for ranking_id
        if (err.code === '23503' && err.constraint === 'actions_ranking_id_rankings_ranking_id_fk') {
          if (attempt < maxRetries) {
            const delay = retryDelayMs * attempt; // Exponential backoff
            console.warn(`⚠️ Foreign key error (replication lag), retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          // If all retries exhausted, log action without ranking_id
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
