# External Hooks — `/api/hooks/`

**Last Updated:** 2026-02-16

Public endpoints for external automation tools (Siri Shortcuts, Android Automations) that operate **without JWT authentication**. Uses `device_id` for identification instead.

## Files

| File | Purpose |
|------|---------|
| `analyze-offer.js` | Ride offer analysis, history, and override endpoints |

## Endpoints

### `POST /api/hooks/analyze-offer`

Real-time ride offer analysis from Siri Shortcuts. Accepts **OCR text** or a **base64 screenshot** of an Uber/Lyft offer. Text mode pre-parses with regex; vision mode sends the image directly to Gemini Flash for extraction.

**Auth:** None (public — Siri Shortcuts cannot send JWT tokens)
**AI Model:** `OFFER_ANALYZER` role (Gemini 3 Flash — optimized for speed)
**Pre-Parser:** `server/lib/offers/parse-offer-text.js` extracts price/miles/times via regex (text mode only)
**Database:** Writes to `intercepted_signals` table
**SSE:** Broadcasts `offer_analyzed` event via pg NOTIFY
**Coach:** AI Coach reads offer history via `CoachDAL.getOfferHistory()`
**Body limit:** 5MB (route-specific, for image payloads)

**Request (text mode — "Vecto Analyze"):**
```json
{
  "text": "OCR text from ride offer screenshot",
  "device_id": "Melody's iPhone",
  "latitude": 32.780140,
  "longitude": -96.800250,
  "source": "siri_shortcut"
}
```

**Request (vision mode — "Vecto Vision"):**
```json
{
  "image": "<base64-encoded JPEG>",
  "image_type": "image/jpeg",
  "device_id": "Melody's iPhone",
  "latitude": 32.780140,
  "longitude": -96.800250,
  "source": "siri_vision"
}
```

**Response (same for both modes):**
```json
{
  "success": true,
  "voice": "Accept. dollar fifty-seven per mile.",
  "notification": "ACCEPT $1.57/mi",
  "decision": "ACCEPT",
  "response_time_ms": 1823
}
```

- `voice` — Pre-formatted for Siri "Speak Text" action (includes spoken $/mile)
- `notification` — Short format for visual display

### `GET /api/hooks/offer-history?device_id=xxx&limit=20`

Returns recent offer analyses for a device with aggregate stats.

**Auth:** None (device_id based)

**Response includes:**
- `stats`: { total, accepted, rejected, avg_response_ms, avg_confidence }
- `offers`: Array of recent intercepted_signals records

### `POST /api/hooks/offer-override`

Driver disagreed with AI decision — records the override for training data.

**Auth:** None (device_id must match original analysis)

**Request:**
```json
{
  "id": "uuid of the offer analysis",
  "user_override": "ACCEPT",
  "device_id": "Melody's iPhone"
}
```

## Decision Rules (2026-03-29)

Phase 1 uses **tier-aware $/mi + duration thresholds** — no city/zone classification. Product type is parsed server-side, classified into a tier, and the matching prompt/rules are applied. Phase 2 (async) handles geographic deep analysis.

### Tier Classification (from 300+ DFW offers)

| Tier | Products | Rationale |
|------|----------|-----------|
| **share** | Share, Lyft Shared | Auto-REJECT. Median $0.69/mi, 0% accept rate. Skips AI call entirely. |
| **standard** | UberX, UberX Exclusive, UberX Priority, Lyft, unknown | Accepted avg $1.13/mi, rejected avg $0.77/mi. Core volume tier. |
| **premium** | Comfort, VIP, Black, UberXL, Lyft XL, Lyft Lux | Higher floor ($1.10), relaxed time limits. Worth more per-mile. |

### Standard Rules (UberX / Exclusive / Priority / Lyft)

| Rule | Condition | Decision |
|------|-----------|----------|
| 1 | Rider rating < 4.85 | **REJECT** |
| 2 | "Verified" missing from OCR | **REJECT** |
| 3 | $/mi < $0.90 (hard floor) | **REJECT** |
| 4 | $/mi >= $0.90 + ≤20 min | **ACCEPT** |
| 5 | $/mi >= $1.10 + ≤25 min | **ACCEPT** |
| 6 | $/mi >= $1.75 + <30 min | **ACCEPT** |
| 7 | $/mi >= $2.00 + 30-40 min | **ACCEPT** |
| 8 | $/mi >= $2.00 + >40 min | **ACCEPT** |
| 9 | Default | **REJECT** |

### Premium Rules (Comfort / VIP / Black / XL)

| Rule | Condition | Decision |
|------|-----------|----------|
| 1 | Rider rating < 4.85 | **REJECT** |
| 2 | "Verified" missing from OCR | **REJECT** |
| 3 | $/mi < $1.10 (premium floor) | **REJECT** |
| 4 | $/mi >= $1.10 + ≤25 min | **ACCEPT** |
| 5 | $/mi >= $1.40 + ≤30 min | **ACCEPT** |
| 6 | $/mi >= $1.75 + ≤40 min | **ACCEPT** |
| 7 | $/mi >= $2.00 + >40 min | **ACCEPT** |
| 8 | Default | **REJECT** |

**Critical:** Short rides with good $/mi = ACCEPT regardless of city. A $10 Comfort ride for 5 min in Plano clears premium rule 4 — no need to classify it as "local" or "not local".

## Two Shortcuts (A/B Testing)

### Shortcut 1: "Vecto Analyze" (text mode)

Uses Siri's built-in OCR to extract text before sending to server. Server pre-parses with regex for reliable numbers.

1. **Trigger:** User says "Vecto Analyze"
2. **Action 1:** Take Screenshot
3. **Action 2:** Extract Text from Image (built-in iOS OCR)
4. **Action 3:** Get Current Location
5. **Action 4:** Get Contents of URL
   - URL: `https://vectopilot.com/api/hooks/analyze-offer`
   - Method: POST
   - Body: `{ "text": "[Extracted Text]", "device_id": "[Device Name]", "latitude": "[Latitude]", "longitude": "[Longitude]", "source": "siri_shortcut" }`
6. **Action 5:** Get Dictionary Value — key: `voice`
7. **Action 6:** Speak Text — [voice value]

### Shortcut 2: "Vecto Vision" (vision mode)

Skips Siri OCR entirely — sends raw screenshot as base64 to Gemini Flash vision. Potentially faster because OCR is the slowest step in the text flow.

1. **Trigger:** User says "Vecto Vision"
2. **Action 1:** Take Screenshot
3. **Action 2:** Convert Image — Format: JPEG, Quality: 0.6 (compresses ~3MB PNG → ~300KB JPEG)
4. **Action 3:** Base64 Encode — Input: Converted Image
5. **Action 4:** Get Current Location
6. **Action 5:** Get Contents of URL
   - URL: `https://vectopilot.com/api/hooks/analyze-offer`
   - Method: POST
   - Body: `{ "image": "[Base64 Encoded]", "device_id": "[Device Name]", "latitude": "[Latitude]", "longitude": "[Longitude]", "source": "siri_vision" }`
7. **Action 6:** Get Dictionary Value — key: `voice`
8. **Action 7:** Speak Text — [voice value]

**Important:** JPEG compression in step 2 is critical — iPhone PNGs are 1-3MB, and base64 adds ~33% overhead. Without compression, payloads could exceed the 5MB body limit.

## Data Flow

```
┌─────────────────────────────────────────────────────┐
│ Shortcut A: "Vecto Analyze" (TEXT)                   │
│   Screenshot → Siri OCR → text + GPS → POST          │
│   Server: regex pre-parse → AI decides → voice        │
├─────────────────────────────────────────────────────┤
│ Shortcut B: "Vecto Vision" (IMAGE)                   │
│   Screenshot → JPEG compress → base64 + GPS → POST   │
│   Server: AI vision extracts + decides → voice        │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
         POST /api/hooks/analyze-offer
                       │
          ┌────────────┼────────────┐
          │ text?      │            │ image?
          ▼            │            ▼
    Pre-parse (regex)  │     Vision block added
    <1ms, deterministic│     to system prompt
          │            │            │
          └────────────┼────────────┘
                       │
                       ▼
            AI (Gemini 3 Flash, ~1-3s)
            Decision rules applied
                       │
                       ▼
            RESPOND IMMEDIATELY
            voice + $/mile spoken
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
    Save intercepted_signals   pg NOTIFY → SSE
    (merged parsed data)       (web app update)
                       │
                       ▼
         Siri speaks: "Accept. Dollar fifty-seven per mile."
```

## A/B Performance Comparison

The `source` field distinguishes text (`siri_shortcut`) vs vision (`siri_vision`):

```sql
SELECT source, COUNT(*) as total,
       AVG(response_time_ms) as avg_server_ms,
       AVG(confidence_score) as avg_confidence
FROM intercepted_signals
WHERE source IN ('siri_shortcut', 'siri_vision')
GROUP BY source;
```

## Algorithm Learning

Every analyzed offer is stored with:
- **Location** (lat/lng at 6-decimal precision) — where offers appear
- **Market** (1-decimal bucket from coords) — geographic clustering
- **Platform** (uber/lyft) — per-platform pricing patterns
- **Pre-parsed data** — server-side regex extraction merged with AI parsing
- **Source** — `siri_shortcut` (text) or `siri_vision` (image) for A/B comparison
- **Response time** — how fast the system analyzed
- **Driver override** — when the AI was wrong (training signal)

**AI Coach integration:** The coach reads offer history via `CoachDAL.getOfferHistory()` and includes stats + recent offers in its context for pattern-aware coaching.

This builds a dataset of real offers for:
- Surge pattern detection per location
- Pricing trends by time of day and market
- Dead zone identification (locations with only low-value offers)
- Model fine-tuning (override data = labeled training set)
- Coach-driven insights ("You reject 87% of offers from this area — reposition")
- A/B comparison of text vs vision accuracy and speed

## Related Files

| File | Relationship |
|------|--------------|
| `server/lib/offers/parse-offer-text.js` | OCR text pre-parser (text mode only) |
| `server/lib/ai/adapters/gemini-adapter.js` | Gemini Flash adapter with vision support |
| `server/lib/ai/adapters/index.js` | Model dispatcher (forwards images param) |
| `server/lib/ai/model-registry.js` | OFFER_ANALYZER role config |
| `server/lib/ai/coach-dal.js` | Coach reads offer history |
| `server/api/coach/schema.js` | Coach schema awareness |
| `server/bootstrap/middleware.js` | 5MB body limit for /api/hooks |
| `shared/schema.js` | intercepted_signals table definition |
