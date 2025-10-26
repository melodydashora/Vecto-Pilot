# Vecto Pilot™ - Architecture & Constraints Reference

---

**Last Updated:** 2025-10-26 18:00 UTC  
**Database Status:** ❌ CRITICAL - `snapshots` table missing  
**Workflow Status:** ✅ Running on port 5000 (mono-mode)  
**System State:** 🔴 BROKEN - Cannot persist snapshots

---

## 🗄️ **DATABASE SCHEMA & COMPLETE DATA FLOW**

### Complete UI-to-Backend-to-Database Mapping

This section provides a comprehensive view of how data flows from the user interface through the backend to the database tables, with explicit field mappings at each stage.

---

### **1. Location Snapshot Creation Flow**

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

### **2. Strategy Generation Flow**

**Backend Trigger:** Snapshot creation with complete data

**Background Job:**
```javascript
// server/lib/strategy-generator.js
- Enqueued via job-queue.js
- Calls Claude Sonnet 4.5 API
- 120-word strategic overview
```

**Database Table:** `strategies`
```sql
INSERT INTO strategies (
  id,                   -- UUID (auto-generated)
  snapshot_id,          -- FK to snapshots.snapshot_id (UNIQUE)
  correlation_id,       -- UUID for request tracing
  strategy,             -- Claude's strategic text
  strategy_for_now,     -- Tactical summary (unlimited length)
  status,               -- 'pending' → 'ok' | 'failed'
  error_code,           -- HTTP status if failed
  error_message,        -- Error details if failed
  attempt,              -- Retry counter
  next_retry_at,        -- Timestamp for next retry
  latency_ms,           -- Claude API response time
  tokens,               -- Token count for billing
  model_name,           -- 'claude-sonnet-4-5-20250929'
  model_params,         -- JSONB: { temperature, max_tokens }
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
- Polls every 2s while status='pending'
- Displays strategy when status='ok'
```

**Data Resolution:** Strategy shown in UI
- Strategy text: `strategies.strategy`
- Tactical summary: `strategies.strategy_for_now`
- Status: `strategies.status`

---

### **3. Smart Blocks (Recommendations) Flow**

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
5. Call Gemini validator (server/lib/validator-gemini.js)
   - Validates JSON structure
   - Reranks venues by quality
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
  value_grade,          -- 'excellent' | 'good' | 'fair' | 'poor'
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
  ai_estimated_hours,   -- Legacy field (deprecated)
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

### **4. User Actions Flow**

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

### **5. Feedback Flow**

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

### **6. Strategy Feedback Flow**

**UI Action:** User votes on strategy quality

**Frontend → Backend:**
```typescript
POST /api/feedback/strategy
Body: {
  snapshot_id: <uuid>,
  ranking_id: <uuid>,
  sentiment: 'up' | 'down',
  comment: <string>
}
```

**Database Table:** `strategy_feedback`
```sql
INSERT INTO strategy_feedback (
  id,                   -- UUID (auto-generated)
  user_id,              -- UUID or NULL
  snapshot_id,          -- FK to snapshots.snapshot_id (CASCADE DELETE)
  ranking_id,           -- FK to rankings.ranking_id (CASCADE DELETE)
  sentiment,            -- 'up' | 'down'
  comment,              -- Why good/bad
  created_at
) ON CONFLICT (user_id, ranking_id) DO UPDATE SET
  sentiment = EXCLUDED.sentiment,
  comment = EXCLUDED.comment
```

**ML Training:** Strategy effectiveness analysis
- Correlate strategy feedback with venue selection success
- Compare Claude vs. GPT-5 vs. Gemini strategy quality

---

### **Complete Table Relationship Diagram**

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

**Data Retention & Cascade Policies**

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

### **Deprecated Architecture Patterns**

~~**Old Approach (Pre-Oct 2025):**~~
- ~~Hard-coded model names in code~~ → Now uses environment variables
- ~~Global JSON body parsing~~ → Now per-route parsing
- ~~8-second total budget~~ → Now 90 seconds (CLAUDE_TIMEOUT_MS + GPT5_TIMEOUT_MS + GEMINI_TIMEOUT_MS)
- ~~Router V2 with fallback chain~~ → Now single-path Triad only
- ~~React.StrictMode in production~~ → Disabled to prevent duplicate API calls
- ~~Manual city overrides in production~~ → Blocked via production gate
- ~~"Cheap-first" hours strategy~~ → Risk-gated validation for closure-sensitive venues
- ~~Temperature-based GPT-5 config~~ → Now uses `reasoning_effort` parameter

---

## 📋 **PURPOSE OF THIS DOCUMENT**

Single source of truth for: