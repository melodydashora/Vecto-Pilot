import { Router } from 'express';
import { generateAndStoreBriefing, getBriefingBySnapshotId, fetchTrafficConditions, fetchWeatherConditions } from '../lib/briefing-service.js';
import { db } from '../db/drizzle.js';
import { snapshots, users } from '../../shared/schema.js';
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
    let briefing = await getBriefingBySnapshotId(snapshot.snapshot_id);

    if (!briefing) {
      const result = await generateAndStoreBriefing({
        snapshotId: snapshot.snapshot_id,
        lat: snapshot.lat,
        lng: snapshot.lng,
        city: snapshot.city,
        state: snapshot.state,
        country: snapshot.country
      });
      
      if (result.success) {
        briefing = result.briefing;
      } else {
        return res.status(500).json({ error: result.error });
      }
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
    const { snapshotId, lat, lng, city, state, country } = req.body;

    if (!snapshotId) {
      return res.status(400).json({ error: 'snapshotId is required' });
    }

    const result = await generateAndStoreBriefing({
      snapshotId,
      lat,
      lng,
      city,
      state,
      country
    });

    if (result.success) {
      res.json({
        success: true,
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
    console.error('[BriefingRoute] Error generating briefing:', error);
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
    let briefing = await getBriefingBySnapshotId(snapshotId);

    if (!briefing) {
      // Auto-generate briefing if it doesn't exist
      const snapshot = await db.select()
        .from(snapshots)
        .where(eq(snapshots.snapshot_id, snapshotId))
        .limit(1);

      if (snapshot.length === 0) {
        return res.status(404).json({ error: 'Snapshot not found' });
      }

      const snapshotData = snapshot[0];
      
      // If snapshot has null location, try to get user's latest location
      let { lat, lng, city, state, country } = snapshotData;
      
      if (!lat || !lng || !city || !state) {
        if (snapshotData.user_id) {
          const userLocation = await db.select()
            .from(users)
            .where(eq(users.user_id, snapshotData.user_id))
            .limit(1);
          
          if (userLocation.length > 0) {
            const userLoc = userLocation[0];
            lat = lat || userLoc.lat;
            lng = lng || userLoc.lng;
            city = city || userLoc.city;
            state = state || userLoc.state;
          }
        }
      }
      
      // Check again - if we still have no location, we can't generate briefing
      if (!lat || !lng) {
        return res.status(400).json({ error: 'Cannot generate briefing - no location data available for this snapshot' });
      }
      
      const result = await generateAndStoreBriefing({
        snapshotId,
        lat,
        lng,
        city: city || 'Unknown',
        state: state || '',
        country: country || 'US'
      });

      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }

      briefing = result.briefing;
    }

    res.json({
      snapshot_id: snapshotId,
      location: {
        city: briefing.city,
        state: briefing.state,
        lat: briefing.lat,
        lng: briefing.lng
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
    
    const result = await generateAndStoreBriefing({
      snapshotId: snapshot.snapshot_id,
      lat: snapshot.lat,
      lng: snapshot.lng,
      city: snapshot.city,
      state: snapshot.state
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
router.get('/traffic/realtime', async (req, res) => {
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
router.get('/weather/realtime', async (req, res) => {
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

export default router;
