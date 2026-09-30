# Offer Analyzer — current source and boundaries

> Source review: 2026-09-29, working tree based on `6e98390697dfd3d677702bc64fe206b2383f5279`.
> This describes repository code, including uncommitted changes. It is not a deployment,
> device-certification, latency, or live-database receipt. Historical material replaced
> in this reconciliation is indexed in [the removal record](removals/2026-09-29-offer-analyzer-doc-reconciliation.md).
>
> This is the single as-built reference. Remaining work and attributed decisions are in
> [the roadmap](OFFER_ANALYZER_ROADMAP.md). Phone setup: [iPhone](SIRI_SHORTCUT_ANALYZE.md)
> and [Android](ANDROID_SHORTCUT_ANALYZE.md). [Melody’s verbatim specification](../OFFER_ANALYZER_DRIVER_RULESET.md)
> preserves her original requirements; a requirement is not proof it is implemented.

## 1. Purpose and boundaries

The Analyzer reduces the arithmetic and screen-reading a driver must do during a short
ride-offer window. It reads the offer, applies the current owner’s rules and speaks a
short decision. Pickup travel is work: full-ride calculations include both pickup and
passenger legs. The driver’s home is not the pickup origin.

Keep these distinctions:

- Selected services describe work the driver chose. Vehicle eligibility describes what
  the vehicle can support. One must not be inferred from the other.
- The Analyzer decides a current offer. Coach discusses saved evidence and patterns;
  it does not issue a new live-offer verdict.
- Physical road/access safety is not a neighborhood, demographic or crime prediction.
  Do not invent safety knowledge from a place’s name.
- MAIN’s snapshot → briefing → Strategist → VenuePlanner flow is separate from the
  Analyzer’s Phase 1 → Phase 2 flow. New Analyzer-to-MAIN integration is held for a
  later decision after Analyzer corrections. Admission retains the config receipt for
  stale-settings checks; `mainDriverContext()` projects only profile/vehicle into the
  Strategist and VenuePlanner prompts. The receipt contains saved rules, not offer history.

## 2. System map

```text
Browser quick capture                    Configured phone automation
signed-in page + current screenshot      OCR text / image + shortcut token
                  \                       /
                   POST /api/hooks/analyze-offer
                   normalize input; resolve owner rules/services
                   parse + sanity checks + deterministic arithmetic
                   model judgment when required; reconcile decision
                                 |
                   Phase 1 JSON -> phone/browser speech
                                 |
                   eligible Phase 2 work continues in process
                   deep extraction -> trusted address/timezone resolution
                   owner/session-scoped insert -> NOTIFY -> SSE/history
                                 |
                   driver outcome (separate) + Coach saved evidence
```

Sources: [hook](../../server/api/hooks/analyze-offer.js),
[rules engine](../../server/lib/offers/rules-engine.js),
[rules store](../../server/lib/offers/ruleset-store.js),
[editor API](../../server/api/offer-analyzer/index.js).

## 3. Three distinct decisions (never conflate)

| Record | Meaning |
|---|---|
| `offer_intelligence.decision` | Original Analyzer decision delivered in Phase 1, including `NO DATA`. |
| `offer_intelligence.user_override` | Driver’s immediate disagreement (`ACCEPT`/`REJECT`); it does not rewrite the Analyzer’s decision. |
| `offer_outcomes` | Driver-reported actual action, optional earnings and reasoning, saved separately with revision checks. |

Phase 2 may store its own `deep_decision` and disagreement evidence. It must not replace
what the driver heard. Offered pay is not earnings; a rejected offer is not money saved.
Historical Coach-created `coach_offer_decisions` remain separate conversational
records. Their model-emitted mutation handlers are retired (§11.5); they are not a
current Coach write path or automatic changes to the ruleset.

## 4. Ingest endpoint contract — `POST /api/hooks/analyze-offer`

### 4.1 Transport

The headless hook does not require browser JWT auth. A shortcut token supplies owner
identity and personal rules. No token uses anonymous defaults with
`personal_rules_verified:false`; a supplied unknown, invalid or unreadable personal
ruleset must not silently fall back to another person’s rules or anonymous defaults.

Accepted transports are JSON or URL-encoded text/base64, multipart with file part named
`image`, and raw `image/*` or `application/octet-stream` bytes. Raw-mode metadata goes
in query parameters; prefer the `X-Shortcut-Token` header for credentials. Body/file
limits are 5 MiB. Oversize handling returns 413 with a `NO DATA` spoken response;
malformed requests and rate-limit responses need not have a successful verdict shape.
The hook limiter is 20 requests/minute; see `server/middleware/rate-limit.js`.

`request-dedup.js` coalesces/replays identical payloads under the same identity and
rules fingerprint within 60 seconds on one process. Degraded model responses are not
replayed as authoritative results. A fresh screenshot can have different bytes and is
not necessarily a duplicate. A separate transactional storage guard handles matching
requests across processes; it does not prevent both processes spending model calls.

### 4.2 Request fields (after alias normalization)

| Field | Meaning |
|---|---|
| `text` | OCR text; aliases include `ocr_text` and `ocr`. |
| `image`, `image_type` | Screenshot bytes/base64 and MIME type; a multipart file must be named `image`. |
| `shortcut_token` | Body/query alternative to the preferred header. |
| `device_id` | Client telemetry, not authentication or ownership. |
| `latitude`, `longitude` | Optional direct-hook GPS context; aliases include legacy `lattitude`. Use canonical spellings in new clients. |
| `source` | Entry-path provenance such as `siri_text`, `siri_vision`, `android_text`, `android_vision`. |
| `shortcut_system` | Self-reported automation-client provenance, sanitized and stored in parsed JSON; not identity. |

See `normalize-offer-body.js` for the complete finite alias table and the hook for
header/body precedence. At least text or image is required. Coordinates are optional
for legacy direct automation by the recorded August decision; the browser quick-capture
flow independently requires precise location. Those are different entry contracts.

### 4.3 Response shapes

Normal responses include `success`, `decision`, `voice`, `notification`, `reason`,
`response_time_ms`, `analyzed_at` and personal-rule provenance. `notices` accompanies
the main result; `duplicate:true` marks a replay. `ruleset_version` is null for unsaved
profile-derived rules. `selection_verified` separately reports whether the current
profile has an explicit selected-service list; `decision_basis` identifies the rate
basis when evaluation produced one. `personal_rules_verified` does not by itself prove that a legacy
profile explicitly chose its service list; service-selection provenance is separate.

`ACCEPT`, `REJECT` and `NO DATA` are machine decisions. `ACCEPT (FALLBACK)` is a display
explanation, not a fourth enum. Speak `voice`; display `notification`. A decision and its
spoken line must agree. Unreadable or unverified evidence must not be promoted to an
acceptance. `response_time_ms` excludes capture, phone OCR, network transit and speech.

The browser reader in `client/src/lib/offer-capture.ts` requires a successful personal-rule
receipt, a matching ACCEPT/REJECT voice prefix and an `analyzed_at` no older than 30
seconds (with at most 5 seconds future skew). Otherwise it produces a manual-decision
message. Replays retain the original analysis timestamp.

### 4.4 Companion hook endpoints (token required)

| Method/path after `/api/hooks` | Purpose |
|---|---|
| `GET /offer-history` | Current token owner’s nonremoved recent analyses and bounded stats. |
| `POST /offer-override` | Owner-scoped immediate disagreement. |
| `POST /offer-cleanup` | Legacy owner-scoped hard deletion, at most 50 IDs. This is different from the editor’s reversible removal. |

The companion routes read canonical token names, not all ingest aliases.

## 5. Phase 1 — synchronous verdict

### 5.1 Request path, in execution order

The route in [analyze-offer.js](../../server/api/hooks/analyze-offer.js) is the entry;
all modalities converge on [adjudicatePhase1()](../../server/lib/offers/phase1-decision.js).

| Order / branch or guard | Function/source | Evidence → output and next step |
|---|---|---|
| 1. Parse transport | Hook middleware + `normalizeOfferBody()` | Raw bytes use query metadata; multipart binds `image`; JSON/form fields use aliases. Missing text/image returns 400. Malformed supplied coordinate pair returns 400/manual-decision response. |
| 2. Resolve owner | `resolveRuleset()` | Token → owner config/version/hash plus selected-services list. Unknown token or invalid/failed personal-rule resolution returns NO DATA before paid analysis. No token retains marked anonymous defaults. |
| 3. Deduplicate | `requestFingerprint()` / `requestDedup.claim()` | Identity + rules hash + selected-services serialization + text/image fingerprint. A hit replays/joins original response; no second Phase 1/2. Failed join can analyze fresh; a gate error does not prevent normal analysis. |
| 4. Extract OCR | `parseOfferText()` | Fare, recognized product, observed legs/totals and confidence. Partial OCR is not a complete trip. Raw text also goes to the model when needed. |
| 5. Prepare images | `downscaleOfferImage()` | Both OCR and screenshot are retained when both arrive. Strip data URL/whitespace; large images resize to width 820/JPEG quality 80 without enlargement. Below 250 KiB skips conversion; decode failure retains original image. |
| 6. Select prompt | `classifyTier()`, `buildPhase1Prompt()` / `buildPhase1VisionPrompt()` | Text uses recognized tier; image-only uses multi-tier extraction. Delivery must have delivery card shape; the word in a street/restaurant name alone does not establish delivery. |
| 7. Anonymous Share | Hook early return | Auto-rejecting Share without owner returns “Reject. Share tier.” and stops. Tokened Share continues through the normal response/enrichment path so it can reach the owner’s history. Share opt-out uses standard economics. |
| 8. Probe common evaluator without model | `adjudicatePhase1({preParsed, model:null,…})` | Supplies normalized evidence, service gate, sanity and numeric result. It cannot produce a ride acceptance without judgment checks. |
| 9. Early final branches | Hook `earlyFinal` | Finalize Share, known disabled service, implausible extraction, disabled delivery, a complete text-delivery parse, or a complete text parse with numeric REJECT. These use the common evaluator and skip Phase 1 model cost. Incomplete delivery OCR continues to the model with any supplied screenshot; missing numbers cannot produce a deterministic acceptance. Enabled observed text notices are attached to early text rejections; categorical Share/service rejections suppress numeric/hourly notices when sanity fails. |
| 10. Remaining cases call model | `callModel('OFFER_ANALYZER', …)` | Same saved rules prompt + raw text/preparse and images. The 20 s deadline aborts the request; timer is cleared. Returned JSON goes through syntax parsing and strict object/decision normalization. |
| 11. Reconcile every model/failure result | `parseModelJson()` → `normalizePhase1Model()` → `adjudicatePhase1()` | A malformed/failed/timed-out model becomes null evidence, not a successful judgment pass. Arithmetic/service policy is reapplied to text, image and mixed input; exact order below. |
| 12. Build driver response | `terseReason()`, `buildVoiceLine()` | Derive reason, notification and voice from the same adjudicated decision/rate. Active-time voice says “trip miles only”; Share/disabled-service rejections need no invented rate. ARP, requested notices, delivery hourly/tip disclosures retain their distinct meanings. |
| 13. Speech consistency guard | Hook / `respondNoData()` | If numeric ACCEPT/REJECT would speak NO DATA, return NO DATA and stop. Never claim a verdict the speech cannot support. |
| 14. Settle/reply | `phase1Payload` + dedup claim | Return decision, matching voice/notification, reason/notices, personal-rule and service-selection provenance, basis/version, original `analyzed_at` and response timing. Valid-model/deterministic results can be replayed; degraded model outcomes are not cached as authoritative. |
| 15. Decide enrichment eligibility | Hook post-response guard | Ordinary NO DATA stops. Tokened implausible or conflicting-extraction captures and nonauthoritative vision failures may continue; ACCEPT/REJECT normally continue. Earlier validation/unrenderable/anonymous-Share returns already ended their path. |

The 20 s model deadline is a failure bound, not the less-than-three-second product target
or an end-to-end request guarantee. Text/image preparation, DB resolution and phone
capture/upload/speech are separate costs. There is no automatic acceptance of a ride
in Uber/Lyft; this response is advice to the driver.

### 5.2 Common decision boundary, in execution order

| Guard | Evidence and result |
|---|---|
| Model normalization | `normalizePhase1Model()` accepts an object with decision exactly ACCEPT/REJECT/NO DATA. Arrays, primitives and unknown verdicts are invalid; money-like numeric strings are coerced without silently repairing decimal placement. Rating outside (0,5] becomes missing. Server-owned fields are not copied from the model. |
| Merge extraction | `mergePhase1Extraction()` records observed OCR/model fare and complete-leg differences before choosing an audit bundle; partial OCR legs do not replace model totals. Without a source conflict, OCR fare/complete legs can supply evidence and totals/rates are recomputed. `per_mile`/`per_minute` here always mean full ride. |
| Product conflict | Two known disagreeing service identities, or Share versus non-Share identity, yield NO DATA. Canonical product/service/economic routing comes from `shared/driver-services.js`. |
| Concrete extraction conflict | Compare fare whenever both OCR/model values are concrete. Compare `pickup_miles`, `pickup_minutes`, `ride_miles`, `ride_minutes` only for a full OCR parse with both values present. Any differing primitive value → `NO DATA`, `reason_kind:extraction_conflict`; no source is guessed to be correct. Aggregate total/rate differences are recomputed arithmetic, not this conflict class. |
| Selected service | Explicit list + unknown product → NO DATA; known excluded service → REJECT. Null legacy list does not invent selections or new exclusions; `selection_verified:false` remains visible. |
| Share | Enabled Share auto-reject → REJECT before arithmetic. With it off, standard economics apply. |
| Sanity | `checkSanity()` applies impossible-price/rate/missing-cents checks. A breach → NO DATA with implausible evidence; no guessed decimal. |
| Delivery/model non-offer guards | Delivery disabled → NO DATA. Model NO DATA stays NO DATA. Model ACCEPT with a nonempty judgment-rejection field is contradictory → NO DATA. A model object with no positive fare/total/ride evidence cannot be resurrected by stray OCR dollars. |
| Required basic numbers | Need positive fare/full-trip miles and a valid effective rate for the configured basis. Otherwise NO DATA. Delivery always uses full-ride basis. |
| Numeric rules | `evaluateDeterministic()` supplies NO DATA, REJECT or potential ACCEPT (§6.3). Numeric rejection cannot be overruled by model acceptance. Decision-specific basis/rate/miles/minutes remain separate from full-trip fields. |
| Acceptance evidence | For a ride, positive effective duration is required; enabled rating floor needs rating; enabled pickup-mile/minute gates need those observed fields. Missing evidence → NO DATA rather than an implicitly passed gate. |
| Judgment evidence | Ride acceptance needs a valid model result with the explicit `judgment_reject` report (empty means no reported judgment rejection). Model failure or a missing report on ACCEPT/REJECT → NO DATA. A reported judgment rejection survives an arithmetic pass. Delivery uses its separate deterministic contract. |

This ordering deliberately distinguishes provable rejection from proven acceptance.
A profitable-looking incomplete card is not sufficient evidence for a ride acceptance.

## 6. Rules engine (`rules-engine.js`)

### 6.1 Two enforcement lanes

The same migrated config renders model prompts and drives deterministic evaluation.
Numeric rules belong to code; visual judgments need appropriate evidence. Read the
actual evaluator and phase reconciliation together rather than treating the English
prompt as the executable specification.

### 6.2 `DEFAULT_RULESET`

`DEFAULT_RULESET` and `migrateRuleset()` are the source of exact defaults and backward
compatibility. Schema version remains 3. Do not copy the entire defaults JSON into a
second authoritative document.

Ride controls include `basis`, per-tier floors/ladders/distance caps, rating, pickup/time
limits and acceptance-rate protection. Additional controls cover verification, stops,
round trips, physical road access, notices, share handling and avoided places. Delivery
has its own enablement and floors. Sanity ceilings detect implausible extraction; they
are not the driver’s profitability preferences. Current default sanity ceilings include
$500 total, $40/mile and $500/hour, with separate missing-cents checks and denominator
conditions in `checkSanity()`.

A saved ruleset wins over signup-derived defaults. `initialRulesetFromProfile()` maps
only semantically equivalent unsaved preferences (`pref_shared`, `max_deadhead_mi`).
An hourly income goal is not an offer floor, and vehicle eligibility is not selected work.

### 6.3 Deterministic evaluation and reason kinds

`evaluateDeterministic()` runs these rules in order; §5.2 wraps it with service,
complete-evidence and judgment checks that the legacy pure engine alone cannot establish.

| Order | Gate/result |
|---|---|
| 1 | Share auto-reject, or remap allowed Share to standard. |
| 2 | Sanity breach → NO DATA; delivery branches to `evaluateDelivery()`. |
| 3 | Resolve effective basis/tier; missing effective rate → NO DATA. |
| 4 | Present rating below floor → REJECT. |
| 5 | Observed pickup over configured mile/minute cap → REJECT. |
| 6 | Without ARP, per-mile then optional per-minute floor failures → REJECT. With ARP, defer these profitability failures. |
| 7 | Time cap exceeded → REJECT unless all enabled pay exceptions pass. |
| 8 | Effective miles above tier distance cap → REJECT. |
| 9 | First matching acceptance-ladder rung → potential ACCEPT. |
| 10 | No rung, but total-mile ARP threshold met → potential ACCEPT (FALLBACK). ARP uses full-trip miles even under active-time rate basis. |
| 11 | Deferred profitability failures get their specific floor reason; otherwise duration >40 produces too-far and other failures low. |

The pure engine retains old missing-duration behavior for compatibility. The live
acceptance wrapper rejects missing evidence as NO DATA rather than trusting that legacy
sentinel. ARP can rescue profitability; it cannot excuse earlier safety/judgment,
pickup, rating, time or distance rejection. Delivery independently applies enabled,
required total metrics, maximum total miles, per-mile floor and hourly floor.

`full_ride` includes pickup plus ride legs. `active_time` needs actual ride-leg fields;
an absent leg must not be fabricated from a total. Canonical stored full-ride statistics
remain distinguishable from the denominator used for the decision and spoken rate.

### 6.4 Prompt renderers

`buildPhase1Prompt`, `buildPhase1VisionPrompt` and `buildPhase2Prompt` render the owner’s
resolved config. The prompts carry the visual rules and extraction contract. Runtime
model IDs, capability/settings and overrides come from `model-registry.js` and adapters,
not historical performance tables in this document.

### 6.5 Geo audit (`evaluateGeoRules`)

Geographic rules use user-selected Google `place_id` anchors and coordinates:

| Mode | Meaning |
|---|---|
| `destination_in` | Dropoff within the anchor’s radius. |
| `north_of` / `south_of` | Dropoff latitude compared with the anchor. |
| `heads_toward` | Pickup-to-dropoff motion toward the anchor, subject to trip distance, bearing corridor and getting closer. |

Missing required coordinates produce `no_data`, not `clear`. Phase-2 geometry is saved
as an audit; it does not rewrite the earlier speech. A direction rule is a condition on
a trip, not a blanket ban on the anchor venue. Any future VenuePlanner integration must
respect those semantics rather than passing every avoided-place entry as a venue ban.

### 6.6 Write-time validation (`ruleset-schema.js`)

Writes migrate then validate against the strict schema. Invalid writes return 422.
Saved personal-rule reads must distinguish missing, invalid and failed reads. A failed
read must not become “successfully loaded defaults.” Rules version and hash record which
configuration was used; current rules do not reconstruct an old configuration by themselves.

### 6.7 Spec → v3 mapping

| Melody requirement | Implemented representation / limit |
|---|---|
| Pickup travel counted from current driver location | Full-ride pickup + ride metrics; pickup limits. |
| Pay/time/distance preferences | Tier controls and `basis`; hourly is ride telemetry, but a delivery hourly floor is an explicit separate rule. |
| Avoided places / physical access | `avoid[]`, visual road-access rules and later coordinate audit; no demographic inference. |
| Immediate short spoken response | `voice`/`notification`, not the original four-line written report. |
| Actual driver action retained | Overrides and revisioned outcomes are separate from Analyzer decisions. |
| Home-return calculations | `home` remains declared but inert; no UI controls, per recorded D2. |
| Per-area scope overrides | `geo` remains declared but no active caller supplies its scope; no UI controls, per D2. |

The verbatim spec’s personal thresholds are not universal defaults. See roadmap L6/L7
for intentional limits; a complete schema shape is not proof every key is consumed.

## 7. Identity bridge and ruleset store

`driver_profiles.shortcut_token` maps a headless request to `user_id`.
`offer_rulesets.user_id` supplies that owner’s config/version/hash. `ruleset-store.js`
uses a bounded 15-second process cache and invalidates it after saves/token rotation,
including protection against an older in-flight read repopulating invalidated data.
Unknown supplied tokens and failed/invalid personal-rule reads fail closed.

Explicit selected services are independently resolved from the current owner profile.
Known disabled services are gated. Unknown offer products cannot be certified against
an explicit service list. A legacy null list stays visibly unverified; it must not be
presented as an explicit selection or manufactured from vehicle eligibility.

Token creation/rotation/label editing uses the authenticated editor API. Tokens are
credentials: generated launcher downloads contain none. Changing environments requires
the token issued by that same deployment. `device_id`, `source` and `shortcut_system`
are never substitutes for owner authentication.

## 8. Pre-parser (`parse-offer-text.js`)

The parser extracts fare, pickup and trip/total legs, product/tier cues and supported
card signals from OCR. It accepts multiline text and normalized phone-array input.
Missing evidence remains missing; a decimal-drop suspicion is retained for sanity checks.
See parser fixtures for Share, comfort/premium variants, delivery-shaped cards and
malformed examples. Product classification and economic tier classification are related
but not identical: several services may share one economic rules card.

## 9. Voice / notification builders

The hook formats a concise decision and rate/distance explanation suitable for TTS.
Delivery says total distance and identifies delivery. The rate denominator must agree
with `basis`; pickup deadhead must not disappear behind an unlabeled active-time number.
Model failure, invalid personal rules, unreadable/implausible data and unverified service
classification need an honest manual-decision message, not contradictory ACCEPT text.
Notices are optional observations controlled by saved preferences, not new decisions.

## 10. Phase 2 — asynchronous enrichment

### 10.1 Deep call and lifecycle

The async block stays in [the hook](../../server/api/hooks/analyze-offer.js) after
`res.json()`. It has no durable job queue/restart recovery and no single outer deadline.
The 45 s model deadline and per-Google-call 8 s deadlines bound individual calls, not the
whole enrichment lifecycle. Cancellation reaches the provider request but does not
prove upstream computation/billing stopped.

| Order / guard | Function/source | Evidence/output/next |
|---|---|---|
| 1. Post-response eligibility | Hook, §5.1 step 15 | Ordinary NO DATA skips paid enrichment/storage. Tokened implausible or conflicting-extraction captures and failed vision can continue with original NO DATA preserved. |
| 2. Compose deep prompt | `buildPhase2Prompt(ruleset)` | Same request’s config, resolved effective tier, optional request GPS, OCR summary/raw text and same prepared image. It does not load another driver’s config or wait for MAIN. |
| 3. Deep model deadline | `callModel('OFFER_ANALYZER_DEEP')` | 45 s controller/cleared timer. Failure keeps Phase 1 fallback evidence; returned model ID records the resolved provider result where available. |
| 4. Validate deep envelope | `parseModelJson({unwrap:false})` + object checks | Reject array/primitive envelopes and malformed `parsed_data`; retain raw reply as evidence, use Phase 1 fallback when deep data is invalid. |
| 5. Choose numeric bundle | Hook `storageSource` → `mergePhase1Extraction()` | Complete positive Phase 1 fare/full miles/minutes wins. Otherwise use one deep/fallback extraction bundle. Never combine one source’s totals with another source’s legs. |
| 6. Check storage numbers | `checkSanity(storageNumbers)` | Implausible Phase 1/selected storage bundle **or** any recorded extraction conflict is quarantined: numeric financial/leg/total columns stay null, while raw evidence and problem markers remain available. A bad later extraction must not turn into apparently valid historical economics. |
| 7. Assemble original/deep evidence | `mergedParsedData` | Original decision is immutable. Deep decision/dissent/reasoning, selected services, decision basis/rate, raw client and rule receipts remain separate; corrected-contract marker distinguishes new calculation behavior from unverified legacy rows. |
| 8. Resolve owner snapshot/anchors | Owner-current-snapshot query | Tokened owner’s `users.current_snapshot_id` joins the same owner’s snapshot. Request GPS wins as anchor; otherwise a dated snapshot at most 12 h old may anchor. Older snapshot timezone may still be source 3, but its position does not anchor geocoding. |
| 9. Resolve card points | `usableOfferAddress()` → geocode → `resolveCardPoints()` | Placeholder suppression, parallel pickup/dropoff geocode, physical plausibility/Places or mutual corroboration (§10.6). Identical address strings share one request. |
| 10. Resolve timezone | Memoized `resolveTimezoneFromCoords()` | Request GPS → trusted pickup point → owner snapshot timezone. If all fail, return from background block with **no INSERT**. |
| 11. Derive row context | Daypart helpers + `evaluateGeoRules()` | Local date/hour/day/weekend derive at enrichment time; precise trusted card points feed geometry audit. Store resolution trust/source metadata, request arrival time/hash and separate decision metrics. |
| 12. Store/notify | `storeOnce()` transaction | Advisory lock, owner-scoped duplicate guard and sequence, row insert, commit-time NOTIFY. Retry once only for recognized transient DB failures (§10.5). Other errors are logged; no durable recovery is implied. |

### 10.2 Deep JSON and stored evidence contract

The prompt requests offer amounts/legs, product/rider details, addresses, reasoning,
confidence and location analysis. Model identity/time/owner fields are not authoritative.
The hook chooses and normalizes numeric evidence before writing typed columns.
`raw_ai_response` keeps the deep reply or Phase 1 reply; `parsed_data_json` keeps merged
extraction/audits/provenance. `raw_text` contains OCR or an image-size placeholder;
the screenshot binary is not persisted by this insert.

### 10.3 Merge, quarantine and original decision

`decision` is always what Phase 1 delivered. Deep dissent is recorded in
`deep_decision`/`deep_disagrees` and prefixed reasoning, never substituted as the original
advice. Normalized stored `per_mile`, `per_minute` and legs describe one full-trip bundle.
`hourly_rate` currently retains the parser’s offered hourly field when present; do not
mistake it for the computed decision rate. JSON `decision_basis`, `decision_per_mile`,
`decision_miles` and `decision_minutes` describe the separate decision denominator.
`phase1_result` preserves the adjudicated fast evidence, `storage_metrics_source`
identifies Phase 1/Phase 2 numeric selection and `storage_quarantined` identifies the
write-time quarantine. The NOTIFY price/rate preview is also null for quarantined data.

When storage evidence is implausible **or** the original extraction has conflicting
primitive values, the insert nulls price, mile/minute/hour rates, surge, advantage,
pickup/ride legs and totals; NOTIFY price/rate are null too. Raw evidence remains.
`implausible` is the independent numeric-sanity flag; `storage_quarantined` covers both
sanity failures and unresolved source conflicts.

`extraction_conflicts` records `{field, ocr, model}` entries, both at the JSON top level
and inside `phase1_result`. Fields are fare or concrete pickup/ride miles/minutes under
§5.2’s comparison rules. A later agreeing deep pass does not erase the conflict or
certify the audit bundle. `storage_metrics_source:'phase1'|'phase2'` identifies which
bundle was retained, not a winner when quarantine is true. Aggregate differences such
as a model's incorrect total or per-mile arithmetic are deliberately excluded: the
server recomputes them from consistent primitive evidence.

Readers must honor quarantine/conflict markers even when JSON still contains numbers.
These corrections neither repair old rows automatically nor prove old calculations
were correct.

### 10.4 Timezone and temporal columns

| Priority | Source | Limit |
|---|---|---|
| 1 | Request coordinates → Google Timezone | Direct-hook coordinates are range/number validated; that hook does not receive a browser accuracy/fix-age receipt. |
| 2 | Trusted pickup point → Google Timezone | A corroborated area-level point may supply timezone but cannot become precise pickup coordinates. |
| 3 | Current owner snapshot’s saved timezone | Snapshot position older than 12 h is excluded as anchor, but its saved timezone remains a fallback in current code. This is not a fresh observation of the driver. |
| None | Stop background work before insert | No invented UTC/device-timezone/city fallback. |

`local_date`, `local_hour`, day-of-week, daypart and weekend flag use the enrichment-time
`now` in the resolved timezone. `request_at` separately retains request arrival time;
`created_at` is the insert statement time. Do not treat all three as the same instant.

### 10.5 Transaction, deduplication and offer sessions

| Step | Current behavior |
|---|---|
| Scope | Owner ID when tokened; otherwise real supplied device label for legacy analytics only. Untokened/deviceless calls get a fresh session, not one global anonymous bucket. |
| Lock | When scope and request hash exist, `pg_advisory_xact_lock` serializes that scope before duplicate/last-row reads. Paid model/Google work already finished; it is not inside the lock. |
| Duplicate guard | Matching scope/hash and stored `request_at` within the 60 s request window; `created_at` lookback is 120 s to bound the scan. Duplicate exits with no second insert/notify. This does not eliminate prior model cost across instances. |
| Sequence | Read latest stored offer in that scope; within 1800 s and with an existing offer session, reuse ID/increment sequence. Otherwise use new UUID/sequence 1. This is not browser login or MAIN admission identity. |
| Insert | Write original decision, normalized/quarantined metrics, addresses/points, owner/rules receipts, local-time/session data and raw evidence. `clock_timestamp()` after lock preserves insertion order rather than transaction-start ordering. |
| Notify | `pg_notify('offer_analyzed', …)` inside the transaction is delivered on commit, when the row is visible. Reasoning preview is bounded to 1000 characters; UI refetches canonical owner data. |
| Retry | Recognized transient SQLSTATE/connection errors retry `storeOnce()` once after 300 ms on a new transaction. Other failure, or repeated failure, ends this in-process attempt. |

### 10.6 Card-address resolution and geography audit

[offer-address.js](../../server/lib/offers/offer-address.js) performs the trust checks;
network adapters supply candidate data, not guaranteed truth.

| Stage | Acceptance condition / output |
|---|---|
| Address hygiene | `usableOfferAddress()` rejects placeholders and unreadable/not-visible descriptions before Google/Places. Address text may remain stored even when no point is trusted. |
| Geocode classification | `classifyGeocode()` compares card city/state and provider address components/partial-match metadata. A plausible-looking name alone is insufficient. |
| Anchor present | Request GPS has age 0; otherwise use fresh owner snapshot. Candidate must fit `60 mi + 75 mph × anchor_age_hours`; a failed candidate can try Places around anchor. |
| Places fallback | Current search radius 50,000 meters; accepted result must be within 60 miles and pass name/kind checks. A returned place is not automatically a match. |
| No anchor | Both pickup and dropoff must have city-confirmed geocodes and be within 60 miles of each other. No Places fallback is attempted. Otherwise addresses remain text-only. |
| Precision classification | `geoIsPrecise()` distinguishes precise point/route/intersection evidence from locality centroids. A trusted coarse point may resolve timezone; only precise points enter pickup/dropoff columns and geometry audit. |
| Audit | Enabled `avoid[]` rules produce violated/clear/no_data based on needed coordinates. Store violation/disagreement plus place IDs, trust/via/corroboration/precision, anchor source/age and geocoder metadata. It never changes the earlier speech. |

Six-decimal **representation** is not six-decimal sensor accuracy. Shared coordinate
normalization preserves supplied numeric precision and accepts zero coordinates.
Current browser quick capture validates accuracy ≤100 m and fix age ≤30 s (≤5 s future
skew), then serializes six decimal places; the direct hook has only range validation.
Card-point columns/audit are currently rounded to six decimals. `coord_key` is a lookup
format, `market` a coarse 1-decimal grouping, and H3 uses resolution 8; none proves a
precise sensor fix or doorstep match.

## 11. Data model

The source of column names, indexes and constraints is `shared/schema.js` plus migrations.

Release prerequisite: selected services and MAIN admission depend on the existing
uncommitted `migrations/20260929_main_run_admissions.sql`. This task did not apply it
or certify the target database schema. Verify the intended environment’s migration
state before releasing the dependent code; no migration was changed by this doc pass.

### 11.1 `offer_intelligence`

One stored analysis contains owner/provenance, original decision, numeric metrics,
extraction/audit JSON, model evidence, location/time/session data and rules receipt.
Corrected captures identify their calculation contract with
`parsed_data_json.phase1_contract_version=1`. Missing marker means the legacy
calculation contract is unverified, not necessarily wrong. These fixes do not
retroactively validate old model-outage acceptances, active-time rate columns or
previously skipped gates. No historical rows are blindly rewritten or deleted.
A current saved-rule hash alone cannot reconstruct old code or rule revisions.
`removed_at`/`removal_revision` support reversible editor removal. Raw captures, financial
outcomes and personal driver data are private; do not copy live rows into documentation.

### 11.2 `offer_rulesets`

One saved config per owner, with version/hash/update time. It contains rules, not offer
history. A hash alone is not a historical configuration archive.

### 11.3 `offer_outcomes`

Separate driver action/earnings/reasoning linked to an owned offer. Partial updates and
expected revision prevent stale editors overwriting another saved outcome. Unknown and
zero earnings differ; omitted fields must not erase other saved fields.

### 11.4 `driver_profiles` additions

Shortcut-token metadata supplies headless identity; preferences and selected services
supply owner context. Vehicle eligibility and primary vehicle are separate records.

### 11.5 Other Coach records

`coach_offer_decisions` retains historical conversational records. The previously
reachable model-emitted `LOG_OFFER_DECISION`, `UPDATE_OFFER_DECISION` and
`BACKFILL_OFFER_INTEL` mutation paths are retired. Tag recognition returns an explicit
not-saved error; it does not execute an offer write. Daily Offers outcome/override
controls and historical Coach reads remain available.

## 12. Editor API — `/api/offer-analyzer` (authenticated)

| Route | Contract |
|---|---|
| `GET /rules` | Saved migrated rules or explicitly identified unsaved profile-derived config. |
| `PUT /rules` | Valid config plus required `expected_version` (null only for no saved row); stale writes return 409/current config. |
| `GET /shortcut-token` | Owner’s existing token or get-or-create. |
| `POST /shortcut-token/regenerate`, `/shortcut-token/label` | Owner-scoped rotation/label changes. |
| `GET /offers` | Owned offers with outcomes; selected local-day requests and bounded recent requests differ. |
| `GET /offers/stats` | Complete interval totals for the chart, not just the visible recent rows. |
| `POST /offers/:id/outcome` | Partial outcome changes with expected revision and canonical saved/conflict response. |
| `POST /offers/:id/remove`, `/offers/:id/restore` | Reversible removal with expected removal revision. |
| `GET /places/search` | Authenticated Places selection for stable avoid-place anchors. |

See `server/api/offer-analyzer/index.js` for exact validation and status bodies.
The rules PUT requires an object config and global section containing the original
`rating_floor` and `require_verified` fields before migration. Missing/malformed
core input returns 422 without replacing personal rules or advancing their
version. Valid older configs can omit newer fields, basis and tiers; existing
optional-field migration behavior is unchanged.

Rules changes do not silently update an already admitted MAIN run. MAIN admission verifies
the raw stored config against its stored hash, migrates/validates the effective config
separately, and retains the original version/hash for concurrency. Valid older rules
can Continue unchanged without rewriting their row or confusing effective/raw hashes.

## 13. Web page — `/co-pilot/offer-analyzer`

`OfferAnalyzerPage.tsx` loads saved rules, exposes an explicit Save flow and preserves
rule ownership/version provenance. Selected services determine relevant economic cards;
multiple selected services may share a tier. A hidden card’s saved values are preserved.
Legacy unverified selection must not masquerade as a complete choice. Null legacy
selection keeps existing rule controls and plain unchosen-service wording. A
delivery-only explicit selection hides ride gates/rates/limits/geography/vision controls;
other hidden settings remain saved.

The Continue setup boundary permits legacy-null selection unchanged only when the
otherwise complete profile/vehicle and valid saved Analyzer rules are present. Explicit
empty, invalid or ineligible selections still fail validation; missing saved rules are
not silently invented. The summary shows saved limits and distinguishes unchosen
services. This fixes the reproduced source regression, not a claim to have reproduced
Melody’s exact account state or error through runtime access.

`SetupCard.tsx` offers the browser quick analyzer, deployment-specific setup downloads,
a token-free Android browser launcher and a separately labeled legacy iPhone shortcut.
The launcher opens a signed-in screenshot chooser; it does not silently capture another
app. Existing native automation is a separate phone setup.

`OffersCard.tsx` keeps drafts during refresh failures and refetches on focus/SSE.
`OfferOutcomeRow.tsx` saves explicit driver outcomes with conflict recovery.
`OffersDecisionChart.tsx` compares full-period recommendations and outcomes, uses the
GPS-resolved timezone, and reports only explicitly saved earnings. The component README
and tests describe account/session replacement and stale-response protection.

## 14. Realtime — SSE `/events/offers`

The event stream authenticates the owner, sends a state handshake and announces relevant
stored changes. The UI refetches canonical data; the event is not the complete offer.
Listener reconnect and client focus/refetch recover missed notifications. SSE is not a
guaranteed push of a replacement verdict to phone automation.

## 15. Coach integration

The Coach brain loads owner-scoped context through `rideshare-coach-dal.js`. Recent
offer history reads full nonremoved rows (bounded at 20), including available Phase-2
JSON/evidence. The human-readable summary shows fewer rows, but
`coach-source-context.js` serializes the full bounded source records. The longitudinal
pattern query covers the owner’s recent 180-day window with outcomes; neither is the
entire lifetime history.

Current owner rules and selected services are data, not the text of this document.
`getOfferRules()` reads on each brain turn. `source_state` distinguishes `saved`,
`profile_defaults`, `unavailable`, `read_failed` and `invalid`. It verifies the raw
stored config against its stored hash, then supplies migrated effective config with
`effective_hash`, saved version/hash/update time and `stored_schema_version`. Invalid
and failed reads do not substitute defaults. Source JSON includes `offer_rules`,
`driver_profile` (including `selected_services`) and `driver_vehicle` (active primary).
Current rules do not reconstruct historical offer configs or alter old recommendations.
Legacy rows without the corrected Phase 1 contract marker must be treated as unverified
historical calculations; do not turn old rate columns into confident current advice.
The previous process-cached architecture-doc/model-registry text splice is removed.
Existing snapshot/timezone entry requirements remain; this is not before-GPS access.

Active GPT live voice delegates substantive questions to the same `/api/chat` brain;
its bounded session bootstrap is not the full data layer. Legacy realtime/Gemini
routes carry reduced context and must not be mistaken for the active full-context path.
Coach’s legacy model-emitted offer mutation actions are retired (§11.5). Other
validated Coach actions are separate. There is no automatic Analyzer-rule tuning
from chat or outcomes.

## 16. Models, latency, and the <3s target

Melody’s less-than-three-second goal concerns the driver’s offer window. Consult
`model-registry.js` for pinned `OFFER_ANALYZER` and `OFFER_ANALYZER_DEEP` assignments;
current `getRoleConfig()` does not use the historical model environment-override scheme.
Repository pins alone do not establish what deployment is serving. Synthetic endpoint benchmarks
from August are historical evidence, not current phone p95 or safety guarantees.
Timeout/cancellation tests verify bounded behavior under their fixtures; they do not
measure radio, capture, OCR, provider tail latency or tap-to-speech on a real phone.

### 16.1 Current bounds and caches

These are implementation settings, not measured latency guarantees.

| Boundary | Value/source | Meaning |
|---|---|---|
| Hook bodies/file part | 5 MiB; middleware/multer | Before model preparation; resizing cannot undo upload time. |
| Hook rate limiter | 20/minute; `offerHookLimiter` | Identity/IP-keyed request limiting, not a completion guarantee. |
| Rule/service cache | 15 s, maximum 500 tokens; `ruleset-store.js` | Local save/rotation invalidation; other instances can retain their cache until expiry. Unknown tokens are not cached. |
| Request dedup cache | 60 s, maximum 500 entries; `request-dedup.js` | Same fingerprint shares original response; waiter ceiling 30 s. Selected services are part of the fingerprint. |
| Phase 1 model deadline | 20 s; hook | Abort model request and clear timer; not a total request deadline or the 3 s goal. |
| Phase 2 model deadline | 45 s; hook | Abort deep request; fallback evidence may still attempt storage. |
| Google requests | 8 s each; hook | Separate deadlines for geocode/Places/timezone; no single outer Phase 2 deadline. |
| Geocode/Places memos | 10 minutes, 500 entries each | Successful results only; key includes address and anchor rounded to 2 decimal degrees. This approximate key is not position accuracy. |
| Timezone memo | 12 hours, 2,000 entries | Successful timezone IDs; 4 decimal-degree key. |
| Snapshot anchor age | 12 hours | Older position does not anchor addresses; its stored timezone remains source 3. |
| Storage duplicate/session | 60 s request window; 120 s row lookback; 30 min session gap | Per-scope transaction guard/sequence, distinct from cache and auth session. |
| Transient DB retry |Once after 300 ms | No persistent queue/restart recovery. |
| Browser capture | 45 s controller; GPS lookup 12 s | Current QuickAnalyzePage lifecycle; validates fix age/accuracy separately. |
| Browser result/fix freshness | 30 s, future skew ≤5 s; fix accuracy ≤100 m | Timestamp/sensor policy; not an assurance of exact location or continued relevance. |

## 17. Ownership and data handling

Browser APIs require authentication; shortcut companion routes require a resolving token.
Every private read/write must retain owner scope. Tokens are not exported in the browser
launcher. Rules, history, outcomes and current-user preferences must not cross accounts.
Model outputs are untrusted extraction, never authority over server identity or settings.
The legacy hard-delete hook and reversible editor removal are intentionally documented
separately so clients do not confuse them.

## 18. Verification

Focused evidence lives in `tests/offers/`, `tests/coach/`, `tests/offer-capture.test.ts`
and `tests/android-launcher.test.ts`. Important contracts include parser/engine parity,
service selection, multimodal reconciliation, read failures, owner scope, revisions,
original-decision preservation, current response speech and bounded model cancellation.
Consult the current task receipt for commands/results. This document does not repeat
obsolete passing-test counts or claim a live device/database/deployment check.

## 19. Key files

Core linked modules: [hook](../../server/api/hooks/analyze-offer.js),
[Phase 1 reconciliation](../../server/lib/offers/phase1-decision.js),
[shared service identity/economic routing](../../shared/driver-services.js),
[rules engine](../../server/lib/offers/rules-engine.js),
[rules store](../../server/lib/offers/ruleset-store.js),
[card-point trust](../../server/lib/offers/offer-address.js),
[Coach DAL](../../server/lib/ai/rideshare-coach-dal.js).

All paths below are repository-relative:

| Responsibility | Source |
|---|---|
| Transport, Phase 1, Phase 2 and storage | `server/api/hooks/analyze-offer.js` |
| Rules, prompts, geometry | `server/lib/offers/rules-engine.js`, `ruleset-schema.js` |
| Identity/rules resolution | `server/lib/offers/ruleset-store.js`, `profile-ruleset.js` |
| Extraction/reconciliation | `server/lib/offers/phase1-decision.js`, `parse-offer-text.js`, `parse-model-json.js`, `normalize-offer-body.js` |
| Addresses/duplicate gate | `server/lib/offers/offer-address.js`, `request-dedup.js` |
| Editor API/schema | `server/api/offer-analyzer/index.js`, `shared/schema.js` |
| Editor/capture | `client/src/pages/co-pilot/OfferAnalyzerPage.tsx`, `QuickAnalyzePage.tsx` |
| Setup/speech receipt | `client/src/components/offer-analyzer/SetupCard.tsx`, `client/src/lib/offer-capture.ts`, `android-launcher.ts` |
| Coach | `server/api/chat/chat.js`, `server/lib/ai/rideshare-coach-dal.js`, `coach-source-context.js` |
| Models | `server/lib/ai/model-registry.js`, `server/lib/ai/adapters/` |

## 20. Known gaps (pointer)

See [the roadmap](OFFER_ANALYZER_ROADMAP.md) for device certification, durable enrichment,
remaining spec differences and deferred MAIN integration. Do not infer completion from
an older “shipped” paragraph or treat a historical handoff as the current checkout.

## Appendix A — Change log

- 2026-09-29: Source-based reconciliation after Melody requested Analyzer root-cause
  fixes before MAIN integration. Replaced contradictory runtime claims, retained source
  paths/numbered sections and separated present behavior from historical evidence.
- 2026-09-10/11: Outcome revisions, chart/source continuity and browser launcher work
  are documented in the dated coordination handoffs and mobile source review.
- 2026-08-26: Delivery/sanity/client-provenance work followed Melody’s decimal-drop
  incident; see the dated intake record and prior canonical version via the removal ledger.
- 2026-08-17: Consolidation established one as-built doc, one roadmap and two phone guides;
  see `removals/2026-08-17-offer-analyzer-doc-consolidation.md`.
- 2026-07-03: Per-owner rules/token and three-decision design; Melody’s spec remains verbatim.
- 2026-06-20: Rules and prompts were unified to remove duplicated arithmetic policy.

The older detailed chronology is preserved by commit/section pointers in the removal
record. It is historical evidence, not proof of today’s rollout.

## Appendix B — Decisions of record (provenance-marked)

**Historical decision record; current contracts above and later explicit Melody directions govern.**

**Melody-authored (verbatim intent, dates as recorded in `claude_memory` #354/#371/#372, todo #10/#43):**
1. Full verbatim spec scope — `docs/OFFER_ANALYZER_DRIVER_RULESET.md` is the source of truth (2026-07-03).
2. Per-driver rules bridged by a shortcut token; typed-forms UI (not raw JSON) (2026-07-03).
3. Zero hardcoded locations — every place user-entered by Places search, keyed by `place_id` (2026-07-03).
4. Vision-first shortcut: the screenshot only; "the address is on the offer"; full extraction in Phase 2 because "this will tell us where pings and patterns happen" (2026-07-02/03).
5. Outcomes card: "if I get a reject — I can tell our system I accepted it" (2026-07-03).
6. "<3 seconds" hard latency target; "we only need the sliders for the input"; hourly rate is telemetry, never the decider (2026-08-14). Validated: "ours is perfect" vs Apple device vision on her real offers.
7. The Coach does not do the real-time verdict (that is this pipeline's job — `app_rules`,
   2026-08-13) — but it **should** mine `offer_intelligence` for location / daypart /
   day-of-week / time / seasonality patterns to steer the driver toward better offers
   (Melody, 2026-08-17 clarification).
8. Field-name tolerance (the alias table) is a safety net for hand-built shortcuts — **not**
   a reason to stay quiet. Melody, 2026-08-17:  — when something on her end (a shortcut's test name, a misspelled
   key or `source`) is degrading the pipeline, tell her directly so she can fix it.

**Joint (Melody + Claude, 2026-08-14):** two canonical shortcuts (`analyze-offer-text`,
`analyze-offer-vision`); no Get Current Location action; `source` keys `siri_text` /
`siri_vision` (Android: `android_text` / `android_vision`); token in the Headers section.

**Claude-authored, adopted (2026-07-03):** two-lane engine; write-strict / read-fail-open
posture with NULL-hash visibility; decision = spoken; ARP-defers-floors semantics; ON
DELETE RESTRICT on user FKs; token format.

**Melody-directed implementation (2026-09-11):** the historical personal-rule fail-open
posture above is superseded by §7. A supplied token must resolve its actual rules before
analysis; failures speak NO DATA. Canonical signup preferences initialize only compatible
unsaved analyzer settings, and the existing saved analyzer rules retain priority.

**Claude-authored, adopted (2026-08-17, Melody: "take the lead"):** an identical request
inside 60 s (105 s at storage) is ONE offer — replayed, never re-analyzed or re-stored;
per-driver session sequencing is serialized by an advisory lock; rules saves are
optimistic-concurrency (409 on a stale `expected_version`), never last-write-wins across
devices; a 409 drops the local edits and reloads (honest, re-apply) rather than merging.
