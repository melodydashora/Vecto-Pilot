// Briefing orchestration: short claim transaction, generation-fenced section writes,
// and strict final reconciliation before Strategy can consume the context.

import { db } from '../../db/drizzle.js';
import { assertMainRunForSnapshot, withCurrentMainRun, MainRunAdmissionError } from '../main-run-admission.js';
import { randomUUID } from 'node:crypto';
import { withBriefingGeneration, writeBriefingGeneration, BriefingSupersededError } from './briefing-generation.js';
import { assertSnapshotReady } from '../location/snapshot-readiness.js';
import { sealFailedSection, BRIEFING_FIELDS, briefingSectionIssue, briefingFailureReason, getBriefingReadiness, BriefingNotReadyError, assertBriefingReady, waitForBriefing } from './briefing-readiness.js';
import { briefings, snapshots } from '../../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import { briefingLog, OP } from '../../logger/workflow.js';
import { errorMarker } from './briefing-notify.js';
import { dumpLastBriefingRow } from './dump-last-briefing.js';

// Pipeline contracts (orchestrator's Promise.allSettled fan-out)
import { discoverSchools } from './pipelines/schools.js';
import { discoverWeather } from './pipelines/weather.js';
import { discoverAirport } from './pipelines/airport.js';
import { discoverNews } from './pipelines/news.js';
import { discoverHoliday } from './pipelines/holiday.js';
import { discoverTraffic } from './pipelines/traffic.js';
import { discoverEvents } from './pipelines/events.js';

// Same-process callers share in-flight work for this owned snapshot. Preparing
// upstream Briefing does not admit Strategy; completed source stays immutable.
const inFlightBriefings = new Map();
export function generateAndStoreBriefing({ snapshotId, snapshot, forceRefresh = false }) {
  if (!forceRefresh && inFlightBriefings.has(snapshotId)) return inFlightBriefings.get(snapshotId);
  const promise = Promise.resolve().then(() => generateWithClaim({ snapshotId, snapshot, forceRefresh }));
  inFlightBriefings.set(snapshotId, promise);
  const cleanup = () => {
    if (inFlightBriefings.get(snapshotId) === promise) inFlightBriefings.delete(snapshotId);
  };
  promise.then(cleanup, cleanup);
  return promise;
}

async function readAfterClaim(snapshotId) {
  await assertMainRunForSnapshot(snapshotId, { allowUpstream: true });
  // Serialize with placeholder claims, never accepting the old complete row while
  // its replacement is claiming ownership but has not yet committed.
  return db.transaction(async tx => {
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${snapshotId})) AS acquired`);
    if (!lock.rows[0]?.acquired) return null;
    const [row] = await tx.select().from(briefings).where(eq(briefings.snapshot_id, snapshotId)).limit(1);
    return row;
  });
}

async function awaitCurrentGeneration(snapshotId) {
  const briefing = await waitForBriefing({ snapshotId, read: () => readAfterClaim(snapshotId) });
  return { success: true, complete: true, briefing, deduplicated: true };
}

async function generateWithClaim({ snapshotId, snapshot, forceRefresh }) {
  // This transaction ends before any provider, cache lookup, or wait. No extra
  // pool/URL is needed: generators cannot hold one client while needing another.
  const claim = await withCurrentMainRun(snapshotId, async (tx, admission) => {
    // Preserve the existing advisory-lock namespace/key during rollout.
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${snapshotId})) AS acquired`);
    if (!lock.rows[0]?.acquired) return null;
    const [existing] = await tx.select().from(briefings).where(eq(briefings.snapshot_id, snapshotId)).limit(1);
    if (forceRefresh && existing) throw new MainRunAdmissionError(409, 'main_run_restart_required', 'A new Continue and fresh snapshot are required to replace this Briefing.');
    // This is immutable replay of this exact source generation. Explicit
    // Strategy intents consume it through their own unique snapshot identity.
    if (getBriefingReadiness(existing, snapshotId).ready) return { briefing: existing };
    if (admission.status === 'complete') throw new MainRunAdmissionError(409, 'main_run_restart_required', 'Continue with saved preferences to collect a fresh run.');
    if (!forceRefresh && existing?.status === 'pending' && existing.generation_token) return { joinPending: true };
    if (existing) throw new MainRunAdmissionError(409, 'main_run_restart_required', 'This Briefing did not complete. Continue again to collect fresh context.');
    const generationToken = randomUUID();
    const placeholder = {
      ...Object.fromEntries(BRIEFING_FIELDS.map(field => [field, null])),
      generation_token: generationToken,
      status: 'pending', generated_at: null, updated_at: new Date(),
    };
    const rows = existing
      ? await tx.update(briefings).set(placeholder).where(eq(briefings.snapshot_id, snapshotId)).returning()
      : await tx.insert(briefings).values({ ...placeholder, snapshot_id: snapshotId, created_at: new Date() })
        .onConflictDoNothing({ target: briefings.snapshot_id }).returning();
    return rows.length ? { generationToken, upstream: admission.context_kind === 'upstream' } : null;
  }, { allowUpstream: true });
  if (!claim) throw new MainRunAdmissionError(409, 'main_run_busy', 'Another request is claiming this run. Retry after its claim completes.');
  if (claim.joinPending) return awaitCurrentGeneration(snapshotId);
  if (claim.briefing) return { success: true, complete: true, briefing: claim.briefing, deduplicated: true };

  return withBriefingGeneration(snapshotId, claim.generationToken, async signal => {
    try {
      return await generateBriefingInternal({ snapshotId, snapshot, signal });
    } catch (error) {
      // Superseded runs retain their original evidence/status; they never join
      // another run or publish an old failure into the historical generation.
      if (error instanceof MainRunAdmissionError) throw error;
      if (error instanceof BriefingSupersededError) return awaitCurrentGeneration(snapshotId);
      const failure = errorMarker(error);
      const stored = await writeBriefingGeneration(snapshotId, {
        ...Object.fromEntries(BRIEFING_FIELDS.map(field => [field, failure])),
        status: 'error', generated_at: null, updated_at: new Date(),
      });
      // An obsolete failure must not mark the new Briefing or its Strategy failed.
      // Join the current generation instead of returning the obsolete failure.
      if (!stored) return awaitCurrentGeneration(snapshotId);
      return { success: false, complete: false, briefing: stored, error: briefingFailureReason(error), _generationFailed: true };
    }
  }, { upstream: claim.upstream });
}

async function generateBriefingInternal({ snapshotId, snapshot, signal }) {
  signal.throwIfAborted();
  await assertMainRunForSnapshot(snapshotId, { allowUpstream: true });
  // A supplied copy is only a caller convenience, never proof of the owned
  // location. Every provider must use the same complete persisted observation.
  const [savedSnapshot] = await db.select().from(snapshots)
    .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
  snapshot = assertSnapshotReady(savedSnapshot, snapshotId);

  briefingLog.start(`${snapshot.city}, ${snapshot.state}`);
  const briefingStartMs = Date.now();

  const { city, state } = snapshot;

  // Every admitted generation collects its own source evidence. Only work that
  // is still in flight is shared; another snapshot's school result is not fresh.

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
  let weatherResult, trafficResult, eventsResult, airportResult, newsResult, holidayResult, schoolsResult;

  // 2026-05-02: Workstream 6 commit 4 — discoverWeather owns its writeSectionAndNotify
  // (single dual-section call) and its errorMarker .catch. Returns
  // { weather_current, weather_forecast, reason }; the final-assembly block below
  // reads from the new shape.
  await assertMainRunForSnapshot(snapshotId, { allowUpstream: true });
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
  const eventsPromise = discoverEvents({ snapshot, snapshotId, signal });

  // 2026-05-02: Workstream 6 commit 5 — discoverAirport owns its writeSectionAndNotify
  // and errorMarker .catch. Returns { airport_conditions, reason }; the final-assembly
  // block below reads from the new shape.
  const airportPromise = discoverAirport({ snapshot, snapshotId });

  // 2026-05-02: Workstream 6 commit 6 — discoverNews owns its writeSectionAndNotify
  // and errorMarker .catch. Returns { news: {items, reason}, reason }; the final-assembly
  // block below reads from the new shape.
  const newsPromise = discoverNews({ snapshot, snapshotId });

  // 2026-07-06: holiday moved from snapshot creation to the briefing pipeline
  // (Melody — snapshot stays deterministic; LLM-involved detection lives here).
  // discoverHoliday owns its writeSectionAndNotify and writes errorMarker on
  // failure; the final-assembly block below ALSO carries the section so the
  // authoritative atomic write never depends on the lossy progressive channel.
  const holidayPromise = discoverHoliday({ snapshot, snapshotId });
  const schoolsPromise = discoverSchools({ snapshot, snapshotId });

  const fetchResults = await Promise.allSettled([
    weatherPromise,
    trafficPromise,
    eventsPromise,
    airportPromise,
    newsPromise,
    holidayPromise,
    schoolsPromise,
  ]);
  signal.throwIfAborted();

  // 2026-04-05: Extract results with REASON for every outcome (NO NULLS rule).
  // Every subsystem produces either real data or an explanatory error — never bare null.
  const subsystemNames = ['weather', 'traffic', 'events', 'airport', 'news', 'holiday', 'schools'];
  const failedReasons = {};
  const extractedResults = fetchResults.map((result, i) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    const reason = result.reason?.message || 'Unknown error';
    briefingLog.warn(1, `${subsystemNames[i]} failed: ${briefingFailureReason(reason)}`, OP.AI);
    failedReasons[subsystemNames[i]] = reason;
    return null;
  });
  [weatherResult, trafficResult, eventsResult, airportResult, newsResult, holidayResult, schoolsResult] = extractedResults;

  const failedSection = name => errorMarker(new Error(failedReasons[name] || `${name} returned no data`));
  const listSection = value => Array.isArray(value?.items) && value.items.length > 0 ? value.items : value;
  const briefingData = {
    news: newsResult?.news ?? failedSection('news'),
    weather_current: weatherResult?.weather_current ?? failedSection('weather'),
    weather_forecast: weatherResult?.weather_forecast ?? failedSection('weather'),
    traffic_conditions: trafficResult?.traffic_conditions ?? failedSection('traffic'),
    events: listSection(eventsResult?.events) ?? failedSection('events'),
    school_closures: schoolsResult
      ? (schoolsResult.closures?.length > 0 ? schoolsResult.closures : { items: schoolsResult.closures, reason: schoolsResult.reason })
      : failedSection('schools'),
    airport_conditions: airportResult?.airport_conditions ?? failedSection('airport'),
    holiday: holidayResult?.holiday ?? failedSection('holiday'),
    updated_at: new Date(),
  };

  // A fulfilled promise is not proof of good data: legacy provider boundaries may
  // return failure sentinels. Never replace them with invented empty results.
  for (const field of BRIEFING_FIELDS) {
    const issue = briefingSectionIssue(field, briefingData[field]);
    if (issue && !briefingData[field]?._generationFailed) {
      // 2026-09-11: keep the section's safe known data (e.g. retained airport identities)
      // under the failure marker instead of discarding it (briefing-readiness.js).
      briefingData[field] = sealFailedSection(briefingData[field], issue);
    }
  }
  const hasFailure = BRIEFING_FIELDS.some(field => briefingData[field]?._generationFailed);
  briefingData.status = hasFailure ? 'error' : 'complete';
  briefingData.generated_at = hasFailure ? null : new Date();

  // The atomic final write is the completion boundary, including its status.
  // Progressive section writes never set complete. Failed persistence throws.
  const stored = await writeBriefingGeneration(snapshotId, briefingData);
  if (!stored) throw new BriefingSupersededError();

  // Keep the established event name: consumers refetch the row and read status.
  // Per-section notifications remain progress only, never the Strategy gate.
  try {
    const payload = JSON.stringify({ snapshot_id: snapshotId, status: stored.status });
    await db.execute(sql`SELECT pg_notify('briefing_ready', ${payload})`);
  } catch (error) {
    briefingLog.warn(1, `Failed to send Briefing notification: ${error.message}`, OP.SSE);
  }
  dumpLastBriefingRow(snapshotId).catch(error => briefingLog.warn(1, `Failed to dump briefing: ${error.message}`, OP.DB));

  if (hasFailure) {
    const error = new BriefingNotReadyError(stored, snapshotId);
    return { success: false, complete: false, briefing: stored, error: error.message, _generationFailed: true };
  }
  briefingLog.complete(`${city}, ${state}`, Date.now() - briefingStartMs);
  return { success: true, complete: true, briefing: stored };
}

export async function getBriefingBySnapshotId(snapshotId) {
  try {
    const result = await db.select().from(briefings).where(eq(briefings.snapshot_id, snapshotId)).limit(1);
    return result[0] || null;
  } catch (error) {
    console.error('[BRIEFING] Error fetching briefing:', error);
    throw error;
  }
}

/**
 * Legacy section refresh cannot replace an admitted run's stored context.
 * Callers receive a clear requirement to Continue with a fresh snapshot.
 */
export async function refreshEventsInBriefing(briefing, snapshot) {
  return getOrGenerateBriefing(briefing.snapshot_id, snapshot, { forceRefresh: true });
}

/** Get a completed Briefing, sharing pending work unless explicitly refreshed. */
export async function getOrGenerateBriefing(snapshotId, snapshot, { forceRefresh = false } = {}) {
  const result = await generateAndStoreBriefing({ snapshotId, snapshot, forceRefresh });
  assertBriefingReady(result.briefing, snapshotId);
  return result.briefing;
}
