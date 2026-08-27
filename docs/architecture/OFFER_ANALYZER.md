# OFFER_ANALYZER.md — The Offer Analyzer, exactly as built

> **Canonical reference** for the real-time ride-offer analysis lane: device shortcut →
> `POST /api/hooks/analyze-offer` → per-driver ruleset engine → spoken verdict → async
> deep enrichment → `offer_intelligence` → live web page. **This is THE offer lane** —
> the Coach never analyzes offers (`app_rules.coach-never-analyzes-offers`).
>
> **Version:** 3.8 — 2026-08-26 (v3.2 ruleset: implausible-parse tripwire + delivery lane + client signature; see Appendix A). 3.1 — 2026-08-17 (rewritten end-to-end against code at commit `97cd2d3b`)
> **Previous:** 2.0 — 2026-04-16 (pre-v3 engine; two-phase Flash/Pro architecture)
> **Supersedes and absorbs (deleted 2026-08-17, history in git):**
> `OFFER_ANALYZER_EDITOR_PLAN.md` (2026-06-01 plan; §0 three-decision model carried
> forward as §3 here), `OFFER_RULESET_V3_DESIGN.md` (2026-07-03 approved design; the
> built system is documented here, Melody's decisions carried forward as Appendix B).
> **Companions:**
> - `docs/architecture/OFFER_ANALYZER_ROADMAP.md` — the plan going forward (open gates, next levers)
> - `docs/architecture/SIRI_SHORTCUT_ANALYZE.md` — iPhone end-user build guide (two shortcuts)
> - `docs/architecture/ANDROID_SHORTCUT_ANALYZE.md` — Android end-user build guide
> - `docs/OFFER_ANALYZER_DRIVER_RULESET.md` — Melody's verbatim spec (the input the v3 ruleset implements; never edited)
>
> **Provenance:** Claude-authored against full-file reads (not grep excerpts) of every
> file in §19, plus a live dev-DB schema check; Melody-authored decisions are marked as
> such where they shaped the design. Facts cite `file:line` at the commit above.

---

## Table of Contents

1. [Purpose and boundaries](#1-purpose-and-boundaries)
2. [System map](#2-system-map)
3. [Three distinct decisions (never conflate)](#3-three-distinct-decisions-never-conflate)
4. [Ingest endpoint contract — `POST /api/hooks/analyze-offer`](#4-ingest-endpoint-contract--post-apihooksanalyze-offer)
5. [Phase 1 — synchronous verdict](#5-phase-1--synchronous-verdict)
6. [Rules engine (`rules-engine.js`)](#6-rules-engine-rules-enginejs)
7. [Identity bridge and ruleset store](#7-identity-bridge-and-ruleset-store)
8. [Pre-parser (`parse-offer-text.js`)](#8-pre-parser-parse-offer-textjs)
9. [Voice / notification builders](#9-voice--notification-builders)
10. [Phase 2 — asynchronous enrichment](#10-phase-2--asynchronous-enrichment)
11. [Data model](#11-data-model)
12. [Editor API — `/api/offer-analyzer` (authed)](#12-editor-api--apioffer-analyzer-authed)
13. [Web page — `/co-pilot/offer-analyzer`](#13-web-page--co-pilotoffer-analyzer)
14. [Realtime — SSE `/events/offers`](#14-realtime--sse-eventsoffers)
15. [Coach integration (read-only)](#15-coach-integration-read-only)
16. [Models, latency, and the <3s target](#16-models-latency-and-the-3s-target)
17. [Security posture](#17-security-posture)
18. [Tests](#18-tests)
19. [Key files](#19-key-files)
20. [Known gaps (pointer)](#20-known-gaps-pointer)
- [Appendix A — Change log](#appendix-a--change-log)
- [Appendix B — Decisions of record (provenance-marked)](#appendix-b--decisions-of-record-provenance-marked)

---

## 1. Purpose and boundaries

A driver's phone captures an incoming Uber/Lyft offer (screenshot and/or on-device OCR
text), POSTs it to Vecto Pilot, and hears **ACCEPT / REJECT / NO DATA** spoken back
inside the offer window. Verdicts are produced by the driver's **own ruleset**
(editable on the web page), evaluated deterministically wherever the numbers exist and
by a vision model only where judgment is required.

Boundaries that are **rules**, not preferences:

| Boundary | Where enforced |
|---|---|
| The Coach never analyzes offers (no OCR of offer cards, no verdicts in chat). Offer history is pattern context only. | `app_rules.coach-never-analyzes-offers`; `server/api/chat/chat.js` system prompt |
| Models are called by **role** (`OFFER_ANALYZER`, `OFFER_ANALYZER_DEEP`) via `callModel`, never by vendor name in code paths/logs. | `app_rules.model-agnostic-roles`; `server/lib/ai/adapters/index.js` |
| No hardcoded locations. Every avoid-place is user-entered and keyed by Google `place_id` with 6-decimal coords. | `app_rules.no-hardcoded-location`, `coords-six-decimals`; `rules-engine.js` `avoid[]` |
| Timezone for stored rows always comes from **coordinates → Google Timezone API**: the offer's GPS, else the card's **pickup address** (first address on the card) resolved to a trusted point, else the driver's snapshot row — never UTC, never device time, never a guessed geocode. If nothing real resolves the row is **not stored**. | `app_rules.timezone-gps-only`, `no-fallbacks`; `analyze-offer.js` Phase 2 (§10.4) |
| Missing required data → `NO DATA` (honest floor), never a fabricated `REJECT`; optional optimizations (image downscale, geocode) fail **open** without gating the answer. Since 2026-08-17 a model reply with no `decision`, or one describing no ride (all-zero metrics — how every vision model answers a non-offer screenshot), is handed to the rules engine (→ `NO DATA` without a pre-parse). | `analyze-offer.js` (`deterministicPhase1`, honest-floor guard), `downscale-offer-image.js` |

---

## 2. System map

```
iPhone Shortcut / Android automation                    (docs: SIRI_/ANDROID_SHORTCUT_ANALYZE.md)
  Take Screenshot → [Extract Text] → POST /api/hooks/analyze-offer
  header X-Shortcut-Token: vp_…      body: text | image(File) | source | device_id
        │
        ▼  server/api/hooks/analyze-offer.js  (public, offerHookLimiter 20/min, multer 5MB)
  normalizeOfferBody (alias table) → mode: multipart | JSON
  parseOfferText (regex, <1ms)      → preParsed {price, pairs, per_mile, product_type, confidence}
  resolveRuleset(token)             → { ruleset, userId, version, hash }   (15s cache; DEFAULT if none)
  classifyTier(product, ruleset)    → share | standard | premium | comfort | xl
        │
        ├─ share (auto_reject) ──────────────────────────────► "Reject. Share tier."  (~ms)
        ├─ FAST LANE: text + confidence=full + engine REJECT ► deterministic verdict  (~3-5ms)
        └─ MODEL LANE: callModel('OFFER_ANALYZER', prompt rendered FROM the ruleset, images) 20s race
              parse JSON (2 tiers) → else deterministic engine (always answers)
        │
        ▼  res.json({ success, voice, notification, decision, reason, notices, response_time_ms })
        │                                                       Shortcut: Speak Text(voice) + Show Notification
        ▼  PHASE 2 (async, after response)
  callModel('OFFER_ANALYZER_DEEP', same ruleset, same images) 45s race → full extraction
  resolve card addresses (Geocoding, biased → trust rule → else Places, distance-gated)
  timezone (GPS → pickup address point → snapshot → else DON'T STORE) → temporal cols → session bucket
  INSERT offer_intelligence (decision = what was SPOKEN; deep dissent kept as data)
  pg_notify('offer_analyzed') ──► SSE /events/offers (per-user) ──► OffersCard refetch
  (addresses resolved BEFORE the INSERT since 2026-08-17: trusted place_id + 6-dec coords → evaluateGeoRules → written in the INSERT)

Web page /co-pilot/offer-analyzer  (authed, /api/offer-analyzer/*)
  SetupCard (token mint/rotate/label) · rules cards (typed forms → PUT /rules, Zod gate)
  OffersCard (my offers + "what I actually did" + earnings → offer_outcomes)
```

---

## 3. Three distinct decisions (never conflate)

Carried forward from the 2026-06-01 plan (§0) — the learning value rests on keeping these
separate:

| # | Concept | Storage | Values |
|---|---|---|---|
| 1 | **Analyzer decision** — what the driver was told | `offer_intelligence.decision` (NOT NULL) | `ACCEPT` / `REJECT` / `NO DATA` |
| 2 | **Driver override** — in-the-moment disagreement via hook | `offer_intelligence.user_override` | `null` / `ACCEPT` / `REJECT` |
| 3 | **Driver actual outcome** — ground truth, recorded on the web page | `offer_outcomes.driver_decision` (+ earnings) | `Accepted` / `Rejected` / `Cancelled` / `Completed` |

Also kept separate: the **Phase-2 deep model's verdict** is stored only as data
(`parsed_data_json.deep_decision`, `deep_disagrees`, and a `[deep model dissents: X]`
prefix on `decision_reasoning`) — it never overwrites #1 (`analyze-offer.js:597-602`).

Stats surfaces reflect this: `/api/hooks/offer-history` reports `analyzer_accepted` /
`analyzer_rejected` (legacy `accepted`/`rejected` keys kept for compatibility);
`/api/offer-analyzer/offers` reports `analyzer_*`, `driver_accepted`, `disagreements`,
`realized_total` (only rides actually taken).

---

## 4. Ingest endpoint contract — `POST /api/hooks/analyze-offer`

**File:** `server/api/hooks/analyze-offer.js` (1015 lines). Router mounted at `/api/hooks`
(`server/bootstrap/routes.js:131`; `translate.js` shares the mount but is an unrelated
Siri translation hook).

### 4.1 Transport

| Concern | Value | Source |
|---|---|---|
| Auth | **None required** (token-optional; see §7). Bot-blocker allow-lists `/api/hooks*`. | `bot-blocker.js:160-165` |
| Rate limit | `offerHookLimiter`: 20 req/min keyed by `ip + (x-shortcut-token \| shortcut_token \| device_id \| 'unknown')`; 429 body `{ ok:false, error:'Offer analysis rate limit exceeded. Please wait a moment.' }`. Since 2026-08-17 multer runs **before** the limiter so a multipart `device_id` keys its own bucket (untokened multipart used to share one per-IP bucket behind carrier NATs); a multipart that multer rejects (oversize → 413, bad part) therefore never reaches this bucket — only the global per-IP limiter counts it, the same class as `express.json`, which has always parsed before this limiter. | `rate-limit.js:56-68`, `analyze-offer.js` route |
| **Idempotency** (2026-08-17) | Fingerprint = sha256(**who**: token › `device_id` › ip, **+ which rules**: ruleset hash or `default`, **+ what**: whitespace-normalized text and/or the image base64 as sent) — coordinates and `source` excluded. An identical request inside **60 s** replays the first Phase-1 JSON (`duplicate:true` added; Phase 1 **and** Phase 2 skipped — one row, one notify, one set of model/Google calls) or **joins** an in-flight original (≤30 s) and gets the same answer the moment it exists. Only **authoritative** answers are cached: when the model timed out / failed / replied unusably and the engine answered, the entry is dropped so a re-send gets a fresh try; a 500 is never replayed. A rules edit changes the hash → the same card is a **new** analysis (the test-before-you-drive loop). **Honest scope:** this recognizes *byte-identical* re-sends — a network-level retry, MacroDroid's saved file, a share-sheet re-run of the same image, the smoke script; a Shortcut **re-run** takes a **new** screenshot (new bytes) and the text lane's OCR can differ across a status-bar minute, so a double Back Tap is usually two distinct payloads. Per instance; the **storage-level guard** (`parsed_data_json.request_hash` + `request_at`, same driver, request-to-request ≤ 60 s, under the session lock, §10.5) covers duplicates that land on different Cloud Run instances. | `server/lib/offers/request-dedup.js`, `analyze-offer.js` "IDEMPOTENCY GATE" |
| Body parsers | `express.json({limit:'5mb'})`, `express.urlencoded({extended:true, limit:'5mb'})` (Form bodies with only text fields ship as urlencoded — mounted 2026-08-14) **and** `express.raw({ type: ['image/*','application/octet-stream'], limit:'5mb' })` (raw image body — mounted 2026-08-17 for MacroDroid "Content Body: File"; patch authored in the Cowork session) on `/api/hooks` | `bootstrap/middleware.js` |
| Multipart | `multer.memoryStorage()`, `fileSize` 5 MB, `upload.single('image')` | `analyze-offer.js` |
| Content types accepted | `application/json`, `application/x-www-form-urlencoded`, `multipart/form-data` (file part named `image`), **`image/*` or `application/octet-stream` raw body** (the body *is* the screenshot; type sniffed from magic bytes — PNG/JPEG/WebP/GIF; `source`, `device_id`, `latitude`, `longitude` ride as **query params**, token in the `X-Shortcut-Token` header or `?shortcut_token=`) | — |
| Oversize | > 5 MB (raw body **or** multipart part) → **413** with the spoken shape `{ success:false, voice:'Image too large. Decide manually.', notification, decision:'NO DATA', reason:'image too large', code:'payload_too_large' }` (2026-08-17; multipart oversize used to be a bare 500) | `middleware/error-handler.js` |

### 4.2 Request fields (after alias normalization)

Every incoming key first passes through `normalizeOfferBody()` (`normalize-offer-body.js`):
case-insensitive **exact** lookup against an enumerated alias table, canonical keys win over
aliases, unknown keys pass through untouched, every remap is warn-logged
(`[HOOKS] Field aliases accepted: … — update the Shortcut key names`).

| Canonical | Accepted aliases | Required? | Notes |
|---|---|---|---|
| `text` | `ocr_text`, `ocr` | one of `text` / `image` | On-device OCR output |
| `image` | `screenshot`, `photo` (string fields only) | one of `text` / `image` | JSON/urlencoded: base64 (data-URL prefix and whitespace tolerated). Multipart: raw file bytes in a part named **exactly `image`** — multer binds that name before alias normalization runs; a file part named anything else is a MulterError → HTTP 500 from the global error handler (no `voice`/`notification`) |
| `image_type` | `imagetype`, `mime_type`, `mimetype` | no | default `image/jpeg`; multipart uses the part's mimetype |
| `device_id` | `deviceid`, `device` | no | Display/legacy identity only — **not** a credential; stored; `'anonymous_device'` when absent |
| `latitude` | `lattitude`, `lat` | no | Rounded to 6 decimals; drives `driver_lat`, `coord_key`, `h3_index`, `market`, and Phase-2 timezone |
| `longitude` | `longitude`, `longitud`, `lng`, `lon`, `long` | no | as above |
| `source` | — | no | Stored verbatim in `offer_intelligence.source`. Defaults: `siri_vision` (multipart), `siri_shortcut` (JSON). Canonical keys for new shortcuts: `siri_text`, `siri_vision`, `android_text`, `android_vision` |
| `shortcut_token` | `shortcuttoken`, `token` | no (but it IS the product) | Header `X-Shortcut-Token` is preferred and wins over the body field |
| `shortcut_system` | `shortcutsystem`, `client`, `automation`, `client_app`; header `X-Shortcut-System`; query param on the raw-body path | no | **v3.2 (Melody 2026-08-24): self-reported automation client** (`macrodroid/5.65`, `http_shortcuts/3.x`, `tasker/6.6`, `ios_shortcuts`). Normalized on ingest (lowercase, `[a-z0-9._/ -]`, ≤ 40 chars), logged on the `[HOOKS] 📱 Incoming` line, stored in `parsed_data_json.shortcut_system`, shown as a tag on Offers rows. **Provenance only — never identity** (the token is). Absent → null; old shortcuts keep working. |

Neither `text` nor `image` → **400** `{ "error": "Missing text or image payload" }`.

**Coordinates are optional by design (2026-08-14, joint):** the canonical shortcuts send
none — the location fix costs seconds in a 3-second window; pattern data comes from
Phase-2 geocoding of the offer's own addresses.

### 4.3 Response shapes

All 200 responses share the same keys (`success, voice, notification, decision, reason,
response_time_ms`, plus `notices` on the main path).

| Path | HTTP | Body |
|---|---|---|
| Main (fast lane, model lane, deterministic fallback) | 200 | `{ success:true, voice, notification, decision:'ACCEPT'\|'REJECT'\|'NO DATA', reason, notices:[…], response_time_ms }` |
| Share auto-reject (`analyze-offer.js:311-327`) | 200 | `{ success:true, voice:'Reject. Share tier.', notification:'REJECT: share', decision:'REJECT', reason:'share', response_time_ms }` (no `notices` key) |
| No data (nothing parsed and no model answer) | 200 | `decision:'NO DATA'`, `reason:'no data'`, `notification:'NO DATA: no data'`, `voice:'No data. Decide manually.'` |
| Validation | 400 | `{ error:'Missing text or image payload' }` |
| Multipart file part >5 MiB or wrong part name (multer, before the handler) | 500 | `{ cid, error:'Internal server error' }` from `server/middleware/error-handler.js` — no `voice`/`notification` (JSON body >5 MB → 413 `{ cid, error:'Payload too large…', code:'payload_too_large' }`) |
| Uncaught error (`:853-868`) | 500 | `{ success:false, voice:'Analysis failed. Decide manually.', notification:'Analysis failed — decide manually', error:<message>, reason:'analysis failed', response_time_ms }` |

Field contracts:

| Field | Meaning |
|---|---|
| `voice` | TTS-ready sentence for **Speak Text** — never contains `$`, `/`, or `mi` (§9) |
| `notification` | Compact on-screen line: `"<DECISION or ACCEPT (FALLBACK)>: <terse reason>"`, then ` \| <notice> \| <notice>` when notices fired. Do not speak it. |
| `decision` | Machine value: `ACCEPT` / `REJECT` / `NO DATA` (the FALLBACK label is display-only) |
| `reason` | Terse reason, e.g. `"$1.14 8.3mi"`, `"$0.78 14.0mi low"`, `"$1.05 18.0mi floor prem"`, `"share"`, `"no data"` |
| `notices` | Up to 4 strings ≤40 chars from `NOTICE_LABELS`: `Verified Rider`, `Filter Detected`, `Deadhead Reduction Pickup` — empty unless the driver enabled them |
| `response_time_ms` | Wall-clock from arrival to `res.json()` (on a replay: this request's own wall-clock, typically 0-3 ms) |
| `duplicate` | `true` only on a replayed/joined answer (§4.1 idempotency) — the payload is otherwise the first request's Phase-1 JSON verbatim. Absent on a fresh analysis. |

### 4.4 Companion hook endpoints (token-REQUIRED)

`requireShortcutUser` (`analyze-offer.js:64-80`) reads `x-shortcut-token` header, or
`shortcut_token` in body/query **raw** (no alias normalization on these routes — `token` /
`shortcuttoken` work only on `/analyze-offer`); missing → 401 `shortcut_token required…`;
unknown → 401 `invalid shortcut token`. (`resolveRuleset` never throws — it fail-opens — so
the 500 `token_resolution_failed` branch is unreachable; a DB outage surfaces as 401.) All use
`offerHookLimiter`. `device_id` is **not** an ownership scope (multi-user sweep 2026-08-11).

| Route | Purpose | Contract |
|---|---|---|
| `GET /api/hooks/offer-history?limit=20` (≤100) | My recent analyses | `{ success, stats:{ total, accepted, rejected, analyzer_accepted, analyzer_rejected, no_data, avg_response_ms, avg_per_mile }, offers:[…27 columns…] }` scoped `WHERE user_id = me` |
| `POST /api/hooks/offer-override` `{ id, user_override:'ACCEPT'\|'REJECT' }` | Record in-the-moment disagreement | 404 if not mine → `{ success, original_decision, user_override }` |
| `POST /api/hooks/offer-cleanup` `{ ids:[…≤50] }` | Delete my test rows | `{ success, deleted, requested }` (DELETE … `AND user_id = me`) |

---

## 5. Phase 1 — synchronous verdict

Control flow in `analyze-offer.js` (line refs at commit `97cd2d3b`):

1. **Normalize + mode** (`:189-215`): multipart (file present) vs JSON. Multipart sets
   `source` default `siri_vision`; JSON default `siri_shortcut`.
2. **Token** (`:218`): header `x-shortcut-token`, else body `shortcut_token`.
3. **GPS** (`:228-233`): 6-decimal round; `market = "lat.1_lng.1"` bucket.
4. **Pre-parse** (`:237`): `parseOfferText(text)` when text present (§8).
5. **Images** (`:260-289`): strip data-URL prefix and whitespace; **downscale** when
   >250 KB (`downscaleOfferImage` → 820 px JPEG q80; fail-open; Phase 2 reuses the same
   `images[]`). Log line: `[HOOKS] Vision mode: NKB base64 (mime) — downscaled from MKB`.
6. **Ruleset** (`:294`): `resolveRuleset(token)` → `{ ruleset, userId, version, hash }` (§7).
7. **Tier** (`:300-301`): `classifyTier(preParsed?.product_type, ruleset)`; if `share` and
   `ruleset.share.auto_reject === false` → treated as `standard`.
8. **Prompt** (`:306-308`): text → `buildPhase1Prompt(tier, ruleset)`; image-only →
   `buildPhase1VisionPrompt(ruleset)` (multi-tier; the model identifies the product).
9. **Share short-circuit** (`:311-327`): returns immediately, no model.
9b. **SANITY TRIPWIRE — text lane, seat (2)** (v3.2, 2026-08-26): when the pre-parse
    carries a price, `checkSanity(preParsed, ruleset)` (§6.3) runs **before any model
    call**. A breach answers `NO DATA` with `reason "$163.04/mi implausible — decide
    manually"`, `reason_kind 'implausible_parse'`, voice `"No data. Numbers look wrong.
    Decide manually."` — deterministic, so it is settled for replay. Why here: on
    2026-08-24 the model was handed `PRE-PARSED: $750 … $163.04/mi` and echoed ACCEPT;
    asking it is pointless once the numbers are impossible.
9c. **DELIVERY LANE — text** (v3.2): `tier === 'delivery'` (product `Delivery…`, §8) is
    decided entirely by `evaluateDelivery` — no model call; no judgment rule exists for a
    delivery (no rating, no Verified, no pickup split). `delivery.enabled:false` → `NO
    DATA` `reason 'delivery off'`, voice `"No data. Delivery offers are off in your rules."`.
10. **FAST LANE — deterministic REJECT** (`:359-378`): gate = `text` present **and**
    `preParsed.parse_confidence === 'full'` **and** `per_mile != null`. Runs
    `evaluateDeterministic(tier, preParsed, ruleset)`; **only a `REJECT` answers here**
    (ACCEPT / NO DATA continue to the model). Notices are regex-detected from the same
    text the model would read, only for notice keys the driver enabled:
    `on_the_way_filter` ← `/\bon the way\b/i` → `Filter Detected`; `verified_rider` ←
    `/\bverified\b/i` → `Verified Rider`. (`deadhead_reduction` is a map visual — not
    detectable on the text lane by anyone; parity.)
    **Parity theorem (why REJECT-only is safe under ANY ruleset):** every prompt-side
    judgment rule (avoid zones, safety road types, multiple stops / round trip,
    `require_verified`, rating) is REJECT-only in a first-match ladder, so nothing the
    model could see can rescue an engine REJECT. Engine ACCEPTs still go to the model,
    which owns the judgment rules.
11. **MODEL LANE** (`:385-437`): `callModel('OFFER_ANALYZER', { system, user, images })`
    inside a **20 s** `Promise.race`. User message: `PRE-PARSED: $… | …min/…mi pickup |
    …min/…mi ride | $…/mi | product` one-liner (omitted at `minimal` confidence) +
    `Offer text: "…"`; or `Analyze this ride offer screenshot.` for image-only.
    JSON extraction via `parseModelJson` (`server/lib/offers/parse-model-json.js`): strip
    fences → `JSON.parse` (unwraps `parsed_data`) → slice first `{` … last `}` → **repair a
    missing closing brace** (live-observed on gemini-3.5-flash, 7/42 calls) → **trim a
    surplus closing brace** (string-aware balanced scan; live-observed on gemini-3.1-pro
    Phase 2, 1/3 calls, 2026-08-17 — before this tier the deep result and the card
    addresses were lost) → else deterministic. Then the **honest-floor guard**: a parsed reply with no `decision`, or with
    all-zero `per_mile`/`total_miles`/`price` ("no ride"), also goes to the deterministic
    engine. Any model failure/timeout/non-success → deterministic. **The rules always answer.**
12. **Deterministic answer-of-last-resort** (`deterministicPhase1`, `:333-350`):
    `evaluateDeterministic(tier, preParsed || {}, ruleset)`; `NO DATA` when `per_mile`
    is null → `{ decision:'NO DATA', reason:'no data', confidence:0 }`; else
    `{ decision, reason: terseReason(kind, per_mile, total_miles.toFixed(1), tier),
    confidence:80, fallback?:true, …preParsed }`.
13. **Vision tier refinement** (`:439-444`): if image-only and the model returned
    `product`, `effectiveTier = classifyTier(product, ruleset)` — used for the Phase-1 log
    line, the Phase-2 `TIER:` context, and the vision arbitration below. Terse-reason tier
    tags on the text path come from the OCR `tier`; stored `product_type` flows from
    `preParsed?.product_type ?? dbParsedData?.product_type`.
13b. **Vision arbitration** (image-only, 2026-08-17): code owns the arithmetic. `per_mile`
    is recomputed from the model's `price / total_miles`, and `evaluateDeterministic` is
    re-run on the extracted numbers (`price, total_miles, total_minutes, per_mile,
    per_minute, pickup_*, rating` — the vision template now carries `rating`, 0 = not
    shown). **Engine REJECT overrides a model ACCEPT** (floor / pickup / time / max-miles /
    rating / ARP miss can never be rescued by what the model saw). **Engine ACCEPT
    overrides a model REJECT only when the model's `judgment_reject` is empty** — a
    non-empty value (`avoid:…`, `safety`, `verified_missing`, `stops`, `round_trip`,
    `share`) is the model's call and stands. Engine `NO DATA` leaves the model's answer
    alone. Why: live cards showed the model summing 1.9 + 4.2 mi as ~6.3 → $1.34 vs the
    true $1.40 against a $1.35 floor → wrong REJECT; near-floor offers are the common case.
    **v3.2 additions:** (a) money strings are coerced currency-tolerantly (`"$750"`,
    `"1,234.50"`) — an uncoercible field used to become `null`, and a null money field is
    invisible to every gate, so the model's ACCEPT could stand on numbers nothing checked
    (review 2026-08-26); (b) engine `NO DATA 'implausible_parse'` on the extracted numbers
    **overrides any model decision** (seat 3a — the model read impossible numbers; nobody
    ACCEPTs on them); (c) `effectiveTier === 'delivery'` (model `product` `"Delivery…"`,
    matched case-insensitively — the model writes that string itself) → **the engine owns
    the verdict, including its `NO DATA`**: `evaluateDelivery` runs on the model's
    `price / total_miles / total_minutes`, and when the numbers its floors need are missing
    the answer is NO DATA, not the model's guess (an unreadable delivery could otherwise be
    spoken as ACCEPT with no hourly check). The vision template carries `tip_included` for
    the call-out.
13c. **SANITY TRIPWIRE — final gate, seat (3b)** (v3.2): after arbitration and before the
    decision fields are read, `checkSanity` runs once more on exactly the numbers the
    notification will render (`preParsed ?? phase1Result` for price / miles / minutes /
    per_mile, plus `price_format`). Covers the text-lane **model** answer when the
    pre-parse had no price. A breach replaces whatever was decided with the
    `implausible_parse` NO DATA. Fail loud, never fake.
14. **Normalize decision fields** (`:447-486`): `decision = phase1Result.decision || 'REJECT'`
    (unreachable-by-design after the guard above); `reason = reason || reasoning || ''`;
    numerics coerced via `toNum` (vision JSON may carry strings). **Code owns the
    arithmetic:** on the vision path `per_mile` is recomputed from the model's
    `price / total_miles` (the model's own $/mi wobbled 1.34–1.40 for one card) and the
    terse reason's leading dollar figure is aligned to it. Fallback terse text
    `"$X.XX Y.Ymi"` when the model gave none.
15. **Display strings** (`:477-487`): `decisionLabel = 'ACCEPT (FALLBACK)'` when
    `phase1Result.fallback === true`; `notices` filtered (strings ≤40, max 4);
    `notification = "<label>: <terse>"` + `" | n1 | n2"`.
15b. **Verdict/voice consistency** (v3.2, review 2026-08-26): `buildVoiceLine` falls back to
    "No data. Decide manually." whenever the rate or the miles cannot be rendered. If that
    happens while the decision still claims ACCEPT/REJECT, the phone would *say* one thing
    and *show* another, on numbers we could not print — so the verdict becomes the one the
    driver already heard: `NO DATA`, logged with the reason it replaced, never cached for replay.
16. **Respond** (`:495-509`): `voice = buildVoiceLine(decision, perMile, totalMi, terse)`
    (§9). Then Phase 2 kicks off (§10). **v3.2:** a delivery verdict always carries
    `| $N/hr` (the hourly IS the delivery decider) and `| tip incl.` when the card said
    "Includes expected tip"; an `implausible_parse` NO DATA **does** run Phase 2 and store
    (it is a real offer we could not judge — amber on the Offers card, forensics one click
    away), unlike a plain NO DATA which still skips everything (Melody 2026-08-17).

Log lines you will see: `[HOOKS] 📱 Incoming from <device> (<source>)`, `[HOOKS] 📊
Pre-parsed: …`, `[HOOKS] Ruleset resolved: user=… v…`, `[HOOKS] 🔧 Fast lane (model
skipped): REJECT — …`, `[HOOKS] ⚡ PHASE 1: Calling OFFER_ANALYZER (Flash) [tier]
[vision]…`, `[HOOKS] ⚡ Phase 1 responded in Nms: DECISION $x/mi [tier]`.

---

## 6. Rules engine (`rules-engine.js`)

**File:** `server/lib/offers/rules-engine.js` (849 lines). `RULESET_SCHEMA_VERSION = 3`.
One config object is the single source: it **renders** the Phase-1 text prompt, the
Phase-1 vision prompt, and the Phase-2 prompt, **and** drives the deterministic
evaluator — the no-drift invariant. `DEFAULT_RULESET` is deep-frozen (`:152-158`) because
it is handed out by reference to every untokened request.

### 6.1 Two enforcement lanes

| Lane | Rules | Where |
|---|---|---|
| **Deterministic** (code is the authority on arithmetic) | rating floor (when a rating is present), pickup limits, $/mi floor, $/min floor, total-time limit + pay-conjunction escape, accept ladder, acceptance-rate protection (ARP), too-far/low terminal reject | `evaluateDeterministic` `:307-421` |
| **Vision-judgment** (rendered into prompts; model applies) | safety road types, `require_verified`, avoid-places (by label), multiple stops, round trip, commercial-staging guidance, notices | `renderRuleLines` `:432-488`, `renderGuidanceLines`, `noticesLine` |
| **Deterministic geo audit** (Phase 2, post-geocode) | `avoid[]` re-checked by geometry; vision-vs-geometry disagreement stored as training data | `evaluateGeoRules` `:807-849` |

### 6.2 `DEFAULT_RULESET` (v3; every v3 addition is inert at default → parity with legacy)

```jsonc
{
  "schema_version": 3,
  "basis": "full_ride",                    // 'full_ride' = total (pickup+ride) | 'active_time' = ride only
  "global": {
    "rating_floor": 4.85,
    "require_verified": true,              // prompt-only gate
    "pickup_limits": null,                 // { max_miles, max_minutes }
    "time_limit": null,                    // { max_total_minutes, unless: { min_per_mile, min_per_minute } }
    "acceptance_rate_protection": null,    // { min_per_total_mile }  → ACCEPT (FALLBACK)
    "auto_reject": null,                   // { multiple_stops, round_trip }  (vision lane)
    "safety_road_types": false,            // vision lane
    "commercial_staging": false,           // vision guidance
    "notices": null                        // { verified_rider, on_the_way_filter, deadhead_reduction, hourly_rate }  hourly_rate (v3.1) = show computed $/hr — telemetry, never a decider
  },
  "share": { "auto_reject": true },
  "delivery": { "enabled": true, "min_per_mile": 1.50, "min_per_hour": 25, "max_total_miles": 12 },  // v3.2 (2026-08-26) — delivery lane; $/hr IS a decider here. Placeholders from the 2026-08-24 brief — Melody to set
  "sanity":   { "max_price": 500, "max_per_mile": 30, "max_per_hour": 300, "min_price": 1 },        // v3.2 — implausible-parse ceilings (checkSanity); breach → NO DATA, never a guess. Wide on purpose: ×100 decimal drops trip every one; legit surge hops trip none
  "tiers": {
    "standard": { "floor_per_mile": 0.90, "floor_per_minute": null, "max_total_miles": null, "accept_ladder": [   // max_total_miles: v3.1 slider (2026-08-17) → REJECT too_far
      { "min_per_mile": 0.90, "max_total_min": 20 },
      { "min_per_mile": 1.10, "max_total_min": 25 },
      { "min_per_mile": 1.75, "max_total_min_excl": 30 },
      { "min_per_mile": 2.00, "min_total_min": 30, "max_total_min": 40 },
      { "min_per_mile": 2.00, "min_total_min_excl": 40 } ] },
    "premium":  { "floor_per_mile": 1.10, "floor_per_minute": null, "max_total_miles": null, "accept_ladder": [
      { "min_per_mile": 1.10, "max_total_min": 25 },
      { "min_per_mile": 1.40, "max_total_min": 30 },
      { "min_per_mile": 1.75, "max_total_min": 40 },
      { "min_per_mile": 2.00, "min_total_min_excl": 40 } ] },
    "comfort": null,                       // optional split-out tier (same shape as standard)
    "xl": null
  },
  "tier_products": null,                   // { comfort:[…], xl:[…] } overrides product routing
  "geo": { "home_city": {enabled:false, overrides:{}}, "other_city": {…}, "airport": {…} },  // caller-scoped overrides; NOT wired by any caller today
  "avoid": [],                             // [{ place_id, label, lat, lng, mode, radius_mi?, corridor_deg?, min_trip_mi?, enabled }]
  "home": null                             // { deadhead_only, mention_threshold_min } — declared; not consumed by the evaluator/prompts yet
}
```

Rung semantics: ACCEPT when `per_mile >= min_per_mile` AND (`min_per_minute` null or
`per_minute >=`) AND every present bound holds (`min_total_min` inclusive,
`min_total_min_excl` exclusive, `max_total_min` inclusive, `max_total_min_excl` exclusive).
Unknown duration counts as **999 min** (legacy parity).

Tier routing (`classifyTier` `:211-223`): base tier from `parse-offer-text.js`
(`share` = `Share`, `Lyft Shared`; `premium` = `Comfort, VIP, Black, UberXL, UberXL
Exclusive, Lyft XL, Lyft Lux, Lyft Black`; **`delivery` = product `Delivery` /
`Delivery Exclusive` (v3.2)**; else `standard`, including unknown/null).
When the ruleset enables `tiers.xl` / `tiers.comfort`, premium products route by
`tier_products` if set, else `DEFAULT_XL_PRODUCTS = [UberXL, UberXL Exclusive, Lyft XL,
VIP, Black, Lyft Lux, Lyft Black]`, `DEFAULT_COMFORT_PRODUCTS = [Comfort]`.

`migrateRuleset(config)` (`:172-203`) upgrades any stored v1/v2/partial config to the full
v3 shape with inert defaults; called on every read and before every write; idempotent.
v3.2 keys (`delivery`, `sanity`) are filled the same way — `schema_version` stays `3`
(additive keys; stale clients strip what they don't know and the server re-fills defaults).

### 6.3 Deterministic gate order and reason kinds (`evaluateDeterministic`)

```
share (auto_reject≠false) → REJECT 'share'
SANITY breach (v3.2)       → NO DATA 'implausible_parse'   (problems[] names every signal; never rescued, never repaired)
tier delivery (v3.2)       → evaluateDelivery: enabled:false → NO DATA 'delivery_off' · per_mile null (or minutes null with an hourly floor) → NO DATA 'no_data' · miles > max_total_miles → REJECT 'delivery_too_far' · $/mi < min_per_mile → REJECT 'delivery_low_mi' · $/hr < min_per_hour → REJECT 'delivery_low_hr' · else ACCEPT 'delivery_accept' (tipThin when tip_included and a floor is cleared by < 15 %)
per_mile null              → NO DATA 'no_data'
rating < rating_floor      → REJECT 'rating'          (never rescued)
pickup_limits exceeded     → REJECT 'pickup'          (never rescued)
[ARP disabled] per_mile < floor_per_mile      → REJECT 'floor'
[ARP disabled] per_minute < floor_per_minute  → REJECT 'min_floor'
time_limit exceeded && !unless-conjunction    → REJECT 'time_limit' (never rescued)
miles > tier max_total_miles (v3.1)           → REJECT 'too_far'
accept ladder, first match                    → ACCEPT 'accept'
[ARP enabled] per_mile >= min_per_total_mile  → ACCEPT 'accept_fallback' (fallback:true)
[ARP enabled] deferred floor misses           → REJECT 'floor' | 'min_floor'
minutes > 40                                  → REJECT 'too_far'
else                                          → REJECT 'low'
```

ARP semantics are the spec's: it rescues **profitability** failures only — floors defer
to it when it is enabled; rating/pickup/time rejects are never rescued.

`terseReason(kind, perMile, totalMiles, tier)` (`analyze-offer.js:129-150`) turns kinds
into the wire `reason`: base `"$X.XX Y.Ymi"` + kind word (`fallback`, `floor`, `min`,
`pickup`, `over time`, `too far`, `rating`, `low`) + tier tag (` prem` / ` comf` / ` xl`;
`rating` carries no tag). v3.2 delivery kinds: `delivery` (accept), `delivery too far`,
`delivery low`, `delivery low hourly`; `delivery off`. The implausible reason is built by
`implausibleResult()`: `"$X.XX/mi implausible — decide manually"`.

**`checkSanity(raw, ruleset)` (v3.2) — the implausible-parse tripwire.** Pure arithmetic
over whatever money fields exist:

| Signal | Rule |
|---|---|
| Absurd total | `price > sanity.max_price` (500) · `price < sanity.min_price` (1). `price = 0` is "not read", never a breach |
| Negative | any negative `price` / `total_miles` / `total_minutes` — a broken extraction, not a missing one |
| Absurd rate | `$/mi > max_per_mile` (40) · `$/hr > max_per_hour` (500) — **only when the denominator is meaningful** (≥ 1 mi, ≥ 5 min): a $30 minimum-fare hop over 0.4 mi is a real offer, and the first draft turned those into "No data" (review 2026-08-26) |
| **Decimal drop** | a price written **with no cents** (`price_format:'integer'`) is the OCR signature — platform prices are always cents-precise. Trips at `price ≥ 100`, **or** at `$/mi > max_per_mile_no_cents` (10) / `$/hr > max_per_hour_no_cents` (200). This closes the one-glyph variants (`$750`→`$75O`, `$7.50`→`$75`) that the magnitude rule alone missed |

Applied at three seats (§5 9b, 13b, 13c). Ceilings are per-driver, but a stored `null` is
re-filled with the default by `migrateRuleset` — the tripwire is a safety floor, not a taste
knob. Origin: live incident 2026-08-24 — the phone's OCR sent `$750` for `$7.50`; the driver
heard "Accept. 163 dollars four per mile… about 2368 dollars an hour". Fixtures:
`tests/offers/fixtures/README.md` D2.

**Accepted limits (⚖️ Melody; adversarial review 2026-08-26):**
- **A ×10 *miles* misread is not caught** — `4.6 mi` read as `46 mi` gives `$0.16/mi` and a
  spoken REJECT built on wrong numbers. No lower bound separates it from a genuinely bad
  long offer without refusing real ones, and the direction is safe (a REJECT, never a wrong
  ACCEPT). Documented rather than guarded.
- **This IS a behavior change for rides at defaults** — a card whose numbers breach the
  table above now answers NO DATA where it previously answered ACCEPT/REJECT. That is the
  point; the ceilings sit where only impossible numbers reach them.
- A driver on `basis: 'active_time'` now sees the reason/notification `$/mi` the **engine
  decided with** (the active-time figure) instead of the full-ride pre-parse figure — the
  two used to disagree.

### 6.4 Prompt renderers (all from the same ruleset)

| Function | Used for | Notes |
|---|---|---|
| `buildPhase1Prompt(tier, ruleset)` (`:560-611`) | Text requests (tier known from OCR) | Byte-identical to legacy prompts at defaults (pinned test). Numbered first-match rules in evaluator order; math line reflects `basis`; guidance + notices lines appended when enabled; JSON template gains `pickup_*`, `fallback`, `notices` keys only when those rules are enabled |
| `buildPhase1VisionPrompt(ruleset)` (`:621-693`) | Image-only requests | Global gates once (per-tier lines — floors, `max_total_miles` — excluded since 2026-08-17), then each enabled tier's floors/cap/ladder; the model fills `"product"`; premium header lists only products that still route to premium; ARP line re-appended after tiers |
| `buildPhase2Prompt(ruleset)` (`:703-758`) | Deep async extraction | Full-extraction JSON contract (§10.2), GATES + per-tier RULES + SHARE + GENERAL guidance; explicitly "do NOT assume any specific metro" |

Prompt-side rule text (rendered only when enabled): safety road types; `REJECT if rating
visible and <X`; `REJECT if "Verified" missing`; avoid rules by mode —
`destination_in` → "in or within ~R mi of LABEL", `north_of`/`south_of`, `heads_toward`
→ "trip heads toward LABEL[ (within about D degrees of the direction to it)] and ride_mi>=N" (default 8; the corridor phrase appears only when `corridor_deg` ≠ 30 — 2026-08-17, the last editor control that had been Phase-2-only); multiple stops; round trip;
pickup limits; floors (suppressed when ARP enabled — they defer); time limit with unless;
ACCEPT rungs; `ACCEPT with "fallback":true if $/mi>=ARP`; terminal `REJECT.`

`NOTICE_LABELS = { verified_rider:'Verified Rider', on_the_way_filter:'Filter Detected',
deadhead_reduction:'Deadhead Reduction Pickup' }` (`:528-532`).

### 6.5 Geo audit (`evaluateGeoRules`)

Pure geometry over geocoded `pickup`/`dropoff` (`geo.js` haversine/bearing helpers):
`destination_in` → dropoff within `radius_mi` (default 6) of anchor; `north_of`/`south_of`
→ latitude compare; `heads_toward` → trip ≥ `min_trip_mi` (8) AND pickup→dropoff bearing
within `corridor_deg` (30) of pickup→anchor AND dropoff closer to anchor than pickup was.
Returns `[{ place_id, label, mode, result:'violated'|'clear'|'no_data' }]`.

### 6.6 Write-time validation (`ruleset-schema.js`)

Zod, `.strict()` everywhere, v3-exact (`schema_version` literal 3). Bounds: money 0–50,
minutes 0–600 int, miles 0–500; ladder ≤12 rungs; `avoid` ≤25 places (`corridor_deg`
5–90); `tier_products` lists ≤20; `rating_floor` 0–5. `validateRuleset(config)` →
`{ ok, config }` or `{ ok:false, errors:['path: message', …] }` (PUT returns 422 with
`details`). Read path never validates — it fail-opens (§7).

### 6.7 Spec → v3 mapping (Melody's verbatim spec → editable keys)

| Spec item (`docs/OFFER_ANALYZER_DRIVER_RULESET.md`) | v3 key / behavior |
|---|---|
| Rate targets (UberX $1.00/mi + $0.50/min; Comfort $1.25 + $0.70; XL $2.00 + ~$1) | `tiers.standard/comfort/xl` floors + per-rung `min_per_minute` |
| Rider quality 4.90 | `global.rating_floor` |
| Verified → "Verified Rider" | `global.require_verified` + `notices.verified_rider` |
| Uber Share / Lyft Shared / Multiple Stops / Round Trip | `share.auto_reject`, `global.auto_reject.{multiple_stops, round_trip}` |
| Heads toward Fort Worth / Denton / Garland; north of US-380 | `avoid[]` entries (user-picked places, modes `heads_toward` / `north_of`) |
| Safety road types | `global.safety_road_types` |
| Commercial staging | `global.commercial_staging` |
| On-the-way filter / "…" map marker | `notices.on_the_way_filter` / `notices.deadhead_reduction` |
| Time limits (pickup+trip > 20 unless $2/mi AND $1/min) | `global.time_limit` |
| Pickup limits (3 mi / 8 min) | `global.pickup_limits` |
| Acceptance Rate Protection ($1.00/total mile) | `global.acceptance_rate_protection` → `ACCEPT (FALLBACK)` |
| Home / deadhead logic | `home` key declared; **not consumed yet** (roadmap) |
| Decision priority order | evaluator gate order (§6.3) + prompt rule order |
| Output format lines / analysis-source line | Not implemented as spec'd: the wire contract is `decision` + terse `reason` + `notices` (`voice`/`notification`) — see roadmap |
| Error Handling string; "unless exceptional pay offsets" escapes (pickup limits, US-380); Estimated Return miles; Vision-over-OCR priority | Not implemented as spec'd (server uses text and image together, regex numbers preferred over model numbers) — roadmap L7 |

**Important:** `DEFAULT_RULESET` is **legacy parity**, not Melody's spec values (standard
$0.90/mi, premium $1.10/mi, rating 4.85, no per-minute floors, comfort/xl off). Her spec
values (UberX $1.00 + $0.50/min, Comfort $1.25 + $0.70, XL $2.00 + ~$1, rating 4.90, pickup
3 mi/8 min, time 20 min unless $2/mi AND $1/min, ARP $1.00) reach the engine only through
her saved `offer_rulesets` row (and the `melodySpec()` fixture in
`tests/offers/rules-engine-v3.test.js`).

---

## 7. Identity bridge and ruleset store

**Token:** `driver_profiles.shortcut_token varchar(43) UNIQUE` = `"vp_"` + 40 base62
chars (~238 bits; `ruleset-hash.js:generateShortcutToken`), plus `shortcut_token_created_at`,
`shortcut_device_label`. Minted get-or-create by `GET /api/offer-analyzer/shortcut-token`;
rotated by `POST …/regenerate` (old token dies immediately — cache busted). One token per
user, shared by all their devices.

**Resolution (`ruleset-store.js:resolveRuleset(token)`):** `driver_profiles.shortcut_token`
→ `user_id` LEFT JOIN `offer_rulesets` → `migrateRuleset(config)` →
`{ ruleset, userId, version, hash }`.

| Situation | Result | Log |
|---|---|---|
| No token | `DEFAULT_RULESET`, `userId:null`, `version/hash:null` | — |
| Unknown token | defaults (not cached — attacker input must not grow the map) | `[ruleset-store] Unknown shortcut token — applying DEFAULT_RULESET…` (warn) |
| Known driver, no saved rules | defaults **with identity** (offer stored under `user_id`, `ruleset_hash NULL`) | — |
| Known driver + rules | their v3 ruleset + version + `config_hash` | — |
| DB error | defaults; fail-open LOUD | `[ruleset-store] Ruleset load failed (…) — applying DEFAULT_RULESET` (error) |

Cache: in-process `Map`, TTL **15 s**, max 500 entries (oldest evicted); `invalidateUser`
after PUT/regenerate. Cloud Run multi-instance edits converge within TTL.
**Tokens are per deployment** (dev ≠ prod DB): a dev-minted token sent to prod is an unknown
token → default rules, `ruleset_hash NULL`, and (with no GPS) no stored row — silently
except for the `[ruleset-store] Unknown shortcut token` warn.

**Provenance stamps** on every stored offer: `user_id`, `ruleset_version`, `ruleset_hash`
(`NULL` hash = defaults applied — visible, never silent). Hash = sha256 of canonical
sorted-key JSON (`hashRuleset`).

---

## 8. Pre-parser (`parse-offer-text.js`)

Pure regex, <1 ms, inputs >5000 chars are refused by the pair/advantage extractors
(ReDoS guard). `parseOfferText(rawText)` returns:

```
price, hourly_rate ($X/active hr), pickup_minutes, pickup_miles, ride_minutes, ride_miles,
total_miles, total_minutes, per_mile (price/total_miles, 2dp), per_minute, surge,
product_type (canonical), advantage_pct, platform_hint ('uber'|'lyft'|'unknown'),
parse_confidence ('full' | 'partial' | 'minimal'),
price_format ('cents' | 'integer' | null), offer_kind ('ride' | 'delivery'), tip_included   // v3.2
```

- Pairs: `/(\d+)\s*min(?:s|utes?)?\s*\((\d+(?:\.\d+)?)\s*mi\)/gi` — first = pickup, second
  = ride. One pair → pickup only if it precedes "Avg. wait time", else ride.
- Confidence: `full` = price + ≥2 pairs; `partial` = price + 1 pair or price alone;
  `minimal` = no price. **The fast lane requires `full`.** Delivery: `full` = price + the
  one `total` line.
- **Delivery cards (v3.2):** the **shape decides**, never the word. `deliveryProduct()`
  finds a `Delivery` / `Delivery Exclusive` chip (tolerant of leading OCR glyph junk — the
  live card read "YP Delivery Exclusive"), but it becomes `product_type` only when
  `isDeliveryCard()` agrees: **two time-distance pairs is always a RIDE**, and otherwise the
  card needs a `N min (X mi) total` line (`extractTotalPair`), an "Includes expected tip"
  line, or at most one pair. A real UberX/Comfort ride whose card contains "1200 Delivery
  Dr", a restaurant name, or on-screen chrome therefore keeps its own brand and its own
  rules — the first implementation let `extractProductType` claim the word before the ride
  brands, and four independent review lenses caught rides being judged by delivery floors
  with the rating / Verified / pickup gates skipped (2026-08-26). `analyze-offer.js` routes
  on `preParsed.offer_kind`, not on the product string. For a delivery the single pair is
  the **total** (store leg + drop leg): `total_*` set, `pickup_*` / `ride_*` null, no
  pickup-vs-trip logic.
- `price_format`: `'cents'` when the winning `$` candidate had a decimal point,
  `'integer'` otherwise (`extractPriceDetailed`). Feeds the sanity gate (§6.3).
- Canonical products: `UberXL Exclusive`, `UberXL`, `UberX Exclusive`, `UberX Priority`,
  `UberX`, `Uber`, `Lyft XL`, `Lyft Lux`, `Lyft Black`, `Lyft Shared`, `Lyft Priority`,
  `Lyft`, `Comfort`, `VIP`, `Black`, `Share`.
- Surge: `+$X included for priority…` bonus, or `* X.XX` / `$ X.XX` markers (skips
  4.70–5.00 rating look-alikes and `/active hr`).
- `formatPerMileForVoice(1.57)` → `"dollar fifty-seven per mile"`; `0.93` →
  `"ninety-three cents per mile"`; `2.00` → `"two dollars per mile"`; `0` → `"zero per mile"`;
  ≥ $100 → `"163 dollars four cents per mile"` (v3.2 hardening — unreachable once the
  sanity gate answers, but never "163 dollars four" again).

Melody's parse contract (todo #10 (d)): first address = pickup, second = destination;
leading min/mi = driver → pickup; second = pickup → drop-off. Addresses are extracted by
the model (Phase 2), not by regex.

---

## 9. Voice / notification builders

`buildVoiceLine(decision, perMile, totalMiles, reason)` (`analyze-offer.js:90-127`):

| Condition | Output |
|---|---|
| `NO DATA` with an `implausible` reason (v3.2) | `"No data. Numbers look wrong. Decide manually."` |
| `NO DATA` with reason `delivery off` (v3.2) | `"No data. Delivery offers are off in your rules."` |
| `perMile` or `totalMiles` null/NaN | `"No data. Decide manually."` |
| delivery (v3.2) | `"<Accept|Reject>. <perMileSpoken>, <X.X> miles total, delivery[, <qualifier>][, about N dollars an hour][ — expected tip included, actual can run lower if the customer trims it]."` — hourly spoken on a `low hourly` reject or when the $/hr switch is on; the tip call-out only on an ACCEPT that clears a floor by < 15 % with the tip counted in (never silently discounts the fare) |
| otherwise | `"<Accept|Reject|No data>. <perMileSpoken>, <N> mile(s)[, <qualifier>]."` |

Qualifier map (first match in the terse reason wins): `too far`→", too far";
`rating`→", low rider rating"; `fallback`→", fallback accept"; `pickup`→", long pickup";
`over time`→", too long"; `floor`→", below floor"; `low hourly`→", below your hourly floor"
(v3.2, delivery); `low`→", rate too low". (`min` — the `min_floor` kind — has no spoken
qualifier today.) Miles rounded to whole numbers (deliveries: to the tenth, "total").

**ARP is always spoken (2026-08-17, Melody: "as long as ARP is in the voice, it tells me to
take it and I do"):** the notification label `ACCEPT (FALLBACK)` keys on the `fallback` flag
(engine `accept_fallback`, or a model-marked fallback, or vision arbitration), and the voice
now keys on the same flag — `, fallback accept` is appended whenever the flag is set, even
when the model's reason text doesn't contain the word (before: engine path spoke it, model
path could show FALLBACK but speak a plain "Accept").

Special literals: share → `"Reject. Share tier."`; 500 → `"Analysis failed. Decide manually."`.
When `global.notices.hourly_rate` is on, a tail `, about N dollars an hour` is appended (N =
pay ÷ total minutes × 60, computed server-side) and `$N/hr` joins the notification notices.

Fixed 2026-08-17: a **non-offer screenshot** (every vision model returns REJECT with all-zero
metrics) is now routed to the rules engine by the honest-floor guard and speaks
`"No data. Decide manually."` (verified live on the endpoint).

---

## 10. Phase 2 — asynchronous enrichment

Runs in an async IIFE after `res.json()`; nothing here can delay the spoken answer.

**Not run for `NO DATA` (2026-08-17, Melody: "if the quick one says no offer, we should just
not parse it — no reason to send it to the big model").** A `NO DATA` verdict stops after
Phase 1: no deep model, no geocode / Places / Timezone calls, **no row** (log line
`NO DATA — Phase 2 skipped`). One exception: on the **vision** lane when the fast model did
not deliver (`phase1Authoritative=false` — timeout / unparseable reply) the screenshot may
still be a real offer, so Phase 2 runs and the deep model gets to read it. Share
auto-rejects already returned before Phase 2 (todo #55).

### 10.1 Deep call

`callModel('OFFER_ANALYZER_DEEP', { system, user, images })` inside a **45 s** race.
System prompt = `buildPhase2Prompt(ruleset)` + `Driver GPS: lat, lng (market: …)` (when
coords) + `TIER: <EFFECTIVE> (<product>). Apply <tier> rules above.` + `PRE-PARSED DATA
(server-verified)` block (when confidence ≠ minimal). User = `Offer text: "…"` or
`Analyze this ride offer screenshot in detail.` Same downscaled `images[]` as Phase 1.

### 10.2 Deep JSON contract (rendered by `buildPhase2Prompt`)

```json
{ "parsed_data": { "price", "miles", "pickup_minutes", "pickup_miles", "ride_minutes", "ride_miles",
                   "pickup", "dropoff", "platform", "surge", "per_mile", "rider_rating", "verified",
                   "product_type", "multiple_stops", "round_trip", "on_the_way", "map_ellipsis", "road_flags" },
  "decision": "ACCEPT|REJECT", "reasoning": "2-3 sentences", "confidence": 0-100,
  "location_analysis": { "dropoff_zone": "core|deadhead|fringe", "return_difficulty": "easy|moderate|hard", "area_demand": "high|medium|low" } }
```

### 10.3 Merge rules

- `ai_model` = the model Phase 2 **actually** ran (`phase2Response.model`), else the model
  Phase 1 actually ran (`phase1Response.model`), else `'rules-engine-deterministic'`
  when no model answered (honest telemetry — lessons_learned #9). Caveat: if an adapter
  response lacks `.model`, the code falls back to the literals `'gemini-3.5-flash'` /
  `'gemini-3.1-pro-preview'` (`:562-563`, `:582`) — literals that can drift from the
  registry; adapters normally set `.model`.
- `decision` stored = **what was spoken** (Phase 1). Deep dissent → `parsed_data_json.
  deep_decision`, `deep_disagrees`, and `decision_reasoning` prefixed
  `[deep model dissents: X] `.
- Metrics prefer regex pre-parse → deep `parsed_data` → Phase-1 JSON (vision-only rows
  therefore carry model-extracted metrics instead of NULLs).
- `parsed_data_json` = `{ …preParsed, …dbParsedData, per_mile, per_minute, location_analysis,
  deep_decision, deep_disagrees, timezone_source }` + the resolution/audit keys of §10.6.

### 10.4 Timezone and temporal columns (no fallbacks)

Every path is **coordinates → `resolveTimezoneFromCoords` (Google Timezone API)** — never a
blanket/market/device timezone (`app_rules.timezone-gps-only`). Order (2026-08-17, Melody:
*"resolve the timezone from the offer's address — the first address on the screen"*):

1. **Offer GPS** (`latitude`/`longitude` in the request) → Timezone API. `timezone_source='gps'`.
2. **Pickup address** — the first address on the card (parse contract,
   `docs/OFFER_ANALYZER_DRIVER_RULESET.md`) resolved to a **trusted point** by §10.6 → Timezone
   API. `timezone_source='pickup_address'`. If the driver's snapshot timezone differs, a
   `console.warn` audit line records it (a trusted pickup in another zone = the driver moved
   since the app was last opened; the offer-scoped value is stored).
3. **Tokened driver's snapshot** — `users.current_snapshot_id → snapshots.timezone` (GPS-resolved
   when the app was opened). `timezone_source='snapshot'`.
4. **Nothing real → the row is not stored** (`console.error … offer NOT stored`, listing what
   was tried: coords absent/failed, pickup absent/unresolvable, tokened-without-snapshot).

Then `local_hour`, `day_of_week`, `day_part` (`getDayPartKey`), `is_weekend`, `local_date`
via `shared/dayparts.js` (re-export shim `server/lib/location/daypart.js`).

> Why step 2 exists: the canonical shortcuts send **no GPS** (prod audit 2026-08-17: 0 of 69
> recent rows), so before this every stored row's timezone rode on the driver's last app
> snapshot — session-scoped, stale the moment they work away from where they last opened the
> app — and an untokened request (or a tokened driver with no session) was never stored at
> all (the 07:30 CT field-test offer). The pickup address is offer-scoped truth printed on
> every card. Consequence: a tokened driver with a fresh app snapshot (≤ 12 h) gets the
> pickup resolved against that anchor; a driver with **no** session (or an untokened request)
> is stored when the card's pickup **and** dropoff corroborate each other (both city-confirmed,
> within a ride length — the common two-address Uber card). Nothing is ever stored on a
> guessed geocode (§10.6).

### 10.5 Session bucketing and INSERT (one locked transaction since 2026-08-17)

Session chain: by `user_id` when tokened; else by `device_id` where `user_id IS NULL`;
else fresh. Same session if ≤1800 s since the previous offer; `offer_sequence_num`
increments; `seconds_since_last` recorded.

Since 2026-08-17 (race review finding #3) the last-offer read, the INSERT and the NOTIFY run
in **one `db.transaction`** under a per-driver advisory lock
`pg_advisory_xact_lock(hashtext('offer_session'), hashtext('user:<id>' | 'device:<id>'))`
— held for milliseconds (every model/Google call is finished by then), released at COMMIT.
Two Phase-2s for one driver in flight together used to read the same "last offer" and both
write `offer_sequence_num = N+1` (the index is not unique; the Coach's pattern mining reads
this field). Inside the same lock, the **storage-level duplicate guard**: a row for this
scope with the same `parsed_data_json.request_hash` whose `parsed_data_json.request_at`
(Phase-1 arrival, epoch ms) is within 60 s of this request's arrival → `Duplicate at
storage … no second row, no second notify` (the cross-instance half of §4.1 idempotency).
It compares **request** times, not `created_at` — Phase 2 delays storage by 5-45 s (live
test: a re-send at 55 s was stored 63 s after the first row and slipped past a
`created_at` window); a 120 s `created_at` bound keeps the lookup on the index. Rows are
inserted with `created_at = clock_timestamp()` (statement time, i.e. **after** the lock —
the default `now()` is transaction-begin time, and a transaction that began first but locked
second would carry an older timestamp than the row sequenced before it, letting the next
"last offer" read re-issue a sequence number). A transient connection error inside the
transaction is retried once on a fresh client — classified through Drizzle's wrapper
(`err.cause.code`, or a codeless "not queryable / Connection terminated" cause, which is
what a mid-transaction 57P01 actually surfaces as; `db.transaction` bypasses the pool-level
retry). `connection-manager.js` now attaches an `'error'` listener to every pool client on
connect: a checked-out client had none, so a 57P01 mid-transaction was an unhandled
`'error'` → `uncaughtException` → process exit (verified live with `pg_terminate_backend`
on our own backend: logged, retried, process alive). Untokened **and** deviceless requests have no scope: fresh session, no storage guard
(the in-memory gate still applies).

INSERT into `offer_intelligence` (§11.1) with `source` (verbatim), `input_mode`
(`'vision'` if any image else `'text'`), `raw_text` (`text` or `"[Vision: NKB image]"`
using the **original** size), `raw_ai_response` (Phase 2 text else Phase 1), provenance
stamps (incl. `parsed_data_json.request_hash`), `response_time_ms` (Phase-1 latency). Then
`pg_notify('offer_analyzed', { device_id, user_id, offer_id, decision, reasoning, price,
per_mile, platform, response_time_ms, ai_model })` — issued inside the transaction, so
Postgres delivers it at COMMIT and the row is visible when the OffersCard refetches
(`reasoning` is truncated to 1000 chars in the payload: NOTIFY caps at 8000 bytes and an
oversize payload would roll the INSERT back).

**Google memos (2026-08-17, cost):** Phase 2 memoizes successful geocode results (10 min,
keyed by string + 2-decimal anchor cell), Places results (same) and Timezone-API answers
(12 h, 4-decimal ≈10 m cells) in bounded in-process maps; a round-trip card (pickup == dropoff
string) geocodes once. Only real answers are remembered — a null may be a transient failure.

### 10.6 Card-address resolution + geo audit (before the INSERT since 2026-08-17)

The deep model's `pickup`/`dropoff` strings are resolved **once**, to at most one **trusted
point** each (`place_id` + 6-decimal coords), the way venues are resolved — then the pickup
point feeds the timezone ladder, and **precise** points feed the `pickup_lat/lng` /
`dropoff_lat/lng` / `geocoded_at` columns and the geo audit, all written **in the INSERT** (the
former post-INSERT `UPDATE` is gone; the row is complete when `pg_notify` fires). Deterministic;
calibrated on live prod pickup strings and hardened by two adversarial review passes the same
day (2026-08-17). Helpers in `server/lib/offers/offer-address.js` — pure except
`resolveCardPoints`, whose I/O is injected so every branch is unit-tested with fakes
(`tests/offers/offer-address.test.js`).

**Principle (from the second review):** a geocode *class* is never trust by itself. Google's
bias does not always win — with a fresh Frisco anchor it still returned `Terminal E, Arrivals`
→ Boston (*exact*), `Main St, Gainesville` → Florida, `Main St, Reno` → Nevada; unbiased,
`Main St, Lancaster` → England. Trust = class **plus physical corroboration**.

**Anchor** = the driver's last known position *and its age*: GPS when sent (age 0); else the
tokened driver's current snapshot **if ≤ 12 h old** (`SNAPSHOT_ANCHOR_MAX_HOURS`; a stale
snapshot is still timezone source #3 but says nothing about where the driver is *now*).
Untokened + no GPS = **no anchor**.

| Step | What | Verdict |
|---|---|---|
| 0 | `usableOfferAddress` — placeholders never reach Google: exact tokens (`Unknown`, `N/A`, `none`) **and** phrasings with or without a digit (`Not visible in screenshot`, `Unknown location 1`, `No pickup shown`, wrapped/zero-width variants); a string that names a place survives (`Unknown Rd, Plano`, `Hidden Hills Country Club, Frisco`). Live: Places returns *"Parts Unknown, Fort Worth"* for `Unknown` and *"Rye Not Corned Beef"* for `Not visible in image 1` | — |
| 1 | `geocodeEventAddress(addr, …, { bias, signal })` — Geocoding API with a `bounds` **viewport bias** (60 mi box around the anchor; bias never restricts) → `classifyGeocode`: **`exact`** = whole-string match *and* the card-named city appears in the result (state/province on the card, if any, agrees — `Las Vegas NV` ≠ NM; PR via country; `, City, ST`, `City ST 75034`, `New York, NY`, `Toronto ON M5B 2H1` parsed; `Arrivals`/`Gate A`/`Downtown` are not cities); **`card_city`** = partial match inside the card-named city (`The Star Blvd & Winning Dr, Frisco` → `Winning Dr, Frisco, TX`); **`whole`** = whole-string match of a city-less string; **null** = partial of a city-less string, or a result that **contradicts** the card's city (`Main St, Allen` → Frisco — refused, then Places finds `E Main St, Allen`) | class only |
| 2a | **Anchor present:** a classified geocode is trusted only within `plausibleRadiusMi` = 60 mi + 75 mph × anchor age (`Terminal E, Arrivals` → Boston is 1,559 mi from a fresh Frisco anchor → refused although *exact*; an 11-h anchor still admits a Denver pickup at 641 mi). `whole` becomes **`exact_near`** | `exact` / `card_city` / `exact_near`, corroboration `anchor` |
| 2b | **Anchor present, geocode refused/none:** `searchPlaceWithTextSearch` (the venue **Places Text Search** adapter, 50 km circle bias) — `Terminal B, Departures: Zone 14` → *DFW Airport Terminal B*; `Main St, Gainesville` → *W Main St, Gainesville TX* — accepted only ≤ 60 mi from the anchor **and** of a kind that matches the string (a corner needs an address-type place — never the *One Main Place* office tower) **and** sharing an identifying token (placeholder words don't count) | **`places_near`**, corroboration `anchor` |
| 2c | **No anchor:** the pickup and dropoff are trusted only when **both** are `exact`/`card_city` **and ≤ 60 mi apart** — the two card addresses corroborate each other (`…, Frisco` + `…, Frisco`, 3 mi). One city-confirmed address alone is not enough (`Main St, Lancaster` → England); `whole` never counts; **Places is never called** without an anchor | `exact` / `card_city`, corroboration `other_address` |
| 3 | Nothing trusted → the address stays **text only**: no coords, no audit input, not a timezone source. `geocoded_at` stays NULL (`idx_oi_need_geocode` keeps it eligible for a later pass) | — |

**Precision.** Every point carries `precise` (false for an `APPROXIMATE` locality/route
centroid): a trusted pickup of any precision sources the **timezone**; only precise points
become `pickup_lat/lng` / `dropoff_lat/lng` or enter `evaluateGeoRules`.

Then `evaluateGeoRules(ruleset, { pickup, dropoff })` when `avoid[]` is non-empty and at
least one precise point exists. Written into `parsed_data_json`: `geo_audit`, `geo_violated`,
`geo_disagreement` (violated AND spoken ACCEPT), `pickup_place_id`, `dropoff_place_id`,
`pickup_geo_via` / `dropoff_geo_via` (`'geocode'` | `'places'`), `pickup_geo_trust` /
`dropoff_geo_trust` (`'exact'` | `'exact_near'` | `'card_city'` | `'places_near'`),
`*_geo_corroboration` (`'anchor'` | `'other_address'`), `*_geo_precise`,
`*_anchor_distance_mi`, `anchor_source` (`'gps'` | `'snapshot'`), `anchor_age_hours`,
`pickup_partial_match` / `dropoff_partial_match` and `*_location_type` (raw Geocoding flags),
`timezone_source`. This is the **pings/patterns dataset** (Melody, 2026-07-02) and the
vision-vs-geometry training signal — now with provenance on every point. Google calls per
stored offer, worst case: 2 Geocoding + 2 Places + 1–2 Timezone, all in the fire-and-forget
phase (never on the Siri path), each bounded by an 8 s `AbortSignal.timeout` (a hung Google
request delays the row, never stalls it — the fire-and-forget block has no outer timeout); the
geocoder warns on HTTP/status errors instead of returning a silent null. Cost note for Melody:
an **untokened, GPS-less** request now spends up to 2 Geocoding + 1 Timezone call and can be
stored anonymously when its two card addresses corroborate each other — roadmap L5 option (b)
("the token is the product") would gate that on `userId || GPS`; not applied without her word.

---

## 11. Data model

> **v3.2 (2026-08-26):** a row stored for an `implausible_parse` carries **NULL money
> columns** (`price`, `per_mile`, `per_minute`, `hourly_rate`, `surge`, `advantage_pct`,
> `pickup_*`, `ride_*`, `total_*`). The numbers are known-wrong, and every consumer that
> aggregates them (`/offer-history` `avg_per_mile`, the Coach's offer patterns) would
> inherit the poison. The full extraction survives in `parsed_data_json` + `raw_text` for
> forensics, and `parsed_data_json.implausible_problems` names every signal that fired.
> Such a row is stored **only for a tokened driver** (nobody can see an anonymous one).
> `avg_per_mile` now averages over rows that *have* a rate instead of counting NULLs as $0.

Drizzle: `shared/schema.js`. Migrations: `migrations/20260703_offer_rulesets_outcomes.sql`
(offer_rulesets, offer_outcomes, token + provenance columns; applied automatically at boot
by `server/db/run-migrations.js` since 2026-08-06). Dev DB checked live 2026-08-17: 449
offer rows (all pre-token), 2 rulesets, 2 minted tokens, 0 outcomes. Dev ≠ prod.

### 11.1 `offer_intelligence` (`schema.js:1666-1836`) — one row per analyzed offer, written by Phase 2

| Group | Columns |
|---|---|
| Identity | `id uuid PK`, `device_id varchar(255) NOT NULL`, `user_id uuid` (no FK — headless ingestion) |
| Metrics | `price`, `per_mile`, `per_minute`, `hourly_rate`, `surge`, `advantage_pct int`, `pickup_minutes int`, `pickup_miles`, `ride_minutes int`, `ride_miles`, `total_miles`, `total_minutes int`, `product_type varchar(50)`, `platform varchar(20) NOT NULL default 'unknown'` |
| Addresses | `pickup_address`, `dropoff_address`, `pickup_lat/lng`, `dropoff_lat/lng`, `geocoded_at` |
| Driver location | `driver_lat/lng` (6-dec), `coord_key`, `h3_index` (res 8), `market varchar(100)` |
| Temporal | `local_date text`, `local_hour int`, `day_of_week int (0=Sun)`, `day_part text`, `is_weekend bool`, `timezone text` |
| Analysis | `decision text NOT NULL` (`ACCEPT`/`REJECT`/`NO DATA`; legacy rows may carry `UNKNOWN`), `decision_reasoning`, `confidence_score int`, `ai_model`, `response_time_ms int` |
| Provenance | `ruleset_version int`, `ruleset_hash text` |
| Feedback | `user_override text` |
| Sequence | `offer_session_id uuid`, `offer_sequence_num int`, `seconds_since_last int` |
| Parse quality | `parse_confidence varchar(20)`, `source varchar(50) NOT NULL default 'siri_shortcut'`, `input_mode varchar(20) NOT NULL default 'text'` |
| Raw | `raw_text`, `raw_ai_response`, `parsed_data_json jsonb` |
| Timestamps | `created_at`, `updated_at` (NOT NULL, default now()) |

Indexes (12): `idx_oi_device_created (device_id, created_at desc)`, `idx_oi_market_daypart`,
`idx_oi_h3_decision`, `idx_oi_date_platform`, `idx_oi_weekend_hour`, `idx_oi_session_seq`,
`idx_oi_driver_location`, `idx_oi_override`, `idx_oi_user_id`, `idx_oi_per_mile`,
`idx_oi_created_at`, `idx_oi_need_geocode (id) where geocoded_at is null and pickup_address is not null`.

### 11.2 `offer_rulesets` (`schema.js:1935-1946`)

`id uuid PK`, `user_id uuid NOT NULL UNIQUE → users(user_id) ON DELETE RESTRICT`,
`version int NOT NULL default 1` (bumps each save), `config jsonb NOT NULL` (v3),
`config_hash text NOT NULL`, `created_at`, `updated_at`.

### 11.3 `offer_outcomes` (`schema.js:1958-1985`)

`id uuid PK`, `user_id uuid NOT NULL → users ON DELETE RESTRICT`, `offer_intelligence_id
uuid → offer_intelligence(id) ON DELETE SET NULL`, `driver_decision text` (CHECK
`Accepted|Rejected|Cancelled|Completed` in the migration), `driver_reasoning`,
`actual_pay`, `reimbursements`, `extras`, `other`, `total_earned` **GENERATED ALWAYS AS**
sum **STORED**, `outcome_source text NOT NULL default 'web_app'`, timestamps.
Indexes: `uq_outcome_offer` (unique partial on `offer_intelligence_id`),
`idx_outcome_user_created`, `idx_outcome_decision`.
Drizzle-vs-DB drift (live-checked): the `driver_decision` CHECK and the partial index
`idx_dp_shortcut_token` (redundant with the UNIQUE constraint) exist in the migration and
live DB but are not declared in `shared/schema.js`; the SQL migration is the source of
truth for them.
⚠️ `ON DELETE SET NULL` survives row DELETEs, **not TRUNCATE** (verified live 2026-07-03,
lessons_learned #11) — any `offer_intelligence` reset must `DELETE`.

### 11.4 `driver_profiles` additions (`schema.js:1009-1011`)

`shortcut_token varchar(43) UNIQUE`, `shortcut_token_created_at timestamptz`,
`shortcut_device_label text`.

### 11.5 Not part of this pipeline

`coach_offer_decisions` (`schema.js:1863`) belongs to the Coach's dormant offer-tag
executors (todo #38) — the analyzer never writes it.

---

## 12. Editor API — `/api/offer-analyzer` (authed)

**File:** `server/api/offer-analyzer/index.js` (326 lines); mounted at `/api/offer-analyzer`
(`routes.js:137`); `router.use(requireAuth)` → `req.auth.userId`.

| Method | Route | Behavior |
|---|---|---|
| GET | `/rules` | `{ config (migrated v3), version, hash, is_default }`; defaults when no row |
| PUT | `/rules` `{ config, expected_version? }` | `migrateRuleset` → Zod `validateRuleset` (422 `{ error:'Invalid ruleset', details:[…] }`) → upsert (`version = version + 1` on conflict) → `invalidateUser` → `{ success, version, hash, config }` (canonical stored config). **Optimistic concurrency (2026-08-17):** when `expected_version` is present (the version the editor loaded; `null` = "no saved row yet") the update applies only if the stored version still matches (`IS NOT DISTINCT FROM`), else **409** `{ error:'version_conflict', message, current:{ config, version, hash } }` — never last-write-wins across tabs/devices. Absent → unconditional (older clients). Anything but a JSON non-negative int4 or `null` → 400 (no coercion). |
| GET | `/shortcut-token` | get-or-create → `{ token, created_at, device_label }` (404 if no driver profile). Mint writes only into a still-NULL slot (`… AND shortcut_token IS NULL RETURNING`); a raced second request returns the winner's token instead of overwriting it (2026-08-17). |
| POST | `/shortcut-token/regenerate` | rotate → `{ token, created_at }`; old token dead immediately |
| POST | `/shortcut-token/label` `{ label }` | ≤80 chars, display only → `{ success, device_label }` |
| GET | `/offers?limit=25` (≤100) | my `offer_intelligence` LEFT JOIN `offer_outcomes` → `{ success, stats:{ analyzed, analyzer_accepted, analyzer_rejected, driver_accepted, disagreements, realized_total }, offers:[…] }` |
| POST | `/offers/:id/outcome` `{ driver_decision?, driver_reasoning?, actual_pay?, reimbursements?, extras?, other? }` | 400 on bad enum / non-finite / <0 / >10000; 404 unless the offer is mine; upsert on `offer_intelligence_id` → `{ success, outcome:{ id, driver_decision, total_earned } }` |
| GET | `/places/search?q=` (≥3 chars) | Google Places Text Search (New), 5 results, biased 50 km around `driver_profiles.home_lat/lng`; per-user 20/min (429); 503 without `GOOGLE_MAPS_API_KEY`; → `{ success, results:[{ place_id, label, formatted_address, lat, lng (6-dec), types }] }` |

---

## 13. Web page — `/co-pilot/offer-analyzer`

Route `client/src/routes.tsx:196` (under `/co-pilot`, ProtectedRoute); hamburger entry
`{ label:'Offer Analyzer', icon:Gauge }` (`HamburgerMenu.tsx:26`); API constants
`API_ROUTES.OFFER_ANALYZER.*` (`apiRoutes.ts:225-233`); client Zod mirror
`client/src/lib/offer-ruleset-schema.ts`. Page (`OfferAnalyzerPage.tsx`) renders, in order:

| Card | Edits / does |
|---|---|
| `SetupCard` | iCloud install link, hands-free triggers, one-time edits, **token** (load / copy / regenerate with confirm / device label). ⚠️ Content is the **July 2026 "Analyze 2"** build (old iCloud link, `lattitude` fix, Location permission) — pre-dates the 2026-08-14 canonical two-shortcut spec. Not edited in this pass by Melody's direction; tracked in the roadmap. |
| `RateTargetsCard` | **Sliders only (2026-08-17, Melody D4)**: per tier Floor $/mi · $/min (switch+slider) · Max trip minutes · Max total miles (switch+slider); the engine's `accept_ladder` is **derived** as one rung `{ min_per_mile: floor, max_total_min }` (`withDerivedLadder`) — legacy multi-rung ladders round-trip untouched until the tier is edited. Card-level switch **Show $/hr in results** → `global.notices.hourly_rate` (server computes pay ÷ minutes × 60; appended to notification `| $37/hr` and spoken "about 37 dollars an hour"; never a decider) |
| `DeliveryCard` (v3.2, 2026-08-26) | `delivery.enabled` switch · Floor $/mi · Floor $/hr · Max total miles (switch+slider). Same PUT/409 flow. `sanity.*` has **no editor** (DB-editable; round-trips untouched) |
| `GatesCard` | `global.rating_floor`, `global.require_verified`, `share.auto_reject`, `global.auto_reject.{multiple_stops, round_trip}` |
| `LimitsCard` | `global.pickup_limits`, `global.time_limit` (+ ARP threshold) |
| `GeographyCard` | `avoid[]` via `GET /places/search` → place pick → mode / radius / corridor / enable |
| `VisionRulesCard` | `global.safety_road_types`, `global.commercial_staging`, `global.notices` |
| `OffersCard` | `GET /offers`, live refetch on SSE `offer_analyzed` **and** on the server's `state` handshake at every SSE (re)connect (skipped when the newest id is already shown; `refetch({ cancelRefetch:false })` joins an in-flight fetch), `refetchOnWindowFocus:true` (was `false` — the tab is backgrounded while the Shortcut runs from the Uber app), per-offer "What did you do?" select (never pre-selected; a *Followed the call* option resolves to our recommendation at click time) + earnings form (shown for Accepted/Completed; cleared when switching to Rejected/Cancelled) → `POST /offers/:id/outcome`; stats row. **v3.2 rows:** `reason_kind:'implausible_parse'` → amber **PARSE ERROR — decide manually** badge (struck-through $/mi; never the green ACCEPT); delivery rows → violet `Delivery` / `Delivery · Exclusive` chip, `X.X mi total`, `$N/hr`, `tip incl.`; a small mono `shortcut_system` tag when the phone reported one. `GET /offers` adds `offer_kind`, `tip_included`, `reason_kind`, `shortcut_system` from `parsed_data_json` (no new columns) |

Rules save is an explicit sticky **Save** (react-hook-form + Zod), not autosave. The PUT
carries `expected_version` (what the page loaded); a **409** loads the stored rules from
the 409 body's `current` and tells the driver to re-apply (their local edits are dropped,
never silently written over another tab's save); on success the editor takes the PUT's
canonical `config`/`version` directly (no second GET) — `form.reset(config)`, or
`reset(config, { keepValues:true })` if anything was edited while the save was in flight
(toast says to Save again). Enter inside any single-line input no longer submits the form
(form-level guard). Keys with
**no UI control** today: `basis` (always `full_ride` from the client defaults),
`tier_products`, `geo` scope overrides, `home` — the last three are inert server-side too
(roadmap L6).
Melody's stated direction (2026-08-14): the rules editor is to become **sliders-only**
input (roadmap).

---

## 14. Realtime — SSE `/events/offers`

`server/api/strategy/strategy-events.js:379-441`, mounted at `/` (`routes.js:mountSSE`).
`GET /events/offers` (`requireAuthAllowQueryToken`) subscribes to PG channel
`offer_analyzed` and forwards **only payloads whose `user_id` equals the connection
owner** (anonymous rows reach no one; unparseable payloads dropped loudly). Event name
`offer_analyzed`. Client: `subscribeOfferAnalyzed()` (`co-pilot-helpers.ts`) →
`OffersCard` refetch.

**Initial-state handshake (2026-08-17, like the strategy/briefing/blocks streams since F2):**
right after subscribing, the route emits `event: state` with
`{ offer_id, created_at, handshake:true }` = the owner's newest stored offer (nothing when
they have none). The client SSE manager forwards `state` to the same subscriber callback,
so a stream that was down while an offer landed (backgrounded tab → iOS drops the
`EventSource` → browser auto-reconnect) refetches immediately on return.

**LISTEN client (`server/db/db-client.js`, 2026-08-17):** the fresh-connect path now
re-LISTENs every surviving channel and re-attaches the dispatcher (before: after a dropped
client, *every* SSE stream — offers, strategy, briefing, blocks — stayed deaf, including brand-new
subscribers, until a process restart), and after `reconnectWithBackoff` exhausts its 5 retries
a 30 s slow retry keeps trying while anyone is subscribed (one log line per outage). The
dispatcher is attached **per client** (WeakSet) and ignores a client that is no longer the
current one — a reconnect overlapping a fresh connect can never deliver a NOTIFY twice.

---

## 15. Coach integration (read-only)

- **This document is a runtime input to the Coach.** `server/api/chat/chat.js`
  `getOfferAnalyzerRules()` (`:33-59`) reads `docs/architecture/OFFER_ANALYZER.md` and
  the full `server/lib/ai/model-registry.js` source once per process and splices both into
  every Coach system prompt under `OFFER ANALYZER RULES (READ-ONLY)` (`:1282-1312`) so
  the Coach can explain *why* the analyzer recommended what it did and propose rule
  changes via `[COACH_MEMO]`. Keep this file accurate and section-numbered; a gateway
  restart is needed for the Coach to see edits (process cache). Size today: this doc
  ~56 KB + registry ~37 KB per prompt — see roadmap D7.
- `server/lib/ai/rideshare-coach-dal.js` `getOfferHistory(userId, 20)` reads the last 20
  `offer_intelligence` rows **for the requesting user** (user-scoped since 2026-08-11 —
  lessons_learned #25 records the prior leak) and `formatContextForPrompt` renders a
  `=== RIDE OFFER ANALYSIS LOG ===` block (stats + the 5 most recent offers).
- **Offer patterns (2026-08-17, Melody: the Coach should mine the offer table for
  location/daypart/dow/time/seasonality steering):** `getOfferPatterns(userId, 180)`
  aggregates `offer_intelligence ⟕ offer_outcomes` per user by time of day, weekday,
  pickup area (last comma segment of `pickup_address`), product, and month — count,
  analyzer accept %, avg $/mi, rides the driver actually took + avg earned — and
  `server/lib/offers/offer-patterns.js` renders `=== OFFER PATTERNS … ===` (best/weakest
  time and area headlines when ≥3 offers per cell). Read-only, fail-soft, and explicitly
  not a live-verdict path.
- Per `app_rules.coach-never-analyzes-offers` (Melody, 2026-08-13) the Coach prompt
  states it never analyzes live offers and points drivers to the Offer Analyzer. The
  parser/Zod/executor/DAL machinery for `LOG_OFFER_DECISION` / `UPDATE_OFFER_DECISION` /
  `BACKFILL_OFFER_INTEL` (`chat.js:75-149, 658-728`; `coach_offer_decisions` table) is
  **dormant** — the prompt never instructs those tags and the table has 0 rows in dev
  (todo #38 decides delete vs keep). `BACKFILL_OFFER_INTEL` is the only Coach write path
  into `offer_intelligence` (user-scoped).
- No second analysis pipeline exists: the only `callModel('OFFER_ANALYZER*')` call sites in
  `server/` are `analyze-offer.js:390` and `:567`; the only importers of `rules-engine.js`
  are the offers modules, the editor API, and the hook. `server/api/admin/monitor.js`
  (`/api/admin/offer-monitor`) reads fleet-wide telemetry columns for the dev terminal
  bridge (todo #6).

---

## 16. Models, latency, and the <3s target

Registry (`server/lib/ai/model-registry.js:361-411`) — verified live per
`app_rules.verify-models-live`, dates recorded in the registry comments:

| Role | Env override | Default (pinned, never `*-latest`) | maxTokens | temp | thinking | features |
|---|---|---|---|---|---|---|
| `OFFER_ANALYZER` (Phase 1, sync) | `OFFER_ANALYZER_MODEL` | `gemini-3.5-flash-lite` (since 2026-08-17; was `gemini-3.5-flash`) | 1024 | 0.1 (honored) | `MINIMAL` | vision |
| `OFFER_ANALYZER_DEEP` (Phase 2, async) | `OFFER_ANALYZER_DEEP_MODEL` | `gemini-3.1-pro-preview` | 2048 | 0.2 | `LOW` | vision |

Timeouts: Phase 1 **20 s** race, Phase 2 **45 s** race (SDK has none). Vision roles stay on
3.5 (3.6 regressed object detection per registry note). `OFFER_ANALYZER` is excluded from
the hedged text fallback list (non-vision models can't take images) — a Flash outage falls
to the deterministic engine (text) or `NO DATA` (vision-only).

Runtime facts that differ from a naive reading of the registry (verified 2026-08-17):

- **`features: ['vision']` is documentary only.** No adapter reads a `vision` feature
  (`model-registry.js:653-680` only checks `google_search` / `web_search` /
  `openai_web_search`). Vision works because `analyze-offer.js` passes `images[]` and
  `gemini-adapter.js` attaches them as `inlineData` parts.
- **Temperature 0.1 is honored since 2026-08-17.** `callGemini` caps JSON prompts at 0.2
  but now takes `min(configured, 0.2)` (`gemini-adapter.js`) — previously every JSON
  prompt was forced to 0.2 regardless of the registry (Melody: "temp config to .1").
- **503 retry is pinned since 2026-08-17.** A `gemini-3.5-flash` primary retries on
  `gemini-3.1-pro-preview`; any other primary (incl. the lite default) retries on
  `gemini-3.5-flash` (`adapters/index.js`). No `*-latest` alias remains on this path.
- `.env.local.example:117` shipped `OFFER_ANALYZER_DEEP_MODEL=gemini-3.5-flash` — the
  exact Flash downgrade the registry warns against (lessons_learned #9). Corrected to
  the registry default 2026-08-17.

**Melody's hard target (2026-08-14, todo #43): screenshot → verdict < 3 s.** Levers shipped
2026-08-14 (commit `cd8329da`; removed HIGH-thinking config preserved in
`docs/architecture/removals/2026-08-14-offer-analyzer-thinking-stepdown.md`):

| Lever | Before → after (live-measured, dev boot) |
|---|---|
| Registry `thinkingLevel HIGH→MINIMAL`, `maxTokens 8192→1024` | text HIGH avg 5249 ms (≈ prod p50 5193) → MINIMAL 3120 ms; vision 5496 → 2512 ms; decision parity held |
| Deterministic **fast REJECT lane** (§5 step 10) | text REJECT **3–5 ms** (was p50 5193 ms) incl. Melody's real ruleset + notices |
| **Image downscale** >250 KB → 820 px JPEG q80 (`sharp`) | vision **1794 ms** with 501→276 KB (was p50 6447 ms) |
| **2026-08-17 model bench** → `gemini-3.5-flash-lite` (MINIMAL, 0.1) | live `/v1beta/models` list; 8 candidates × 6 cards (incl. blurry + non-offer) × 3 runs on the real prompts and Melody's dev ruleset, scored vs the engine: lite **vision p50 ~700 ms / p95 ~850 ms, text 687 ms, 54/54 correct, 0 truncated**; 3.5-flash ~1.25 s and **7/42 replies missing the closing brace**; 3.1-flash-lite 860 ms; 3.6-flash 1.03 s; 3.7-flash no MINIMAL, LOW max 16 s; omni = Interactions API only; 2.5-flash-lite 3/12 |
| Full trip on the real endpoint after the switch (dev boot, Melody's token) | **text ACCEPT lane 577–700 ms**, **vision 630–860 ms**, fast REJECT 1 ms, non-offer → NO DATA ~700 ms |
| Remaining tail | none over 1 s in dev; on-device p95 with real screenshots is the acceptance gate (roadmap G1). Deterministic ACCEPT lane (L1) is now optional polish |

Historical: p50 5324 ms / p95 6851 ms (n=448, July 2026) before these levers.

---

## 17. Security posture

- `/api/hooks/analyze-offer` is **public by design** (Shortcuts cannot carry JWTs). Identity
  is the unguessable per-user token; `device_id` is never a credential. Spoofing a
  `device_id` yields only default rules and an anonymous row.
- Read/mutate hook endpoints (`offer-history`, `offer-override`, `offer-cleanup`) are
  **token-required** and user-scoped (multi-user sweep Phase A, 2026-08-11).
- Rate limits: `offerHookLimiter` 20/min per ip+identity on all four hook routes; places
  picker 20/min per user; global API limiter also applies (`middleware/rate-limit.js`).
- Body caps: 5 MB JSON / urlencoded / multipart file. The pair and advantage extractors
  refuse text >5000 chars (ReDoS guard); the other extractors run on any length.
- SSE per-user filtering (2026-07-03) — no cross-driver offer leakage.
- `DEFAULT_RULESET` deep-frozen; unknown tokens are not cached (bounded map).
- Cost surface: one public request can bill up to two vision model calls; the fast lane
  and share short-circuit reduce this materially. Historical audit: `docs/HooksCatalog.md`
  (2026-05; its "no dedicated limiter" finding is **closed** — `offerHookLimiter` exists).

---

## 18. Tests

`NODE_OPTIONS='--experimental-vm-modules' npx jest tests/offers` (or `npm run test:unit`
for the whole tree). As of 2026-08-26: **10 suites / 142 tests pass** (9/114 at intake; the
"5/66" figure in earlier versions of this line was already stale). Full `tests/`: 792 pass
with the same 7 pre-existing failing suites as the todo #19 baseline.

| Suite | Pins |
|---|---|
| `tests/offers/rules-engine-parity.test.js` | `buildPhase1Prompt(tier, DEFAULT_RULESET)` **byte-identical** to the legacy prompts; deterministic decisions identical to the legacy ladder across a per_mile × minutes × rating grid. One intentional deviation is pinned: the rating gate is **active** (the legacy fallback's rating check was dead code) |
| `tests/offers/rules-engine-v3.test.js` | v3 gates from the verbatim spec (pickup/time limits, ARP semantics, comfort/xl routing, avoid rendering, migrateRuleset, geo audit) |
| `tests/offers/normalize-offer-body.test.js` | alias table behavior (canonical wins, case-insensitive, warn list) |
| `tests/offers/downscale-offer-image.test.js` | threshold, fail-open, no-grow rule |
| `tests/offers/parse-model-json.test.js` | the four parse tiers incl. the missing- and surplus-closing-brace repairs; `unwrap:false` envelope mode |
| `tests/offers/request-dedup.test.js` | idempotency primitives: fingerprint (whitespace-insensitive text, image bytes, identity), claim/join/replay, TTL expiry, failures never replayed, bounded map, TTL memo |
| `tests/offers/delivery-and-sanity.test.js` (v3.2) | the **verbatim 2026-08-24 `$750` payload → NO DATA implausible_parse, never ACCEPT** (on the delivery tier AND under the old standard routing); integer-price signature; legit surge hops do not trip; delivery parse (kind, tip, total line, glyph junk); two-pair ride containing "Delivery" stays a ride; `evaluateDelivery` gate order + tip call-out + `delivery_off`; Comfort/UberX regressions unchanged; prompts carry the DELIVERY section without the pinned-forbidden words; v3.2 migration round-trip + strict validation; `shortcut_system` aliases/normalization. Real cards catalogued in `tests/offers/fixtures/README.md` |
| `scripts/offer-analyzer-smoke.mjs` | manual smoke against any deployment: `BASE=… TOKEN=vp_… IMAGE=… node scripts/offer-analyzer-smoke.mjs` — prints decision / voice / notification / server ms / wall ms for text + vision (replaced the stale `tests/integration/test-ocr-hook.js` 2026-08-17) |

---

## 19. Key files

| File | Role |
|---|---|
| `server/api/hooks/analyze-offer.js` | Ingest endpoint, Phase 1 + Phase 2, hook companions, `buildVoiceLine`, `terseReason` |
| `server/lib/offers/rules-engine.js` | `DEFAULT_RULESET`, `migrateRuleset`, `classifyTier`, `evaluateDeterministic`, prompt renderers, `NOTICE_LABELS`, `evaluateGeoRules` |
| `server/lib/offers/ruleset-schema.js` | Zod write gate |
| `server/lib/offers/ruleset-store.js` | token → user → ruleset (15 s cache, fail-open loud), `invalidateUser` |
| `server/lib/offers/ruleset-hash.js` | `hashRuleset`, `generateShortcutToken` (pure) |
| `server/lib/offers/parse-offer-text.js` | regex pre-parser, canonical products, `PREMIUM_PRODUCTS`, `formatPerMileForVoice` |
| `server/lib/offers/normalize-offer-body.js` | body-key alias table |
| `server/lib/offers/downscale-offer-image.js` | 820 px JPEG downscale (sharp), fail-open |
| `server/lib/offers/parse-model-json.js` | tolerant model-reply parser (4 tiers) used by Phase 1 and Phase 2 |
| `server/api/offer-analyzer/index.js` | authed editor API |
| `server/api/strategy/strategy-events.js` | SSE `/events/offers` |
| `server/lib/ai/model-registry.js` | `OFFER_ANALYZER`, `OFFER_ANALYZER_DEEP` |
| `server/lib/location/geo.js` | haversine / bearing helpers used by the geo audit |
| `server/lib/events/pipeline/geocodeEvent.js` | `geocodeEventAddress` (place_id + coords) |
| `server/bootstrap/routes.js`, `server/bootstrap/middleware.js` | mounts, body parsers |
| `server/middleware/rate-limit.js`, `server/middleware/bot-blocker.js` | `offerHookLimiter`, hooks allow-list |
| `shared/schema.js`, `migrations/20260703_offer_rulesets_outcomes.sql` | tables |
| `client/src/pages/co-pilot/OfferAnalyzerPage.tsx`, `client/src/components/offer-analyzer/*` | page + cards |
| `client/src/lib/offer-ruleset-schema.ts`, `client/src/constants/apiRoutes.ts` | client schema mirror, routes |
| `docs/architecture/removals/2026-08-14-*.md`, `2026-08-17-offer-analyzer-model-bench.md`, `2026-08-11-per-user-scoping.md` | removed-comment provenance |

---

## 20. Known gaps (pointer)

The forward plan, open gates, and every deferred item live in
`docs/architecture/OFFER_ANALYZER_ROADMAP.md`. Headlines: Melody's on-device re-test of
the <3s build + Android build; SetupCard content drift vs the 2026-08-14 shortcut spec;
sliders-only rules editor; deterministic ACCEPT lane; storage of coordinate-less untokened
offers; `home` / `geo` scope keys declared but unconsumed; non-offer-screenshot voice
line; spec output-format lines; Phase-2 verdict never reaches the driver.

---

## Appendix A — Change log

| Date | Version | Change |
|---|---|---|
| 2026-02-15 … 2026-02-28 | — | Endpoint scaffolded; pre-parser; 6-dec GPS; vision mode; `offer_intelligence` structured table; two-phase split |
| 2026-03-29 | — | Tier-aware prompts; canonical product names |
| 2026-04-15/16 | 2.0 | `reason` + `voice` fields; doc rewritten |
| 2026-06-20 | — | Unified rules engine (prompt + fallback from one config; parity pins) — landed in `c968989a` (2026-06-26) |
| 2026-07-03 | — | **v3**: per-driver DB rulesets, editor API + page, shortcut-token bridge, Phase-2 same-ruleset prompt, geocode + geo audit, decision = spoken, SSE per-user (todo #10; session 2026-07-03, commit `46ad6862` landed 2026-07-06) |
| 2026-07-06 | — | Timezone order GPS → snapshot → don't store; dayparts adapter |
| 2026-08-11 | — | Hook read/mutate endpoints token-required + user-scoped; `offerHookLimiter`; session chain by user (commit `f005c634`) |
| 2026-08-14 | — | Body alias table (`normalize-offer-body.js`); `express.urlencoded` on `/api/hooks`; **<3s sprint**: MINIMAL thinking + 1024 tokens, deterministic fast REJECT lane, image downscale (commit `cd8329da`) |
| 2026-08-17 | 3.0 | This rewrite; plan/design docs merged and retired |
| 2026-08-26 | 3.9 | **Adversarial review of the 3.8 diff (6 lenses / 29 agents, 17 findings confirmed, 6 refuted) — fixes:** the delivery lane is entered by card **shape**, not by the word "Delivery" (four lenses found real rides being judged by delivery floors); the decimal-drop detector gained rate-based ceilings so the one-glyph variants (`$75O`, `$75`) trip too; rate ceilings gained denominator guards (≥ 1 mi / ≥ 5 min) so real minimum-fare and surge hops stop tripping, with `max_per_mile` 30→40 and `max_per_hour` 300→500; money strings are coerced currency-tolerantly (`"$750"` no longer becomes an invisible `null`); the vision model's server-owned keys are stripped from its reply; the engine owns delivery **including its NO DATA**; `delivery.enabled:false` still teaches the model to label the card; `migrateRuleset` refuses a null sanity ceiling; implausible rows store **NULL money columns** (no aggregation poison) and only for a tokened driver; `avg_per_mile` ignores rate-less rows; verdict and spoken line can no longer contradict each other; DeliveryCard shows a null floor as OFF; tolerant `tip_included` read. Accepted limits documented in §6.3. |
| 2026-08-26 | 3.8 | **v3.2 ruleset — implausible-parse tripwire + delivery lane + client signature** (intake `docs/review-queue/PLAN_intake-2026-08-26-offer-analyzer-handoffs.md`). Live incident 2026-08-24: OCR sent `$750` for `$7.50` → spoken ACCEPT at $163.04/mi, $2368/hr; the deep model dissented and was overridden. Fix A: `sanity` block + `checkSanity` at three seats (engine; text lane before the model; final gate after vision arbitration); integer-price signature (`price_format`); `implausible_parse` rows store + show amber. Fix B: `delivery` block + `evaluateDelivery` (two floors + cap; $/hr decides), parser `offer_kind` / `tip_included` / `Delivery…` products / `total` line, vision + Phase-2 DELIVERY sections, engine-owned vision arbitration for deliveries, text lane deterministic; tip honesty call-out. `shortcut_system` (Melody 2026-08-24) ingest → log → `parsed_data_json` → Offers tag. Client: `DeliveryCard`, Offers-row chips/badges, zod mirror. Voice ≥ $100 hardened. 22 new tests; fixture corpus started. |
| 2026-08-17 | 3.7 | **28 of 28 editor controls reach Phase 1** (verifier wf_98681a21): `avoid[].corridor_deg` now rendered into the heads-toward line when set off the default 30; the per-tier `max_total_miles` line no longer leaks into the vision/Phase-2 "Gates (all tiers)" block. |
| 2026-08-17 | 3.6 | **Fallback accept always spoken** — voice keyed on the `fallback` flag like the notification label (Melody drives by ear). |
| 2026-08-17 | 3.5 | **NO DATA skips Phase 2** (no deep model / Google calls / row; vision-degraded exception) — Melody. |
| 2026-08-17 | 3.4 | **Race/duplicate hardening** (Melody: "take the lead — we need this app really sharp"): idempotency gate + storage-level duplicate guard (§4.1/§10.5); session read + INSERT + NOTIFY in one advisory-locked transaction (§10.5); `/events/offers` `state` handshake + OffersCard focus/reconnect refetch (§13/§14); LISTEN client fresh-connect resubscribe + slow retry (§14); PUT `/rules` `expected_version` → 409 + canonical config in the response, editor keeps in-flight edits (§12/§13); shortcut-token mint race; multer before the limiter; ruleset-cache stale-repopulate guard; Google memos; form-level Enter-key guard; **`parse-model-json` tier 4** (surplus closing brace — a live Phase-2 failure mode that was dropping the deep result and card addresses). |
| 2026-08-17 | 3.3 | **Raw image body mode** (`image/*` / `application/octet-stream`, fields as query params — MacroDroid "Content Body: File"; Cowork-authored patch, applied + hardened: magic-byte sniff, octet-stream, spoken 413 for raw *and* multipart oversize, `?shortcut_token=` parity). Verified live: raw PNG → ACCEPT stored `source=android_vision input_mode=vision`; octet-stream sniffed; blank image → NO DATA; 6 MB → 413 with voice |
| 2026-08-17 | 3.2 | **Timezone from the pickup address** (Melody: first address on the card; "get details like we do for venues"): GPS → pickup point → snapshot → don't store; card addresses resolved once to trusted points = geocode class **plus physical corroboration** (anchor plausibility 60 mi + 75 mph × age, else the venue Places adapter ≤ 60 mi with kind + name checks; no anchor → pickup and dropoff must corroborate each other), placeholders filtered, contradictions refused, precise-only coordinates, 8 s bounded fetches, written in the INSERT with full provenance in `parsed_data_json`. Two adversarial review passes (31 raw findings) folded in |
| 2026-08-17 | 3.1 | Live model bench → `OFFER_ANALYZER` default `gemini-3.5-flash-lite`; temperature 0.1 honored; 503 retry pinned; `parse-model-json.js` (repair tier); honest-floor guard; **vision arbitration** (engine owns numeric rules on extracted numbers; `judgment_reject` + `rating` in the vision template); **D4 sliders-only Rate Targets** (ladder editor removed; derived single rung; per-tier `max_total_miles`; `$/hr` telemetry) |

## Appendix B — Decisions of record (provenance-marked)

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

**Claude-authored, adopted (2026-08-17, Melody: "take the lead"):** an identical request
inside 60 s (105 s at storage) is ONE offer — replayed, never re-analyzed or re-stored;
per-driver session sequencing is serialized by an advisory lock; rules saves are
optimistic-concurrency (409 on a stale `expected_version`), never last-write-wins across
devices; a 409 drops the local edits and reloads (honest, re-apply) rather than merging.
