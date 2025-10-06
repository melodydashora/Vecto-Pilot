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

    // Create action record
    const action_id = crypto.randomUUID();

    await db.insert(actions).values({
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
    });

    console.log(`📊 Action logged: ${action}${block_id ? ` on ${block_id}` : ''}${dwell_ms ? ` (${dwell_ms}ms)` : ''}`);

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

    res.json(response);

  } catch (error) {
    console.error('❌ Action logging error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

export default router;
