# Events Discovery Pipeline — Authoritative Reference

> **This is the single source of truth** for event discovery, venue matching, deduplication, freshness, and driver-relevant event logic. Supersedes: `EVENT_FRESHNESS_AND_TTL.md`, `VENUELOGIC.md` (event sections), `BRIEFING_AND_EVENTS_ISSUES.md`.

**Last Updated:** 2026-04-10
**Schema Version:** `VALIDATION_SCHEMA_VERSION = 4` (validateEvent.js)

---

## 1. Event Discovery Pipeline (End-to-End Flow)

```
Driver Snapshot (city, state, lat, lng, timezone, market)
          |
          v
 +--------------------+
 | Gemini 3 Pro       |  <-- 2 parallel category searches (high_impact + local_entertainment)
 | google_search      |      90s timeout each, via callModel('BRIEFING_EVENTS_DISCOVERY')
 | grounding          |      Returns: title, venue_name, place_id, category, dates/times, address (best guess)
 |                    |      Does NOT return city/state — venue truth comes from Google Places API
 +--------------------+
          |
          v
 +--------------------+
 | 1. NORMALIZE       |  normalizeEvent.js: RawEvent -> NormalizedEvent
 |    (ETL Phase 1)   |  - Canonical field names (event_start_date, event_start_time, etc.)
 |                    |  - city/state default to snapshot context (not from Gemini)
 |                    |  - place_id validated (must start with "ChIJ" or null)
 |                    |  - Category mapped to allowed list, attendance to high/medium/low
 |                    |  - All-day events get 08:00-22:00 window
 |                    |  - Missing end times estimated by category duration
 +--------------------+
          |
          v
 +--------------------+
 | 2. VALIDATE        |  validateEvent.js: 13 hard filter rules
 |    (ETL Phase 2)   |  - Title, venue, address must exist and not be TBD/Unknown
 |                    |  - All 4 date/time fields required
 |                    |  - Category must be from ALLOWED_CATEGORIES
 |                    |  - Date must be today or yesterday (no future events)
 +--------------------+
          |
          v
 +--------------------+
 | 3. HASH            |  hashEvent.js: MD5(title|venue_name|city|date)
 |    (ETL Phase 3)   |  - Title stripped of "at Venue" suffixes
 |                    |  - city included to prevent cross-city collisions
 |                    |  - time excluded so corrections UPDATE, not duplicate
 +--------------------+
          |
          v
 +========================+
 | 4. VENUE RESOLUTION    |  THE CRITICAL STEP — Google Places API (New) is source of truth
 |    (ETL Phase 4)       |
 |                        |  (a) place_id cache hit → venue_catalog lookup (if complete data, use it)
 |                        |  (b) Places API search → searchPlaceWithTextSearch(snapshot lat/lng,
 |                        |      venue_name, {radius: 50km}) → authoritative place_id, address,
 |                        |      lat/lng, city parsed from addressComponents
 |                        |  (c) Geocode fallback → geocodeEventAddress(venue_name, snapshot city/state)
 |                        |  (d) findOrCreateVenue with Places API data (city FROM Places, not Gemini)
 |                        |
 | venue-address-resolver.js → searchPlaceWithTextSearch (Google Places API New)
 | venue-cache.js → findOrCreateVenue (place_id → coord_key → fuzzy → CREATE)
 +========================+
          |
          v
 +--------------------+
 | 5. STORE           |  discovered_events table (ON CONFLICT event_hash DO UPDATE)
 |    (ETL Phase 5)   |  - All content fields updated on conflict (title, times, venue, address)
 |                    |  - city/address from venue_catalog (Google Places), not Gemini
 |                    |  - venue_id FK to venue_catalog for coordinates
 +--------------------+
          |
          v
 +--------------------+
 | 6. FRESHNESS       |  strategy-utils.js: filterFreshEvents()
 |    FILTER          |  - Applied server-side (briefing-service.js) and client-side (BriefingPage.tsx)
 |                    |  - Timezone-aware using snapshot.timezone
 |                    |  - 1-hour post-event surge window for driver relevance
 +--------------------+
```

### Trigger

Events are discovered **per-snapshot** as Phase 1 of the `blocks-fast` waterfall in `briefing-service.js`. There is **NO background event sync job** (Rule 11 in CLAUDE.md).

### Key Files

| File | Purpose |
|------|---------|
| `server/lib/events/pipeline/normalizeEvent.js` | RawEvent -> NormalizedEvent |
| `server/lib/events/pipeline/validateEvent.js` | 13 hard filter rules |
| `server/lib/events/pipeline/hashEvent.js` | MD5 hash for deduplication |
| `server/lib/events/pipeline/geocodeEvent.js` | Google Geocoding API (fallback only) |
| `server/lib/events/pipeline/types.js` | JSDoc type definitions |
| `server/lib/venue/venue-address-resolver.js` | **Google Places API (New)** — authoritative venue resolution |
| `server/lib/venue/venue-cache.js` | findOrCreateVenue(), venue linking |
| `server/lib/briefing/briefing-service.js` | Orchestrator: Gemini prompt, pipeline, DB storage |
| `server/api/briefing/briefing.js` | API routes, zombie recovery |
| `server/lib/strategy/strategy-utils.js` | filterFreshEvents(), isEventFresh() |
| `client/src/pages/co-pilot/BriefingPage.tsx` | Client-side freshness fallback |

---

## 2. Venue Verification & Matching Rules

**This is the critical fix area.** Events MUST be matched to their correct venues with correct addresses and cities.

### Core Principle

**Google Places API (New) is the ONLY source of truth for venue data.** Do NOT trust Gemini for venue addresses, cities, or coordinates — LLMs hallucinate. The snapshot provides metro-area context; Places API resolves authoritative venue information.

### The Problem (Fixed 2026-04-10)

Events were being linked to WRONG venues because:
1. **Geocoding with snapshot city was imprecise** — "Dickies Arena, Dallas, TX" returns wrong location
2. **No Google Places verification step** — venues stored without authoritative address data
3. **venue_catalog had stale/wrong lat/lng** — causing navigation to wrong places (e.g., "Globe Life Field" → "Hair salon in Frisco")

### The Fix: Google Places API Venue Resolution

```
Event from Gemini: { venue: "Dickies Arena", place_id: "ChIJ..." (maybe) }
                                    |
                  +-----------------+------------------+
                  |                                    |
          (a) place_id lookup                  (b) Google Places API (New)
          in venue_catalog                     searchPlaceWithTextSearch(
                  |                                snapshot.lat, snapshot.lng,
          Found with complete                      "Dickies Arena",
          address + coords?                        {radius: 50000})
          |           |                                    |
        YES: USE    NO: Fall through              Returns authoritative:
                                                  placeId, formattedAddress,
                                                  lat, lng, parsed.city
                                                           |
                                                  findOrCreateVenue with
                                                  Places API data
                                                           |
                                               (c) Places API fails? →
                                                  geocodeEventAddress fallback
```

### Venue Resolution Priority (in briefing-service.js)

1. **Place ID cache hit**: If Gemini's `ChIJ...` ID exists in venue_catalog WITH `formatted_address` + `lat` + `lng` → use directly.
2. **Google Places API (New)**: `searchPlaceWithTextSearch()` with snapshot lat/lng (50km radius) + venue name → authoritative place_id, address, coordinates, and **city parsed from addressComponents**.
3. **Geocode fallback**: `geocodeEventAddress()` with snapshot city/state if Places API returns nothing.
4. **Create new venue**: `findOrCreateVenue()` with Places API data. City comes from `placeResult.parsed.city`.

### Hard Rules

- **Google Places API is the venue authority** — city, address, coordinates all come from Places API
- **Gemini provides venue NAME only** — do NOT trust Gemini for city, address, or place_id accuracy
- **ALWAYS store venue_catalog city** in `discovered_events.city` (from Places API, not snapshot)
- **ALWAYS store venue_catalog formatted_address** in `discovered_events.address`
- **New venues get** `is_event_venue=true`, `record_status='enriched'`, `venue_types=['event_host']`
- **This is a GLOBAL pattern** — Google Places API handles Tokyo, London, Dallas identically

---

## 3. Deduplication Strategy

### Hash-Based Deduplication (Storage Level)

**Hash input:** `normalize(title) | normalize(venue_name) | normalize(city) | event_start_date`

| Component | Why |
|-----------|-----|
| `title` | Core event identity. Stripped of "at Venue" suffixes. |
| `venue_name` | Stable across discovery runs (unlike address which varies). |
| `city` | Prevents collisions: "Fair Park, Dallas" != "Fair Park, Houston". City from venue_catalog (Places API) or snapshot context. |
| `event_start_date` | Same event on different dates = different events. |
| ~~time~~ | **Excluded.** Time corrections should UPDATE, not create duplicates. |

**On conflict:** `ON CONFLICT event_hash DO UPDATE` — all content fields (title, times, venue, address, category, venue_id) are updated with fresher data.

### Semantic Deduplication (Read Level)

Applied in `deduplicateEvents()` in briefing-service.js after DB read:
- Normalizes event names (strips "Live Music:", "The ", parenthetical suffixes)
- Groups by normalized(name + address + time)
- "Bruno Mars Romantic Tour" and "Bruno Mars - The Romantic Tour" → same event

### Title Normalization for Hash

```javascript
stripVenueSuffix("Cirque du Soleil at Cosm")  → "Cirque du Soleil"
stripVenueSuffix("DJ Night @ The Club")       → "DJ Night"
stripVenueSuffix("Festival - City Park")      → "Festival"
normalizeForHash("Bruno Mars!!!")             → "bruno mars"
```

---

## 4. Event Freshness & TTL

### Freshness Rules (Driver-Relevant Timeframes)

| Scenario | Behavior |
|----------|----------|
| Event in progress | Show (event is between start and end time) |
| Event ended < 1 hour ago | Show (post-event pickup surge still relevant for drivers) |
| Event ended > 1 hour ago | Remove (surge has dissipated) |
| Event has no end time | Infer: start + 3 hours + 1 hour surge window |
| Event has no date info at all | Remove (no way to determine relevance) |
| Multi-day event | Keep showing until LAST day's end time + 1 hour |

### Timezone Handling

**ALL freshness checks are timezone-aware:**

```javascript
// CORRECT: Pass snapshot timezone for proper local time comparison
filterFreshEvents(events, new Date(), snapshot.timezone);

// WRONG: Comparing UTC server time against "7:00 PM" local time
filterFreshEvents(events, new Date()); // DO NOT DO THIS
```

The `createDateInTimezone()` utility converts local event times + IANA timezone to UTC `Date` objects for comparison.

### Defense-in-Depth (3 Filter Layers)

1. **Server-side** (briefing-service.js): `filterFreshEvents()` with `snapshot.timezone`
2. **API-side** (briefing.js): `filterFreshEvents()` before response
3. **Client-side** (BriefingPage.tsx): `useMemo()` with local `filterFreshEvents()` fallback

### Soft Deactivation

Past events are soft-deactivated (`is_active=false`, `deactivated_at=NOW()`) per-snapshot via `deactivatePastEvents()` before each discovery cycle. This is the canonical cleanup mechanism — there is NO hourly cleanup job.

---

## 5. Venue Catalog Integration

### When to Add New Venues

A new `venue_catalog` entry is created when:
- An event's venue doesn't match any existing venue by place_id, coord_key, or fuzzy name
- Geocoding succeeds (lat/lng required for new venue creation)

New event-discovered venues get:
- `is_event_venue = true`
- `record_status = 'enriched'` (geocoded address but not full bar details)
- `venue_types = ['event_host']`
- Non-blocking enrichment from Google Places API (phone, hours, rating)

### When to Flag Existing Venues

An existing venue's `is_event_venue` flag is set to `true` when it's linked to a discovered event for the first time. This enables filtering for "venues that host events" in the Market Map.

### Progressive Enrichment

Venue data quality follows the "Best Write Wins" pattern:
- Boolean flags (`is_bar`, `is_event_venue`): OR logic — once true, stays true
- `record_status`: MAX logic — `stub` < `enriched` < `verified`
- `place_id`: Backfilled on any match if existing venue doesn't have one

---

## 6. Nearby/Market Events Logic

### Metro-Wide Discovery

Events are discovered for the **entire metro market**, not just the driver's city:
- Market resolved from `snapshot.market` (set at signup) or `getMarketForLocation(city, state)`
- Gemini searches "Dallas-Fort Worth metro" not just "Dallas"
- DB read queries by **state** (not city) to include all metro events

### Event Categories

| Category | Search Focus | Max Events |
|----------|-------------|------------|
| `high_impact` | Stadiums, arenas, concert halls, convention centers | 8 |
| `local_entertainment` | Comedy, nightlife, bars, community events | 8 |

### Distance Relevance

Events carry `venue_lat`/`venue_lng` from the linked venue catalog entry. The strategy LLM can calculate distance from the driver's position to prioritize nearby events.

---

## 7. Rideshare Pro Tips Integration

Events are enriched with driver-relevant intelligence in the strategy/consolidation phase:

### What Drivers Need from Events

| Data Point | Source | Why Drivers Care |
|------------|--------|-----------------|
| Event end time | `event_end_time` | Predict pickup surge timing |
| Venue coordinates | `venue_catalog.lat/lng` | GPS to staging area |
| Expected attendance | `expected_attendance` | Gauge surge intensity |
| Category | `category` | Sports = different surge pattern than concert |
| Venue address | `venue_catalog.formatted_address` | Navigate to pickup zone |

### Strategy LLM Context

The consolidator (`consolidator.js`) enriches events with venue status:
- Venue open/closed status from `hours_full_week`
- Business hours in 12h format
- 6-decimal coordinates for precise navigation

### Event-Driven Strategy Tips

The strategy LLM generates tips like:
- "Mavericks game at AAC ends ~10:30 PM — position near Olive St exit by 10:15"
- "Breakaway Festival at Fair Park — staging on Fitzhugh Ave, expect 20-min surge"
- "Multiple nightlife events in Deep Ellum — stay in area until 2:30 AM"

---

## 8. LLM Request Requirements

### Snapshot-First Context Rule

**The user's snapshot MUST be the first context sent to any LLM involved in event processing.**

```javascript
// REQUIRED: Snapshot data for event discovery
const snapshot = {
  city: 'Dallas',           // Driver's current city
  state: 'TX',              // Driver's state
  lat: 32.7767,             // Driver's latitude
  lng: -96.7970,            // Driver's longitude
  timezone: 'America/Chicago', // IANA timezone (REQUIRED, no fallback)
  market: 'Dallas-Fort Worth',  // Metro market name
  local_iso: '2026-04-10T14:30:00-05:00', // Local ISO timestamp
  hour: 14                  // Local hour (0-23)
};
```

### Non-Negotiable Requirements

1. **Timezone is REQUIRED** — `fetchEventsWithGemini3ProPreview()` rejects if missing
2. **Date computed from snapshot timezone** — not server UTC
3. **Market determines search area** — broader than just the driver's city
4. **No cross-provider fallback** — Gemini-only to avoid format incompatibility

### Gemini Prompt Structure

```
System: Strict categorization rules + allowed category list
User:   "Find [category] happening TODAY ({date}) in the {market} metro area..."
        - Requires: title, venue, city, place_id, address, all 4 date/time fields
        - Stresses venue accuracy: correct city, correct address
        - Market-agnostic search terms (no hardcoded league names)
```

---

## 9. Global App Considerations

### Timezone Handling

| Operation | Timezone Source | Notes |
|-----------|---------------|-------|
| Event discovery date | `snapshot.timezone` via `toLocaleDateString('en-CA', { timeZone })` | Local date, not UTC |
| Freshness filtering | `snapshot.timezone` passed to `filterFreshEvents()` | All 3 filter layers |
| Date validation (today check) | `new Date().toISOString()` in validateEvent.js | Server UTC — may need timezone fix for global |
| Venue timezone | Resolved from market via `resolveTimezoneFromMarket()` | Stored on venue_catalog |

### Locale Considerations

- Event times stored as text strings ("7:00 PM") — locale-agnostic
- Addresses from Google Geocoding API respect the locale of the API key region
- Category names are English-only (concert, sports, etc.) — for internal use, not display

### International Venues

- `venue_catalog.country` defaults to 'US' (ISO-2 code)
- `coord_key` is locale-independent (pure lat/lng math)
- Market names support international metros (not hardcoded to US)
- Search terms in Gemini prompt are market-agnostic (no US-specific league names)

### Known Gaps

1. **validateEvent.js date check** uses server UTC for "today" — may reject valid events in far-east timezones
2. **Event times as text** — no ISO 8601 storage means parsing is always needed
3. **Country not in event discovery prompt** — assumes Gemini infers from metro area name
4. **No multi-language event title support** — normalization assumes Latin characters

---

## Canonical Field Names

| Field | Format | Required | Description |
|-------|--------|----------|-------------|
| `event_start_date` | `YYYY-MM-DD` | Yes | Event start date |
| `event_start_time` | `HH:MM` (24h) or `h:mm AM/PM` | Yes | Event start time |
| `event_end_date` | `YYYY-MM-DD` | No | Defaults to start_date for single-day |
| `event_end_time` | `HH:MM` (24h) or `h:mm AM/PM` | Yes | Required since schema v3 |
| `city` | Text | Yes | Venue's actual city (from Google Places API via venue_catalog) |
| `state` | 2-letter code | Yes | State code |
| `venue_name` | Text | Yes | Actual venue name |
| `address` | Text | Yes | Venue's street address |
| `place_id` | `ChIJ...` or null | No | Google Places ID |
| `category` | Enum | Yes | concert/sports/comedy/theater/festival/nightlife/convention/community/other |
| `expected_attendance` | Enum | No | high/medium/low (default: medium) |
| `event_hash` | MD5 hex (32 chars) | Yes | Deduplication hash |

---

## Validation Rules (13 Hard Filters)

| # | Rule | Field | Rejection Reason |
|---|------|-------|-----------------|
| 1 | Title must exist | `title` | `missing_title` |
| 2 | Title not TBD/Unknown | `title` | `tbd_in_title` |
| 3 | Must have venue or address | `venue_name/address` | `missing_location` |
| 4 | Venue not TBD/Unknown | `venue_name` | `tbd_in_venue` |
| 5 | Address not TBD/Unknown | `address` | `tbd_in_address` |
| 6 | Start time required | `event_start_time` | `missing_start_time` |
| 7 | Start time not TBD | `event_start_time` | `tbd_in_start_time` |
| 8 | End time required | `event_end_time` | `missing_end_time` |
| 9 | End time not TBD | `event_end_time` | `tbd_in_end_time` |
| 10 | Start date required | `event_start_date` | `missing_start_date` |
| 11 | Date format YYYY-MM-DD | `event_start_date` | `invalid_date_format` |
| 12 | Category from allowed list | `category` | `missing_or_invalid_category` |
| 13 | Date is today or yesterday | `event_start_date` | `not_today` |

---

## Database Schema

### discovered_events

```sql
id                  UUID PRIMARY KEY
title               TEXT NOT NULL
venue_name          TEXT
address             TEXT
city                TEXT NOT NULL        -- Venue's actual city (from Gemini, NOT snapshot)
state               TEXT NOT NULL
venue_id            UUID FK -> venue_catalog  -- Enables map pins, coordinates
event_start_date    TEXT NOT NULL        -- YYYY-MM-DD
event_start_time    TEXT                 -- "7:00 PM" or "19:00"
event_end_date      TEXT                 -- Defaults to event_start_date
event_end_time      TEXT NOT NULL        -- Required since schema v3
category            TEXT NOT NULL DEFAULT 'other'
expected_attendance TEXT DEFAULT 'medium'
event_hash          TEXT NOT NULL UNIQUE -- MD5 deduplication
is_active           BOOLEAN DEFAULT true
deactivated_at      TIMESTAMP
deactivation_reason TEXT
deactivated_by      TEXT               -- 'ai_coach' or user_id
discovered_at       TIMESTAMP
updated_at          TIMESTAMP
```

### venue_catalog (Event-Relevant Fields)

```sql
venue_id            UUID PRIMARY KEY
place_id            TEXT UNIQUE         -- Google Places ID (ChIJ...)
venue_name          VARCHAR(500) NOT NULL
normalized_name     TEXT                -- Lowercase alphanumeric for fuzzy matching
address             VARCHAR(500) NOT NULL
formatted_address   TEXT                -- Google-formatted full address
city                TEXT
state               TEXT
country             TEXT DEFAULT 'US'
lat                 DOUBLE PRECISION
lng                 DOUBLE PRECISION
coord_key           TEXT UNIQUE         -- "lat6d_lng6d" format
is_event_venue      BOOLEAN DEFAULT false  -- Set when linked to discovered event
record_status       TEXT DEFAULT 'stub'    -- stub | enriched | verified
timezone            TEXT                   -- IANA timezone
market_slug         TEXT                   -- Metro market identifier
```

---

## Dead Code / Deprecated

These files are referenced in older docs but are NOT active in the pipeline:

| File | Status | Notes |
|------|--------|-------|
| `server/jobs/event-cleanup.js` | Dead code | Never imported in gateway-server.js |
| `server/lib/subagents/event-verifier.js` | Dead code | Never called; replaced by rule-based validation |
| `EVENT_FRESHNESS_AND_TTL.md` sections 4-5 | Inaccurate | TTL automation, cleanup loop, `expires_at` column never implemented |

---

## Change Log

| Date | Change | Files |
|------|--------|-------|
| 2026-04-10 | **Venue resolution via Google Places API (New)**: After Gemini discovery, each event's venue is resolved through Places API `searchPlaceWithTextSearch` (50km radius from snapshot). City, address, coordinates all come from Places API, not Gemini. DB queries by state (metro-wide). Briefing.js also updated to metro-wide queries. | briefing-service.js, venue-address-resolver.js, briefing.js |
| 2026-04-10 | **Freshness: 1hr post-surge window** for driver relevance; default duration 3h (was 4h) | strategy-utils.js |
| 2026-04-10 | **Hash v2**: title\|venue_name\|city\|date (removed time, added city) | hashEvent.js |
| 2026-04-05 | ALLOWED_CATEGORIES aligned in Gemini prompt and validateEvent.js | briefing-service.js, validateEvent.js |
| 2026-04-04 | ON CONFLICT now updates all content fields (was only updated_at) | briefing-service.js |
| 2026-03-28 | ALWAYS geocode even when Gemini provides place_id | briefing-service.js |
| 2026-02-26 | Gemini-only discovery (no cross-provider fallback) | briefing-service.js |
| 2026-02-17 | Venue creation gap fixed: geocode + findOrCreateVenue | briefing-service.js |
| 2026-02-17 | All-day events get 08:00-22:00 window | normalizeEvent.js |
| 2026-01-14 | Progressive enrichment: is_event_venue, record_status | venue-cache.js |
| 2026-01-10 | Symmetric field naming (event_start_date, etc.) | All pipeline files |
