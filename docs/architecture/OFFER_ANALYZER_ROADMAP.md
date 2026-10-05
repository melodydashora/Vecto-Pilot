# Offer Analyzer — remaining work and decision history

Use **Offer Analyzer** for the feature and **offers** for the proposals and records
it analyzes and tracks; see the [canonical lexicon](../../LEXICON.md).

> Reviewed against source on 2026-09-29. This is the forward plan, not a deployment
> receipt. Current behavior is in [OFFER_ANALYZER.md](OFFER_ANALYZER.md).
> Prior task/memory IDs below are historical pointers, not a fresh continuity read.
> Replaced prose is preserved through [the dated removal record](removals/2026-09-29-offer-analyzer-doc-reconciliation.md).

## 0 · Current scope

Melody’s current direction is to fix the Offer Analyzer’s root causes and reconcile its source
and documentation before deciding the next MAIN integration. Minimize unnecessary setup
controls: the user’s selected services should determine relevant offer-rule controls,
and keeping saved preferences must remain a valid path.

Current source contains the rules editor, multiple ingestion transports, Phase-1 speech,
Phase-2 enrichment, owner-scoped history, revisioned driver outcomes, longitudinal Coach
patterns and browser quick capture. Repository presence does not establish deployment,
phone usability or live-data completion.

The earlier 2026-08-11 priority statement remains relevant: “solidify everything we do
have, make it look really good, get it out there, get it selling.” The stated order was
security, a good/safe Coach and a working Offer Analyzer before new features.

## 1 · Acceptance gates

**G1 — Real-device verification.** Check actual current offer cards on each supported
phone path: product/service classification, pickup and trip legs, selected rate basis,
saved-rule provenance, matching speech, stale-response rejection, non-offer/manual-decision
handling and visible history. Measure complete tap-to-speech, not just server response
time. August synthetic endpoint timings are historical, not current phone acceptance.

**G2 — iPhone automation.** The current SetupCard includes a browser Offer Analyzer capture and a
separately labeled legacy iCloud shortcut. The previously agreed text/vision shortcut
spec remains a build contract, not proof that updated shared shortcuts have been
installed or certified. Melody and Claude retain external shortcut ownership unless
Melody changes that scope. Use the deployment’s own URL/token and current guide.

**G3 — Android capture.** The downloadable HTTP Shortcuts file is a token-free browser
launcher. Import, screenshot selection, precise GPS and speech need device verification.
The August MacroDroid text workflow was field-tested on Melody’s Samsung; that historical
receipt does not certify today’s launcher or a different macro. Preserve its tested
variable-assignment/JSON/HTTP order when rebuilding automation.

**G4 — Rollout.** Verify the actual branch, migrations, provider settings and environment
before release. Selected-services/admission code depends on the existing uncommitted
`migrations/20260929_main_run_admissions.sql`; this task did not apply it or certify
the target schema. No document can establish current deployment or authorize publication.

## 2 · Remaining engineering/design items

### L1 — Deterministic ACCEPT coverage

Do not accept a ride merely because numeric gates pass while enabled judgment rules
were never evaluated. More deterministic coverage requires reliable evidence for every
applicable rule; skipping those checks is not an approved latency shortcut (D6).

### L2 — Rules editor and preference scope

Sliders derive the v3 economic rules; users need not edit raw ladders. Current selected
services filter relevant cards without deleting hidden saved settings. Preserve a clear
legacy-null/unverified state instead of inferring chosen work from eligibility.
The corrected Continue boundary accepts legacy null unchanged when existing saved rules
and otherwise complete setup are valid. Explicit empty/invalid/ineligible selections
still fail. Admission now verifies the raw saved hash separately from migration,
so valid older rules are not forced into a save merely because migration adds fields.
This does not backfill choices or claim Melody’s exact runtime error was
reproduced.

Historical Phase-B wishes remain unimplemented unless separately verified in source:
drought fallback, stated “budge” flexibility, an opt-in acceptance-rate decline budget
and a filter-trip/off-path allowance. Vehicle-cost budgeting was parked. These are
requirements to discuss, not knobs to expose before a consumer exists.

### L3 — Phone setup content and certification

Keep browser launcher instructions separate from native capture automation. Update
shared external shortcuts only within their ownership and verify the complete device
path. Do not call a browser opener an automatic screenshot shortcut.

### L4 — No-data behavior

Existing non-offer/manual-decision handling needs regression coverage as parser and
reconciliation logic changes. Implausible extraction and a missing offer are different
evidence states, even when neither can produce a reliable acceptance.

### L5 — Coordinate-less storage

Direct automation may omit GPS by the August joint decision. Storage still requires a
real timezone from request GPS, trusted pickup coordinates or suitable owner snapshot
context. Unresolvable cases are not stored. The browser’s precise-GPS requirement is a
separate entry contract, not a retroactive requirement for all existing shortcuts.

### L6 — Declared-but-unconsumed ruleset keys

`home` and `geo` scope keys remain inert, with no UI controls, by D2. Do not activate,
remove or expose them while fixing unrelated arithmetic or selected-service behavior.
Home-return estimation and per-area override semantics need an explicit future decision.

### L7 — Original spec output differences

The verbatim spec requests a four-line report, Status and Analysis Source lines, return
context and specific exceptions. The current wire contract is concise speech plus
notification/provenance. D3 retained the terse contract. More speech or additional
behavior requires a deliberate product choice, not an assumption that the old spec has
already been implemented.

### L8 — Reliability and evidence

Maintain regression coverage for multimodal arithmetic, partial OCR/model evidence,
active-time denominators, total-mile ARP, unknown products, explicit disabled services,
legacy unverified selections, personal-rule failures and original decision preservation. Existing stored rows are not retroactively
validated by these fixes: a missing `phase1_contract_version` marker means legacy
calculation provenance is unverified, not automatically wrong. Do not blindly rewrite
history or rely on current-rule hashes to reconstruct old code/config.
Cancellation can end the client’s wait/request; it cannot prove provider work or billing
stopped. Cross-instance duplicate calls can still spend twice before the storage guard.

### L9 — Later analysis is evidence, not replacement speech

Phase-2 disagreement is stored for explanation and learning. A future phone update
channel must not silently rewrite the original advice or confuse a delayed result with a
still-current offer. No such automatic replacement verdict is promised today.

### L10 — Coach and MAIN boundaries

Coach reads the owner’s recent full offer records and longitudinal patterns. Current
rules are supplied as structured owner data rather than cached architecture prose.
Rules/outcomes do not tune settings automatically.

MAIN admissions retain a configuration receipt for stale-settings fencing. Current
Strategist and VenuePlanner prompt projection is profile/vehicle only; Offer Analyzer rule
injection is withheld pending the next integration decision. Offer history is not part
of that receipt. A future geographic subset needs mode-aware interpretation: a
`heads_toward` trip condition does not ban the anchor venue.

### L11 — Phase-2 durability

Enrichment is in-process after the response, with no durable queue/restart recovery.
A process exit, post-response CPU suspension or failure can lose the eventual row.
Timeout cancellation and transient transaction retries do not solve this lifecycle.
Melody’s earlier “worker cleans it up and lands it in the large table” intent is retained;
implementing durable work ownership/retry requires a separate concrete design.

## 3 · Native shell (historical todo #37)

Native screenshot/share integration and background voice remain a future direction.
The browser launcher cannot silently capture another app. Platform-specific capability
and permission claims need current platform verification when that work is authorized.

## 4 · Decisions — answered by Melody 2026-08-17 (historical record)

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


**2026-09-29 correction:** D1 records the decision at that time; L5 describes current
source limits. D4 remains the product preference for bounded sliders. D5 records an
August tool choice, not current device certification. D7’s full-doc/registry splice was
previously authorized; Melody’s current source-based correction supersedes it with
actual current-owner config and selected services. The reason is accurate provenance
and avoiding stale prose as runtime rules, not an invented ban on Coach context cost.
D2 remains unchanged: leave `home` and scope overrides inert with no UI.

## 5 · Evidence and continuity pointers

- [Melody’s verbatim ruleset](../OFFER_ANALYZER_DRIVER_RULESET.md).
- [August incident/intake](../review-queue/PLAN_intake-2026-08-26-offer-analyzer-handoffs.md).
- [September outcome workflow](../coordination/2026-09-10-offer-workflow-handoff.md)
  and [frontend handoff](../coordination/2026-09-11-offer-faa-frontend-handoff.md).
- [Mobile source review](MOBILE_CONCIERGE_2026-09-11.md).
- Historical continuity references: todo #10/#43 (editor/shortcuts), #37 (native shell),
  #56 (race review); memories #354/#365/#366/#371/#372. Consult live records before
  describing their present status.
- [August doc consolidation](removals/2026-08-17-offer-analyzer-doc-consolidation.md)
  and [this source reconciliation](removals/2026-09-29-offer-analyzer-doc-reconciliation.md).
