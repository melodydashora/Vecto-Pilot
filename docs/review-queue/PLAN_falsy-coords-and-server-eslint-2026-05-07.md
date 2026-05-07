# PLAN: Falsy-coordinate sweep + ESLint `no-undef` coverage on server JS

**Created:** 2026-05-07
**Author:** Claude Code (Opus 4.7)
**Filed under:** Rule 1 (Planning Before Implementation), Rule 9 (zero-tolerance drift), CLAUDE.md doctrines "NO FALLBACKS — GLOBAL APP RULE" and "ABSOLUTE PRECISION — GPS & DATA ACCURACY"
**Scope:** Two structural integrity fixes bundled into one commit
**Status:** Awaiting advisor validation, then Melody approval (pre-approved per her message 2026-05-07).

---

## 1. Background

Two findings, both surfaced this session, both share the same root cause: **the codebase is large enough that pattern-level mistakes are statistically inevitable, but the static analysis layer doesn't catch the patterns.**

### Finding A — Falsy-coordinate checks reject valid `0`

**JavaScript-falsy trap.** `0` is falsy. So `!lat || !lng` rejects valid latitude `0` (the equator: Ecuador, Kenya, Indonesia, Singapore, Brazil) and valid longitude `0` (the prime meridian: London, parts of West Africa). Verified 25+ instances of the pattern across the codebase.

The codebase already has the **correct** shape in active use at `server/api/location/location.js:214, 346, 450` (`!isFinite(lat) || !isFinite(lng)`), and explicitly soft-warns on `(0,0)` at lines 508-510 — meaning the author *knows* `(0,0)` is a valid (if suspicious) coordinate. But 25+ other sites use the buggy `!lat || !lng` pattern, including some that sit literally three lines above the correct pattern in the same function.

This violates two CLAUDE.md doctrines:
- **NO FALLBACKS — GLOBAL APP RULE** ("Never hardcode coordinates"; the default-substitution form `lat || null` is exactly that)
- **ABSOLUTE PRECISION — GPS & DATA ACCURACY** (the system claims 11cm precision but excludes a band of valid coordinates from input)

Practical impact today is zero (Vecto Pilot's actual user base is DFW-area drivers at lat ~32.78, lng ~-96.8). Structural impact is high (the GLOBAL APP RULE exists precisely to keep this kind of regional assumption from making the app brittle if it ever expands).

### Finding B — Server JS isn't linted with `no-undef`

**Two bugs of the same forensic class in one week:**
- 2026-05-06 commit `daa430f3`: `thinkingLevel = high` ReferenceError in `gemini-adapter.js`. Coach was broken.
- 2026-05-07 commit `77085a03`: `reqId` undefined in `/snapshot` full-mode error path. Validation-failure path crashed.

Both bugs:
- Lint-clean. Typecheck-clean. Build-clean.
- Module loads fine. Server boots fine.
- Only fire at runtime when a specific code path executes.

**Structural cause:** `npm run lint` is `eslint client/src --max-warnings 0` per `package.json`. The flat config at `eslint.config.js` has a `server/**/*.ts` block but **no block for `server/**/*.{js,mjs}`** — which is the majority of the server. So most server JS is invisible to ESLint, and ESLint's `no-undef` rule (enabled by default in `js.configs.recommended`) is never applied to it.

There **will** be a third instance of this class until the gap is closed. The two-line fixes for the previous instances are necessary but not sufficient — they close the instance, not the class. Closing the class requires turning on `no-undef` for server JS.

---

## 2. Objectives

- **O1 (Phase 1).** Replace every falsy-coordinate check (reject pattern, default-substitution pattern, truthy-AND pattern) on the waterfall e2e paths with the correct `isFinite`-based or `?? null`-based shape. Preserve Siri Shortcut paths unchanged.
- **O2 (Phase 2).** Enable ESLint coverage on `server/**/*.{js,mjs}` with `no-undef` on, so the next `thinkingLevel = high` / `reqId`-class bug fails CI at PR time instead of production.
- **O3.** Match the existing correct shapes already in the codebase (the `isFinite` checks at `location.js:214, 346, 450`). No new convention introduced.

---

## 3. Approach

### 3.0 Cascade rule (carrying over from prior plans)

When a falsy-coordinate check is replaced:
1. Replace the line outright. Don't leave a `// 2026-05-07: replaced !lat || !lng with isFinite` breadcrumb in live source.
2. If a comment above the line explains the now-replaced check, update or delete it as appropriate.
3. Match the existing project shape (`isFinite(...)` for boolean tests, `?? null` for nullish defaults).

### 3.1 Phase 1 — Falsy-coordinate sweep

**Pattern A — Reject (`!lat || !lng`) → `!Number.isFinite(lat) || !Number.isFinite(lng)` (default) or `!isFinite(lat) || !isFinite(lng)` (only at pre-coerced sites)**

**Critical:** the global `isFinite()` coerces `null`/`""`/`[]` to `0` and **passes them as finite**. `Number.isFinite()` does not coerce — returns `false` for `null`, `undefined`, strings, arrays. For most of this sweep, `Number.isFinite` is the correct primitive.

| Input | `isFinite(x)` (global) | `Number.isFinite(x)` |
|---|---|---|
| `0` | true | true |
| `33.1` | true | true |
| `"33.1"` | **true** (string coerced) | false |
| `""` | **true** (coerced to 0!) | false |
| `null` | **true** (coerced to 0!) | false |
| `undefined` | false | false |
| `NaN` | false | false |
| `[]` | **true** (coerced to 0!) | false |

**Triage rule:**
- Use **`Number.isFinite`** wherever the value may legitimately arrive as `null`/`undefined` — DB nullable columns, optional-chained access (`snapshot?.lat`), post-fetch result fields, filter predicates over heterogeneous collections.
- Use **global `isFinite`** only where the value has been pre-coerced via `Number(...)` upstream — and verify the coercion actually happened in the same function or via explicit upstream guarantee.
- **Default to `Number.isFinite`** when in doubt. Strict beats lossy.

**Worked example of why this matters** — `server/lib/events/pipeline/geocodeEvent.js:69` is `events.filter(e => !e.lat || !e.lng)`, which filters events **needing** geocoding. For an un-geocoded event with `e.lat === null`:
- Pre-fix `!null` → `true` → event correctly included.
- Naive `!isFinite(null)` → `!isFinite(null)` is `!true` (because global isFinite coerces null to 0) → `false` → event excluded → regression: events that need geocoding never get geocoded.
- Correct `!Number.isFinite(null)` → `!false` → `true` → event correctly included.

Targets (Phase 1 Pattern A) — annotated with the right primitive per site:

Targets (Phase 1 Pattern A):

| File:line | Current | Replacement | Primitive |
|---|---|---|---|
| `server/lib/venue/venue-address-resolver.js:49` | `if (!lat \|\| !lng) return null;` | `if (!Number.isFinite(lat) \|\| !Number.isFinite(lng)) return null;` | `Number.isFinite` (function arg, may be null) |
| `server/lib/venue/venue-cache.js:593` | `if (!latitude \|\| !longitude) {` | `if (!Number.isFinite(latitude) \|\| !Number.isFinite(longitude)) {` | `Number.isFinite` (DB column, nullable) |
| `server/lib/traffic/tomtom.js:188, 458` | `if (!lat \|\| !lng/!lon) {` | Same pattern with `Number.isFinite` | `Number.isFinite` (verify caller pre-coercion in implementation) |
| `server/api/briefing/briefing.js:599` | `if (!lat \|\| !lng \|\| !city \|\| !state \|\| !timezone) {` | `if (!Number.isFinite(Number(lat)) \|\| !Number.isFinite(Number(lng)) \|\| !city \|\| !state \|\| !timezone) {` — query string params arrive as strings; coerce explicitly. String fields can stay falsy-checked — only coords are buggy. | `Number.isFinite` after explicit `Number(...)` |
| `server/api/briefing/briefing.js:626` | `if (!lat \|\| !lng) {` | Same — query params, coerce + `Number.isFinite` | `Number.isFinite` after explicit `Number(...)` |
| `server/api/location/location.js:1592` | `if (!lat \|\| !lng) {` | `if (!Number.isFinite(lat) \|\| !Number.isFinite(lng)) {` — body params, no auto-coercion in this branch (verify in implementation) | `Number.isFinite` |
| `server/api/location/location.js:2142` | `if (!latitude \|\| !longitude \|\| !address) {` | `if (!Number.isFinite(latitude) \|\| !Number.isFinite(longitude) \|\| !address) {` | `Number.isFinite` |
| `server/api/venue/venue-intelligence.js:26, 78, 113, 150, 428` | `if (!lat \|\| !lng) {` (5 sites) | Same pattern with `Number.isFinite` | `Number.isFinite` (route params, often string-typed — verify per site whether coercion happens in the body or route layer) |
| `server/lib/briefing/pipelines/weather.js:147` | `if (!snapshot?.lat \|\| !snapshot?.lng) {` | `if (!Number.isFinite(snapshot?.lat) \|\| !Number.isFinite(snapshot?.lng)) {` | `Number.isFinite` (optional-chain may yield undefined) |
| `server/lib/venue/event-proximity-boost.js:107, 112, 133, 136` | `!anchorCoord?.lat \|\| !anchorCoord?.lng` and `!c.coords?.lat \|\| !c.coords?.lng` | Same pattern with `Number.isFinite` | `Number.isFinite` (optional-chain) |
| `server/lib/events/pipeline/geocodeEvent.js:69` | `events.filter(e => !e.lat \|\| !e.lng)` | `events.filter(e => !Number.isFinite(e.lat) \|\| !Number.isFinite(e.lng))` | **`Number.isFinite` (DB nullable column — `isFinite` would regress this site, see worked example above)** |

**Pattern B — Default-substitution (`lat || X`) → `lat ?? X` (nullish coalescing)**

`??` (nullish coalescing) substitutes only when the left side is `null` or `undefined` — so `0 ?? null` is `0` (preserved), but `null ?? null` is `null` (substituted). This is the correct semantics for "use the value if it exists, else default."

Targets (Phase 1 Pattern B):

| File:line | Current | Replacement |
|---|---|---|
| `server/lib/ai/coach-dal.js:2145-2146` | `lat: lat \|\| matchingZone.lat` and `lng: lng \|\| matchingZone.lng` | `lat: lat ?? matchingZone.lat` and `lng: lng ?? matchingZone.lng` |
| `server/lib/ai/coach-dal.js:2163-2164` | `lat: lat \|\| null`, `lng: lng \|\| null` | `lat: lat ?? null`, `lng: lng ?? null` |
| `server/lib/ai/rideshare-coach-dal.js:2597-2598, 2615-2616` | Same shapes | Same fix |
| `server/lib/location/address-validation.js:129-130` | `location?.latitude \|\| null`, `location?.longitude \|\| null` | `location?.latitude ?? null`, `location?.longitude ?? null` |
| `server/lib/venue/venue-address-resolver.js:101-102, 118-119` | `placeResult.lat \|\| lat`, `placeResult.lng \|\| lng` (4 sites) | `placeResult.lat ?? lat`, `placeResult.lng ?? lng` |
| `server/lib/venue/venue-cache.js:687-688` | `venue.lat \|\| lat`, `venue.lng \|\| lng` | `venue.lat ?? lat`, `venue.lng ?? lng` |
| `server/api/auth/auth.js:440-441` | `geocodeResult?.lat \|\| null`, `geocodeResult?.lng \|\| null` | `geocodeResult?.lat ?? null`, `geocodeResult?.lng ?? null` |
| `server/lib/concierge/concierge-service.js:589` | `lat: v.lat \|\| null` (and any sibling lng — verify in implementation) | `lat: v.lat ?? null` |

**Pattern C — Truthy-AND (`if (lat && lng)`) → `if (Number.isFinite(lat) && Number.isFinite(lng))`**

Same primitive-choice rule as Pattern A: `Number.isFinite` by default, `isFinite` only at pre-coerced sites.

| File:line | Current | Replacement |
|---|---|---|
| `server/api/location/location.js:1586` | `const isMinimalMode = snapshotV1?.lat && snapshotV1?.lng && !snapshotV1?.resolved;` | `const isMinimalMode = Number.isFinite(snapshotV1?.lat) && Number.isFinite(snapshotV1?.lng) && !snapshotV1?.resolved;` |
| `server/api/location/snapshot.js:166` | `if (lat && lng) {` | `if (Number.isFinite(lat) && Number.isFinite(lng)) {` |
| `server/lib/venue/venue-address-validator.js:158` | `if (lat && lng && city && typeof city === 'string') {` | `if (Number.isFinite(lat) && Number.isFinite(lng) && city && typeof city === 'string') {` |
| `server/lib/venue/venue-cache.js:541` | `if (latitude && longitude) {` | `if (Number.isFinite(latitude) && Number.isFinite(longitude)) {` |
| `client/src/utils/co-pilot-helpers.ts:319, 343` | `if (lat && lng) {` (2 sites) | `if (Number.isFinite(lat) && Number.isFinite(lng)) {` — TS may not auto-narrow `lat: number \| null \| undefined` to `number` after the check; verify consuming code in implementation |

**Excluded — Siri Shortcut path (preserved per prior precedent):**

| File:line | Status | Reason |
|---|---|---|
| `server/api/hooks/analyze-offer.js:559` | LEFT AS-IS | Siri Shortcut pipeline isolated from waterfall e2e; per the device_id removal precedent, Siri-side code stays untouched in waterfall sweeps unless explicitly scoped. |

**Note on tests:** `tests/triad/test-pipeline.js` and similar may have falsy-coord patterns in fixtures. Out of scope for this sweep unless a fixture actually breaks — if it does, fix in same commit.

### 3.2 Phase 2 — ESLint coverage for server JS with `no-undef`

**Goal:** add `no-undef` enforcement on `server/**/*.{js,mjs}` so the next `thinkingLevel = high` / `reqId`-class ReferenceError fails CI at PR time.

**Approach:**

1. **Modify `eslint.config.js`** — add a new flat-config block targeting server JS files specifically:

```javascript
// New block after the existing server TS block
{
  files: ['server/**/*.{js,mjs}', 'gateway-server.js', 'agent-server.js'],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    globals: globals.node,
  },
  rules: {
    'no-undef': 'error',          // The rule we care about — closes the forensic class
    'no-unused-vars': 'off',       // Out of scope; would explode diff with cosmetic fixes
    'no-console': 'off',           // Console logging is part of the codebase's logger model
    'no-empty': 'off',             // Empty catch blocks exist intentionally in some places
    'no-constant-condition': 'off', // Some `while(true)` patterns are valid in the codebase
  },
},
```

The strict rule list (only `no-undef`, everything else off) keeps the diff bounded. Phase 2 enforces ONE rule — the one whose absence cost us two production bugs in one week.

2. **Update `package.json` lint script** to include the server JS surface:

```json
"lint": "eslint client/src 'server/**/*.{js,mjs}' gateway-server.js agent-server.js --report-unused-disable-directives --max-warnings 0"
```

3. **Run `npm run lint`** to discover any pre-existing `no-undef` violations.

4. **Triage the surface:**
   - **Real bugs** (undeclared identifier references like `reqId`, `high`, etc.) — fix in same commit.
   - **Missing globals** (e.g., `Buffer`, `process`, `__dirname` in CommonJS-imported files) — should already be covered by `globals.node`, but if not, add to globals or per-file `/* global ... */`.
   - **Genuine noise** (e.g., a CodeQL-suppressing pattern that ESLint misreads) — per-file `/* eslint-disable no-undef */` with a comment explaining why.

**Phase 2 scope cap:** if more than ~10 distinct `no-undef` violations surface that aren't trivial fixes, **abort Phase 2 in this commit** and file it as a separate plan. Phase 1 still ships. The Phase 2 config addition lands in the follow-up plan with the violations triaged carefully.

This bounded-scope rule prevents the commit from ballooning if the lint surface reveals a swarm of pre-existing issues we don't have time to triage in this pass.

5. **Document the new lint coverage** in `LESSONS_LEARNED.md` so future contributors know server JS is now linted.

### 3.3 Cascade rule for Phase 2

Per the cascade-rule lineage from prior plans: when adding the new ESLint config block, do not add a `// 2026-05-07: added no-undef` breadcrumb comment in `eslint.config.js`. The git commit + LESSONS_LEARNED entry + plan file carry the historical record.

---

## 4. Files affected

### 4.1 Phase 1 (falsy-coord sweep)

| File | Estimated change |
|---|---|
| `server/lib/venue/venue-address-resolver.js` | Pattern A: 1 site; Pattern B: 4 sites |
| `server/lib/venue/venue-cache.js` | Pattern A: 1 site; Pattern B: 2 sites; Pattern C: 1 site |
| `server/lib/venue/event-proximity-boost.js` | Pattern A: 4 sites |
| `server/lib/venue/venue-intelligence.js` | Pattern A: 5 sites |
| `server/lib/venue/venue-address-validator.js` | Pattern C: 1 site |
| `server/lib/traffic/tomtom.js` | Pattern A: 2 sites |
| `server/lib/briefing/pipelines/weather.js` | Pattern A: 1 site |
| `server/lib/events/pipeline/geocodeEvent.js` | Pattern A: 1 site |
| `server/lib/ai/coach-dal.js` | Pattern B: 4 sites |
| `server/lib/ai/rideshare-coach-dal.js` | Pattern B: 4 sites |
| `server/lib/location/address-validation.js` | Pattern B: 2 sites |
| `server/lib/concierge/concierge-service.js` | Pattern B: 1 site (verify lng sibling in implementation) |
| `server/api/briefing/briefing.js` | Pattern A: 2 sites |
| `server/api/location/location.js` | Pattern A: 2 sites; Pattern C: 1 site |
| `server/api/location/snapshot.js` | Pattern C: 1 site |
| `server/api/venue/venue-intelligence.js` | (covered above under server/api/venue) |
| `server/api/auth/auth.js` | Pattern B: 2 sites |
| `client/src/utils/co-pilot-helpers.ts` | Pattern C: 2 sites |

**~17 files. ~40 line-edit sites total.** Each edit is a one-line replacement. No structural changes.

### 4.2 Phase 2 (ESLint coverage)

| File | Change |
|---|---|
| `eslint.config.js` | +1 config block (~14 lines) |
| `package.json` | 1 line modified (lint script glob expanded) |
| Any server JS files surfaced by `no-undef` violations | TBD per discovery |

### 4.3 Documentation cascade

- `LESSONS_LEARNED.md` — new 2026-05-07 entry on the falsy-coordinate forensic class + Phase 2 lint-gap closure.
- `claude_memory` — file an audit row, status `resolved` on commit, parent_id=318 (same audit-class).

---

## 5. Risk analysis

| Risk | Severity | Mitigation |
|---|---|---|
| `?? null` semantics changes existing behavior | Low | `??` substitutes only on `null`/`undefined`. `\|\|` substitutes on falsy (including `0`, `""`, `false`). For coordinates, the only practical difference is on `0` — which is the entire point of the fix. For any pattern where `0` was being intentionally substituted with the right side, this changes behavior — but I haven't found evidence of intentional 0-substitution in the audit. Verify per-site during implementation; if any site WAS intentionally substituting 0, leave it alone and document. |
| `isFinite(undefined)` returns `false` (correct) but may differ from prior behavior | None | `!undefined` is `true` (prior: rejected). `!isFinite(undefined)` is also `true` (new: still rejected). Same outcome for `undefined`. The differing case is `0`: prior rejected, new accepted. That is the intended fix. |
| Phase 2 surfaces a swarm of pre-existing `no-undef` violations | Medium | Phase 2 has a built-in scope cap (§3.2 step 4). If >10 distinct violations surface that aren't trivial, Phase 2 splits into a follow-up plan. Phase 1 still ships. |
| Phase 2 lint config breaks because `globals.node` is missing some identifier the codebase relies on | Low | The flat config already uses `globals.node` for `server/**/*.ts`. Same package, same exports, applied to a wider file glob. If a global is missing, add to per-block globals or per-file `/* global foo */` comment. |
| Test fixtures using `lat: 0` in `tests/` would currently silently pass through the falsy guards as if invalid | Low | Verify during implementation; fix any fixtures that depended on the broken behavior. |
| Some Pattern B sites are intentional 0-rejection ("if user didn't provide a value, use null") | Low | The existing `!lat \|\| !lng` and `lat \|\| null` patterns were almost certainly written without thinking about the `0` case — there's no comment in any of the 25+ sites explaining "we treat 0 as missing." The audit assumption is they're all bugs. If any site has an intentional 0-rejection rationale, the implementation reads it carefully and leaves it alone. **Specifically per advisor flag 2026-05-07: at `coach-dal.js:2145` and the parallel `rideshare-coach-dal.js:2597`, read the surrounding 20 lines before changing — verify the `lat` variable can't legitimately be the literal value `0` for a non-coordinate meaning (e.g., zone offset).** |
| Client-side TypeScript files (`client/src/utils/co-pilot-helpers.ts`) might have `lat`/`lng` typed as `number \| null \| undefined` and the type-checker may reject `isFinite(lat)` until null-narrowed | Low | TypeScript's `isFinite` accepts `number`, so type-checker may complain. Wrap as `lat != null && isFinite(lat)` for client-side TS callsites. |
| Hot-reload may not pick up `eslint.config.js` changes automatically | None | `eslint.config.js` is build-time config, not runtime. No hot-reload concern. |

---

## 6. Implementation order

**Reversed from initial draft (per advisor 2026-05-07): Phase 2 BEFORE Phase 1.**

The reversal gives three advantages:
1. Pre-existing `no-undef` violations surface against unmodified code (clean baseline — no ambiguity about whether a violation is something I just introduced).
2. As I make Phase 1 edits, lint runs catch any typo I introduce during the sweep (`!Numbr.isFinite` → caught immediately).
3. If Phase 2 hits the >10-violations scope cap, I abort cleanly *before* touching the 17 Phase 1 files.

Steps:

1. **Phase 2a — config.** Add the new block to `eslint.config.js` per §3.2.
2. **Phase 2b — script update.** Update `package.json` lint script per §3.2.
3. **Phase 2c — discovery.** Run `npm run lint`. Triage findings per §3.2 step 4.
   - If trivial findings: fix them in same commit (preserve Phase 1 still ahead).
   - If >10 distinct violations: abort Phase 2, file follow-up plan with the violation list, ship Phase 1 alone in this commit, and note in commit message that Phase 2 is the next plan.
4. **Phase 2d — confirm clean baseline.** `npm run lint` clean. `npm run build` clean. This is the baseline — anything that breaks during Phase 1 is something Phase 1 introduced.
5. **Phase 1 — sweep.** Edit each of the ~17 files per §4.1. After each directory's batch:
   - `node --check` on each touched server file.
   - `npm run lint` to catch any typo (e.g., `Number.isFinte` instead of `Number.isFinite`) before moving to the next batch.
6. **Phase 1 verification.** `npm run typecheck` clean. `npm run build` clean. `npm run lint` clean. Residue greps T11/T12 pass.
7. **Documentation cascade.** Update `LESSONS_LEARNED.md` per §4.3. File `claude_memory` audit row.
8. **Commit.** Stage only the touched files. Don't push until Melody smoke-tests.
9. **Push.** After Melody confirms.

---

## 7. Test cases

### 7.1 Behavioral (Phase 1)

**Note:** these are curl tests, not browser tests. The web client never sends `lat=0` or `lng=0` bodies (the user is in DFW), so UI smoke can't exercise these paths. Use a fresh JWT per the `reqId` fix's curl recipe.

- **T1 — equator latitude accepted:** `POST /api/location/snapshot` with `{coord:{lat:0, lng:-96.8}, ...valid full-mode body...}`. Pre-fix: routed to validation-failure path (because `snapshotV1?.lat && snapshotV1?.lng` at line 1586 was false for lat=0). Post-fix: handled correctly through full-mode path.
- **T2 — prime meridian longitude accepted:** Same shape, lat=33.1, lng=0. Same expectation.
- **T3 — `(0,0)` triggers soft warn but proceeds:** Existing `if (lat === 0 && lng === 0)` warn at `location.js:508-510` still fires (this is the *correct* shape we're aligning to). Request continues processing.
- **T4 — current DFW happy path unchanged:** lat=32.78, lng=-96.8 — full pipeline runs exactly as before. No regression.
- **T5 — invalid coords still rejected:** lat=`null`, lat=`undefined`, lat=`"abc"` (parsed as `NaN`) — all rejected via `!Number.isFinite(...)`. Same response shape as today.
- **T5b — null coord on geocode filter (advisor regression check):** insert a test event with `lat: null` (representing un-geocoded), run the geocode pipeline, verify the event remains in the "needs geocoding" set. Pre-`Number.isFinite` correction would have regressed this; the corrected primitive prevents it.

### 7.2 Behavioral (Phase 2)

- **T6 — `no-undef` catches a synthetic ReferenceError:** Insert a deliberate `xyz` reference into a server JS file, run `npm run lint`. Expect lint failure naming the undeclared identifier. Remove the deliberate reference.
- **T7 — `no-undef` catches the `reqId`-class regression:** Hypothetically reintroduce the `reqId` undefined reference (don't actually commit), run lint. Expect failure. The whole point of Phase 2 is this.

### 7.3 Static / sweep

- **T8 — typecheck:** `npm run typecheck` clean.
- **T9 — build:** `npm run build` clean.
- **T10 — lint:** `npm run lint` clean across the new wider scope.
- **T11 — residue grep (Pattern A):** `grep -nE '!lat \|\| !lng|!latitude \|\| !longitude' server/ client/src/` should return only matches in commented code or tests, NOT in active code.
- **T12 — residue grep (Pattern B):** `grep -nE '\.(lat\|lng\|latitude\|longitude) \|\| ' server/` should return only Siri Shortcut paths (preserved) and any other intentional-substitution sites that were left alone with rationale.

### 7.4 Regression

- **T13 — waterfall e2e:** Sign in, accept GPS, verify briefing → strategy → venues completes exactly as before.
- **T14 — Siri Shortcut preserved:** `POST /api/hooks/analyze-offer` still works; no regressions in offer pipeline.

---

## 8. Open questions

None expected. If §3.2 Phase 2 step 4 surfaces a finding shape I didn't anticipate (e.g., Webpack-style globals, dynamic imports that ESLint can't resolve), that becomes an implementation-time decision. Default: scope-cap → split.

---

## 9. Outcome measures

- ✅ Pattern A residue grep returns zero hits in active server JS.
- ✅ Pattern B residue grep returns only Siri Shortcut paths or explicitly-rationalized retentions.
- ✅ Pattern C residue grep returns zero hits except client-side TS (where the implementation may use `!= null && isFinite()` shape).
- ✅ ESLint config covers `server/**/*.{js,mjs}` with `no-undef: 'error'`.
- ✅ `npm run lint` clean across the new scope.
- ✅ Behavioral tests T1-T5 pass.
- ✅ `LESSONS_LEARNED.md` entry filed.
- ✅ `claude_memory` audit row filed.

---

## 10. References

- Audit findings (this session, 2026-05-07): falsy-coord pattern + lint-gap forensic class.
- Forensic precedents:
  - Commit `daa430f3` (`thinkingLevel = high` ReferenceError, gemini-adapter, 2026-05-06). Same class as Phase 2 motivation.
  - Commit `77085a03` (`reqId` undefined, snapshot full-mode, 2026-05-07). Same class as Phase 2 motivation.
- Existing correct shapes already in codebase: `server/api/location/location.js:214, 346, 450` (`!isFinite(lat) || !isFinite(lng)`); `server/api/location/location.js:508-510` (soft-warn on `(0,0)`).
- CLAUDE.md doctrines: NO FALLBACKS — GLOBAL APP RULE; ABSOLUTE PRECISION — GPS & DATA ACCURACY.
- Audit chain: rows 318, 319, 320, 321, 322 (cross-user / device_id / ownership / reqId — same problem class as this finding's structural root).
