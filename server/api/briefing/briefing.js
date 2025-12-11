import { Router } from 'express';
import { generateAndStoreBriefing, getBriefingBySnapshotId, getOrGenerateBriefing, confirmTBDEventDetails, fetchWeatherConditions } from '../../lib/briefing/briefing-service.js';
import { db } from '../../db/drizzle.js';
import { snapshots } from '../../../shared/schema.js';
import { eq, desc } from 'drizzle-orm';
import { requireAuth } from '../../middleware/auth.js';
import { expensiveEndpointLimiter } from '../../middleware/rate-limit.js';
import { requireSnapshotOwnership } from '../../middleware/require-snapshot-ownership.js';

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

router.post('/generate', expensiveEndpointLimiter, requireAuth, async (req, res) => {
  try {
    const { snapshotId } = req.body;

    if (!snapshotId) {
      return res.status(400).json({ error: 'snapshotId is required' });
    }

    const snapshotCheck = await db.select().from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);

    if (snapshotCheck.length === 0 || snapshotCheck[0].user_id !== req.auth.userId) {
      return res.status(404).json({ error: 'snapshot_not_found' });
    }

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

router.get('/snapshot/:snapshotId', requireAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    const briefing = await getBriefingBySnapshotId(req.snapshot.snapshot_id);

    if (!briefing) {
      return res.status(404).json({ error: 'Briefing not yet generated - please wait a moment' });
    }

    res.json({
      snapshot_id: req.snapshot.snapshot_id,
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

router.post('/refresh', expensiveEndpointLimiter, requireAuth, async (req, res) => {
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

    res.json({ success: true, traffic });
  } catch (error) {
    console.error('[BriefingRoute] Error fetching realtime traffic:', error);
    res.status(500).json({ error: error.message });
  }
});

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

    res.json({ success: true, weather });
  } catch (error) {
    console.error('[BriefingRoute] Error fetching realtime weather:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/weather/:snapshotId', requireAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    const freshWeather = await fetchWeatherConditions({ snapshot: req.snapshot });

    const weatherResponse = freshWeather ? {
      current: {
        tempF: freshWeather.tempF || null,
        conditions: freshWeather.conditions || null,
        humidity: freshWeather.humidity || null,
        windDirection: freshWeather.windDirection || null,
        isDaytime: freshWeather.isDaytime !== undefined ? freshWeather.isDaytime : null
      },
      forecast: freshWeather.forecast || []
    } : { current: null, forecast: [] };

    res.json({
      success: true,
      weather: weatherResponse,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[BriefingRoute] Error fetching weather:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/traffic/:snapshotId', requireAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    const briefing = await getOrGenerateBriefing(req.snapshot.snapshot_id, req.snapshot);

    res.json({
      success: true,
      traffic: briefing?.traffic_conditions || { summary: 'Loading traffic...', incidents: [], congestionLevel: 'low' },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[BriefingRoute] Error fetching traffic:', error);
    res.json({
      success: true,
      traffic: { summary: 'Loading traffic...', incidents: [], congestionLevel: 'low' },
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/rideshare-news/:snapshotId', requireAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    const briefing = await getOrGenerateBriefing(req.snapshot.snapshot_id, req.snapshot);
    const newsData = briefing?.news || { items: [], filtered: [] };

    console.log(`[BriefingRoute] 📰 News endpoint - briefing exists: ${!!briefing}, news: ${JSON.stringify(newsData).substring(0, 200)}`);

    res.json({
      success: true,
      news: newsData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[BriefingRoute] Error fetching rideshare news:', error);
    res.json({
      success: true,
      news: { items: [], filtered: [] },
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/events/:snapshotId', requireAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    const briefing = await getOrGenerateBriefing(req.snapshot.snapshot_id, req.snapshot);
    
    // Handle both array format and {items: [], reason: string} format
    let allEvents = [];
    let reason = null;
    if (Array.isArray(briefing?.events)) {
      allEvents = briefing.events;
    } else if (briefing?.events?.items && Array.isArray(briefing.events.items)) {
      allEvents = briefing.events.items;
      reason = briefing.events.reason || null;
    }

    console.log(`[BriefingRoute] 📍 Events endpoint - returning:`, {
      hasEvents: !!briefing?.events,
      eventsLength: allEvents.length,
      reason,
      firstEvent: allEvents[0] ? { title: allEvents[0].title, venue: allEvents[0].venue } : null
    });

    res.json({
      success: true,
      events: allEvents,
      reason,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[BriefingRoute] Error fetching events:', error);
    res.json({
      success: true,
      events: [],
      reason: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/school-closures/:snapshotId', requireAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    const briefing = await getOrGenerateBriefing(req.snapshot.snapshot_id, req.snapshot);

    console.log(`[BriefingRoute] 🏫 School closures endpoint - briefing exists: ${!!briefing}, closures: ${JSON.stringify(briefing?.school_closures).substring(0, 200)}`);

    // Handle both array format and {items: [], reason: string} format
    let closures = [];
    let reason = null;
    if (Array.isArray(briefing?.school_closures)) {
      closures = briefing.school_closures;
    } else if (briefing?.school_closures?.items && Array.isArray(briefing.school_closures.items)) {
      closures = briefing.school_closures.items;
      reason = briefing.school_closures.reason || null;
    } else if (briefing?.school_closures?.reason) {
      reason = briefing.school_closures.reason;
    }

    res.json({
      success: true,
      school_closures: closures,
      reason,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[BriefingRoute] Error fetching school closures:', error);
    res.json({
      success: true,
      school_closures: [],
      reason: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

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