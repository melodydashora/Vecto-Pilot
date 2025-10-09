import express from 'express';
import { db } from '../db/drizzle.js';
import { venue_feedback, strategy_feedback, app_feedback, ranking_candidates, actions } from '../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import crypto from 'crypto';

const router = express.Router();

// Rate limiting: 10 requests per minute per user_id
const rateLimits = new Map(); // user_id -> { count, resetAt }
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 1000; // 1 minute

function checkRateLimit(userId) {
  const now = Date.now();
  const key = userId || 'anonymous';
  
  if (!rateLimits.has(key)) {
    rateLimits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  
  const limit = rateLimits.get(key);
  
  if (now > limit.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  
  if (limit.count >= RATE_LIMIT) {
    return false;
  }
  
  limit.count++;
  return true;
}

// Clean up expired rate limits every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, limit] of rateLimits.entries()) {
    if (now > limit.resetAt) {
      rateLimits.delete(key);
    }
  }
}, 60000);

// POST /api/feedback/venue
router.post('/venue', async (req, res) => {
  const correlationId = crypto.randomUUID();
  
  try {
    const { userId, snapshot_id, ranking_id, place_id, venue_name, sentiment, comment } = req.body;
    
    // Validate required fields
    if (!snapshot_id || !ranking_id || !venue_name || !sentiment) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Missing required fields (snapshot_id, ranking_id, venue_name, sentiment)' 
      });
    }
    
    // Validate sentiment
    if (sentiment !== 'up' && sentiment !== 'down') {
      return res.status(400).json({ 
        ok: false, 
        error: 'Invalid sentiment. Must be "up" or "down"' 
      });
    }
    
    // Sanitize comment (limit to 1000 chars, strip HTML)
    const sanitizedComment = comment 
      ? String(comment).replace(/<[^>]*>/g, '').slice(0, 1000)
      : null;
    
    // Check rate limit
    if (!checkRateLimit(userId)) {
      console.warn('[feedback] Rate limit exceeded', { 
        correlation_id: correlationId, 
        user_id: userId 
      });
      return res.status(429).json({ 
        ok: false, 
        error: 'Rate limit exceeded. Maximum 10 requests per minute.' 
      });
    }
    
    // Upsert feedback (update if exists, insert if new)
    await db
      .insert(venue_feedback)
      .values({
        user_id: userId || null,
        snapshot_id,
        ranking_id,
        place_id: place_id || null,
        venue_name,
        sentiment,
        comment: sanitizedComment,
      })
      .onConflictDoUpdate({
        target: [venue_feedback.user_id, venue_feedback.ranking_id, venue_feedback.place_id],
        set: {
          sentiment,
          comment: sanitizedComment,
          created_at: sql`now()`,
        },
      });
    
    // Log to actions table (optional instrumentation)
    try {
      await db.insert(actions).values({
        action_id: crypto.randomUUID(),
        created_at: new Date(),
        ranking_id,
        snapshot_id,
        user_id: userId || null,
        action: 'venue_feedback',
        raw: { place_id, venue_name, sentiment },
      });
    } catch (actionErr) {
      console.warn('[feedback] Failed to log action', { error: actionErr.message });
    }
    
    console.log('[feedback] upsert ok', {
      corr: correlationId,
      user: userId || 'anon',
      ranking: ranking_id,
      place: place_id || 'null',
      sent: sentiment,
    });
    
    res.json({ ok: true });
    
  } catch (error) {
    console.error('[feedback] venue feedback error', { 
      correlation_id: correlationId, 
      error: error.message 
    });
    res.status(500).json({ 
      ok: false, 
      error: 'Failed to record feedback' 
    });
  }
});

// GET /api/feedback/venue/summary?ranking_id=<UUID>
router.get('/venue/summary', async (req, res) => {
  const correlationId = crypto.randomUUID();
  
  try {
    const { ranking_id } = req.query;
    
    if (!ranking_id) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Missing ranking_id parameter' 
      });
    }
    
    // Query per-venue counts for this ranking
    const results = await db
      .select({
        place_id: venue_feedback.place_id,
        venue_name: sql<string>`MAX(${venue_feedback.venue_name})`.as('venue_name'),
        up_count: sql<number>`COUNT(*) FILTER (WHERE ${venue_feedback.sentiment} = 'up')::int`.as('up_count'),
        down_count: sql<number>`COUNT(*) FILTER (WHERE ${venue_feedback.sentiment} = 'down')::int`.as('down_count'),
      })
      .from(venue_feedback)
      .where(eq(venue_feedback.ranking_id, ranking_id))
      .groupBy(venue_feedback.place_id);
    
    console.log('[feedback] summary', { 
      correlation_id: correlationId,
      ranking: ranking_id, 
      rows: results.length 
    });
    
    res.json({ 
      ok: true, 
      items: results 
    });
    
  } catch (error) {
    console.error('[feedback] summary error', { 
      correlation_id: correlationId, 
      error: error.message 
    });
    res.status(500).json({ 
      ok: false, 
      error: 'Failed to fetch feedback summary' 
    });
  }
});

// POST /api/feedback/strategy
router.post('/strategy', async (req, res) => {
  const correlationId = crypto.randomUUID();
  
  try {
    const { userId, snapshot_id, ranking_id, sentiment, comment } = req.body;
    
    // Validate required fields
    if (!snapshot_id || !ranking_id || !sentiment) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Missing required fields (snapshot_id, ranking_id, sentiment)' 
      });
    }
    
    // Validate sentiment
    if (sentiment !== 'up' && sentiment !== 'down') {
      return res.status(400).json({ 
        ok: false, 
        error: 'Invalid sentiment. Must be "up" or "down"' 
      });
    }
    
    // Sanitize comment
    const sanitizedComment = comment 
      ? String(comment).replace(/<[^>]*>/g, '').slice(0, 1000)
      : null;
    
    // Check rate limit
    if (!checkRateLimit(userId)) {
      console.warn('[feedback] Rate limit exceeded (strategy)', { 
        correlation_id: correlationId, 
        user_id: userId 
      });
      return res.status(429).json({ 
        ok: false, 
        error: 'Rate limit exceeded. Maximum 10 requests per minute.' 
      });
    }
    
    // Upsert strategy feedback
    await db
      .insert(strategy_feedback)
      .values({
        user_id: userId || null,
        snapshot_id,
        ranking_id,
        sentiment,
        comment: sanitizedComment,
      })
      .onConflictDoUpdate({
        target: [strategy_feedback.user_id, strategy_feedback.ranking_id],
        set: {
          sentiment,
          comment: sanitizedComment,
          created_at: sql`now()`,
        },
      });
    
    console.log('[feedback] strategy upsert ok', {
      corr: correlationId,
      user: userId || 'anon',
      ranking: ranking_id,
      sent: sentiment,
    });
    
    res.json({ ok: true });
    
  } catch (error) {
    console.error('[feedback] strategy feedback error', { 
      correlation_id: correlationId, 
      error: error.message 
    });
    res.status(500).json({ 
      ok: false, 
      error: 'Failed to record strategy feedback' 
    });
  }
});

// POST /api/feedback/app - Simple whole-app feedback (snapshot context only)
router.post('/app', async (req, res) => {
  const correlationId = crypto.randomUUID();
  
  try {
    const { snapshot_id, sentiment, comment } = req.body;
    
    // Validate required fields (snapshot_id is optional for app feedback)
    if (!sentiment) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Missing required field: sentiment' 
      });
    }
    
    // Validate sentiment
    if (sentiment !== 'up' && sentiment !== 'down') {
      return res.status(400).json({ 
        ok: false, 
        error: 'Invalid sentiment. Must be "up" or "down"' 
      });
    }
    
    // Sanitize comment
    const sanitizedComment = comment 
      ? String(comment).replace(/<[^>]*>/g, '').slice(0, 1000)
      : null;
    
    // No rate limiting for app feedback (it's infrequent)
    
    // Insert app feedback
    await db
      .insert(app_feedback)
      .values({
        snapshot_id: snapshot_id || null,
        sentiment,
        comment: sanitizedComment,
      });
    
    console.log('[feedback] app feedback ok', {
      corr: correlationId,
      snapshot: snapshot_id || 'none',
      sent: sentiment,
    });
    
    res.json({ ok: true });
    
  } catch (error) {
    console.error('[feedback] app feedback error', { 
      correlation_id: correlationId, 
      error: error.message 
    });
    res.status(500).json({ 
      ok: false, 
      error: 'Failed to record app feedback' 
    });
  }
});

export default router;
