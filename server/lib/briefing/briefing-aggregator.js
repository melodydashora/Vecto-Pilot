// 2026-05-02: Workstream 6 Step 1 commit 9/11 — Aggregator inversion.
// Owns the cross-pipeline orchestration that was previously in briefing-service.js:
//   - generateAndStoreBriefing (entry: dedup → advisory lock → placeholder → orchestrate → bulk-failure path)
//   - generateBriefingInternal (private: snapshot fetch → schools cache → 5-pipeline allSettled → final-assembly → DB write → pg_notify)
//   - getBriefingBySnapshotId (DB read helper)
//   - refreshEventsInBriefing (stale-events refresh; uses fetchEventsForBriefing directly)
//   - refreshTrafficInBriefing (stale-traffic refresh; uses fetchTrafficConditions directly)
//   - refreshNewsInBriefing (stale-news refresh; uses fetchRideshareNews directly)
//   - getOrGenerateBriefing (smart cache-or-generate entry: placeholder check → freshness gate → refresh OR full regen)
//
// Module-private state: inFlightBriefings Map (singleton via ESM semantics — one Map per Node process).
//
// briefing-service.js is now a thin re-export facade pointing at this file + the 6 pipelines.
// External callers (server/api/briefing/briefing.js, server/api/location/snapshot.js, etc.)
// continue importing from briefing-service.js in Phase 1 — no caller migration in this commit.
// Per Master Architect's Revision 1 (Facade Purity), the shim also re-exports the discoverX
// pipeline contracts to defensively cover any unseen test harness or debug script.

import { db } from '../../db/drizzle.js';
import { briefings, snapshots } from '../../../shared/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { briefingLog, OP } from '../../logger/workflow.js';
import { errorMarker } from './briefing-notify.js';
import { isDailyBriefingStale, isEventsStale, areEventsEmpty } from './shared/staleness.js';
import { dumpLastBriefingRow } from './dump-last-briefing.js';

// Pipeline contracts (orchestrator's Promise.allSettled fan-out)
import { discoverSchools } from './pipelines/schools.js';
import { discoverWeather } from './pipelines/weather.js';
import { discoverAirport } from './pipelines/airport.js';
import { discoverNews, fetchRideshareNews } from './pipelines/news.js';
import { discoverTraffic, fetchTrafficConditions } from './pipelines/traffic.js';
import { discoverEvents, fetchEventsForBriefing } from './pipelines/events.js';

// Module-private state — singleton via ESM module semantics (one Map per Node process).
// In-memory dedup for concurrent generateAndStoreBriefing calls within the same process.
// Cross-process dedup is handled separately via pg_advisory_lock inside generateAndStoreBriefing.
const inFlightBriefings = new Map();

export async function generateAndStoreBriefing({ snapshotId, snapshot }) {
  // Dedup 1: Check if already in flight in this process (concurrent calls)
  if (inFlightBriefings.has(snapshotId)) {
    briefingLog.info(`Already in flight for ${snapshotId.slice(0, 8)} - waiting`, OP.CACHE);
    return inFlightBriefings.get(snapshotId);
  }

  // 2026-04-04: FIX H-4 — Use advisory lock to prevent race conditions across processes.
  // Previously, between checking existing row and inserting/clearing placeholder, another
  // process could insert, causing the "clear fields" UPDATE to wipe data being written
  // by the other process. Advisory lock serializes the check-then-write sequence.
  // NOTE: db.execute() returns { rows: [...] }, NOT an array — use .rows[0] (matches blocks-fast.js pattern)
  const lockQueryResult = await db.execute(
    sql`SELECT pg_try_advisory_lock(hashtext(${snapshotId})) as acquired`
  );
  const lockAcquired = lockQueryResult.rows?.[0]?.acquired === true;

  if (!lockAcquired) {
    // Another process holds the lock — briefing generation is in progress elsewhere.
    // Wait briefly then return whatever exists.
    briefingLog.info(`Advisory lock not acquired for ${snapshotId.slice(0, 8)} - generation in progress elsewhere`, OP.CACHE);
    const existing = await getBriefingBySnapshotId(snapshotId);
    if (existing) {
      return { success: true, briefing: existing, deduplicated: true };
    }
    // No row yet — the other process hasn't inserted placeholder. Return pending.
    return { success: true, briefing: null, deduplicated: true, pending: true };
  }

  try {
    // Dedup 2: Check database state - if briefing exists with ALL populated fields, skip regeneration
    // NULL fields = generation in progress or needs refresh
    // Populated fields = data ready, don't regenerate
    // 2026-04-05: Error-marked fields (_generationFailed) don't count as "populated" — must regenerate
    const existing = await getBriefingBySnapshotId(snapshotId);
    if (existing) {
      const hasTraffic = existing.traffic_conditions !== null && !existing.traffic_conditions?._generationFailed;
      const hasEvents = existing.events !== null && !existing.events?._generationFailed && (Array.isArray(existing.events) ? existing.events.length > 0 : existing.events?.items?.length > 0 || existing.events?.reason);
      const hasNews = existing.news !== null && !existing.news?._generationFailed;
      const hasClosures = existing.school_closures !== null && !existing.school_closures?._generationFailed;

      // ALL fields must be populated for concurrent request deduplication to apply
      if (hasTraffic && hasEvents && hasNews && hasClosures) {
        // 2026-01-10: Fixed misleading terminology - this is DEDUP not CACHE
        // Prevents duplicate concurrent requests, not traditional caching
        // Only skip if briefing was generated < 60 seconds ago (in-flight or just completed)
        const ageMs = Date.now() - new Date(existing.updated_at).getTime();
        if (ageMs < 60000) {
          briefingLog.info(`Recent briefing (${Math.round(ageMs/1000)}s old) - skipping duplicate generation`, OP.CACHE);
          return { success: true, briefing: existing, deduplicated: true };
        }
      } else if (hasTraffic || hasEvents) {
        briefingLog.info(`Partial data - regenerating`, OP.CACHE);
      }
    }

    // Create placeholder row with NULL fields to signal "generation in progress"
    // This prevents other callers from starting duplicate generation
    if (!existing) {
      try {
        await db.insert(briefings).values({
          snapshot_id: snapshotId,
          news: null,
          weather_current: null,
          weather_forecast: null,
          traffic_conditions: null,
          events: null,
          school_closures: null,
          airport_conditions: null,
          created_at: new Date(),
          updated_at: new Date()
        });
      } catch (insertErr) {
        // Row might already exist from concurrent call - that's OK
        if (!insertErr.message?.includes('duplicate') && !insertErr.message?.includes('unique')) {
          briefingLog.warn(1, `Placeholder insert warning: ${insertErr.message}`, OP.DB);
        }
      }
    } else {
      // Clear fields to signal "refreshing in progress"
      await db.update(briefings)
        .set({
          traffic_conditions: null,
          events: null,
          airport_conditions: null,
          updated_at: new Date()
        })
        .where(eq(briefings.snapshot_id, snapshotId));
    }
  } finally {
    // Release advisory lock — the placeholder is set, actual generation runs without lock
    await db.execute(sql`SELECT pg_advisory_unlock(hashtext(${snapshotId}))`);
  }

  // 2026-04-05: Wrap in error handler to mark placeholder row as permanently failed
  // on throw. Without this, a thrown error leaves NULL fields in the DB forever,
  // and GET endpoints return success:false indefinitely → client infinite retry loop.
  const briefingPromise = generateBriefingInternal({ snapshotId, snapshot })
    .catch(async (err) => {
      console.error(`[BRIEFING] Generation failed for ${snapshotId.slice(0, 8)}: ${err.message}`);
      // Mark the placeholder row with error sentinel so endpoints return _generationFailed
      // instead of "not yet available" (which causes clients to keep polling)
      // 2026-05-02: Single timestamp shared across all 4 sections (intentional —
      // bulk-failure path; per-section .catch wrappers in generateBriefingInternal
      // use distinct timestamps via errorMarker(err) at each section boundary).
      const failureMarker = errorMarker(err);
      try {
        await db.update(briefings)
          .set({
            traffic_conditions: failureMarker,
            events: failureMarker,
            news: failureMarker,
            airport_conditions: failureMarker,
            updated_at: new Date()
          })
          .where(eq(briefings.snapshot_id, snapshotId));
        briefingLog.warn(1, `Marked briefing ${snapshotId.slice(0, 8)} as permanently failed`, OP.DB);
      } catch (markErr) {
        console.error(`[BRIEFING] Could not mark failed briefing: ${markErr.message}`);
      }
      return { success: false, error: err.message, _generationFailed: true };
    });

  inFlightBriefings.set(snapshotId, briefingPromise);

  briefingPromise.finally(() => {
    inFlightBriefings.delete(snapshotId);
  });

  return briefingPromise;
}

async function generateBriefingInternal({ snapshotId, snapshot }) {
  // Use pre-fetched snapshot if provided, otherwise fetch from DB
  if (!snapshot) {
    try {
      const snapshotResult = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
      if (snapshotResult.length > 0) {
        snapshot = snapshotResult[0];
      } else {
        briefingLog.warn(1, `Snapshot ${snapshotId} not found in DB`, OP.DB);
        return { success: false, error: 'Snapshot not found' };
      }
    } catch (err) {
      briefingLog.warn(1, `Could not fetch snapshot: ${err.message}`, OP.DB);
      return { success: false, error: err.message };
    }
  }

  // Require valid location data - no fallbacks for global app
  if (!snapshot.city || !snapshot.state || !snapshot.timezone) {
    console.error(`[BRIEFING] Snapshot missing required location data (city/state/timezone)`);
    return { success: false, error: 'Snapshot missing required location data' };
  }

  briefingLog.start(`${snapshot.city}, ${snapshot.state}`);
  const briefingStartMs = Date.now();

  const { city, state } = snapshot;

  // ═══════════════════════════════════════════════════════════════════════════
  // BRIEFING CACHING STRATEGY (Updated 2026-01-05):
  // ═══════════════════════════════════════════════════════════════════════════
  // ALWAYS FRESH (every request):  Weather, Traffic, News, Airport
  // CACHED (24-hour, same city):   School Closures
  // CACHED (from DB table):        Events
  // ═══════════════════════════════════════════════════════════════════════════

  // Step 1: Check for cached SCHOOL CLOSURES only (city-level, 24-hour cache)
  // News, Weather, traffic, and airport are NEVER cached - always fetched fresh
  // JOIN briefings with snapshots to get city/state (briefings table no longer stores location)
  let cachedDailyData = null;
  try {
    // Exclude current snapshotId - we want cached data from OTHER snapshots in same city
    // Also exclude placeholder rows (NULL closures) by checking in the result
    const existingBriefings = await db.select({
      briefing: briefings,
      city: snapshots.city,
      state: snapshots.state
    })
      .from(briefings)
      .innerJoin(snapshots, eq(briefings.snapshot_id, snapshots.snapshot_id))
      .where(and(
        eq(snapshots.city, city),
        eq(snapshots.state, state),
        sql`${briefings.snapshot_id} != ${snapshotId}`,  // Exclude current snapshot
        sql`${briefings.school_closures} IS NOT NULL`  // Require school_closures
      ))
      .orderBy(desc(briefings.updated_at))  // DESC = newest first
      .limit(1);

    if (existingBriefings.length > 0) {
      const existing = existingBriefings[0].briefing; // Access briefing from join result
      // NO FALLBACK - timezone is required and validated at entry
      const userTimezone = snapshot.timezone;

      // Check if cached data actually has content (not just empty arrays)
      const closureItems = existing.school_closures?.items || existing.school_closures || [];
      const hasActualClosuresContent = Array.isArray(closureItems) && closureItems.length > 0;

      // Only use cache if it has ACTUAL content AND is same day
      if (!isDailyBriefingStale(existing, userTimezone) && hasActualClosuresContent) {
        briefingLog.info(`Cache hit: closures=${closureItems.length}`, OP.CACHE);
        cachedDailyData = {
          school_closures: existing.school_closures
        };
      }
    }
  } catch (cacheErr) {
    briefingLog.warn(1, `Cache lookup failed: ${cacheErr.message}`, OP.CACHE);
  }

  // Step 2: ALWAYS fetch fresh weather, traffic, events, airport, AND NEWS
  // 2026-01-05: News moved to fresh fetch (dual-model is fast enough)
  briefingLog.phase(1, `Fetching weather + traffic + events + airport + news`, OP.AI);

  // 2026-04-05: INDEPENDENT SUBSYSTEMS — use Promise.allSettled so each fetch is independent.
  // Previously used Promise.all (all-or-nothing) which meant one crash (e.g., events) killed
  // ALL results, leaving traffic/news/airport as NULLs in the DB forever.
  // Now each subsystem succeeds or fails independently.
  //
  // 2026-04-18: PHASE A — wrap each fetch with progressive section write + per-section
  // NOTIFY so the briefing tab can populate section-by-section as providers resolve
  // instead of blinking from empty→everything at t=52s. Each wrapper returns the
  // original provider result so the extraction and assembly logic below is unchanged;
  // the DB write + NOTIFY are side effects. The final atomic write at the end of
  // this function is the authoritative reconciliation (idempotent).
  let weatherResult, trafficResult, eventsResult, airportResult, newsResult;

  // 2026-05-02: Workstream 6 commit 4 — discoverWeather owns its writeSectionAndNotify
  // (single dual-section call) and its errorMarker .catch. Returns
  // { weather_current, weather_forecast, reason }; the final-assembly block below
  // reads from the new shape.
  const weatherPromise = discoverWeather({ snapshot, snapshotId });

  // 2026-05-02: Workstream 6 commit 7 — discoverTraffic owns its writeSectionAndNotify
  // and errorMarker .catch. Returns { traffic_conditions, reason }; the final-assembly
  // block below reads from the new shape.
  const trafficPromise = discoverTraffic({ snapshot, snapshotId });

  // 2026-05-02: Workstream 6 commit 8 — discoverEvents owns its writeSectionAndNotify
  // and errorMarker .catch. Returns { events: {items, reason} | errorMarker, reason };
  // the final-assembly block below reads from the new shape (eventsResult.events.items).
  // Polymorphic SSE-write preserved: array directly when items > 0, {items, reason}
  // object when empty (matches prior orchestrator behavior for column-shape compat).
  const eventsPromise = discoverEvents({ snapshot, snapshotId });

  // 2026-05-02: Workstream 6 commit 5 — discoverAirport owns its writeSectionAndNotify
  // and errorMarker .catch. Returns { airport_conditions, reason }; the final-assembly
  // block below reads from the new shape.
  const airportPromise = discoverAirport({ snapshot, snapshotId });

  // 2026-05-02: Workstream 6 commit 6 — discoverNews owns its writeSectionAndNotify
  // and errorMarker .catch. Returns { news: {items, reason}, reason }; the final-assembly
  // block below reads from the new shape.
  const newsPromise = discoverNews({ snapshot, snapshotId });

  const fetchResults = await Promise.allSettled([
    weatherPromise,
    trafficPromise,
    eventsPromise,
    airportPromise,
    newsPromise,
  ]);

  // 2026-04-05: Extract results with REASON for every outcome (NO NULLS rule).
  // Every subsystem produces either real data or an explanatory error — never bare null.
  const subsystemNames = ['weather', 'traffic', 'events', 'airport', 'news'];
  const failedReasons = {};
  const extractedResults = fetchResults.map((result, i) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    const reason = result.reason?.message || 'Unknown error';
    console.error(`[BRIEFING] ${subsystemNames[i]} fetch failed independently: ${reason}`);
    failedReasons[subsystemNames[i]] = reason;
    return null;
  });
  [weatherResult, trafficResult, eventsResult, airportResult, newsResult] = extractedResults;

  const failedCount = Object.keys(failedReasons).length;
  if (failedCount > 0) {
    briefingLog.warn(1, `${failedCount}/5 subsystems failed — storing partial results (${Object.keys(failedReasons).join(', ')})`, OP.AI);
  }
  // If ALL five failed, that's a systemic problem — throw so the .catch() handler marks the row
  if (failedCount === 5) {
    throw new Error(`All 5 briefing subsystems failed: ${Object.values(failedReasons).join('; ')}`);
  }

  // Step 3: Schools pipeline — owns cache-or-fetch decision + SSE write internally.
  // Cache LOOKUP (querying other snapshots in the same city) stays here in the
  // orchestrator because it's cross-snapshot knowledge; cache USAGE moves into
  // discoverSchools per the pipeline contract.
  // `let` (not `const`) for schoolClosures because the downstream Array.isArray
  // defensive check may reassign to [].
  let schoolClosures, schoolClosuresReason;
  ({ closures: schoolClosures, reason: schoolClosuresReason } = await discoverSchools({
    snapshot,
    snapshotId,
    cachedClosures: cachedDailyData?.school_closures,
  }));

  // 2026-04-05: Defensive extraction — each subsystem may be null if its fetch failed.
  // NO NULLS: every field gets a typed value + reason. Empty arrays are valid; null is not.
  let eventsItems = eventsResult?.events?.items;
  if (!Array.isArray(eventsItems)) {
    if (eventsResult !== null) {
      briefingLog.warn(1, `eventsResult.events.items is ${typeof eventsItems} — defaulting to []`, OP.AI);
    }
    eventsItems = [];
  }
  let newsItems = newsResult?.news?.items;
  if (!Array.isArray(newsItems)) {
    if (newsResult !== null) {
      briefingLog.warn(1, `newsResult.news.items is ${typeof newsItems} — defaulting to []`, OP.AI);
    }
    newsItems = [];
  }
  if (!Array.isArray(schoolClosures)) {
    briefingLog.warn(1, `schoolClosures is ${typeof schoolClosures} — defaulting to []`, OP.AI);
    schoolClosures = [];
  }

  const airportCount = airportResult?.airport_conditions?.airports?.length || 0;
  const forecastHours = weatherResult?.weather_forecast?.length || 0;
  briefingLog.done(2, `weather=${forecastHours}hr, events=${eventsItems.length}, news=${newsItems.length}, traffic=${trafficResult?.traffic_conditions?.congestionLevel || 'N/A'}, airports=${airportCount}`, OP.AI);

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD BRIEFING DATA — NO NULLS RULE
  // ═══════════════════════════════════════════════════════════════════════════
  // Every JSONB column gets a well-typed value. Never bare null.
  // If a subsystem failed, the stored object includes `reason` explaining why.
  // If a subsystem succeeded but found nothing, `reason` explains that too.
  // The client uses the presence of data (not null checks) to decide what to show.
  // ═══════════════════════════════════════════════════════════════════════════

  const weatherCurrent = weatherResult?.weather_current || {
    temperature: 'N/A',
    conditions: failedReasons.weather
      ? `Weather unavailable: ${failedReasons.weather}`
      : 'Weather data could not be retrieved',
    reason: failedReasons.weather || 'Weather API returned no current conditions'
  };

  const briefingData = {
    snapshot_id: snapshotId,
    news: {
      items: newsItems,
      // 2026-04-24: SECURITY — do not interpolate raw failure reasons into the
      // client-facing `reason` field; upstream errors may contain credential
      // material. Use sentinel on failure path; preserve non-error messages.
      reason: failedReasons.news
        ? 'news-fetch-failed'
        : newsResult?.news?.reason || (newsItems.length === 0 ? 'No rideshare news found for this area' : null)
    },
    weather_current: weatherCurrent,
    weather_forecast: weatherResult?.weather_forecast || [],
    traffic_conditions: trafficResult?.traffic_conditions || {
      summary: failedReasons.traffic
        ? `Traffic unavailable: ${failedReasons.traffic}`
        : 'No traffic data available for this area',
      briefing: failedReasons.traffic
        ? `Traffic analysis could not be completed: ${failedReasons.traffic}`
        : 'Traffic data is not available for this location',
      incidents: [],
      congestionLevel: 'unknown',
      reason: failedReasons.traffic || 'Traffic data could not be retrieved'
    },
    events: eventsItems.length > 0
      ? eventsItems
      : {
          items: [],
          reason: failedReasons.events
            ? `Events fetch failed: ${failedReasons.events}`
            : eventsResult?.events?.reason || 'No events found for this area'
        },
    school_closures: schoolClosures.length > 0
      ? schoolClosures
      : { items: [], reason: schoolClosuresReason },
    airport_conditions: airportResult?.airport_conditions || {
      airports: [],
      busyPeriods: [],
      recommendations: failedReasons.airport
        ? `Airport data unavailable: ${failedReasons.airport}`
        : 'No airport data available for this area',
      reason: failedReasons.airport || 'Airport conditions could not be retrieved'
    },
    created_at: new Date(),
    updated_at: new Date(),
    // 2026-04-14: Phase 7 — populate generated_at at the final-data-store write (was dead
    // column per Phase 2 audit). Semantics: last time this briefing's data was actually
    // generated (not placeholder, not error, not cleared). Other write paths intentionally
    // do not touch this column so it preserves "last successful generation" across failures.
    // See BRIEFING-DATA-MODEL.md Appendix D.
    generated_at: new Date()
  };

  try {
    const existing = await db.select().from(briefings).where(eq(briefings.snapshot_id, snapshotId)).limit(1);

    if (existing.length > 0) {
      await db.update(briefings)
        .set({
          news: briefingData.news,
          weather_current: briefingData.weather_current,
          weather_forecast: briefingData.weather_forecast,
          traffic_conditions: briefingData.traffic_conditions,
          events: briefingData.events,
          school_closures: briefingData.school_closures,
          airport_conditions: briefingData.airport_conditions,
          updated_at: new Date(),
          // 2026-04-14: Phase 7 — refresh generated_at on every successful regeneration.
          generated_at: new Date()
        })
        .where(eq(briefings.snapshot_id, snapshotId));
    } else {
      await db.insert(briefings).values(briefingData);
    }
    briefingLog.complete(`${city}, ${state}`, Date.now() - briefingStartMs);

    // Notify clients that briefing data is ready (SSE event)
    try {
      const payload = JSON.stringify({ snapshot_id: snapshotId });
      await db.execute(sql`SELECT pg_notify('briefing_ready', ${payload})`);
      // 2026-04-28: send-side NOTIFY demoted; dispatcher logs the canonical receive-side line.
      if (String(process.env.LOG_LEVEL || 'info').toLowerCase() === 'debug') {
        briefingLog.info(`NOTIFY briefing_ready sent for ${snapshotId.slice(0, 8)}`, OP.SSE);
      }
    } catch (notifyErr) {
      briefingLog.warn(1, `Failed to send NOTIFY: ${notifyErr.message}`, OP.SSE);
    }

    // Dump last briefing row to file for debugging
    dumpLastBriefingRow().catch(err =>
      briefingLog.warn(1, `Failed to dump briefing: ${err.message}`, OP.DB)
    );

    // Memory #111: Briefing completeness check — strategist should NOT receive incomplete data.
    // Validate that critical briefing fields are present and non-empty before returning success.
    const REQUIRED_BRIEFING_FIELDS = ['events', 'news', 'weather_current', 'traffic_conditions'];
    const missingFields = REQUIRED_BRIEFING_FIELDS.filter(f => {
      const v = briefingData?.[f];
      return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
    });
    const isComplete = missingFields.length === 0;
    if (!isComplete) {
      console.warn('[Briefing] Incomplete briefing — missing fields:', missingFields);
    }

    return {
      success: true,
      briefing: briefingData,
      complete: isComplete,
      missingFields
    };
  } catch (error) {
    console.error('[BRIEFING] Database error:', error);
    return {
      success: false,
      error: error.message,
      briefing: briefingData
    };
  }
}

export async function getBriefingBySnapshotId(snapshotId) {
  try {
    const result = await db.select().from(briefings).where(eq(briefings.snapshot_id, snapshotId)).limit(1);
    return result[0] || null;
  } catch (error) {
    console.error('[BRIEFING] Error fetching briefing:', error);
    return null;
  }
}

/**
 * Refresh events data in existing briefing (when events are stale)
 * Keeps other cached data while updating events
 * @param {object} briefing - Current briefing object
 * @param {object} snapshot - Snapshot with location data
 * @returns {Promise<object>} Briefing with updated events
 */
export async function refreshEventsInBriefing(briefing, snapshot) {
  try {
    briefingLog.phase(2, `Refreshing stale events`, OP.AI);

    const eventsResult = await fetchEventsForBriefing({ snapshot });
    const eventsItems = eventsResult?.items || [];

    // NOTE: Event validation disabled - Gemini handles event discovery directly

    // Update only the events data
    briefing.events = eventsItems.length > 0 ? eventsItems : { items: [], reason: eventsResult?.reason || 'No events found' };
    briefing.updated_at = new Date();

    // Update database with fresh events
    try {
      await db.update(briefings)
        .set({
          events: briefing.events,
          updated_at: new Date()
        })
        .where(eq(briefings.snapshot_id, briefing.snapshot_id));
      briefingLog.done(2, `Events refreshed: ${eventsItems.length}`, OP.DB);
    } catch (dbErr) {
      briefingLog.warn(2, `Events DB update failed: ${dbErr.message}`, OP.DB);
    }

    return briefing;
  } catch (err) {
    briefingLog.warn(2, `Events refresh failed: ${err.message}`, OP.AI);
    return briefing;
  }
}

/**
 * Refresh traffic data in existing briefing
 * NOTE: With fetch-once pattern on client, this is only called during manual refresh
 * @param {object} briefing - Current briefing object
 * @param {object} snapshot - Snapshot with location data
 * @returns {Promise<object>} Briefing with updated traffic_conditions
 */
async function refreshTrafficInBriefing(briefing, snapshot) {
  try {
    const trafficResult = await fetchTrafficConditions({ snapshot });
    if (trafficResult) {
      briefing.traffic_conditions = trafficResult;
      briefing.updated_at = new Date();

      try {
        await db.update(briefings)
          .set({
            traffic_conditions: trafficResult,
            updated_at: new Date()
          })
          .where(eq(briefings.snapshot_id, briefing.snapshot_id));
      } catch (dbErr) {
        briefingLog.warn(1, `Traffic DB update failed`, OP.DB);
      }
    }
    return briefing;
  } catch (err) {
    briefingLog.warn(1, `Traffic refresh failed: ${err.message}`, OP.AI);
    return briefing;
  }
}

/**
 * Refresh news data in existing briefing (volatile data)
 * 2026-01-05: Added to ensure news is always fresh on request
 * News uses dual-model fetch (Gemini + GPT-5.2) which is fast enough for per-request refresh
 * @param {object} briefing - Current briefing object
 * @param {object} snapshot - Snapshot with location data
 * @returns {Promise<object>} Briefing with updated news
 */
async function refreshNewsInBriefing(briefing, snapshot) {
  try {
    const newsResult = await fetchRideshareNews({ snapshot });
    const newsItems = newsResult?.items || [];

    briefing.news = { items: newsItems, reason: newsResult?.reason || null };
    briefing.updated_at = new Date();

    try {
      await db.update(briefings)
        .set({
          news: briefing.news,
          updated_at: new Date()
        })
        .where(eq(briefings.snapshot_id, briefing.snapshot_id));
      briefingLog.done(1, `News refreshed: ${newsItems.length} items`, OP.DB);
    } catch (dbErr) {
      briefingLog.warn(1, `News DB update failed`, OP.DB);
    }

    return briefing;
  } catch (err) {
    briefingLog.warn(1, `News refresh failed: ${err.message}`, OP.AI);
    return briefing;
  }
}

/**
 * Get existing briefing or generate if missing/stale
 * SPLIT CACHE STRATEGY (2026-01-05 Updated):
 * - ALWAYS FRESH: Traffic, News (refreshed every request)
 * - CACHED 24h: School Closures
 * - FROM DB: Events (from discovered_events table)
 *
 * @param {string} snapshotId
 * @param {object} snapshot - Full snapshot object
 * @param {object} options - Options for cache behavior
 * @param {boolean} options.forceRefresh - Force full regeneration even if cached (default: false)
 * @returns {Promise<object|null>} Parsed briefing data with fresh traffic and news
 */
export async function getOrGenerateBriefing(snapshotId, snapshot, options = {}) {
  const { forceRefresh = false } = options;

  let briefing = await getBriefingBySnapshotId(snapshotId);

  // Check if briefing exists but has NULL fields (generation in progress or incomplete)
  // NULL in ANY of the four core fields = placeholder row or incomplete generation
  const isPlaceholder = briefing && (
    briefing.traffic_conditions === null ||
    briefing.events === null ||
    briefing.news === null ||
    briefing.school_closures === null
  );
  if (isPlaceholder) {
    // Log which fields are missing for debugging
    const missingFields = [];
    if (briefing.traffic_conditions === null) missingFields.push('traffic');
    if (briefing.events === null) missingFields.push('events');
    if (briefing.news === null) missingFields.push('news');
    if (briefing.school_closures === null) missingFields.push('closures');

    // Check if it's a recent placeholder (< 2 minutes old) - generation likely in progress
    const placeholderAgeMs = Date.now() - new Date(briefing.updated_at).getTime();
    if (placeholderAgeMs < 120000) {
      briefingLog.info(`In progress (${Math.round(placeholderAgeMs/1000)}s) - polling`);
      return null; // Let frontend poll again
    } else {
      briefingLog.info(`Stale placeholder - regenerating`);
      briefing = null; // Force regeneration
    }
  }

  // Check if we need to regenerate: no briefing, or forced refresh
  const needsFullRegeneration = !briefing || forceRefresh;

  if (needsFullRegeneration) {
    try {
      const result = await generateAndStoreBriefing({ snapshotId, snapshot });
      if (result.success) {
        briefing = result.briefing;
      }
    } catch (genErr) {
      briefingLog.error(1, `Generation failed`, genErr);
    }
  } else if (!isDailyBriefingStale(briefing, snapshot.timezone)) {
    // Daily briefing is still fresh (within 24h)
    // Refresh volatile data: Traffic AND News (always fresh per request)
    briefing = await refreshTrafficInBriefing(briefing, snapshot);
    briefing = await refreshNewsInBriefing(briefing, snapshot);

    // 2026-01-09: Simplified event refresh logic
    // Trust "No Cached Data" architecture - if events are stale OR empty, refresh ONCE
    // Removed redundant "FINAL SAFETY NET" check - no infinite retry loops
    if (areEventsEmpty(briefing) || isEventsStale(briefing)) {
      briefing = await refreshEventsInBriefing(briefing, snapshot);
    }
  } else {
    // Daily briefing is older than 24h, regenerate everything
    try {
      const result = await generateAndStoreBriefing({ snapshotId, snapshot });
      if (result.success) {
        briefing = result.briefing;
      }
    } catch (genErr) {
      briefingLog.error(1, `Regeneration failed`, genErr);
    }
  }

  // 2026-01-09: REMOVED "FINAL SAFETY NET"
  // Trust the "No Cached Data" architecture:
  // - If DB read returns empty, accept it (location may genuinely have no events)
  // - Events are stored in discovered_events table by the Gemini pipeline
  // - Multiple re-fetch attempts mask upstream bugs instead of surfacing them

  return briefing;
}
