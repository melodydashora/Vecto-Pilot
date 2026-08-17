# OFFER_ANALYZER_ROADMAP.md — The Offer Analyzer, the plan going forward

> **What this is:** the single forward-looking document for the Offer Analyzer. What is
> *built* lives in `OFFER_ANALYZER.md`; what is *next*, *deferred*, or *undecided* lives
> here. When an item ships, it moves to `OFFER_ANALYZER.md` (+ its change log) and is
> struck from here — this doc should shrink.
>
> **Created:** 2026-08-17 (merges the forward-looking sections of the retired
> `OFFER_ANALYZER_EDITOR_PLAN.md` §7–§9 and `OFFER_RULESET_V3_DESIGN.md` §10 with the open
> gates recorded in `todo` #43 / #10 and `claude_memory` #354, #365, #371, #372).
> **Provenance:** Claude-authored synthesis; every Melody statement is quoted and marked;
> Claude recommendations are marked as such. The `todo` table remains the actionable
> queue — this doc is the narrative + design record behind those rows.
> **Companions:** `OFFER_ANALYZER.md`, `SIRI_SHORTCUT_ANALYZE.md`, `ANDROID_SHORTCUT_ANALYZE.md`,
> `docs/OFFER_ANALYZER_DRIVER_RULESET.md` (Melody's verbatim spec).

---

## 0 · Where we are (2026-08-17)

Melody's phase statement (2026-08-11, verbatim intent, memory #366): *"solidify everything
we do have, make it look really good, get it out there, get it selling."* Priorities in
order: security (done), a good/safe Coach, **a working Offer Analyzer**. New features
queue behind that.

Offer Analyzer status against that bar:

| Area | State |
|---|---|
| Server pipeline (v3 engine, per-driver rules, token bridge, fast lane, downscale, Phase-2 dataset) | **Built, published** (`97cd2d3b` includes the <3s sprint `cd8329da`) |
| Latency target "<3 seconds" (Melody, 2026-08-14) | **Met with margin on the real endpoint (2026-08-17, `gemini-3.5-flash-lite`)**: text REJECT 1 ms; text ACCEPT 577–700 ms; vision 630–860 ms (was ~1.9 s / ~1.8 s on 3.5-flash). **On-device p95 with real screenshots not yet confirmed** |
| Accuracy | Melody validated live 2026-08-14: *"ours is perfect"* vs Apple device vision on her real offers (todo #43) |
| iPhone shortcuts | Canonical two-shortcut spec written (`SIRI_SHORTCUT_ANALYZE.md`); Melody's live shortcut was the older 9-action "Analyze 2" (text-only, no image field). **New shortcuts not yet built/shared** |
| Android | Plan only (`ANDROID_SHORTCUT_ANALYZE.md`); nothing tested on a device |
| Web page | Built (July). SetupCard content is the July build (old iCloud link, `lattitude` fix, Location permission) — **drifted** from the 2026-08-14 spec |
| Rules editor UX | Typed forms + ladders. Melody direction (2026-08-14): **sliders-only** — not started |

---

## 1 · Immediate gates (blocking "a working Offer Analyzer")

**G1 — Device re-test (Melody) — now also the acceptance gate for the model switch.**
The 2026-08-17 bench (see `OFFER_ANALYZER.md` §16) moved Phase 1 to `gemini-3.5-flash-lite`
on **synthetic** cards; real Uber screenshots (small fonts, dense UI, map noise) are the
remaining unknown. Verify on the iPhone against prod once published: (a) verdicts match
your rules on real cards (both lanes); (b) latency per lane; (c) `voice` speaks and
`notification` shows; (d) a non-offer screenshot says "No data. Decide manually."
Protocol: log the response's `response_time_ms` next to the felt tap-to-speech time —
the delta is phone overhead (OCR, radio wake, TTS), invisible to the server bench (cowork,
2026-08-17). Token gotcha: a token minted on the dev page does not resolve on prod (dev ≠
prod DB) → default rules + unstored rows, silently; use the token from the deployment the
shortcut points at. Revert = set `OFFER_ANALYZER_MODEL=gemini-3.5-flash` (env) or the registry default. Note:
the prod Replit Secret `OFFER_ANALYZER_MODEL`, if set, overrides the registry — align or
remove it at publish. *(memory #372 open (a); todo #43)*

**G2 — Build + share the two canonical iPhone shortcuts (Melody), then refresh SetupCard (Claude).**
Follow `SIRI_SHORTCUT_ANALYZE.md` exactly (token in Headers, `source` = `siri_text` /
`siri_vision`, image as a **File** field, no location action). Share the iCloud links →
`SetupCard.tsx` gets both links, drops the "lattitude" edit and the Location-permission
line, and adds an Android tab. **UI edit deferred by Melody's direction this session
("we don't need to edit the UI code just yet").** *(old plan §7 Phase 6 "Setup cards content")*

**G3 — Android interim build + device test (Melody + Claude).**
Per `ANDROID_SHORTCUT_ANALYZE.md` (tool capabilities verified against vendor docs
2026-08-17, nothing device-tested yet): HTTP Shortcuts (free, true multipart, built-in TTS)
as the default via the screenshot share sheet; Tasker for one-tap fully hands-free
(paid, ADB grant); MacroDroid text-lane only. Same endpoint, header, and fields as iPhone.
Small server follow-ups surfaced by the research (optional): a raw `image/jpeg` body mode
would let MacroDroid do vision; publish a hosted HTTP Shortcuts import zip
(`https://http-shortcuts.rmy.ch/import?url=…`) for one-tap setup. *(todo #43 Android plan)*

**G4 — Commit/publish discipline.** All analyzer work is on `main` as of `97cd2d3b`;
branch `todo10-offer-rules-editor` is merged. Publish is Melody's word.

---

## 2 · Next engineering levers (designed, not built)

### L1 — Deterministic ACCEPT lane (latency tail) — now optional polish
*Claude design (memory #372), pending joint sign-off. After the 2026-08-17 model switch the
model ACCEPT lane runs ~0.6–0.9 s on the real endpoint, so this is no longer needed for
the <3 s target; it remains the path to a fully deterministic text lane.* Today engine ACCEPTs go to the model
because the model owns the judgment rules (avoid zones, safety road types, stops/round
trip, `require_verified`, rating). To answer ACCEPTs deterministically the text lane needs:
address regexes for pickup/dropoff → **synchronous** geocode (place_id, 6-dec) →
`evaluateGeoRules` (geometry beats name-vibes — aligns with the place_id doctrine); a
rating regex and a "Verified" regex in `parseOfferText`; explicit handling for
`safety_road_types` / multiple stops / round trip (text usually can't see these → either
treat as "not evaluable → still model" or accept the residual risk by driver switch).
Gate must stay parity-safe: an ACCEPT may only be spoken deterministically when **every**
enabled judgment rule is evaluable from text.

### L2 — Rules editor: sliders-only — **SHIPPED 2026-08-17 (D4)**
Rate Targets is now four sliders per tier (floor $/mi · $/min · max trip minutes · max
total miles) + a "$/hr in results" switch (telemetry). The accept ladder is derived as one
rung; per-tier `max_total_miles` added to the engine; the vision path re-runs the numeric
rules on the model's extracted numbers (arbitration). Still open from the Phase-B doctrine
below: drought-fallback slider, budge sliders, AR punchcard, filter-trip rule.

#### Original Phase-B doctrine (memory #365, todo #43 (2))
Melody (2026-08-14): *"we only need the sliders for the input."* Doctrine captured
2026-08-11 for Phase B:
- **hourly rate is computed telemetry, not a control** (goal band $30–45/hr shown, never a decider — the Siri-vs-ours A/B locked this: identical vision, opposite verdicts, hourly extrapolation was the wrong criterion);
- **sliders only, no visible ladders**; minutes slider = trip-duration cap;
- **drought-fallback slider**: no offer in N minutes → relax floors toward the goal band, fewest miles;
- **budge sliders**: the vision model may spend a stated flex with a stated reason;
- **AR punchcard opt-in**: rolling 3-of-10 decline budget (acceptance-rate protection as a budget, not a floor);
- **filter-trip rule**: ≤3 mi off-path is OK even when cheap (the On-the-way filter case);
- vehicle-cost budgeting **parked**.
Server implication (Claude): sliders must *derive* the v3 ladder (or a v4 schema) so the
engine stays one source; either keep `DEFAULT_RULESET` byte-pinned or re-baseline the
parity test consciously in the same change. UI work is deferred (see G2 note).

### L3 — SetupCard content refresh
Two shortcut links; permissions text without Location; remove the `lattitude` and
"add image field" one-time edits (obsolete once the canonical shortcuts exist); Android
tab pointing at `ANDROID_SHORTCUT_ANALYZE.md` steps. Depends on G2 links.

### L4 — Non-offer screenshot voice line + REJECT-by-default — **DONE 2026-08-17**
The honest-floor guard in `analyze-offer.js` routes a parsed reply with no `decision`, or
with all-zero metrics, to the deterministic engine (→ NO DATA on vision). Verified live:
non-offer screenshot → "No data. Decide manually." Also shipped: `parse-model-json.js`
repair tier (3.5-flash's missing-closing-brace replies no longer fall back).

### L5 — Storage of coordinate-less offers (decision needed)
The canonical shortcuts send no GPS. Phase 2 resolves timezone from GPS → else the tokened
driver's current snapshot row → else **the row is not stored** (`app_rules.timezone-gps-only`,
`no-fallbacks`). Consequences today: an **untokened** request with no coordinates is
answered but never stored; a **tokened** driver is stored only while they have a current
app snapshot. **Prod evidence (Melody, 2026-08-17): her tokened offers are stored and
showing correctly on the Offer Analyzer page** — so the tokened path works as designed;
the gap is only untokened + no-GPS requests. Options: (a) accept as-is and say so in the
guides ("open the app once per shift so your offers are recorded"); (b) require the token
for storage explicitly (the token *is* the product); (c) have the shortcut send coordinates
again (rejected 2026-08-14 for latency). **Recommendation (Claude): (a) now, revisit under
the native shell.**

### L6 — Declared-but-unconsumed ruleset keys
`home` (`{deadhead_only, mention_threshold_min}`) and `geo` scope overrides
(`home_city/other_city/airport`) exist in `DEFAULT_RULESET`, pass Zod, and are migrated —
but no evaluator/prompt consumes `home`, and no caller passes a `context.scope` to
`resolveScopedRuleset`. No card edits them today (good — "the UI must never edit a knob
nothing consumes"). Decide: wire (home = deadhead estimation per spec Home Logic; scope =
per-area overrides) or remove from the schema in a versioned migration.

### L7 — Spec output format not implemented as spec'd
Melody's spec asks for a 4-line output (decision + totals, $/min, a **Status** line
[Meets Primary Tier / Acceptable via ARP / Fails Baseline / Safety Override], a natural
reason) plus a required-notifications list and an **Analysis Source** line. The wire
contract today is `decision` + terse `reason` + `notices` (`voice`/`notification`).
Additive option: `status`, `per_minute`, `analysis_source` keys on the response, and a
longer optional `voice_long`. Decision: Melody (does the 3-second window want more speech?).

### L8 — Engine / adapter / hygiene polish (verified 2026-08-17, none blocking)
- ~~503 retry floating alias~~ **DONE 2026-08-17** — pinned (`gemini-3.1-pro-preview` /
  `gemini-3.5-flash`).
- ~~Temperature 0.1 not honored~~ **DONE 2026-08-17** — `min(configured, 0.2)` on JSON prompts.
- `features:['vision']` is documentary only (no adapter reads it) — now labeled as such in
  the registry; make it enforced only if a non-vision env override ever bites.
- `min_floor` reason kind (`"… min"`) has no spoken qualifier in `buildVoiceLine`.
- `deadhead_reduction` notice is undetectable on the text lane (map visual) — expected.
- ~~`tests/integration/test-ocr-hook.js` stale~~ **DONE 2026-08-17** — replaced by
  `scripts/offer-analyzer-smoke.mjs` (text + vision against any BASE/TOKEN).
- Stale comments (comment-hygiene, todo #36 — ride along with the next code touch):
  `model-registry.js:336-349` still narrates HIGH thinking + old `analyze-offer.js` line
  anchors; `gemini-adapter.js:71` thinking-level list omits `minimal`;
  `getRolesByTable()` has no OFFER group; `tests/offers/rules-engine-parity.test.js:7,144`
  cite pre-extraction line numbers.
- Drizzle-vs-DB: `offer_outcomes.driver_decision` CHECK and `idx_dp_shortcut_token` live
  only in the SQL migration (fine while migrations are the source of truth; declare in
  `shared/schema.js` if drizzle-kit push is ever revived — todo #364 context).
- Client inventory (no UI edits this pass): `ENABLE_SEEDS.auto_reject/notices` exported but
  unused; `OffersCard` declares `total_minutes/platform/driver_reasoning` it never renders
  and omits `analyzer_rejected/disagreements` the server returns; SetupCard link id
  (`cce34c…`) ≠ the 2026-08-14 decoded shortcut (`6d89f1…`); "Location (While Using)"
  and "Hey Siri, Analyze 2" wording predate the canonical spec.

### L9 — Phase-2 verdict never reaches the driver
Long-standing (since 2026-02). The deep model's dissent is stored, and the web page shows
the row, but nothing pushes back to the phone. Realistic path: the native shell (§3) or
a Shortcut that polls `/api/hooks/offer-history` after N seconds. Low priority while the
Phase-1 verdict is validated as correct.

### L10 — Learning loop items (from the retired plan §8)
- User-override / outcome disagreement → candidate rule tuning (nothing consumes
  `user_override` or `offer_outcomes` yet beyond stats).
- OfferMap (decision-colored pins, outcome overlay) — deferred until geocoded Phase-2
  rows accumulate under real tokens; the `pickup_lat/lng`, `dropoff_lat/lng`, `h3_index`
  columns are the substrate.
- Strategy/venue scoring does not consume `offer_intelligence` (out of scope for the
  analyzer; belongs to the strategy pipeline).
- Coach: dormant offer-tag executors in `chat.js` — delete or keep (todo #38).

### L11 — Phase-2 durability (no worker, no queue)
Melody's mental model (2026-08-17): quick JSON to the phone, then "a worker cleans it up
and lands it in the large table." Reality: it is the **same request continuing in-process**
— `res.json()` at `analyze-offer.js:497`, then a fire-and-forget async block (`:522`) runs
the deep model, INSERTs `offer_intelligence`, `pg_notify`s, geocodes. There is no retry:
if the instance dies (or Cloud Run throttles CPU after the response — memory #28 pattern)
mid-Phase-2, that row is lost. Prod is completing today (Melody: tokened offers show
correctly on the page). The durable version is her picture — a queued job (e.g. the
background worker or a `pg` job table) that owns Phase 2 and can retry. Not urgent while
the in-process path is observed working; revisit if rows go missing or under autoscale.

---

## 3 · Endgame — native shell (todo #37)

Android allows what iOS forbids: a share-target intent for screenshots, MediaProjection
capture, a foreground service — so the analyzer becomes one tap or fully automatic with no
third-party app. iOS: App Intents / a native shortcut donor, and background voice for the
Coach. Until then the third-party automation tools in `ANDROID_SHORTCUT_ANALYZE.md` are the
Android path and Apple Shortcuts the iPhone path.

---

## 4 · Decisions — answered by Melody 2026-08-17

Melody (verbatim): *"D1 through D7 I agree with the default with a wish for D4. I'd really just
like the sliders they are nice and preset model sliders so end users don't type in bad data."*
→ D1–D7 = the defaults below; **D4 = derive sliders into v3, and sliders-only is a real
wish, not a maybe** (preset slider ranges so drivers never type bad data — L2). Also
2026-08-17: keep the `app_rules` pointer row in `CLAUDE.md` §4; keep L11.

| # | Decision | Default (now adopted) |
|---|---|---|
| D1 | L5 storage policy for coordinate-less offers | (a) accept + document |
| D2 | L6 wire or remove `home` / `geo` scope keys | leave inert; no UI |
| D3 | L7 add `status` / `analysis_source` to the response | keep terse contract |
| D4 | Sliders-only editor (L2) — schema v4 or slider→ladder derivation | derive into v3 (keeps parity pins) |
| D5 | Android tool to standardize on for the guide (HTTP Shortcuts vs Tasker) | HTTP Shortcuts (free, open source) primary |
| D6 | Whether the fast ACCEPT lane (L1) may skip non-text-evaluable judgment rules by driver switch | no — model lane keeps ACCEPTs until evaluable |
| D7 | The Coach splices the **entire** `OFFER_ANALYZER.md` (~56 KB) + `model-registry.js` (~37 KB) into every Coach system prompt (`chat.js:33-59, 1282-1312`) — ~23k tokens/turn of read-only rules. Splice only the rules sections (§3–§9) or a generated digest? | keep as-is (Coach cost-is-the-feature, todo #33) but decide consciously |

---

## 4b · Things on Melody's end (she asked to be told — "fix me first")

| # | Item | Why it matters |
|---|---|---|
| M1 | Prod Replit Secret `OFFER_ANALYZER_MODEL` — set to `gemini-3.5-flash-lite` or remove it | An env pin overrides the registry default; otherwise prod stays on 3.5-flash |
| M2 | Rebuild the iPhone shortcuts per `SIRI_SHORTCUT_ANALYZE.md` under their real names (**Analyze Offer Text** / **Analyze Offer Vision**), with `source` = `siri_text` / `siri_vision` and the token in Headers; then share the two iCloud links | The live shortcut was still the test-named "Analyze 2" (text-only, `lattitude` in body); the SetupCard refresh (L3) needs the links |
| M3 | Open the Rate Targets card once and set the four sliders per tier (first slider touch collapses the legacy 5-rung ladder to one rule) | Your saved config still carries the July ladder + floor $1.35 |
| M4 | Field-test with real Uber screenshots (both lanes) — the model switch was benchmarked on synthetic cards | Acceptance gate G1; revert = `OFFER_ANALYZER_MODEL=gemini-3.5-flash` |
| M5 | Android device test per `ANDROID_SHORTCUT_ANALYZE.md` (HTTP Shortcuts) | G3 |

## 5 · Cross-references

- `todo` #43 (shortcuts + <3s + sliders), #10 (in_progress: editor; docs item now done),
  #37 (native shell), #38 (dormant executors), #19 (test debt).
- `claude_memory` #354 (v3 build), #365 (Phase A scoping + Phase B sliders doctrine),
  #371 (shortcut decode + alias layer), #372 (<3s sprint), #366 (phase/priorities).
- `docs/architecture/removals/2026-08-14-offer-analyzer-thinking-stepdown.md`,
  `…/2026-08-14-lattitude-alias-generalized.md`, `…/2026-08-11-per-user-scoping.md`.
- `lessons_learned` #9 (honest `ai_model` telemetry), #11 (TRUNCATE vs FK), #18
  (truncation invisible at adapter boundary), #23 (prod migrations), #25 (unscoped reads).
