import { Router } from 'express';
import { generateAndStoreBriefing, getBriefingBySnapshotId, getOrGenerateBriefing, confirmTBDEventDetails, fetchWeatherConditions } from '../../lib/briefing/briefing-service.js';
import { db } from '../../db/drizzle.js';
import { snapshots, discovered_events } from '../../../shared/schema.js';
import { eq, desc, and, gte, lte } from 'drizzle-orm';
import { requireAuth, optionalAuth } from '../../middleware/auth.js';
import { expensiveEndpointLimiter } from '../../middleware/rate-limit.js';
import { requireSnapshotOwnership } from '../../middleware/require-snapshot-ownership.js';
import { syncEventsForLocation } from '../../scripts/sync-events.mjs';

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
        school_closures: briefing.school_closures,
        airport_conditions: briefing.airport_conditions
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
        events: briefing.events,
        school_closures: briefing.school_closures,
        airport_conditions: briefing.airport_conditions
      }
    });
  } catch (error) {
    console.error('[BriefingRoute] Error retrieving briefing:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/snapshot/:snapshotId', optionalAuth, requireSnapshotOwnership, async (req, res) => {
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
        school_closures: briefing.school_closures,
        airport_conditions: briefing.airport_conditions
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
          events: result.briefing.events,
          school_closures: result.briefing.school_closures,
          airport_conditions: result.briefing.airport_conditions
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

router.get('/weather/:snapshotId', optionalAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    // LESSON LEARNED (Dec 2025): Weather should read from cached briefing data first,
    // just like traffic/news/airport endpoints do. This prevents excessive API calls
    // and ensures consistent behavior across all briefing endpoints.
    const briefing = await getBriefingBySnapshotId(req.snapshot.snapshot_id);

    // If we have cached weather in briefings table, return it
    if (briefing?.weather_current) {
      console.log(`[BriefingRoute] ✅ Weather: returning cached data for ${req.snapshot.snapshot_id.slice(0, 8)}`);
      return res.json({
        success: true,
        weather: {
          current: briefing.weather_current,
          forecast: briefing.weather_forecast || []
        },
        timestamp: new Date().toISOString()
      });
    }

    // No cached weather - fetch fresh (this should be rare, only on first request)
    console.log(`[BriefingRoute] ⚡ Weather: no cached data, fetching fresh for ${req.snapshot.snapshot_id.slice(0, 8)}`);
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

router.get('/traffic/:snapshotId', optionalAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    // FETCH-ONCE: Just read cached data from DB - no refresh, no regeneration
    // Traffic is generated once during pipeline and stays until new snapshot
    const briefing = await getBriefingBySnapshotId(req.snapshot.snapshot_id);

    // Fail hard if no data - don't mask with placeholder
    if (!briefing?.traffic_conditions) {
      return res.status(202).json({
        success: false,
        error: 'Traffic data not yet available',
        traffic: null,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      traffic: briefing.traffic_conditions,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[BriefingRoute] Error fetching traffic:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      traffic: null,
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/rideshare-news/:snapshotId', optionalAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    // FETCH-ONCE: Just read cached data from DB
    const briefing = await getBriefingBySnapshotId(req.snapshot.snapshot_id);

    // Fail hard if no data - don't mask with placeholder
    if (!briefing?.news) {
      return res.status(202).json({
        success: false,
        error: 'News data not yet available',
        news: null,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      news: briefing.news,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[BriefingRoute] Error fetching rideshare news:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      news: null,
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/events/:snapshotId', optionalAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    // Read events directly from discovered_events table for this snapshot's location
    const snapshot = req.snapshot;
    const today = new Date().toISOString().split('T')[0];
    const weekFromNow = new Date();
    weekFromNow.setDate(weekFromNow.getDate() + 7);
    const endDate = weekFromNow.toISOString().split('T')[0];

    const events = await db.select()
      .from(discovered_events)
      .where(and(
        eq(discovered_events.city, snapshot.city),
        eq(discovered_events.state, snapshot.state),
        gte(discovered_events.event_date, today),
        lte(discovered_events.event_date, endDate),
        eq(discovered_events.is_active, true)
      ))
      .orderBy(discovered_events.event_date)
      .limit(50);

    // Map to briefing events format
    const allEvents = events.map(e => ({
      title: e.title,
      summary: [e.title, e.venue_name, e.event_date, e.event_time].filter(Boolean).join(' • '),
      impact: e.expected_attendance === 'high' ? 'high' : e.expected_attendance === 'low' ? 'low' : 'medium',
      source: e.source_model,
      event_type: e.category,
      subtype: e.category, // For EventsComponent category grouping
      event_date: e.event_date,
      event_end_date: e.event_end_date, // For multi-day events (e.g., holiday lights Dec 1 - Jan 4)
      event_time: e.event_time,
      event_end_time: e.event_end_time,
      address: e.address,
      venue: e.venue_name,
      location: e.venue_name ? `${e.venue_name}, ${e.address || ''}`.trim() : e.address,
      latitude: e.lat,
      longitude: e.lng
    }));

    res.json({
      success: true,
      events: allEvents,
      reason: allEvents.length === 0 ? 'No events found for this location' : null,
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

router.get('/school-closures/:snapshotId', optionalAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    // FETCH-ONCE: Just read cached data from DB
    const briefing = await getBriefingBySnapshotId(req.snapshot.snapshot_id);

    // Fail hard if no data
    if (!briefing?.school_closures) {
      return res.status(202).json({
        success: false,
        error: 'School closures data not yet available',
        school_closures: null,
        timestamp: new Date().toISOString()
      });
    }

    // Handle both array format and {items: [], reason: string} format
    let closures = [];
    let reason = null;
    if (Array.isArray(briefing.school_closures)) {
      closures = briefing.school_closures;
    } else if (briefing.school_closures?.items && Array.isArray(briefing.school_closures.items)) {
      closures = briefing.school_closures.items;
      reason = briefing.school_closures.reason || null;
    } else if (briefing.school_closures?.reason) {
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
    res.status(500).json({
      success: false,
      error: error.message,
      school_closures: null,
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/airport/:snapshotId', optionalAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    // FETCH-ONCE: Just read cached airport data from DB
    const briefing = await getBriefingBySnapshotId(req.snapshot.snapshot_id);

    // Fail hard if no data
    if (!briefing?.airport_conditions) {
      return res.status(202).json({
        success: false,
        error: 'Airport data not yet available',
        airport_conditions: null,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      airport_conditions: briefing.airport_conditions,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[BriefingRoute] Error fetching airport conditions:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      airport_conditions: null,
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

/**
 * POST /api/briefing/discover-events/:snapshotId
 * On-demand event discovery using all AI models (daily mode)
 *
 * Called when user clicks "Discover Events" button in BriefingTab.
 * Uses: snapshot location → SerpAPI + GPT-5.2 + Gemini + Claude + Perplexity → discovered_events table
 *
 * Query params:
 *   - daily=true: Run ALL models (default)
 *   - daily=false: Run only SerpAPI + GPT-5.2
 *
 * Returns:
 *   - 200: { ok: true, events: [...], inserted: N, skipped: N }
 *   - 404: { error: "snapshot_not_found" }
 */
router.post('/discover-events/:snapshotId', expensiveEndpointLimiter, requireAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    const snapshot = req.snapshot;
    const isDaily = req.query.daily !== 'false'; // Default to daily (all models)

    console.log(`[BriefingRoute] POST /discover-events/${snapshot.snapshot_id} - isDaily=${isDaily}`);
    console.log(`[BriefingRoute] Location: ${snapshot.city}, ${snapshot.state} (${snapshot.lat}, ${snapshot.lng})`);

    // Run event discovery with snapshot location
    const result = await syncEventsForLocation({
      city: snapshot.city,
      state: snapshot.state,
      lat: snapshot.lat,
      lng: snapshot.lng
    }, isDaily);

    console.log(`[BriefingRoute] ✅ Event discovery complete: ${result.events.length} found, ${result.inserted} inserted`);

    // Return discovered events
    res.json({
      ok: true,
      snapshot_id: snapshot.snapshot_id,
      mode: isDaily ? 'daily' : 'normal',
      total_discovered: result.events.length,
      inserted: result.inserted,
      skipped: result.skipped,
      events: result.events.slice(0, 50) // Return first 50 for display
    });
  } catch (error) {
    console.error('[BriefingRoute] Error discovering events:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/briefing/discovered-events/:snapshotId
 * Fetch discovered events from database for snapshot's location
 *
 * Returns events within same city/state, for next 7 days
 */
/**
 * PATCH /api/briefing/event/:eventId/deactivate
 * Deactivate an event (hide from Map tab)
 *
 * Used by AI Coach when driver reports event is over, cancelled, or incorrect.
 * Body: { reason: 'event_ended' | 'incorrect_time' | 'no_longer_relevant' | 'cancelled' | 'duplicate' | 'other', notes?: string }
 */
router.patch('/event/:eventId/deactivate', requireAuth, async (req, res) => {
  try {
    const { eventId } = req.params;
    const { reason, notes, correctedTime, correctedEndTime } = req.body;

    if (!eventId) {
      return res.status(400).json({ error: 'eventId is required' });
    }

    const validReasons = ['event_ended', 'incorrect_time', 'no_longer_relevant', 'cancelled', 'duplicate', 'other'];
    if (!reason || !validReasons.includes(reason)) {
      return res.status(400).json({
        error: 'Valid reason required',
        validReasons
      });
    }

    // Find the event
    const [event] = await db.select()
      .from(discovered_events)
      .where(eq(discovered_events.id, eventId))
      .limit(1);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Build update payload
    const updatePayload = {
      is_active: false,
      deactivation_reason: notes ? `${reason}: ${notes}` : reason,
      deactivated_at: new Date(),
      deactivated_by: req.auth?.userId || 'ai_coach',
      updated_at: new Date()
    };

    // If correcting time data, update those fields too
    if (reason === 'incorrect_time') {
      if (correctedTime) updatePayload.event_time = correctedTime;
      if (correctedEndTime) updatePayload.event_end_time = correctedEndTime;
    }

    // Deactivate the event
    await db.update(discovered_events)
      .set(updatePayload)
      .where(eq(discovered_events.id, eventId));

    console.log(`[BriefingRoute] ✅ Event deactivated: ${event.title} (${reason})`);

    res.json({
      ok: true,
      event_id: eventId,
      title: event.title,
      reason,
      deactivated_at: updatePayload.deactivated_at,
      message: `Event "${event.title}" has been marked as inactive and will no longer appear on the map.`
    });
  } catch (error) {
    console.error('[BriefingRoute] Error deactivating event:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/briefing/event/:eventId/reactivate
 * Reactivate a previously deactivated event
 */
router.patch('/event/:eventId/reactivate', requireAuth, async (req, res) => {
  try {
    const { eventId } = req.params;

    // Find the event
    const [event] = await db.select()
      .from(discovered_events)
      .where(eq(discovered_events.id, eventId))
      .limit(1);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Reactivate the event
    await db.update(discovered_events)
      .set({
        is_active: true,
        deactivation_reason: null,
        deactivated_at: null,
        deactivated_by: null,
        updated_at: new Date()
      })
      .where(eq(discovered_events.id, eventId));

    console.log(`[BriefingRoute] ✅ Event reactivated: ${event.title}`);

    res.json({
      ok: true,
      event_id: eventId,
      title: event.title,
      message: `Event "${event.title}" has been reactivated and will appear on the map again.`
    });
  } catch (error) {
    console.error('[BriefingRoute] Error reactivating event:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/discovered-events/:snapshotId', requireAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    const snapshot = req.snapshot;
    const today = new Date().toISOString().split('T')[0];
    const weekFromNow = new Date();
    weekFromNow.setDate(weekFromNow.getDate() + 7);
    const endDate = weekFromNow.toISOString().split('T')[0];

    console.log(`[BriefingRoute] GET /discovered-events for ${snapshot.city}, ${snapshot.state} (${today} to ${endDate})`);

    const events = await db.select()
      .from(discovered_events)
      .where(and(
        eq(discovered_events.city, snapshot.city),
        eq(discovered_events.state, snapshot.state),
        gte(discovered_events.event_date, today),
        lte(discovered_events.event_date, endDate),
        eq(discovered_events.is_active, true)
      ))
      .orderBy(discovered_events.event_date)
      .limit(100);

    res.json({
      ok: true,
      snapshot_id: snapshot.snapshot_id,
      location: { city: snapshot.city, state: snapshot.state },
      date_range: { start: today, end: endDate },
      count: events.length,
      events
    });
  } catch (error) {
    console.error('[BriefingRoute] Error fetching discovered events:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;