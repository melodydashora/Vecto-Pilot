# PLAN — `matrixLog` refactor (8-field structured logging)

> **Date:** 2026-05-01
> **Status:** AWAITING APPROVAL — no code changes until Melody confirms
> **Author:** Claude Code (Opus 4.7)
> **Doctrine:** Rule 1 (plan before implement), Rule 16 (Melody is architect)
> **Spec source:** Melody's matrix specification, 2026-05-01

---

## 1. Objective

Replace component-based logger objects (`triadLog`, `briefingLog`, `venuesLog`, `eventsLog`, etc.) with a single structured logger called **`matrixLog`** that renders bracketed log prefixes from an 8-field classification matrix.

This eliminates:
- The TRIAD legacy taxonomy (per Melody's directive: "I cannot stand seeing triad ever").
- Phase-number arguments (`triadLog.phase(3, …)`) that fight model-agnostic naming.
- The dual hierarchy (component-name vs role-name) that creates two ways to refer to the same thing.

It establishes:
- A single source-of-truth taxonomy where role names from `.env` / `model-registry.js` are the AI categorization, file:function pinpoints emission location, and the matrix dimensions cover the rest.
- Verbose, structured debug breadcrumbs — every log line carries enough context to triangulate file, function, role, table, and connection type.

## 2. Why a matrix beats a chain

The earlier `chainLog` proposal collapsed distinct concepts:

| chainLog field | What it tried to cover | Problem |
|---|---|---|
| `callTypes: ['API', 'AI']` | Connection type AND action verb | Two concepts in one slot |
| `callName: 'TomTom'` or `'Briefer'` or `'venue_cards'` | Actor (AI role) AND target (DB table) AND service (API name) | Three concepts in one slot |

The 8-field matrix gives unambiguous slots:

| Field | Purpose | Example |
|---|---|---|
| `category` | App/System category | `BRIEFING`, `STRATEGY`, `BOOT` |
| `connection` | Wire/transport type | `API`, `AI`, `DB`, `SSE` |
| `action` | Operation verb | `ENRICHMENT`, `DEDUP`, `PHASE-UPDATE`, `DISPATCH` |
| `roleName` | LLM role / actor | `BRIEFER`, `VENUE_SCORER`, `TACTICAL_PLANNER` |
| `secondaryCat` | Sub-domain | `TRAFFIC`, `WEATHER`, `EVENTS` |
| `tableName` | DB target (when connection=DB) | `VENUE_CATALOG`, `DISCOVERED_EVENTS` |
| `location` | File:function emission point | `briefing-service.js:getTraffic` |
| `message` | The actual "why" / "what happened" | `Fetched 68 incidents from TomTom` |

## 3. Output format

### Render rules

- All present fields render as `[FIELD_VALUE]` separated by single spaces.
- Render order is fixed: **`category` → `connection` → `action` → `roleName` → `secondaryCat` → `tableName` → `location`** then **` -> ${message}`**.
- Omitted fields are skipped (no empty brackets).
- All bracket values are `UPPERCASED` *except* `location` (preserves file extension casing) and `tableName` (which uses the actual table identifier — typically uppercase already by convention).
- The `-> ` separator before the message is always present.

### Example renderings

**Full chain (all 8 fields):**
```
[BRIEFING] [API] [ENRICHMENT] [BRIEFER] [TRAFFIC] [TRAFFIC_DISCOVERY] [briefing-service.js:getTraffic] -> Fetched 68 incidents from TomTom
```

**AI call (no DB target):**
```
[STRATEGY] [AI] [DISPATCH] [TACTICAL_PLANNER] [tactical-planner.js:planVenues] -> Sent strategy to planner (16000 tokens)
```

**DB write (no role):**
```
[BRIEFING] [DB] [PHASE-UPDATE] [TRAFFIC] [BRIEFINGS] [briefing-service.js:storeTrafficResult] -> traffic_conditions populated
```

**SSE notify (no role, no table):**
```
[STRATEGY] [SSE] [DISPATCH] [strategy-events.js:emitReady] -> strategy_ready broadcast (1 subscriber)
```

**Boot/system (minimal chain):**
```
[BOOT] [start-replit.js:loadEnv] -> Environment loaded
```

## 4. API spec

```javascript
import { matrixLog } from 'server/logger/matrix.js';

matrixLog({
  category:     'BRIEFING',
  connection:   'API',
  action:       'ENRICHMENT',
  roleName:     'BRIEFER',
  secondaryCat: 'TRAFFIC',
  tableName:    'TRAFFIC_DISCOVERY',
  location:     'briefing-service.js:getTraffic',
}, 'Fetched 68 incidents from TomTom');
```

### Level methods

```javascript
matrixLog.info(spec, message)    // default
matrixLog.warn(spec, message)
matrixLog.error(spec, message, err = null)
matrixLog.debug(spec, message)
```

`info` / `warn` / `error` / `debug` route to `console.log` / `console.warn` / `console.error` / `console.debug` respectively. Each goes through the existing `shouldEmit()` gate so `LOG_LEVEL` and `LOG_QUIET_COMPONENTS` env vars still work — gating is by `category` (the first field).

### Validation behavior

- **No required fields.** Any subset of the 8 may be present, including just `location` + message.
- **Warning emitted to stderr** if `connection: 'DB'` is set without `tableName` (matches existing `chainLog` invariant per `claude_memory` row 230).
- **No throw on invalid spec** — logger never breaks the caller. Bad fields silently render or get skipped.

## 5. Implementation — `server/logger/matrix.js`

### Files affected by introducing matrixLog (small footprint)

| File | Change | Lines |
|---|---|---|
| `server/logger/matrix.js` | NEW — exports `matrixLog` | ~120 |
| `server/logger/workflow.js` | Add re-export of `matrixLog`; existing exports stay untouched | +1 line |
| `docs/review-queue/PLAN_matrixlog-refactor-2026-05-01.md` | This plan doc | new |

### Files affected by Tier 1 migration (AI call sites only)

The 30+ `callModel(role, ...)` sites listed in your audit. Each site gets the AI call line (`[CATEGORY] [AI] [ROLE] [file:func] -> Calling …`) replaced with a `matrixLog` invocation. Other lines in those files are NOT touched in Tier 1.

### Files affected by Tier 2 migration (adjacent DB/API/SSE)

The non-AI lines in the same Tier 1 files. Includes DB writes, SSE emits, API calls (TomTom, Google Maps, Routes), and phase-update emits. Every line in these files is migrated.

### Files affected by Tier 3 migration (everything else)

All remaining log lines tree-wide. Auth middleware, location resolution, vehicle lookups, chat handlers, gateway bootstrap, etc.

## 6. Backwards compatibility — keep legacy loggers as aliases

`triadLog`, `briefingLog`, `venuesLog`, `eventsLog`, `aiLog`, `dbLog`, `sseLog`, `locationLog`, `userLog`, `snapshotLog`, `barsLog`, `weatherLog`, `authLog`, `phaseLog`, `placesLog`, `routesLog`, plus the alias `triadLog = strategyLog` (line 726).

**Approach:**
- Keep all legacy exports in `server/logger/workflow.js`.
- Their internals remain unchanged for now.
- Once Tier 3 migration completes, a final commit deletes them.
- Until then, mixed-convention is allowed: a file mid-migration can have both `briefingLog.info(…)` (legacy) and `matrixLog({…}, msg)` (new) without breaking anything.

**Why not delete now:** they're imported in ~40+ files. Cold delete = 40+ `ReferenceError`s on first request. Aliases let the migration happen safely.

## 7. Migration tiers

### Tier 1 — AI call sites (30+ lines across ~25 files)

The audit table you provided is the canonical worklist. Each file gets matrixLog calls around its `callModel(role, …)` invocations. Two log lines per call:

```javascript
matrixLog.info({
  category: 'BRIEFING',
  connection: 'AI',
  action: 'DISPATCH',
  roleName: 'BRIEFER',
  secondaryCat: 'TRAFFIC',
  location: 'briefing-service.js:getTraffic',
}, 'Calling Briefer (16000 max tokens)');

const result = await callModel('BRIEFING_TRAFFIC', { system, user });

matrixLog.info({
  category: 'BRIEFING',
  connection: 'AI',
  action: 'COMPLETE',
  roleName: 'BRIEFER',
  secondaryCat: 'TRAFFIC',
  location: 'briefing-service.js:getTraffic',
}, `Briefer responded (${result.text.length} chars, ${result.latencyMs}ms)`);
```

This proves the convention against real call sites and gives Melody a deployable preview of the new log style.

### Tier 2 — adjacent operational lines in those same files

DB writes, SSE notifies, TomTom/Routes/Places API calls, Phase updates. Same files as Tier 1, every log line in them.

### Tier 3 — everything else

Auth middleware, location, gateway, scripts, chat, vehicle, etc.

### Final commit (Tier 4)

Delete legacy logger exports from `workflow.js`. Delete TRIAD entries from `WORKFLOWS`, `COMPONENT_LABELS`, `PHASE_LABELS`. Delete `triadLog` alias. Verify no remaining references via tree-wide read (no grep substitution per `feedback_no_grep_substitution.md`).

## 8. Test cases per tier

### Tier 1 — AI sites

- **T1.1:** Application boots without errors after migration. `node --check` clean on every modified file.
- **T1.2:** Sample run of a snapshot → strategy → blocks pipeline shows `[CATEGORY] [AI] [ACTION] [ROLENAME] [secondaryCat] [file:func] -> message` lines for every AI call.
- **T1.3:** Existing `[CATEGORY]`-prefixed lines (legacy emitters) still appear because non-AI lines are untouched in Tier 1. Logs are mixed-convention; no broken lines.
- **T1.4:** `LOG_QUIET_COMPONENTS=BRIEFING` still silences BRIEFING-category emissions (gating still works).

### Tier 2 — adjacent ops

- **T2.1:** Same files as T1, all log lines now matrix-shaped.
- **T2.2:** DB writes show `[CATEGORY] [DB] [ACTION] [secondaryCat] [TABLE_NAME] [file:func] -> message`.
- **T2.3:** API calls show `[CATEGORY] [API] [ACTION] [secondaryCat] [file:func] -> message` with the upstream service named in the message.
- **T2.4:** No `[BRIEFING] [PHASE-UPDATE]` snapshot-id-prefixed lines remain (already redacted in earlier work; verify post-migration).

### Tier 3 — tree-wide

- **T3.1:** No legacy logger calls remain in the tree.
- **T3.2:** No `triadLog`/`briefingLog`/`venuesLog`/etc. usages outside `workflow.js` itself.
- **T3.3:** `node --check` clean tree-wide.
- **T3.4:** Smoke test: full snapshot → briefing → strategy → venues path emits matrix-formatted logs end-to-end.

### Tier 4 — alias deletion

- **T4.1:** `workflow.js` no longer exports legacy logger names.
- **T4.2:** No `import { triadLog }` / `import { briefingLog }` / etc. anywhere in the tree.
- **T4.3:** Application boots clean.

## 9. Open questions for Melody

1. **`location` field — auto-detect from stack, or always passed manually?**
   - **Recommendation: always passed manually.** Stack-trace inspection is slow (~5-10ms per log line) and fragile (breaks under transpilation/bundling). Passing the literal `'briefing-service.js:getTraffic'` is verbose at the call site but reliable.
2. **Capitalization of `tableName`?**
   - Your example shows `[TRAFFIC_DISCOVERY]` — consistent uppercase, snake-case-with-underscores. Confirm this matches your DB-naming convention (Postgres tables typically lowercase, but the BRACKET form may want SCREAMING_SNAKE).
3. **Should `matrixLog` write JSON to stderr like the existing loggers do (when `LOG_FORMAT=json|both`)?** I plan yes, with `{ ts, level, ...spec, message }` shape. Confirm.
4. **Convenience helpers?** I.e., `matrixLog.api({...}, msg)` that auto-fills `connection: 'API'`, `matrixLog.db({...}, msg)` that auto-fills `connection: 'DB'`. They reduce verbosity at call sites but add API surface. Recommendation: skip for now, add later if call sites feel too verbose.
5. **Tier 1 PR target — current branch (`chore/drop-consolidated-strategy-2026-05-01`) or new branch?** This branch is already 12 commits deep; a new branch (`chore/matrixlog-refactor-2026-05-01`) would be cleaner for review. Recommendation: new branch.

## 10. Doctrine references

- **Rule 1:** This plan satisfies the planning requirement. No implementation until Melody approves §9 answers.
- **Rule 10:** Centralized logging utility, not per-service ad-hoc loggers.
- **Rule 14 (model-agnostic):** Role names from `.env` / `model-registry.js` are used as `roleName` field values; the logger never knows which provider is behind a role.
- **Rule 16:** Melody is the architect. The 8-field matrix is her design. I implement; I don't redesign.
- **`feedback_no_grep_substitution.md`:** The verification steps in §8 use READING + smoke-tests, not grep sweeps.
- **`feedback_triad_naming_and_n_of_n_logging.md`:** TRIAD eradication is integral to this work.
- **`feedback_no_icon_scanning_justifications.md`:** No emojis or visual scanning markers in the new log format.

---

**Awaiting your approval on §9 questions 1–5.** Once answered, I write `server/logger/matrix.js`, get your "All tests passed" sign-off on Tier 1's effects, then proceed tier by tier.
