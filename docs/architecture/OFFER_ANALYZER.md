# OFFER_ANALYZER.md — Offer Analysis System End-to-End

> **Canonical reference** for the ride offer analysis system: Siri Shortcuts integration, zero-auth endpoint, Gemini Vision, text fallback, Android plans, data schema, and coach/strategy integration.
> Last updated: 2026-04-10

## Supersedes
- `docs/architecture/media-handling.md` — Screenshot/image handling (absorbed: Siri screenshots, base64 encoding, multer config)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Siri Shortcuts Integration (iOS)](#2-siri-shortcuts-integration-ios)
3. [Backend API Endpoint](#3-backend-api-endpoint)
4. [Phase 1: Rapid Decision (Gemini Flash Vision)](#4-phase-1-rapid-decision-gemini-flash-vision)
5. [Phase 2: Deep Analysis (Gemini Pro Async)](#5-phase-2-deep-analysis-gemini-pro-async)
6. [Text-Based Offer Parsing (Regex Fallback)](#6-text-based-offer-parsing-regex-fallback)
7. [Tier Classification and Decision Rules](#7-tier-classification-and-decision-rules)
8. [Data Schema: offer_intelligence Table](#8-data-schema-offer_intelligence-table)
9. [Coach and Strategy Integration](#9-coach-and-strategy-integration)
10. [Android Considerations](#10-android-considerations)
11. [Current State](#11-current-state)
12. [Known Gaps](#12-known-gaps)
13. [TODO — Hardening Work](#13-todo--hardening-work)

---

## 1. Architecture Overview

```
iPhone: Uber/Lyft shows ride offer
  │
  ├─ Siri Shortcut triggers (voice: "Vecto Analyze")
  │  ├─ Take Screenshot
  │  ├─ Extract text (iOS OCR) OR Base64 encode image
  │  ├─ Get Current Location
  │  └─ POST /api/hooks/analyze-offer  ← ZERO AUTH (Siri can't send JWT)
  │
  ├─ PHASE 1 (Synchronous, <2s)
  │  ├─ Pre-parse text with regex (<1ms)
  │  ├─ Classify tier (share/standard/premium)
  │  ├─ Auto-reject Share rides (skip AI)
  │  ├─ Gemini 3 Flash (Vision) → ACCEPT/REJECT
  │  ├─ Fallback: Rule engine if JSON parse fails
  │  └─ RESPOND TO SIRI IMMEDIATELY
  │     └─ Siri speaks: "Accept. Dollar fifty-seven per mile."
  │
  └─ PHASE 2 (Async, fire-and-forget, 45s timeout)
     ├─ Gemini 3.1 Pro (Vision) → Rich analysis
     ├─ Location analysis, deadhead assessment
     ├─ INSERT offer_intelligence table (107 columns)
     └─ pg_notify('offer_analyzed') → SSE broadcast
```

---

## 2. Siri Shortcuts Integration (iOS)

**Documentation:** `server/api/hooks/README.md` (lines 130–162)

### Shortcut 1: "Vecto Analyze" (Text Mode — Fastest)

1. **Trigger:** User says "Hey Siri, Vecto Analyze" (or taps shortcut)
2. **Take Screenshot** — captures current Uber/Lyft offer screen
3. **Extract Text from Image** — iOS built-in OCR (on-device, ~200ms)
4. **Get Current Location** — GPS coordinates
5. **POST** `/api/hooks/analyze-offer` with:
   ```json
   { "text": "OCR extracted text", "device_id": "iPhone-ABC", "latitude": 33.12, "longitude": -96.87, "source": "siri_shortcut" }
   ```
6. **Get Dictionary Value** — key: `voice`
7. **Speak Text** — Siri speaks the decision aloud

### Shortcut 2: "Vecto Vision" (Image Mode — More Accurate)

1. **Trigger:** "Hey Siri, Vecto Vision"
2. **Take Screenshot**
3. **Convert to JPEG, Quality 0.6** — compresses 3MB PNG → ~300KB (CRITICAL: 5MB body limit)
4. **Base64 Encode**
5. **Get Current Location**
6. **POST** `/api/hooks/analyze-offer` with:
   ```json
   { "image": "base64...", "device_id": "iPhone-ABC", "latitude": 33.12, "longitude": -96.87, "source": "siri_vision" }
   ```
7. **Speak Text** from `voice` field

### Siri Timeout Constraints

- **Trip Radar offers:** ~3 second window (very tight)
- **Regular offers:** ~9 seconds
- **Phase 1 target:** <2 seconds (Flash model, lean prompt)
- **If Phase 1 exceeds timeout:** Siri gets no response, driver sees nothing

---

## 3. Backend API Endpoint

**Route:** `POST /api/hooks/analyze-offer`
**File:** `server/api/hooks/analyze-offer.js` (753 lines)
**Auth:** **NONE — Explicitly public** (Siri Shortcuts cannot send JWT tokens)
**Body limit:** 5MB
**Security concern:** Flagged in SECURITY.md as HIGH risk zero-auth endpoint

### Three Input Modes

| Mode | Content-Type | How Image Arrives | Speed |
|------|-------------|-------------------|-------|
| **Text** (OCR) | application/json | iOS OCR text in `text` field | Fastest (regex only) |
| **Vision** (base64) | application/json | Base64 string in `image` field | Fast (Gemini processes) |
| **Multipart** (file) | multipart/form-data | Raw image file | Fastest for Siri (server base64 encodes <1ms) |

### Request Fields

```typescript
{
  text?: string;           // OCR-extracted text
  image?: string;          // Base64-encoded screenshot
  device_id: string;       // Device identifier
  latitude?: number;       // GPS lat
  longitude?: number;      // GPS lng
  source?: string;         // 'siri_shortcut' | 'siri_vision' | 'android_automation' | 'manual'
  user_id?: string;        // Optional user link
}
```

---

## 4. Phase 1: Rapid Decision (Gemini Flash Vision)

**Lines:** 187–389
**Model:** `OFFER_ANALYZER` → `gemini-3-flash-preview` | maxTokens: 1024 | temp: 0.1 | features: vision
**Target latency:** <2 seconds

### Flow

1. **Pre-parse** OCR text with regex (`parseOfferText()`, <1ms)
2. **Classify tier:** `classifyTier()` → share / standard / premium
3. **Auto-reject Share:** Skip AI entirely, return REJECT immediately
4. **Call Gemini Flash** with tier-specific prompt + screenshot image
5. **Parse JSON** decision from response
6. **Fallback:** If JSON parse fails, use deterministic rule engine
7. **Format voice** response for Siri: `"Accept. Dollar fifty-seven per mile."`
8. **Respond immediately** to Siri

### Tier-Specific Phase 1 Prompts

**Share** (lines 41–43): Auto-REJECT. No AI needed.
```
{"price":0,"per_mile":0,"decision":"REJECT","reason":"share"}
```

**Standard** (lines 45–62): 9 decision rules
- $0.90/mi floor
- 20-40 min tolerance based on $/mi
- Rating <4.85 → REJECT

**Premium** (lines 64–82): 8 rules
- $1.10/mi floor (higher than standard)
- 25-40 min tolerance (more relaxed)

### Response Format

```json
{
  "success": true,
  "voice": "Accept. dollar fifty-seven per mile.",
  "notification": "ACCEPT $1.57/mi",
  "decision": "ACCEPT",
  "price": 9.43,
  "per_mile": 1.57,
  "response_time_ms": 1823
}
```

---

## 5. Phase 2: Deep Analysis (Gemini Pro Async)

**Lines:** 390–590
**Model:** `OFFER_ANALYZER_DEEP` → `gemini-3.1-pro-preview` | maxTokens: 2048 | temp: 0.2 | thinkingLevel: LOW | features: vision
**Timeout:** 45 seconds (wrapped in `Promise.race`)
**Timing:** Fire-and-forget AFTER Phase 1 returns to Siri

### Flow

1. Build rich context (driver location, tier, DFW geography)
2. Inject tier-specific rules at runtime
3. Call Gemini Pro with vision (same screenshot)
4. Merge Phase 1 + Phase 2 results
5. INSERT into `offer_intelligence` table (107 columns)
6. `pg_notify('offer_analyzed')` → SSE broadcast to connected clients

### Phase 2 System Prompt (lines 86–127)

Full DFW geographic context:
- Frisco home base
- Avoid: west of DFW Airport, Fort Worth, Denton outskirts
- Deadhead zones requiring $2.00+/mi
- Full JSON schema for structured output (location analysis, confidence, reasoning)

---

## 6. Text-Based Offer Parsing (Regex Fallback)

**File:** `server/lib/offers/parse-offer-text.js` (377 lines)
**Function:** `parseOfferText()` (line 228)
**Speed:** <1ms (deterministic regex, no AI)

### Extracted Fields

| Function | Extracts | Example |
|----------|----------|---------|
| `extractPrice()` | Ride price | `$9.43` |
| `extractHourlyRate()` | $/active hour | `$22.50/hr` |
| `extractTimeDistancePairs()` | Pickup + ride time/distance | `8 min, 4.6 mi` |
| `extractProductType()` | Product name | `UberX`, `Comfort`, `XL` |
| `extractSurge()` | Surge/priority bonus | `+$3.50` |
| `extractAdvantage()` | Uber Pro advantage % | `12%` |
| `detectPlatform()` | Platform | `uber` / `lyft` / `unknown` |

### Voice Formatting

`formatPerMileForVoice(1.57)` → `"dollar fifty-seven per mile"`

---

## 7. Tier Classification and Decision Rules

### Tier Classification

**Function:** `classifyTier()` (line 146)

| Tier | Products | Floor $/mi |
|------|----------|-----------|
| Share | UberX Share, Lyft Shared | Auto-REJECT |
| Standard | UberX, Lyft, basic rides | $0.90/mi |
| Premium | Comfort, VIP, XL, Lux, Black | $1.10/mi |

### Standard Decision Rules (9 rules, first match wins)

1. Rating <4.85 → REJECT
2. "Verified" missing → REJECT
3. $/mi <$0.90 → REJECT
4. $/mi ≥$0.90 + ≤20min → ACCEPT
5. $/mi ≥$1.10 + ≤25min → ACCEPT
6. $/mi ≥$1.75 + <30min → ACCEPT
7. $/mi ≥$2.00 + 30-40min → ACCEPT
8. $/mi ≥$2.00 + >40min → ACCEPT
9. Default → REJECT

### Premium Decision Rules (8 rules)

Same structure but with $1.10/mi floor and more relaxed timing.

---

## 8. Data Schema: offer_intelligence Table

**File:** `shared/schema.js` (lines 1548–1713)
**107 columns, 13 indexes**

### Key Column Groups

| Group | Columns | Purpose |
|-------|---------|---------|
| Device/User | `device_id`, `user_id` | Identity |
| Metrics | `price`, `per_mile`, `pickup_minutes`, `ride_miles`, `total_miles`, `product_type`, `platform`, `surge` | Offer data |
| Addresses | `pickup_address`, `dropoff_address`, geocoded coords | Geography |
| Driver Location | `driver_lat/lng` (6-decimal), `coord_key`, `h3_index` | Spatial |
| Temporal | `local_date`, `local_hour`, `day_of_week`, `day_part`, `is_weekend` | Time context |
| AI Analysis | `decision`, `decision_reasoning`, `confidence_score`, `ai_model`, `response_time_ms` | AI output |
| Driver Feedback | `user_override` | Did driver override AI? |
| Sequence | `offer_session_id`, `offer_sequence_num`, `seconds_since_last` | Offer patterns |
| Parse Quality | `parse_confidence`, `source`, `input_mode` | Data quality |
| Raw Data | `raw_text`, `raw_ai_response`, `parsed_data_json` | Debug |

### Indexes

Device history, market/daypart, H3 clustering, date/platform, weekend/hour, session/sequence, driver location, override rate, user linkage, per_mile ranking, creation time, geocode backfill.

---

## 9. Coach and Strategy Integration

### Coach DAL Integration

**File:** `server/lib/ai/coach-dal.js`

**Loading:** `getOfferHistory(20)` called in `getCompleteContext()` batch (line 826)
**Query:** Last 20 offers from `offer_intelligence` (lines 1249–1307)

### Statistics Computed

```javascript
{
  total: 20,
  accepted: 12,
  rejected: 8,
  accept_rate_pct: 60,
  overrides: 2,
  avg_per_mile: 1.42,
  avg_response_ms: 1823
}
```

### System Prompt Injection (lines 1190–1216)

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

The Coach uses this data to:
- Identify earning patterns ("You're averaging $1.42/mi — premium positioning could raise this")
- Detect override patterns ("You've overridden the AI twice — want me to adjust thresholds?")
- Correlate offers with location ("Offers near the airport are consistently $2+/mi")

### Strategy Integration

Offer data is **not directly injected** into strategy generation. However, the Coach can reference offer patterns when providing advice, and venue scoring could be enhanced with offer history (TODO).

---

## 10. Android Considerations

### Current Status: PLANNED — Infrastructure Ready

**Schema support** (`shared/schema.js` line 1500):
```javascript
source: varchar("source", { length: 50 }).notNull()
  .default('siri_shortcut'), // 'siri_shortcut' | 'android_automation' | 'manual'
```

**Bot blocker whitelist** (`middleware/bot-blocker.js`):
```
"Allow hooks (Siri Shortcuts, Android Automations)"
```

### Same Endpoint

Android will use the same `POST /api/hooks/analyze-offer` endpoint with the same JSON or multipart input format.

### Android Implementation Options

| Option | How It Works | Complexity |
|--------|-------------|------------|
| **Tasker + AutoShare** | Share intent → Tasker → HTTP POST | Medium (user setup) |
| **Custom Android app** | Accessibility service or notification listener → POST | High (requires app) |
| **Android Shortcuts** | Android 12+ Shortcuts → HTTP action | Medium |
| **Share intent** | "Share screenshot" → Vecto app → POST | Medium (requires app) |

### What's Missing for Android

1. **No Android app** — No native shell to receive screenshots
2. **No share intent handler** — No registered intent filter
3. **No accessibility service** — Can't auto-capture offer screens
4. **No notification listener** — Can't intercept Uber/Lyft push notifications
5. **No Play Store presence** — No distribution channel

---

## 11. Current State

| Area | Status |
|------|--------|
| Phase 1 (Gemini Flash, <2s) | Working — production tested |
| Phase 2 (Gemini Pro, async) | Working — 45s timeout |
| Siri Shortcut: Text mode | Working |
| Siri Shortcut: Vision mode | Working |
| Offer pre-parser (regex) | Working — 8 extraction functions |
| Tier classification | Working — share/standard/premium |
| Auto-reject Share | Working |
| Rule engine fallback | Working — when JSON parse fails |
| offer_intelligence DB storage | Working — 107 columns |
| Coach integration (last 20 offers) | Working — stats + recent list |
| SSE broadcast (offer_analyzed) | Working |
| Voice formatting for Siri | Working |
| Android support | **Not implemented** — infrastructure ready |

---

## 12. Known Gaps

1. **Zero authentication** — Any client can POST images for AI analysis. No device registration, no API key. Trivially abusable. (Flagged as HIGH in SECURITY.md)
2. **No Android implementation** — iOS only via Siri Shortcuts. Android drivers can't use offer analysis.
3. **DFW-specific geography** — Phase 2 prompt hardcodes DFW (Frisco home base, airport zones). Won't work correctly for drivers in other markets.
4. **No user override learning** — When driver overrides AI (accepts what AI rejected or vice versa), the system records it but doesn't learn from it.
5. **No offer data in strategy prompt** — Strategy generation doesn't consider offer patterns.
6. **vehicle_mode not passing correctly** — Coach inbox bug: XL/Comfort info from OCR not reaching AI context.
7. **No offer batching** — Each offer analyzed independently, even during rapid Trip Radar sequences.
8. **Siri timeout is tight** — 3 seconds for Trip Radar. If Gemini Flash is slow (~2.5s), the window is very narrow.

---

## 13. TODO — Hardening Work

- [ ] **Add device registration auth** — Require one-time device registration before accepting offers. Store device_id → user_id mapping
- [ ] **Build Android app/shortcut** — Minimum viable: share intent handler that POSTs screenshot to API
- [ ] **Market-aware prompts** — Generalize Phase 2 prompt beyond DFW. Inject driver's market geography dynamically
- [ ] **Override learning** — Feed driver overrides back into decision rules. Adjust $/mi thresholds per driver
- [ ] **Inject offer data into strategy** — Use offer patterns (avg $/mi by area, time) to enhance strategy recommendations
- [ ] **Fix vehicle_mode parsing** — Ensure XL/Comfort/Black product type reaches AI context correctly
- [ ] **Offer batching for Trip Radar** — Group rapid-fire offers, analyze best one
- [ ] **Phase 1 latency monitoring** — Alert when P95 exceeds 2.5s (Siri timeout risk)
- [ ] **Add rate limiting per device_id** — Currently only IP-based. Device-level limiting would prevent abuse

---

## Key Files

| File | Purpose |
|------|---------|
| `server/api/hooks/analyze-offer.js` | Main endpoint (753 lines) |
| `server/lib/offers/parse-offer-text.js` | Regex pre-parser (377 lines) |
| `server/api/hooks/README.md` | Siri Shortcuts docs + decision rules |
| `server/lib/ai/model-registry.js` | OFFER_ANALYZER, OFFER_ANALYZER_DEEP configs |
| `server/lib/ai/coach-dal.js` | Coach offer history integration |
| `shared/schema.js` (lines 1548–1713) | offer_intelligence table schema |
