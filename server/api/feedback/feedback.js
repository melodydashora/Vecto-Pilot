import express from 'express';
import { db } from '../../db/drizzle.js';
import { venue_feedback, strategy_feedback, app_feedback } from '../../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { capturelearning, LEARNING_EVENTS } from '../../middleware/learning-capture.js';
import { indexFeedback } from '../../lib/external/semantic-search.js';
import { requireAuth } from '../../middleware/auth.js';
import { recordVenueFeedback, VenueFeedbackError } from '../../lib/venue/venue-feedback.js';

const router = express.Router();

// Rate limiting: 10 requests per minute per user_id
const rateLimits = new Map(); // user_id -> { count, resetAt }
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 1000; // 1 minute

// 2026-01-15: Removed 'anonymous' fallback - all routes require auth
// If userId is somehow missing, throw error (data integrity bug)
function checkRateLimit(userId) {
  if (!userId) {
    throw new Error('[FEEDBACK] checkRateLimit called without userId - auth middleware should prevent this');
  }
  const now = Date.now();
  const key = userId;

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
}, 60000).unref();

// POST /api/feedback/venue
// 2026-09-11: Replaced the unchecked vote-only write with an owned, persisted
// dismissal/restore receipt. The old auth-only checks and optional action logging
// are preserved in docs/architecture/removals/2026-09-11-venue-feedback.md.
router.post('/venue', requireAuth, async (req, res) => {
  const correlationId = crypto.randomUUID();
  try {
    const authUserId = req.auth.userId;
    if (!checkRateLimit(authUserId)) {
      return res.status(429).json({ ok: false, error: 'rate_limit', message: 'Maximum 10 feedback requests per minute.' });
    }
    // Existing callers send sentiment; new clients supply explicit actions and
    // retain request_id through network retries. Canonical names come from DB.
    const body = { ...req.body };
    if (!body.action && ['up', 'down'].includes(body.sentiment)) {
      body.action = body.sentiment === 'up' ? 'upvote' : 'dismiss';
      body.request_id ||= crypto.randomUUID();
      body.visible_place_ids ||= [body.place_id];
    }
    const { receipt, replayed } = await recordVenueFeedback(db, authUserId, body);
    if (!replayed && receipt.action !== 'restore') {
      setImmediate(() => {
        indexFeedback(receipt.feedback_id).catch(err => {
          console.error('[FEEDBACK] Semantic indexing failed:', err.message);
        });
        capturelearning(LEARNING_EVENTS.VENUE_FEEDBACK, {
          feedback_id: receipt.feedback_id,
          sentiment: receipt.action === 'upvote' ? 'up' : 'down',
          has_comment: !!body.comment,
          ranking_id: receipt.ranking_id,
        }, authUserId).catch(err => {
          console.error('[FEEDBACK] Learning capture failed:', err.message);
        });
      });
    }
    return res.json(receipt);
  } catch (error) {
    if (error instanceof VenueFeedbackError) {
      return res.status(error.status).json({ ok: false, error: error.code, message: error.message });
    }
    // Drizzle errors can embed SQL parameters, including the driver's comment.
    console.error('[FEEDBACK] venue feedback persistence failed', {
      correlation_id: correlationId, code: error.cause?.code || error.code || 'unknown',
    });
    return res.status(500).json({ ok: false, error: 'feedback_failed', message: 'Feedback was not confirmed. Please retry.' });
  }
});

// SECURITY: Require authentication
// GET /api/feedback/venue/summary?ranking_id=<UUID>
// 2026-02-13: Added requireAuth — was previously unprotected (D-077)
router.get('/venue/summary', requireAuth, async (req, res) => {
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
        venue_name: sql`MAX(${venue_feedback.venue_name})`.as('venue_name'),
        up_count: sql`COUNT(*) FILTER (WHERE ${venue_feedback.sentiment} = 'up')::int`.as('up_count'),
        down_count: sql`COUNT(*) FILTER (WHERE ${venue_feedback.sentiment} = 'down')::int`.as('down_count'),
      })
      .from(venue_feedback)
      .where(eq(venue_feedback.ranking_id, ranking_id))
      .groupBy(venue_feedback.place_id);
    
    console.log('[FEEDBACK] summary', { 
      correlation_id: correlationId,
      ranking: ranking_id, 
      rows: results.length 
    });
    
    res.json({ 
      ok: true, 
      items: results 
    });
    
  } catch (error) {
    console.error('[FEEDBACK] summary error', { 
      correlation_id: correlationId, 
      error: error.message 
    });
    res.status(500).json({ 
      ok: false, 
      error: 'Failed to fetch feedback summary' 
    });
  }
});

// SECURITY: Require authentication
// POST /api/feedback/strategy
router.post('/strategy', requireAuth, async (req, res) => {
  const correlationId = crypto.randomUUID();
  
  try {
    const { snapshot_id, ranking_id, sentiment, comment } = req.body;

    // 2026-02-13: Use only authenticated user_id — body userId removed (spoofing risk)
    const authUserId = req.auth.userId;

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
    if (!checkRateLimit(authUserId)) {
      console.warn('[FEEDBACK] Rate limit exceeded (strategy)', { 
        correlation_id: correlationId, 
        user_id: authUserId 
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
        user_id: authUserId || null,
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
        }
      });
    
    console.log('[FEEDBACK] strategy upsert ok', {
      corr: correlationId,
      user: authUserId || 'anon',
      ranking: ranking_id,
      sent: sentiment,
    });
    
    res.json({ ok: true });
    
  } catch (error) {
    console.error('[FEEDBACK] strategy feedback error', { 
      correlation_id: correlationId, 
      error: error.message 
    });
    res.status(500).json({ 
      ok: false, 
      error: 'Failed to record strategy feedback' 
    });
  }
});

// SECURITY: Require authentication
// POST /api/feedback/app - Simple whole-app feedback (snapshot context only)
router.post('/app', requireAuth, async (req, res) => {
  const correlationId = crypto.randomUUID();
  
  try {
    // SECURITY: Use authenticated user_id
    const authUserId = req.auth?.userId;
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
    // 2026-04-16 (Pass F fix): authUserId was read but not inserted — identity was lost
    await db
      .insert(app_feedback)
      .values({
        user_id: authUserId || null,
        snapshot_id: snapshot_id || null,
        sentiment,
        comment: sanitizedComment,
      });
    
    console.log('[FEEDBACK] app feedback ok', {
      corr: correlationId,
      snapshot: snapshot_id || 'none',
      sent: sentiment,
    });
    
    res.json({ ok: true });
    
  } catch (error) {
    console.error('[FEEDBACK] app feedback error', { 
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
