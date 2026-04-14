# Briefing Transformation Path

> How briefing data flows from the database to the strategist prompt.
> Single source of truth for the DB column → strategist field mapping.
>
> Last verified: 2026-04-14 (read from actual code, not inferred)

## Overview

Briefing data is stored as JSONB columns in the `briefings` table. The **consolidator** (`server/lib/ai/providers/consolidator.js`) reads these columns, renames/transforms them into a simpler `briefing` object, then passes that object to `generateImmediateStrategy()` or `generateDailyStrategy()`. The strategist prompt functions further transform specific fields into structured text blocks.

## 1. Persisted DB Column Shape (`briefings` table)

Defined in `shared/schema.js` lines 108-128.

| Column | Type | Populated By | Shape |
|--------|------|-------------|-------|
| `news` | JSONB | `BRIEFING_NEWS` role via `fetchRideshareNews()` | Array of `{ title, summary, source, url, relevance }` |
| `weather_current` | JSONB | Google Weather API via `fetchWeatherConditions()` | `{ temperature, condition, humidity, wind, ... }` |
| `weather_forecast` | JSONB | Google Weather API via `fetchWeatherConditions()` | Array of hourly `{ hour, temperature, condition, precipitation_chance }` |
| `traffic_conditions` | JSONB | `BRIEFING_TRAFFIC` role via `fetchTrafficConditions()` | `{ incidents: [...], closures: [...], congestion_level, demand_zones: [...], driver_impact }` or legacy compressed text |
| `events` | JSONB | `BRIEFING_EVENTS_DISCOVERY` via briefing pipeline | Array of `{ title, venue_name, event_start_date, event_start_time, event_end_time, category, expected_attendance, venue_lat, venue_lng }` |
| `school_closures` | JSONB | `BRIEFING_SCHOOLS` role via `fetchSchoolClosures()` | Array of `{ district, status, reason }` |
| `airport_conditions` | JSONB | `BRIEFING_AIRPORT` role via `fetchAirportConditions()` | `{ delays, arrivals, busy_periods, recommendations }` |

## 2. Transformation Site

**File:** `server/lib/ai/providers/consolidator.js`

### Daily Strategy Path (lines 1378-1396)

```
Function: consolidateForDailyStrategy()
```

| Step | Line | Operation |
|------|------|-----------|
| Parse traffic | 1379 | `trafficData = parseJsonField(briefingRow.traffic_conditions)` |
| Parse events | 1380 | `rawEventsData = parseJsonField(briefingRow.events)` |
| Parse news | 1381 | `rawNewsData = parseJsonField(briefingRow.news)` |
| Parse weather | 1382 | `weatherData = parseJsonField(briefingRow.weather_current)` |
| Parse forecast | 1386 | `weatherForecastData = parseJsonField(briefingRow.weather_forecast)` |
| Parse closures | 1387 | `closuresData = parseJsonField(briefingRow.school_closures)` |
| Parse airport | 1388 | `airportData = parseJsonField(briefingRow.airport_conditions)` |
| Validate events | 1392 | `eventsData = filterEventsReadTime(rawEventsData)` |
| Filter deactivated news | 1395 | `newsData = await filterDeactivatedNews(rawNewsData, userId)` |

### Immediate Strategy Path (lines 1641-1661)

```
Function: runImmediateStrategy()
```

| Step | Line | Operation |
|------|------|-----------|
| Parse news + filter | 1642-1643 | `rawNews → filterDeactivatedNews()` |
| Parse events + validate | 1646-1647 | `parseJsonField(briefingRow.events) → filterEventsReadTime()` |
| Build briefing object | 1654-1661 | See mapping table below |

## 3. Mapping Table: DB Column → Strategist Field

### Immediate Strategy (`runImmediateStrategy`, line 1654)

| DB Column (`briefingRow.*`) | Strategist Field (`briefing.*`) | Transform |
|----------------------------|-------------------------------|-----------|
| `traffic_conditions` | `traffic` | `parseJsonField()` |
| `events` | `events` | `parseJsonField()` → `filterEventsReadTime()` |
| `weather_current` | `weather` | `parseJsonField()` |
| `news` | `news` | `parseJsonField()` → `filterDeactivatedNews()` |
| `school_closures` | `school_closures` | `parseJsonField()` |
| `airport_conditions` | `airport` | `parseJsonField()` |
| `weather_forecast` | `weather_forecast` | `parseJsonField()` *(added 2026-04-14, Issue F)* |

### Daily Strategy (`consolidateForDailyStrategy`, lines 1378-1396)

| DB Column (`briefingRow.*`) | Local Variable | Transform |
|----------------------------|---------------|-----------|
| `traffic_conditions` | `trafficData` | `parseJsonField()` |
| `events` | `eventsData` | `parseJsonField()` → `filterEventsReadTime()` |
| `news` | `newsData` | `parseJsonField()` → `filterDeactivatedNews()` |
| `weather_current` | `weatherData` | `parseJsonField()` |
| `weather_forecast` | `weatherForecastData` | `parseJsonField()` |
| `school_closures` | `closuresData` | `parseJsonField()` |
| `airport_conditions` | `airportData` | `parseJsonField()` |

The daily path does NOT create a `briefing` object — it passes individual variables directly to prompt-building helpers (`formatEventsForStrategist`, `formatTrafficIntelForStrategist`, `formatWeatherForStrategist`, etc.) and inlines results into the prompt template at line 1443.

## 4. Prompt-Level Enrichment Helpers

After the DB→strategist mapping, these functions further transform specific fields into structured text blocks for the prompt:

| Helper Function | Input | Output | Defined At |
|----------------|-------|--------|------------|
| `formatEventsForStrategist(events, snapshot, limit)` | events array + snapshot coords | NEAR/FAR bucketed text block with haversine distances | consolidator.js (top of file) |
| `formatTrafficIntelForStrategist(traffic)` | traffic JSONB | Structured incidents/closures/zones text | consolidator.js (top of file) |
| `formatWeatherForStrategist(weather, forecast, tz)` | current weather + forecast array | Weather summary + hourly timeline | consolidator.js (top of file) |
| `formatNewsForPrompt(news)` | news array | Formatted news bullets | consolidator.js (top of file) |
| `optimizeNewsForLLM(news)` | news array | Stripped redundant fields | consolidator.js (top of file) |
| `optimizeAirportForLLM(airport)` | airport JSONB | Compressed airport data | consolidator.js (top of file) |
| `buildDriverPreferencesSection(prefs)` | driver_profiles row | Preferences text block | consolidator.js (top of file) |
| `buildEarningsContextSection(prefs)` | driver_profiles row | Earnings math text block | consolidator.js (top of file) |
| `buildHomeBaseLine(snapshot, prefs)` | snapshot + prefs | Home base context line | consolidator.js (top of file) |

## 5. Event Source Contract

> **This is intentional tiering, not accidental divergence.**

The system has two distinct event input paths that feed different AI roles. Each path has a different source of truth for events:

### Strategist Roles (STRATEGY_TACTICAL, STRATEGY_DAILY)

- **Event source:** Frozen `briefings.events` JSONB snapshot only
- **Where:** `consolidator.js` lines 1651 (immediate) and 1384 (daily): `parseJsonField(briefingRow.events)`
- **No live augmentation.** The strategist sees exactly what the briefing pipeline stored at snapshot time.
- **Rationale:** Strategy output must be deterministic relative to the snapshot. If events changed between briefing generation and strategy generation, the strategist would contradict the briefing the user already sees.

### Venue Planner Roles (VENUE_SCORER via tactical-planner.js)

- **Event source:** Briefing snapshot (for traffic/weather/closures) **PLUS** live `discovered_events` table (for events)
- **Where:** `enhanced-smart-blocks.js` line 356: `fetchTodayDiscoveredEventsWithVenue()` queries live `discovered_events` joined with `venue_catalog`, then line 367 passes these as `todayEvents` to `filterBriefingForPlanner()`
- **Live augmentation:** `filter-for-planner.js` line 197 accepts optional `todayEvents` parameter. When provided, it replaces `briefing.events` entirely. The legacy briefing.events fallback is kept for unmigrated callers (none remain in production).
- **Rationale:** Venue scoring happens AFTER strategy generation. By this point, events may have been updated (new discoveries, deactivations). The venue planner needs the freshest event data for accurate proximity scoring, NEAR/FAR bucketing, and event-venue matching via `matchVenuesToEvents()`.

### Data Flow Diagram

```
briefings.events (JSONB)          discovered_events (live table)
       │                                    │
       ▼                                    ▼
  parseJsonField()              fetchTodayDiscoveredEventsWithVenue()
       │                          (state-scoped, venue_catalog JOIN,
       │                           distance-annotated, sorted)
       │                                    │
       ▼                                    ▼
  consolidator.js                 filter-for-planner.js
  ┌─────────────────┐            ┌─────────────────────────┐
  │ STRATEGY_TACTICAL│            │ todayEvents → events    │
  │ STRATEGY_DAILY   │            │ briefing → traffic,     │
  │                  │            │   weather, closures,    │
  │ (frozen snapshot │            │   airport               │
  │  events only)    │            └──────────┬──────────────┘
  └──────────────────┘                       │
                                             ▼
                                     VENUE_SCORER
                                  (NEAR/FAR bucketed,
                                   event-venue matched)
```

## 6. API Response Contracts (Client-Facing)

Two endpoints return briefing data to the client with **different shapes**. This is undocumented historical divergence, not an intentional design.

### GET /api/strategy/:snapshotId (summary endpoint)

**File:** `server/api/strategy/strategy.js` line 59

Returns strategy + trimmed briefing. Used by the main client polling loop.

```json
{
  "status": "ok",
  "strategy_for_now": "...",
  "consolidated": "...",
  "briefing": {
    "events": [],
    "news": { "items": [] },
    "traffic": {},
    "school_closures": []
  }
}
```

**Included:** `events`, `news`, `traffic` (renamed from `traffic_conditions`), `school_closures`
**Missing:** `weather_current`, `weather_forecast`, `airport_conditions`

### GET /api/strategy/briefing/:snapshotId (full briefing endpoint)

**File:** `server/api/strategy/strategy.js` line 136

Returns fuller briefing data. Used by the Briefing tab UI.

```json
{
  "ok": true,
  "briefing": {
    "news": { "items": [] },
    "weather_current": null,
    "weather_forecast": [],
    "traffic_conditions": null,
    "events": [],
    "school_closures": []
  }
}
```

**Included:** `news`, `weather_current`, `weather_forecast`, `traffic_conditions`, `events`, `school_closures`
**Missing:** `airport_conditions`

### Key Differences

| Field | `/api/strategy/:id` | `/api/strategy/briefing/:id` |
|-------|---------------------|------------------------------|
| `events` | `briefing.events` | `briefing.events` |
| `news` | `briefing.news` | `briefing.news` |
| Traffic | `briefing.traffic` (renamed) | `briefing.traffic_conditions` (DB name) |
| `school_closures` | `briefing.school_closures` | `briefing.school_closures` |
| `weather_current` | not returned | `briefing.weather_current` |
| `weather_forecast` | not returned | `briefing.weather_forecast` |
| `airport_conditions` | not returned | not returned |

**Note:** `airport_conditions` is not returned by either endpoint despite being populated in the briefings table and consumed by the strategist. The comment at `strategy.js:221` acknowledges the column was moved to the briefings table but it was never added to either response shape. This is historical — may warrant normalization.

---

## 7. schema_version Optimization Scope

**Added 2026-04-14 (Issue B).** The `discovered_events.schema_version` column enables `filterEventsReadTime()` in `consolidator.js` to skip redundant revalidation for current-version rows.

**Scope: direct `discovered_events` table reads only.**

| Path | Has schema_version? | Revalidation behavior |
|------|--------------------|-----------------------|
| **Venue planner** (`enhanced-smart-blocks.js` → `fetchTodayDiscoveredEventsWithVenue()`) | Yes — each row has `schema_version` | Can skip revalidation when `schemaVersion >= VALIDATION_SCHEMA_VERSION` (caller must pass it) |
| **Strategist** (`consolidator.js` → `parseJsonField(briefingRow.events)`) | No — `briefings.events` JSONB does not carry version | Always revalidates (safe default — `schemaVersion = null`) |

**Why this is acceptable:** Events in `briefings.events` were already validated at write time by `briefing-service.js:1548` (the `filterInvalidEvents()` call before storage). Revalidation is redundant but cheap — the validation logic is pure array filtering, not an AI call.

**Future option:** If revalidation becomes a performance concern (unlikely — it's sub-millisecond), propagate `schema_version` into the briefing events JSONB at write time so the consolidator can also skip it.

---

## 8. Resolved Issues

- **2026-04-14 (Issue F):** `weather_forecast` was missing from the immediate path's briefing object. Fixed — both paths now include all 7 fields. Audit confirmed no other enrichment fields are missing from either path.
