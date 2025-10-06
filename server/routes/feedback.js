import express from 'express';
import { db } from '../db/drizzle.js';
import { venue_catalog, venue_metrics, venue_feedback } from '../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';

const router = express.Router();

router.post('/venue-feedback', async (req, res) => {
  try {
    const { venueId, feedbackType, driverId, comment } = req.body;
    
    if (!venueId || !feedbackType || !driverId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const validTypes = ['open', 'closed', 'busy', 'slow', 'correct_hours', 'incorrect_hours'];
    if (!validTypes.includes(feedbackType)) {
      return res.status(400).json({ error: 'Invalid feedback type' });
    }
    
    await db.insert(venue_feedback).values({
      venue_id: venueId,
      driver_user_id: driverId,
      feedback_type: feedbackType,
      comment: comment || null,
    });
    
    const isPositive = ['open', 'busy', 'correct_hours'].includes(feedbackType);
    const field = isPositive ? 'positive_feedback' : 'negative_feedback';
    
    const metrics = await db.select().from(venue_metrics).where(eq(venue_metrics.venue_id, venueId)).limit(1);
    
    if (metrics.length === 0) {
      await db.insert(venue_metrics).values({
        venue_id: venueId,
        times_recommended: 0,
        times_chosen: 0,
        positive_feedback: isPositive ? 1 : 0,
        negative_feedback: isPositive ? 0 : 1,
        reliability_score: isPositive ? 1.0 : 0.0,
        last_verified_by_driver: new Date(),
      });
    } else {
      const current = metrics[0];
      const newPositive = current.positive_feedback + (isPositive ? 1 : 0);
      const newNegative = current.negative_feedback + (isPositive ? 0 : 1);
      const total = newPositive + newNegative;
      const newScore = total > 0 ? newPositive / total : 0.5;
      
      await db.update(venue_metrics)
        .set({
          positive_feedback: newPositive,
          negative_feedback: newNegative,
          reliability_score: newScore,
          last_verified_by_driver: new Date(),
        })
        .where(eq(venue_metrics.venue_id, venueId));
    }
    
    res.json({ 
      success: true,
      message: 'Feedback recorded successfully',
      creditsEarned: 10
    });
    
  } catch (error) {
    console.error('Feedback error:', error);
    res.status(500).json({ error: 'Failed to record feedback' });
  }
});

router.get('/reliable-venues', async (req, res) => {
  try {
    const { city, metro, minScore = 0.7, limit = 50 } = req.query;
    
    const query = db
      .select({
        venue: venue_catalog,
        metrics: venue_metrics,
      })
      .from(venue_catalog)
      .leftJoin(venue_metrics, eq(venue_catalog.venue_id, venue_metrics.venue_id))
      .where(sql`${venue_metrics.reliability_score} >= ${parseFloat(minScore)}`)
      .limit(parseInt(limit));
    
    if (city) {
      query.where(eq(venue_catalog.city, city));
    } else if (metro) {
      query.where(eq(venue_catalog.metro, metro));
    }
    
    const results = await query;
    
    res.json({
      venues: results.map(r => ({
        ...r.venue,
        ...r.metrics,
      })),
    });
    
  } catch (error) {
    console.error('Reliable venues error:', error);
    res.status(500).json({ error: 'Failed to fetch reliable venues' });
  }
});

router.post('/venue-chosen', async (req, res) => {
  try {
    const { venueId, driverId } = req.body;
    
    if (!venueId || !driverId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const metrics = await db.select().from(venue_metrics).where(eq(venue_metrics.venue_id, venueId)).limit(1);
    
    if (metrics.length === 0) {
      await db.insert(venue_metrics).values({
        venue_id: venueId,
        times_recommended: 0,
        times_chosen: 1,
      });
    } else {
      await db.update(venue_metrics)
        .set({
          times_chosen: sql`${venue_metrics.times_chosen} + 1`,
        })
        .where(eq(venue_metrics.venue_id, venueId));
    }
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Venue chosen error:', error);
    res.status(500).json({ error: 'Failed to record venue choice' });
  }
});

export default router;
