# OFFER_ANALYZER.md — Ride Offer Analysis System End-to-End

> **Canonical reference** for the ride-offer analysis feature exposed at `POST /api/hooks/analyze-offer`. Covers Siri Shortcuts integration, zero-auth endpoint contract, two-phase AI architecture, deterministic fallback, voice/TTS pipeline, database schema, coach integration, and known gaps.
>
> **Version:** 2.0 — 2026-04-16
> **Previous:** 2026-04-10
> **Supersedes:** `docs/architecture/media-handling.md` (absorbed: Siri screenshots, base64 encoding, multer config)

---

## Table of Contents

1. [Purpose & Overview](#1-purpose--overview)
2. [Endpoint Contract](#2-endpoint-contract)
3. [Tier System](#3-tier-system)
4. [Phase 1 — Synchronous Analysis (Gemini Flash)](#4-phase-1--synchronous-analysis-gemini-flash)
5. [Phase 2 — Asynchronous Deep Analysis (Gemini Pro)](#5-phase-2--asynchronous-deep-analysis-gemini-pro)
6. [Pre-Parser (Regex, `parse-offer-text.js`)](#6-pre-parser-regex-parse-offer-textjs)
7. [Deterministic Fallback Rule Engine](#7-deterministic-fallback-rule-engine)
8. [Response Shape](#8-response-shape)
9. [Voice / TTS Pipeline](#9-voice--tts-pipeline)
10. [Database Schema (`offer_intelligence`)](#10-database-schema-offer_intelligence)
11. [Siri Shortcuts Integration](#11-siri-shortcuts-integration)
12. [Business Rules Summary](#12-business-rules-summary)
13. [Coach and Strategy Integration](#13-coach-and-strategy-integration)
14. [Android Considerations](#14-android-considerations)
15. [Current State](#15-current-state)
16. [Open Issues / Future Work](#16-open-issues--future-work)
17. [Key Files](#17-key-files)

---

## 1. Purpose & Overview

Real-time AI analysis of Uber/Lyft ride offers for the driver. A Siri Shortcut captures the offer screen, POSTs it to this endpoint, and the driver hears a spoken ACCEPT/REJECT decision within Siri's tight timeout window (~3s on Trip Radar, ~9s on regular offers).

**Who calls it:** iOS Siri Shortcuts today; Android Automations planned (§14). Also usable directly from scripts/tests.

**Zero-auth:** Siri Shortcuts cannot carry JWTs, so this endpoint is **explicitly public**. Identity is tracked via `device_id`. Flagged as HIGH-risk in `SECURITY.md`.

### 1.1 Two-Phase Architecture

| Phase | Mode | Model | Latency | Role |
|-------|------|-------|---------|------|
| **Phase 1** | Synchronous (blocks response) | `OFFER_ANALYZER` → Gemini 3 Flash | <2s target | Decide ACCEPT/REJECT, respond to Siri immediately |
| **Phase 2** | Fire-and-forget (after `res.json()`) | `OFFER_ANALYZER_DEEP` → Gemini 3.1 Pro | 45s timeout | Deep reasoning + geographic analysis; enrich DB row |

```
iPhone: Uber/Lyft shows ride offer
  │
  ├─ Siri Shortcut ("Vecto Analyze" or "Vecto Vision")
  │    ├─ Take Screenshot
  │    ├─ Extract text (iOS OCR) OR Base64 encode image
  │    ├─ Get Current Location (GPS)
  │    └─ POST /api/hooks/analyze-offer   ← ZERO AUTH
  │
  ├─ PHASE 1 (sync, <2s)
  │    ├─ Pre-parse text with regex (<1ms) — parseOfferText()
  │    ├─ classifyTier() → share / standard / premium
  │    ├─ Share → auto-REJECT (skip AI entirely)
  │    ├─ Call Gemini 3 Flash with tier-specific prompt
  │    ├─ Parse JSON decision; on parse failure → deterministic fallback
  │    ├─ Build voice TTS line via buildVoiceLine()
  │    └─ res.json({ success, voice, notification, decision, reason, response_time_ms })
  │          └─ Siri speaks: "Accept. dollar fifty-seven per mile, 8 miles."
  │
  └─ PHASE 2 (async, after res.json())
       ├─ Gemini 3.1 Pro (vision) → location_analysis + rich reasoning
       ├─ Merge Phase 1 + Phase 2 + preParsed
       ├─ INSERT offer_intelligence (one row per offer)
       └─ pg_notify('offer_analyzed') → SSE broadcast to web app
```

---

## 2. Endpoint Contract

**Route:** `POST /api/hooks/analyze-offer`
**File:** `server/api/hooks/analyze-offer.js` (814 lines)
**Auth:** None — public
**Body limit:** 5 MB (enforced in `server/bootstrap/middleware.js`)
**Content-Types accepted:** `application/json`, `multipart/form-data`

### 2.1 Three Input Modes

| Mode | Content-Type | How image arrives | Typical speed |
|------|--------------|-------------------|---------------|
| **Text (OCR)** | `application/json` | `text` field contains iOS-OCR output | Fastest (regex pre-parse only when AI not needed for vision) |
| **Vision (base64)** | `application/json` | `image` field contains base64-encoded JPEG | Medium (Gemini Vision processes image) |
| **Multipart (file)** | `multipart/form-data` | Raw image file part named `image` | Fastest for Siri — client skips base64 encoding; server encodes in <1ms |

Multer memory-storage runs first (`upload.single('image')`). If a file part is present, multipart path is used. Otherwise the handler falls through to JSON body parsing.

### 2.2 Request Fields

```typescript
{
  // One of `text` or `image` is required
  text?: string;              // iOS-OCR output of the offer screenshot
  image?: string;             // Base64-encoded JPEG (data URL prefix tolerated)
  image_type?: string;        // MIME type, default 'image/jpeg'

  device_id: string;          // Stable per-device identifier
  latitude?: number;          // GPS lat (float, rounded to 6 decimals server-side)
  longitude?: number;         // GPS lng (float, rounded to 6 decimals server-side)
  source?: string;            // 'siri_shortcut' | 'siri_vision' | 'android_automation' | 'manual'
  user_id?: string;           // Optional — no FK constraint (headless ingestion allowed)
}
```

### 2.3 GPS Precision Rule

Latitude and longitude are rounded to **6 decimals** (~11 cm) before storage. The coarse `market` bucket is derived as `${lat.toFixed(1)}_${lng.toFixed(1)}`.

### 2.4 Companion Endpoints

| Route | Purpose |
|-------|---------|
| `GET /api/hooks/offer-history?device_id=xxx&limit=20` | Recent analyses for a device plus aggregate stats. |
| `POST /api/hooks/offer-override` | Driver disagreed with the AI; record `user_override`. Scoped to the same `device_id`. |
| `POST /api/hooks/offer-cleanup` | Batch-delete test entries. Scoped to `device_id` ownership (max 50 IDs/request). |

---

## 3. Tier System

Tier drives which prompt template, rule set, and fallback thresholds apply. Determined from the OCR-parsed product name via `classifyTier()` (`server/lib/offers/parse-offer-text.js:146`).

### 3.1 Tier Definitions

| Tier | Products | Floor $/mi | AI called? | Rationale (from 300+ DFW samples) |
|------|----------|-----------|------------|-----------------------------------|
| **share** | `Share`, `Lyft Shared` | — (auto-reject) | **No** | Median $0.69/mi, 0% accept rate. Skips Gemini call entirely. |
| **standard** | `UberX`, `UberX Exclusive`, `UberX Priority`, `Lyft`, `Uber` (bare), unknown | $0.90/mi | Yes | Core volume. Accepted avg $1.13/mi vs rejected avg $0.77/mi. |
| **premium** | `Comfort`, `VIP`, `Black`, `UberXL`, `UberXL Exclusive`, `Lyft XL`, `Lyft Lux`, `Lyft Black` | $1.10/mi | Yes | Higher floor, relaxed time limits. |

### 3.2 Tier Determination Flow

1. `extractProductType(rawText)` returns canonical product name (e.g. `"UberX Priority"`) or `null`.
2. `classifyTier(productType)` maps to tier:
   - `null` or unknown → `"standard"` (default safety net)
   - In `SHARE_PRODUCTS` set → `"share"`
   - In `PREMIUM_PRODUCTS` set → `"premium"`
   - Otherwise → `"standard"`
3. The selected tier is used to pick `PHASE1_PROMPTS[tier]` and is injected into the Phase 2 system prompt as `TIER: <UPPER> (<productType>)`.

---

## 4. Phase 1 — Synchronous Analysis (Gemini Flash)

**Source:** `server/api/hooks/analyze-offer.js` lines 227–439
**Model role:** `OFFER_ANALYZER` → `gemini-3-flash-preview` (default)
**Registry config:** `server/lib/ai/model-registry.js:328` — `maxTokens: 1024`, `temperature: 0.1`, `features: ['vision']`, no thinking level

### 4.1 Control Flow

1. Detect input mode (multipart vs JSON).
2. Normalize GPS to 6 decimals; derive `market` bucket.
3. `parseOfferText(text)` — <1ms regex pre-parse (text mode only).
4. `classifyTier(preParsed.product_type)`.
5. **Share short-circuit:** if tier is `share`, return immediately with `voice: 'Reject. Share tier.'` — no AI call.
6. Build a compressed one-liner of pre-parsed data to prepend to the user message.
7. Call `callModel('OFFER_ANALYZER', { system, user, images })`.
8. Two-tier JSON extraction:
   - Tier 1: strip ` ```json` / ` ``` ` fences, `JSON.parse`.
   - Tier 2: slice from first `{` to last `}`, retry parse (Gemini sometimes adds preamble).
   - Tier 3 (on total parse failure): deterministic fallback rule engine (§7).
9. Compute `terseReason` from `phase1Result.reason || phase1Result.reasoning`, falling back to `"$X.XX Y.Ymi"` built from pre-parsed values.
10. Compute `voice` via `buildVoiceLine(decision, perMile, totalMi, terseReason)` (§9).
11. `res.json(...)` — driver's answer shipped.
12. Kick off Phase 2 IIFE (§5).

### 4.2 Phase 1 Prompts

All prompts demand **raw JSON only** — no markdown or backticks. One prompt per tier, selected by `PHASE1_PROMPTS[tier]`.

**Share prompt** (`analyze-offer.js:42–44`) — auto-reject instruction; in practice never reaches AI because of the early-return at step 5:
```
REJECT. Share rides always rejected.
{"price":0,"per_mile":0,"total_miles":0,"total_minutes":0,"decision":"REJECT","reason":"share"}
```

**Standard prompt** (`analyze-offer.js:46–63`) — 9 rules, first-match-wins:
| Rule | Condition | Decision |
|------|-----------|----------|
| 1 | Rating visible and `< 4.85` | REJECT |
| 2 | "Verified" missing | REJECT |
| 3 | `$/mi < 0.90` | REJECT |
| 4 | `$/mi ≥ 0.90` and `total_min ≤ 20` | ACCEPT |
| 5 | `$/mi ≥ 1.10` and `total_min ≤ 25` | ACCEPT |
| 6 | `$/mi ≥ 1.75` and `total_min < 30` | ACCEPT |
| 7 | `$/mi ≥ 2.00` and `total_min 30–40` | ACCEPT |
| 8 | `$/mi ≥ 2.00` and `total_min > 40` | ACCEPT |
| 9 | Default | REJECT |

**Premium prompt** (`analyze-offer.js:65–82`) — 8 rules:
| Rule | Condition | Decision |
|------|-----------|----------|
| 1 | Rating visible and `< 4.85` | REJECT |
| 2 | "Verified" missing | REJECT |
| 3 | `$/mi < 1.10` | REJECT |
| 4 | `$/mi ≥ 1.10` and `total_min ≤ 25` | ACCEPT |
| 5 | `$/mi ≥ 1.40` and `total_min ≤ 30` | ACCEPT |
| 6 | `$/mi ≥ 1.75` and `total_min ≤ 40` | ACCEPT |
| 7 | `$/mi ≥ 2.00` and `total_min > 40` | ACCEPT |
| 8 | Default | REJECT |

### 4.3 Expected AI JSON

```json
{
  "price": 9.43,
  "per_mile": 1.57,
  "total_miles": 6.0,
  "total_minutes": 18,
  "decision": "ACCEPT",
  "reason": "$1.57 6.0mi"
}
```

`reason` must be terse: `"$1.14 8.3mi"` on accepts, `"$0.78 14.0mi low"` / `"…floor"` / `"…too far"` / `"…rating"` on rejects. Legacy prose from older prompts is accepted under the alias `reasoning`.

---

## 5. Phase 2 — Asynchronous Deep Analysis (Gemini Pro)

**Source:** `analyze-offer.js:456–657`
**Model role:** `OFFER_ANALYZER_DEEP` → `gemini-3.1-pro-preview`
**Registry config:** `model-registry.js:341` — `maxTokens: 2048`, `temperature: 0.2`, `thinkingLevel: 'LOW'`, `features: ['vision']`
**Timeout:** 45 seconds, enforced via `Promise.race` (the Gemini SDK has no built-in timeout).

### 5.1 Flow

1. Async IIFE runs **after** `res.json()`; the driver already has their answer.
2. Build Phase 2 system prompt: `PHASE2_SYSTEM_PROMPT + locationContext + tierContext + preParseBlock`.
3. Call Gemini Pro with same screenshot and same text.
4. If Phase 2 succeeds:
   - Parse its JSON (includes `parsed_data`, `decision`, `reasoning`, `confidence`, `location_analysis`).
   - `aiModelUsed = 'gemini-3.1-pro'`.
5. If Phase 2 fails (timeout, error, non-JSON): fall back to Phase 1 result. `aiModelUsed = 'gemini-3-flash'`.
6. Merge `preParsed + phase2Result.parsed_data` into `mergedParsedData`.
7. Compute geographic columns (`coord_key`, `h3_index`), temporal columns (`local_date`, `local_hour`, `day_of_week`, `day_part`, `is_weekend`).
8. Compute offer-session bucket (30-min window): same `offer_session_id` if prior offer for this device within 1800 s, else new UUID; `offer_sequence_num` increments.
9. INSERT row into `offer_intelligence` (§10).
10. `pg_notify('offer_analyzed', { device_id, decision, reasoning, price, per_mile, platform, response_time_ms, ai_model })`.

### 5.2 Phase 2 Output Schema

```json
{
  "parsed_data": {
    "price": 9.43, "miles": 6.0, "pickup_minutes": 5, "ride_minutes": 13,
    "pickup": "Legacy Dr & Preston Rd", "dropoff": "DFW Terminal B",
    "platform": "uber", "surge": null, "per_mile": 1.57,
    "rider_rating": 4.92, "product_type": "UberX"
  },
  "decision": "ACCEPT",
  "reasoning": "2-3 sentence rationale covering location quality, return-trip viability, economic assessment.",
  "confidence": 87,
  "location_analysis": {
    "dropoff_zone": "core",           // "core" | "deadhead" | "fringe"
    "return_difficulty": "easy",      // "easy" | "moderate" | "hard"
    "area_demand": "high"             // "high" | "medium" | "low"
  }
}
```

### 5.3 Phase 2 Failure Modes

| Failure | Fallback behavior | `ai_model` recorded |
|---------|-------------------|---------------------|
| Timeout after 45 s | Phase 1 result saved to DB | `gemini-3-flash` |
| Gemini error (5xx, auth, quota) | Phase 1 result saved to DB | `gemini-3-flash` |
| Non-JSON response | Phase 1 result saved to DB | `gemini-3-flash` |
| Any thrown exception | Logged to console, DB insert skipped entirely (best-effort; Siri already answered) | n/a |

Currently **Phase 2 reasoning does not surface back to Siri** — the driver hears the Phase 1 `voice` and never learns of Phase 2's richer verdict. Tracked in §16.

---

## 6. Pre-Parser (Regex, `parse-offer-text.js`)

**File:** `server/lib/offers/parse-offer-text.js` (377 lines)
**Entry point:** `parseOfferText(rawText)` (line 228)
**Performance:** <1 ms, pure CPU, no I/O.
**Security:** Inputs capped at 5000 chars to prevent ReDoS (CodeQL).

### 6.1 Extraction Functions

| Function | Returns | Example |
|----------|---------|---------|
| `extractPrice()` | `number \| null` — primary ride price, excluding `/active hr` hourly estimates | `9.43` |
| `extractHourlyRate()` | `number \| null` — `$X.XX/active hr (est.)` | `23.58` |
| `extractTimeDistancePairs()` | `Array<{minutes, miles}>` — all `"N min (X.X mi)"` matches | `[{5, 2.2}, {13, 3.8}]` |
| `extractProductType()` | `string \| null` — **canonical** name | `"UberX Priority"`, `"Comfort"`, `"Lyft XL"` |
| `extractSurge()` | `number \| null` — priority-pickup bonus or surge amount | `2.40` |
| `extractAdvantage()` | `number \| null` — Uber Pro advantage percentage | `5` |
| `detectPlatform(text, productType)` | `'uber' \| 'lyft' \| 'unknown'` | `"uber"` |
| `classifyTier(productType)` | `'share' \| 'standard' \| 'premium'` | `"premium"` |
| `formatPerMileForVoice(perMile)` | TTS clause (no `$` or `/`) | `"dollar fifty-seven per mile"` |

### 6.2 `parseOfferText()` Output

```typescript
{
  price: number | null,
  hourly_rate: number | null,
  pickup_minutes: number | null,
  pickup_miles: number | null,
  ride_minutes: number | null,
  ride_miles: number | null,
  total_miles: number | null,       // pickup_miles + ride_miles
  total_minutes: number | null,     // pickup_minutes + ride_minutes
  per_mile: number | null,          // price / total_miles, rounded to 2 decimals
  per_minute: number | null,
  surge: number | null,
  product_type: string | null,      // canonical
  advantage_pct: number | null,
  platform_hint: 'uber' | 'lyft' | 'unknown',
  parse_confidence: 'full' | 'partial' | 'minimal'
}
```

### 6.3 Pair Disambiguation

Uber shows pickup first, ride second. If only **one** pair is extracted, context is used:
- If `"Avg. wait time at pickup"` appears after the pair, the pair is treated as **pickup**.
- Otherwise the pair is treated as **ride** (more useful for `$/mi`).

### 6.4 Parse-Confidence Levels

| Level | Trigger |
|-------|---------|
| `full` | `price != null` and `pairs.length >= 2` |
| `partial` | `price != null` and `pairs.length >= 1`, OR price alone |
| `minimal` | No price detected |

---

## 7. Deterministic Fallback Rule Engine

**Triggered when:** Phase 1 Gemini Flash response can't be parsed as JSON (both JSON-parse tiers fail). Located in `analyze-offer.js:286–415`.

**Required input:** `preParsed.per_mile !== null`. Without it, returns `decision: 'NO DATA'` with `reason: 'no data'` — never `REJECT`, because REJECT is reserved for rule-evaluated offers.

Returned `reason` strings are literal and drive the terse Phase-1 `reason` field (and thus the `voice` qualifier map in §9). All accepts render without a qualifier; all rejects carry one of: `floor`, `too far`, `low`, `rating`. Premium variants append a `prem` tag.

### 7.1 Standard-Tier Fallback (all reasons include pre-parsed numbers)

| Condition | Decision | Reason literal |
|-----------|----------|----------------|
| `rating != null && rating < 4.85` | REJECT | `$X.XX Y.Ymi rating` |
| `per_mile < 0.90` | REJECT | `$X.XX Y.Ymi floor` |
| `per_mile ≥ 0.90 && total_min ≤ 20` | ACCEPT | `$X.XX Y.Ymi` |
| `per_mile ≥ 1.10 && total_min ≤ 25` | ACCEPT | `$X.XX Y.Ymi` |
| `per_mile ≥ 1.75 && total_min < 30` | ACCEPT | `$X.XX Y.Ymi` |
| `per_mile ≥ 2.00 && total_min 30–40` | ACCEPT | `$X.XX Y.Ymi` |
| `per_mile ≥ 2.00 && total_min > 40` | ACCEPT | `$X.XX Y.Ymi` |
| `total_min > 40` (no accept hit) | REJECT | `$X.XX Y.Ymi too far` |
| Else | REJECT | `$X.XX Y.Ymi low` |

### 7.2 Premium-Tier Fallback (reasons end with ` prem`)

| Condition | Decision | Reason literal |
|-----------|----------|----------------|
| `rating != null && rating < 4.85` | REJECT | `$X.XX Y.Ymi rating` (no prem suffix — rating reason comes first) |
| `per_mile < 1.10` | REJECT | `$X.XX Y.Ymi floor prem` |
| `per_mile ≥ 1.10 && total_min ≤ 25` | ACCEPT | `$X.XX Y.Ymi prem` |
| `per_mile ≥ 1.40 && total_min ≤ 30` | ACCEPT | `$X.XX Y.Ymi prem` |
| `per_mile ≥ 1.75 && total_min ≤ 40` | ACCEPT | `$X.XX Y.Ymi prem` |
| `per_mile ≥ 2.00 && total_min > 40` | ACCEPT | `$X.XX Y.Ymi prem` |
| `total_min > 40` (no accept hit) | REJECT | `$X.XX Y.Ymi too far prem` |
| Else | REJECT | `$X.XX Y.Ymi low prem` |

### 7.3 Special Short-Circuits

| Path | Decision | Reason literal | Voice literal |
|------|----------|----------------|---------------|
| Share tier (line 268) | REJECT | `share` | `Reject. Share tier.` |
| No pre-parsed data at fallback | NO DATA | `no data` | (follows general `buildVoiceLine` → `"Unknown."` because `perMile == null`) |
| Error / catch path | — | `analysis failed` | `Analysis failed. Decide manually.` |

### 7.4 Source of Truth

Code lines in `analyze-offer.js`:
- Share short-circuit: 263–280
- Fallback engine: 286–400
- No-data case: 401–411
- `voice` computation: 425
- Error response: 649–661

---

## 8. Response Shape

All paths return JSON. Shape is stable across the four paths; fields not applicable to a path carry documented defaults rather than being omitted.

### 8.1 Success — Main Phase 1 (HTTP 200)

```json
{
  "success": true,
  "voice": "Accept. dollar fifty-seven per mile, 6 miles.",
  "notification": "ACCEPT: $1.57 6.0mi",
  "decision": "ACCEPT",
  "reason": "$1.57 6.0mi",
  "response_time_ms": 1823
}
```

### 8.2 Share-Tier Auto-Reject (HTTP 200)

Fires **before** any AI call when `classifyTier` returns `"share"`:

```json
{
  "success": true,
  "voice": "Reject. Share tier.",
  "notification": "REJECT: share",
  "decision": "REJECT",
  "reason": "share",
  "response_time_ms": 4
}
```

### 8.3 No-Data Path (HTTP 200)

Gemini JSON parse failed AND pre-parser returned no usable `per_mile`. Decision is deliberately `"NO DATA"` — never `REJECT`:

```json
{
  "success": true,
  "voice": "Unknown.",
  "notification": "NO DATA",
  "decision": "NO DATA",
  "reason": "no data",
  "response_time_ms": 1450
}
```

### 8.4 Error Path (HTTP 500)

Uncaught exception anywhere in the handler (multer oversized upload, Gemini 5xx that bubbled, DB down, etc.):

```json
{
  "success": false,
  "voice": "Analysis failed. Decide manually.",
  "notification": "Analysis failed — decide manually",
  "error": "<Error.message>",
  "reason": "analysis failed",
  "response_time_ms": 2030
}
```

### 8.5 Field Contracts

| Field | Type | Purpose |
|-------|------|---------|
| `success` | boolean | `true` for 200 responses, `false` only on 500. |
| `voice` | string | TTS-ready line for Siri "Speak Text" action (§9). Never contains `$`, `/`, or `mi`. |
| `notification` | string | Short visual line (`"ACCEPT: $1.57 6.0mi"`). Preserves compact symbols for the screen. Do **not** feed this to Speak Text — it contains `$` and `/` that TTS mispronounces. |
| `decision` | string | `"ACCEPT" \| "REJECT" \| "NO DATA"`. Machine-actionable. |
| `reason` | string | Terse Phase-1 reason (e.g. `"$0.78 14.0mi low"`, `"share"`, `"no data"`). Exposed separately from `notification` so Shortcuts can display it independently of the spoken decision. Added 2026-04-15 (Memory #120). |
| `response_time_ms` | integer | Wall-clock ms from request arrival to `res.json()`. |
| `error` | string | Present only on 500 responses. The raw `Error.message`. |

---

## 9. Voice / TTS Pipeline

Added 2026-04-16 (Memory #121). Converts a decision + pre-parsed numbers + terse reason into a natural, TTS-friendly sentence that Siri's "Speak Text" action renders cleanly.

### 9.1 Pipeline

```
pre-parsed per_mile (float)
   └─> formatPerMileForVoice(perMile)        → "dollar fifty-seven per mile"
                                               (parse-offer-text.js:353)
terse reason (string, e.g. "$1.57 6.0mi")    → qualifier lookup (§9.3)
decision (ACCEPT | REJECT | NO DATA)         → decisionWord

   ║
   ▼
buildVoiceLine(decision, perMile, totalMiles, reason)
   └─> "Accept. dollar fifty-seven per mile, 6 miles."
   └─> "Reject. seventy-eight cents per mile, 14 miles, too far."
   └─> "Reject."     ← when per_mile or total_miles is missing
   (analyze-offer.js:38)
```

### 9.2 `formatPerMileForVoice(perMile)`

Turns a dollar value into a spoken clause. Never contains symbols.

| Input | Output |
|-------|--------|
| `null`, `NaN` | `""` |
| `0` | `"zero per mile"` |
| `0.50` | `"fifty cents per mile"` |
| `0.93` | `"ninety-three cents per mile"` |
| `1.00` | `"one dollar per mile"` |
| `1.57` | `"dollar fifty-seven per mile"` |
| `2.00` | `"two dollars per mile"` |
| `3.10` | `"three dollars ten cents per mile"` |

### 9.3 `buildVoiceLine()` Qualifier Map

When the terse reason includes one of these tokens, a natural-language tail is appended:

| Reason token | Spoken tail | Trigger (from §7) |
|--------------|-------------|-------------------|
| `too far` | `, too far` | `total_min > 40` with no accept-rule hit |
| `rating` | `, low rider rating` | Rider rating `< 4.85` |
| `floor` | `, below floor` | Below tier $/mi hard floor |
| `low` | `, rate too low` | General miss of every accept rule |

First match wins; premium's `prem` suffix is intentionally **not** surfaced in voice.

### 9.4 `buildVoiceLine()` Output Rules

| Condition | Output |
|-----------|--------|
| `decision == 'ACCEPT'` | `Accept. <perMileSpoken>, <N> miles[, <qualifier>].` |
| `decision == 'REJECT'` | `Reject. <perMileSpoken>, <N> miles[, <qualifier>].` |
| `decision == 'NO DATA'` | `No data. <perMileSpoken>, <N> miles.` → but in the NO DATA path, `per_mile == null`, so output collapses to just `"No data."` |
| `perMile == null OR totalMiles == null OR isNaN` | `"<DecisionWord>."` (bare) |

Miles are rounded to the nearest whole number with plural handling (`1 mile`, `6 miles`). Siri's TTS reads bare digits naturally (`"14 miles"` → "fourteen miles").

### 9.5 Special Literals (Bypass `buildVoiceLine`)

| Path | Voice |
|------|-------|
| Share tier short-circuit | `"Reject. Share tier."` |
| Error / catch | `"Analysis failed. Decide manually."` |

### 9.6 Why Voice Differs from `notification`

| Field | Example | Why different |
|-------|---------|---------------|
| `notification` | `"ACCEPT: $1.57 6.0mi"` | Compact; displayed on-screen. `$` and `/` are meaningful to the eye. |
| `voice` | `"Accept. dollar fifty-seven per mile, 6 miles."` | Spoken; `$` becomes "dollar sign" and `/` becomes "slash" when read verbatim by iOS TTS — unusable for hearing a decision. |

---

## 10. Database Schema (`offer_intelligence`)

**File:** `shared/schema.js:1553–1718`
**Previous table:** `intercepted_signals` (JSONB blob) — replaced 2026-02-17 by this structured-column table.
**Written to:** Once per offer, by Phase 2's async IIFE (§5). If the IIFE throws, no row is saved.

### 10.1 Column Groups

#### Identity

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid (PK) | Default `gen_random_uuid()` |
| `device_id` | varchar(255) NOT NULL | Primary identifier for Siri flows |
| `user_id` | uuid | Optional, **no FK** (headless ingestion allowed) |

#### Offer Metrics (prefer pre-parsed over AI)

| Column | Type | Source priority |
|--------|------|-----------------|
| `price` | double precision | `preParsed.price` → `dbParsedData.price` |
| `per_mile` | double precision | `preParsed.per_mile` (rounded `price / total_miles`) |
| `per_minute` | double precision | `preParsed.per_minute` |
| `hourly_rate` | double precision | `preParsed.hourly_rate` (`$X.XX/active hr`) |
| `surge` | double precision | `preParsed.surge` → `dbParsedData.surge` |
| `advantage_pct` | integer | `preParsed.advantage_pct` (Uber Pro) |
| `pickup_minutes` | integer | `preParsed.pickup_minutes` |
| `pickup_miles` | double precision | `preParsed.pickup_miles` |
| `ride_minutes` | integer | `preParsed.ride_minutes` |
| `ride_miles` | double precision | `preParsed.ride_miles` |
| `total_miles` | double precision | `preParsed.total_miles` → `dbParsedData.miles` |
| `total_minutes` | integer | `preParsed.total_minutes` |
| `product_type` | varchar(50) | Canonical (e.g. `"UberX Priority"`) |
| `platform` | varchar(20) NOT NULL default `'unknown'` | `'uber'` \| `'lyft'` \| `'unknown'` |

#### Addresses

| Column | Type | Populated by |
|--------|------|--------------|
| `pickup_address` | text | Phase 2 AI output (`deepResult.parsed_data.pickup`) |
| `dropoff_address` | text | Phase 2 AI output (`deepResult.parsed_data.dropoff`) |
| `pickup_lat` / `pickup_lng` | double precision | Future background geocoder |
| `dropoff_lat` / `dropoff_lng` | double precision | Future background geocoder |
| `geocoded_at` | timestamptz | Set when geocoder fills the coord columns |

#### Driver Location

| Column | Type | Notes |
|--------|------|-------|
| `driver_lat` / `driver_lng` | double precision | 6-decimal precision (~11 cm) |
| `coord_key` | text | `"lat6d_lng6d"` via `coordsKey()` |
| `h3_index` | text | H3 resolution-8 hex (`latLngToCell(lat, lng, 8)`) |
| `market` | varchar(100) | Coarse 1-decimal bucket `"33.1_-96.8"` |

#### Temporal

| Column | Type | Source |
|--------|------|--------|
| `local_date` | text | `YYYY-MM-DD` in driver's local timezone (via `resolveTimezoneFromCoords`) |
| `local_hour` | integer | 0-23 in driver's local timezone |
| `day_of_week` | integer | 0=Sun … 6=Sat (local timezone) |
| `day_part` | text | `getDayPartKey(hour)` |
| `is_weekend` | boolean | Saturday or Sunday (local timezone) |
| `timezone` | text | IANA zone from Google Timezone API (e.g., `America/Chicago`) |

#### AI Analysis

| Column | Type | Notes |
|--------|------|-------|
| `decision` | text NOT NULL | `'ACCEPT' \| 'REJECT' \| 'NO DATA'` — persisted verbatim from Phase 2 if available, else Phase 1 |
| `decision_reasoning` | text | Phase 2 prose reasoning if available, else Phase 1 terse reason |
| `confidence_score` | integer | 0-100 |
| `ai_model` | text | `'gemini-3.1-pro'` on Phase 2 success, `'gemini-3-flash'` on Phase 2 fallback |
| `response_time_ms` | integer | Phase 1 latency (the only latency the driver experienced) |

#### Driver Feedback

| Column | Type | Notes |
|--------|------|-------|
| `user_override` | text | `null \| 'ACCEPT' \| 'REJECT'`. Written by `POST /api/hooks/offer-override`. |

#### Sequence Tracking

| Column | Type | Notes |
|--------|------|-------|
| `offer_session_id` | uuid | Groups offers within a 30-min window per device |
| `offer_sequence_num` | integer | 1, 2, 3 … within a session |
| `seconds_since_last` | integer | Seconds between this offer and the prior one on this device |

#### Parse Quality / Provenance

| Column | Type | Notes |
|--------|------|-------|
| `parse_confidence` | varchar(20) | `'full' \| 'partial' \| 'minimal'` from pre-parser |
| `source` | varchar(50) NOT NULL default `'siri_shortcut'` | `'siri_shortcut' \| 'siri_vision' \| 'android_automation' \| 'manual'` |
| `input_mode` | varchar(20) NOT NULL default `'text'` | `'text' \| 'vision'` |

#### Raw Data

| Column | Type | Notes |
|--------|------|-------|
| `raw_text` | text | Original OCR text; for vision mode: `"[Vision: NKB image]"` placeholder |
| `raw_ai_response` | text | Phase 2 raw text if available, else Phase 1 raw text |
| `parsed_data_json` | jsonb | Merged `preParsed + dbParsedData + location_analysis` |

#### Timestamps

| Column | Type | Notes |
|--------|------|-------|
| `created_at` | timestamptz NOT NULL default `now()` | Row insert time |
| `updated_at` | timestamptz NOT NULL default `now()` | Updated on override |

### 10.2 Indexes (13 total)

| Index | Columns | Query pattern |
|-------|---------|--------------|
| `idx_oi_device_created` | `(device_id, created_at DESC)` | Device history |
| `idx_oi_market_daypart` | `(market, day_part, platform)` where market NN | Avg $/mi by daypart |
| `idx_oi_h3_decision` | `(h3_index, decision)` where h3_index NN | Best offer areas |
| `idx_oi_date_platform` | `(local_date, platform, per_mile)` | Daily pricing floor |
| `idx_oi_weekend_hour` | `(is_weekend, local_hour, platform)` | Weekend vs weekday |
| `idx_oi_session_seq` | `(offer_session_id, offer_sequence_num)` | Sequence analysis |
| `idx_oi_driver_location` | `(driver_lat, driver_lng)` | Spatial lookup |
| `idx_oi_override` | `(device_id, user_override)` where override NN | Override rate |
| `idx_oi_user_id` | `(user_id)` where user_id NN | User linkage |
| `idx_oi_per_mile` | `(per_mile DESC)` where NN | Best-offer ranking |
| `idx_oi_created_at` | `(created_at DESC)` | Time-series queries |
| `idx_oi_need_geocode` | `(id)` where geocoded_at NULL and pickup_address NN | Geocoder backfill job |

---

## 11. Siri Shortcuts Integration

Detailed Shortcut scripts live in `server/api/hooks/README.md`. Below is the contract this endpoint promises for those Shortcuts.

### 11.1 Shortcut 1 — "Vecto Analyze" (Text Mode)

1. Take Screenshot
2. Extract Text from Image (iOS on-device OCR, ~200 ms)
3. Get Current Location
4. Get Contents of URL — POST to `https://vectopilot.com/api/hooks/analyze-offer`
   ```json
   { "text": "[Extracted Text]", "device_id": "[Device Name]",
     "latitude": "[Latitude]", "longitude": "[Longitude]",
     "source": "siri_shortcut" }
   ```
5. Get Dictionary Value — key: `voice`
6. **Speak Text** — [voice]

### 11.2 Shortcut 2 — "Vecto Vision" (Image Mode)

1. Take Screenshot
2. **Convert Image** — Format: JPEG, Quality: 0.6 (~3 MB PNG → ~300 KB JPEG — critical to stay under the 5 MB body limit after base64 adds 33% overhead)
3. Base64 Encode
4. Get Current Location
5. Get Contents of URL — POST with `source: "siri_vision"`
6. Get Dictionary Value — key: `voice`
7. **Speak Text** — [voice]

### 11.3 Recommended Shortcut Actions per Response Field

| Shortcut action | Dictionary key | Use |
|-----------------|---------------|-----|
| **Speak Text** | `voice` | Hands-free spoken decision |
| **Show Notification** | `notification` | Visual pop with compact `ACCEPT/REJECT: $X.XX Y.Ymi` |
| **Get Dictionary Value** | `decision` | Branch logic (`if ACCEPT → play tone A`) |
| **Get Dictionary Value** | `reason` | Display the rejection reason on screen separately from the spoken decision |

### 11.4 Timing Constraints

| Context | Window | Notes |
|---------|--------|-------|
| Trip Radar offers | ~3 s | Very tight. Phase 1 must return in <2 s. |
| Regular offers | ~9 s | Comfortable. |
| Phase 1 target | <2 s | Flash + lean prompt. |
| Phase 2 | async | Never gates the Shortcut — runs after response. |

### 11.5 Why `voice` and `notification` Are Both Present

Driver wants to both **hear** and **see** the answer. `voice` strips symbols for TTS fidelity; `notification` keeps symbols for visual compactness. `reason` is exposed separately so the Shortcut can display the rejection rationale without embedding it in either formatted field.

---

## 12. Business Rules Summary

Consolidated accept/reject thresholds across tiers. These are the thresholds used by **both** Phase 1 Gemini prompts (§4.2) and the deterministic fallback (§7). Phase 2 also receives them in its system prompt for consistency.

| Tier | $/mi Floor | Accept if ≤20 min | ≤25 min | ≤30 min | ≤40 min | >40 min | Always-REJECT flags |
|------|-----------|-------------------|---------|---------|---------|---------|---------------------|
| **share** | — | — | — | — | — | — | Entire tier |
| **standard** | $0.90 | $0.90 | $1.10 | $1.75 (<30) | $2.00 | $2.00 | Rating <4.85; "Verified" missing |
| **premium** | $1.10 | — | $1.10 | $1.40 | $1.75 | $2.00 | Rating <4.85; "Verified" missing |

**Short rides at good $/mi always ACCEPT** — there is no city/zone gate at Phase 1. A $10 Comfort ride for 5 min in Plano clears premium rule 4 regardless of geography. Phase 2 adds geographic nuance to the stored row but does **not** override the driver's Phase 1 answer.

---

## 13. Coach and Strategy Integration

### 13.1 Rideshare Coach DAL

**File:** `server/lib/ai/rideshare-coach-dal.js`
**Load:** `getOfferHistory(20)` inside `getCompleteContext()` batch (~line 826).
**Query:** Last 20 rows from `offer_intelligence` for the user's device (~lines 1249–1307).

Computed stats:

```typescript
{ total: 20, accepted: 12, rejected: 8,
  accept_rate_pct: 60, overrides: 2,
  avg_per_mile: 1.42, avg_response_ms: 1823 }
```

System-prompt injection (~lines 1190–1216):

```
=== RIDE OFFER ANALYSIS LOG ===
Stats (last 20 offers):
   Accept rate: 60% (12 accepted, 8 rejected)
   Avg $/mile: $1.42
   Avg response time: 1823ms
   Driver overrides: 2 times

Recent offers:
   1. ACCEPT $9.43/4.6mi $2.05/mi (2:15 PM)
   2. REJECT $7.82/10.1mi $0.77/mi (2:08 PM)

Use offer patterns to advise on positioning, timing, and offer strategy.
```

### 13.2 Strategy Integration

Offer data is **not** directly injected into strategy generation today. The Coach references offer patterns when advising (via the prompt block above), but venue scoring and positioning strategies do not consume `offer_intelligence`. Listed as gap §16.

---

## 14. Android Considerations

**Status:** Planned. Schema (`source: 'android_automation'`) and bot-blocker allow-list already support it, but no client shell exists.

| Option | How | Complexity |
|--------|-----|------------|
| Tasker + AutoShare | Share intent → Tasker → HTTP POST | Medium (user setup) |
| Custom Android app | Accessibility service or notification listener → POST | High |
| Android 12+ Shortcuts | HTTP action | Medium |
| Share intent | "Share screenshot" → Vecto app → POST | Medium (requires app) |

What is missing: native app, share-intent handler, accessibility service, notification listener, Play Store presence.

---

## 15. Current State

| Area | Status |
|------|--------|
| Phase 1 (Gemini Flash, <2 s) | ✅ Production |
| Phase 2 (Gemini Pro, async 45 s) | ✅ Production |
| Siri Shortcut: text mode (`Vecto Analyze`) | ✅ Working |
| Siri Shortcut: vision mode (`Vecto Vision`) | ✅ Working |
| Siri Shortcut: multipart (server-side base64) | ✅ Working — fastest |
| Pre-parser regex (8 extractors) | ✅ Working |
| Tier classification (share/standard/premium) | ✅ Working |
| Share auto-reject (skip AI) | ✅ Working |
| Deterministic fallback rule engine | ✅ Working |
| `offer_intelligence` DB storage (107-column structured) | ✅ Working |
| Coach integration (last 20 offers + stats) | ✅ Working |
| SSE broadcast (`offer_analyzed`) | ✅ Working |
| `reason` field surfaced to Siri | ✅ Added 2026-04-15 (Memory #120) |
| Voice TTS pipeline (`buildVoiceLine`, qualifier map) | ✅ Added 2026-04-16 (Memory #121) |
| Android support | ⬜ Infrastructure ready, client missing |

---

## 16. Open Issues / Future Work

1. **Zero authentication** — Endpoint is public by design (Siri can't send JWTs). Tracked as HIGH in `SECURITY.md`. Mitigation: device registration + per-device rate limiting.
2. **Phase 2 reasoning never surfaces to the driver** — Gemini Pro produces richer reasoning and `location_analysis` enums, but the driver already heard the Phase 1 `voice` and there is no push back to the device. Options: SSE → iOS Live Activity, or background Shortcut poll.
3. **"Verified" check is AI-only** — The "Verified missing → REJECT" rule in the prompts depends on the AI seeing the badge in the screenshot/text. The deterministic fallback has no regex for it; if Gemini JSON fails and the driver's text lacks the badge, the fallback cannot enforce this rule.
4. **DFW-specific geography** — Phase 2 system prompt hardcodes Frisco home base and DFW geography (airport, Fort Worth, Denton outskirts). Won't generalize to other markets. Fix: inject driver's market/home base from their profile.
5. **No user-override learning** — `user_override` is stored but never feeds back into thresholds or prompts.
6. **No offer data in strategy prompt** — Strategy generation ignores offer patterns. Venue scoring could weight areas by historic $/mi.
7. **`vehicle_mode` not propagating** — Coach inbox bug: XL/Comfort info extracted by OCR does not reach Coach AI context.
8. **Trip Radar timing is tight** — 3 s window; Flash at ~2.5 s burns most of it. No P95 alerting yet.
9. ~~**Temporal columns use UTC `new Date()`**~~ — **FIXED 2026-04-16.** Temporal columns now use `resolveTimezoneFromCoords()` (Google Timezone API) to derive driver-local hour/day/date. `timezone` column is now written on every offer. Falls back to UTC only if coord-based resolution fails.
10. **Phase 2 errors silently degrade** — If the IIFE itself throws after Phase 2, **no DB row is written** at all. Siri got its answer, but we lose the analytics record. Fix: outer try/catch that writes a Phase-1-only row.
11. **No rate limiting per `device_id`** — Current rate limiting is IP-based only.
12. **No vision-mode fallback** — `OFFER_ANALYZER` was removed from the hedged-fallback list because non-vision models can't process images. A Gemini Flash outage means the entire Phase 1 request fails over to the deterministic fallback (text mode only) or errors out (vision mode).
13. **`NO DATA` voice line** — For the no-data response, `buildVoiceLine` produces bare `"Unknown."`; worth explicitly returning `"No data. Decide manually."` for consistency with the error path.

---

## 17. Key Files

| File | Purpose |
|------|---------|
| `server/api/hooks/analyze-offer.js` | Main endpoint (814 lines), `buildVoiceLine` helper |
| `server/api/hooks/README.md` | Endpoint + Siri Shortcut scripts + decision-rule tables |
| `server/lib/offers/parse-offer-text.js` | Regex pre-parser (377 lines), `classifyTier`, `formatPerMileForVoice` |
| `server/lib/ai/model-registry.js` | `OFFER_ANALYZER` (Flash) and `OFFER_ANALYZER_DEEP` (Pro 3.1) role configs |
| `server/lib/ai/adapters/gemini-adapter.js` | Vision-capable Gemini adapter |
| `server/lib/ai/rideshare-coach-dal.js` | Coach reads offer history (`getOfferHistory(20)`) |
| `shared/schema.js` (lines 1553–1718) | `offer_intelligence` table + 13 indexes |
| `server/lib/location/coords-key.js` | 6-decimal `coord_key` formatter |
| `server/lib/location/daypart.js` | `getDayPartKey(hour)` for temporal column |
| `server/bootstrap/middleware.js` | 5 MB body limit for `/api/hooks` |

---

## Appendix A — Change Log

| Date | Version | Change |
|------|---------|--------|
| 2026-02-15 | — | Initial endpoint scaffolded |
| 2026-02-16 | — | Server-side OCR pre-parser; 6-decimal GPS; vision mode |
| 2026-02-17 | — | `intercepted_signals` JSONB → `offer_intelligence` structured |
| 2026-02-28 | — | Two-phase split (Flash sync + Pro 3.1 async) |
| 2026-03-29 | — | Tier-aware prompts (share/standard/premium); canonical product names |
| 2026-04-10 | 1.0 | First comprehensive doc pass |
| 2026-04-15 | — | `reason` field added to response (Memory #120) |
| 2026-04-16 | 2.0 | `voice` field wired via `buildVoiceLine` + qualifier map (Memory #121); this doc rewritten end-to-end |
