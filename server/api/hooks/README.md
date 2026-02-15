# External Hooks — `/api/hooks/`

**Last Updated:** 2026-02-15

Public endpoints for external automation tools (Siri Shortcuts, Android Automations) that operate **without JWT authentication**. Uses `device_id` for identification instead.

## Files

| File | Purpose |
|------|---------|
| `analyze-offer.js` | Ride offer analysis, history, and override endpoints |

## Endpoints

### `POST /api/hooks/analyze-offer`

Real-time ride offer analysis from Siri Shortcuts. Accepts OCR text from a screenshot of an Uber/Lyft offer, analyzes with AI, returns ACCEPT/REJECT.

**Auth:** None (public — Siri Shortcuts cannot send JWT tokens)
**AI Model:** `OFFER_ANALYZER` role (Gemini 3 Flash — optimized for speed)
**Database:** Writes to `intercepted_signals` table
**SSE:** Broadcasts `offer_analyzed` event via pg NOTIFY

**Request:**
```json
{
  "text": "OCR text from ride offer screenshot",
  "device_id": "Melody's iPhone",
  "latitude": 32.780,
  "longitude": -96.800,
  "source": "siri_shortcut"
}
```

**Response:**
```json
{
  "success": true,
  "notification": "ACCEPT: $15 / 4.2mi $3.57/mi — Good rate, short pickup",
  "decision": "ACCEPT",
  "analysis": {
    "parsed_data": { "price": 15, "miles": 4.2, "per_mile": 3.57, ... },
    "decision": "ACCEPT",
    "reasoning": "Good rate, short pickup",
    "confidence": 85
  },
  "response_time_ms": 1823,
  "id": "uuid"
}
```

The `notification` field is pre-formatted for Siri's "Show Notification" action.

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

## Siri Shortcut Setup

The complete Siri Shortcut workflow:

1. **Trigger:** User says "Vecto Analyze"
2. **Action 1:** Take Screenshot
3. **Action 2:** Extract Text from Image (built-in iOS OCR)
4. **Action 3:** Get Current Location
5. **Action 4:** Get Contents of URL
   - URL: `https://your-domain.replit.app/api/hooks/analyze-offer`
   - Method: POST
   - Headers: `Content-Type: application/json`
   - Body:
     ```json
     {
       "text": "[Extracted Text]",
       "device_id": "[Device Name]",
       "latitude": "[Latitude]",
       "longitude": "[Longitude]",
       "source": "siri_shortcut"
     }
     ```
6. **Action 5:** Get Dictionary Value (key: `notification`)
7. **Action 6:** Show Notification with the result

## Data Flow

```
Siri "Vecto Analyze"
    │
    ├─► OCR extracts offer text
    ├─► iOS provides GPS (3-decimal precision)
    │
    ▼
POST /api/hooks/analyze-offer
    │
    ├─► AI (Gemini 3 Flash, ~1-3s)
    │     └─► Parse: price, miles, pickup, dropoff, platform
    │     └─► Decision: ACCEPT or REJECT with reasoning
    │
    ├─► Save to intercepted_signals (with location + market)
    ├─► pg NOTIFY offer_analyzed → SSE to web app
    │
    ▼
HTTP Response → Siri "Show Notification"
    │
    ▼
Driver sees: "ACCEPT: $15 / 4.2mi $3.57/mi — Good rate"
```

## Algorithm Learning

Every analyzed offer is stored with:
- **Location** (lat/lng at 3-decimal precision) — where offers appear
- **Market** (derived from coords) — geographic clustering
- **Platform** (uber/lyft) — per-platform pricing patterns
- **Response time** — how fast the system analyzed
- **Driver override** — when the AI was wrong (training signal)

This builds a dataset of real offers for:
- Surge pattern detection per location
- Pricing trends by time of day and market
- Dead zone identification (locations with only low-value offers)
- Model fine-tuning (override data = labeled training set)
