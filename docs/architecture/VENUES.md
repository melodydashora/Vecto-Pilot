# VENUES.md — Venue Discovery and Management Architecture

> **Canonical reference** for venue discovery, scoring, ranking, Google Places integration, and how venues appear in the UI.
> Last updated: 2026-04-14 (Status taxonomy, heuristic scoring labels, driver preference gap documented)

## Supersedes
- `server/lib/venue/README.md` — Venue module docs (merged here)
- `server/api/strategy/README.md` — Blocks-fast pipeline docs (strategy portion in STRATEGY.md)

---

## Table of Contents

1. [SmartBlocks Generation Pipeline](#1-smartblocks-generation-pipeline)
2. [Venue Scoring and Ranking](#2-venue-scoring-and-ranking)
3. [Google Places Integration](#3-google-places-integration)
4. [Venue Database Schema](#4-venue-database-schema)
5. [Venue Filtering and Classification](#5-venue-filtering-and-classification)
6. [Venue-to-Driver Matching](#6-venue-to-driver-matching)
7. [Event Matching and Enrichment](#7-event-matching-and-enrichment)
8. [Client-Side: How Venues Appear in UI](#8-client-side-how-venues-appear-in-ui)
9. [API Endpoints](#9-api-endpoints)
10. [Current State](#10-current-state)
11. [Known Gaps](#11-known-gaps)
## 12. TODO — Hardening Work

## 13. Venue Pipeline End-to-End Audit
See `VENUES_PIPELINE_AUDIT.md` for a comprehensive, line-numbered audit separating the Smart Blocks canonical pipeline from the Bar Tab nearby-venues utility, along with duplication risks.

---

## 1. SmartBlocks Generation Pipeline

**File:** `server/lib/venue/enhanced-smart-blocks.js`

```
generateEnhancedSmartBlocks(snapshotId)
  │
  ├─ Input: immediateStrategy + briefing + snapshot
  │
  ├─ Step 1: VENUE_SCORER (tactical-planner.js)
  │  └─ callModel('VENUE_SCORER') → GPT-5.4 (reasoningEffort: medium)
  │  └─ Returns 4–8 venue recommendations with coords, category, pro_tips, staging info
  │
  ├─ Step 2: enrichVenues() (venue-enrichment.js)
  │  ├─ Google Places API: resolve place_id, address, business hours, status
  │  ├─ Google Routes API: batch drive time + distance from driver
  │  └─ Filter permanently closed venues
  │
  ├─ Step 3: matchVenuesToEvents() (event-matcher.js)
  │  └─ 2026-04-11: Match via place_id (primary) → venue_id → name fallback.
  │     Events are pre-fetched state-scoped by the caller at the top of the
  │     pipeline (fetchTodayDiscoveredEventsWithVenue with driver coords,
  │     60-mile metro context radius, distance-annotated, closest-first
  │     sorted). The matcher uses strong identity keys instead of address
  │     strings and does not re-query the DB. Distance plays no role in the
  │     matcher itself — by the time it runs, VENUE_SCORER has only picked
  │     venues within 15 miles of the driver, so far-bucket events naturally
  │     produce no matches (they were never candidates).
  │
  ├─ Step 4: verifyVenueEventsBatch() (venue-event-verifier.js)
  │  └─ Gemini verifies event relevance per venue
  │
  ├─ Step 5: promoteToVenueCatalog() 
  │  └─ Upsert verified venues to venue_catalog (canonical identity)
  │
  └─ Step 6: Write to rankings + ranking_candidates tables
```

---

## 2. Venue Scoring and Ranking

### VENUE_SCORER Response Schema

**File:** `server/lib/strategy/tactical-planner.js` (lines 41–66)

```typescript
VenueRecommendation {
  name: string;                    // Venue name (1-200 chars)
  lat, lng: number;                // Coordinates
  staging_lat, staging_lng: number; // WHERE TO PARK (separate from venue)
  staging_name: string;            // "Nearby parking lot name"
  district: string;                // "Legacy West", "Deep Ellum"
  category: enum;                  // airport|entertainment|shopping|dining|sports_venue|transit_hub|hotel|nightlife|event_venue|other
  pro_tips: string[];              // 1-3 tactical tips (max 500 chars each)
  strategic_timing: string;        // "Opens in 30 min", "Event at 7 PM"
}
```

### Value Scoring (Post-Enrichment) — HEURISTIC

> **Note:** This is a distance-based heuristic, not an economic model. The $1.50/mile rate is a static estimate with no surge, airport, or offer data. See §11 Known Gaps.

```javascript
estimatedEarnings = distanceMiles * $1.50/mile;  // static rate
valuePerMin = estimatedEarnings / driveTimeMinutes;

// Grading:
'A' → valuePerMin >= $1.00/min  (premium)
'B' → valuePerMin >= $0.50/min  (good)
'C' → valuePerMin < $0.50/min   (standard)
notWorth → valuePerMin < $0.30   (flagged)
```

### Rank-Based Model Score

```javascript
model_score = 1.0 - (rank * 0.1);
// Rank 1: 1.0, Rank 2: 0.9, Rank 3: 0.8, etc.
```

### Sorting

Blocks sorted by: `valuePerMin DESC` (highest earnings first), then `estimatedDistanceMiles ASC` (closest within same tier). Filtered to within 25 miles.

---

## 3. Google Places Integration

### APIs Used

| API | Purpose | File |
|-----|---------|------|
| Places SearchNearby | Find venue by coords (500m radius, top 3) | `venue-enrichment.js` |
| Places SearchText | Fallback: find venue by name + district + city | `venue-enrichment.js` |
| Places GetByPlaceId | Enrich venue with hours, rating, phone | `venue-enrichment.js` |
| Routes Matrix | Batch drive time/distance (1 origin, N destinations) | `venue-enrichment.js` |
| Geocoding | Reverse geocode for address resolution | `venue-address-resolver.js` |

### Caching Strategy

1. **In-memory cache** (6h TTL) — fastest
2. **Database cache** (`places_cache` table, keyed by `coords_key`) — persistent
3. **Google API** — fallback with retry logic

### Business Hours Calculation

```javascript
// Canonical pipeline:
Google weekdayDescriptions → parseGoogleWeekdayText() → getOpenStatus()
// Returns: { is_open, hours_today, closing_soon, minutes_until_close, opens_in_minutes }
// CRITICAL: Requires driver's timezone — returns null if missing
```

### Permanently Closed Filtering

```javascript
if (placeDetails.business_status === 'CLOSED_PERMANENTLY') {
  return null; // Filtered out entirely — never shown to driver
}
```

---

## 4. Venue Database Schema

### `venue_catalog` — Master Venue Table

**File:** `shared/schema.js` (lines 230–330)

| Column | Type | Purpose |
|--------|------|---------|
| `venue_id` | UUID PK | Canonical identity |
| `place_id` | text (unique) | Google Places ID |
| `venue_name` | varchar(500) | Name |
| `address` | varchar(500) | Full address |
| `lat`, `lng` | double | Coordinates |
| `coord_key` | text (unique) | 6-decimal dedup key |
| `normalized_name` | text | Lowercase alphanumeric (fuzzy match) |
| `category` | text | Default: 'venue' |
| `venue_types` | jsonb | ['bar', 'restaurant', ...] |
| `is_bar` | boolean | Fast filter flag |
| `is_event_venue` | boolean | Discovered via events |
| `expense_rank` | integer | 1–4 ($–$$$$) |
| `google_rating` | double | Raw rating |
| `venue_quality_tier` | text | 'premium' / 'standard' (Haiku-assessed) |
| `business_hours` | jsonb | Google Places hours |
| `hours_full_week` | jsonb | {monday: "4:00 PM - 2:00 AM", ...} |
| `last_known_status` | text | open/closed/temporarily_closed/permanently_closed |
| `record_status` | text | 'stub' / 'enriched' / 'verified' |

### `rankings` — Session Metadata

| Column | Type | Purpose |
|--------|------|---------|
| `ranking_id` | UUID PK | Session identifier |
| `snapshot_id` | UUID FK | Links to driver context |
| `model_name` | text | AI model used |
| `planner_ms` | integer | VENUE_SCORER latency |
| `total_ms` | integer | End-to-end time |

### `ranking_candidates` — Individual Venues

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | Candidate identifier |
| `ranking_id` | UUID FK (cascade) | Session link |
| `venue_id` | UUID FK (set null) | Canonical venue link |
| `name`, `lat`, `lng`, `place_id` | various | Venue identity |
| `rank` | integer | Position (1-6) |
| `distance_miles`, `drive_time_minutes` | numeric | Route metrics |
| `value_per_min`, `value_grade` | numeric/text | Earnings estimate |
| `pro_tips` | text[] | 2-3 tactical tips |
| `staging_tips`, `staging_lat`, `staging_lng` | text/double | Parking info |
| `business_hours` | jsonb | Hours data |
| `venue_events` | jsonb | Matched events |
| `closed_reasoning` | text | Why recommend if closed |

### `venue_metrics` — Feedback Aggregation

| Column | Type | Purpose |
|--------|------|---------|
| `venue_id` | UUID PK FK | Canonical venue |
| `times_recommended` | integer | How often in SmartBlocks |
| `times_chosen` | integer | Driver actually went |
| `reliability_score` | double | 0.5 default, updated by feedback |

---

## 5. Venue Filtering and Classification

### VENUE_FILTER Role (Haiku)

**File:** `server/api/venue/venue-intelligence.js` (lines 243–335)

Classifies venues into tiers:
- **P (PREMIUM):** Upscale lounges, cocktail bars, rooftop bars, speakeasies, high-end nightclubs
- **S (STANDARD):** Sports bars, casual pubs, breweries, taphouses
- **X (REMOVE):** Fast food, pizza, coffee, ice cream, gas stations, grocery stores

### Hardcoded Exclusion Set

Fast food chains (McDonald's, Wendy's, etc.), coffee shops (Starbucks, Dunkin'), grocery stores (Kroger, Walmart), gas stations — all excluded before classification.

### Closed Venue Handling

- **Permanently closed:** Filtered out entirely
- **Temporarily closed:** Shown with `isOpen: false` + `closedVenueReasoning`
- **Opening soon:** Shown with `opensInMinutes` countdown
- **Strategy value:** `strategic_timing` field from VENUE_SCORER explains why a closed venue is worth staging near

---

## 6. Venue-to-Driver Matching

### Distance Calculation

- **Primary:** Google Routes Matrix API (drive time with traffic)
- **Fallback:** Individual route calls if batch fails
- **Filter:** Venues beyond 25 miles excluded
- **Conversion:** `distanceMeters × 0.000621371 = distanceMiles`

### Coordinate Precision

`coord_key` format: `33.123456_-96.123456` (6 decimal places = ~11cm accuracy). Used for deduplication in venue_catalog.

---

## 7. Event Matching and Enrichment

### Event-to-Venue Linking

**File:** `server/lib/venue/event-matcher.js`

```javascript
// 2026-04-11: Rewritten to use strong identity keys. No longer async, no longer
// queries the DB — caller (enhanced-smart-blocks.js) pre-fetches events via
// fetchTodayDiscoveredEventsWithVenue(state, eventDate, driverLat, driverLng, 60)
// and passes them in. The caller supplies distance annotation and closest-first
// sort; the matcher itself is distance-agnostic.
matchVenuesToEvents(enrichedVenues, todayEvents)
// Match priority: place_id → venue_id → name fallback
// Returns Map<venueName, Event[]>
```

### Smart Blocks ↔ Event Venue Coordination (NEAR / FAR Bucket Model)

The venue-to-event relationship is governed by the 15-mile rule: `VENUE_SCORER` may only recommend venues within 15 miles of the driver's GPS coordinates, even when events exist in the metro. Event data enriches Smart Blocks via a two-bucket model applied at the prompt-formatting layer (`server/lib/briefing/filter-for-planner.js :: formatBriefingForPrompt`):

- **NEAR EVENTS (≤ 15 mi from driver):** Candidate venues. `VENUE_SCORER` recommends these event venues directly with event-specific `pro_tips`.
- **FAR EVENTS (> 15 mi from driver):** Surge flow intelligence, NOT destinations. `VENUE_SCORER` uses them to reason about demand origination (attendees depart FROM areas near the driver TO the far venue) and recommends close high-impact venues that benefit from the outflow.

The 60-mile metro context radius at the fetch layer is decoupled from the 15-mile venue-eligibility rule at the prompt layer: the former is a data-layer cap on what's worth reasoning over, the latter is a tactical-layer constraint on what to recommend as a destination.

**Canonical reference:** `docs/EVENTS.md` § 10. Full history: `server/lib/venue/SMART_BLOCKS_EVENT_ALIGNMENT_PLAN.md`.

### Time Relevance Filter

```javascript
isEventTimeRelevant(eventStartTime, snapshotTimezone)
// Returns true if event starts within NEXT 2 hours OR started within LAST 4 hours
```

### Event Badge Rendering

```javascript
hasEvent = venue_events.length > 0 && isEventTimeRelevant(...)
eventBadge = venue_events[0].title  // First event title
eventSummary = `${category} at ${event_start_time}`
```

---

## 8. Client-Side: How Venues Appear in UI

### SmartBlocks Response (blocks-fast GET)

**File:** `server/validation/transformers.js` → `toApiBlock()`

Each block sent to client:
```typescript
{
  name, address, coordinates: {lat, lng},
  placeId, estimatedDistanceMiles, driveTimeMinutes,
  distanceSource, valuePerMin, valueGrade, notWorth,
  surge, estimatedEarningsPerRide, estimatedWaitTime, demandLevel,
  proTips: string[],
  closedVenueReasoning: string | null,
  stagingArea: { parkingTip } | null,
  isOpen: boolean | null,
  businessHours, businessStatus,
  streetViewUrl,
  hasEvent: boolean, eventBadge: string | null
}
```

### useBarsQuery Hook

**File:** `client/src/hooks/useBarsQuery.ts`

- **Endpoint:** `GET /api/venues/nearby?lat=&lng=&city=&state=&radius=25&timezone=`
- **Cache:** 5-min staleTime, 10-min gcTime
- **Returns:** `{ venues: Venue[], lastCallVenues: Venue[] }`

---

## 9. API Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/blocks-fast` | POST | requireAuth | Full waterfall: briefing → strategy → venues |
| `/api/blocks-fast?snapshotId=X` | GET | requireAuth | Fetch generated blocks |
| `/api/venues/nearby` | GET | requireAuth | Bar/lounge discovery for Bar Tab |
| `/api/venues/traffic` | GET | requireAuth | Traffic intelligence |
| `/api/venues/last-call` | GET | requireAuth | Venues closing within 1 hour |

---

## 10. Current State

### Status Taxonomy

| Label | Meaning |
|-------|---------|
| **Implemented** | Code exists and compiles. No runtime evidence yet. |
| **Statically Verified** | Code reviewed, syntax checked, imports validated. Not tested with real data. |
| **Runtime Tested** | Ran in dev with real or realistic data. Observed correct behavior in logs. |
| **Owner Confirmed** | Melody (product owner) has verified the feature in the running app. |

### Feature Status

| Area | Status |
|------|--------|
| VENUE_SCORER (via `VENUE_SCORER` role) | Runtime Tested — 4-8 venue recommendations |
| Google Places enrichment | Runtime Tested — place_id, hours, status |
| Google Routes batch | Runtime Tested — drive time with traffic |
| Event matching | Statically Verified — strong identity keys (`place_id` → `venue_id` → name fallback, 2026-04-11). Rewritten but no post-rewrite runtime confirmation. |
| Smart Blocks ↔ event coordination | Statically Verified — NEAR/FAR bucket model with 15-mile rule (2026-04-11). Code complete, reviewed, no end-to-end runtime test with real events confirmed. |
| Venue catalog persistence | Runtime Tested — upsert on each pipeline run |
| VENUE_FILTER (via `VENUE_FILTER` role) | Runtime Tested — P/S/X classification |
| Value grading (A/B/C) | Runtime Tested — heuristic, distance-based (see §11 Known Gaps) |

---

## 11. Known Gaps

1. **No driver preference influence on venue scoring** — `generateEnhancedSmartBlocks()` accepts `user_id` but only uses it for ranking record attribution. Scoring and filtering ignore driver preferences entirely. The strategist layer was enriched with driver prefs (2026-04-11) but the venue layer was not. Specific preferences that should be threaded through:
   - **max_deadhead_mi** — Filter venues beyond the driver's deadhead tolerance (currently hardcoded 25mi)
   - **Home base bias** — Prefer venues closer to home for end-of-shift positioning
   - **Vehicle/service eligibility** — Exclude venues requiring vehicle types the driver doesn't have (e.g., airport queue requires TLC plates)
2. **No venue freshness tracking** — A venue's hours from 3 months ago are treated the same as today's data.
3. ~~**Event matching is fuzzy** — String-based name matching can miss or mismatch venues.~~ **Resolved 2026-04-11:** `event-matcher.js` rewritten to use `place_id` as the primary match key (both sides Google-sourced → invariant across formatting drift), with `venue_id` as secondary and substantial-name-match as a tertiary fallback.
4. **Value scoring is a distance heuristic, not economic truth** — `estimatedEarnings = distanceMiles × $1.50/mile` (static). No surge multiplier, airport queue premium, or offer intelligence data. The A/B/C grade (`valuePerMin`) measures drive-efficiency, not actual earning potential. See `enhanced-smart-blocks.js:495`.
5. **Venue catalog grows unbounded** — No cleanup of permanently closed or unused venues.
6. **No venue popularity signal** — Missing data on which venues actually produce rides.

---

## 12. TODO — Hardening Work

- [ ] **Integrate surge pricing into value scoring** — Use real-time surge multipliers from offer intelligence
- [ ] **Add venue freshness TTL** — Re-check business hours if data older than 7 days
- [ ] **Driver preference-aware scoring** — Thread max_deadhead_mi (filter), home base bias (end-of-shift), vehicle/service eligibility (exclusion) into venue scoring via `loadDriverPreferences(user_id)`
- [ ] **Venue popularity from ride history** — Track which venues drivers get rides from (via offer intelligence)
- [x] ~~**Place_id-based event matching** — Use Google Place IDs instead of fuzzy name matching~~ (Resolved 2026-04-11 — `event-matcher.js` rewritten with `place_id` → `venue_id` → name fallback)
- [ ] **Venue catalog cleanup job** — Archive permanently closed venues, prune unused stubs older than 90 days
- [ ] **Real-time surge overlay** — Show surge zones on venue map markers

---

## Key Files

| File | Purpose |
|------|---------|
| `server/lib/venue/enhanced-smart-blocks.js` | SmartBlocks orchestrator |
| `server/lib/strategy/tactical-planner.js` | VENUE_SCORER prompts |
| `server/lib/venue/venue-enrichment.js` | Google API enrichment |
| `server/api/venue/venue-intelligence.js` | Bar discovery + VENUE_FILTER |
| `server/lib/venue/event-matcher.js` | Event-to-venue linking |
| `server/validation/transformers.js` | DB → API response transform |
| `client/src/hooks/useBarsQuery.ts` | Client venue hook |
| `shared/schema.js` | venue_catalog, rankings, ranking_candidates schemas |
