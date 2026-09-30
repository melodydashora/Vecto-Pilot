import { Router } from 'express';
import crypto from 'crypto';
// 2026-04-04: FIX C-2 — Added fetchTrafficConditions (was missing, causing ReferenceError on /traffic/realtime)
import { getBriefingBySnapshotId } from '../../lib/briefing/briefing-aggregator.js';
import { filterInvalidEvents } from '../../lib/briefing/pipelines/events.js';
import { readMarketEvents, eventInSnapshotMarket, toBriefingEvent, eventOverlapsDisplayDays } from '../../lib/events/market-event-reader.js';
import { reconcileEventLists } from '../../lib/events/event-read-reconciliation.js';
import { fetchWeatherConditions } from '../../lib/briefing/pipelines/weather.js';
import { briefingSectionIssue, briefingFailureReason, getBriefingReadiness } from '../../lib/briefing/briefing-readiness.js';
import { normalizeCoordinates } from '../../../shared/coordinates.js';
import { fetchTrafficConditions } from '../../lib/briefing/pipelines/traffic.js';
import { db } from '../../db/drizzle.js';
import { snapshots, discovered_events, news_deactivations } from '../../../shared/schema.js';
import { eq, desc, and } from 'drizzle-orm';
import { requireAuth } from '../../middleware/auth.js';
import { isOperator } from '../../middleware/require-operator.js';
import { expensiveEndpointLimiter } from '../../middleware/rate-limit.js';
import { requireSnapshotOwnership } from '../../middleware/require-snapshot-ownership.js';
import { filterFreshEvents, filterFreshNews, getEventStartTime, getEventEndTime } from '../../lib/strategy/strategy-utils.js';
// 2026-04-28: Added chainLog import to fix the broken `briefingLog ?? console.error`
// expression at the market-events catch handler below — see edit at line ~466.
import { chainLog, matrixLog } from '../../logger/workflow.js';

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

// Every saved reader uses the same section contract as final reconciliation.
function savedSectionState(briefing, fields) {
  const issues = fields.flatMap(field => {
    const issue = briefingSectionIssue(field, briefing?.[field]);
    return issue ? [{ field, issue }] : [];
  });
  const failed = issues.length > 0 && (briefing?.status === 'error' || briefing?.status === 'complete' ||
    issues.some(({ field }) => briefing?.[field] != null && !briefing[field]._pending));
  return { issues, failed, pending: issues.length > 0 && !failed };
}

const weatherSectionState = briefing => savedSectionState(briefing, ['weather_current', 'weather_forecast']);

function sendUnavailableSection(res, briefing, field) {
  const { issues, failed, pending } = savedSectionState(briefing, [field]);
  if (!issues.length) return false;
  res.status(failed ? 503 : 202).json({ success: false, _pending: pending, _generationFailed: failed,
    error: failed ? 'briefing_section_unavailable' : 'briefing_section_pending',
    reason: issues[0].issue, ...(failed && { retry: 'setup' }) });
  return true;
}

// Legacy whole-Briefing readers must not flatten failed sections into successful
// empty lists. Progressive consumers use /snapshot/:snapshotId instead.
function sendIncompleteBriefing(res, briefing, snapshotId) {
  const readiness = getBriefingReadiness(briefing, snapshotId);
  if (readiness.ready) return false;
  res.status(readiness.failed ? 503 : 202).json({
    success: false, snapshot_id: snapshotId,
    _pending: !readiness.failed, _generationFailed: readiness.failed,
    error: readiness.failed ? 'briefing_unavailable' : 'briefing_pending',
    issues: readiness.issues, ...(readiness.failed && { retry: 'setup' }),
  });
  return true;
}

// Reuse the Strategist's timezone-aware event interval. Missing or malformed
// times cannot imply that an event is happening all day.
function isEventActiveNow(event, now, timezone) {
  const start = getEventStartTime(event, timezone);
  const end = getEventEndTime(event, timezone);
  return !!start && !!end && now >= start && now <= end;
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

    if (sendIncompleteBriefing(res, briefing, snapshot.snapshot_id)) return;

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

    if (sendIncompleteBriefing(res, briefing, snapshotId)) return;

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
// 2026-05-30: Shared event-display helpers.
// Events are re-discovered on every request, so the briefing only ever shows events
// active TODAY (today within [start, end], in the snapshot's timezone). Past + future
// are dropped — the venue was already persisted to venue_catalog at discovery time, so
// dropping the event from the view loses nothing of value.
function eventActiveToday(e, today, timezone) {
  return eventOverlapsDisplayDays(e, today, today, timezone) === true;
}

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
    const sectionState = field => savedSectionState(briefing, [field]);

    // Filter stale events from briefing data (2026-01-05)
    const rawLocalEvents = Array.isArray(briefing.events)
      ? briefing.events
      : (briefing.events?.items || []);
    const localEventsFailed = sectionState('events').failed;
    let freshEvents = localEventsFailed ? [] : rawLocalEvents;

    // Filter stale news - only today's news with valid publication dates (2026-01-05)
    const newsFailed = sectionState('news').failed;
    const rawNewsItems = Array.isArray(briefing.news) ? briefing.news : (briefing.news?.items || []);
    const freshNews = newsFailed ? [] : filterFreshNews(rawNewsItems, new Date(), tz3);

    // 2026-04-18: Market-wide events lookup — high-value events from other cities in
    // the driver's metro. Ported from /events/:snapshotId so the aggregate endpoint
    // returns the same events data the per-section endpoint did.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz3 });


    // Reconcile before freshness filtering so conflicting source end times survive
    // while any original report is still visible. This never modifies stored rows.

    let marketEvents = [], marketName = null, marketStatus = 'complete', unresolvedMarketEvents = 0;
    try {
      const saved = await readMarketEvents(req.snapshot, { today, highValueOtherCities: true, limit: 20 });
      marketName = saved.marketName;
      marketEvents = saved.rows.map(toBriefingEvent);
      unresolvedMarketEvents = saved.unresolvedCount;
      if (unresolvedMarketEvents) marketStatus = 'partial';
    } catch (error) {
      marketStatus = 'unavailable';
      chainLog({ parent: 'BRIEFING', sub: 'EVENTS', callTypes: ['DB'], table: 'market_events', callName: 'lookup' },
        'Additional market events are unavailable');
    }

    const eventReadTime = new Date();
    const freshEventReports = new Set(filterFreshEvents([...freshEvents, ...marketEvents], eventReadTime, tz3));
    ({ local: freshEvents, market: marketEvents } = reconcileEventLists(freshEvents, marketEvents, {
      isVisible: event => eventActiveToday(event, today, tz3) && freshEventReports.has(event),
    }));

    // 2026-07-06 (Melody, todo #24): every section carries THREE distinct states
    // so the UI can stop rendering pending/failed as verified-empty:
    //   _pending: raw column is still NULL — the pipeline hasn't landed this
    //             section yet (progressive generation in flight)
    //   _generationFailed: section ran and failed — `reason`/`error` says why
    //   neither: verified result (which may be a genuinely empty list)
    // Pending sections must NOT fabricate "No X for this area" reasons — that
    // masked in-flight generation as a verified answer (the "No nearby
    // airports found in Dallas" screenshot).
    const weatherState = weatherSectionState(briefing);
    res.json({
      snapshot_id: req.snapshot.snapshot_id,
      briefing: {
        weather: {
          current: briefing.weather_current,
          forecast: briefing.weather_forecast,
          _pending: weatherState.pending,
          _generationFailed: weatherState.failed,
        },
        traffic: {
          ...(briefing.traffic_conditions || {}),
          _pending: sectionState('traffic_conditions').pending,
          _generationFailed: sectionState('traffic_conditions').failed,
        },
        news: {
          items: freshNews,
          reason: newsFailed
            ? (briefing.news?.error || 'News generation failed')
            : briefing.news == null
              ? null // pending — no fabricated emptiness
              : (briefing.news?.reason || (freshNews.length === 0 ? 'No rideshare news for this area' : null)),
          _pending: sectionState('news').pending,
          _generationFailed: newsFailed,
        },
        events: {
          items: freshEvents,
          marketEvents,
          market_name: marketName,
          market_status: marketStatus,
          unresolved_market_events: unresolvedMarketEvents,
          reason: localEventsFailed
            ? (briefing.events?.error || 'Events generation failed')
            : briefing.events == null
              ? null // pending — no fabricated emptiness
              : (briefing.events?.reason || (freshEvents.length === 0 ? 'No events found for this location' : null)),
          _pending: sectionState('events').pending,
          _generationFailed: localEventsFailed,
        },
        school_closures: {
          items: Array.isArray(briefing.school_closures)
            ? briefing.school_closures
            : (briefing.school_closures?.items || []),
          reason: briefing.school_closures?.reason || null,
          _pending: sectionState('school_closures').pending,
          _generationFailed: sectionState('school_closures').failed,
        },
        airport_conditions: {
          ...(briefing.airport_conditions || {}),
          _pending: sectionState('airport_conditions').pending,
          _generationFailed: sectionState('airport_conditions').failed,
        },
        // 2026-07-06: holiday section (moved from snapshots — pipelines/holiday.js).
        // Success: { holiday, is_holiday, detectedAt }; failure: errorMarker.
        // GlobalHeader reads this for the amber holiday display.
        holiday: {
          ...(briefing.holiday || {}),
          _pending: sectionState('holiday').pending,
          _generationFailed: sectionState('holiday').failed,
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

router.post('/refresh', expensiveEndpointLimiter, requireAuth, (_req, res) => {
  res.status(409).json({ success: false, error: 'main_run_restart_required', retry: 'setup',
    message: 'Review saved setup and choose Continue with saved preferences to collect a fresh Briefing.' });
});

// 2026-04-04: FIX C-2 — fetchTrafficConditions expects { snapshot } shape, not flat params.
// Also fixed: removed NO FALLBACKS violations (city || 'Unknown', state || '').
// Added timezone as required param (needed for date calculation inside the function).
router.get('/traffic/realtime', requireAuth, async (req, res) => {
  try {
    const { lat, lng, city, state, timezone } = req.query;

    if (!Number.isFinite(parseFloat(lat)) || !Number.isFinite(parseFloat(lng)) || !city || !state || !timezone) {
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

    const coords = normalizeCoordinates(lat, lng);
    if (!coords) return res.status(400).json({ error: 'Valid lat and lng are required' });

    const weather = await fetchWeatherConditions({
      snapshot: {
        ...coords,
        country
      }
    });

    res.json({ success: true, weather });
  } catch (error) {
    console.error('[BRIEFING] Error fetching realtime weather:', error);
    res.status(503).json({ success: false, error: 'weather_unavailable', message: briefingFailureReason(error) });
  }
});

router.get('/weather/:snapshotId', requireAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    // MAIN owns collection. An ordinary read cannot race that generation with an
    // untracked raw fetch or replace a failure with a second, unsaved observation.
    const briefing = await getBriefingBySnapshotId(req.snapshot.snapshot_id);
    const { issues, failed } = weatherSectionState(briefing);
    if (issues.length) {
      return res.status(failed ? 503 : 202).json({ success: false,
        _pending: !failed, _generationFailed: failed,
        error: failed ? 'weather_unavailable' : 'weather_pending',
        message: issues.map(({ field, issue }) => `${field}: ${issue}`).join(' '),
        ...(failed && { retry: 'setup' }),
      });
    }
    return res.json({ success: true, weather: { current: briefing.weather_current, forecast: briefing.weather_forecast },
      timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('[BRIEFING] Error fetching weather:', error);
    res.status(503).json({ success: false, _generationFailed: true, error: 'weather_unavailable', message: briefingFailureReason(error) });
  }
});

router.get('/traffic/:snapshotId', requireAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    // FETCH-ONCE: Just read cached data from DB - no refresh, no regeneration
    // Traffic is generated once during pipeline and stays until new snapshot
    const briefing = await getBriefingBySnapshotId(req.snapshot.snapshot_id);
    if (sendUnavailableSection(res, briefing, 'traffic_conditions')) return;

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
    if (sendUnavailableSection(res, briefing, 'news')) return;

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

    const briefingRow = await getBriefingBySnapshotId(snapshot.snapshot_id);
    if (sendUnavailableSection(res, briefingRow, 'events')) return;

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

    const savedMarket = await readMarketEvents(snapshot, { today, limit: 50 });
    let allEvents = savedMarket.rows.map(toBriefingEvent);

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
    // Existing freshness and active predicates are applied to original reports below,
    // after grouping; an unresolved projected end must never become "ongoing forever".

    // 2026-01-08: Fetch high-value events from the user's market (beyond local city)
    // This shows major events (stadiums, arenas, conventions) from across the market
    // The shared reader already includes the full metro (including cross-state
    // mappings), so there is no second overlapping query in this compatibility view.
    let marketEvents = [];
    const marketName = savedMarket.marketName;

    const eventReadTime = new Date();
    const freshEventReports = new Set(filterFreshEvents([...allEvents, ...marketEvents], eventReadTime, snapshotTz));
    ({ local: allEvents, market: marketEvents } = reconcileEventLists(allEvents, marketEvents, {
      isVisible: (event, scope) => eventActiveToday(event, today, snapshotTz) &&
        freshEventReports.has(event) &&
        (scope !== 'local' || filter !== 'active' || isEventActiveNow(event, eventReadTime, snapshotTz)),
    }));

    res.json({
      success: true,
      events: allEvents,
      marketEvents: marketEvents,
      market_name: marketName,
      unresolved_events: savedMarket.unresolvedCount,
      reason: allEvents.length === 0 ? (filter === 'active' ? 'No events happening right now' : 'No events found for this location') : null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[BRIEFING] Error fetching events:', error);
    res.status(503).json({ success: false, _generationFailed: true,
      error: 'events_unavailable', reason: briefingFailureReason(error),
      events: [], marketEvents: [], market_name: null,
      timestamp: new Date().toISOString(),
    });
  }
});

router.get('/school-closures/:snapshotId', requireAuth, requireSnapshotOwnership, async (req, res) => {
  try {
    // FETCH-ONCE: Just read cached data from DB
    const briefing = await getBriefingBySnapshotId(req.snapshot.snapshot_id);
    if (sendUnavailableSection(res, briefing, 'school_closures')) return;

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
    if (sendUnavailableSection(res, briefing, 'airport_conditions')) return;

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
    // 2026-04-28: Accept `timezone` in the body so Rule 13 today-check honors the driver's
    // local tz. 2026-06-11: timezone is now REQUIRED — the old WARN + UTC fallback let
    // AHEAD-tz clients silently strip valid local-today events (memory #255). filterInvalidEvents
    // → Rule 13 throws on missing tz, so reject with a clear 400 at the boundary instead.
    const { events, timezone } = req.body;

    if (!events || !Array.isArray(events)) {
      return res.status(400).json({ error: 'events array is required' });
    }

    if (!timezone) {
      return res.status(400).json({
        error: 'timezone is required (IANA, e.g. "America/Chicago"). Rule 13\'s today-window is timezone-dependent; the UTC fallback was removed 2026-06-11 to avoid mis-stripping AHEAD-timezone events.',
      });
    }

    console.log(`[BRIEFING] Filtering ${events.length} events (removing TBD/Unknown, tz=${timezone})`);
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
    const [userSnapshot] = await db.select({ city: snapshots.city, state: snapshots.state, country: snapshots.country })
      .from(snapshots)
      .where(eq(snapshots.user_id, req.auth.userId))
      .orderBy(desc(snapshots.created_at))
      .limit(1);

    // 2026-09-10 (security finding [11], verified): a caller with NO snapshot used to skip the
    // market check entirely. Fail closed — only operators/service accounts moderate without one.
    if (!userSnapshot && !isOperator(req.auth)) {
      return res.status(403).json({ error: 'A current snapshot in the event market is required to moderate events' });
    }
    if (!isOperator(req.auth) && !(await eventInSnapshotMarket(eventId, userSnapshot))) {
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
    const [userSnapshot] = await db.select({ city: snapshots.city, state: snapshots.state, country: snapshots.country })
      .from(snapshots)
      .where(eq(snapshots.user_id, req.auth.userId))
      .orderBy(desc(snapshots.created_at))
      .limit(1);

    // 2026-09-10 (security finding [11], verified): a caller with NO snapshot used to skip the
    // market check entirely. Fail closed — only operators/service accounts moderate without one.
    if (!userSnapshot && !isOperator(req.auth)) {
      return res.status(403).json({ error: 'A current snapshot in the event market is required to moderate events' });
    }
    if (!isOperator(req.auth) && !(await eventInSnapshotMarket(eventId, userSnapshot))) {
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

    const saved = await readMarketEvents(snapshot, { today, endDate, limit: 100 });
    const events = saved.rows.map(({ event }) => event);

    res.json({
      ok: true,
      snapshot_id: snapshot.snapshot_id,
      location: { city: snapshot.city, state: snapshot.state },
      date_range: { start: today, end: endDate },
      count: events.length,
      unresolved_events: saved.unresolvedCount,
      events
    });
  } catch (error) {
    console.error('[BRIEFING] Error fetching discovered events:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
