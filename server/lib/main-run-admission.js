import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, lte, ne, sql } from 'drizzle-orm';
import { db } from '../db/drizzle.js';
import { users, driver_profiles, driver_vehicles, offer_rulesets, main_run_admissions, snapshots, briefings } from '../../shared/schema.js';
import { DRIVER_SERVICES } from '../../shared/driver-services.js';
import { driverProfileResponse } from './driver-profile-response.js';
import { migrateRuleset } from './offers/rules-engine.js';
import { validateRuleset } from './offers/ruleset-schema.js';
import { hashRuleset } from './offers/ruleset-hash.js';
import { sessionIsLive } from './auth/session-policy.js';
import { getSnapshotReadiness, assertSnapshotReady } from './location/snapshot-readiness.js';
import { getBriefingReadiness, BRIEFING_FIELDS } from './briefing/briefing-readiness.js';
import { getLocalIso } from '../../shared/dayparts.js';
import { validSnapshotDate, validSnapshotTimezone } from '../util/validate-snapshot.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class MainRunAdmissionError extends Error {
  constructor(status, code, message = code, details = {}) {
    super(message);
    this.name = 'MainRunAdmissionError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const fail = (status, code, message, details) => { throw new MainRunAdmissionError(status, code, message, details); };
export const validSettingsRevision = value => Number.isInteger(value) && value >= 1 && value < 2147483647;
export const SELECTED_SERVICES = DRIVER_SERVICES.map(service => service.id);
export function validateSelectedServices(value, profile) {
  if (!Array.isArray(value) || !value.length || value.length > SELECTED_SERVICES.length ||
      new Set(value).size !== value.length || !value.every(key => SELECTED_SERVICES.includes(key))) return false;
  // Delivery has no vehicle-class eligibility flag in this schema. Preserve it
  // as an explicit choice without manufacturing a platform eligibility grant.
  return value.every(key => key === 'delivery' || profile[`elig_${key}`] === true);
}
const hasText = value => typeof value === 'string' && value.trim().length > 0;

// Saves and Continue take this owner lock. The users row lock also serializes
// login/logout/expiry even where those operations do not use the advisory lock.
// Never retain this transaction during geolocation, geocoding or model calls.
export async function withDriverSettingsLock(auth, callback) {
  if (!auth?.userId || !auth?.sessionId || auth.isAgent) {
    fail(401, 'driver_session_required', 'A current signed-in driver session is required.');
  }
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('driver-settings'), hashtext(${auth.userId}))`);
    const [session] = await tx.select().from(users).where(eq(users.user_id, auth.userId)).for('update').limit(1);
    if (!session || session.session_id !== auth.sessionId || !sessionIsLive(session)) {
      fail(401, 'session_expired', 'Your session changed. Sign in again before continuing.');
    }
    return callback(tx, session);
  });
}

export async function readCanonicalDriverSettings(tx, userId) {
  const [profile] = await tx.select().from(driver_profiles).where(eq(driver_profiles.user_id, userId)).limit(1);
  const vehicles = profile ? await tx.select().from(driver_vehicles).where(and(
    eq(driver_vehicles.driver_profile_id, profile.id), eq(driver_vehicles.is_primary, true),
    eq(driver_vehicles.is_active, true),
  )).limit(2) : [];
  const [rules] = await tx.select().from(offer_rulesets).where(eq(offer_rulesets.user_id, userId)).limit(1);
  const missingFields = [];
  if (!profile) missingFields.push('profile');
  else {
    for (const [key, column] of [
      ['phone', 'phone'], ['address1', 'address_1'], ['city', 'city'], ['stateTerritory', 'state_territory'],
      ['country', 'country'], ['market', 'market'],
    ]) if (!hasText(profile[column])) missingFields.push(`profile.${key}`);
    if (profile.market === '__OTHER__') missingFields.push('profile.market');
    if (profile.terms_accepted !== true) missingFields.push('profile.termsAccepted');
    if (!Array.isArray(profile.rideshare_platforms) || !profile.rideshare_platforms.length ||
        !profile.rideshare_platforms.every(hasText)) missingFields.push('profile.ridesharePlatforms');
  }
  const vehicle = vehicles.length === 1 ? vehicles[0] : null;
  if (!vehicle) missingFields.push(vehicles.length > 1 ? 'vehicle.multiplePrimary' : 'vehicle');
  else {
    if (!Number.isInteger(vehicle.year) || vehicle.year < 1900 || vehicle.year > new Date().getFullYear() + 2) missingFields.push('vehicle.year');
    for (const field of ['make', 'model']) if (!hasText(vehicle[field])) missingFields.push(`vehicle.${field}`);
    if (!Number.isInteger(vehicle.seatbelts) || vehicle.seatbelts < 1 || vehicle.seatbelts > 20) missingFields.push('vehicle.seatbelts');
  }
  let config = null;
  if (!rules || !validSettingsRevision(rules.version)) missingFields.push('offerRules');
  else {
    const stored = rules.config;
    if (!stored || typeof stored !== 'object' || Array.isArray(stored) ||
        !stored.global || typeof stored.global !== 'object' || Array.isArray(stored.global) ||
        hashRuleset(stored) !== rules.config_hash) missingFields.push('offerRules.invalid');
    else {
      // Stored identity fences concurrent edits; migration only supplies the
      // effective config for this run. Never force a save just to add inert keys.
      const result = validateRuleset(migrateRuleset(stored));
      if (!result.ok) missingFields.push('offerRules.invalid');
      else config = result.config;
    }
  }
  // The additive selected_services column is null for existing drivers. A valid
  // saved ruleset must remain usable without forcing a new selection or turning
  // vehicle eligibility into intent. New/incomplete setup and explicit invalid
  // selections still require review; profile edits retain strict validation.
  if (profile && !(profile.selected_services === null && config !== null) &&
      !validateSelectedServices(profile.selected_services, profile)) missingFields.push('profile.selectedServices');
  return { profile, vehicle, rules, config, missingFields: [...new Set(missingFields)] };
}

// Only relevant configuration is pinned. Names, contact/home address, home GPS,
// shortcut tokens and auth credentials never enter this model-consumable receipt.
export function pinMainRunConfiguration({ profile, vehicle, rules, config }) {
  const profileFields = [
    'rideshare_platforms', 'selected_services', 'market', 'elig_economy', 'elig_xl', 'elig_xxl', 'elig_comfort',
    'elig_luxury_sedan', 'elig_luxury_suv', 'attr_electric', 'attr_green', 'attr_wav', 'attr_ski',
    'attr_car_seat', 'pref_pet_friendly', 'pref_teen', 'pref_assist', 'pref_shared',
    'fuel_economy_mpg', 'earnings_goal_daily', 'shift_hours_target', 'max_deadhead_mi',
  ];
  return {
    profile: Object.fromEntries(profileFields.map(key => [key, profile[key] ?? null])),
    vehicle: Object.fromEntries(['id', 'year', 'make', 'model', 'seatbelts'].map(key => [key, vehicle[key]])),
    rules: { config, version: rules.version, hash: rules.config_hash },
  };
}

export function mainRunResponse(admission) {
  return {
    runId: admission.run_id, sessionId: admission.session_id,
    settingsRevision: admission.settings_revision, rulesVersion: admission.rules_version,
    rulesHash: admission.rules_hash, snapshotId: admission.snapshot_id,
    status: admission.status, configuration: admission.configuration,
    errorCode: admission.error_code ?? null,
    sourceSnapshotId: admission.configuration?.context_source?.snapshot_id ?? null,
    sourceBriefingGenerationToken: admission.configuration?.context_source?.briefing_generation_token ?? null,
    createdAt: admission.created_at,
  };
}

// The same saved observation can supply several explicit Strategy intents. Its
// original identity and observation times remain visible in every consumption.
export function snapshotSourceId(snapshot) {
  return snapshot?.permissions?.context_kind === 'strategy_context'
    ? snapshot.permissions.context_source_snapshot_id : snapshot?.snapshot_id;
}

function publicCurrentSnapshot(snapshot, briefing) {
  const readiness = getSnapshotReadiness(snapshot, snapshot.snapshot_id);
  const briefingReadiness = getBriefingReadiness(briefing, snapshot.snapshot_id);
  const observedAt = Date.parse(snapshot.permissions?.observed_at);
  const accuracy = snapshot.permissions?.accuracy_m;
  return {
    snapshot_id: snapshot.snapshot_id, user_id: snapshot.user_id, sessionId: snapshot.session_id,
    status: readiness.ready ? 'ok' : readiness.status, ready: readiness.ready,
    city: snapshot.city, state: snapshot.state, country: snapshot.country,
    formattedAddress: snapshot.formatted_address, timeZone: snapshot.timezone,
    lat: snapshot.lat, lng: snapshot.lng, hour: snapshot.hour, dow: snapshot.dow,
    gps_timestamp: Number.isFinite(observedAt) ? observedAt : null,
    accuracy: Number.isFinite(accuracy) && accuracy > 0 ? accuracy : null,
    weather: snapshot.weather, air: snapshot.air, created_at: snapshot.created_at,
    local_iso: validSnapshotDate(snapshot.created_at) && validSnapshotTimezone(snapshot.timezone)
      ? getLocalIso(new Date(snapshot.created_at), snapshot.timezone) : null,
    missingFields: readiness.missingFields,
    sourceSnapshotId: snapshotSourceId(snapshot), briefingReady: briefingReadiness.ready,
    briefingFailed: briefingReadiness.failed, briefingStatus: briefing?.status ?? null,
  };
}

export async function getMainRunSetup(auth) {
  return withDriverSettingsLock(auth, async (tx, session) => {
    const state = await readCanonicalDriverSettings(tx, auth.userId);
    const [currentRun] = session.current_main_run_id ? await tx.select().from(main_run_admissions).where(and(
      eq(main_run_admissions.run_id, session.current_main_run_id),
      eq(main_run_admissions.user_id, auth.userId), eq(main_run_admissions.session_id, auth.sessionId),
    )).limit(1) : [];
    // A remount can happen while the replacement is still pending or failed.
    // Return metadata for genuine completed guidance in this live session;
    // the client still verifies its saved Strategy/Briefing before display.
    const [previous] = currentRun && currentRun.status !== 'complete'
      ? await tx.select({ admission: main_run_admissions }).from(main_run_admissions)
        .innerJoin(snapshots, eq(snapshots.snapshot_id, main_run_admissions.snapshot_id))
        .where(and(
          eq(main_run_admissions.user_id, auth.userId), eq(main_run_admissions.session_id, auth.sessionId),
          eq(main_run_admissions.status, 'complete'), ne(main_run_admissions.run_id, currentRun.run_id),
          lte(main_run_admissions.created_at, currentRun.created_at),
          eq(snapshots.user_id, auth.userId), eq(snapshots.session_id, auth.sessionId),
        )).orderBy(desc(main_run_admissions.created_at), desc(main_run_admissions.run_id)).limit(1)
      : [];
    const publicState = state.profile ? driverProfileResponse(state.profile, state.vehicle, auth.sessionId)
      : { user: { userId: auth.userId }, profile: null, vehicle: null, settingsRevision: null, sessionId: auth.sessionId };
    const [activeSnapshot] = session.current_snapshot_id ? await tx.select().from(snapshots).where(and(
      eq(snapshots.snapshot_id, session.current_snapshot_id), eq(snapshots.user_id, auth.userId),
      eq(snapshots.session_id, auth.sessionId),
    )).limit(1) : [];
    const currentContextPending = !!session.current_snapshot_id && !activeSnapshot;
    let currentSnapshot = activeSnapshot;
    if (currentContextPending && currentRun?.snapshot_id) {
      // A replacement capture may still be collecting. Retain genuine prior
      // location for display, while the separate pending flag holds generation.
      [currentSnapshot] = await tx.select().from(snapshots).where(and(
        eq(snapshots.snapshot_id, currentRun.snapshot_id), eq(snapshots.user_id, auth.userId),
        eq(snapshots.session_id, auth.sessionId),
      )).limit(1);
    }
    const [currentBriefing] = currentSnapshot ? await tx.select().from(briefings)
      .where(eq(briefings.snapshot_id, currentSnapshot.snapshot_id)).limit(1) : [];
    return {
      ...publicState, rulesVersion: state.rules?.version ?? null, rulesHash: state.rules?.config_hash ?? null,
      rules: state.config, ready: state.missingFields.length === 0, missingFields: state.missingFields,
      currentRun: currentRun ? mainRunResponse(currentRun) : null,
      previousRun: previous ? mainRunResponse(previous.admission) : null,
      currentSnapshot: currentSnapshot ? publicCurrentSnapshot(currentSnapshot, currentBriefing) : null,
      currentSnapshotId: session.current_snapshot_id ?? null,
      // A claimed or unavailable context needs an explicit retry. Its absence
      // is not permission for a remounted client to restart GPS automatically.
      currentContextPending,
    };
  });
}

export async function continueMainRun(auth, body) {
  if (!body || typeof body.requestId !== 'string' || !UUID.test(body.requestId) || !validSettingsRevision(body.expectedSettingsRevision) ||
      !validSettingsRevision(body.expectedRulesVersion) || typeof body.expectedRulesHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedRulesHash) ||
      !Object.hasOwn(body, 'expectedRunId') || !(body.expectedRunId === null || (typeof body.expectedRunId === 'string' && UUID.test(body.expectedRunId))) ||
      (Object.hasOwn(body, 'expectedSnapshotId') && (typeof body.expectedSnapshotId !== 'string' || !UUID.test(body.expectedSnapshotId)))) {
    fail(400, 'invalid_continue_request', 'Continue requires the saved settings and rules revisions, current run and one request identity.');
  }
  return withDriverSettingsLock(auth, async (tx, session) => {
    const [replay] = await tx.select().from(main_run_admissions).where(and(
      eq(main_run_admissions.user_id, auth.userId), eq(main_run_admissions.session_id, auth.sessionId),
      eq(main_run_admissions.request_id, body.requestId),
    )).limit(1);
    if (replay) {
      if (replay.settings_revision !== body.expectedSettingsRevision || replay.rules_version !== body.expectedRulesVersion ||
          replay.rules_hash !== body.expectedRulesHash) fail(409, 'continue_intent_conflict', 'This request identity already refers to different settings.');
      if ((replay.configuration?.context_source?.expected_snapshot_id ?? null) !== (body.expectedSnapshotId ?? null)) {
        fail(409, 'continue_intent_conflict', 'This request identity already refers to different location context.');
      }
      let current = false;
      try { await readCurrentAdmission(tx, replay.run_id); current = true; }
      catch (error) { if (!(error instanceof MainRunAdmissionError)) throw error; }
      return { ...mainRunResponse(replay), replayed: true, current };
    }
    const [previous] = session.current_main_run_id ? await tx.select().from(main_run_admissions).where(and(
      eq(main_run_admissions.run_id, session.current_main_run_id), eq(main_run_admissions.session_id, auth.sessionId),
      eq(main_run_admissions.user_id, auth.userId),
    )).limit(1) : [];
    if ((previous?.run_id ?? null) !== body.expectedRunId) {
      fail(409, 'main_run_conflict', 'Another Continue action changed the current run. Reload the saved setup summary.',
        { currentRun: previous ? mainRunResponse(previous) : null });
    }
    const state = await readCanonicalDriverSettings(tx, auth.userId);
    if (state.missingFields.length) fail(409, 'setup_incomplete', 'Finish and save the required setup before continuing.', { missingFields: state.missingFields });
    if (state.profile.settings_revision !== body.expectedSettingsRevision || state.rules.version !== body.expectedRulesVersion ||
        state.rules.config_hash !== body.expectedRulesHash) {
      fail(409, 'settings_conflict', 'Saved settings changed. Review the current setup before continuing.',
        { settingsRevision: state.profile.settings_revision, rulesVersion: state.rules.version, rulesHash: state.rules.config_hash });
    }
    // Preparing GPS/Briefing does not grant permission for Strategy. Only this
    // explicit intent pins current settings and consumes verified context.
    const prepared = body.expectedSnapshotId
      ? await prepareStrategyContext(tx, auth, session, body.expectedSnapshotId) : null;
    const configuration = pinMainRunConfiguration(state);
    if (prepared) configuration.context_source = prepared.receipt;
    const [admission] = await tx.insert(main_run_admissions).values({
      run_id: randomUUID(), user_id: auth.userId, session_id: auth.sessionId, request_id: body.requestId,
      settings_revision: state.profile.settings_revision, rules_version: state.rules.version,
      rules_hash: state.rules.config_hash, configuration,
      ...(prepared && { snapshot_id: prepared.snapshot.snapshot_id, status: 'running' }),
    }).returning();
    await tx.update(users).set({ current_main_run_id: admission.run_id,
      ...(prepared && { current_snapshot_id: prepared.snapshot.snapshot_id }), updated_at: new Date() })
      .where(and(eq(users.user_id, auth.userId), eq(users.session_id, auth.sessionId)));
    return { ...mainRunResponse(admission), replayed: false, current: true };
  });
}

async function prepareStrategyContext(tx, auth, session, expectedSnapshotId) {
  const [current] = session.current_snapshot_id ? await tx.select().from(snapshots).where(and(
    eq(snapshots.snapshot_id, session.current_snapshot_id), eq(snapshots.user_id, auth.userId),
    eq(snapshots.session_id, auth.sessionId),
  )).limit(1) : [];
  // GPS display keeps the original observation ID. The active pointer may now
  // identify its admitted consumption; accept only that exact source lineage,
  // never another historical consumption or an older GPS observation.
  if (current && expectedSnapshotId !== current.snapshot_id && expectedSnapshotId !== snapshotSourceId(current)) {
    fail(409, 'context_conflict', 'Location changed. Review the current location before refreshing Strategy.');
  }
  if (!current) fail(409, 'context_required', 'Prepare your current location before continuing Strategy.');
  const sourceId = snapshotSourceId(current);
  if (typeof sourceId !== 'string' || !UUID.test(sourceId)) {
    fail(409, 'context_required', 'The original location context is unavailable. Refresh location.');
  }
  const [source] = sourceId === current.snapshot_id ? [current] : await tx.select().from(snapshots).where(and(
    eq(snapshots.snapshot_id, sourceId), eq(snapshots.user_id, auth.userId), eq(snapshots.session_id, auth.sessionId),
  )).limit(1);
  if (!source) fail(409, 'context_required', 'The original location context is unavailable. Refresh location.');
  try { assertSnapshotReady(source, sourceId); }
  catch (error) { fail(409, 'snapshot_incomplete', error.message); }
  const [briefing] = await tx.select().from(briefings).where(eq(briefings.snapshot_id, sourceId)).for('update').limit(1);
  const readiness = getBriefingReadiness(briefing, sourceId);
  if (!readiness.ready || !UUID.test(briefing?.generation_token ?? '') ||
      new Date(briefing.generated_at).getTime() < new Date(source.created_at).getTime()) {
    fail(409, readiness.failed ? 'briefing_failed' : 'briefing_pending',
      readiness.failed ? 'Briefing could not complete. Refresh location before Strategy.' : 'Briefing is still preparing. Continue when it is ready.');
  }
  const receipt = { snapshot_id: sourceId, expected_snapshot_id: expectedSnapshotId,
    briefing_generation_token: briefing.generation_token,
    captured_at: new Date(source.created_at).toISOString(),
    briefing_generated_at: new Date(briefing.generated_at).toISOString() };
  const [snapshot] = await tx.insert(snapshots).values({ ...source, snapshot_id: randomUUID(),
    permissions: { ...source.permissions, context_kind: 'strategy_context',
      context_source_snapshot_id: sourceId, context_source_generation_token: briefing.generation_token },
  }).returning();
  await tx.insert(briefings).values({ snapshot_id: snapshot.snapshot_id, generation_token: briefing.generation_token,
    ...Object.fromEntries(BRIEFING_FIELDS.map(field => [field, briefing[field]])),
    status: 'complete', generated_at: briefing.generated_at, created_at: new Date(), updated_at: new Date(),
  });
  return { snapshot, receipt };
}

// One joined read avoids mixing a session, configuration and admission from
// different commits. Final writers additionally hold withDriverSettingsLock.
async function readCurrentAdmission(tx, runId) {
  const result = await tx.execute(sql`
    SELECT a.*, u.session_id AS active_session_id, u.current_main_run_id,
      u.session_start_at, u.last_active_at,
      p.settings_revision AS current_settings_revision,
      r.version AS current_rules_version, r.config_hash AS current_rules_hash
    FROM main_run_admissions a JOIN users u ON u.user_id = a.user_id
    JOIN driver_profiles p ON p.user_id = a.user_id
    LEFT JOIN offer_rulesets r ON r.user_id = a.user_id
    WHERE a.run_id = ${runId} LIMIT 1
  `);
  const row = result.rows?.[0];
  if (!row) fail(409, 'main_run_required', 'Continue with saved preferences before starting a fresh run.');
  if (!sessionIsLive(row) || row.session_id !== row.active_session_id || row.current_main_run_id !== row.run_id ||
      row.settings_revision !== row.current_settings_revision || row.rules_version !== row.current_rules_version ||
      row.rules_hash !== row.current_rules_hash || row.status === 'failed') {
    fail(409, 'main_run_superseded', 'This run is no longer current. Review saved setup and Continue again.');
  }
  return row;
}

export async function assertCurrentMainRun(auth, runId, tx = db) {
  if (typeof runId !== 'string' || !UUID.test(runId)) fail(409, 'main_run_required', 'Continue with saved preferences before collecting a fresh snapshot.');
  const admission = await readCurrentAdmission(tx, runId);
  if (!auth?.sessionId || admission.user_id !== auth.userId || admission.session_id !== auth.sessionId || auth.isAgent) {
    fail(409, 'main_run_superseded', 'The run does not belong to your current session.');
  }
  return admission;
}

export async function assertMainRunForSnapshot(snapshotId, { runId, auth, tx = db, allowUpstream = false } = {}) {
  const [admission] = await tx.select().from(main_run_admissions).where(eq(main_run_admissions.snapshot_id, snapshotId)).limit(1);
  if (!admission && allowUpstream && !runId) return readCurrentUpstreamSnapshot(tx, snapshotId, auth);
  if (!admission) fail(409, 'main_run_required', 'This snapshot has no explicit Continue admission.');
  if (runId && runId !== admission.run_id) fail(409, 'main_run_superseded', 'Snapshot and current run do not match.');
  const current = await readCurrentAdmission(tx, admission.run_id);
  if (auth && (auth.userId !== current.user_id || auth.sessionId !== current.session_id || auth.isAgent)) {
    fail(409, 'main_run_superseded', 'The snapshot belongs to a different session.');
  }
  return current;
}

export async function withCurrentMainRun(snapshotId, callback, { allowUpstream = false } = {}) {
  const admission = await assertMainRunForSnapshot(snapshotId, { allowUpstream });
  return withDriverSettingsLock({ userId: admission.user_id, sessionId: admission.session_id }, async tx => {
    const current = await assertMainRunForSnapshot(snapshotId, { tx, allowUpstream });
    return callback(tx, current);
  });
}

async function readCurrentUpstreamSnapshot(tx, snapshotId, auth) {
  const result = await tx.execute(sql`
    SELECT s.*, u.session_id AS active_session_id, u.current_snapshot_id,
      u.session_start_at, u.last_active_at, active.permissions AS active_permissions,
      active.user_id AS active_owner, active.session_id AS active_snapshot_session
    FROM snapshots s JOIN users u ON u.user_id = s.user_id
    LEFT JOIN snapshots active ON active.snapshot_id = u.current_snapshot_id
    WHERE s.snapshot_id = ${snapshotId} LIMIT 1
  `);
  const row = result.rows?.[0];
  if (!row || row.permissions?.context_kind !== 'upstream') {
    fail(409, 'main_run_required', 'This snapshot has no explicit Continue admission.');
  }
  const activeSource = row.active_permissions?.context_kind === 'strategy_context' &&
    row.active_permissions.context_source_snapshot_id === snapshotId &&
    row.active_owner === row.user_id && row.active_snapshot_session === row.session_id;
  if (!sessionIsLive(row) || row.session_id !== row.active_session_id ||
      (row.current_snapshot_id !== snapshotId && !activeSource) ||
      (auth && (auth.userId !== row.user_id || auth.sessionId !== row.session_id || auth.isAgent))) {
    fail(409, 'context_superseded', 'This location context no longer belongs to your current session.');
  }
  return { ...row, run_id: snapshotId, status: 'running', context_kind: 'upstream' };
}

// Caller owns withDriverSettingsLock; snapshot INSERT, run binding and session
// pointer change commit together. Duplicate capture responses reuse the first row.
export async function bindMainRunSnapshot(tx, auth, runId, snapshot) {
  const admission = await assertCurrentMainRun(auth, runId, tx);
  if (admission.snapshot_id) {
    const [saved] = await tx.select().from(snapshots).where(and(
      eq(snapshots.snapshot_id, admission.snapshot_id), eq(snapshots.user_id, auth.userId),
      eq(snapshots.session_id, auth.sessionId),
    )).limit(1);
    if (!saved) fail(409, 'main_run_snapshot_missing', 'The admitted snapshot is unavailable. Start a new Continue intent.');
    return saved;
  }
  if (!snapshot || snapshot.user_id !== auth.userId || snapshot.session_id !== auth.sessionId ||
      !Number.isFinite(new Date(snapshot.created_at).getTime()) ||
      new Date(snapshot.created_at).getTime() < new Date(admission.created_at).getTime()) {
    fail(409, 'main_run_snapshot_mismatch', 'A fresh snapshot from this admitted session is required.');
  }
  const [saved] = await tx.insert(snapshots).values(snapshot).returning();
  await tx.update(main_run_admissions).set({ snapshot_id: saved.snapshot_id, status: 'running', error_code: null, updated_at: new Date() })
    .where(eq(main_run_admissions.run_id, admission.run_id));
  await tx.update(users).set({ current_snapshot_id: saved.snapshot_id, updated_at: new Date() }).where(and(
    eq(users.user_id, auth.userId), eq(users.session_id, auth.sessionId), eq(users.current_main_run_id, admission.run_id),
  ));
  return saved;
}

// Legacy capture can retry the same explicit intent. Record its failed attempt
// without inventing a terminal status or changing a newer/bound admission.
export async function recordMainRunSnapshotError(auth, runId, errorCode) {
  if (typeof runId !== 'string' || !UUID.test(runId) ||
      typeof errorCode !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/.test(errorCode)) return false;
  return withDriverSettingsLock(auth, async tx => {
    const admission = await assertCurrentMainRun(auth, runId, tx);
    if (admission.snapshot_id || admission.status !== 'awaiting_snapshot') return false;
    const [stored] = await tx.update(main_run_admissions).set({ error_code: errorCode, updated_at: new Date() })
      .where(and(eq(main_run_admissions.run_id, runId), eq(main_run_admissions.user_id, auth.userId),
        eq(main_run_admissions.session_id, auth.sessionId), eq(main_run_admissions.status, 'awaiting_snapshot'),
        isNull(main_run_admissions.snapshot_id))).returning();
    return !!stored;
  });
}
