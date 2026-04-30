---
date: 2026-04-18
session_id: 2026-04-18-geographic-anchor-audit
scope: Read-only inventory of geographic anchors in the codebase — concrete city/venue references, prompt-level Frisco hardcoding, and proposed placeholder doctrine
status: recon complete; one P0 smoking gun found (analyze-offer.js:128); no code changes
author: claude-opus-4-7[1m]
related_audits:
  - docs/architecture/audits/FRISCO_LOCK_DIAGNOSIS_2026-04-18.md
  - docs/architecture/audits/NOTIFY_LOSS_RECON_2026-04-18.md
  - docs/architecture/audits/NEON_AUTOSCALE_TOPOLOGY_2026-04-18.md
  - docs/architecture/audits/RECON_2026-04-17_HANDLES_LOCALITY.md
constraints_honored:
  - read_only: true
  - prod_db_touched: false
  - dev_db_touched: false
  - schema_changes: none
  - migrations_applied: none
  - code_changes: none
  - server_restarted: false
  - republished: false
  - DECISIONS_md_modified: false
  - phase_0a_commit_e7034939: untouched
hypothesis_under_test:
  H3: "LLM planners treat concrete place examples in prompts as implicit constraints, causing silent out-of-distribution degradation for drivers outside Frisco. This would explain why briefing works in Frisco but fails in every other city independent of NOTIFY-loss."
---

# Geographic Anchor Audit — 2026-04-18

Tests Hypothesis **H3**: prompts that name Frisco-area places as concrete examples cause LLMs to anchor on Frisco-style answers regardless of the actual driver location. **One P0-prompt smoking gun found and confirmed**: `server/api/hooks/analyze-offer.js:128` PHASE2_SYSTEM_PROMPT hardcodes "Frisco, TX" home base for every Siri offer-analysis call from any driver anywhere.

## TL;DR

| Class | Count (~) | Severity | Action |
|-------|-----------|----------|--------|
| **P0-prompt** (LLM prompt body / example block sent verbatim to model) | **4 sites in 2 files** | **CRITICAL** | Replace with placeholders OR conditionalize on driver location |
| **P0-default** (fallback default coord/city/venue when location data missing) | 1 site (diagnostics) | LOW | Diagnostics only; not in production user path |
| **P1-cachekey** (cache key built from city/venue name) | 0 found | — | — |
| **P2-comment** (stale doctrine / log examples) | ~25 sites | LOW-MEDIUM | Update over time; not behavioural |
| **P2-fixture** (seed scripts producing prod data) | ~10 sites | MEDIUM | Tied to seed-coverage gap (FRISCO_LOCK Part A) |
| **P3-test** (test fixtures, isolated) | ~6 sites | LOW | OK to leave as-is |
| **P4-doc** (READMEs, architecture docs) | ~25 sites | LOW | Update during doctrine refresh |

**Total Frisco occurrences**: 218 across 77 files (multi-pattern with surrounding DFW cities: 509 across 59 files).

**H3 confidence**: **HIGH (~75%)** that prompt-level Frisco anchoring is a meaningful contributor to Frisco-lock. Together with Bug A (NOTIFY-loss) + Bug B (`_coverageEmpty` client gap) + topology multiplier, it forms a **plausible composite cause for the observed symptom**.

## 1. Methodology

### 1.1 Search patterns used

```
[Ff]risco|FRISCO                                                  → 218 hits / 77 files
[Pp]lano|[Mm]ckinney|fort.worth|the.star|legacy.west|             → 509 hits / 59 files (broader DFW + venues)
toyota.stadium|globe.life|love.field|dfw.airport
```

Excluded by glob: `node_modules`, `.git`, `dist`, `build`, `.replit-output/*`, `tmp/*`.

Per-hit classification was performed by reading file context and assessing whether the hit is:
- **P0-prompt**: literal string sent to an LLM in a system or user prompt
- **P0-default**: code-level fallback when input is missing/invalid
- **P1-cachekey**: persisted cache key incorporating a place name
- **P2-comment**: code comment, log line, or doc string for design intent
- **P2-fixture**: data seeded into the runtime DB during setup (production effect, but one-time)
- **P3-test**: test fixture not imported by prod code
- **P4-doc**: standalone documentation file

### 1.2 Why this scope is narrower than the user's "255 / 79"

The user counted "255 references to 'Frisco, TX'" — likely a literal-string search including more documentation files. This audit's strict-grep yielded **218 occurrences across 77 files**. Either count tells the same story; the per-file class distribution is what matters.

## 2. P0-prompt — the high-severity findings

### 2.1 SMOKING GUN: `analyze-offer.js:128, 165` (PHASE2_SYSTEM_PROMPT)

**File**: `server/api/hooks/analyze-offer.js`
**Lines**: 128, 165 (within a single `const PHASE2_SYSTEM_PROMPT = \`...\`` template literal at lines 128–169)

```js
const PHASE2_SYSTEM_PROMPT = `You are a rideshare offer analyst for a Dallas-Fort Worth DFW-area driver based in Frisco, TX.
...
GENERAL:
  7. Rider rating < 4.85 → REJECT. Short rides with good $/mi = GOOD.
  8. Home base: Frisco, TX. Reject rides west of DFW Airport, Fort Worth, Denton outskirts, Anna, rural areas.
  9. Deadhead zones (west of airport or south of 635) need >= $2.00/mi.
  10. Consider driver's CURRENT LOCATION when evaluating deadhead. If already near dropoff area, deadhead is near-zero.
...`;
```

**Severity**: **CRITICAL.**

**Why critical**:
- This is a `const` (no template substitution). It is sent **verbatim to GPT-5.2 / Claude** for **every Siri offer-analysis call**, regardless of `device_id`, `latitude`, `longitude`, `source`.
- It hard-asserts the driver's home base is Frisco, TX.
- Rule 8 instructs the model to **reject rides toward** "DFW Airport west, Fort Worth, Denton outskirts, Anna, rural areas" — geographic exclusions only meaningful from a Frisco-anchored perspective.
- A driver in Houston, Austin, LA, NYC, or anywhere else gets the same Frisco-rules prompt → the model evaluates their offers as if they were in Frisco.

**Evidence of LLM degradation pathway**:
- Prompt rule 10 says "Consider driver's CURRENT LOCATION when evaluating deadhead." — so the model is told to consider current location, but rule 8's hard "Home base: Frisco" + concrete exclusion list overrides this in practice. Prompts that combine "general" guidance with "specific" examples bias models toward the specific.
- This explains the FRISCO_LOCK Part B finding that `getOfferHistory` looks "coherent" for Melody — because the AI is reasoning consistently about Frisco regardless of who's actually driving.

**Severity rationale: P0 not P1**: the prompt is sent on every offer-analysis call (Siri shortcut user path). Each call is one inference. The damage is per-call, not per-cache.

### 2.2 SMOKING GUN: `tactical-planner.js:187, 281` (VENUE_SCORER prompt)

**File**: `server/lib/strategy/tactical-planner.js`
**Lines**: 187, 281 (within the system prompt + user prompt construction for VENUE_SCORER)

```
Line 187 (system prompt):
"  Frisco driver: The Star in Frisco, Legacy West in Plano, Grandscape in The Colony,"
"  Stonebriar Centre. The WRONG answer: AAC, Dickies Arena, Fair Park — these are"

Line 281 (user prompt):
"- Closest high-impact venues WIN. Think The Star in Frisco, Legacy West in Plano,"
"  Grandscape in The Colony, Stonebriar Centre — venues that are genuinely near the"
"  driver AND will see event-driven surge. NOT AAC or Dickies Arena 30-40 mi away."
```

**Severity**: **CRITICAL** (slightly less than 2.1 because it's an example pair — "right vs wrong" — rather than a hard rule).

**Why critical**:
- Both sites are inside `tactical-planner.js`'s prompt strings sent to the venue planner LLM.
- The "Frisco driver: The Star, Legacy West, Grandscape, Stonebriar" example is presented as the canonical RIGHT answer.
- The "AAC, Dickies, Fair Park" example is presented as the canonical WRONG answer.
- **The model has no signal that these examples are illustrative for one driver in one market.** A driver in Houston gets the same prompt — reads "The Star in Frisco" as the right shape of answer — and outputs Houston venues styled like Frisco mall + entertainment district + sports stadium. This biases venue type selection toward the Frisco template.
- The user prompt does include `${snapshot?.formatted_address || snapshot?.city}, ${snapshot?.state}` and `GPS: ${snapshot?.lat}, ${snapshot?.lng}` so the model knows the actual location — but examples wield more behavioural weight in LLM outputs than abstract instructions.

**Why these examples are in the prompt**: presumably to teach the model the 15-mile rule via concrete contrast (close venue ✓ vs far event arena ✗). The intent is good; the implementation leaks.

### 2.3 No other P0-prompt sites

No other prompt-string source files contain Frisco/DFW-specific concrete examples. Specifically:
- `consolidator.js` — checked, only references `Frisco ISD` in a code COMMENT example (line 409). The actual prompts use placeholders.
- `briefing-service.js` — references in COMMENTS only (lines 107, 1422). Actual Gemini prompts use `${city}`, `${state}`, `${market}` template substitution.
- `enhanced-smart-blocks.js` — references in JSdoc COMMENTS (lines 120, 134). Not in any prompt body.
- `filter-for-planner.js` — comment only (line 185).
- `serper-api.js:21` — JSdoc example only.

## 3. P0-default — fallback when location data missing

### 3.1 `server/api/health/diagnostics.js:703`

```js
const { city = 'Frisco', state = 'TX' } = req.query;
```

**Severity**: **LOW.**
- Diagnostics endpoint, not in production user path.
- Default applies only when query string omits `city` and `state` — a developer test convenience.
- Not invoked by Siri, snapshot creation, briefing generation, or strategy.

**Action**: leave as-is, or convert to required params for cleanliness. Not on critical path.

### 3.2 No other P0-default sites in production code

Specifically:
- `snapshot.js` POST creation does NOT default to Frisco coords; it requires lat/lng from the client and resolves city via `coords_cache`.
- `location.js` does NOT default to Frisco for any geocode failure.
- `briefing-service.js getMarketForLocation()` returns NULL on miss (per FRISCO_LOCK Part D). NULL → `[unknown-market]` placeholder in Gemini prompts. **No silent Frisco fallback** (this was confirmed clean in the prior recon).

## 4. P1-cachekey — none found

No cache key constructions incorporate "Frisco" or "Dallas" as a literal. Cache keys use:
- `coord_key` (6-decimal lat_lng tuples)
- `snapshot_id` (UUID)
- `(market_slug, date, hour_bucket)` — proposed but not yet implemented per FRISCO_LOCK Part E

**Conclusion**: cache layer is geographically agnostic.

## 5. P2-comment — top 10 worst offenders

These do NOT affect runtime behavior, but they reinforce the doctrine drift that "the app is for Frisco" in maintainer's mental model:

| File | Line | Snippet |
|------|------|---------|
| `server/lib/strategy/README.md` | 133 | `LLM prompt: "LOCATION: 1753 Saddle Tree Rd, Frisco, TX"` |
| `server/lib/venue/README.md` | 142–143 | `"Frisco, TX, USA"`, `"Theatre, Frisco, TX"` as bad-data examples |
| `server/lib/briefing/README.md` | 118 | `"Dallas-Fort Worth" instead of just the driver's city (e.g., "Frisco")` |
| `server/lib/traffic/README.md` | 40 | `city: 'Frisco',` (sample API call in JSdoc) |
| `server/api/intelligence/README.md` | 94, 101, 102, 110, 121 | All routes documented with `Frisco` query examples |
| `server/lib/venue/SMART_BLOCKS_EVENT_ALIGNMENT_PLAN.md` | 75, 138, 314 | `Arlington, Fort Worth, Frisco, Irving` as canonical metro examples |
| `server/lib/venue/enhanced-smart-blocks.js` | 120, 134 | `Arlington/Frisco events`, `The Star in Frisco, Legacy West` (JSdoc only) |
| `server/lib/venue/venue-cache.js` | 116, 585 | `'Dallas' venues aren't found when searching from 'Frisco'` (comment) |
| `server/lib/venue/venue-address-validator.js` | 6, 7, 52, 98, 109, 127 | All comments use Frisco/Dallas as bad-address examples |
| `server/api/location/location.js` | 1031, 1083 | `User moving from Frisco to Dallas`, `e.g., "Dallas-Fort Worth" not just "Frisco"` |

**Action**: refactor over time during normal doc passes. Not critical.

## 6. P2-fixture — seed scripts producing prod data

These wrote Frisco/DFW-heavy data into the DB. They explain the FRISCO_LOCK Part A finding that `venue_catalog`, `discovered_events`, `zone_intelligence` are heavily DFW-loaded.

| File | Effect |
|------|--------|
| `server/db/002_seed_dfw.sql` | Seeds `venue_catalog` with 30+ DFW venues (Stonebriar, The Star, Legacy West) |
| `server/scripts/seed-dfw-venues.js` | Programmatic equivalent of above |
| `server/scripts/seed-market-cities.js:748` | `['Texas', 'Dallas', 'Frisco', 'Satellite', 'uber.com']` |
| `server/scripts/seed-uber-cities.js` | Uber city catalogue (global, but Frisco is in there) |
| `migrations/20260416_venue_capacity_seed.sql` | 7 Frisco mentions for capacity assignments to DFW venues |

**Action**: these scripts are correct (they seeded what was needed at the time). The fix is **operational coverage expansion** (FRISCO_LOCK Smallest Change #6) — add similar seed scripts for Houston, Austin, LA, NYC, etc. Out of scope for this audit.

## 7. P3-test + P4-doc — leave as-is

| Type | Examples |
|------|----------|
| P3-test | `tests/SmartBlockEvents.test.tsx`, `tests/blocksApi.test.js`, `tests/triad/test-pipeline.js`, `tests/BriefingEventsFetch.test.tsx` — all use Frisco coords (33.128, -96.875) as test fixtures. Acceptable. |
| P4-doc | `docs/architecture/MAP.md`, `docs/architecture/SNAPSHOT.md`, `docs/architecture/GLOBALHEADER.md`, `LEXICON.md`, etc. — Frisco mentioned in narrative. OK. |

## 8. Proposed placeholder doctrine

For future fix phases (out of scope for this RECON), here is the recommended doctrine for replacing concrete places in P0-prompt sites:

| Anchor type | Placeholder convention | Substitution source |
|-------------|------------------------|---------------------|
| Driver's home metro | `[METRO]` or `<driver_metro>` | `snapshot.market` or `driver_profiles.market` |
| Driver's home city | `[HOME_CITY]` or `<driver_city>` | `driver_profiles.city` |
| Driver's home state | `[HOME_STATE]` or `<driver_state>` | `driver_profiles.state` |
| Specific high-value venue example | `<nearby_venue_1>`, `<nearby_venue_2>` | Top 2 from `venue_catalog WHERE market_slug = $market` |
| Major airport in metro | `<primary_airport>` | Resolved per-market |
| Mall / shopping district example | `<mall_example>` | Resolved per-market |
| Stadium / event arena example | `<stadium_example>` | Resolved per-market |
| "Avoid" zones (rural, deadhead) | `<deadhead_zones>` | Per-market zone resolution |

**Substitution time**: at prompt-build time inside the route handler, NOT at module load. The PHASE2_SYSTEM_PROMPT must become a function `buildPhase2SystemPrompt(driver_profile, snapshot)` that returns the substituted string per-call.

### 8.1 Files that would need edits in a future fix phase (DO NOT EDIT NOW — recon only)

| Severity | File | Change |
|----------|------|--------|
| **P0** | `server/api/hooks/analyze-offer.js:128–169` | Convert `PHASE2_SYSTEM_PROMPT` const to `buildPhase2SystemPrompt(driver, snapshot)` function. Substitute `[HOME_CITY]`, `[HOME_STATE]`, `<deadhead_zones>` per call. |
| **P0** | `server/lib/strategy/tactical-planner.js:170–290` (system + user prompt) | Replace literal "Frisco driver: The Star, Legacy West, Grandscape, Stonebriar" with templated `<nearby_venue_1>` … `<nearby_venue_4>` resolved from `venue_catalog WHERE market_slug = $market` at prompt-build time. |
| **P1** | `server/api/health/diagnostics.js:703` | Remove the `'Frisco', 'TX'` defaults — require explicit query params. (Optional cleanliness.) |
| **P2** | All `server/lib/**/README.md` | Replace `'Frisco'` examples with `<example_city>` placeholders. |
| **P2** | `server/api/intelligence/README.md` | Replace Frisco query examples with `<city>=<your-city>` style examples. |

**Estimated work**: ~3 days for a careful pass with prompt regression testing. The conversion of `PHASE2_SYSTEM_PROMPT` alone is < 100 lines of code change but requires evals against existing offer history to confirm decision rules don't drift.

## 9. H3 confidence — prompt anchoring as Frisco-lock contributor

**H3 confidence: HIGH (~75%).**

**Evidence FOR**:
- Two confirmed P0-prompt sites that hardcode Frisco context unconditionally (analyze-offer + tactical-planner).
- LLM literature is consistent on this: concrete examples in prompts wield disproportionate influence over abstract rules ("show, don't tell" effect).
- `analyze-offer.js:128`'s rule 8 is a **hard reject rule** anchored to Frisco geography — directly affects every offer decision for non-Frisco drivers.
- The FRISCO_LOCK Part G finding that `getOfferHistory` looks coherent for Melody is partly explained by this: the AI is reasoning about Frisco so output IS coherent — just wrong if applied to non-Frisco drivers.

**Evidence AGAINST**:
- The user prompt at `tactical-planner.js:248–250` does include actual driver location:
  ```js
  "DRIVER CURRENT LOCATION:",
  `${snapshot?.formatted_address || ...}`,
  `GPS: ${snapshot?.lat}, ${snapshot?.lng}`,
  ```
  So the model has accurate location data alongside the Frisco examples.
- Distance rules are enforced numerically ("HARD DISTANCE RULE: ALL venue recommendations MUST be within 15 miles of the driver's GPS coordinates") — these are stronger than geographic name examples.
- **Net**: examples bias venue *type* (mall + entertainment + sports + dining), not necessarily location. A Houston driver may still get Houston venues but in a Frisco-template style.

**Why "75% not 95%"**: H3 is a **contributor** to Frisco-lock, not the sole cause. It compounds with:
- Bug A (NOTIFY-loss in reconnect window) — confirmed
- Bug B (`_coverageEmpty` not honored client-side) — confirmed
- Topology multiplier (multi-instance NOTIFY race) — likely
- Seed coverage gap (FRISCO_LOCK Part A) — confirmed

H3 is the **deepest** of these in that it would persist even if all the others were fixed. A driver in Houston with a healthy SSE stream and a populated briefing would still get Frisco-flavored offer decisions until `analyze-offer.js:128` is templatized.

## 10. Combined H1 / H2 / H3 ranking — updated

Combining findings from all three audits:

| Hypothesis | Description | Frisco-lock contribution | Fix complexity | Recommended priority |
|------------|-------------|--------------------------|----------------|----------------------|
| **H1** | Bug A (NOTIFY-loss in reconnect window) + Bug B (`_coverageEmpty` not honored client-side) — see `NOTIFY_LOSS_RECON_2026-04-18.md` | ~50% — produces the *visible permanent spinner* symptom for snapshot ef36f6c6 | F1 (4-line client patch) = trivial; F2 (SSE handshake) = moderate | **Ship F1 first.** Single highest-impact, lowest-risk change. Alone clears the spinner symptom without depending on H2/H3 fixes. |
| **H2** | Neon + Autoscale topology — multi-instance NOTIFY gap, lazy-LISTEN race, 3-replica fan-out — see `NEON_AUTOSCALE_TOPOLOGY_2026-04-18.md` | ~25% — multiplier on H1; explains worse symptom severity in prod vs dev | Medium (LISTEN URL guard, optional `min_instances=1`, doctrine doc updates) | **Ship after H1.** F2 (SSE initial-state handshake) from H1 also makes most of H2 harmless. Defensive `min_instances=1` is operational, not code. |
| **H3** | Prompt anchoring (analyze-offer.js + tactical-planner.js hardcode Frisco) — see this audit | ~25% — independent contributor; produces wrong offer decisions for non-Frisco drivers regardless of NOTIFY/SSE health | Medium (~3 days with prompt regression eval) | **Ship after H1+H2.** Required for true multi-market correctness. Without this, even a perfectly-delivered briefing for a Houston driver gets analyzed by a Frisco-anchored offer model. |

**Combined fix-priority recommendation**:

1. **First — F1 from NOTIFY-loss recon** (4-line client patch to honor `_coverageEmpty`). Clears the permanent-spinner symptom in one commit, no SSE/topology changes required. Pairs with already-shipped Phase 0a server-side commit `e7034939`.
2. **Second — F2 from NOTIFY-loss recon** (SSE initial-state handshake). Makes both H1's reconnect race AND H2's multi-instance lazy-LISTEN race harmless via "the next handshake is authoritative" architecture.
3. **Third — Doctrine doc fixes** (CLAUDE.md Rule 13, DATABASE_ENVIRONMENTS.md, connection-manager.js comment) to stop the misinformation that prod is Helium. Cheap, no behavioural change, but eliminates confusion in future debugging.
4. **Fourth — Templatize the two P0-prompt sites** (analyze-offer.js, tactical-planner.js). Required for non-Frisco drivers to get correct offer decisions. Higher risk because prompt changes need eval; should be batched with regression testing.
5. **Fifth — Operational seed coverage expansion** (FRISCO_LOCK Smallest Change #6) for non-DFW markets. Operational, not code.

**Pieces explicitly NOT recommended in this fix sequence**:
- F3 (dispatcher catch-up replay) — F2 makes this redundant.
- F4 (triad-worker handler migration) — dormant in prod (autoscale guardrail), can defer.
- F5 (client EventSource auto-reconnect) — general robustness improvement; not on critical path.

## 11. Open questions for Melody

| # | Question |
|---|----------|
| QG-1 | Does the F4 prompt template (templatize PHASE2_SYSTEM_PROMPT and tactical-planner) need a prompt-eval rig before shipping? If yes, what's the eval set? |
| QG-2 | The 75% H3 confidence assumes prompt examples bias outputs more than instructions. Want to A/B test with a real non-Frisco driver before fully shipping the templatization? |
| QG-3 | The seed-coverage expansion (P2-fixture follow-up) — is there a target metro list, or will it be demand-driven (seed when a real driver shows up)? |
| QG-4 | The `analyze-offer.js:128` rule 8 ("Reject rides west of DFW Airport, Fort Worth, Denton outskirts, Anna, rural areas") is geography-specific. The replacement should not just be `<deadhead_zones>` placeholder; it needs per-market deadhead-zone data. Where would that come from — `market_intelligence.zones`? `zone_intelligence`? New table? |
| QG-5 | Should the LandingPage.tsx (`client/src/pages/landing/LandingPage.tsx:498, 540, 582, 662`) keep "Frisco, TX" / "Sidecar Social Frisco" as marketing copy, or generalize? Affects positioning, not behaviour. |

## 12. Constraints honored

- No code edits, no commits, no pushes, no DB writes, no migrations, no server restarts, no republish.
- **Phase 0a commit `e7034939` untouched** — no rebase, amend, or push.
- Dev-only filesystem reads. Prod DB never touched. Dev DB never queried.
- `DECISIONS.md` not modified.
- All findings reported as text; no source files modified.

## Memory Index

| # | Section | Title |
|---|---------|-------|
| GA1 | §2 | P0-prompt smoking gun: analyze-offer.js:128 PHASE2_SYSTEM_PROMPT hardcodes Frisco home base |
| GA2 | §2 | P0-prompt: tactical-planner.js:187, 281 — VENUE_SCORER prompt examples anchored to DFW venues |
| GA3 | §3 | P0-default: only 1 site (diagnostics.js:703); not on critical path |
| GA4 | §4 | P1-cachekey: 0 sites — cache layer geographically agnostic |
| GA5 | §6 | P2-fixture: 5 seed scripts wrote DFW-heavy DB content (operational, not code) |
| GA6 | §8 | Proposed placeholder doctrine: `[METRO]`, `<driver_city>`, `<nearby_venue_N>` resolved per-call |
| GA7 | §9 | H3 confidence: HIGH (~75%) — prompt anchoring is a real contributor; compounds with H1/H2 |
| GA8 | §10 | Combined H1/H2/H3 ranking — F1 first, F2 second, doctrine docs third, templatize fourth, seed coverage fifth |
