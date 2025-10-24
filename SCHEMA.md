# Vecto Pilot™ - Complete Database Schema Documentation

**Last Updated:** October 24, 2025  
**Database:** PostgreSQL (Neon-backed)  
**ORM:** Drizzle ORM  
**Migration Strategy:** `npm run db:push` (direct schema sync, no manual migrations)

---

## Table of Contents

1. [Workflow Overview](#workflow-overview)
2. [Core ML Pipeline Tables](#core-ml-pipeline-tables)
3. [Venue & Catalog Tables](#venue--catalog-tables)
4. [Feedback & Learning Tables](#feedback--learning-tables)
5. [Memory & Context Tables](#memory--context-tables)
6. [Infrastructure Tables](#infrastructure-tables)
7. [Data Flow Diagrams](#data-flow-diagrams)
8. [Indexes & Performance](#indexes--performance)
9. [Retention Policies](#retention-policies)

---

## Workflow Overview

### The Complete Data Journey

```
USER GPS UPDATE
    ↓
[1] snapshots ← GPS + Weather + Time context
    ↓ (triggers strategy generation)
[2] strategies ← Claude Sonnet 4.5 strategic analysis
    ↓ (triggers tactical planning)
[3] rankings ← GPT-5 venue recommendations
    ↓
[4] ranking_candidates ← Individual venue details + scoring
    ↓ (Google APIs enrichment)
[5] venue_catalog ← Persistent venue data
[6] venue_metrics ← Performance tracking
    ↓ (user interaction)
[7] actions ← Clicks, views, dwells
[8] venue_feedback ← Thumbs up/down per venue
[9] strategy_feedback ← Thumbs up/down for AI strategy
    ↓
[ML TRAINING DATA] ← Continuous learning loop
```

---

## Core ML Pipeline Tables

### 1. `snapshots` - Context Snapshot Records

**Purpose:** Stores complete driver context at a point in time - the foundation of all ML predictions.

**Schema:**
```sql
CREATE TABLE snapshots (
  -- Identity
  snapshot_id UUID PRIMARY KEY,                    -- Client-generated UUID
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,    -- Server timestamp
  user_id UUID,                                    -- Optional user account (NULL for anonymous)
  device_id UUID NOT NULL,                         -- Device fingerprint
  session_id UUID NOT NULL,                        -- Browser session
  
  -- GPS & Location
  lat DOUBLE PRECISION NOT NULL,                   -- WGS84 latitude
  lng DOUBLE PRECISION NOT NULL,                   -- WGS84 longitude
  accuracy_m DOUBLE PRECISION,                     -- GPS accuracy in meters
  coord_source TEXT NOT NULL,                      -- 'browser_gps' | 'wifi' | 'cell'
  city TEXT,                                       -- Geocoded city
  state TEXT,                                      -- Geocoded state/province
  country TEXT,                                    -- Geocoded country
  formatted_address TEXT,                          -- Full address string
  timezone TEXT,                                   -- IANA timezone (e.g., 'America/Los_Angeles')
  
  -- Time Context (models infer patterns from raw values)
  local_iso TIMESTAMP WITHOUT TIME ZONE,           -- Local time (no TZ)
  dow INTEGER,                                     -- Day of week (0=Sun, 6=Sat)
  hour INTEGER,                                    -- Hour 0-23
  day_part_key TEXT,                               -- 'morning' | 'afternoon' | 'evening' | etc.
  
  -- Geospatial Index
  h3_r8 TEXT,                                      -- H3 resolution 8 cell (~0.7km²)
  
  -- External API Context (JSONB for flexibility)
  weather JSONB,                                   -- {tempF, conditions, humidity, windSpeed}
  air JSONB,                                       -- {aqi, category}
  airport_context JSONB,                           -- {airport_code, distance_miles, delay_minutes}
  
  -- Device & Permissions
  device JSONB,                                    -- {platform, userAgent, screenRes}
  permissions JSONB,                               -- {geolocation, notifications}
  extras JSONB,                                    -- Additional context
  
  -- Strategy Trigger Tracking
  last_strategy_day_part TEXT DEFAULT NULL,        -- Last day_part when strategy was generated
  trigger_reason TEXT DEFAULT NULL                 -- 'initial_load' | 'day_part_change' | 'coord_delta'
);
```

**When Data Flows In:**
- **Trigger:** User opens app, refreshes location, or auto-refresh timer fires (every 5 min)
- **Source:** Client POST to `/api/location/snapshot`
- **Frequency:** Every location change >2 miles OR day_part transition
- **Validation:** Requires lat, lng, city (or formatted_address), timezone

**Why Each Field:**
- **GPS fields:** Core input for distance calculations and H3 indexing
- **Time fields:** Models learn time-of-day patterns (rush hour, late night, etc.)
- **dow:** Models infer weekday vs. weekend demand WITHOUT explicit flags
- **weather/air:** Correlate with demand (rain = more rides, poor AQI = fewer)
- **airport_context:** High-value opportunity detection (flight delays)
- **h3_r8:** Enables geospatial queries and hexagonal clustering
- **trigger_reason:** ML feature for understanding context switches

**Data Retention:** 365 days (configurable, supports rollback to any point)

---

### 2. `strategies` - AI Strategic Analysis

**Purpose:** Stores Claude Sonnet 4.5's strategic overview for each snapshot.

**Schema:**
```sql
CREATE TABLE strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL UNIQUE                 -- 1:1 with snapshots
    REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
  correlation_id UUID,                             -- Request tracing
  
  -- Strategy Content
  strategy TEXT,                                   -- Strategic overview (120 words max)
  strategy_for_now TEXT,                           -- Tactical summary from GPT-5
  
  -- Execution Status
  status TEXT NOT NULL DEFAULT 'pending',          -- 'pending' | 'ok' | 'failed'
  error_code INTEGER,                              -- HTTP error code if failed
  error_message TEXT,                              -- Error details
  attempt INTEGER NOT NULL DEFAULT 1,              -- Retry counter
  next_retry_at TIMESTAMP WITH TIME ZONE,          -- When to retry if failed
  
  -- Performance Metrics
  latency_ms INTEGER,                              -- Claude API response time
  tokens INTEGER,                                  -- Token usage for billing/analysis
  
  -- Model Versioning (A/B testing, Issue #34)
  model_name TEXT,                                 -- 'claude-sonnet-4-5-20250514'
  model_params JSONB,                              -- {temperature, max_tokens, ...}
  prompt_version TEXT,                             -- 'v2.3' for prompt iteration tracking
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

**When Data Flows In:**
- **Trigger:** After snapshot is saved AND passes completeness validation
- **Decision:** `detectStrategyTrigger()` checks if update needed (coord delta >2mi OR day_part changed)
- **Source:** `generateStrategyForSnapshot()` → Claude API
- **Status Flow:** 
  1. `pending` inserted immediately
  2. Claude API call starts
  3. `ok` on success (with strategy text) OR `failed` (with error)

**Why Each Field:**
- **snapshot_id UNIQUE:** Enforces 1:1 relationship - each snapshot gets exactly one strategy
- **status:** Enables polling (`GET /api/blocks/strategy/:snapshotId`)
- **attempt + next_retry_at:** Exponential backoff on transient failures
- **model_name/params/prompt_version:** A/B testing different models and prompts
- **latency_ms + tokens:** Cost analysis and performance monitoring

**Data Retention:** Same as snapshots (365 days), CASCADE delete

---

### 3. `rankings` - Recommendation Sets

**Purpose:** Stores each complete set of venue recommendations (the "smart blocks").

**Schema:**
```sql
CREATE TABLE rankings (
  ranking_id UUID PRIMARY KEY,                     -- Client-generated
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  snapshot_id UUID REFERENCES snapshots(snapshot_id),
  correlation_id UUID,                             -- Request tracing
  user_id UUID,                                    -- Optional user
  city TEXT,                                       -- City context
  
  -- UI State (for reproducibility)
  ui JSONB,                                        -- Frontend state snapshot
  
  -- Model Attribution
  model_name TEXT NOT NULL,                        -- 'gpt-5' | 'gemini-2.5-pro'
  
  -- Performance Metrics
  scoring_ms INTEGER,                              -- Deterministic scoring time
  planner_ms INTEGER,                              -- GPT-5 planning time
  total_ms INTEGER,                                -- End-to-end latency
  timed_out BOOLEAN DEFAULT FALSE,                 -- Did we hit deadline?
  
  -- Workflow Trace
  path_taken TEXT                                  -- 'fast' | 'triad_full' | 'catalog_only'
);
```

**When Data Flows In:**
- **Trigger:** User polls `/api/blocks/fast` or `/api/blocks/full/:snapshotId`
- **Source:** After GPT-5 planner + Gemini validator complete
- **Frequency:** Once per strategy generation (unless user refreshes)

**Why Each Field:**
- **snapshot_id:** Links recommendations to context (for counterfactual learning)
- **model_name:** Track which AI generated these (A/B testing)
- **scoring_ms/planner_ms/total_ms:** SLA monitoring (<7s target for fast path)
- **timed_out:** Flag for degraded experience (retry logic)
- **path_taken:** 'fast' uses catalog only, 'triad_full' uses Claude→GPT-5→Gemini

**Data Retention:** 365 days (ML training data)

---

### 4. `ranking_candidates` - Individual Venue Recommendations

**Purpose:** Stores each venue within a ranking, with all scoring and feature data.

**Schema:**
```sql
CREATE TABLE ranking_candidates (
  id UUID PRIMARY KEY,
  ranking_id UUID NOT NULL 
    REFERENCES rankings(ranking_id) ON DELETE CASCADE,
  
  -- Venue Identity
  block_id TEXT NOT NULL,                          -- Unique ID for this candidate
  name TEXT NOT NULL,                              -- Venue name
  lat DOUBLE PRECISION NOT NULL,                   -- Venue coordinates
  lng DOUBLE PRECISION NOT NULL,
  place_id TEXT,                                   -- Google Place ID (if matched)
  
  -- Distance & Time
  drive_time_min INTEGER,                          -- Google Routes API drive time
  straight_line_km DOUBLE PRECISION,               -- Haversine distance
  distance_miles DOUBLE PRECISION,                 -- Actual route distance
  drive_minutes INTEGER,                           -- Duplicate of drive_time_min
  
  -- Scoring & Ranking
  est_earnings_per_ride DOUBLE PRECISION,          -- Estimated $/ride
  model_score DOUBLE PRECISION,                    -- ML model output
  rank INTEGER NOT NULL,                           -- Display order (1-based)
  
  -- Exploration Policy (for counterfactual learning)
  exploration_policy TEXT NOT NULL,                -- 'epsilon_greedy' | 'thompson_sampling'
  epsilon DOUBLE PRECISION,                        -- Exploration rate
  was_forced BOOLEAN,                              -- Was this an exploration pick?
  propensity DOUBLE PRECISION,                     -- P(show|context) for IPS weighting
  
  -- Value Per Minute (VPM) Metrics
  value_per_min DOUBLE PRECISION,                  -- $/min efficiency score
  value_grade TEXT,                                -- 'excellent' | 'good' | 'fair' | 'poor'
  not_worth BOOLEAN,                               -- Below minimum threshold?
  rate_per_min_used DOUBLE PRECISION,              -- Rate used in calculation
  trip_minutes_used INTEGER,                       -- Avg trip duration
  wait_minutes_used INTEGER,                       -- Avg wait time
  
  -- Feature Vector (for ML)
  features JSONB,                                  -- {distance, time_of_day, weather, ...}
  h3_r8 TEXT,                                      -- Venue H3 cell
  
  -- Workflow Trace
  snapshot_id UUID,                                -- Context snapshot
  estimated_distance_miles DOUBLE PRECISION,       -- Initial estimate
  drive_time_minutes INTEGER,                      -- Final actual
  distance_source TEXT,                            -- 'google_routes' | 'haversine'
  
  -- Performance Indexes (Issue #28)
  INDEX idx_ranking_candidates_ranking_id (ranking_id),
  INDEX idx_ranking_candidates_snapshot_id (snapshot_id)
);
```

**When Data Flows In:**
- **Trigger:** During ranking creation
- **Source:** 
  1. GPT-5 generates venue names + coords
  2. Google APIs enrich with distances + place_ids
  3. Deterministic scorer calculates VPM
  4. Gemini reranks and validates
- **Insert:** Atomic transaction with ranking parent

**Why Each Field:**
- **exploration_policy fields:** Enable counterfactual learning (what if we showed different venues?)
- **propensity:** Inverse propensity score (IPS) weighting for unbiased learning
- **value_per_min:** Core decision metric ($/min > raw $ amount)
- **features JSONB:** Flexible ML feature storage
- **was_forced:** Distinguish exploration (random) from exploitation (best)

**Critical Indexes:**
- `ranking_id`: Fast lookup of all candidates in a ranking
- `snapshot_id`: Join back to context for offline ML training

**Data Retention:** 365 days (CASCADE with ranking)

---

## Venue & Catalog Tables

### 5. `venue_catalog` - Persistent Venue Master Data

**Purpose:** Single source of truth for venue metadata. Survives across rankings.

**Schema:**
```sql
CREATE TABLE venue_catalog (
  venue_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id TEXT UNIQUE,                            -- Google Place ID (unique)
  
  -- Core Identity
  venue_name VARCHAR(500) NOT NULL,                -- Max 500 chars
  address VARCHAR(500) NOT NULL,                   -- Full address
  lat DOUBLE PRECISION,                            -- Coordinates
  lng DOUBLE PRECISION,
  
  -- Classification
  category TEXT NOT NULL,                          -- 'airport' | 'stadium' | 'nightlife' | ...
  dayparts TEXT[],                                 -- ['morning', 'evening'] - best times
  city TEXT,                                       -- City
  metro TEXT,                                      -- Metro area
  
  -- Business Hours
  ai_estimated_hours TEXT,                         -- AI-guessed hours (legacy)
  business_hours JSONB,                            -- Google Places hours
  
  -- Staging Notes (for drivers)
  staging_notes JSONB,                             -- {pickup_zone, tips, warnings}
  
  -- Discovery & Validation
  discovery_source TEXT NOT NULL DEFAULT 'seed',   -- 'seed' | 'ai_generated' | 'driver_submission'
  validated_at TIMESTAMP WITH TIME ZONE,           -- When last verified
  suggestion_metadata JSONB,                       -- LLM reasoning if AI-generated
  
  -- Business Status Tracking (Issue #32)
  last_known_status TEXT DEFAULT 'unknown',        -- 'open' | 'closed' | 'permanently_closed'
  status_checked_at TIMESTAMP WITH TIME ZONE,      -- Last Google Places check
  consecutive_closed_checks INTEGER DEFAULT 0,     -- Auto-suppress after 3
  auto_suppressed BOOLEAN DEFAULT FALSE,           -- Removed from recommendations?
  suppression_reason TEXT,                         -- Why suppressed
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

**When Data Flows In:**
- **Trigger:** 
  1. **Seed data:** Pre-populated high-value venues
  2. **AI-generated:** GPT-5 suggests new venue → validated → added
  3. **Driver submission:** (future feature)
- **Update:** Business hours refreshed from Google Places API (weekly cron)

**Why Each Field:**
- **place_id UNIQUE:** Prevents duplicates (same Starbucks added twice)
- **category + dayparts:** Filter venues by time of day
- **staging_notes:** Driver knowledge (e.g., "use Arrivals level, not Departures")
- **last_known_status:** Prevent recommending permanently closed venues
- **consecutive_closed_checks:** Auto-suppress after 3 failed checks
- **discovery_source:** Track AI vs. human-curated venues for quality analysis

**Data Retention:** Permanent (unless manually deleted or auto-suppressed)

---

### 6. `venue_metrics` - Performance Tracking

**Purpose:** Tracks how venues perform over time (click-through rate, feedback, reliability).

**Schema:**
```sql
CREATE TABLE venue_metrics (
  venue_id UUID PRIMARY KEY REFERENCES venue_catalog(venue_id),
  
  -- Engagement Metrics
  times_recommended INTEGER NOT NULL DEFAULT 0,    -- How many times shown
  times_chosen INTEGER NOT NULL DEFAULT 0,         -- How many times clicked
  
  -- Feedback Aggregates
  positive_feedback INTEGER NOT NULL DEFAULT 0,    -- Thumbs up count
  negative_feedback INTEGER NOT NULL DEFAULT 0,    -- Thumbs down count
  
  -- Computed Reliability
  reliability_score DOUBLE PRECISION NOT NULL DEFAULT 0.5,  -- Bayesian average
  
  -- Last Verification
  last_verified_by_driver TIMESTAMP WITH TIME ZONE -- When driver confirmed hours/status
);
```

**When Data Flows In:**
- **times_recommended:** Incremented when venue appears in ranking
- **times_chosen:** Incremented when user clicks venue (action='click')
- **positive/negative_feedback:** Incremented on thumbs up/down
- **reliability_score:** Recomputed on each feedback (Bayesian smoothing)

**Why Each Field:**
- **times_chosen / times_recommended:** Click-through rate (CTR)
- **reliability_score:** Downweight venues with consistent bad feedback
- **last_verified_by_driver:** Trust recent driver validation over stale data

**Data Retention:** Permanent (accumulates over time)

---

### 7. `llm_venue_suggestions` - AI Venue Discovery Log

**Purpose:** Audit trail of AI-generated venue suggestions (for quality control).

**Schema:**
```sql
CREATE TABLE llm_venue_suggestions (
  suggestion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suggested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  -- Attribution
  model_name TEXT NOT NULL,                        -- 'gpt-5' | 'gemini-2.5-pro'
  ranking_id UUID REFERENCES rankings(ranking_id), -- Which ranking triggered this
  
  -- Suggestion Details
  venue_name TEXT NOT NULL,                        -- AI-suggested name
  suggested_category TEXT,                         -- AI-guessed category
  llm_reasoning TEXT,                              -- Why AI suggested this
  llm_analysis JSONB,                              -- Full reasoning payload
  
  -- Validation Pipeline
  validation_status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'validated' | 'rejected'
  place_id_found TEXT,                             -- Google Place ID if found
  venue_id_created UUID REFERENCES venue_catalog(venue_id), -- Created venue
  validated_at TIMESTAMP WITH TIME ZONE,           -- When validated
  rejection_reason TEXT                            -- Why rejected (if rejected)
);
```

**When Data Flows In:**
- **Trigger:** GPT-5 suggests a venue NOT in catalog
- **Validation:**
  1. Query Google Places API for name + coords
  2. If found → add to `venue_catalog`, set `validated`
  3. If not found → set `rejected`

**Why:**
- **Quality control:** Catch hallucinations (AI inventing venues)
- **Discovery rate:** How many new venues does AI find vs. hallucinate?
- **Rejection patterns:** Learn what types of suggestions fail

**Data Retention:** 90 days (cleared after analysis)

---

## Feedback & Learning Tables

### 8. `actions` - User Interaction Log

**Purpose:** Tracks every user action for behavioral analysis and ML training.

**Schema:**
```sql
CREATE TABLE actions (
  action_id UUID PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- Context
  ranking_id UUID REFERENCES rankings(ranking_id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
  user_id UUID,
  
  -- Action Details
  action TEXT NOT NULL,                            -- 'view' | 'click' | 'dismiss' | 'dwell'
  block_id TEXT,                                   -- Which venue
  dwell_ms INTEGER,                                -- How long viewed
  from_rank INTEGER,                               -- Position in list
  
  -- Raw Payload
  raw JSONB,                                       -- Full frontend event
  
  -- Performance Index (Issue #28)
  INDEX idx_actions_snapshot_id (snapshot_id)
);
```

**When Data Flows In:**
- **Trigger:** User interacts with UI
- **Source:** Client POST to `/api/actions`
- **Events:**
  - `view`: Venue card enters viewport
  - `click`: User taps venue card
  - `dwell`: Time spent viewing (before scroll)
  - `dismiss`: User swipes away venue

**Why Each Field:**
- **dwell_ms:** Proxy for interest (long dwell = considering it)
- **from_rank:** Did they click #1 or scroll to #5? (position bias)
- **raw JSONB:** Preserve full event for future analysis

**Critical for ML:**
- **Counterfactual learning:** What if we showed different venue at rank 1?
- **Click models:** Predict P(click | venue, context, position)

**Data Retention:** 365 days

---

### 9. `venue_feedback` - Per-Venue Thumbs Up/Down

**Purpose:** Explicit driver feedback on venue quality.

**Schema:**
```sql
CREATE TABLE venue_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  -- Context
  user_id UUID,
  snapshot_id UUID NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
  ranking_id UUID NOT NULL REFERENCES rankings(ranking_id) ON DELETE CASCADE,
  
  -- Venue
  place_id TEXT,                                   -- Google Place ID
  venue_name TEXT NOT NULL,                        -- Venue name
  
  -- Feedback
  sentiment TEXT NOT NULL,                         -- 'up' | 'down'
  comment TEXT,                                    -- Optional driver comment
  
  -- Uniqueness Constraint
  UNIQUE (user_id, ranking_id, place_id),          -- One vote per user per venue per ranking
  
  -- Performance Indexes
  INDEX ix_feedback_ranking (ranking_id),
  INDEX ix_feedback_place (place_id),
  INDEX idx_venue_feedback_snapshot_id (snapshot_id)
);
```

**When Data Flows In:**
- **Trigger:** User clicks thumbs up/down on venue card
- **Source:** Client POST to `/api/feedback/venue`
- **Update:** UPSERT on (user_id, ranking_id, place_id) - user can change vote

**Why:**
- **venue_metrics update:** Increment positive/negative_feedback counters
- **Reliability scoring:** Bayesian average incorporates feedback
- **Quality signal:** Downweight consistently bad venues

**Data Retention:** 365 days

---

### 10. `strategy_feedback` - Strategy Thumbs Up/Down

**Purpose:** Feedback on AI's strategic advice quality.

**Schema:**
```sql
CREATE TABLE strategy_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  -- Context
  user_id UUID,
  snapshot_id UUID NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
  ranking_id UUID NOT NULL REFERENCES rankings(ranking_id) ON DELETE CASCADE,
  
  -- Feedback
  sentiment TEXT NOT NULL,                         -- 'up' | 'down'
  comment TEXT,                                    -- Why good/bad
  
  -- Uniqueness
  UNIQUE (user_id, ranking_id)                     -- One vote per user per strategy
);
```

**When Data Flows In:**
- **Trigger:** User votes on strategy quality
- **Source:** POST to `/api/feedback/strategy`

**Why:**
- **Prompt tuning:** Learn which strategies drivers find useful
- **Model selection:** Compare Claude vs. GPT-5 vs. Gemini strategies

**Data Retention:** 365 days

---

### 11. `app_feedback` - General App Feedback

**Purpose:** General feedback not tied to specific venue or strategy.

**Schema:**
```sql
CREATE TABLE app_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  snapshot_id UUID REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
  sentiment TEXT NOT NULL,                         -- 'up' | 'down'
  comment TEXT                                     -- Free-text feedback
);
```

**When Data Flows In:**
- **Trigger:** User submits general feedback
- **Source:** POST to `/api/feedback/app`

**Why:**
- **UX improvements:** Surface bugs, confusion, feature requests
- **Context preservation:** snapshot_id links to what user was doing

**Data Retention:** 365 days

---

## Memory & Context Tables

### 12. `assistant_memory` - Assistant Conversation Memory

**Purpose:** Stores conversation threads, user preferences, and assistant context.

**Schema:**
```sql
CREATE TABLE assistant_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL,                             -- 'conversations' | 'user_preferences' | ...
  key TEXT NOT NULL,                               -- Unique within scope
  user_id TEXT,                                    -- Optional user
  content JSONB NOT NULL,                          -- Flexible data
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,             -- TTL
  
  UNIQUE (scope, key, COALESCE(user_id, ''))
);
```

**When Data Flows In:**
- **Scopes:**
  - `conversations`: Chat thread history (TTL 30 days)
  - `user_preferences`: Saved settings (TTL 365 days)

**Why:**
- **Conversation continuity:** Resume chat context across sessions
- **Personalization:** Remember user preferences

**Data Retention:** Per-scope TTL (30-365 days)

---

### 13. `eidolon_memory` - Eidolon System Memory

**Purpose:** Stores system-level state and project context.

**Schema:**
```sql
CREATE TABLE eidolon_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL,                             -- 'session_state' | 'project_state'
  key TEXT NOT NULL,
  user_id TEXT,
  content JSONB NOT NULL,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  
  UNIQUE (scope, key, COALESCE(user_id, ''))
);
```

**When Data Flows In:**
- **Scopes:**
  - `session_state`: Current session data (TTL 7 days)
  - `project_state`: Long-term project context (TTL 365 days)

**Data Retention:** Per-scope TTL (7-365 days)

---

### 14. `cross_thread_memory` - Cross-Thread Context

**Purpose:** Shared memory across conversation threads.

**Schema:**
```sql
CREATE TABLE cross_thread_memory (
  id SERIAL PRIMARY KEY,
  scope TEXT NOT NULL,                             -- 'cross_thread_context'
  key TEXT NOT NULL,
  user_id UUID,
  content JSONB NOT NULL,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,             -- TTL 730 days
  
  UNIQUE (scope, key, user_id)
);
```

**When Data Flows In:**
- **Trigger:** Agent stores cross-session context
- **Examples:** Recent file paths, global state, recurring patterns

**Data Retention:** 730 days

---

### 15. `agent_memory` - Agent Workspace Memory

**Purpose:** Stores agent's internal state and learning.

**Schema:**
```sql
CREATE TABLE agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,                        -- Session identifier
  entry_type TEXT NOT NULL,                        -- 'file_edit' | 'command' | 'learning'
  title TEXT NOT NULL,                             -- Entry title
  content TEXT NOT NULL,                           -- Entry content
  status TEXT DEFAULT 'active',                    -- 'active' | 'archived'
  metadata JSONB,                                  -- Additional data
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,             -- TTL
  
  INDEX idx_agent_memory_session (session_id),
  INDEX idx_agent_memory_type (entry_type)
);
```

**When Data Flows In:**
- **Trigger:** Agent performs actions (file edits, shell commands)
- **Diagnostics:** `/diagnostics/memory` endpoint

**Data Retention:** 730 days

---

## Infrastructure Tables

### 16. `triad_jobs` - Async Job Queue

**Purpose:** Tracks background jobs (Triad pipeline execution).

**Schema:**
```sql
CREATE TABLE triad_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'triad',              -- Job type
  status TEXT NOT NULL DEFAULT 'queued',           -- 'queued' | 'running' | 'ok' | 'error'
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  UNIQUE (snapshot_id, kind)                       -- One job per snapshot
);
```

**When Data Flows In:**
- **Trigger:** Strategy generation starts
- **Status transitions:** queued → running → ok/error

**Data Retention:** 30 days (job history)

---

### 17. `http_idem` - Idempotency Keys

**Purpose:** Prevent duplicate request processing.

**Schema:**
```sql
CREATE TABLE http_idem (
  key TEXT PRIMARY KEY,                            -- Client-provided idempotency key
  status INTEGER NOT NULL,                         -- HTTP status code
  body JSONB NOT NULL,                             -- Response body
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

**When Data Flows In:**
- **Trigger:** Client sends `Idempotency-Key` header
- **Lifetime:** 5 minutes (in-memory cache), then DB fallback

**Data Retention:** 24 hours

---

### 18. `places_cache` - Google Places API Cache

**Purpose:** Cache Google Places API responses to reduce API costs.

**Schema:**
```sql
CREATE TABLE places_cache (
  place_id TEXT PRIMARY KEY,                       -- Google Place ID
  formatted_hours JSONB,                           -- Cached business hours
  cached_at TIMESTAMP WITH TIME ZONE NOT NULL,     -- Cache timestamp
  access_count INTEGER NOT NULL DEFAULT 0          -- Hit counter
);
```

**When Data Flows In:**
- **Trigger:** Google Places API call returns hours
- **Update:** Refresh weekly for high-traffic venues

**Data Retention:** 90 days (then refresh)

---

### 19. `travel_disruptions` - Airport Delay Data

**Purpose:** Stores airport delay information for surge detection.

**Schema:**
```sql
CREATE TABLE travel_disruptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code TEXT NOT NULL DEFAULT 'US',
  airport_code TEXT NOT NULL,                      -- IATA code (e.g., 'SFO')
  airport_name TEXT,
  
  -- Delay Metrics
  delay_minutes INTEGER DEFAULT 0,
  ground_stops JSONB DEFAULT [],
  ground_delay_programs JSONB DEFAULT [],
  closure_status TEXT DEFAULT 'open',
  delay_reason TEXT,
  
  -- AI Analysis
  ai_summary TEXT,                                 -- Human-readable summary
  impact_level TEXT DEFAULT 'none',                -- 'none' | 'low' | 'moderate' | 'severe'
  
  -- Metadata
  data_source TEXT NOT NULL DEFAULT 'FAA',
  last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  next_update_at TIMESTAMP WITH TIME ZONE
);
```

**When Data Flows In:**
- **Trigger:** Cron job polls FAA API (every 5 minutes)
- **Update:** UPSERT on airport_code

**Why:**
- **Opportunity detection:** High delays = more airport demand
- **ai_summary:** Claude summarizes for driver UI

**Data Retention:** 7 days (rolling window)

---

## Data Flow Diagrams

### Complete Workflow: GPS → Smart Blocks

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. USER OPENS APP / REFRESHES LOCATION                          │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. CLIENT: Creates SnapshotV1 object                            │
│    - Browser GPS → lat/lng                                      │
│    - Google Geocoding → city, state, timezone                   │
│    - OpenWeather → weather data                                 │
│    - Time context → dow, hour, day_part_key                     │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. POST /api/location/snapshot                                  │
│    → INSERT INTO snapshots (...)                                │
│    → Returns snapshot_id                                        │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. SERVER: detectStrategyTrigger()                              │
│    IF (first load OR moved >2mi OR day_part changed):           │
│      → Call generateStrategyForSnapshot()                       │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. INSERT INTO strategies (status='pending')                    │
│    → Claude Sonnet 4.5 API call                                 │
│    → UPDATE strategies SET status='ok', strategy=<text>         │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ 6. CLIENT: Polls GET /api/blocks/strategy/:snapshotId           │
│    → Returns strategy when status='ok'                          │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ 7. CLIENT: GET /api/blocks/fast (for Quick Picks)               │
│    OR POST /api/blocks/full/:snapshotId (for Triad)             │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ 8. TRIAD PIPELINE (if full mode):                               │
│    a) Claude strategy (already done)                            │
│    b) GPT-5 planner → generates venue list                      │
│    c) Google APIs enrichment:                                   │
│       - Routes API → drive times                                │
│       - Places API → place_ids, hours                           │
│    d) Gemini validator → validates + reranks                    │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ 9. ATOMIC TRANSACTION:                                          │
│    BEGIN;                                                       │
│    INSERT INTO rankings (...) RETURNING ranking_id;             │
│    INSERT INTO ranking_candidates (ranking_id, ...) VALUES ...; │
│    UPDATE venue_catalog SET ... WHERE place_id=...;             │
│    UPDATE venue_metrics SET times_recommended = +1;             │
│    COMMIT;                                                      │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ 10. RETURN TO CLIENT: Smart Blocks JSON                         │
│     → Frontend renders venue cards                              │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ 11. USER INTERACTS:                                             │
│     - View venue → POST /api/actions (action='view')            │
│     - Click venue → POST /api/actions (action='click')          │
│     - Thumbs up → POST /api/feedback/venue (sentiment='up')     │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ 12. ML TRAINING LOOP (offline):                                 │
│     - Join snapshots + rankings + actions + feedback            │
│     - Train click prediction model                              │
│     - Update venue_metrics.reliability_score                    │
│     - Retrain exploration policy                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Indexes & Performance

### Critical Indexes (Issue #28)

**Foreign Key Indexes:**
```sql
-- ranking_candidates
CREATE INDEX idx_ranking_candidates_ranking_id ON ranking_candidates(ranking_id);
CREATE INDEX idx_ranking_candidates_snapshot_id ON ranking_candidates(snapshot_id);

-- actions
CREATE INDEX idx_actions_snapshot_id ON actions(snapshot_id);

-- venue_feedback
CREATE INDEX idx_venue_feedback_snapshot_id ON venue_feedback(snapshot_id);
CREATE INDEX ix_feedback_ranking ON venue_feedback(ranking_id);
CREATE INDEX ix_feedback_place ON venue_feedback(place_id);

-- agent_memory
CREATE INDEX idx_agent_memory_session ON agent_memory(session_id);
CREATE INDEX idx_agent_memory_type ON agent_memory(entry_type);
```

**Why These Indexes:**
- **ranking_candidates.ranking_id:** Fast lookup of all venues in a ranking
- **ranking_candidates.snapshot_id:** ML training joins (snapshot context + candidates)
- **actions.snapshot_id:** Behavioral analysis queries
- **venue_feedback.place_id:** Aggregate feedback per venue
- **agent_memory.session_id:** Session replay for diagnostics

**Query Performance:**
- Snapshot → Strategy: O(1) via UNIQUE index on snapshot_id
- Ranking → Candidates: O(N) with index seek (N = ~5-10 venues)
- Feedback aggregation: O(K) where K = feedback count per venue

---

## Retention Policies

### Data Lifecycle

| Table | Retention | Deletion Policy |
|-------|-----------|----------------|
| **snapshots** | 365 days | Manual cleanup script |
| **strategies** | 365 days | CASCADE with snapshots |
| **rankings** | 365 days | Manual cleanup |
| **ranking_candidates** | 365 days | CASCADE with rankings |
| **actions** | 365 days | Manual cleanup |
| **venue_feedback** | 365 days | Manual cleanup |
| **strategy_feedback** | 365 days | Manual cleanup |
| **app_feedback** | 365 days | Manual cleanup |
| **venue_catalog** | Permanent | Manual (or auto-suppression) |
| **venue_metrics** | Permanent | Cumulative |
| **llm_venue_suggestions** | 90 days | Manual cleanup |
| **assistant_memory** | 30-365 days | TTL auto-delete (expires_at) |
| **eidolon_memory** | 7-365 days | TTL auto-delete |
| **cross_thread_memory** | 730 days | TTL auto-delete |
| **agent_memory** | 730 days | TTL auto-delete |
| **triad_jobs** | 30 days | Manual cleanup |
| **http_idem** | 24 hours | Auto-expire |
| **places_cache** | 90 days | Manual refresh |
| **travel_disruptions** | 7 days | Rolling window |

### TTL Cleanup

**Memory Tables:**
- Run `memoryCompact()` daily via cron
- Deletes records where `expires_at <= NOW()`

**ML Data:**
- Keep 365 days for counterfactual learning
- After 1 year: aggregate metrics, delete raw events

---

## Migration Strategy

**Never Write Manual Migrations:**
```bash
# ✅ CORRECT: Direct schema sync
npm run db:push

# ✅ Force push (if warnings)
npm run db:push --force

# ❌ WRONG: Manual SQL migrations
# Don't create .sql files - let Drizzle handle schema changes
```

**Schema Change Workflow:**
1. Edit `shared/schema.js`
2. Run `npm run db:push`
3. Drizzle compares schema → generates ALTER statements
4. Review changes → confirm
5. Schema synced automatically

---

## Health Checks

### Database Diagnostics

**Endpoints:**
- `GET /diagnostics/memory` - View assistant/eidolon/cross-thread memory
- `GET /diagnostics/prefs` - User preferences
- `GET /diagnostics/session` - Session state
- `GET /diagnostics/conversations` - Conversation history

**DB Doctor Script:**
```bash
node server/scripts/db-doctor.js

# Checks:
# - PostgreSQL connection
# - All tables exist
# - Index health
# - Row counts
```

---

## Summary

### Table Count: 19 Tables

**Core Pipeline:** 7 tables (snapshots, strategies, rankings, ranking_candidates, actions, venue_catalog, venue_metrics)  
**Feedback:** 3 tables (venue_feedback, strategy_feedback, app_feedback)  
**Memory:** 4 tables (assistant_memory, eidolon_memory, cross_thread_memory, agent_memory)  
**Infrastructure:** 5 tables (triad_jobs, http_idem, places_cache, travel_disruptions, llm_venue_suggestions)

### Total Fields: 200+ columns

### Key Design Principles:

1. **Atomic Transactions:** All ranking inserts use BEGIN/COMMIT
2. **Cascade Deletes:** snapshots → strategies, rankings → candidates
3. **NOT NULL Constraints:** Enforce data quality at DB level
4. **JSONB Flexibility:** weather, air, features, metadata
5. **Foreign Key Indexes:** Fast joins for ML training
6. **TTL Policies:** Auto-cleanup memory tables
7. **Idempotency:** Prevent duplicate processing
8. **Model Versioning:** Track A/B tests (model_name, prompt_version)

---

**This schema supports:**
- ✅ Real-time ML predictions (<7s latency)
- ✅ Counterfactual learning (exploration policies)
- ✅ A/B testing (model versioning)
- ✅ Quality control (LLM suggestion audit)
- ✅ Rollback capability (365-day retention)
- ✅ Operational diagnostics (health endpoints)
- ✅ Cost optimization (API caching)

**End of Schema Documentation**
