import { Router } from 'express';
import { generateAndStoreBriefing, getBriefingBySnapshotId, fetchTrafficConditions, fetchWeatherConditions, confirmTBDEventDetails } from '../lib/briefing-service.js';
import { db } from '../db/drizzle.js';
import { snapshots } from '../../shared/schema.js';
import { eq, desc } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/current', requireAuth, async (req, res) => {
  try {
    const latestSnapshot = await db.select()
      .from(snapshots)
      .where(eq(snapshots.user_id, req.auth.userId))
      .orderBy(desc(snapshots.created_at))
      .limit(1);

    if (latestSnapshot.length === 0) {
      return res.status(404).json({ error: 'No snapshot found' });
    }

    const snapshot = latestSnapshot[0];
    const briefing = await getBriefingBySnapshotId(snapshot.snapshot_id);

    if (!briefing) {
      return res.status(404).json({ error: 'Briefing not yet generated - try again in a moment' });
    }

    res.json({
      snapshot_id: snapshot.snapshot_id,
      location: {
        city: snapshot.city,
        state: snapshot.state,
        lat: snapshot.lat,
        lng: snapshot.lng
      },
      briefing: {
        news: briefing.news,
        weather: {
          current: briefing.weather_current,
          forecast: briefing.weather_forecast
        },
        traffic: briefing.traffic_conditions,
        events: briefing.events,
        school_closures: briefing.school_closures
      },
      created_at: briefing.created_at,
      updated_at: briefing.updated_at
    });
  } catch (error) {
    console.error('[BriefingRoute] Error fetching current briefing:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/generate', requireAuth, async (req, res) => {
  try {
    const { snapshotId } = req.body;

    if (!snapshotId) {
      return res.status(400).json({ error: 'snapshotId is required' });
    }

    // SECURITY: Verify user owns this snapshot
    const snapshotCheck = await db.select().from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
    
    if (snapshotCheck.length === 0 || snapshotCheck[0].user_id !== req.auth.userId) {
      return res.status(404).json({ error: 'snapshot_not_found' });
    }

    // Just return cached briefing - generation happens in snapshot.js on creation
    const briefing = await getBriefingBySnapshotId(snapshotId);
    
    if (!briefing) {
      return res.status(404).json({ error: 'Briefing not found or not yet generated' });
    }

    res.json({
      success: true,
      briefing: {
        news: briefing.news,
        weather: {
          current: briefing.weather_current,
          forecast: briefing.weather_forecast
        },
        traffic: briefing.traffic_conditions,
        events: briefing.events
      }
    });
  } catch (error) {
    console.error('[BriefingRoute] Error retrieving briefing:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/snapshot/:snapshotId', requireAuth, async (req, res) => {
  try {
    const { snapshotId } = req.params;
    
    // SECURITY: Verify user owns this snapshot
    const snapshotCheck = await db.select().from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
    
    if (snapshotCheck.length === 0 || snapshotCheck[0].user_id !== req.auth.userId) {
      return res.status(404).json({ error: 'snapshot_not_found' }); // 404 prevents enumeration
    }
    
    const briefing = await getBriefingBySnapshotId(snapshotId);

    if (!briefing) {
      return res.status(404).json({ error: 'Briefing not yet generated - please wait a moment' });
    }

    res.json({
      snapshot_id: snapshotId,
      briefing: {
        news: briefing.news,
        weather: {
          current: briefing.weather_current,
          forecast: briefing.weather_forecast
        },
        traffic: briefing.traffic_conditions,
        events: briefing.events,
        school_closures: briefing.school_closures
      },
      created_at: briefing.created_at,
      updated_at: briefing.updated_at
    });
  } catch (error) {
    console.error('[BriefingRoute] Error fetching briefing:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/refresh', requireAuth, async (req, res) => {
  try {
    const latestSnapshot = await db.select()
      .from(snapshots)
      .where(eq(snapshots.user_id, req.auth.userId))
      .orderBy(desc(snapshots.created_at))
      .limit(1);

    if (latestSnapshot.length === 0) {
      return res.status(404).json({ error: 'No snapshot found' });
    }

    const snapshot = latestSnapshot[0];
    
    // Regenerate if explicitly requested - pass snapshot row directly
    const result = await generateAndStoreBriefing({
      snapshotId: snapshot.snapshot_id,
      snapshot
    });

    if (result.success) {
      res.json({
        success: true,
        refreshed: true,
        briefing: {
          news: result.briefing.news,
          weather: {
            current: result.briefing.weather_current,
            forecast: result.briefing.weather_forecast
          },
          traffic: result.briefing.traffic_conditions,
          events: result.briefing.events
        }
      });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (error) {
    console.error('[BriefingRoute] Error refreshing briefing:', error);
    res.status(500).json({ error: error.message });
  }
});

// Real-time traffic endpoint for briefing tab (always fresh, not cached)
router.get('/traffic/realtime', requireAuth, async (req, res) => {
  try {
    const { lat, lng, city, state } = req.query;
    
    if (!lat || !lng) {
      return res.status(400).json({ error: 'Missing required parameters: lat, lng' });
    }

    const traffic = await fetchTrafficConditions({
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      city: city || 'Unknown',
      state: state || ''
    });

    res.json({
      success: true,
      traffic
    });
  } catch (error) {
    console.error('[BriefingRoute] Error fetching realtime traffic:', error);
    res.status(500).json({ error: error.message });
  }
});

// Real-time weather endpoint for briefing tab (always fresh, not cached)
router.get('/weather/realtime', requireAuth, async (req, res) => {
  try {
    const { lat, lng } = req.query;
    
    if (!lat || !lng) {
      return res.status(400).json({ error: 'Missing required parameters: lat, lng' });
    }

    const weather = await fetchWeatherConditions({
      lat: parseFloat(lat),
      lng: parseFloat(lng)
    });

    res.json({
      success: true,
      weather
    });
  } catch (error) {
    console.error('[BriefingRoute] Error fetching realtime weather:', error);
    res.status(500).json({ error: error.message });
  }
});

// Component-level endpoint: Weather only
router.get('/weather/:snapshotId', requireAuth, async (req, res) => {
  try {
    const { snapshotId } = req.params;
    
    // SECURITY: Verify user owns this snapshot
    const snapshotCheck = await db.select().from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
    
    if (snapshotCheck.length === 0 || snapshotCheck[0].user_id !== req.auth.userId) {
      return res.status(404).json({ error: 'snapshot_not_found' });
    }
    
    let briefing = await getBriefingBySnapshotId(snapshotId);
    
    res.json({
      success: true,
      weather: briefing ? {
        current: briefing.weather_current,
        forecast: briefing.weather_forecast
      } : { current: null, forecast: [] },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[BriefingRoute] Error fetching weather:', error);
    res.status(500).json({ error: error.message });
  }
});

// Component-level endpoint: Traffic only
router.get('/traffic/:snapshotId', requireAuth, async (req, res) => {
  try {
    const { snapshotId } = req.params;
    
    // SECURITY: Verify user owns this snapshot
    const snapshotCheck = await db.select().from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
    
    if (snapshotCheck.length === 0 || snapshotCheck[0].user_id !== req.auth.userId) {
      return res.status(404).json({ error: 'snapshot_not_found' });
    }
    
    let briefing = await getBriefingBySnapshotId(snapshotId);
    
    res.json({
      success: true,
      traffic: briefing?.traffic_conditions || { summary: 'Loading traffic...', incidents: [], congestionLevel: 'low' },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[BriefingRoute] Error fetching traffic:', error);
    res.status(500).json({ error: error.message });
  }
});

// Component-level endpoint: Rideshare News only
router.get('/rideshare-news/:snapshotId', requireAuth, async (req, res) => {
  try {
    const { snapshotId } = req.params;
    const snapshotCheck = await db.select().from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
    
    // SECURITY: Verify snapshot exists AND belongs to the user
    if (snapshotCheck.length === 0 || snapshotCheck[0].user_id !== req.auth.userId) {
      return res.status(404).json({ error: 'snapshot_not_found' });
    }
    
    const snapshot = snapshotCheck[0];
    let briefing = await getBriefingBySnapshotId(snapshotId);
    
    console.log(`[BriefingRoute] GET /briefing/rideshare-news/${snapshotId} - briefing exists: ${!!briefing}, has news: ${!!briefing?.news}`);
    
    // Auto-generate if briefing doesn't exist
    if (!briefing) {
      console.log(`[BriefingRoute] Auto-generating briefing for ${snapshotId}...`);
      const result = await generateAndStoreBriefing({
        snapshotId: snapshot.snapshot_id,
        lat: snapshot.lat,
        lng: snapshot.lng,
        city: snapshot.city,
        state: snapshot.state,
        country: snapshot.country,
        formattedAddress: snapshot.formatted_address
      });
      if (result.success) {
        briefing = result.briefing;
        console.log(`[BriefingRoute] ✅ Generated briefing - news items: ${briefing.news?.items?.length || 0}`);
      } else {
        console.warn(`[BriefingRoute] ⚠️ Briefing generation returned success=false`);
      }
    }
    
    const newsData = briefing?.news || { items: [], filtered: [] };
    console.log(`[BriefingRoute] ✅ Returning ${newsData.items?.length || 0} news items`);
    
    res.json({
      success: true,
      news: newsData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[BriefingRoute] Error fetching rideshare news:', error);
    res.status(500).json({ error: error.message });
  }
});

// Component-level endpoint: Local Events, Live Music & Concerts (single request with Places API resolution)
router.get('/events/:snapshotId', requireAuth, async (req, res) => {
  try {
    const { snapshotId } = req.params;
    const snapshotCheck = await db.select().from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
    
    // SECURITY: Verify snapshot exists AND belongs to the user
    if (snapshotCheck.length === 0 || snapshotCheck[0].user_id !== req.auth.userId) {
      return res.status(404).json({ error: 'snapshot_not_found' });
    }
    
    const snapshot = snapshotCheck[0];
    let briefing = await getBriefingBySnapshotId(snapshotId);
    
    // Auto-generate if briefing doesn't exist
    if (!briefing) {
      const result = await generateAndStoreBriefing({
        snapshotId: snapshot.snapshot_id,
        lat: snapshot.lat,
        lng: snapshot.lng,
        city: snapshot.city,
        state: snapshot.state,
        country: snapshot.country,
        formattedAddress: snapshot.formatted_address
      });
      if (result.success) briefing = result.briefing;
    }
    
    const allEvents = briefing && Array.isArray(briefing.events) ? briefing.events : [];
    res.json({
      success: true,
      events: allEvents,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[BriefingRoute] Error fetching events:', error);
    res.status(500).json({ error: error.message });
  }
});

// Component-level endpoint: School Closures only
router.get('/school-closures/:snapshotId', requireAuth, async (req, res) => {
  try {
    const { snapshotId } = req.params;
    const snapshotCheck = await db.select().from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
    
    // SECURITY: Verify snapshot exists AND belongs to the user
    if (snapshotCheck.length === 0 || snapshotCheck[0].user_id !== req.auth.userId) {
      return res.status(404).json({ error: 'snapshot_not_found' });
    }
    
    const snapshot = snapshotCheck[0];
    let briefing = await getBriefingBySnapshotId(snapshotId);
    
    // Auto-generate if briefing doesn't exist
    if (!briefing) {
      const result = await generateAndStoreBriefing({
        snapshotId: snapshot.snapshot_id,
        lat: snapshot.lat,
        lng: snapshot.lng,
        city: snapshot.city,
        state: snapshot.state,
        country: snapshot.country,
        formattedAddress: snapshot.formatted_address
      });
      if (result.success) briefing = result.briefing;
    }
    
    res.json({
      success: true,
      school_closures: briefing?.school_closures || [],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[BriefingRoute] Error fetching school closures:', error);
    res.status(500).json({ error: error.message });
  }
});

// Confirm TBD event details endpoint
router.post('/confirm-event-details', requireAuth, async (req, res) => {
  try {
    const { events } = req.body;
    
    if (!events || !Array.isArray(events)) {
      return res.status(400).json({ error: 'events array is required' });
    }

    console.log(`[BriefingRoute] Confirming TBD details for ${events.length} events`);
    const confirmed = await confirmTBDEventDetails(events);

    res.json({
      success: true,
      confirmed_events: confirmed
    });
  } catch (error) {
    console.error('[BriefingRoute] Error confirming event details:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
