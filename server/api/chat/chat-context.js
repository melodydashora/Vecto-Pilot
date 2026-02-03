import express from 'express';
import { getDb } from '../../db/drizzle-lazy.js';
import { snapshots, strategies, rankings, ranking_candidates } from '../../../shared/schema.js';
import { eq, desc } from 'drizzle-orm';
import { requireAuth } from '../../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/chat/context
 * 
 * Read-only context endpoint for AI Coach
 * Returns enriched data already written by the pipeline - NO external API calls
 * 
 * Coach should only read what's in the database:
 * - Strategy summary from strategies table
 * - Venue candidates with all enrichment (business_hours, venue_events, pro_tips, etc.)
 * 
 * NO resolving, NO Places API, NO Perplexity, NO geocoding
 * SECURITY: Requires auth (returns strategy and candidate data)
 */
router.get('/context', requireAuth, async (req, res) => {
  const sid = req.headers['x-snapshot-id'] || req.query.snapshotId;
  if (!sid) return res.status(400).json({ ok: false, error: 'snapshot_id_required' });

  try {
    const db = getDb();
    
    // Get latest strategy for this snapshot
    const [strategy] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.snapshot_id, sid))
      .orderBy(desc(strategies.created_at))
      .limit(1);
    
    // Get latest ranking for this snapshot
    const [rank] = await db
      .select()
      .from(rankings)
      .where(eq(rankings.snapshot_id, sid))
      .orderBy(desc(rankings.created_at))
      .limit(1);

    // Get all enriched candidates (venues with full enrichment data)
    let candidates = [];
    if (rank?.ranking_id) {
      candidates = await db
        .select({
          name: ranking_candidates.name,
          place_id: ranking_candidates.place_id,
          lat: ranking_candidates.lat,
          lng: ranking_candidates.lng,
          category: ranking_candidates.category,
          distance_miles: ranking_candidates.distance_miles,
          drive_minutes: ranking_candidates.drive_minutes,
          value_per_min: ranking_candidates.value_per_min,
          value_grade: ranking_candidates.value_grade,
          business_hours: ranking_candidates.business_hours,
          venue_events: ranking_candidates.venue_events,
          pro_tips: ranking_candidates.pro_tips,
          staging_tips: ranking_candidates.staging_tips,
          closed_reasoning: ranking_candidates.closed_reasoning,
          rank: ranking_candidates.rank
        })
        .from(ranking_candidates)
        .where(eq(ranking_candidates.ranking_id, rank.ranking_id))
        .orderBy(ranking_candidates.rank)
        .limit(25);
    }

    res.json({
      ok: true,
      snapshot_id: sid,
      strategy_status: strategy?.status || 'pending',
      strategy_summary: strategy?.strategy || null,
      strategy_for_now: strategy?.strategy_for_now || null,
      ranking_id: rank?.ranking_id || null,
      candidates
    });
  } catch (err) {
    console.error('[chat-context] Error fetching context:', err);
    res.status(500).json({ 
      ok: false, 
      error: 'context_fetch_failed',
      message: err.message 
    });
  }
});

export default router;
