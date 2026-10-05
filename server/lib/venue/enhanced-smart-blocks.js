// server/lib/venue/enhanced-smart-blocks.js
// ============================================================================
// ENHANCED SMART BLOCKS - Venue Generation Engine
// ============================================================================
//
// PURPOSE: Generates venue recommendations using VENUE_SCORER role + Google APIs
//
// PIPELINE:
//   1. Input: immediateStrategy (strategy_for_now) + briefing + snapshot
//   2. VENUE_SCORER role → 4-6 venue recommendations with coords
//   3. Google Routes API → accurate distances and drive times
//   4. Google Places (NEW) API → business hours, addresses, open/closed status
//   5. Catalog promotion → verified venues upserted to venue_catalog (venue_id returned)
//   6. Output: rankings + ranking_candidates tables populated (with venue_id FK)
//
// CALLED BY:
//   - blocks-fast.js POST route (via ensureSmartBlocksExist)
//   - triad-worker.js (background worker via NOTIFY)
//
// KEY EXPORTS:
//   - generateEnhancedSmartBlocks({ snapshotId, immediateStrategy, briefing, snapshot, user_id })
//
// ============================================================================

import { randomUUID } from 'crypto';
import { db } from '../../db/drizzle.js';
import { haversineMiles } from '../location/geo.js';
import { assertMainRunForSnapshot, withCurrentMainRun, MainRunAdmissionError } from '../main-run-admission.js';
import { mergeVenueCacheMetrics, assertCurrentStrategySource } from '../strategy/strategy-source-store.js';
import { StrategySourceChangedError } from '../strategy/strategy-source.js';
// 2026-04-11: Added discovered_events + venue_catalog for fetchTodayDiscoveredEventsWithVenue —
// the Smart Blocks pipeline now fetches today's events at the top of the try block
// and passes them to both filterBriefingForPlanner and matchVenuesToEvents.
import { rankings, ranking_candidates, strategies } from '../../../shared/schema.js';

/** Preserve the local calendar span when showing event pickup windows. */
export function isEventTimeRelevant(event, timezone, now = new Date()) {
  if (!timezone) return false;
  const start = getEventStartTime(event, timezone);
  const end = getEventEndTime(event, timezone);
  if (!start || !end || end < start) return false;
  const untilStart = start.getTime() - now.getTime();
  const sinceEnd = now.getTime() - end.getTime();
  return (untilStart >= 0 && untilStart <= 2 * 3600000) ||
    (start <= now && end >= now) ||
    (untilStart <= 0 && -untilStart <= 4 * 3600000) ||
    (sinceEnd >= 0 && sinceEnd <= 3600000);
}
// 2026-04-28: added lte, gte for the multi-day-inclusive predicate (Step 2b)
import { eq } from 'drizzle-orm';
import { generateTacticalPlan } from '../strategy/tactical-planner.js';
import { updatePhase, getEventStartTime, getEventEndTime } from '../strategy/strategy-utils.js';
import { enrichVenues } from './venue-enrichment.js';
import { matchVenuesToEvents, getVenueEventKey } from './event-matcher.js';
// 2026-04-28: Step 4 — planner-grade gate predicate (spec §5.3)
import { upsertVenue, isPlannerGradeVenue } from './venue-cache.js';
import { venuesLog } from '../../logger/workflow.js';
// 2026-04-14: Issue O — Use role config for accurate model telemetry in rankings.model_name
import { getRoleConfig } from '../ai/model-registry.js';
// 2026-01-31: Filter briefing data for venue planner to reduce token usage
import { filterBriefingForPlanner } from '../briefing/filter-for-planner.js';
import { needsReadTimeValidation, validateEvent } from '../events/pipeline/validateEvent.js';
import { readMarketEvents, toBriefingEvent } from '../events/market-event-reader.js';

/**
 * 2026-09-29: Fetch current country/metro events through the shared reader and
 * project verified venue-local instants before distance sorting. Historical design:
 * 2026-04-11: Fetch today's discovered events for the driver's state, joined with
 * venue_catalog so the prompt/matcher can use authoritative venue identity.
 *
 * This replaces the per-call DB query that used to live inside event-matcher.js,
 * which had two bugs:
 *   1. City-scoped filter dropped metro-wide events (Arlington/Frisco events for
 *      a Dallas driver). Now state-scoped, consistent with the 2026-04-11 address
 *      correctness work that state-scoped the other three event queries
 *      (briefing-service.js post-discovery read, briefing.js /events and
 *      /discovered-events routes).
 *   2. Fetched without the venue_catalog join, so the matcher had no access to
 *      canonical place_id/venue_name/coords. Now left-joined.
 *
 * 2026-04-11 (fix): Added optional `driverLat`/`driverLng` parameters that enable
 * closest-first sorting and `_distanceMiles` annotation for downstream bucketing.
 *
 * 2026-04-11 (REVERT — owner direction): The original follow-up used 40mi as a
 * VENUE_SCORER constraint expansion, allowing event venues up to 40mi away to
 * count as recommendations. That was WRONG. The 15-mile rule exists because
 * drivers need the CLOSEST high-impact venues first (The Star in Frisco, Legacy
 * West in Plano) — not distant event arenas (AAC, Dickies) that happen to have a
 * show tonight. Reverted the VENUE_SCORER distance rule to 15mi across the board.
 *
 * This helper's `maxDistanceMiles` parameter now describes the "metro context
 * radius" — the farthest distance at which an event is still useful as SURGE FLOW
 * INTELLIGENCE. Default raised from 40 → 60mi because far events (e.g. Dickies
 * Arena ~42mi from Plano) are valuable inputs to demand-flow reasoning even
 * though they're ineligible as direct recommendations. Events within 15mi become
 * candidate venues; 15-60mi events tell VENUE_SCORER where demand will ORIGINATE
 * (fans departing FROM hotels/residential areas near the driver TO the far
 * venue). The prompt-layer bucketing lives in filter-for-planner.js ::
 * formatBriefingForPrompt — this layer only annotates and sorts.
 *
 * The result is used by:
 *   - filterBriefingForPlanner (as the `todayEvents` param) — so VENUE_SCORER sees
 *     the event venue name, address, coords, distance, and time window in its prompt
 *   - matchVenuesToEvents — so the post-VENUE_SCORER matcher can use place_id as
 *     the primary identity key instead of fragile address string matching
 *
 * The shared reader now requires a joined venue country/timezone; orphan rows
 * cannot become verified event geography. Missing schedule zones report degradation.
 *
 * @param {Object} snapshot - Driver country/city/state/timezone and coordinates
 * @param {string} eventDate - Today in the driver's timezone, YYYY-MM-DD format
 * @param {number} [maxDistanceMiles=60] - Metro context radius; events farther are dropped
 *   as out-of-metro noise (Austin/Houston for a DFW driver). NOT a VENUE_SCORER rule.
 * @returns {Promise<Array>} Events with discovered_events fields, vc_* venue_catalog fields,
 *   and (when driver coords provided) a `_distanceMiles` field, sorted closest-first
 */
export async function fetchTodayDiscoveredEventsWithVenue(snapshot, eventDate, maxDistanceMiles = 60) {
  const { state, lat: driverLat, lng: driverLng } = snapshot || {};
  try {
    if (!eventDate || !snapshot?.timezone) throw new Error('Event context requires snapshot timezone/date');
    // The same canonical scope and absolute calendar window used by Briefing.
    // Read the market before distance sorting; no early arbitrary row limit.
    const result = await readMarketEvents(snapshot, { today: eventDate, limit: Infinity });
    if (result.unresolvedCount) throw new Error(`${result.unresolvedCount} saved event schedules have unresolved venue timezones`);
    const rows = result.rows.map(({ event, venue }) => ({
      ...toBriefingEvent({ event, venue }),
      vc_venue_name: venue.venue_name, vc_place_id: venue.place_id,
      vc_formatted_address: venue.formatted_address, vc_address: venue.address,
      vc_city: venue.city, vc_state: venue.state, vc_country: venue.country,
      vc_lat: venue.lat, vc_lng: venue.lng, vc_capacity: venue.capacity_estimate, vc_timezone: venue.timezone,
    }));

    // 2026-04-11 (REVERT): Distance-annotate + sort when driver coords are provided.
    // The filter is now the "metro context radius" (default 60mi) — NOT a
    // VENUE_SCORER rule. Events within this radius are kept regardless of whether
    // they're candidate territory (≤15mi) or surge-flow-intel territory (15-60mi).
    // The prompt layer (filter-for-planner.js :: formatBriefingForPrompt) buckets
    // them into NEAR EVENTS (candidates) and FAR EVENTS (surge flow intel).
    // Events beyond 60mi are dropped as out-of-metro noise (Austin/Houston for a
    // DFW driver). Orphan events (null venue_catalog coords) fall out because
    // haversineMiles returns Infinity for them.
    // 2026-04-28 (Step 4, spec §5.3): planner-grade gate. Classify every row into
    // planner-ready / re-resolve-needed / orphan, log the 3-bucket counts, then
    // continue downstream with planner-ready rows only. Subsumes Step 3's null-coords
    // orphan check with a more granular predicate that also catches missing place_id,
    // timezone, etc. — venues that look "complete" by coords alone but lack identity
    // needed for the matcher / map / planner.
    const classified = rows.map(row => {
      const venueShape = {
        place_id: row.vc_place_id,
        formatted_address: row.vc_formatted_address,
        city: row.vc_city,
        state: row.vc_state,
        lat: row.vc_lat,
        lng: row.vc_lng,
        timezone: row.vc_timezone,
      };
      const { ok, missing } = isPlannerGradeVenue(venueShape);
      let _bucket;
      if (ok) _bucket = 'planner-ready';
      else if (row.vc_place_id) _bucket = 're-resolve-needed';
      else _bucket = 'orphan';
      return { ...row, _bucket, _missingFields: missing };
    });

    const gateCounts = {
      'planner-ready': classified.filter(r => r._bucket === 'planner-ready').length,
      're-resolve-needed': classified.filter(r => r._bucket === 're-resolve-needed').length,
      'orphan': classified.filter(r => r._bucket === 'orphan').length,
    };

    console.log(
      `[VENUE CATALOG] [GATE] [PLANNER-GRADE] [NEW EVENTS PIPELINE] ` +
      `planner-ready=${gateCounts['planner-ready']}, ` +
      `re-resolve-needed=${gateCounts['re-resolve-needed']}, ` +
      `orphan=${gateCounts.orphan} — ` +
      `spec §5.3: planner-grade requires {place_id, formatted_address, city, state, lat, lng, timezone}; ` +
      `re-resolve-needed has place_id (recoverable via Places (NEW) API), orphan lacks place_id`
    );

    const plannerReady = classified.filter(row => {
      if (row._bucket !== 'planner-ready') return false;
      if (!needsReadTimeValidation(row.schema_version)) return true;
      const validation = validateEvent(row, { timezone: row.vc_timezone });
      // The reader already checked absolute overlap with the viewer's day.
      return validation.valid || ['starts_in_future', 'ended_before_today'].includes(validation.reason);
    });

    if (driverLat != null && driverLng != null) {
      const annotated = plannerReady.map(row => ({
        ...row,
        _distanceMiles: haversineMiles(driverLat, driverLng, row.vc_lat, row.vc_lng),
      }));

      const reachable = annotated
        .filter(r => r._distanceMiles <= maxDistanceMiles)
        .sort((a, b) => a._distanceMiles - b._distanceMiles);
      const beyondMetro = annotated.length - reachable.length;

      const nearCount = reachable.filter(r => r._distanceMiles <= 15).length;
      const farCount = reachable.length - nearCount;

      console.log(
        `[VENUE] [EVENTS] [DB] [discovered_events] [METRO-CONTEXT] [NEW EVENTS PIPELINE] ` +
        `${plannerReady.length} planner-ready → ${reachable.length} within ${maxDistanceMiles}mi ` +
        `(${nearCount} near ≤15mi candidates, ${farCount} far >15mi surge intel, ` +
        `${beyondMetro} beyond-metro) — multi-day inclusive, distance-annotated, closest-first`
      );
      return reachable;
    }

    return plannerReady;
  } catch (err) {
    // Non-fatal — return empty array so the pipeline continues with generic venues.
    // The alternative (throwing) would block blocks-fast on any transient DB issue,
    // which is worse than degrading to the event-less code path.
    // 2026-04-14: Issue P — Use structured workflow logger + return error flag for telemetry
    venuesLog.warn(1, `[EVENT-FETCH-FAILED] fetchTodayDiscoveredEventsWithVenue: ${err.message} (state=${state}, date=${eventDate})`);
    return { events: [], eventFetchFailed: true, error: err.message };
  }
}

/**
 * 2026-03-28: Promote verified enriched venues to venue_catalog.
 * Closes the canonicalization gap — SmartBlocks venues become first-class catalog entities
 * for cross-session learning, event joins, and map/bars systems.
 *
 * Uses Promise.allSettled so one DB failure doesn't break the pipeline.
 * Only promotes venues where Google Places verified the match (placeVerified + placeId).
 *
 * @param {Array} enrichedVenues - Output from enrichVenues()
 * @param {Object} snapshot - Snapshot context (city, state for upsertVenue)
 * @returns {Promise<Map<string, string>>} Map of stable venue identity (getVenueEventKey) -> venue_id (UUID)
 */
async function promoteToVenueCatalog(enrichedVenues) {
  // 2026-04-02: FIX - Also require a valid address to avoid NOT NULL constraint violations.
  // Address can be null when geocode/Places (NEW) API fails to resolve during enrichment.
  const promotable = enrichedVenues.filter(v =>
    v.placeVerified === true &&
    v.placeId &&
    v.address &&
    v.address !== 'Address unavailable'
  );

  if (promotable.length === 0) {
    venuesLog.info(3, 'No verified venues to promote to catalog');
    return new Map();
  }

  const results = await Promise.allSettled(
    promotable.map(v =>
      upsertVenue(
        {
          venueName: v.name,
          city: v.city,
          state: v.state,
          country: v.country,
          timezone: v.timezone,
          lat: v.lat,
          lng: v.lng,
          placeId: v.placeId,
          address: v.address,
          formattedAddress: v.address,
          hours: v.hoursFullWeek,
          hoursFullWeek: v.hoursFullWeek,
          hoursSource: v.hoursFullWeek ? 'google_places' : null,
          category: v.category || 'venue',
          source: 'smart_blocks_promotion',
        },
        { recordStatus: 'verified' }
      )
    )
  );

  const venueIdMap = new Map();
  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value?.venue_id) {
      venueIdMap.set(getVenueEventKey(promotable[index]), result.value.venue_id);
    } else if (result.status === 'fulfilled') {
      // 2026-05-08: Fulfilled but no venue_id — rare race (UPDATE matched 0 rows
      // because the existing row was deleted between lookup and update, or
      // insertVenue's place_id fallback couldn't find the row). Pre-fix this
      // silently dropped the venue with no telemetry, leaving promoteToVenueCatalog
      // callers wondering why the venue never appeared in the map. Log explicitly
      // and skip — the map entry is correctly omitted; the venue stays
      // non-promoted but the cause is now visible.
      venuesLog.warn(3, `Catalog promotion fulfilled with no venue_id for "${promotable[index].name}" — skipped (likely race or place_id-fallback miss)`);
    } else if (result.status === 'rejected') {
      // 2026-04-09: D-096 FIX - Unwrap Drizzle ORM error wrappers to surface real PG error code/detail.
      // Drizzle wraps PostgreSQL errors in .cause or .original; err.code is undefined on the wrapper.
      const err = result.reason;
      const pgCode = err?.cause?.code || err?.original?.code || err?.code || 'unknown';
      venuesLog.warn(3, `Catalog promotion failed for "${promotable[index].name}": ${pgCode}`);
    }
  });

  return venueIdMap;
}

/**
 * Generate enhanced smart blocks using VENUE_SCORER role
 * Takes IMMEDIATE strategy (where to go NOW) + briefing + user location → venue recommendations
 *
 * @param {Object} params
 * @param {string} params.snapshotId - Snapshot ID
 * @param {string} params.immediateStrategy - "Where to go NOW" strategy (required)
 * @param {Object} params.briefing - Gemini briefing (optional)
 * @param {Object} params.snapshot - Snapshot context
 * @param {string} params.user_id - User ID (currently used only for ranking record attribution, not scoring)
 * @param {EventEmitter} params.phaseEmitter - Optional emitter for SSE phase updates
 */
// 2026-04-14: Issue T — user_id is currently used only for ranking record attribution, not scoring.
// Future: thread driver preferences (max deadhead, home base, vehicle class) into venue scoring.
// The strategist layer was enriched with driver prefs (2026-04-11) but the venue layer was not.
export async function generateEnhancedSmartBlocks({ snapshotId, immediateStrategy, briefing, snapshot, user_id, phaseEmitter }) {
  const admission = await assertMainRunForSnapshot(snapshotId);
  if (admission.status === 'complete') throw new MainRunAdmissionError(409, 'main_run_restart_required', 'Continue with saved preferences before generating new venues.');
  const startTime = Date.now();
  const correlationId = randomUUID();
  const rankingId = randomUUID();

  const location = snapshot.formatted_address || `${snapshot.city}, ${snapshot.state}`;
  venuesLog.start(`venue cards`);

  // Guard: Check if immediate strategy exists and is not empty
  if (!immediateStrategy || typeof immediateStrategy !== 'string' || !immediateStrategy.trim()) {
    throw new Error('blocks_input_missing_immediate_strategy');
  }

  const currentSource = await assertCurrentStrategySource(snapshotId);
  if (currentSource.strategy.strategy_for_now !== immediateStrategy ||
      (briefing && briefing.generation_token !== currentSource.briefing.generation_token)) throw new StrategySourceChangedError();
  briefing = currentSource.briefing;

  // The persisted complete Briefing above is the source for this Strategy and
  // its venue plan. Empty fabricated sections cannot stand in for that receipt.

  venuesLog.phase(1, `Input ready: strategy=${immediateStrategy.length}chars, briefing=${Object.keys(briefing).filter(k => briefing[k]).length} fields`);

  try {
    // Step 1: Call VENUE_SCORER role with IMMEDIATE strategy (where to go NOW)
    // Phase: 'venues' - AI venue recommendation
    await updatePhase(snapshotId, 'venues', { phaseEmitter });

    // Fetch today's events from the canonical country/metro reader, joined with
    // venue_catalog. This is the authoritative event source for the Smart Blocks pipeline.
    // Pre-fetched here (not inside filter or matcher) because both downstream consumers
    // need the same list, and running the query once avoids a redundant DB round-trip.
    // Timezone-aware date computation matches filter-for-planner.js :: getLocalDate().
    //
    // 2026-04-11 (REVERT): Pass driver lat/lng so the helper can annotate each event
    // with distance and sort closest-first. The helper's `maxDistanceMiles` (default
    // 60mi) is the METRO CONTEXT RADIUS — not a VENUE_SCORER rule. The prompt-layer
    // bucketing in formatBriefingForPrompt splits events into NEAR (≤15mi candidates)
    // and FAR (15-60mi surge flow intel). The 15-mile rule applies to ALL venue
    // recommendations — far events are intelligence, not destinations.
    // 2026-04-14: Issue N — Require timezone per NO FALLBACKS rule.
    // UTC fallback near midnight can shift event selection by one day.
    if (!snapshot.timezone) {
      venuesLog.warn(1, `snapshot.timezone is missing for ${snapshotId} — cannot compute today's date. Skipping event fetch.`);
      // Continue pipeline with empty events rather than wrong-day events
    }
    const todayDate = snapshot.timezone
      ? new Date().toLocaleDateString('en-CA', { timeZone: snapshot.timezone })
      : null;
    // 2026-04-14: Issue P — fetchTodayDiscoveredEventsWithVenue returns Array on success,
    // or { events: [], eventFetchFailed: true } on error. Normalize here.
    const eventResult = todayDate
      ? await fetchTodayDiscoveredEventsWithVenue(snapshot, todayDate)
      : { events: [], eventFetchFailed: true, error: 'Snapshot timezone is missing' };
    const eventFetchFailed = !Array.isArray(eventResult) && eventResult?.eventFetchFailed;
    const todayEvents = Array.isArray(eventResult) ? eventResult : (eventResult?.events || []);
    venuesLog.phase(1, eventFetchFailed
      ? `[DEGRADED] Event fetch failed — proceeding with 0 events (generic venues only)`
      : `Fetched ${todayEvents.length} reachable events for ${snapshot.state} on ${todayDate || 'NO_TZ'}`);

    // 2026-01-31: Filter briefing data for venue planner
    // 2026-04-11: Now passes pre-fetched country/metro events as 3rd arg — the filter
    // uses these directly instead of the legacy city-scoped briefing.events path.
    const filteredBriefing = filterBriefingForPlanner(briefing, snapshot, todayEvents);

    const plannerStart = Date.now();
    const venuesPlan = await generateTacticalPlan({
      strategy: immediateStrategy,  // Uses "where to go NOW" strategy
      snapshot,
      briefingContext: filteredBriefing  // 2026-01-31: Pass filtered briefing for enhanced recommendations
    });
    const plannerMs = Date.now() - plannerStart;

    if (!venuesPlan || !venuesPlan.recommended_venues || venuesPlan.recommended_venues.length === 0) {
      throw new Error('VENUE_SCORER role returned no venues');
    }

    venuesLog.done(1, `VENUE_SCORER returned ${venuesPlan.recommended_venues.length} venues`, plannerMs);

    // 2026-05-03 Workstream 6 Step 3: persist rolled-up venue-catalog cache stats
    // to the strategies row. Best-effort write — if this fails we log and continue;
    // the metric is operational telemetry, not on the user's critical path.
    if (venuesPlan.cache_metrics) {
      try {
        await withCurrentMainRun(snapshotId, tx => tx.update(strategies)
          .set({ venue_cache_metrics: mergeVenueCacheMetrics(venuesPlan.cache_metrics) })
          .where(eq(strategies.snapshot_id, snapshotId)));
      } catch (err) {
        venuesLog.warn(1, `Failed to persist venue_cache_metrics for snapshot ${snapshotId}: ${err.message}`);
      }
    }

    // Step 2: Enrich venues with Google APIs (Places, Routes, Geocoding)
    // Phase: 'routing' - Google Routes + Places (NEW) APIs
    // 2026-04-27 (Commit 7): caller pre-log removed — updatePhase emits the canonical
    // [VENUE] [PHASE-UPDATE] line. Avoids three-lines-per-transition duplication.
    await updatePhase(snapshotId, 'routing', { phaseEmitter });

    const enrichmentStart = Date.now();
    const driverLocation = {
      lat: snapshot.lat,
      lng: snapshot.lng
    };

    venuesLog.phase(2, `Driver at ${driverLocation.lat.toFixed(6)},${driverLocation.lng.toFixed(6)} - calling Google Routes API`);

    const enrichedVenues = await enrichVenues(
      venuesPlan.recommended_venues,
      driverLocation,
      snapshot
    );
    if (!enrichedVenues.length) throw new Error('No verified venues with usable routes are available');
    const enrichmentMs = Date.now() - enrichmentStart;

    venuesLog.done(2, `Routes API: ${enrichedVenues.map(v => `${v.name.slice(0,20)}=${v.distanceMiles}mi`).join(', ')}`, enrichmentMs);

    // Step 2.3: Match venues to discovered events from DB
    // Phase: 'places' - Google Places (NEW) API (event matching happens here too)
    // 2026-04-11: matchVenuesToEvents no longer queries the DB or accepts city/state/date —
    // it takes the pre-fetched `todayEvents` directly and matches on place_id (primary) +
    // venue_id (secondary, dormant at this call site) + name (tertiary fallback).
    await updatePhase(snapshotId, 'places', { phaseEmitter });

    const eventMatches = matchVenuesToEvents(enrichedVenues, todayEvents);
    venuesLog.phase(3, `Event matching: ${eventMatches.size} venues matched to events`);

    // Events already passed the canonical stored-data validator. Match their
    // identity and actual local span once; a second model cannot verify evidence
    // merely by restating it. This set is stored in candidate.venue_events.
    const relevantEvents = new Map();
    for (const venue of enrichedVenues) {
      const key = getVenueEventKey(venue);
      const events = (eventMatches.get(key) || []).filter(event => isEventTimeRelevant(event, event.timezone || snapshot.timezone));
      relevantEvents.set(key, events);
    }

    // Step 3: Create ranking record
    // 2026-04-14: Issue O — Use VENUE_SCORER role config for accurate model telemetry.
    // Previously used STRATEGY_CONSOLIDATOR env var which is the wrong role entirely.
    const venueRoleConfig = getRoleConfig('VENUE_SCORER');
    const ranking = {
      ranking_id: rankingId,
      snapshot_id: snapshotId,
      correlation_id: correlationId,
      user_id: user_id && user_id.trim() !== '' ? user_id : null,
      city: snapshot.city || null,
      ui: null,
      model_name: `${venueRoleConfig.model}-venue-scorer`,
      scoring_ms: 0,
      planner_ms: plannerMs,
      total_ms: 0,
      timed_out: false,
      // 2026-04-14: Issue P — Record if event context was degraded
      path_taken: eventFetchFailed ? 'enhanced-smart-blocks:degraded-events' : 'enhanced-smart-blocks'
    };
    
    // Step 3.5: Promote verified venues to venue_catalog
    // 2026-03-28: Bridges SmartBlocks to canonical venue identity
    const venueIdMap = await promoteToVenueCatalog(enrichedVenues);
    venuesLog.phase(4, `Promoted ${venueIdMap.size}/${enrichedVenues.length} venues to catalog, storing ${enrichedVenues.length} candidates`);

    // Step 4: Insert ranking candidates with enriched Google data
    const candidates = enrichedVenues.map((enriched, index) => {
      // Calculate value metrics
      const distanceMiles = Number(enriched.distanceMiles);
      const driveMinutes = enriched.driveTimeMinutes;
      // HEURISTIC: Static $1.50/mile estimate. No surge, offer, or airport multiplier data.
      // value_grade is a distance-based approximation, not economic truth. See VENUES.md §11.
      const estimatedEarnings = distanceMiles * 1.50;
      const valuePerMin = driveMinutes > 0 ? estimatedEarnings / driveMinutes : 0;

      // Get matched events for this venue
      // 2026-01-14: Filter to only time-relevant events (within 2h future or 4h past start)
      const allMatchedEvents = eventMatches.get(getVenueEventKey(enriched)) || [];
      const matchedEvents = relevantEvents.get(getVenueEventKey(enriched)) || [];
      const hasEvent = matchedEvents.length > 0;

      // 2026-04-27 (Commit 7): demoted per-venue line from info to debug. Set
      // LOG_VERBOSE_COMPONENTS=VENUE to see one line per enriched venue.
      venuesLog.debug(`"${enriched.name}" ${distanceMiles}mi, ${driveMinutes}min, isOpen=${enriched.isOpen}, hours=${enriched.businessHours || 'unknown'}${hasEvent ? `, EVENT: ${matchedEvents[0].title}` : (allMatchedEvents.length > 0 ? ' (event stale)' : '')}`);

      // Grade venues: A = $1+/min, B = $0.50-$1/min, C = <$0.50/min
      let valueGrade = 'C';
      if (valuePerMin >= 1.0) valueGrade = 'A';
      else if (valuePerMin >= 0.50) valueGrade = 'B';

      return {
        id: randomUUID(),
        ranking_id: rankingId,
        snapshot_id: snapshotId,
        block_id: `venue-${index + 1}`,
        name: enriched.name,
        lat: enriched.lat,
        lng: enriched.lng,
        rank: enriched.rank || index + 1,

        // Canonical identity
        place_id: enriched.placeId,
        venue_id: venueIdMap.get(getVenueEventKey(enriched)) || null,
        distance_miles: distanceMiles,
        drive_minutes: driveMinutes,
        value_per_min: valuePerMin,
        value_grade: valueGrade,
        not_worth: valuePerMin < 0.30, // Flag low-value venues
        
        // Venue details
        pro_tips: enriched.pro_tips || [],
        staging_tips: enriched.staging_name || null,
        staging_name: enriched.staging_name || null,
        staging_lat: enriched.staging_lat || null,
        staging_lng: enriched.staging_lng || null,
        venue_events: matchedEvents,  // 2026-01-14: Time-relevant events only (within 2h future or 4h past)
        business_hours: enriched.businessHours,
        closed_reasoning: enriched.strategic_timing || null,

        est_earnings_per_ride: estimatedEarnings,
        model_score: 1.0 - (index * 0.1),
        exploration_policy: 'greedy',
        epsilon: 0.0,
        was_forced: false,
        propensity: 1.0,
        features: {
          category: enriched.category,
          pro_tips: enriched.pro_tips,
          strategic_timing: enriched.strategic_timing,
          isOpen: enriched.isOpen,
          address: enriched.address,
          streetViewUrl: enriched.streetViewUrl,
          hasEvent: hasEvent,
          eventBadge: hasEvent ? matchedEvents[0].title : null
        },
        h3_r8: null,
        distance_source: enriched.distanceSource || 'google_routes_api',
        rate_per_min_used: 1.50,
        trip_minutes_used: driveMinutes,
        wait_minutes_used: 0,
        // 2026-04-16: Driver preference scoring — persisted for client-side deadhead badge
        beyond_deadhead: enriched.beyond_deadhead || false,
        distance_from_home_mi: enriched.distance_from_home_mi || null
      };
    });
    
    const totalMs = Date.now() - startTime;
    // One final transaction publishes the ranking and all candidates together.
    // A settings save/new Continue wins before this transaction or after it;
    // an obsolete worker cannot publish into the replacement run.
    const persistedRankingId = await withCurrentMainRun(snapshotId, async (tx, admission) => {
      const finalSource = await assertCurrentStrategySource(snapshotId, tx);
      if (finalSource.briefing.generation_token !== currentSource.briefing.generation_token ||
          finalSource.strategy.strategy_for_now !== immediateStrategy) throw new StrategySourceChangedError();
      const [existing] = await tx.select().from(rankings).where(eq(rankings.snapshot_id, snapshotId)).limit(1);
      if (existing) return existing.ranking_id;
      await tx.insert(rankings).values({ ...ranking, user_id: admission.user_id, total_ms: totalMs });
      await tx.insert(ranking_candidates).values(candidates);
      return rankingId;
    });
    if (persistedRankingId !== rankingId) return { ok: true, rankingId: persistedRankingId, deduplicated: true };
    venuesLog.done(4, `Stored ${candidates.length} candidates`, totalMs);
    venuesLog.complete(`${candidates.length} venues`, totalMs);

    return { ok: true, rankingId: persistedRankingId, venues: candidates.length };

  } catch (err) {
    venuesLog.error(0, `Failed for ${snapshotId}`, err);
    throw err;
  }
}
