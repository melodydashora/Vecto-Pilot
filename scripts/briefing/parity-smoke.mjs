#!/usr/bin/env node
/**
 * scripts/briefing/parity-smoke.mjs
 *
 * Workstream 6 Architectural Inversion — Parity Smoke Check (Commit 11/11)
 * =========================================================================
 *
 * This script permanently captures the 3-layer smoke check that verified
 * ZERO parity drift after the briefing-service.js orchestrator was inverted
 * into:
 *   - briefing-aggregator.js (orchestration owner — 710 lines)
 *   - briefing-service.js (38-line re-export facade)
 *   - pipelines/{schools,weather,airport,news,traffic,events}.js
 *
 * Created during Workstream 6 commit 11/11 (2026-05-02). Permanent
 * regression-prevention tool: ANY future refactor of briefing-service.js,
 * briefing-aggregator.js, the pipelines/* modules, or briefing-notify.js
 * can run this script as a fast pre-commit check WITHOUT burning AI
 * credits or requiring real LLM API keys.
 *
 * The 3 layers
 * ------------
 *   Layer A (static):  Both files parse and ESM modules load without errors.
 *
 *   Layer B (dynamic-load + identity):  Export counts match expected
 *     contracts AND ESM binding identity is preserved across the
 *     shim ↔ aggregator boundary. Identity verification is the
 *     LOAD-BEARING CHECK — if shim.fn !== aggregator.fn, the
 *     inFlightBriefings concurrency Map is fragmented across modules
 *     and per-process dedup breaks. This is the single most important
 *     assertion in this script.
 *
 *   Layer C (DB read smoke):  Calls shim.getBriefingBySnapshotId(<id>)
 *     against the live DATABASE_URL. Verifies the re-export chain
 *     (caller → shim → aggregator → drizzle → Postgres) end-to-end
 *     without firing any AI calls. Validates JSONB column shapes
 *     match the post-Workstream-6 contract.
 *
 * Layer D NOT included
 * --------------------
 * A full /api/blocks-fast end-to-end test with live AI calls is
 * DELIBERATELY NOT included here. Function bodies are preserved
 * byte-for-byte during architectural inversions in this codebase
 * (orchestration logic copied verbatim from briefing-service.js to
 * briefing-aggregator.js in Commit 9), so Layer D's marginal value
 * over A-C is low compared to its cost in AI credits + Gateway-stack
 * runtime. A future workstream that introduces actual behavioral
 * changes to the orchestrator would justify a dedicated end-to-end
 * regression suite — that is not this commit.
 *
 * Usage
 * -----
 *   node scripts/briefing/parity-smoke.mjs
 *     ↳ uses the latest snapshot in dev DB
 *
 *   SMOKE_SNAPSHOT_ID=<uuid> node scripts/briefing/parity-smoke.mjs
 *     ↳ uses a fixed snapshot id (recommended for CI)
 *
 * Exit codes
 * ----------
 *   0 — all 3 layers pass (parity preserved)
 *   1 — Layer A or Layer B fail (import error, export drift, or identity drift)
 *   2 — Layer C fails (DB unreachable, snapshot not found, or shape drift)
 *  99 — unexpected runtime error
 *
 * See claude_memory rows #294 through #301 for the full Workstream 6
 * audit trail and the methodology lessons captured during execution.
 */

import { db } from '../../server/db/drizzle.js';
import { snapshots } from '../../shared/schema.js';
import { desc } from 'drizzle-orm';

// ----- output helpers (no deps) ----------------------------------------------

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';

const ok = (msg) => console.log(`  ${GREEN}✓${RESET} ${msg}`);
const fail = (msg) => console.log(`  ${RED}✗${RESET} ${msg}`);
const warn = (msg) => console.log(`  ${YELLOW}!${RESET} ${msg}`);
const head = (msg) => console.log(`\n${BOLD}${CYAN}=== ${msg} ===${RESET}`);

// ----- expected contracts (post-Workstream-6) --------------------------------

// briefing-service.js (the shim) re-exports 17 symbols total:
// - 4 from briefing-aggregator.js (orchestration entries)
// - 13 from pipelines/* (6 discoverX contracts + 5 legacy fetch* + 2 events utils)
const EXPECTED_SHIM_EXPORTS = [
  'deduplicateEvents',
  'discoverAirport',
  'discoverEvents',
  'discoverNews',
  'discoverSchools',
  'discoverTraffic',
  'discoverWeather',
  'fetchEventsForBriefing',
  'fetchRideshareNews',
  'fetchSchoolClosures',
  'fetchTrafficConditions',
  'fetchWeatherConditions',
  'filterInvalidEvents',
  'generateAndStoreBriefing',
  'getBriefingBySnapshotId',
  'getOrGenerateBriefing',
  'refreshEventsInBriefing',
];

// briefing-aggregator.js owns the 4 orchestration entry points.
const EXPECTED_AGGREGATOR_EXPORTS = [
  'generateAndStoreBriefing',
  'getBriefingBySnapshotId',
  'getOrGenerateBriefing',
  'refreshEventsInBriefing',
];

// Symbols that MUST have shim ↔ aggregator binding identity.
// If any of these break, the inFlightBriefings concurrency Map fragments
// and per-process dedup is silently broken.
const IDENTITY_CHECKS = [
  'generateAndStoreBriefing',
  'getBriefingBySnapshotId',
  'getOrGenerateBriefing',
  'refreshEventsInBriefing',
];

// ----- main ------------------------------------------------------------------

let exitCode = 0;

async function main() {
  console.log(`${BOLD}Workstream 6 Parity Smoke Check${RESET}`);
  console.log(`Verifies briefing-service.js (shim) ↔ briefing-aggregator.js (orchestrator) parity`);

  // ============================================================
  // LAYER A — both modules import without parse/runtime errors
  // ============================================================
  head('LAYER A — static module loads');

  let shim, agg;
  try {
    shim = await import('../../server/lib/briefing/briefing-service.js');
    ok('briefing-service.js (shim) imports cleanly');
  } catch (err) {
    fail(`briefing-service.js failed to import: ${err.message}`);
    process.exit(1);
  }
  try {
    agg = await import('../../server/lib/briefing/briefing-aggregator.js');
    ok('briefing-aggregator.js (orchestrator) imports cleanly');
  } catch (err) {
    fail(`briefing-aggregator.js failed to import: ${err.message}`);
    process.exit(1);
  }

  // ============================================================
  // LAYER B — export counts + ESM binding identity (LOAD-BEARING)
  // ============================================================
  head('LAYER B — dynamic-load: export counts + binding identity');

  const shimKeys = Object.keys(shim).sort();
  const aggKeys = Object.keys(agg).sort();

  const missingShim = EXPECTED_SHIM_EXPORTS.filter((k) => !shimKeys.includes(k));
  const extraShim = shimKeys.filter((k) => !EXPECTED_SHIM_EXPORTS.includes(k));
  const missingAgg = EXPECTED_AGGREGATOR_EXPORTS.filter((k) => !aggKeys.includes(k));
  const extraAgg = aggKeys.filter((k) => !EXPECTED_AGGREGATOR_EXPORTS.includes(k));

  if (missingShim.length === 0 && extraShim.length === 0) {
    ok(`shim has all ${EXPECTED_SHIM_EXPORTS.length} expected exports`);
  } else {
    fail(`shim export drift — missing: [${missingShim.join(', ')}], extra: [${extraShim.join(', ')}]`);
    exitCode = 1;
  }

  if (missingAgg.length === 0 && extraAgg.length === 0) {
    ok(`aggregator has all ${EXPECTED_AGGREGATOR_EXPORTS.length} expected exports`);
  } else {
    fail(`aggregator export drift — missing: [${missingAgg.join(', ')}], extra: [${extraAgg.join(', ')}]`);
    exitCode = 1;
  }

  const nonFunctionShim = shimKeys.filter((k) => typeof shim[k] !== 'function');
  if (nonFunctionShim.length === 0) {
    ok('all shim exports are callable functions');
  } else {
    fail(`shim has non-function exports: [${nonFunctionShim.join(', ')}]`);
    exitCode = 1;
  }

  // ESM binding identity — the load-bearing assertion.
  let identityDrift = false;
  for (const fn of IDENTITY_CHECKS) {
    if (shim[fn] === agg[fn]) {
      ok(`identity preserved: shim.${fn} === aggregator.${fn}`);
    } else {
      fail(`IDENTITY DRIFT: shim.${fn} !== aggregator.${fn} — inFlightBriefings will fragment`);
      identityDrift = true;
      exitCode = 1;
    }
  }

  if (identityDrift) {
    console.log(`\n${RED}${BOLD}Layer B failed — identity drift means concurrency dedup is broken. Stopping.${RESET}`);
    process.exit(1);
  }

  if (exitCode !== 0) {
    console.log(`\n${RED}${BOLD}Layer B export-shape drift — stopping before Layer C.${RESET}`);
    process.exit(1);
  }

  // ============================================================
  // LAYER C — DB read smoke through the shim (no AI calls)
  // ============================================================
  head('LAYER C — DB read smoke (no AI calls)');

  let snapshotId = process.env.SMOKE_SNAPSHOT_ID;
  if (!snapshotId) {
    try {
      const recent = await db
        .select({ id: snapshots.snapshot_id })
        .from(snapshots)
        .orderBy(desc(snapshots.created_at))
        .limit(1);
      if (recent.length === 0) {
        warn('No snapshots in DB. Set SMOKE_SNAPSHOT_ID env var to test against a known snapshot.');
        warn('Layer C skipped (no snapshots available — not a failure if DB is empty).');
        head('SUMMARY');
        console.log(`${GREEN}${BOLD}Layers A + B passed; Layer C skipped (empty DB)${RESET}`);
        process.exit(0);
      }
      snapshotId = recent[0].id;
      ok(`Using latest snapshot: ${snapshotId}`);
    } catch (err) {
      fail(`Failed to query latest snapshot: ${err.message}`);
      process.exit(2);
    }
  } else {
    ok(`Using SMOKE_SNAPSHOT_ID env: ${snapshotId}`);
  }

  // Call via the SHIM — proves the re-export chain works end-to-end.
  let briefing;
  try {
    briefing = await shim.getBriefingBySnapshotId(snapshotId);
  } catch (err) {
    fail(`getBriefingBySnapshotId threw: ${err.message}`);
    process.exit(2);
  }

  if (briefing === null) {
    ok(`Function callable end-to-end — returned null (no briefing row exists for this snapshot, which is acceptable for parity)`);
  } else {
    ok(`Briefing row returned for snapshot ${snapshotId.slice(0, 8)}`);

    // Sanity-check JSONB column shapes match the post-Workstream-6 contract.
    // Each shape is permissive: null is acceptable (empty / not-yet-generated),
    // typed object/Array is acceptable, _generationFailed sentinels are acceptable.
    const shapeChecks = [
      [
        'weather_current',
        briefing.weather_current,
        (v) => v === null || typeof v === 'object',
      ],
      [
        'weather_forecast',
        briefing.weather_forecast,
        (v) => v === null || Array.isArray(v),
      ],
      [
        'traffic_conditions',
        briefing.traffic_conditions,
        (v) => v === null || typeof v === 'object',
      ],
      [
        'airport_conditions',
        briefing.airport_conditions,
        (v) => v === null || typeof v === 'object',
      ],
      [
        'school_closures',
        briefing.school_closures,
        (v) =>
          v === null ||
          Array.isArray(v) ||
          (typeof v === 'object' && (Array.isArray(v.items) || v._generationFailed)),
      ],
      [
        'news',
        briefing.news,
        (v) => v === null || typeof v === 'object',
      ],
      [
        'events',
        briefing.events,
        (v) =>
          v === null ||
          Array.isArray(v) ||
          (typeof v === 'object' && (Array.isArray(v.items) || v._generationFailed)),
      ],
    ];

    let shapeOk = true;
    for (const [name, val, valid] of shapeChecks) {
      if (valid(val)) {
        const desc = Array.isArray(val)
          ? `Array[${val.length}]`
          : val === null
          ? 'null'
          : typeof val;
        ok(`shape OK: ${name} (${desc})`);
      } else {
        fail(`shape DRIFT: ${name} unexpected — got ${typeof val}`);
        shapeOk = false;
        exitCode = 2;
      }
    }
    if (shapeOk) ok(`all 7 JSONB column shapes match post-Workstream-6 contract`);
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  head('SUMMARY');
  if (exitCode === 0) {
    console.log(`${GREEN}${BOLD}ALL 3 LAYERS PASS — facade parity preserved${RESET}`);
    console.log(`${GREEN}briefing-service.js (shim) ↔ briefing-aggregator.js binding identity intact${RESET}`);
  } else {
    console.log(`${RED}${BOLD}PARITY DRIFT DETECTED — exit code ${exitCode}${RESET}`);
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(`\n${RED}${BOLD}UNEXPECTED ERROR:${RESET} ${err.message}`);
  console.error(err.stack);
  process.exit(99);
});
