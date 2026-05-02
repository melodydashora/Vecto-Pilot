# PLAN — Workstream 6 Remaining Commits (Post-Commit-3 Resume State)

**Created:** 2026-05-02 to enable post-`/compact` resumption with full state.
**Pairs with:** `PLAN_workstream6_briefing_split.md` (architecture, approved 2026-05-02).
**This doc:** execution status + per-commit specifics for commits 4-11. Lessons learned during commits 0-3 OVERRIDE the original §3.2 contract — see §2 below.

---

## 1. Resume state (durable)

**Branch:** `feat/workstream6-briefing-split` (off `main`)
**HEAD:** `5fd74087` — Commit 3 (schools pilot) landed cleanly
**Working tree:** clean (only `.claude/settings.local.json` modified — unrelated session bookkeeping; do NOT include in commits)
**`briefing-service.js`:** 3,178 lines (down from 3,683 — 505 lines extracted across commits 1-3)

### Commits landed
| Hash | Commit | Files |
|------|--------|-------|
| `db3b1f3a` | docs(workstream6): Phase 0 implementation plan | +1 plan doc |
| `2c30edd6` | feat(briefing): extract briefing-notify.js | +1 file, -63/+108 in service |
| `b831b10a` | feat(briefing): extract shared/ utilities | +3 files, -328/+339 net |
| `5fd74087` | feat(briefing): extract schools pipeline (pilot) | +1 file, -170/+239 net |

### Files created so far
- `server/lib/briefing/briefing-notify.js` (82 lines) — `writeSectionAndNotify`, `CHANNELS`, `errorMarker`
- `server/lib/briefing/shared/safe-json-parse.js` (197 lines) — multi-attempt LLM JSON parser, pure function
- `server/lib/briefing/shared/staleness.js` (84 lines) — 4 cache predicates
- `server/lib/briefing/shared/get-market-for-location.js` (47 lines) — city/state → market lookup
- `server/lib/briefing/pipelines/schools.js` (220 lines) — pilot pipeline

---

## 2. Lessons learned in flight (override original PLAN §3.2)

### 2.1. Wider contract: `{ <section>, reason }`

Original §3.2 said pipelines return a partial row contribution. Reality: orchestrator's final atomic write at `briefing-service.js` ~line 2870 (the `briefingData = {}` assembly block) reads BOTH the section value AND a separate `reason` string for the no-data path. Pipelines must return BOTH.

**Canonical contract for ALL remaining pipelines** (commits 4-8):

```js
export async function discover<Thing>({ snapshot, snapshotId, ... }) {
  let value, reason = '<default no-data reason>';
  try {
    value = await fetch<Thing>({ snapshot });
    reason = isEmpty(value) ? '<no-data reason>' : null;
    await writeSectionAndNotify(snapshotId, { <section>: value }, CHANNELS.<NAME>);
  } catch (err) {
    // Mirror current orchestrator .catch behavior — write errorMarker, preserve throw
    await writeSectionAndNotify(snapshotId, { <section>: errorMarker(err) }, CHANNELS.<NAME>);
    throw err;
  }
  return { <section>: value, reason };
}
```

The trailing `throw` preserves orchestrator semantics: `Promise.allSettled` wraps it in `{ status: 'rejected', reason: err }`, the orchestrator extracts via `failedReasons[<name>]`, and the briefings row stores a partial briefing instead of a full failure.

### 2.2. Schools is the exception, not the rule

Schools catches its own errors internally and returns `[]` — no throw. All OTHER 5 pipelines (weather/traffic/events/airport/news) currently have `.catch` wrappers in the orchestrator's `generateBriefingInternal` that fire `writeSectionAndNotify` with `errorMarker(err)` then re-throw. **Move those `.catch` wrappers INTO the pipeline modules per §2.1's contract.**

### 2.3. Tool choice: `sed` for line-range deletions, Edit for surgical changes

`briefing-service.js` is large enough that `Edit` cannot cleanly handle 100+ line deletions (the `old_string` would be enormous and brittle). Use `sed` for surgical line-range deletes; verify before/after with `sed -n` + `node --check`.

**Pattern that worked across commits 1-3:**
```bash
# 1. Locate
grep -nE "^export async function fetch<Thing>|^export async function fetch<NextThing>" server/lib/briefing/briefing-service.js
# 2. Delete
sed -i 'START,ENDd' server/lib/briefing/briefing-service.js
# 3. Verify boundary
sed -n '$((START-3)),$((START+3))p' server/lib/briefing/briefing-service.js
# 4. Syntax check
node --check server/lib/briefing/briefing-service.js
```

### 2.4. Dynamic-import smoke test will hang on drizzle

Drizzle holds an idle DB pool open, so `node -e "import('./...')"` doesn't exit on its own. Use `timeout` + grep for the printed exports list:
```bash
timeout 8 node -e "import('./server/lib/briefing/pipelines/<new>.js').then(m => console.log('exports:', Object.keys(m).join(', ')))"
# Exit 124 from timeout != failure. Look for "exports: ..." line in stdout.
```

### 2.5. Re-export to preserve external API

`server/api/briefing/briefing.js` imports `fetchWeatherConditions, fetchTrafficConditions, fetchRideshareNews` directly from `briefing-service.js`. To avoid migrating callers in Phase 1, every commit adds a re-export of the legacy named function:

```js
import { discoverWeather, fetchWeatherConditions } from './pipelines/weather.js';
export { fetchWeatherConditions };  // preserve API surface for external callers
```

Schools commit 3 set this precedent (re-exported `fetchSchoolClosures` even though no external caller uses it — defensive against missed callers).

### 2.6. The bulk-failure path uses `failureMarker = errorMarker(err)` reuse

At `briefing-service.js` ~line 2942 (after the schools-block replacement, line numbers shift each commit), the bulk-failure handler renames its local `errorMarker` const to `failureMarker = errorMarker(err)` to avoid shadowing the imported function while preserving single-timestamp semantics across the 4 sections it marks. This pattern is already in place from commit 1 — leave it unchanged.

---

## 3. Per-commit execution plan (commits 4-11)

### Commit 4: `pipelines/weather.js`

**Functions to extract** (current line numbers will have shifted; grep first):
```bash
grep -nE "^export async function fetchWeather|^function usesMetric|^function formatTemperature|^function formatWindSpeed|^function generateWeatherDriverImpact" server/lib/briefing/briefing-service.js
```
- `fetchWeatherForecast` (originally line 1729)
- `fetchWeatherConditions` (originally line 1830)
- `usesMetric`, `formatTemperature`, `formatWindSpeed` (formatters, originally ~1795-1825)
- `generateWeatherDriverImpact` (helper, originally ~1950)

**§2.6 drift signal to resolve FIRST:**
Two weather entry points — distinct or duplicate?
```bash
grep -rnE "fetchWeatherForecast|fetchWeatherConditions" server/ --include="*.js" --include="*.ts" 2>/dev/null | grep -v node_modules
```
- Read both function bodies + their callers
- If distinct (forecast = future hours, conditions = current snapshot): expose both as named exports + a `discoverWeather` wrapper that calls both
- If duplicate or one wraps the other: consolidate to `discoverWeather` + keep the legacy aliases as re-exports

Log the resolution as a `claude_memory` row: `category='engineering-pattern', title='Weather entry-point drift resolved'`.

**✅ RESOLVED 2026-05-02 (Option A — delete dead code):**
Neither option above applied. `fetchWeatherForecast` (LLM-based via `callModel('BRIEFING_WEATHER')`) had **zero callers** across server/, client/, shared/. It was an early LLM-weather implementation superseded by the deterministic Google Weather API path (`fetchWeatherConditions`) and never deleted. Resolution:
1. Created `pipelines/weather.js` exporting `discoverWeather` (pipeline contract) + `fetchWeatherConditions` (live path, re-exported for `server/api/briefing/briefing.js`)
2. Deleted `fetchWeatherForecast` + 4 helpers (`usesMetric`, `formatTemperature`, `formatWindSpeed`, `generateWeatherDriverImpact`) from `briefing-service.js` (~270 lines)
3. Pruned `BRIEFING_WEATHER` from `model-registry.js` (its only call site was the dead function)
4. Removed corresponding row from `server/lib/ai/adapters/README.md`
5. Updated JSDoc example at `model-registry.js:458` from `BRIEFING_WEATHER` to `BRIEFING_TRAFFIC`
6. Logged to `claude_memory` (category=`engineering-pattern`, status=`active`).

Principle reaffirmed (CLAUDE.md ABSOLUTE PRECISION): "Coordinates always from Google APIs or DB, never from AI" — the same principle extends to weather data. LLM-based weather hallucinates temperatures and conditions; Google Weather API is deterministic and authoritative.

Anti-pattern recorded: keeping superseded LLM implementations as silent dead-code "fallbacks" that no caller invokes. Re-export shims for the live path are fine (preserve Phase 1 caller compatibility); shims for dead paths are not.

**Channel:** `CHANNELS.WEATHER` ('briefing_weather_ready')

**Special case — DUAL section write:** weather writes BOTH `weather_current` AND `weather_forecast` in one `writeSectionAndNotify` call. The contract returns `{ weather_current, weather_forecast, reason }`:
```js
await writeSectionAndNotify(snapshotId, {
  weather_current: result?.current || { /* fallback */ },
  weather_forecast: result?.forecast || [],
}, CHANNELS.WEATHER);
return { weather_current, weather_forecast, reason };
```

**Orchestrator block to replace** (currently at `briefing-service.js` `weatherPromise` declaration — ~line 3070 area post-commit-3, grep for `weatherPromise = fetchWeatherConditions`):
```js
// BEFORE:
const weatherPromise = fetchWeatherConditions({ snapshot })
  .then(async (r) => { await writeSectionAndNotify(...); return r; })
  .catch(async (err) => { await writeSectionAndNotify(...errorMarker...); throw err; });
// ... later: weatherResult extracted via Promise.allSettled

// AFTER:
const weatherPromise = discoverWeather({ snapshot, snapshotId });
// ... later: { weather_current, weather_forecast, reason: weatherReason } = weatherResult
```

The orchestrator's final assembly block at ~line 2840 (`weatherCurrent = weatherResult?.current || {...}`) needs to read from the NEW shape: `weatherResult?.weather_current`.

**Caller compat:** `server/api/briefing/briefing.js` imports `fetchWeatherConditions` — re-export from briefing-service.js.

**Estimated delta:** -250/+280 lines.

---

### Commit 5: `pipelines/airport.js`

**Functions:**
- `fetchAirportConditions` (originally ~line 2462, INTERNAL — not exported)
- `extractAirportJson` (helper, originally ~line 2415)

**Channel:** `CHANNELS.AIRPORT`
**Return:** `{ airport_conditions, reason }`
**Caller compat:** none (no external imports of fetchAirportConditions); export `discoverAirport` only

**Note:** The fetchAirportConditions has a `safeJsonParse` fallback path (around original line 2533 — uses `extractAirportJson` if safeJsonParse fails). Move both helpers into the new pipeline file together. Both already use the new shared `safeJsonParse` import (post-commit-2).

**Estimated delta:** -180/+200 lines.

---

### Commit 6: `pipelines/news.js`

**Functions:**
- `fetchRideshareNews` (originally ~line 2619)
- `fetchNewsWithClaudeWebSearch` (originally ~line 638) — Claude fallback
- `buildNewsPrompt` (originally ~line 2723)
- `filterRecentNews` (originally ~line 2569)
- `consolidateNewsItems` (originally ~line 2778)

**Channel:** `CHANNELS.NEWS`
**Return:** `{ news, reason }` where `news = { items: [...], reason: ... }` (note: news has nested reason in the section body itself — preserve)

**Caller compat:** `server/api/briefing/briefing.js` imports `fetchRideshareNews` — re-export.

**Note:** The Claude WebSearch fallback (`fetchNewsWithClaudeWebSearch`) is a parallel discovery path, similar to events' Claude fallback. Move both into pipelines/news.js together.

**Estimated delta:** -350/+380 lines.

---

### Commit 7: `pipelines/traffic.js`

**Functions:**
- `fetchTrafficConditions` (originally ~line 2125)
- `analyzeTrafficWithAI` (originally ~line 468) — **§2.6 drift signal #2**

**§2.6 drift signal to resolve:**
Two `BRIEFING_TRAFFIC` LLM call sites, but `analyzeTrafficWithAI` is at line 468 inside the EVENTS code path (`fetchEventsWithClaudeWebSearch`):
```bash
grep -nE "analyzeTrafficWithAI|BRIEFING_TRAFFIC" server/lib/briefing/briefing-service.js
```
Trace which functions call `analyzeTrafficWithAI`. Likely options:
- **(a) Cross-pollution bug** — events shouldn't call traffic LLM. Leave both files in current locations, log as `claude_memory` ticket for separate fix-PR after Workstream 6.
- **(b) Intentional shared analyzer** — move `analyzeTrafficWithAI` to a NEW shared location like `pipelines/_shared/analyze-traffic-with-ai.js` OR accept events.js importing from traffic.js.
- **(c) Dead code** — `analyzeTrafficWithAI` never actually fires from any live code path. Delete during commit 8 (events extraction).

Default if uncertain: assume (a), leave it untouched in this commit, flag as `claude_memory` row, and commit 8 (events) imports the local function from briefing-service.js shim. This preserves Phase 1 behavioral parity.

**✅ RESOLVED 2026-05-02 (none of the above — drift signal was based on incorrect recon):**
The resume plan's framing ("two BRIEFING_TRAFFIC LLM call sites with one inside the events code path") was based on a misread of the call graph. Actual findings from Commit 7's recon-first methodology:
- `analyzeTrafficWithAI` is **defined** at line 455 (in an early region of the file, near events functions due to historical file layout), NOT inside `fetchEventsWithClaudeWebSearch`.
- Its **only call site** is line 1491 inside `fetchTrafficConditions` (the live traffic path).
- It's a **pure traffic helper** (signature `{ tomtomData, rawTraffic, city, state, formattedAddress, driverLat, driverLon }`, body operates on TomTom incident arrays) — not events logic.
- No cross-pollution exists. The function was just **misplaced** in the file.

Resolution (Option A — hybrid precedent):
1. Created `server/lib/briefing/pipelines/traffic.js` with `discoverTraffic` (pipeline contract) + `fetchTrafficConditions` (re-exported live path) + `analyzeTrafficWithAI` (private helper, co-located with its only caller).
2. Same shape as Commit 5's `extractAirportJson` (private helper co-located with its caller in `pipelines/airport.js`) — internal helper that's not exported.
3. References both `claude_memory` #294 (Commit 4 dead-code precedent) and Commit 5's airport private-helper precedent — this is a **hybrid case**: misplaced-but-live (not dead, like #294) AND private-helper-co-location (like airport).
4. Logged to `claude_memory` (category=`engineering-pattern`, status=`active`).

Lesson: "drift signal" framings in plan documents can themselves be drifty. Recon-first methodology (grep callers + diff bodies BEFORE accepting the plan's framing) is what surfaced the misread. Future Workstream 6 commits should grep call graphs before accepting any plan-author claim about cross-pollution.

**Note on commit 8 implications:** the original §3 commit 7 said "commit 8 (events) imports the local function from briefing-service.js shim" — that contingency no longer applies. analyzeTrafficWithAI is now in pipelines/traffic.js; events.js doesn't need it.

**Channel:** `CHANNELS.TRAFFIC`
**Return:** `{ traffic_conditions, reason }`
**Caller compat:** `server/api/briefing/briefing.js` imports `fetchTrafficConditions` — re-export.

**Estimated delta:** -350/+380 lines (if analyzeTrafficWithAI moves) OR -250/+280 (if it stays).

---

### Commit 8: `pipelines/events.js` (THE BIG ONE — ~1,200 lines)

**Functions:**
- `fetchEventsForBriefing` (originally line 1388) — primary entry point
- `deduplicateEvents` (originally line 174) — exported, used by external callers? grep first
- `filterInvalidEvents` (originally line 308) — used by `dump-last-briefing.js` AND `server/api/briefing/briefing.js`
- `fetchEventsWithClaudeWebSearch` (originally line 334) — Claude fallback
- `fetchEventsWithGemini3ProPreview` (originally line 1142) — primary discovery
- `_fetchEventsWithGemini3ProPreviewLegacy` (originally line 1257) — **§2.6 drift signal #3**
- `fetchEventCategory` (originally line 1047)
- `mapGeminiEventsToLocalEvents` (originally line 959)
- `LocalEventSchema` (zod, originally line 944)

**§2.6 drift signal to resolve:** `_fetchEventsWithGemini3ProPreviewLegacy` likely dead:
```bash
grep -rnE "_fetchEventsWithGemini3ProPreviewLegacy" server/ client/ shared/ 2>/dev/null
git log -p --all -S "_fetchEventsWithGemini3ProPreviewLegacy" | head -100
```
- Default if uncertain: keep, mark `@deprecated`, delete in Phase 2 cleanup
- If clearly unreferenced AND last-touched > 6 months ago: delete during commit 8

**✅ RESOLVED 2026-05-02 (Option A — delete 4 dead paths, hybrid precedent):**
Recon-first methodology surfaced FOUR independently dead code paths in the events region (not just `_Legacy` as the resume plan anticipated):
1. `fetchEventsWithClaudeWebSearch` (~123 lines) — Claude WebSearch fallback never wired up
2. `_fetchEventsWithGemini3ProPreviewLegacy` (~131 lines) — legacy single-search Gemini, superseded by parallel-category `fetchEventsWithGemini3ProPreview`
3. `mapGeminiEventsToLocalEvents` (~53 lines) — orphan event-shape mapper
4. `LocalEventSchema` (~18 lines) — orphan Zod schema, paired with mapGemini

All four verified DEAD via 4-way recon: zero internal callers in briefing-service.js (apart from definitions), zero external callers across `server/`, `client/`, `shared/`, `scripts/`, zero string-quoted dispatch refs, zero dynamic-import refs. Function bodies read in full — none called any of the others (4 INDEPENDENT dead paths, not chained).

**METHODOLOGY LESSON (logged to claude_memory #297):** The naive `\b`-bounded grep produced a FALSE NEGATIVE on `fetchEventsWithGemini3ProPreview` (the live primary fetcher), suggesting it was dead. Cause: `fetchEventsWithGemini3ProPreview` is a substring of `_fetchEventsWithGemini3ProPreviewLegacy`, and `\b` boundary behavior was inconsistent across the two definitions. Resolution: re-grep without `\b`, READ function bodies, cross-check with quote/dynamic dispatch checks. **Substring-collision is a real grep failure mode when one function name is a substring of another.**

Resolution (Option A — Master Architect approval, hybrid of #294 + #296 precedent):
1. Created `server/lib/briefing/pipelines/events.js` (~1,090 lines) with the 5 LIVE functions:
   - `discoverEvents` (pipeline contract entry, exported)
   - `fetchEventsForBriefing` (primary entry, re-exported)
   - `fetchEventsWithGemini3ProPreview` (private — single live caller is fetchEventsForBriefing)
   - `fetchEventCategory` (private — single live caller is fetchEventsWithGemini3ProPreview)
   - `deduplicateEvents` (HASH dedup, Rule 16 — re-exported, SURVIVAL GUARDRAIL #1)
   - `filterInvalidEvents` (LIVE compat shim — re-exported, SURVIVAL GUARDRAIL #2)
   - Plus private helpers: `withTimeout`, `EVENT_SEARCH_TIMEOUT_MS`, `EVENT_CATEGORIES`
2. Deleted 4 dead paths (~325 lines total) from briefing-service.js
3. briefing-service.js: 1,936 → 802 lines (-1,134 net)
4. Cumulative across Commits 4-8: 3,683 → 802 lines (-2,881 net, ~78% reduction)

**SURVIVAL GUARDRAILS preserved per Master Architect directive:**
- `deduplicateEvents` (briefing-service.js HASH dedup, Rule 16) — distinct from `deduplicateEventsSemantic.js` (semantic title-similarity). Both coexist; both run in sequence inside fetchEventsForBriefing (hash first then semantic).
- `filterInvalidEvents` (LIVE compatibility shim) — distinct from `validateEventsHard` (canonical validation module). Shim is exported because external API callers (briefing.js, dump-last-briefing.js) still use the legacy name.

**Channel:** `CHANNELS.EVENTS`
**Return:** `{ events, reason }`
**Caller compat:**
- `server/api/briefing/briefing.js` imports `filterInvalidEvents` — re-export
- `server/lib/briefing/dump-last-briefing.js` imports `filterInvalidEvents` — re-export
- `deduplicateEvents` exported but not in caller graph — keep export anyway

**Risk callouts:**
- Largest single commit. Take time.
- Multiple LLM call sites (2× `BRIEFING_EVENTS_DISCOVERY`, 1× `BRIEFING_FALLBACK`). All must remain functional.
- Dependencies on `normalizeEvent`, `generateEventHash`, `deduplicateEventsSemantic`, `geocodeEventAddress`, `findOrCreateVenue`, `lookupVenue`, `searchPlaceWithTextSearch`, `validateVenueAddress`, `validateEventsHard`, `needsReadTimeValidation`, `VALIDATION_SCHEMA_VERSION`, `deactivatePastEvents` — all become imports inside `pipelines/events.js`.
- Dedup at write per Rule 16 — preserve `deduplicateEvents` + `deduplicateEventsSemantic` calls in their current order.

**Estimated delta:** -1,200/+1,280 lines.

---

### Commit 9: `briefing-aggregator.js` (replaces `generateAndStoreBriefing`)

**New file:** `server/lib/briefing/briefing-aggregator.js` — size budget ≤ 200 lines.

**Owns:**
- `generateAndStoreBriefing` (entry point, moved from briefing-service.js)
- `generateBriefingInternal` (orchestration logic, moved)
- The cache LOOKUP for school_closures (cross-snapshot DB query — orchestrator concern)
- The `Promise.allSettled` fan-out — calls 6 `discover<Thing>` functions in parallel
- The final atomic reconciliation write — assembles `briefingData` object, writes to DB
- The bulk-failure path (`failureMarker = errorMarker(err)` with 4-section reuse)
- `inFlightBriefings` Map (in-process dedup)
- `getOrGenerateBriefing` (cache-aware entry — depends on `staleness.js` predicates)
- `getBriefingBySnapshotId` (read-only)
- `refreshEventsInBriefing`, `refreshTrafficInBriefing`, `refreshNewsInBriefing` (partial refresh helpers)

**`briefing-service.js` after this commit:** thin re-export shim, ~50 lines. Re-exports every existing public symbol from its new home so external callers don't migrate yet:
```js
// briefing-service.js — Phase 1 shim
export { generateAndStoreBriefing, getOrGenerateBriefing, getBriefingBySnapshotId, refreshEventsInBriefing }
  from './briefing-aggregator.js';
export { fetchEventsForBriefing, deduplicateEvents, filterInvalidEvents }
  from './pipelines/events.js';
export { fetchWeatherForecast, fetchWeatherConditions } from './pipelines/weather.js';
export { fetchTrafficConditions } from './pipelines/traffic.js';
export { fetchRideshareNews } from './pipelines/news.js';
export { fetchSchoolClosures } from './pipelines/schools.js';
```

**Validation gate (load-bearing):** parity test — run `/api/blocks-fast` against a fixed snapshot, diff the `briefings` row before/after. Must be byte-identical (allowing for explicit `_telemetry` additions, if any).

**Estimated delta:** -700 in briefing-service.js (becomes shim), +200 in briefing-aggregator.js.

---

### Commit 10: docs + `index.js` barrel update

- `server/lib/briefing/index.js` — add re-exports from new locations + new `CHANNELS` const so external code can subscribe to channels by name
- `server/lib/briefing/README.md` — rewrite to reflect new structure + 9-stage taxonomy mapping (file location IS the taxonomy declaration)

---

### Commit 11: parity tests

**New tests under `tests/briefing/`** (verify directory exists first; if not, follow nearest existing test layout):
- `pipelines/schools.test.js`, `weather.test.js`, etc. — unit tests with mocked `callModel`, mocked DB
- `aggregator.test.js` — integration test with all 6 pipelines mocked
- `parity.test.js` — golden-snapshot diff test (the load-bearing assertion)

---

## 4. Pre-commit checklist (use for every commit 4-11)

After every extraction, in order:
1. `node --check server/lib/briefing/briefing-service.js` — must pass
2. `node --check server/lib/briefing/pipelines/<new>.js` — must pass
3. `grep -nE "^function <ExtractedName>|^async function <ExtractedName>" server/lib/briefing/briefing-service.js` — must return 0 hits (no orphan local definition)
4. `grep -nE "'briefing_<channel>_ready'" server/lib/briefing/briefing-service.js` — must return 0 (literal channel string fully migrated to `CHANNELS.X`)
5. `grep -rn "from.*briefing-service" server/ client/ 2>/dev/null | grep -v node_modules` — every external caller still resolves (re-exports preserved)
6. Dynamic import smoke: `timeout 8 node -e "import('./server/lib/briefing/pipelines/<new>.js').then(m => console.log('exports:', Object.keys(m).join(', ')))"` — must print `exports: ...` line before the timer fires
7. Verify the orchestrator's final-assembly block at briefing-service.js (`briefingData = {}`, around line 2840 post-commit-3, will shift) still references all expected variables with the new shape — no orphan `<thing>Reason` references

---

## 5. Resume command for post-`/compact` session

```bash
# Verify state
git -C /home/runner/workspace branch --show-current
# → feat/workstream6-briefing-split

git log --oneline -5
# → 5fd74087 (commit 3) + db3b1f3a, 2c30edd6, b831b10a + parent

git status --short
# → only .claude/settings.local.json modified (unrelated, ignore)

# Re-orient
cat docs/review-queue/PLAN_workstream6_remaining-2026-05-02.md  # this doc

# Find current line numbers (will have shifted from originals)
grep -nE "^export async function fetchWeather|^export async function fetchTraffic|^export async function fetchAirport|^export async function fetchRideshareNews|^export async function fetchEventsForBriefing" server/lib/briefing/briefing-service.js
```

Then begin commit 4 (weather pipeline extraction) per §3 commit 4 above, applying §2.1's wider contract and §2.5's re-export pattern.

---

## 6. Open follow-ups (post-commit-9, before Phase 2)

After Step 1 (commits 4-11) lands and soaks ≥ 7 days from prod deploy:
- Update `PLAN_workstream6_briefing_split.md` §3.2 to reflect the wider `{ <section>, reason }` contract
- Phase 2 commits 12+: migrate external callers to import directly from new locations, delete `briefing-service.js` shim
- Step 2 (catalog cleanup `venue_catalog.source_model` → `discovered_events.source_model`) — gets its own Phase 0 plan
- Step 3 (catalog-first lookup in `tactical-planner.js` — flip Pass 1 / Pass 2) — gets its own Phase 0 plan
