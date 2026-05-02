// server/logger/matrix.js
//
// matrixLog — 8-field structured logger.
//
// Spec: docs/review-queue/PLAN_matrixlog-refactor-2026-05-01.md
// Approved: Melody, 2026-05-01.
//
// Render order (omitted fields are skipped, no empty brackets):
//   [category] [connection] [action] [roleName] [secondaryCat] [tableName] [location] -> message
//
// Field semantics:
//   category     - App/system category. UPPERCASE. Drives shouldEmit() gating.
//                  Examples: BRIEFING, STRATEGY, BOOT, GATEWAY, AUTH, VENUE.
//   connection   - Wire/transport. UPPERCASE.
//                  Examples: API, AI, DB, SSE, CACHE, FS.
//   action       - Operation verb. UPPERCASE-SNAKE.
//                  Examples: ENRICHMENT, DEDUP, PHASE-UPDATE, DISPATCH, COMPLETE.
//   roleName     - LLM role / actor. UPPERCASE-SNAKE matching .env / model-registry roles.
//                  Examples: BRIEFER, VENUE_SCORER, TACTICAL_PLANNER.
//   secondaryCat - Sub-domain. UPPERCASE.
//                  Examples: TRAFFIC, WEATHER, EVENTS, NEWS.
//   tableName    - DB target table when connection=DB. UPPERCASE-SNAKE.
//                  Examples: VENUE_CATALOG, DISCOVERED_EVENTS, BRIEFINGS.
//   location     - File:function pinpoint. CASE PRESERVED (filename stays as-is).
//                  Examples: briefing-service.js:getTraffic, blocks-fast.js:postHandler.
//   message      - The actual content. NO sensitive identifiers in full form
//                  (no full UUIDs, emails, addresses, coords, model versions,
//                  content text). Counts and field-presence are fine.
//
//                  EXCEPTION (2026-05-02 amendment): an 8-char hex correlation
//                  prefix derived from a UUID (e.g., userId.substring(0, 8))
//                  IS permitted for real-time DX in the Replit console.
//                  Non-reversible at this length and consistent with existing
//                  auth-flow convention. Email/coord/address/full-UUID remain
//                  forbidden in messages. See PLAN_matrixlog-tier3-auth-
//                  location-strategy-2026-05-02.md §3.1. Render: ` -> ${message}`.
//
// Validation:
//   - connection='DB' without tableName -> stderr warning (does not throw).
//   - All fields optional. Missing category -> 'GENERIC' for shouldEmit gating.

import { shouldEmit, emitJSON } from './workflow.js';

const FIELD_ORDER = [
  'category',
  'connection',
  'action',
  'roleName',
  'secondaryCat',
  'tableName',
  'location',
];

function renderPrefix(spec) {
  if (!spec || typeof spec !== 'object') return '';
  const parts = [];
  for (const field of FIELD_ORDER) {
    const value = spec[field];
    if (value !== undefined && value !== null && value !== '') {
      parts.push(`[${value}]`);
    }
  }
  return parts.join(' ');
}

function emit(level, spec, message, err) {
  const safeSpec = spec && typeof spec === 'object' ? spec : {};
  const category = String(safeSpec.category || 'GENERIC').toUpperCase();

  if (!shouldEmit(level, category)) return;

  if (safeSpec.connection === 'DB' && !safeSpec.tableName) {
    process.stderr.write(
      `[LOGGER WARN] matrixLog: connection='DB' requires tableName. ` +
      `location=${safeSpec.location ?? '-'} message="${String(message ?? '').slice(0, 80)}"\n`
    );
  }

  const prefix = renderPrefix(safeSpec);
  const errMsg = err?.message || (err && typeof err !== 'object' ? String(err) : '');
  const fullMessage = errMsg ? `${message}: ${errMsg}` : String(message ?? '');
  const line = prefix ? `${prefix} -> ${fullMessage}` : `-> ${fullMessage}`;

  const sink =
    level === 'error' ? console.error :
    level === 'warn'  ? console.warn  :
    level === 'debug' ? console.debug :
    console.log;
  sink(line);

  emitJSON(level, category, String(message ?? ''), {
    ...safeSpec,
    error: errMsg ? String(errMsg) : undefined,
  });
}

export const matrixLog = {
  info:  (spec, message)            => emit('info',  spec, message),
  warn:  (spec, message)            => emit('warn',  spec, message),
  error: (spec, message, err = null) => emit('error', spec, message, err),
  debug: (spec, message)            => emit('debug', spec, message),
};

export default matrixLog;
