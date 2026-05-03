import { Router } from 'express';
import crypto from 'crypto';
// 2026-04-04: FIX C-2 — Added fetchTrafficConditions (was missing, causing ReferenceError on /traffic/realtime)
import { generateAndStoreBriefing, getBriefingBySnapshotId, getOrGenerateBriefing } from '../../lib/briefing/briefing-aggregator.js';
import { filterInvalidEvents } from '../../lib/briefing/pipelines/events.js';
import { fetchWeatherConditions } from '../../lib/briefing/pipelines/weather.js';
import { fetchTrafficConditions } from '../../lib/briefing/pipelines/traffic.js';
import { fetchRideshareNews } from '../../lib/briefing/pipelines/news.js';
import { db } from '../../db/drizzle.js';
import { snapshots, discovered_events, news_deactivations, briefings, market_cities, venue_catalog } from '../../../shared/schema.js';
import { eq, desc, and, gte, lte, ilike, not, or, sql } from 'drizzle-orm';
import { requireAuth } from '../../middleware/auth.js';
import { expensiveEndpointLimiter } from '../../middleware/rate-limit.js';
import { requireSnapshotOwnership } from '../../middleware/require-snapshot-ownership.js';
import { filterFreshEvents, filterFreshNews } from '../../lib/strategy/strategy-utils.js';
// 2026-04-28: Added chainLog import to fix the broken `briefingLog ?? console.error`
// expression at the market-events catch handler below — see edit at line ~466.
import { chainLog, matrixLog } from '../../logger/workflow.js';

// 2026-04-05: Self-healing for zombie placeholder rows.
// When a briefing generation crashes (e.g., RC-1 db.execute destructuring bug), the
// placeholder row stays in the DB with NULL fields forever. GET endpoints detect this
// stale state and trigger background regeneration so the next client retry gets real data.
// Threshold: 2 minutes — anything newer might still be actively generating.
const ZOMBIE_THRESHOLD_MS = 2 * 60 * 1000;
// Track in-flight zombie recoveries to avoid duplicate triggers
const zombieRecoveryInFlight = new Set();

function triggerZombieRecoveryIfNeeded(briefing, snapshot) {
  if (!briefing || !snapshot) return;
  const snapshotId = snapshot.snapshot_id;

  // Already recovering this snapshot
  if (zombieRecoveryInFlight.has(snapshotId)) return;

  // Check if row is stale (old updated_at + NULL fields = zombie)
  const ageMs = Date.now() - new Date(briefing.updated_at).getTime();
  if (ageMs < ZOMBIE_THRESHOLD_MS) return; // Still fresh — might be generating

  // Check if key fields are NULL (zombie) or error-marked
  const hasTraffic = briefing.traffic_conditions && !briefing.traffic_conditions._generationFailed;
  const hasNews = briefing.news && !briefing.news._generationFailed;
  const hasAirport = briefing.airport_conditions && !briefing.airport_conditions._generationFailed;

  if (hasTraffic && hasNews && hasAirport) return; // Data exists — not a zombie

  // Trigger background regeneration
  console.log(`[BRIEFING] Zombie recovery: triggering regeneration for ${snapshotId.slice(0, 8)} (age: ${Math.round(ageMs / 1000)}s)`);
  zombieRecoveryInFlight.add(snapshotId);
  generateAndStoreBriefing({ snapshotId, snapshot })
    .then((result) => {
      console.log(`[BRIEFING] Zombie recovery complete for ${snapshotId.slice(0, 8)}: success=${result?.success}`);
    })
    .catch((err) => {
      console.error(`[BRIEFING] Zombie recovery failed for ${snapshotId.slice(0, 8)}: ${err.message}`);
    })
    .finally(() => {
      zombieRecoveryInFlight.delete(snapshotId);
    });
}

/**
 * Normalize a news title for hash matching
 * Strips common prefixes like "URGENT:", "BREAKING:", etc.
 * @param {string} title - Original title
 * @returns {string} Normalized title
 */
function normalizeNewsTitle(title) {
  if (!title) return '';
  // Strip common urgency prefixes for consistent matching
  return title
    .replace(/^(URGENT|BREAKING|ALERT|UPDATE|DEVELOPING|JUST IN):\s*/i, '')
    .trim();
}

/**
 * Generate a hash for news item matching
 * Uses normalized title to handle prefix variations
 * @param {string} title - News title
 * @param {string} source - News source
 * @param {string} date - News date
 * @returns {string} MD5 hash
 */
function generateNewsHash(title, source, date) {
  const normalizedTitle = normalizeNewsTitle(title);
  const normalized = `${normalizedTitle}_${source || ''}_${date || ''}`.toLowerCase().trim();
  return crypto.createHash('md5').update(normalized).digest('hex');
}

/**
 * Get deactivated news hashes for a user
 * @param {string} userId - User ID
 * @returns {Promise<Set<string>>} Set of deactivated news hashes
 */
async function getDeactivatedNewsHashes(userId) {
  if (!userId) return new Set();

  try {
    const deactivations = await db
      .select({ news_hash: news_deactivations.news_hash })
      .from(news_deactivations)
      .where(eq(news_deactivations.user_id, userId));

    return new Set(deactivations.map(d => d.news_hash));
  } catch (error) {
    console.error('[BRIEFING] getDeactivatedNewsHashes error:', error);
    return new Set();
  }
}

const router = Router();

/**
 * Parse event time string (e.g., "7:00 PM", "19:00", "7pm") into a Date object
 * @param {string} timeStr - Time string in various formats
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @param {string} timezone - IANA timezone (e.g., 'America/Chicago')
 * @returns {Date|null} - Date object in UTC, or null if parsing fails
 */
function parseEventTime(timeStr, dateStr, timezone) {
  if (!timeStr || !dateStr) return null;

  try {
    // Normalize time string
    let normalized = timeStr.trim().toUpperCase();

    // Handle 12-hour format (7:00 PM, 7pm, 7:30 am)
    const match12h = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);
    if (match12h) {
      let hours = parseInt(match12h[1], 10);
      const minutes = parseInt(match12h[2] || '0', 10);
      const period = match12h[3];

      if (period === 'PM' && hours !== 12) hours += 12;
      if (period === 'AM' && hours === 12) hours = 0;

      // Create date string for parsing
      const timeFormatted = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
      const dateTimeStr = `${dateStr}T${timeFormatted}`;

      // Parse in the venue's timezone
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      });

      // Create Date in venue timezone and convert to UTC
      const localDate = new Date(dateTimeStr);
      // Adjust for timezone offset
      const tzOffset = getTimezoneOffset(dateTimeStr, timezone);
      return new Date(localDate.getTime() + tzOffset);
    }

    // Handle 24-hour format (19:00, 07:30)
    const match24h = normalized.match(/^(\d{1,2}):(\d{2})$/);
    if (match24h) {
      const hours = parseInt(match24h[1], 10);
      const minutes = parseInt(match24h[2], 10);
      const timeFormatted = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
      const dateTimeStr = `${dateStr}T${timeFormatted}`;
      const localDate = new Date(dateTimeStr);
      const tzOffset = getTimezoneOffset(dateTimeStr, timezone);
      return new Date(localDate.getTime() + tzOffset);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Get timezone offset in milliseconds for a given datetime and timezone
 */
function getTimezoneOffset(dateTimeStr, timezone) {
  const date = new Date(dateTimeStr);
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  return utcDate - tzDate;
}

/**
 * Check if an event is currently active (happening now)
 * @param {Object} event - Event object with event_start_date, event_start_time, event_end_time, event_end_date
 * @param {Date} now - Current time
 * @param {string} timezone - IANA timezone for the event
 * @returns {boolean} - True if event is currently happening
 */
function isEventActiveNow(event, now, timezone) {
  // Get today's date in the event's timezone
  const today = now.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD format

  // 2026-01-10: Use symmetric field names (support both old and new during migration)
  const eventStartDate = event.event_start_date || event.event_date;
  const eventEndDate = event.event_end_date || eventStartDate;

  if (!eventStartDate) return false;
  if (today < eventStartDate || today > eventEndDate) return false;

  // Parse start and end times
  const eventStartTime = event.event_start_time || event.event_time;
  const startTime = parseEventTime(eventStartTime || '00:00', eventStartDate, timezone);
  const endTime = parseEventTime(event.event_end_time || '23:59', eventEndDate, timezone);

  // If we couldn't parse times, check if date matches (assume all-day event)
  if (!startTime || !endTime) {
    return today >= eventStartDate && today <= eventEndDate;
  }

  // Check if current time is within the event duration
  return now >= startTime && now <= endTime;
}

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

    // Filter stale events from briefing data (2026-01-05)
    // 2026-01-05: Pass snapshot timezone for proper local time parsing
    // 2026-01-09: NO FALLBACKS - fail explicitly if timezone is missing
    if (!snapshot.timezone) {
      console.error('[BRIEFING] CRITICAL: Snapshot missing timezone', { snapshot_id: snapshot.snapshot_id });
      return res.status(500).json({ error: 'Snapshot timezone is required but missing - this is a data integrity bug' });
    }
    const tz = snapshot.timezone;
    const freshEvents = filterFreshEvents(
      Array.isArray(briefing.events) ? briefing.events : briefing.events?.items || [],
      new Date(),
      tz
    );

    // Filter stale news - only today's news with valid publication dates (2026-01-05)
    const newsItems = Array.isArray(briefing.news) ? briefing.news : briefing.news?.items || [];
    const freshNews = filterFreshNews(newsItems, new Date(), tz);

    res.json({
      snapshot_id: snapshot.snapshot_id,
      location: {
        city: snapshot.city,
        state: snapshot.state,
        lat: snapshot.lat,
        lng: snapshot.lng
      },
      briefing: {
        news: freshNews,
        weather: {
          current: briefing.weather_current,
          forecast: briefing.weather_forecast
        },
        traffic: briefing.traffic_conditions,
        events: freshEvents,
        school_closures: briefing.school_closures,
        airport_conditions: briefing.airport_conditions
      },
      created_at: briefing.created_at,
      updated_at: briefing.updated_at
    });
  } catch (error) {
    console.error('[BRIEFING] Error fetching current briefing:', error);
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

    // Filter stale events from briefing data (2026-01-05)
    // 2026-01-05: Pass snapshot timezone for proper local time parsing
    // 2026-01-09: NO FALLBACKS - fail explicitly if timezone is missing
    const snapshot = snapshotCheck[0];
    if (!snapshot.timezone) {
      console.error('[BRIEFING] CRITICAL: Snapshot missing timezone', { snapshot_id: snapshot.snapshot_id });
      return res.status(500).json({ error: 'Snapshot timezone is required but missing - this is a data integrity bug' });
    }
    const tz2 = snapshot.timezone;
    const freshEvents = filterFreshEvents(
      Array.isArray(briefing.events) ? briefing.events : briefing.events?.items || [],
      new Date(),
      tz2
    );

    // Filter stale news - only today's news with valid publication dates (2026-01-05)
    const newsItems = Array.isArray(briefing.news) ? briefing.news : briefing.news?.items || [];
    const freshNews = filterFreshNews(newsItems, new Date(), tz2);

    res.json({
      success: true,
      briefing: {
        news: freshNews,
        weather: {
          current: briefing.weather_current,
          forecast: briefing.weather_forecast
        },
        traffic: briefing.traffic_conditions,
        events: freshEvents,
        school_closures: briefing.school_closures,
        airport_conditions: briefing.airport_conditions
      }
    });
  } catch (error) {
    console.error('[BRIEFING] Error retrieving briefing:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2026-04-18: AGGREGATE endpoint — returns the entire briefing row in ONE round-trip.
// Purpose: collapse the 6-way race in the UI (weather/traffic/events/news/airport/
// school-closures were each fetched separately with independent retry states, causing
// the briefing tab to desync from what the strategist actually received). One query
// returns everything, so the tab can be a true transparency window onto Phase 1 data.
//
// Per-section _generationFailed sentinels are surfaced inline so the UI can render
// a "this section failed" state instead of staying in perpetual loading.
//
// Phase B of the briefing UI restoration plan:
//   B (this): single aggregate fetch — eliminates UI-level race
//   A (next): progressive writes + per-section NOTIFYs — restores streaming UX
router.get('/snapshot/:snapshotId', requireAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    const briefing = await getBriefingBySnapshotId(req.snapshot.snapshot_id);

    if (!briefing) {
      return res.status(404).json({ error: 'Briefing not yet generated - please wait a moment' });
    }

    // 2026-01-09: NO FALLBACKS - fail explicitly if timezone is missing
    if (!req.snapshot.timezone) {
      console.error('[BRIEFING] CRITICAL: Snapshot missing timezone', { snapshot_id: req.snapshot.snapshot_id });
      return res.status(500).json({ error: 'Snapshot timezone is required but missing - this is a data integrity bug' });
    }
    const tz3 = req.snapshot.timezone;

    // Per-section generation-failure detection — mirrors each individual endpoint's
    // sentinel handling so the aggregate response has the same guarantees.
    const sectionFailed = (v) => !!(v && typeof v === 'object' && v._generationFailed);

    // Filter stale events from briefing data (2026-01-05)
    const rawLocalEvents = Array.isArray(briefing.events)
      ? briefing.events
      : (briefing.events?.items || []);
    const localEventsFailed = sectionFailed(briefing.events);
    const freshEvents = localEventsFailed ? [] : filterFreshEvents(rawLocalEvents, new Date(), tz3);

    // Filter stale news - only today's news with valid publication dates (2026-01-05)
    const newsFailed = sectionFailed(briefing.news);
    const rawNewsItems = Array.isArray(briefing.news) ? briefing.news : (briefing.news?.items || []);
    const freshNews = newsFailed ? [] : filterFreshNews(rawNewsItems, new Date(), tz3);

    // 2026-04-18: Market-wide events lookup — high-value events from other cities in
    // the driver's metro. Ported from /events/:snapshotId so the aggregate endpoint
    // returns the same events data the per-section endpoint did.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz3 });
    const endDateObj = new Date();
    endDateObj.setDate(endDateObj.getDate() + 7);
    const endDate = endDateObj.toLocaleDateString('en-CA', { timeZone: tz3 });

    let marketEvents = [];
    let marketName = null;
    try {
      const stateCondition = req.snapshot.state.length === 2
        ? eq(market_cities.state_abbr, req.snapshot.state.toUpperCase())
        : ilike(market_cities.state, req.snapshot.state);
      const [marketMapping] = await db
        .select()
        .from(market_cities)
        .where(and(ilike(market_cities.city, req.snapshot.city), stateCondition))
        .limit(1);
      if (marketMapping) {
        marketName = marketMapping.market_name;
        const otherMarketCities = await db
          .select({ city: market_cities.city, state: market_cities.state })
          .from(market_cities)
          .where(and(
            eq(market_cities.market_name, marketMapping.market_name),
            not(ilike(market_cities.city, req.snapshot.city))
          ));
        if (otherMarketCities.length > 0) {
          const cityConditions = otherMarketCities.map(c =>
            and(ilike(discovered_events.city, c.city), ilike(discovered_events.state, c.state))
          );
          const rawMarketEvents = await db.select({
            id: discovered_events.id,
            title: discovered_events.title,
            venue_name: discovered_events.venue_name,
            address: discovered_events.address,
            city: discovered_events.city,
            state: discovered_events.state,
            event_start_date: discovered_events.event_start_date,
            event_end_date: discovered_events.event_end_date,
            event_start_time: discovered_events.event_start_time,
            event_end_time: discovered_events.event_end_time,
            category: discovered_events.category,
            expected_attendance: discovered_events.expected_attendance,
            venue_lat: venue_catalog.lat,
            venue_lng: venue_catalog.lng,
          })
            .from(discovered_events)
            .leftJoin(venue_catalog, eq(discovered_events.venue_id, venue_catalog.venue_id))
            .where(and(
              or(...cityConditions),
              or(
                eq(discovered_events.expected_attendance, 'high'),
                sql`${discovered_events.category} IN ('sports', 'concert', 'festival')`
              ),
              gte(discovered_events.event_start_date, today),
              lte(discovered_events.event_start_date, endDate),
              eq(discovered_events.is_active, true)
            ))
            .orderBy(discovered_events.event_start_date)
            .limit(20);
          marketEvents = rawMarketEvents.map(e => ({
            title: e.title,
            summary: [e.title, e.venue_name, e.event_start_date, e.event_start_time].filter(Boolean).join(' • '),
            impact: 'high',
            source: 'discovered',
            event_type: e.category,
            subtype: e.category,
            event_start_date: e.event_start_date,
            event_end_date: e.event_end_date,
            event_start_time: e.event_start_time,
            event_end_time: e.event_end_time,
            address: e.address,
            venue: e.venue_name,
            location: e.venue_name ? `${e.venue_name}, ${e.address || ''}`.trim() : e.address,
            latitude: e.venue_lat,
            longitude: e.venue_lng,
            city: e.city,
          }));
          marketEvents = filterFreshEvents(marketEvents, new Date(), tz3);
        }
      }
    } catch (marketErr) {
      // 2026-04-28: Replaced broken `briefingLog ?? console.error(...)` expression.
      // Two bugs in the previous line: (1) `briefingLog` was never imported in this
      // file, so the `??` left-operand threw ReferenceError inside the catch and
      // propagated to the outer 500 handler, masking the actual marketErr; (2) the
      // `??` operator short-circuits on truthy values — even if briefingLog had been
      // imported, console.error would never have fired as a fallback. Replaced with
      // chainLog so this emit goes through the workflow logger control plane (per
      // the canonical chain template, claude_memory #229).
      chainLog(
        { parent: 'BRIEFING', sub: 'EVENTS', callTypes: ['DB'], table: 'market_events', callName: 'lookup' },
        `Market events lookup failed (non-fatal): ${marketErr.message}`
      );
    }

    res.json({
      snapshot_id: req.snapshot.snapshot_id,
      briefing: {
        weather: {
          current: briefing.weather_current,
          forecast: briefing.weather_forecast,
          _generationFailed: sectionFailed(briefing.weather_current),
        },
        traffic: {
          ...(briefing.traffic_conditions || {}),
          _generationFailed: sectionFailed(briefing.traffic_conditions),
        },
        news: {
          items: freshNews,
          reason: newsFailed
            ? (briefing.news?.error || 'News generation failed')
            : (briefing.news?.reason || (freshNews.length === 0 ? 'No rideshare news for this area' : null)),
          _generationFailed: newsFailed,
        },
        events: {
          items: freshEvents,
          marketEvents,
          market_name: marketName,
          reason: localEventsFailed
            ? (briefing.events?.error || 'Events generation failed')
            : (briefing.events?.reason || (freshEvents.length === 0 ? 'No events found for this location' : null)),
          _generationFailed: localEventsFailed,
        },
        school_closures: {
          items: Array.isArray(briefing.school_closures)
            ? briefing.school_closures
            : (briefing.school_closures?.items || []),
          reason: briefing.school_closures?.reason || null,
          _generationFailed: sectionFailed(briefing.school_closures),
        },
        airport_conditions: {
          ...(briefing.airport_conditions || {}),
          _generationFailed: sectionFailed(briefing.airport_conditions),
        },
      },
      created_at: briefing.created_at,
      updated_at: briefing.updated_at,
      generated_at: briefing.generated_at,
    });
  } catch (error) {
    console.error('[BRIEFING] Error fetching briefing aggregate:', error);
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
      // Filter stale events from refreshed briefing data (2026-01-05)
      // 2026-01-05: Pass snapshot timezone for proper local time parsing
      // 2026-01-09: NO FALLBACKS - fail explicitly if timezone is missing
      if (!snapshot.timezone) {
        console.error('[BRIEFING] CRITICAL: Snapshot missing timezone', { snapshot_id: snapshot.snapshot_id });
        return res.status(500).json({ error: 'Snapshot timezone is required but missing - this is a data integrity bug' });
      }
      const tz4 = snapshot.timezone;
      const freshEvents = filterFreshEvents(
        Array.isArray(result.briefing.events) ? result.briefing.events : result.briefing.events?.items || [],
        new Date(),
        tz4
      );

      // Filter stale news - only today's news with valid publication dates (2026-01-05)
      const newsItems = Array.isArray(result.briefing.news) ? result.briefing.news : result.briefing.news?.items || [];
      const freshNews = filterFreshNews(newsItems, new Date(), tz4);

      res.json({
        success: true,
        refreshed: true,
        briefing: {
          news: freshNews,
          weather: {
            current: result.briefing.weather_current,
            forecast: result.briefing.weather_forecast
          },
          traffic: result.briefing.traffic_conditions,
          events: freshEvents,
          school_closures: result.briefing.school_closures,
          airport_conditions: result.briefing.airport_conditions
        }
      });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (error) {
    console.error('[BRIEFING] Error refreshing briefing:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2026-04-04: FIX C-2 — fetchTrafficConditions expects { snapshot } shape, not flat params.
// Also fixed: removed NO FALLBACKS violations (city || 'Unknown', state || '').
// Added timezone as required param (needed for date calculation inside the function).
router.get('/traffic/realtime', requireAuth, async (req, res) => {
  try {
    const { lat, lng, city, state, timezone } = req.query;

    if (!lat || !lng || !city || !state || !timezone) {
      return res.status(400).json({ error: 'Missing required parameters: lat, lng, city, state, timezone' });
    }

    const traffic = await fetchTrafficConditions({
      snapshot: {
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        city,
        state,
        timezone
      }
    });

    res.json({ success: true, traffic });
  } catch (error) {
    console.error('[BRIEFING] Error fetching realtime traffic:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2026-04-04: FIX C-3 — fetchWeatherConditions expects { snapshot } shape, not { lat, lng }.
// The function accesses snapshot.lat, snapshot.lng, snapshot.country internally.
router.get('/weather/realtime', requireAuth, async (req, res) => {
  try {
    const { lat, lng, country } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'Missing required parameters: lat, lng' });
    }

    const weather = await fetchWeatherConditions({
      snapshot: {
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        country: country || 'US'
      }
    });

    res.json({ success: true, weather });
  } catch (error) {
    console.error('[BRIEFING] Error fetching realtime weather:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/weather/:snapshotId', requireAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    // LESSON LEARNED (Dec 2025): Weather should read from cached briefing data first,
    // just like traffic/news/airport endpoints do. This prevents excessive API calls
    // and ensures consistent behavior across all briefing endpoints.
    const briefing = await getBriefingBySnapshotId(req.snapshot.snapshot_id);

    // If we have cached weather in briefings table, return it
    if (briefing?.weather_current) {
      console.log(`[BRIEFING] Weather: returning cached data for ${req.snapshot.snapshot_id.slice(0, 8)}`);
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
    console.log(`[BRIEFING] ⚡ Weather: no cached data, fetching fresh for ${req.snapshot.snapshot_id.slice(0, 8)}`);
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
    console.error('[BRIEFING] Error fetching weather:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/traffic/:snapshotId', requireAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    // FETCH-ONCE: Just read cached data from DB - no refresh, no regeneration
    // Traffic is generated once during pipeline and stays until new snapshot
    const briefing = await getBriefingBySnapshotId(req.snapshot.snapshot_id);

    // 2026-04-05: Self-heal zombie placeholder rows (NULL fields from crashed generation)
    triggerZombieRecoveryIfNeeded(briefing, req.snapshot);

    // 2026-04-18 Phase 0a: flip 202 → 200 + _coverageEmpty (see FRISCO_LOCK_DIAGNOSIS_2026-04-18.md)
    if (!briefing?.traffic_conditions) {
      return res.status(200).json({
        success: true,
        _coverageEmpty: true,
        reason: 'no_traffic_events',
        timestamp: new Date().toISOString()
      });
    }

    // 2026-04-05: Detect error marker from failed generation — tell client to stop polling
    if (briefing.traffic_conditions._generationFailed) {
      return res.status(200).json({
        success: false,
        _generationFailed: true,
        error: briefing.traffic_conditions.error || 'Briefing generation failed',
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
    console.error('[BRIEFING] Error fetching traffic:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      traffic: null,
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/rideshare-news/:snapshotId', requireAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    // FETCH-ONCE: Just read cached data from DB
    const briefing = await getBriefingBySnapshotId(req.snapshot.snapshot_id);

    // 2026-04-05: Self-heal zombie placeholder rows
    triggerZombieRecoveryIfNeeded(briefing, req.snapshot);

    // 2026-04-18 Phase 0a: flip 202 → 200 + _coverageEmpty (see FRISCO_LOCK_DIAGNOSIS_2026-04-18.md)
    if (!briefing?.news) {
      return res.status(200).json({
        success: true,
        _coverageEmpty: true,
        reason: 'no_rideshare_news',
        timestamp: new Date().toISOString()
      });
    }

    // 2026-04-05: Detect error marker from failed generation
    if (briefing.news._generationFailed) {
      return res.status(200).json({
        success: false,
        _generationFailed: true,
        error: briefing.news.error || 'Briefing generation failed',
        news: null,
        timestamp: new Date().toISOString()
      });
    }

    // Filter out deactivated news items for this user
    const userId = req.auth?.userId;
    let filteredNews = briefing.news;

    if (userId) {
      const deactivatedHashes = await getDeactivatedNewsHashes(userId);

      if (deactivatedHashes.size > 0) {
        // Handle both array format and {items: [...]} format
        const newsItems = Array.isArray(briefing.news) ? briefing.news : briefing.news?.items;

        if (Array.isArray(newsItems)) {
          const originalCount = newsItems.length;
          const filteredItems = newsItems.filter(item => {
            // Generate hash for this news item
            const itemHash = generateNewsHash(item.title, item.source, item.date);
            const isDeactivated = deactivatedHashes.has(itemHash);

            if (isDeactivated) {
              console.log(`[BRIEFING] Filtering deactivated news: "${item.title?.slice(0, 50)}..."`);
            }

            return !isDeactivated;
          });

          // Return in the same format as received
          if (Array.isArray(briefing.news)) {
            filteredNews = filteredItems;
          } else {
            filteredNews = { ...briefing.news, items: filteredItems };
          }

          if (filteredItems.length < originalCount) {
            console.log(`[BRIEFING] News filtered: ${originalCount} → ${filteredItems.length} (${originalCount - filteredItems.length} deactivated)`);
          }
        }
      }
    }

    // Filter stale news - only today's news with valid publication dates (2026-01-05)
    // Apply after deactivation filtering
    const newsItemsToFilter = Array.isArray(filteredNews) ? filteredNews : filteredNews?.items || [];
    const freshNewsItems = filterFreshNews(newsItemsToFilter, new Date(), req.snapshot.timezone || 'UTC');

    // Return in same format as filtered news
    const finalNews = Array.isArray(filteredNews) ? freshNewsItems : { ...filteredNews, items: freshNewsItems };

    res.json({
      success: true,
      news: finalNews,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[BRIEFING] Error fetching rideshare news:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      news: null,
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/events/:snapshotId', requireAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    // Read events directly from discovered_events table for this snapshot's location
    const snapshot = req.snapshot;
    const { filter } = req.query; // ?filter=active for currently happening events

    // 2026-04-18: FIX — check if events generation failed on this briefing. Previously
    // this endpoint queried discovered_events directly and returned success:true,
    // events:[] even when the briefing row's events JSONB was {_generationFailed: true}.
    // That made isEventsLoading() stay true forever client-side (infinite briefing spinner).
    // Now we surface the sentinel so the client honors its _generationFailed branch.
    const [briefingRow] = await db
      .select({ events: briefings.events })
      .from(briefings)
      .where(eq(briefings.snapshot_id, snapshot.snapshot_id))
      .limit(1);
    if (briefingRow?.events?._generationFailed) {
      return res.status(200).json({
        success: false,
        _generationFailed: true,
        error: briefingRow.events.error || 'Events generation failed',
        events: [],
        marketEvents: [],
        market_name: null,
        reason: 'Events generation failed — check server logs',
        timestamp: new Date().toISOString(),
      });
    }

    // 2026-01-14: FIX - Use snapshot timezone to calculate "today" (not UTC)
    // At 8:20 PM CST on Jan 14, UTC is already Jan 15 - this was causing 0 events to return
    // 2026-01-15: ACTUAL FIX - toISOString() still converts to UTC! Use toLocaleDateString instead.
    if (!snapshot.timezone) {
      console.error('[BRIEFING] CRITICAL: Snapshot missing timezone for events query', { snapshot_id: snapshot.snapshot_id });
      return res.status(500).json({ error: 'Snapshot timezone is required but missing - this is a data integrity bug' });
    }
    const userTimezone = snapshot.timezone;
    // CRITICAL: Always use toLocaleDateString with timezone - toISOString() converts to UTC!
    const today = new Date().toLocaleDateString('en-CA', { timeZone: userTimezone }); // YYYY-MM-DD format

    // Calculate end date in user's timezone (today + 7 days)
    const endDateObj = new Date();
    endDateObj.setDate(endDateObj.getDate() + 7);
    const endDate = endDateObj.toLocaleDateString('en-CA', { timeZone: userTimezone });

    matrixLog.debug({
      category: 'BRIEFING',
      connection: 'API',
      action: 'EVENTS',
      roleName: 'API',
      secondaryCat: 'FILTER',
      location: 'briefing.js:events'
    }, `GET /events: today=${today}, endDate=${endDate}, tz=${userTimezone}`);

    // 2026-01-10: Use symmetric field names (event_start_date, event_start_time)
    const events = await db.select({
      event: discovered_events,
      venue: venue_catalog
    })
      .from(discovered_events)
      .leftJoin(venue_catalog, eq(discovered_events.venue_id, venue_catalog.venue_id))
      // 2026-04-10: FIX — Query by STATE (metro-wide), not city. Events now store their
      // venue's actual city from Google Places API (e.g., "Fort Worth", "Arlington"), so
      // filtering by snapshot city ("Dallas") would miss metro events outside the driver's city.
      // 2026-04-28: FIX — multi-day-inclusive predicate. Was forward-only on
      // event_start_date (`gte/lte` both keyed on start), silently excluding multi-day
      // events that started before today (e.g. day 2 of a 4-day festival was dropped
      // from the map even though Path A's planner saw it). Now: any event whose
      // [start, end] window overlaps the [today, endDate] window. Mirrors the Path A
      // fix landed at briefing-service.js:1551-1559 in commit 5cecd113. Active-only
      // filter still gates already-ended events because deactivatePastEvents() runs
      // upstream in the briefing pipeline.
      .where(and(
        eq(discovered_events.state, snapshot.state),
        lte(discovered_events.event_start_date, endDate),
        gte(discovered_events.event_end_date, today),
        eq(discovered_events.is_active, true)
      ))
      .orderBy(discovered_events.event_start_date)
      .limit(50);

    // Map to briefing events format
    let allEvents = events.map(({ event: e, venue: v }) => {
      // Prefer verified venue data if available
      const venueName = v?.venue_name || e.venue_name;
      const address = v?.formatted_address || v?.address || e.address;
      const lat = v?.lat || e.lat;
      const lng = v?.lng || e.lng;
      const capacity = v?.capacity_estimate ? `Capacity: ${v.capacity_estimate.toLocaleString()}` : null;

      return {
        id: e.id,
        title: e.title,
        summary: [e.title, venueName, e.event_start_date, e.event_start_time].filter(Boolean).join(' • '),
        impact: e.expected_attendance === 'high' ? 'high' : e.expected_attendance === 'low' ? 'low' : 'medium',
        // 2026-04-04: FIX H-8 — source_model column was removed from schema (2026-01-14)
        source: v?.source ? `Venue: ${v.source}` : 'discovered',
        event_type: e.category,
        subtype: e.category, // For EventsComponent category grouping
        event_start_date: e.event_start_date,
        event_end_date: e.event_end_date, // For multi-day events (e.g., holiday lights Dec 1 - Jan 4)
        event_start_time: e.event_start_time,
        event_end_time: e.event_end_time,
        address: address,
        venue: venueName,
        venue_id: e.venue_id, // Include link for UI
        location: venueName ? `${venueName}, ${address || ''}`.trim() : address,
        latitude: lat,
        longitude: lng,
        capacity_info: capacity
      };
    });

    // CRITICAL: Filter stale events and events without date info (2026-01-05)
    // This catches events with incorrect dates (e.g., Christmas events with January dates)
    // and events that lack proper start/end times
    // 2026-01-05: Pass snapshot timezone for proper local time parsing
    // 2026-01-09: NO FALLBACKS - fail explicitly if timezone is missing
    if (!snapshot.timezone) {
      console.error('[BRIEFING] CRITICAL: Snapshot missing timezone for events filter', { snapshot_id: snapshot.snapshot_id });
      return res.status(500).json({ error: 'Snapshot timezone is required but missing - this is a data integrity bug' });
    }
    const snapshotTz = snapshot.timezone;
    const beforeFreshFilter = allEvents.length;
    allEvents = filterFreshEvents(allEvents, new Date(), snapshotTz);

    // Apply "active" filter: show only events happening RIGHT NOW (during their duration)
    // Used by MapPage for real-time event display
    // 2026-01-09: NO FALLBACKS - snapshotTz already validated above
    if (filter === 'active') {
      const now = new Date();
      const beforeCount = allEvents.length;
      allEvents = allEvents.filter(e => isEventActiveNow(e, now, snapshotTz));
      matrixLog.debug({
        category: 'BRIEFING',
        connection: 'API',
        action: 'EVENTS',
        roleName: 'API',
        secondaryCat: 'FILTER',
        location: 'briefing.js:events'
      }, `Active: ${allEvents.length}/${beforeCount} events currently happening in ${snapshotTz}`);
    }

    // 2026-01-08: Fetch high-value events from the user's market (beyond local city)
    // This shows major events (stadiums, arenas, conventions) from across the market
    let marketEvents = [];
    let marketName = null;

    try {
      // 1. Look up user's market from market_cities
      // Handle both "TX" and "Texas" state formats
      const stateCondition = snapshot.state.length === 2
        ? eq(market_cities.state_abbr, snapshot.state.toUpperCase())
        : ilike(market_cities.state, snapshot.state);

      const [marketMapping] = await db
        .select()
        .from(market_cities)
        .where(and(
          ilike(market_cities.city, snapshot.city),
          stateCondition
        ))
        .limit(1);

      if (marketMapping) {
        marketName = marketMapping.market_name;

        // 2. Get all cities in the market (excluding user's current city)
        const otherMarketCities = await db
          .select({ city: market_cities.city, state: market_cities.state })
          .from(market_cities)
          .where(and(
            eq(market_cities.market_name, marketMapping.market_name),
            not(ilike(market_cities.city, snapshot.city))
          ));

        if (otherMarketCities.length > 0) {
          // 3. Query high-value events from market cities
          // Build OR conditions for each city in the market
          const cityConditions = otherMarketCities.map(c =>
            and(
              ilike(discovered_events.city, c.city),
              ilike(discovered_events.state, c.state)
            )
          );

          // 2026-01-10: Use symmetric field names (event_start_date, event_start_time)
          // 2026-04-04: FIX H-7 — Left join venue_catalog for coordinates.
          // lat/lng columns were dropped from discovered_events (migration 20260110).
          // Coordinates now come from venue_catalog via venue_id FK.
          const rawMarketEvents = await db.select({
            id: discovered_events.id,
            title: discovered_events.title,
            venue_name: discovered_events.venue_name,
            address: discovered_events.address,
            city: discovered_events.city,
            state: discovered_events.state,
            event_start_date: discovered_events.event_start_date,
            event_end_date: discovered_events.event_end_date,
            event_start_time: discovered_events.event_start_time,
            event_end_time: discovered_events.event_end_time,
            category: discovered_events.category,
            expected_attendance: discovered_events.expected_attendance,
            venue_lat: venue_catalog.lat,
            venue_lng: venue_catalog.lng,
          })
            .from(discovered_events)
            .leftJoin(venue_catalog, eq(discovered_events.venue_id, venue_catalog.venue_id))
            .where(and(
              or(...cityConditions),
              or(
                eq(discovered_events.expected_attendance, 'high'), // High-value events
                // 2026-02-10: Include major categories regardless of attendance tag (fixes "Dallas Open" visibility)
                // Aligns with Strategy Generator logic (isLargeEvent) which considers all sports/concerts as market-wide
                sql`${discovered_events.category} IN ('sports', 'concert', 'festival')`
              ),
              gte(discovered_events.event_start_date, today),
              lte(discovered_events.event_start_date, endDate),
              eq(discovered_events.is_active, true)
            ))
            .orderBy(discovered_events.event_start_date)
            .limit(20);

          // Map to same format as local events
          marketEvents = rawMarketEvents.map(e => ({
            title: e.title,
            summary: [e.title, e.venue_name, e.event_start_date, e.event_start_time].filter(Boolean).join(' • '),
            impact: 'high', // All market events are high-value by definition
            // 2026-04-04: FIX H-8 — source_model column removed from schema
            source: 'discovered',
            event_type: e.category,
            subtype: e.category,
            event_start_date: e.event_start_date,
            event_end_date: e.event_end_date,
            event_start_time: e.event_start_time,
            event_end_time: e.event_end_time,
            address: e.address,
            venue: e.venue_name,
            location: e.venue_name ? `${e.venue_name}, ${e.address || ''}`.trim() : e.address,
            latitude: e.venue_lat,
            longitude: e.venue_lng,
            city: e.city // Include city for UI display
          }));

          marketEvents = filterFreshEvents(marketEvents, new Date(), snapshotTz);

          if (marketEvents.length > 0) {
            console.log(`[BRIEFING] Market events: ${marketEvents.length} high-value events from ${marketName} market (${otherMarketCities.length} cities)`);
          }
        }
      }
    } catch (marketError) {
      // Graceful degradation: if market lookup fails, just return local events
      console.error('[BRIEFING] Market events lookup failed (non-blocking):', marketError.message);
    }

    res.json({
      success: true,
      events: allEvents,
      marketEvents: marketEvents,
      market_name: marketName,
      reason: allEvents.length === 0 ? (filter === 'active' ? 'No events happening right now' : 'No events found for this location') : null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[BRIEFING] Error fetching events:', error);
    res.json({
      success: true,
      events: [],
      marketEvents: [],
      market_name: null,
      reason: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/school-closures/:snapshotId', requireAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    // FETCH-ONCE: Just read cached data from DB
    const briefing = await getBriefingBySnapshotId(req.snapshot.snapshot_id);

    // 2026-04-18 Phase 0a: flip 202 → 200 + _coverageEmpty (see FRISCO_LOCK_DIAGNOSIS_2026-04-18.md)
    if (!briefing?.school_closures) {
      return res.status(200).json({
        success: true,
        _coverageEmpty: true,
        reason: 'no_school_closures',
        timestamp: new Date().toISOString()
      });
    }

    // 2026-04-05: Detect error marker from failed generation
    if (briefing.school_closures._generationFailed) {
      return res.status(200).json({
        success: false,
        _generationFailed: true,
        error: briefing.school_closures.error || 'Briefing generation failed',
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
    console.error('[BRIEFING] Error fetching school closures:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      school_closures: null,
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/airport/:snapshotId', requireAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    // FETCH-ONCE: Just read cached airport data from DB
    const briefing = await getBriefingBySnapshotId(req.snapshot.snapshot_id);

    // 2026-04-05: Self-heal zombie placeholder rows
    triggerZombieRecoveryIfNeeded(briefing, req.snapshot);

    // 2026-04-18 Phase 0a: flip 202 → 200 + _coverageEmpty (see FRISCO_LOCK_DIAGNOSIS_2026-04-18.md)
    if (!briefing?.airport_conditions) {
      return res.status(200).json({
        success: true,
        _coverageEmpty: true,
        reason: 'no_airport_events',
        timestamp: new Date().toISOString()
      });
    }

    // 2026-04-05: Detect error marker from failed generation
    if (briefing.airport_conditions._generationFailed) {
      return res.status(200).json({
        success: false,
        _generationFailed: true,
        error: briefing.airport_conditions.error || 'Briefing generation failed',
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
    console.error('[BRIEFING] Error fetching airport conditions:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      airport_conditions: null,
      timestamp: new Date().toISOString()
    });
  }
});

// 2026-01-08: Changed from "confirm" (AI repair) to "filter" (strict removal)
// Events with TBD/Unknown in critical fields are now REMOVED, not repaired
router.post('/filter-invalid-events', requireAuth, async (req, res) => {
  try {
    // 2026-04-28: Accept optional `timezone` in the body so Rule 13 today-check
    // honors the driver's local tz. WARN-on-missing surfaces clients that haven't
    // migrated to the new contract; UTC fallback is preserved for backwards compat
    // but logs a clear note explaining the silent-failure mode it masks.
    const { events, timezone } = req.body;

    if (!events || !Array.isArray(events)) {
      return res.status(400).json({ error: 'events array is required' });
    }

    if (!timezone) {
      chainLog(
        { parent: 'BRIEFING', sub: 'EVENTS', callTypes: ['API', 'FILTER'], callName: 'filter-invalid-events' },
        `WARN: client did not supply timezone — Rule 13 falling back to UTC; AHEAD-timezone events may be incorrectly stripped`
      );
    }

    console.log(`[BRIEFING] Filtering ${events.length} events (removing TBD/Unknown, tz=${timezone || 'UTC-fallback'})`);
    const filtered = filterInvalidEvents(events, { timezone });

    res.json({
      success: true,
      original_count: events.length,
      filtered_count: filtered.length,
      removed_count: events.length - filtered.length,
      events: filtered
    });
  } catch (error) {
    console.error('[BRIEFING] Error filtering events:', error);
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

    // 2026-04-04: FIX H-1 — Market authorization check.
    // Previously any authenticated user could deactivate ANY event in the system.
    // Now verify the user's most recent snapshot is in the same city/state as the event.
    const [userSnapshot] = await db.select({ city: snapshots.city, state: snapshots.state })
      .from(snapshots)
      .where(eq(snapshots.user_id, req.auth.userId))
      .orderBy(desc(snapshots.created_at))
      .limit(1);

    if (userSnapshot && event.city && userSnapshot.city?.toLowerCase() !== event.city?.toLowerCase()) {
      return res.status(403).json({ error: 'You can only deactivate events in your market area' });
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
    // 2026-01-10: Use symmetric field names (event_start_time)
    if (reason === 'incorrect_time') {
      if (correctedTime) updatePayload.event_start_time = correctedTime;
      if (correctedEndTime) updatePayload.event_end_time = correctedEndTime;
    }

    // Deactivate the event
    await db.update(discovered_events)
      .set(updatePayload)
      .where(eq(discovered_events.id, eventId));

    console.log(`[BRIEFING] Event deactivated: ${event.title} (${reason})`);

    res.json({
      ok: true,
      event_id: eventId,
      title: event.title,
      reason,
      deactivated_at: updatePayload.deactivated_at,
      message: `Event "${event.title}" has been marked as inactive and will no longer appear on the map.`
    });
  } catch (error) {
    console.error('[BRIEFING] Error deactivating event:', error);
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

    // 2026-04-04: FIX H-1 — Market authorization check (same as deactivate)
    const [userSnapshot] = await db.select({ city: snapshots.city, state: snapshots.state })
      .from(snapshots)
      .where(eq(snapshots.user_id, req.auth.userId))
      .orderBy(desc(snapshots.created_at))
      .limit(1);

    if (userSnapshot && event.city && userSnapshot.city?.toLowerCase() !== event.city?.toLowerCase()) {
      return res.status(403).json({ error: 'You can only reactivate events in your market area' });
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

    console.log(`[BRIEFING] Event reactivated: ${event.title}`);

    res.json({
      ok: true,
      event_id: eventId,
      title: event.title,
      message: `Event "${event.title}" has been reactivated and will appear on the map again.`
    });
  } catch (error) {
    console.error('[BRIEFING] Error reactivating event:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/discovered-events/:snapshotId', requireAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    const snapshot = req.snapshot;

    // 2026-01-14: FIX - Use snapshot timezone to calculate "today" (not UTC)
    // At 8:20 PM CST on Jan 14, UTC is already Jan 15 - this was causing events to not match
    if (!snapshot.timezone) {
      console.error('[BRIEFING] CRITICAL: Snapshot missing timezone for discovered-events query', { snapshot_id: snapshot.snapshot_id });
      return res.status(500).json({ error: 'Snapshot timezone is required but missing - this is a data integrity bug' });
    }
    const userTimezone = snapshot.timezone;

    // Calculate "today" in user's timezone
    // 2026-01-15: FIX - toISOString() converts to UTC, use toLocaleDateString instead
    const today = new Date().toLocaleDateString('en-CA', { timeZone: userTimezone }); // YYYY-MM-DD format

    // Calculate end date in user's timezone (today + 7 days)
    const endDateObj = new Date();
    endDateObj.setDate(endDateObj.getDate() + 7);
    const endDate = endDateObj.toLocaleDateString('en-CA', { timeZone: userTimezone });

    console.log(`[BRIEFING] GET /discovered-events for ${snapshot.city}, ${snapshot.state} (${today} to ${endDate}, tz=${userTimezone})`);

    // 2026-01-10: Use symmetric field names (event_start_date)
    // 2026-04-10: FIX — Query by state (metro-wide), same as /events endpoint above
    const events = await db.select()
      .from(discovered_events)
      .where(and(
        eq(discovered_events.state, snapshot.state),
        gte(discovered_events.event_start_date, today),
        lte(discovered_events.event_start_date, endDate),
        eq(discovered_events.is_active, true)
      ))
      .orderBy(discovered_events.event_start_date)
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
    console.error('[BRIEFING] Error fetching discovered events:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;