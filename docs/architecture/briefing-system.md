# Briefing System Architecture

**Status:** Active / Phase 3 Intelligence
**Last Updated:** 2026-02-10

## 1. Overview

The Vecto Co-Pilot Briefing System is the intelligence engine that generates the "Briefing Tab" content for rideshare drivers. It consolidates real-time data from multiple sources (traffic, events, news, weather) into a strategic, actionable summary.

The system uses a **"Hybrid Intelligence"** approach:
- **Hard Data (APIs):** Precise telemetry from TomTom (Traffic) and Google Maps (Weather).
- **Soft Intelligence (AI):** Strategic analysis, event discovery, and news filtering from Gemini Pro.

## 2. Core Architecture: "The Briefer Model"

The system moved from a fragile multi-model chain (SerpAPI -> GPT -> Claude) to a robust **Single Briefer Model** architecture.

### Key Principles
1.  **Phase 3 Intelligence Hardening:**
    - AI is not just a summarizer; it analyzes **RAW telemetry**.
    - Traffic analysis receives raw flow/incident data to find patterns invisible to standard aggregation.
2.  **Ground Truth First:**
    - Events are discovered, normalized, and stored in `discovered_events` (PostgreSQL) before serving.
    - This allows "Time-Travel" debugging and caching.
3.  **No Hallucinations:**
    - Strict schemas (Zod) enforce data structure.
    - "Hard Filters" remove events with TBD/Unknown times instead of trying to "repair" them.

## 3. Data Sources & Integration

| Domain | Primary Source | AI Role (Gemini 3 Pro) | Refresh Strategy |
| :--- | :--- | :--- | :--- |
| **Traffic** | **TomTom API** (Raw Flow + Incidents) | **Strategic Analysis:** Correlates incidents with driver location to recommend actions. | Real-time (On Request) |
| **Events** | **Gemini + Google Search** | **Discovery & Normalization:** Finds events, extracts times, deduplicates. | Daily (Background Job) |
| **News** | **Gemini + Google Search** | **Filtering:** selects only driver-relevant news (surges, regulations, safety). | Daily (Background Job) |
| **Weather** | **Google Maps API** | **Forecast:** Generates 4-6 hour outlook and driving conditions text. | Real-time (On Request) |
| **Schools** | **Gemini + Google Search** | **Discovery:** Finds closures/holidays within 15mi radius. | Daily |

## 4. Data Consolidation Schema

The `briefing` object stored in the `briefings` table (JSONB) follows this structure:

```json
{
  "traffic_conditions": {
    "briefing": "Strategic summary...",
    "congestionLevel": "low|medium|high",
    "incidents": [ ... ], // Top 10 impactful incidents
    "stats": { "total": 45, "jams": 12, ... },
    "provider": "tomtom"
  },
  "events": {
    "items": [
      {
        "title": "Event Name",
        "venue": "Venue Name",
        "start_time": "19:00",
        "impact": "high"
      }
    ]
  },
  "news": {
    "items": [
      {
        "title": "Headline",
        "summary": "Driver impact...",
        "published_date": "2026-02-10"
      }
    ]
  },
  "weather_current": { ... },
  "weather_forecast": [ ... ]
}
```

## 5. API Endpoints

All endpoints are prefixed with `/api/briefing` and require authentication (`requireAuth`).

### Primary Flows
- **`GET /current`**: Returns the latest generated briefing for the user's last snapshot. Fast (reads DB).
- **`POST /refresh`**: Forces a regeneration of real-time components (Traffic, Weather).
- **`POST /refresh-daily/:snapshotId`**: Forces a regeneration of daily components (Events, News).

### Component-Specific
- **`GET /traffic/realtime?lat=...&lng=...`**: Fetches raw traffic analysis for a specific point.
- **`GET /weather/realtime?lat=...&lng=...`**: Fetches current weather conditions.
- **`GET /events/:snapshotId`**: Fetches events from `discovered_events` table (with filters).

## 6. Caching & Freshness

### Database Caching
- **`briefings` Table:** Stores the consolidated JSON object. Acts as the "Hot Cache".
- **`discovered_events` Table:** Stores unique events. Allows de-duplication across users/snapshots.

### Refresh Intervals
- **Traffic/Weather:** 5-15 minutes (Real-time).
- **Events/News/Schools:** 24 hours (Daily).

### "Active" Filtering
- Events are filtered by `event_start_date` and `event_start_time`.
- Stale events (past end time) are automatically filtered out by the API, even if they exist in the DB.

## 7. Error Handling & Validation

- **Timeouts:** All AI calls are wrapped in timeouts (90s for events) to prevent zombie processes.
- **Fallbacks:**
    - If TomTom fails -> Fallback to Gemini Knowledge.
    - If Gemini fails -> Fallback to Claude (limited).
    - If Location missing -> Hard Fail (No hallucinated defaults).
- **Validation:**
    - Events *must* have valid start/end times.
    - "Hard Filter" removes invalid events before they reach the UI.

## 8. "Phase 3" Traffic Logic

(Implemented 2026-02-10)

The traffic fetching logic uses a parallel approach:
1.  **Raw Fetch:** `fetchRawTraffic(lat, lng, 10mi)` gets raw API telemetry.
2.  **Processed Fetch:** `getTomTomTraffic(...)` gets standard stats/incidents for UI.
3.  **AI Analysis:** Both sets of data are sent to `analyzeTrafficWithAI`. The AI sees the raw flow data to identify patterns (e.g., "congestion building on I-35 southbound") that simple incident counts miss.
