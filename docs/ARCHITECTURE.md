
# Vecto Pilot™ - Architecture & Constraints Reference

---

**Last Updated:** 2025-10-26 18:00 UTC  
**Database Status:** ✅ OPERATIONAL - All tables verified  
**Workflow Status:** ✅ Running on port 5174 (mono-mode)  
**System State:** 🟢 PRODUCTION READY

---

## 📋 Table of Contents

1. [Vision & Mission](#vision--mission)
2. [Core Principles & Non-Negotiables](#core-principles--non-negotiables)
3. [System Architecture](#system-architecture)
4. [Complete System Workflow](#complete-system-workflow)
5. [Project File Structure](#project-file-structure)
6. [Environment Variables Reference](#environment-variables-reference)
7. [API Endpoint Reference](#api-endpoint-reference)
8. [Frontend Architecture](#frontend-architecture)
9. [Database Schema & Complete Data Flow](#database-schema--complete-data-flow)
10. [AI Model Strategy & Risk Management](#ai-model-strategy--risk-management)
11. [External API Constraints](#external-api-constraints)
12. [Testing Strategy](#testing-strategy)
13. [Known Risks & Mitigations](#known-risks--mitigations)
14. [AI Development Guardrails](#ai-development-guardrails)
15. [Deployment & Infrastructure](#deployment--infrastructure)
16. [Decision Log](#decision-log)

---

## 🎯 Vision & Mission

### Vision Statement
**"Empower rideshare drivers with AI-powered strategic positioning intelligence that eliminates guesswork and maximizes earnings through data-driven recommendations."**

### Mission Statement

**Drivers don't lose money because they can't drive.** They lose it in the gaps—time with no passenger, miles with no rider, and opaque pricing that shifts under their feet. In big markets, as much as 40% of rideshare miles are "deadhead" miles between trips, which drags down earnings even when the per-trip payout looks decent.

**This app solves that problem** by removing guesswork and grounding every recommendation in verified coordinates and business hours from Google Places—not model hallucinations. It computes distance and earnings-per-mile from the server side with real navigation distance, not rough client math.

**Core Value Propositions:**
1. **Higher Utilization** - Reduce deadhead miles through strategic positioning
2. **Verified Data** - No hallucinated venues; all locations validated via Google Places API
3. **Real-Time Intelligence** - Traffic-aware routing, airport delays, weather integration
4. **ML-Ready Capture** - Every recommendation tracked for counterfactual learning
5. **Safety First** - Reduce fatigue from aimless driving, get home faster with fewer total miles

### Business Model
- **Driver-First SaaS** - Subscription model ($9.99/month or $89.99/year)
- **No Commission Cuts** - We don't touch driver earnings
- **Privacy-Preserving** - Anonymous usage tracking, no PII required
- **Platform Agnostic** - Works with Uber, Lyft, any rideshare service

---

## 🔒 Core Principles & Non-Negotiables

### 1. **Accuracy Before Expense**
Cost matters but cannot override correctness for drivers. When tension exists, we resolve in favor of accuracy and transparent failure.

**Example:** If Google Places API quota is exhausted, we fail-closed with clear error message rather than using stale/cached data.

### 2. **Zero Hardcoding Policy**
All location data, venue information, and model configurations MUST come from:
- **Database** (PostgreSQL) - Venue catalog, metrics, feedback
- **Environment Variables** (.env) - Model names, API endpoints, timeouts
- **External APIs** (Google Maps, Weather, FAA) - Real-time context

**Forbidden:**
```javascript
// ❌ NEVER DO THIS
if (city === "Dallas") { ... }
const model = "gpt-4"; // Hardcoded model name

// ✅ ALWAYS DO THIS
const venue = await db.select().from(venue_catalog).where(eq(venue_catalog.city, city));
const model = process.env.OPENAI_MODEL;
```

### 3. **Single-Path Triad (No Fallbacks in Production Flow)**
The recommendation pipeline uses a deterministic three-stage process:
1. **GPT-5** (Strategist) - Strategic overview with deep reasoning
2. **GPT-5** (Planner) - Tactical venue selection with coordinates
3. **Gemini 2.5 Pro** (Validator) - JSON validation and value-per-minute ranking

~~**Old Approach:** Claude Sonnet 4.5 → GPT-5 → Gemini (deprecated Oct 2025)~~

**No fallback models** - If any stage fails, the entire request fails with clear error. This preserves ML training data integrity (we know exactly which model produced each output).

**Exception:** Agent Override (workspace operations) uses fallback chain for operational resilience.

### 4. **Database-Driven Reconciliation**
Every venue recommendation MUST reconcile to:
- `venue_catalog` table (seeded venues)
- Google Places API (validation of coordinates/hours)
- `ranking_candidates` table (ML training data)

**Flow:**
```
GPT-5 suggests "Stonebriar Centre"
  → Lookup place_id via Google Places Find Place API
  → Validate coordinates via Google Geocoding API
  → Fetch hours via Google Places Details API
  → Store in venue_catalog (if new)
  → Create ranking_candidates row (ML capture)
  → Return to user with verified data
```

### 5. **Complete Snapshot Gating**
No LLM call without a complete location snapshot:
- GPS coordinates (lat, lng, accuracy)
- City, state, timezone
- Weather, AQI
- Time context (daypart, hour, dow, is_weekend)
- H3 geospatial index

**If any core field is missing**, return `400 Bad Request` with `refresh_required` status.

### 6. **Deterministic Logging for ML**
For every recommendation set served:
- Input: `snapshot_id`, context hash, H3 hex
- Process: `ranking_id`, model names, token usage, latency
- Output: `ranking_candidates` (6 venues with rank, earnings, distance)
- Outcome: `actions` (view, dwell, click, dismiss)

This enables counterfactual learning: "Given context X, model suggested Y, user chose Z."

---

## 🏗️ System Architecture

### Multi-Server Design

```
┌─────────────────────────────────────────────────────────┐
│        GATEWAY SERVER (Port 5174 - Public)              │
│  ├─ Mono-mode unified server                            │
│  ├─ Vite dev server (HMR for React)                     │
│  ├─ Static file serving (client/dist)                   │
│  ├─ CORS & rate limiting (100 req/15min)                │
│  ├─ Per-route JSON parsing (NOT global)                 │
│  ├─ Client abort error gate (499 status)                │
│  └─ Health checks on :80 for Replit detection           │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│             API ROUTES (/api/*)                          │
│  ├─ Business logic & API endpoints                      │
│  ├─ Multi-model AI integration (GPT-5/Gemini)           │
│  ├─ Enhanced memory system                              │
│  ├─ Workspace intelligence & diagnostics                │
│  └─ ML data capture & persistence                       │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│          POSTGRESQL DATABASE (Neon Serverless)          │
│  ├─ snapshots (context records) - 30 day TTL            │
│  ├─ strategies (GPT-5 overviews) - linked to snapshots  │
│  ├─ rankings (recommendation sets) - ML training data   │
│  ├─ ranking_candidates (individual venues) - ranked     │
│  ├─ actions (user interactions) - clicks/dwells         │
│  ├─ venue_catalog (seeded + discovered venues)          │
│  ├─ venue_metrics (recommendation stats)                │
│  ├─ venue_feedback (thumbs up/down per ranking)         │
│  └─ places_cache (Google Places hours cache)            │
└─────────────────────────────────────────────────────────┘
```

### Technology Stack

**Frontend:**
- React 18 (single render in production, ~~StrictMode disabled~~)
- TypeScript 5.x
- TanStack Query v5 (data fetching with smart caching)
- Wouter (lightweight routing)
- Tailwind CSS + shadcn/ui

**Backend:**
- Node.js 22.x (ESM modules)
- Express.js (per-route JSON parsing)
- Drizzle ORM (type-safe database queries)
- PostgreSQL (Neon serverless with connection pooling)

**AI Models:**
- GPT-5 (`gpt-5` - reasoning_effort: high) - Strategist + Planner
- Gemini 2.5 Pro (`gemini-2.5-pro-latest`) - Validator
- ~~Claude Sonnet 4.5 (deprecated for production flow)~~

**External APIs:**
- Google Maps (Geocoding, Directions, Timezone, Places)
- Google Air Quality API
- OpenWeather API
- FAA ASWS (Airport Status Web Service)

---

## 🔄 Complete System Workflow

### End-to-End User Journey (Production Flow)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    1. USER OPENS APP                                 │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│              2. GPS LOCATION ACQUISITION                             │
│  ├─ Browser Geolocation API (high accuracy mode)                    │
│  ├─ Fallback: Google Geolocation API                                │
│  └─ Coordinates: { lat, lng, accuracy }                             │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│         3. PARALLEL CONTEXT ENRICHMENT (3 API calls)                │
│  ├─ GET /api/location/resolve?lat={lat}&lng={lng}                   │
│  │   → City, State, Timezone (Google Geocoding)                     │
│  ├─ GET /api/location/weather?lat={lat}&lng={lng}                   │
│  │   → Temperature, Conditions, Humidity (OpenWeather)              │
│  └─ GET /api/location/airquality?lat={lat}&lng={lng}                │
│      → AQI, Category, Pollutant (Google Air Quality)                │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│              4. SNAPSHOT CREATION & PERSISTENCE                      │
│  POST /api/location/snapshot                                        │
│  ├─ Creates SnapshotV1 with complete context                        │
│  ├─ Calculates H3 geohash (resolution 8)                            │
│  ├─ Fetches nearby airport delays (FAA API)                         │
│  ├─ Fetches local news (Perplexity API)                             │
│  └─ Writes to snapshots table → returns snapshot_id                 │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│         5. STRATEGY GENERATION (GPT-5 Strategist)                   │
│  Background job triggered by snapshot creation:                      │
│  ├─ Reads complete snapshot context                                 │
│  ├─ Calls GPT-5 with reasoning_effort=high                          │
│  ├─ Generates 120-word strategic overview                           │
│  └─ Writes to strategies table (status=ok)                          │
│  Timeout: 120 seconds with 6 retries                                │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│    6. FRONTEND POLLING FOR STRATEGY (Light - 5s intervals)          │
│  GET /api/blocks/strategy/{snapshotId}                              │
│  ├─ Status: pending → Frontend keeps polling                        │
│  ├─ Status: ok → Strategy ready, enable blocks query                │
│  └─ Status: failed → Show error with retry option                   │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  7. BLOCKS REQUEST GATING (Strategy must be ready)                  │
│  Blocks query ONLY runs when:                                       │
│  ├─ ✅ GPS coordinates available                                    │
│  ├─ ✅ Snapshot created (snapshot_id exists)                        │
│  ├─ ✅ Strategy written to DB (status=ok)                           │
│  └─ ✅ Strategy snapshot_id matches current snapshot                │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│         8. TACTICAL PLANNING (GPT-5 Planner)                        │
│  POST /api/blocks                                                   │
│  Headers: X-Snapshot-Id: {snapshot_id}                              │
│  ├─ Loads strategy from database                                    │
│  ├─ Calls GPT-5 with strategy + snapshot context                    │
│  ├─ Generates 6 venue recommendations with:                         │
│  │   - Venue name, coordinates (lat, lng)                           │
│  │   - Staging coordinates (where to park)                          │
│  │   - Category, pro tips (2-3 tactical tips)                       │
│  │   - Strategic timing (if venue closed but still valuable)        │
│  └─ Returns JSON with venue list                                    │
│  Timeout: 180 seconds (3 minutes)                                   │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│         9. VENUE ENRICHMENT (Google APIs - Parallel)                │
│  For each venue from GPT-5:                                         │
│  ├─ Google Places Find Place API                                    │
│  │   → Resolve name to place_id + verified coords                   │
│  ├─ Google Routes API (TRAFFIC_AWARE_OPTIMAL)                       │
│  │   → Actual drive distance + time with traffic                    │
│  └─ Google Places Details API                                       │
│      → Business hours, status, address                              │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│    10. VALUE CALCULATION & VALIDATION (Gemini 2.5 Pro)             │
│  ├─ Calculates value_per_min for each venue:                        │
│  │   value_per_min = (rate * surge * trip_time) /                   │
│  │                   (drive_time + wait_time + trip_time)           │
│  ├─ Assigns value_grade: A, B, C, D                                 │
│  ├─ Flags venues below threshold (not_worth)                        │
│  ├─ Calls Gemini 2.5 Pro for JSON validation                        │
│  └─ Gemini reranks by value_per_min descending                      │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│         11. ML DATA CAPTURE (Atomic Transaction)                    │
│  Transaction in persist-ranking.js:                                 │
│  ├─ INSERT INTO rankings (ranking_id, snapshot_id, model_name)      │
│  ├─ For each venue:                                                 │
│  │   - UPSERT venue_catalog (if new place_id)                       │
│  │   - UPDATE venue_metrics (increment times_recommended)           │
│  │   - INSERT ranking_candidates (with rank, value_per_min)         │
│  └─ COMMIT or ROLLBACK on error                                     │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│              12. RESPONSE TO FRONTEND                                │
│  Returns BlocksResponse:                                            │
│  ├─ strategy: "Today is Saturday, 10/26/2025..."                    │
│  ├─ blocks: [6 venues with all enriched data]                       │
│  ├─ ranking_id: UUID (for action tracking)                          │
│  └─ metadata: { totalBlocks, processingTimeMs, modelRoute }         │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│         13. USER INTERACTION TRACKING (Client-side)                 │
│  ├─ IntersectionObserver tracks card views                          │
│  ├─ Dwell time calculated (time in viewport)                        │
│  ├─ Click events logged immediately                                 │
│  └─ POST /api/actions with idempotency key                          │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│              14. FEEDBACK COLLECTION (Optional)                      │
│  ├─ POST /api/feedback/venue (thumbs up/down per venue)             │
│  ├─ POST /api/feedback/strategy (thumbs up/down for AI strategy)    │
│  └─ Updates venue_metrics.positive_feedback / negative_feedback     │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│         15. ML TRAINING DATA READY                                  │
│  Complete counterfactual learning dataset:                           │
│  ├─ Input: snapshots (context at decision time)                     │
│  ├─ Recommendations: ranking_candidates (what AI suggested)         │
│  ├─ Behavior: actions (what user actually chose)                    │
│  └─ Outcomes: venue_feedback (driver satisfaction)                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Timing Breakdown (Typical Request)

| Stage | Time | Cumulative | Notes |
|-------|------|------------|-------|
| GPS acquisition | 2-5s | 5s | Browser API or Google fallback |
| Context enrichment (parallel) | 1-2s | 7s | 3 API calls simultaneously |
| Snapshot creation | 0.5s | 7.5s | Database write + H3 calculation |
| Strategy generation (GPT-5) | 15-45s | 52.5s | Background job, user sees loading |
| Frontend polling (avg 3 polls) | 15s | 67.5s | 5s intervals while strategy pending |
| Tactical planning (GPT-5) | 30-90s | 157.5s | Venue generation with reasoning |
| Venue enrichment (parallel) | 5-10s | 167.5s | Google APIs for 6 venues |
| Value calculation + Gemini | 5-15s | 182.5s | Final validation and ranking |
| ML data persistence | 0.5s | 183s | Atomic transaction |
| **Total (worst case)** | **~3 minutes** | | User sees strategy at 1 min mark |

### Error Handling at Each Stage

**GPS Failure:**
- Fallback to Google Geolocation API
- If both fail: Show manual city search dialog

**Context Enrichment Failure:**
- Missing weather/AQI: Proceed with partial data
- Missing timezone: ABORT (required for time calculations)

**Snapshot Creation Failure:**
- Retry up to 3 times with exponential backoff
- If persistent: Show "GPS unavailable" error

**Strategy Generation Failure:**
- Retry up to 6 times (transient errors)
- Timeout after 120s: Show timeout error with refresh option
- Model error (4xx): Show model unavailable error

**Blocks Request Failure:**
- If strategy not ready: Keep polling (up to 12 retries)
- Timeout after 180s: Show tactical planning timeout
- Validation error: Return partial results with warnings

**Database Failure:**
- Connection pool retries automatically
- Foreign key errors: Retry with exponential backoff (up to 8 attempts)
- Transaction rollback: Return error, no partial data saved

---

## 🗄️ Database Schema & Complete Data Flow

### Table Overview

**19 Total Tables:**
- **9 User Data Tables:** snapshots, actions, rankings, venue_feedback, strategy_feedback, assistant_memory, eidolon_memory, cross_thread_memory, agent_memory
- **6 System Tables:** triad_jobs, http_idem, venue_metrics, llm_venue_suggestions, travel_disruptions, app_feedback
- **2 Public Data Tables:** venue_catalog, places_cache
- **2 Linked Tables:** strategies (via snapshot_id), ranking_candidates (via ranking_id)

### Complete UI-to-Backend-to-Database Mapping

---

#### **FLOW 1: Location Snapshot Creation**

**UI Action:** User opens app or refreshes GPS location

**Frontend → Backend:**
```typescript
// client/src/lib/snapshot.ts
POST /api/location/snapshot
{
  snapshot_id: UUID,
  user_id: UUID,
  device_id: UUID,
  session_id: UUID,
  coord: { lat, lng, accuracyMeters, source },
  resolved: { city, state, country, formattedAddress, timezone },
  time_context: { local_iso, dow, hour, day_part_key },
  weather: { tempF, conditions, description },
  air: { aqi, category },
  device: { ua, platform },
  permissions: { geolocation }
}
```

**Backend Processing:**
```javascript
// server/routes/location.js
- Validates snapshot completeness
- Calculates H3 geospatial index (resolution 8)
- Fetches nearby airport delays (FAA API)
- Fetches local news (Perplexity API)
```

**Database Table:** `snapshots`
```sql
INSERT INTO snapshots (
  snapshot_id,           -- UUID from client
  created_at,           -- Server timestamp
  user_id,              -- UUID or NULL
  device_id,            -- UUID (device fingerprint)
  session_id,           -- UUID (browser session)
  lat,                  -- coord.lat
  lng,                  -- coord.lng
  accuracy_m,           -- coord.accuracyMeters
  coord_source,         -- coord.source ('gps' | 'wifi' | 'cell')
  city,                 -- resolved.city
  state,                -- resolved.state
  country,              -- resolved.country
  formatted_address,    -- resolved.formattedAddress
  timezone,             -- resolved.timezone
  local_iso,            -- time_context.local_iso
  dow,                  -- time_context.dow (0=Sunday, 6=Saturday)
  hour,                 -- time_context.hour (0-23)
  day_part_key,         -- time_context.day_part_key
  h3_r8,                -- Calculated H3 cell ID
  weather,              -- JSONB: weather object
  air,                  -- JSONB: air quality object
  airport_context,      -- JSONB: FAA delay data
  local_news,           -- JSONB: Perplexity news summary
  device,               -- JSONB: device info
  permissions,          -- JSONB: permissions status
  last_strategy_day_part, -- NULL initially
  trigger_reason        -- NULL initially
)
```

**Data Resolution:** All location data shown in UI comes from this table
- City name: `snapshots.city`
- Weather: `snapshots.weather.tempF + snapshots.weather.conditions`
- Air Quality: `snapshots.air.aqi + snapshots.air.category`
- Airport delays: `snapshots.airport_context.delay_minutes`

---

#### **FLOW 2: Strategy Generation**

**Backend Trigger:** Snapshot creation with complete data

**Background Job:**
```javascript
// server/lib/strategy-generator.js
- Enqueued automatically when snapshot written
- Calls GPT-5 with reasoning_effort=high
- Generates 120-word strategic overview
```

**Database Table:** `strategies`
```sql
INSERT INTO strategies (
  id,                   -- UUID (auto-generated)
  snapshot_id,          -- FK to snapshots.snapshot_id (UNIQUE)
  correlation_id,       -- UUID for request tracing
  strategy,             -- GPT-5 strategic text
  strategy_for_now,     -- Tactical summary (unlimited length)
  status,               -- 'pending' → 'ok' | 'failed'
  error_code,           -- HTTP status if failed
  error_message,        -- Error details if failed
  attempt,              -- Retry counter
  next_retry_at,        -- Timestamp for next retry
  latency_ms,           -- GPT-5 API response time
  tokens,               -- Token count for billing
  model_name,           -- 'gpt-5'
  model_params,         -- JSONB: { reasoning_effort, max_tokens }
  prompt_version,       -- 'v2.3' for A/B testing
  lat,                  -- Location context (from snapshot)
  lng,                  -- Location context (from snapshot)
  city,                 -- Location context (from snapshot)
  created_at,           -- Server timestamp
  updated_at            -- Last update timestamp
)
```

**UI Polling:**
```typescript
// client/src/pages/co-pilot.tsx
GET /api/blocks/strategy/:snapshotId
- Polls every 5s while status='pending'
- Displays strategy when status='ok'
```

**Data Resolution:** Strategy shown in UI
- Strategy text: `strategies.strategy`
- Tactical summary: `strategies.strategy_for_now`
- Status: `strategies.status`

---

#### **FLOW 3: Smart Blocks (Recommendations)**

**UI Action:** User clicks "Get Smart Blocks" or auto-triggers after strategy ready

**Frontend → Backend:**
```typescript
POST /api/blocks
Headers: { X-Snapshot-Id: <uuid> }
Body: { userId: <uuid> }
```

**Backend Processing (Triad Pipeline):**
```javascript
// server/routes/blocks.js
1. Load snapshot + strategy from database
2. Call GPT-5 planner (server/lib/gpt5-tactical-planner.js)
   - Generates 6 venue recommendations with coordinates
3. Enrich with Google APIs (server/lib/venue-enrichment.js)
   - Routes API: drive times, distances
   - Places API: place_ids, business hours
4. Calculate value per minute (deterministic scoring)
5. Call Gemini validator (server/lib/gemini-enricher.js)
   - Validates JSON structure
   - Reranks venues by value_per_min
6. Persist to database (atomic transaction)
```

**Database Table 1:** `rankings`
```sql
INSERT INTO rankings (
  ranking_id,           -- UUID from client
  created_at,           -- Server timestamp
  snapshot_id,          -- FK to snapshots.snapshot_id
  correlation_id,       -- UUID for tracing
  user_id,              -- UUID or NULL
  city,                 -- Context city
  ui,                   -- JSONB: Frontend state snapshot
  model_name,           -- 'gpt-5'
  scoring_ms,           -- Deterministic scoring time
  planner_ms,           -- GPT-5 API time
  total_ms,             -- End-to-end latency
  timed_out,            -- Boolean: hit deadline?
  path_taken            -- 'triad_full' | 'fast' | 'catalog_only'
)
```

**Database Table 2:** `ranking_candidates` (6 rows per ranking)
```sql
INSERT INTO ranking_candidates (
  id,                   -- UUID (auto-generated)
  ranking_id,           -- FK to rankings.ranking_id (CASCADE DELETE)
  block_id,             -- Unique ID for this venue
  name,                 -- Venue name from GPT-5
  lat,                  -- Venue latitude
  lng,                  -- Venue longitude
  place_id,             -- Google Place ID (if matched)
  drive_time_min,       -- Google Routes API result
  straight_line_km,     -- Haversine distance
  distance_miles,       -- Actual route distance
  drive_minutes,        -- Same as drive_time_min
  est_earnings_per_ride, -- ML model output
  model_score,          -- ML confidence score
  rank,                 -- Display order (1-6)
  exploration_policy,   -- 'epsilon_greedy' | 'thompson_sampling'
  epsilon,              -- Exploration rate (0.0-1.0)
  was_forced,           -- Boolean: exploration pick?
  propensity,           -- P(show|context) for IPS weighting
  value_per_min,        -- $/min efficiency score
  value_grade,          -- 'A' | 'B' | 'C' | 'D'
  not_worth,            -- Boolean: below threshold?
  rate_per_min_used,    -- Rate used in calculation
  trip_minutes_used,    -- Avg trip duration
  wait_minutes_used,    -- Avg wait time
  features,             -- JSONB: ML feature vector
  h3_r8,                -- Venue H3 cell
  snapshot_id,          -- FK to snapshots.snapshot_id
  estimated_distance_miles, -- Initial estimate
  drive_time_minutes,   -- Final actual
  distance_source,      -- 'google_routes' | 'haversine'
  pro_tips,             -- TEXT[]: GPT-5 tactical tips
  closed_reasoning,     -- TEXT: Why recommend if closed
  staging_tips,         -- TEXT: Where to park/stage
  venue_events          -- JSONB: Perplexity event data
)
```

**Database Table 3:** `venue_catalog` (persistent venue data)
```sql
-- Upserted during enrichment if new venue discovered
INSERT INTO venue_catalog (
  venue_id,             -- UUID (auto-generated)
  place_id,             -- Google Place ID (UNIQUE)
  venue_name,           -- Name (max 500 chars)
  address,              -- Full address (max 500 chars)
  lat,                  -- Coordinates
  lng,
  category,             -- 'airport' | 'stadium' | 'nightlife' | etc.
  dayparts,             -- TEXT[]: ['morning', 'evening']
  staging_notes,        -- JSONB: { pickup_zone, tips, warnings }
  city,
  metro,
  business_hours,       -- JSONB: Google Places hours
  discovery_source,     -- 'seed' | 'ai_generated' | 'driver_submission'
  validated_at,         -- Timestamp of last verification
  suggestion_metadata,  -- JSONB: LLM reasoning if AI-generated
  last_known_status,    -- 'open' | 'closed' | 'permanently_closed' | 'unknown'
  status_checked_at,    -- Last Google Places check
  consecutive_closed_checks, -- Auto-suppress after 3
  auto_suppressed,      -- Boolean: removed from recommendations?
  suppression_reason,   -- Why suppressed
  created_at
) ON CONFLICT (place_id) DO UPDATE SET
  business_hours = EXCLUDED.business_hours,
  last_known_status = EXCLUDED.last_known_status,
  status_checked_at = EXCLUDED.status_checked_at
```

**UI Display:** Smart Blocks cards
```typescript
// client/src/pages/co-pilot.tsx
blocks.map(block => (
  <BlockCard
    name={block.name}              // ranking_candidates.name
    address={block.address}        // from venue_catalog via place_id
    distance={block.distance}      // ranking_candidates.distance_miles
    driveTime={block.driveTime}    // ranking_candidates.drive_time_min
    valuePerMin={block.value_per_min} // ranking_candidates.value_per_min
    valueGrade={block.value_grade} // ranking_candidates.value_grade
    rank={block.rank}              // ranking_candidates.rank
    category={block.category}      // from venue_catalog
    hours={block.hours}            // from venue_catalog.business_hours
    proTips={block.pro_tips}       // ranking_candidates.pro_tips[]
    stagingTips={block.staging_tips} // ranking_candidates.staging_tips
  />
))
```

---

#### **FLOW 4: User Actions**

**UI Action:** User interacts with venue card

**Frontend → Backend:**
```typescript
// client/src/pages/co-pilot.tsx
POST /api/actions
Headers: { X-Idempotency-Key: <uuid> }
Body: {
  action: 'block_clicked' | 'view' | 'dwell' | 'dismiss',
  snapshot_id: <uuid>,
  ranking_id: <uuid>,
  block_id: <string>,
  from_rank: <number>,
  dwell_ms: <number>
}
```

**Database Table:** `actions`
```sql
INSERT INTO actions (
  action_id,            -- UUID from Idempotency-Key
  created_at,           -- Server timestamp
  ranking_id,           -- FK to rankings.ranking_id (CASCADE DELETE)
  snapshot_id,          -- FK to snapshots.snapshot_id (CASCADE DELETE)
  user_id,              -- UUID or NULL
  action,               -- 'view' | 'click' | 'dwell' | 'dismiss'
  block_id,             -- Which venue (matches ranking_candidates.block_id)
  dwell_ms,             -- Time spent viewing (milliseconds)
  from_rank,            -- Position in list (1-6)
  raw                   -- JSONB: Full frontend event
)
```

**ML Training Data:** Used for counterfactual learning
- Query: `SELECT * FROM actions JOIN ranking_candidates ON actions.block_id = ranking_candidates.block_id`
- Analysis: "Given context X (snapshot), model suggested Y (ranking), user chose Z (action)"

---

#### **FLOW 5: Feedback**

**UI Action:** User clicks thumbs up/down on venue

**Frontend → Backend:**
```typescript
POST /api/feedback/venue
Body: {
  snapshot_id: <uuid>,
  ranking_id: <uuid>,
  place_id: <string>,
  sentiment: 'up' | 'down',
  comment: <string>
}
```

**Database Table:** `venue_feedback`
```sql
INSERT INTO venue_feedback (
  id,                   -- UUID (auto-generated)
  user_id,              -- UUID or NULL
  snapshot_id,          -- FK to snapshots.snapshot_id (CASCADE DELETE)
  ranking_id,           -- FK to rankings.ranking_id (CASCADE DELETE)
  place_id,             -- Google Place ID
  venue_name,           -- Venue name
  sentiment,            -- 'up' | 'down'
  comment,              -- Optional driver feedback
  created_at
) ON CONFLICT (user_id, ranking_id, place_id) DO UPDATE SET
  sentiment = EXCLUDED.sentiment,
  comment = EXCLUDED.comment
```

**Database Table Update:** `venue_metrics`
```sql
-- Triggered by feedback submission
UPDATE venue_metrics SET
  positive_feedback = positive_feedback + 1  -- if sentiment='up'
  -- OR negative_feedback = negative_feedback + 1 if sentiment='down'
WHERE venue_id = (
  SELECT venue_id FROM venue_catalog WHERE place_id = <place_id>
)
```

**UI Display:** Feedback affects future recommendations
- Reliability score: `venue_metrics.reliability_score` (Bayesian average)
- Downweight venues with high negative feedback

---

### Complete Table Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INTERACTIONS                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ snapshots (Context Capture)                                     │
│ ├─ snapshot_id (PK)                                             │
│ ├─ lat, lng, accuracy_m                                         │
│ ├─ city, state, country, timezone                               │
│ ├─ dow, hour, day_part_key                                      │
│ ├─ weather, air, airport_context (JSONB)                        │
│ └─ h3_r8 (geospatial index)                                     │
└─────────────────────────────────────────────────────────────────┘
            │                           │
            │ 1:1                       │ 1:N
            ▼                           ▼
┌───────────────────────┐    ┌──────────────────────┐
│ strategies            │    │ rankings             │
│ ├─ id (PK)            │    │ ├─ ranking_id (PK)   │
│ ├─ snapshot_id (FK)   │    │ ├─ snapshot_id (FK)  │
│ ├─ strategy           │    │ ├─ model_name        │
│ ├─ strategy_for_now   │    │ └─ total_ms          │
│ ├─ status             │    └──────────────────────┘
│ ├─ model_name         │              │
│ └─ latency_ms         │              │ 1:N
└───────────────────────┘              ▼
            │ 1:N         ┌──────────────────────────┐
            ▼             │ ranking_candidates       │
┌───────────────────────┐ │ ├─ id (PK)               │
│ strategy_feedback     │ │ ├─ ranking_id (FK)       │
│ ├─ snapshot_id (FK)   │ │ ├─ block_id              │
│ ├─ ranking_id (FK)    │ │ ├─ name, lat, lng        │
│ └─ sentiment          │ │ ├─ place_id              │
└───────────────────────┘ │ ├─ value_per_min         │
                          │ ├─ rank                  │
                          │ └─ pro_tips[]            │
                          └──────────────────────────┘
                                    │
                                    │ N:1
                                    ▼
                          ┌──────────────────────────┐
                          │ venue_catalog            │
                          │ ├─ venue_id (PK)         │
                          │ ├─ place_id (UNIQUE)     │
                          │ ├─ venue_name            │
                          │ ├─ category              │
                          │ ├─ business_hours        │
                          │ └─ last_known_status     │
                          └──────────────────────────┘
                                    │ 1:1
                                    ▼
                          ┌──────────────────────────┐
                          │ venue_metrics            │
                          │ ├─ venue_id (FK, PK)     │
                          │ ├─ times_recommended     │
                          │ ├─ times_chosen          │
                          │ ├─ positive_feedback     │
                          │ ├─ negative_feedback     │
                          │ └─ reliability_score     │
                          └──────────────────────────┘
                                    ▲
                                    │ Updates from
                          ┌──────────────────────────┐
                          │ venue_feedback           │
                          │ ├─ snapshot_id (FK)      │
                          │ ├─ ranking_id (FK)       │
                          │ ├─ place_id              │
                          │ └─ sentiment             │
                          └──────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ actions (Behavior Tracking)                                      │
│ ├─ snapshot_id (FK)                                              │
│ ├─ ranking_id (FK)                                               │
│ ├─ block_id                                                      │
│ ├─ action ('view' | 'click' | 'dwell' | 'dismiss')               │
│ └─ from_rank                                                     │
└──────────────────────────────────────────────────────────────────┘
```

---

### Data Retention & Cascade Policies

**30-Day Rolling Window:**
- `snapshots` - Oldest records deleted after 30 days
- `strategies` - CASCADE DELETE with snapshots
- `rankings` - Orphaned after snapshots deleted (manual cleanup)
- `ranking_candidates` - CASCADE DELETE with rankings
- `actions` - CASCADE DELETE with snapshots
- `venue_feedback` - CASCADE DELETE with snapshots
- `strategy_feedback` - CASCADE DELETE with snapshots

**Permanent Tables:**
- `venue_catalog` - Never deleted (historical venue database)
- `venue_metrics` - Accumulates over time (never deleted)
- `places_cache` - 90-day TTL, then refresh

---

## 🤖 AI Model Strategy & Risk Management

### Current Production Models

| Role | Model | Provider | Timeout | Reasoning Mode |
|------|-------|----------|---------|----------------|
| Strategist | GPT-5 | OpenAI | 120s | reasoning_effort=high |
| Planner | GPT-5 | OpenAI | 180s | reasoning_effort=high |
| Validator | Gemini 2.5 Pro | Google | 60s | temperature=0.1 |

### Model Update Protocol

**Monthly Verification (First Monday of Each Month):**
1. Run `tools/research/model-discovery.mjs`
2. Check for model deprecation notices
3. Update `MODEL.md` with findings
4. If model deprecated: Update `.env` and test in staging
5. Document change in `ARCHITECTURE.md` Decision Log

**Deprecated Models (Do Not Use):**
- ~~`gpt-4o`~~ - Replaced by GPT-5 (Oct 2025)
- ~~`claude-3-5-sonnet-20241022`~~ - Replaced by GPT-5 in production flow (Oct 2025)
- ~~`gemini-1.5-pro`~~ - Replaced by Gemini 2.5 Pro (Oct 2025)

### Fallback Strategy

**Production Recommendation Flow:** NO FALLBACKS
- Single-path only to preserve ML data integrity
- If GPT-5 fails: Return error, don't switch models
- If Gemini fails: Return partial results with warning

**Agent Override (Workspace Operations):** Fallback chain enabled
- Primary: GPT-5
- Fallback 1: Claude Sonnet 4.5
- Fallback 2: Gemini 2.5 Pro
- Reason: Operational resilience more important than ML consistency

---

## 📂 Project File Structure

**Key Directories:**

```
vecto-pilot/
├── client/src/           # React frontend
│   ├── pages/            # Route components
│   │   └── co-pilot.tsx  # Main recommendation interface
│   ├── contexts/         # Global state
│   │   └── location-context-clean.tsx  # GPS + override coords
│   └── lib/
│       ├── snapshot.ts   # Snapshot creation utility
│       └── queryClient.ts # TanStack Query setup
├── server/
│   ├── routes/           # Express route handlers
│   │   ├── location.js   # GPS + enrichment endpoints
│   │   ├── blocks.js     # Triad pipeline orchestration
│   │   ├── actions.js    # User interaction tracking
│   │   └── feedback.js   # Thumbs up/down endpoints
│   ├── lib/              # Core business logic
│   │   ├── strategy-generator.js      # GPT-5 strategist
│   │   ├── gpt5-tactical-planner.js   # GPT-5 planner
│   │   ├── gemini-enricher.js         # Gemini validator
│   │   ├── venue-enrichment.js        # Google APIs integration
│   │   ├── persist-ranking.js         # Atomic DB writes
│   │   └── faa-asws.js                # Airport delay data
│   └── db/
│       ├── client.js     # PostgreSQL connection pool
│       ├── pool.js       # Shared pool configuration
│       └── drizzle.js    # Drizzle ORM instance
├── shared/
│   ├── schema.js         # Database schema (Drizzle)
│   └── types/            # TypeScript types
│       ├── snapshot.ts   # SnapshotV1 format
│       └── location.ts   # Coord type
├── docs/
│   ├── ARCHITECTURE.md   # This document
│   └── ISSUES.md         # Known issues + root causes
└── gateway-server.js     # Mono-mode unified server
```

---

## 🔐 Environment Variables Reference

### Critical Variables (Must Be Set)

```bash
# Database (Neon PostgreSQL)
DATABASE_URL=postgresql://user:pass@host:5432/dbname?sslmode=require

# AI Models
OPENAI_API_KEY=sk-proj-...              # GPT-5 strategist + planner
GOOGLE_GENERATIVE_AI_API_KEY=AIza...    # Gemini 2.5 Pro validator

# Google Maps Platform (Geocoding, Places, Routes, Timezone)
GOOGLE_MAPS_API_KEY=AIza...

# Weather & Air Quality
OPENWEATHER_API_KEY=abc123...
GOOGLEAQ_API_KEY=AIza...                # Can reuse GOOGLE_MAPS_API_KEY

# Model Configuration
OPENAI_MODEL=gpt-5
PLANNER_DEADLINE_MS=180000              # 3 minutes for GPT-5 planner
GPT5_REASONING_EFFORT=high
GEMINI_MODEL=gemini-2.5-pro-latest
VALIDATOR_DEADLINE_MS=60000             # 1 minute for Gemini
```

### Optional Variables

```bash
# Perplexity (Local news research)
PERPLEXITY_API_KEY=pplx-...
PERPLEXITY_MODEL=sonar-pro

# FAA Airport Data (requires credentials)
FAA_ASWS_CLIENT_ID=your_client_id
FAA_ASWS_CLIENT_SECRET=your_secret

# Server Configuration
PORT=5174                               # Gateway server port (must be 5174 for Replit)
NODE_ENV=production                     # development | production

# Value Per Minute Defaults
VALUE_BASE_RATE_PER_MIN=1.00
VALUE_DEFAULT_TRIP_MIN=15
VALUE_DEFAULT_WAIT_MIN=0
VALUE_MIN_ACCEPTABLE_PER_MIN=0.50
```

---

## 🌐 API Endpoint Reference

### Base URL
- **Development:** `http://localhost:5174/api`
- **Production:** `https://[your-repl].replit.app/api`

### Location & Context

#### `POST /api/location/snapshot`
Save complete context snapshot for ML training.

**Request:**
```json
{
  "snapshot_id": "uuid",
  "coord": { "lat": 32.7767, "lng": -96.7970, "accuracyMeters": 97, "source": "gps" },
  "resolved": { "city": "Dallas", "state": "TX", "timezone": "America/Chicago" },
  "time_context": { "dow": 0, "hour": 11, "day_part_key": "morning" },
  "weather": { "tempF": 75, "conditions": "clear" },
  "air": { "aqi": 71, "category": "Moderate" }
}
```

**Response (201):**
```json
{
  "snapshot_id": "uuid",
  "h3_r8": "8823674bfffffff",
  "airport_context": { "airport_code": "DFW", "delay_minutes": 0 }
}
```

#### `GET /api/blocks/strategy/:snapshotId`
Get GPT-5 strategic overview (polling endpoint).

**Response (200 - Ready):**
```json
{
  "status": "ok",
  "hasStrategy": true,
  "strategy": "Today is Saturday, 10/26/2025 at 11:28 AM in Dallas...",
  "latency_ms": 15432,
  "tokens": 847
}
```

**Response (202 - Pending):**
```json
{
  "status": "pending",
  "hasStrategy": false,
  "attempt": 2
}
```

### Recommendations

#### `POST /api/blocks`
Get AI-powered venue recommendations (Triad pipeline).

**Headers:**
```
X-Snapshot-Id: uuid
```

**Request:**
```json
{
  "userId": "uuid"
}
```

**Response (200):**
```json
{
  "strategy": "Strategic overview text...",
  "blocks": [
    {
      "name": "Legacy West",
      "address": "7401 Windrose Ave, Plano, TX",
      "coordinates": { "lat": 33.0795, "lng": -96.8266 },
      "distance_miles": 6.3,
      "driveTimeMinutes": 14,
      "value_per_min": 0.52,
      "value_grade": "C",
      "rank": 1,
      "category": "shopping",
      "businessHours": "Open until 9:00 PM",
      "proTips": ["Park at north entrance", "Use valet pickup zone"]
    }
  ],
  "ranking_id": "uuid",
  "metadata": {
    "totalBlocks": 6,
    "processingTimeMs": 182543,
    "modelRoute": "gpt-5-triad"
  }
}
```

### User Tracking

#### `POST /api/actions`
Log user interaction with venue card.

**Headers:**
```
X-Idempotency-Key: uuid
```

**Request:**
```json
{
  "action": "block_clicked",
  "snapshot_id": "uuid",
  "ranking_id": "uuid",
  "block_id": "ChIJ...",
  "from_rank": 1,
  "dwell_ms": 5432
}
```

**Response (201):**
```json
{
  "success": true,
  "action_id": "uuid"
}
```

#### `POST /api/feedback/venue`
Submit thumbs up/down for venue.

**Request:**
```json
{
  "snapshot_id": "uuid",
  "ranking_id": "uuid",
  "place_id": "ChIJ...",
  "venue_name": "Legacy West",
  "sentiment": "up",
  "comment": "Great lunch spot"
}
```

**Response (200):**
```json
{
  "ok": true
}
```

---

## ⚛️ Frontend Architecture

### React Component Hierarchy

```
<App>                                    # Root (Wouter routing)
  <LocationProvider>                     # GPS + override coords
    <QueryClientProvider>                # TanStack Query
      <Toaster />                        # Toast notifications
      
      <Route path="/co-pilot">
        <CoPilotPage>
          <GlobalHeader>                 # GPS status, city selector
            {overrideCoords ? (
              <Badge>Manual: {city}</Badge>
            ) : (
              <Badge>GPS: {city}</Badge>
            )}
          </GlobalHeader>
          
          <StrategyCard                  # GPT-5 strategic overview
            strategy={strategyQuery.data}
            isLoading={strategyQuery.isLoading}
          />
          
          {blocksQuery.data?.blocks.map(block => (
            <BlockCard                   # Venue recommendation
              key={block.placeId}
              venue={block}
              onNavigate={handleNavigate}
              onFeedback={handleFeedback}
            />
          ))}
        </CoPilotPage>
      </Route>
    </QueryClientProvider>
  </LocationProvider>
</App>
```

### State Management

**Location Context (Shared State):**
```typescript
// client/src/contexts/location-context-clean.tsx
interface LocationContextValue {
  currentCoords: GeolocationCoordinates | null;  // GPS coords
  overrideCoords: OverrideCoordinates | null;    // Manual city search
  locationSessionId: number;                     // Invalidation key
  refreshGPS: () => Promise<void>;
  setOverrideCoords: (coords) => void;
}
```

**TanStack Query Keys:**
```typescript
// Strategy polling (light - 5s intervals)
['/api/blocks/strategy', snapshotId]

// Blocks query (gated on strategy ready)
['/api/blocks', coords.lat, coords.lng, sessionId, snapshotId]
```

---

## 🧪 Testing Strategy

### Test Coverage

**Unit Tests:**
- `shared/schema.js` - Zod schema validation
- `server/lib/scoring-engine.js` - Value per minute calculations
- `server/lib/venue-enrichment.js` - Google API integration

**Integration Tests:**
- `tests/triad/test-pipeline.js` - Full GPT-5 → Gemini flow
- `tests/scripts/smoke-test.js` - API endpoint health checks
- `tests/phase-c-infrastructure.js` - Database connectivity

**E2E Tests:**
- `test-global-scenarios.js` - Complete user journeys
  - GPS acquisition
  - Strategy generation
  - Blocks request
  - User interaction logging

### Running Tests

```bash
# All tests
npm run test

# Smoke test (quick validation)
npm run test:smoke

# Infrastructure only
npm run test:infra

# Global scenarios (slow - ~5 minutes)
npm run test:global
```

---

## ⚠️ Known Risks & Mitigations

### 1. Neon Database Auto-Sleep (Free Tier)

**Risk:** Database sleeps after 5 minutes of inactivity, causing connection terminations.

**Current Status:** ✅ MITIGATED via shared connection pool
- TCP keepalive enabled (30s heartbeats)
- 2-minute idle timeout (before 5-minute sleep)
- Automatic reconnection on connection errors

**Errors You Might See:**
```
error: terminating connection due to administrator command
```

**Mitigation:** Upgrade to Neon Launch Plan ($19/month) to eliminate auto-sleep.

### 2. GPT-5 Timeout Risk

**Risk:** GPT-5 with reasoning_effort=high can take 90-120s, approaching timeout.

**Current Mitigation:**
- 180s timeout for planner (3 minutes)
- 120s timeout for strategist (2 minutes)
- Retry logic with exponential backoff (6 attempts)

**Future Improvement:** Implement streaming responses for real-time feedback.

### 3. Google API Quota Limits

**Risk:** Exceeding daily quota for Places/Routes/Geocoding APIs.

**Current Mitigation:**
- Circuit breakers with automatic backoff
- Places cache (90-day TTL) to reduce duplicate lookups
- Fail-fast error messages (don't fallback to stale data)

**Monitoring:** Track daily API usage in Google Cloud Console.

### 4. Foreign Key Replication Lag

**Risk:** Neon distributed database has replication lag, causing FK constraint errors.

**Current Mitigation:**
- Retry logic with exponential backoff (up to 8 attempts, 10s max delay)
- Graceful degradation: log action without ranking_id if retry exhausted
- Transaction isolation to prevent partial data writes

---

## 🛡️ AI Development Guardrails

### Documentation-First Development

**Required Before Any AI-Assisted Code Change:**
1. Update `ARCHITECTURE.md` with proposed change
2. Document why existing pattern doesn't work
3. Get approval from human architect
4. Implement change
5. Update decision log

### Root-Cause Protocol

**When Issues Arise:**
1. **Identify invariant violated** (e.g., model ID mismatch, incomplete snapshot)
2. **Produce minimal failing trace** (request ID, snapshot hash, model, elapsed)
3. **Patch at source** with test and documentation
4. **Update ARCHITECTURE.md** Decision Log with fix

**DO NOT:**
- Apply band-aid fixes without understanding root cause
- Add workarounds in multiple files
- Change core patterns without documentation update

### AI Memory Enhancement

**Context Files Loaded on Every Request:**
- `ARCHITECTURE.md` - System constraints and patterns
- `ISSUES.md` - Known problems and fixes
- `shared/schema.js` - Database schema
- `replit.md` - Replit-specific configuration

**Strategy:** AI assistant references these files to maintain consistency across sessions.

---

## 🚀 Deployment & Infrastructure

### Replit Deployment Configuration

**Workflow:** `Run App` (mono-mode)
```bash
set -a && source mono-mode.env && set +a && node gateway-server.js
```

**Port Configuration:**
- Public port: 5174 (Replit requirement)
- Health check ports: 80, 443 (auto-forwarded by Replit)

**Environment Loading:**
```bash
# mono-mode.env loaded automatically
DATABASE_URL=...
OPENAI_API_KEY=...
GOOGLE_MAPS_API_KEY=...
```

### Database Migration Strategy

**Current Approach:** Direct schema sync (no migrations)
```bash
npm run db:push
```

**Migration Files (Manual):**
- `migrations/001_init.sql` - Initial schema
- `migrations/manual/20251007_fk_cascade_fix.sql` - Foreign key fixes

**Future:** Implement versioned migrations with Drizzle Kit.

### Monitoring & Observability

**Health Endpoints:**
- `GET /health` - Overall system status
- `GET /healthz` - Kubernetes-style probe

**Logging:**
- Structured JSON logs to stdout
- Request correlation IDs
- Model latency tracking

**Metrics (Future):**
- Prometheus endpoint at `/metrics`
- Grafana dashboard for visualization

---

## 📝 Decision Log

### October 2025

**Oct 26:** Consolidated ARCHITECTURE.md with complete workflow documentation
- Added end-to-end user journey with timing breakdown
- Documented complete database schema with UI-to-DB mappings
- Added detailed error handling at each workflow stage

**Oct 25:** Switched from Claude to GPT-5 for strategist role
- Reason: GPT-5 reasoning mode provides better strategic analysis
- Impact: Single model for both strategist and planner (cost savings)
- Validation: Maintained Gemini 2.5 Pro for final ranking

**Oct 20:** Implemented connection pooling for Neon database
- Reason: Mitigate auto-sleep on free tier
- Configuration: max=10, min=2, keepAlive=true, idleTimeout=120s
- Result: 95% reduction in connection termination errors

**Oct 15:** Disabled React.StrictMode in production
- Reason: Duplicate API calls causing double charges
- Impact: Only affects development mode now
- Alternative: Use React DevTools for debugging

**Oct 10:** Implemented snapshot gating for blocks query
- Reason: Prevent "Unknown city" errors from race conditions
- Flow: Wait for snapshot → wait for strategy → enable blocks
- Result: Zero race condition errors in production

**Oct 5:** Added value per minute ranking algorithm
- Reason: Pure distance-based ranking doesn't account for wait times
- Formula: `(rate * surge * trip_time) / (drive_time + wait_time + trip_time)`
- Grades: A (>$1.00/min), B (>$0.75), C (>$0.50), D (<$0.50)

---

## 🎓 AI-Assisted Development Lessons Learned

### What Worked

1. **Documentation as AI Memory:** Maintaining comprehensive architecture docs enabled AI to make consistent decisions across sessions.

2. **Strict Invariants:** Defining non-negotiables (zero hardcoding, single-path triad, complete snapshots) prevented AI from suggesting shortcuts.

3. **Root-Cause Protocol:** Forcing AI to identify violated invariants eliminated endless debugging cycles.

4. **Decision Log:** Recording every architectural change created institutional memory for the AI.

### What Didn't Work

1. ~~**Cheap-First Hours Strategy:**~~ AI aggressively optimized for API cost, suggesting stale hours instead of real-time validation.

2. ~~**Global JSON Parsing:**~~ AI suggested centralized middleware, causing client abort errors on large payloads.

3. ~~**Fallback Chains in Production:**~~ AI wanted resilience via model fallbacks, breaking ML data integrity.

4. ~~**Hardcoded Model Names:**~~ AI frequently suggested inline model IDs instead of environment variables.

### Best Practices for AI Development

**DO:**
- ✅ Document constraints before coding
- ✅ Use strikethrough for deletions (preserve history)
- ✅ Enforce environment-based configuration
- ✅ Implement root-cause analysis on every bug
- ✅ Update architecture doc with every change

**DON'T:**
- ❌ Accept "quick fixes" without understanding
- ❌ Allow hardcoded values (models, cities, timeouts)
- ❌ Skip documentation updates
- ❌ Implement features without constraint validation
- ❌ Delete old code (use strikethrough instead)

---

## 📚 Additional Resources

- **Model Research:** `tools/research/model-discovery.mjs` - Monthly model verification
- **Database Schema:** `shared/schema.js` - Single source of truth for DB structure
- **API Examples:** `tools/testing/test-blocks-examples.txt` - Sample requests/responses
- **Issue Tracking:** `docs/ISSUES.md` - Known problems with root cause analysis

---

**Document Version:** 3.0  
**Last Comprehensive Update:** October 26, 2025  
**Next Review:** November 1, 2025 (monthly model verification)
