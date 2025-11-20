# Vecto Pilot™ - Complete System Architecture

**Last Updated:** November 16, 2025  
**Purpose:** Comprehensive end-to-end system documentation covering frontend, backend, database, and AI pipeline

---

## Table of Contents

1. [System Overview](#system-overview)
2. [User Journey Flow](#user-journey-flow)
3. [Database Schema](#database-schema)
4. [Frontend Architecture](#frontend-architecture)
5. [Backend Architecture](#backend-architecture)
6. [AI Waterfall Pipeline](#ai-waterfall-pipeline)
7. [File System Map](#file-system-map)
8. [Machine Learning Components](#machine-learning-components)
9. [Deployment Architecture](#deployment-architecture)
10. [Troubleshooting Guide](#troubleshooting-guide)

---

## 1. System Overview

### Technology Stack
- **Frontend:** React + TypeScript, Vite, TailwindCSS, Radix UI
- **Backend:** Node.js + Express
- **Database:** PostgreSQL (Neon - separate DEV/PROD instances)
- **ORM:** Drizzle ORM
- **AI Providers:** 
  - Claude (Anthropic) - Strategic planning
  - Perplexity - Comprehensive research
  - GPT-5 (OpenAI) - Consolidation & venue generation
  - Google Gemini - Events intelligence
- **External APIs:** Google Maps, Google Places, Weather, Air Quality

### Architecture Pattern
**Multi-Service Monolith** with optional split deployment:
- **Gateway Server** (`gateway-server.js`) - Traffic routing, SPA serving
- **Backend Routes** (`server/routes/`) - Business logic API
- **AI Pipeline** (`server/lib/providers/`) - Model-agnostic AI orchestration

---

## 2. User Journey Flow

### Step-by-Step User Experience

```
User Opens App
    ↓
[1] FRONTEND INITIALIZATION
    ├── Load React SPA (client/dist/index.html)
    ├── Initialize LocationContext (client/src/contexts/location-context-clean.tsx)
    ├── Request GPS permission
    └── Get coordinates (Browser Geolocation or Google Geolocation API)
    
    ↓
[2] LOCATION ENRICHMENT
    ├── POST /api/weather (temp, conditions)
    ├── POST /api/air-quality (AQI)
    ├── POST /api/geocode (city, state, timezone)
    └── Display in GlobalHeader.tsx
    
    ↓
[3] SNAPSHOT CREATION
    ├── File: client/src/lib/snapshot.ts → createSnapshot()
    ├── POST /api/snapshot
    │   └── Server: server/routes/location.js
    │       └── Inserts to: snapshots table
    └── Returns: snapshot_id (UUID)
    
    ↓
[4] WATERFALL TRIGGER
    ├── File: client/src/pages/co-pilot.tsx → useEffect on snapshot
    ├── POST /api/blocks-fast with snapshot_id
    │   └── Server: server/routes/blocks-fast.js
    └── Begins synchronous AI pipeline execution
    
    ↓
[5] AI WATERFALL EXECUTION (35-50 seconds)
    ├── [5a] PROVIDERS (Parallel - 10-15s)
    │   ├── runHolidayCheck() → briefings.holidays
    │   ├── runMinStrategy() → strategies.minstrategy
    │   └── runBriefing() → briefings table (6 fields)
    │
    ├── [5b] CONSOLIDATION (15-20s)
    │   ├── consolidateStrategy() → GPT-5
    │   └── Updates: strategies.consolidated_strategy
    │
    └── [5c] VENUE GENERATION (10-15s)
        ├── generateEnhancedSmartBlocks() → GPT-5
        ├── Creates: rankings table entry
        └── Creates: ranking_candidates table (6 venues)
    
    ↓
[6] FRONTEND POLLING
    ├── SSE connection to /api/sse/strategy/:snapshotId
    ├── Polls GET /api/strategy/:snapshotId (status check)
    └── On status=ok → Query blocks
    
    ↓
[7] BLOCKS DISPLAY
    ├── GET /api/blocks-fast?snapshotId=xxx
    ├── Returns: ranking_candidates + enrichments
    └── Displays: Smart Blocks in co-pilot.tsx
    
    ↓
[8] USER INTERACTION
    ├── View strategies, venues, events
    ├── Give feedback
    └── Navigate to venues
```

---

## 3. Database Schema

### Core Tables & Relationships

#### **snapshots** - User location context
```sql
Primary Key: snapshot_id (UUID)
Foreign Keys: None (root table)
Purpose: Captures user's location, time, and environmental context

Key Columns:
- snapshot_id: UUID (primary key)
- lat, lng: User coordinates
- city, state, country: Geocoded location
- timezone: Local timezone
- dow, hour, day_part_key: Time context
- weather: JSONB (temp, conditions)
- air: JSONB (AQI data)
- airport_context: JSONB (nearest airport info)
- created_at: Timestamp

Created By: POST /api/snapshot (server/routes/location.js)
```

#### **strategies** - AI-generated strategic plans
```sql
Primary Key: id (UUID)
Foreign Keys: 
  - snapshot_id → snapshots.snapshot_id (CASCADE DELETE)
Purpose: Stores multi-model AI outputs and consolidated strategy

Key Columns:
- snapshot_id: UUID (unique, references snapshots)
- status: TEXT (pending|ok|failed)
- minstrategy: TEXT (Claude strategic overview)
- consolidated_strategy: TEXT (GPT-5 actionable summary)
- model_name: TEXT (AI model version tracking)
- created_at, updated_at: Timestamps

Created By: ensureStrategyRow() in server/lib/strategy-utils.js
Updated By: 
  - runMinStrategy() → minstrategy
  - consolidateStrategy() → consolidated_strategy
```

#### **briefings** - Comprehensive travel intelligence
```sql
Primary Key: id (UUID)
Foreign Keys:
  - snapshot_id → snapshots.snapshot_id (CASCADE DELETE)
Purpose: Perplexity research + GPT-5 tactical intelligence

Key Columns (Perplexity):
- global_travel: TEXT (global conditions)
- domestic_travel: TEXT (national travel)
- local_traffic: TEXT (traffic/construction)
- weather_impacts: TEXT (weather affecting travel)
- events_nearby: TEXT (events within 50 miles)
- holidays: TEXT (if today is a holiday)
- rideshare_intel: TEXT (rideshare-specific data)
- citations: JSONB (Perplexity source URLs)

Key Columns (GPT-5 Tactical):
- tactical_traffic: TEXT (next 30 min traffic)
- tactical_closures: TEXT (next 30 min closures)
- tactical_enforcement: TEXT (next 30 min enforcement)
- tactical_sources: TEXT (sources checked)

Created By: runBriefing() in server/lib/providers/briefing.js
```

#### **rankings** - Block generation metadata
```sql
Primary Key: ranking_id (UUID)
Foreign Keys:
  - snapshot_id → snapshots.snapshot_id
Purpose: Tracks venue ranking job metadata

Key Columns:
- ranking_id: UUID (primary key)
- snapshot_id: UUID (references snapshots)
- created_at: Timestamp
- model_name: TEXT (GPT-5 version)
- scoring_ms, planner_ms, total_ms: Performance metrics

Created By: generateEnhancedSmartBlocks() in server/lib/enhanced-smart-blocks.js
```

#### **ranking_candidates** - Smart Blocks (Venues)
```sql
Primary Key: id (UUID)
Foreign Keys:
  - ranking_id → rankings.ranking_id (CASCADE DELETE)
  - snapshot_id → snapshots.snapshot_id
Purpose: Individual venue recommendations with enrichment

Key Columns (Core):
- name: TEXT (venue name)
- lat, lng: DOUBLE PRECISION (coordinates)
- place_id: TEXT (Google Place ID)
- rank: INTEGER (display order)

Key Columns (Value Metrics):
- distance_miles: DOUBLE PRECISION
- drive_minutes: INTEGER
- value_per_min: DOUBLE PRECISION ($/min metric)
- value_grade: TEXT (A+, A, B, C, D, Not Worth)
- not_worth: BOOLEAN

Key Columns (AI Insights):
- pro_tips: TEXT[] (array of tactical tips)
- closed_reasoning: TEXT (why recommend if closed)
- staging_tips: TEXT (where to park/stage)
- staging_lat, staging_lng: DOUBLE PRECISION

Key Columns (Enrichments):
- business_hours: JSONB (Google Places hours)
- venue_events: JSONB (today's events from Perplexity)

Created By: generateEnhancedSmartBlocks() → persistRankingTx()
Enriched By:
  - Google Places API (business hours)
  - Perplexity (venue events)
```

#### **triad_jobs** - Pipeline job tracking
```sql
Primary Key: id (UUID)
Foreign Keys: snapshot_id → snapshots.snapshot_id
Purpose: Track AI pipeline execution status

Key Columns:
- snapshot_id: UUID
- kind: TEXT ('triad' for full pipeline)
- status: TEXT (queued|running|succeeded|failed)

Created By: POST /api/blocks-fast (prevents duplicate pipelines)
```

### Database Schema Diagram

```
┌─────────────────┐
│   snapshots     │ ← Root table (location context)
│  snapshot_id PK │
└────────┬────────┘
         │
         ├──────────────────┐
         │                  │
         ▼                  ▼
┌─────────────────┐  ┌─────────────────┐
│  strategies     │  │   briefings     │
│ snapshot_id FK  │  │ snapshot_id FK  │
│ (minstrategy,   │  │ (6 research     │
│ consolidated)   │  │  fields + 4     │
└─────────────────┘  │  tactical)      │
                     └─────────────────┘
         │
         ▼
┌─────────────────┐
│   rankings      │
│  ranking_id PK  │
│ snapshot_id FK  │
└────────┬────────┘
         │
         ▼
┌──────────────────────┐
│ ranking_candidates   │
│ ranking_id FK        │
│ snapshot_id FK       │
│ (venues + enrichment)│
└──────────────────────┘
```

---

## 4. Frontend Architecture

### Main Components

#### **GlobalHeader.tsx**
- **Location:** `client/src/components/GlobalHeader.tsx`
- **Purpose:** Display location, weather, AQI in header
- **APIs Called:**
  - `POST /api/weather`
  - `POST /api/air-quality`
  - `POST /api/geocode`
- **State:** Uses LocationContext for coordinates

#### **co-pilot.tsx** (Main Page)
- **Location:** `client/src/pages/co-pilot.tsx`
- **Purpose:** Main driver interface with strategy and blocks
- **Key Sections:**
  1. Strategy Section - Displays consolidated_strategy
  2. Smart Blocks - Displays ranking_candidates
  3. SSE Subscriptions - Real-time strategy updates
- **APIs Called:**
  - `POST /api/snapshot` (on location change)
  - `POST /api/blocks-fast` (triggers waterfall)
  - `GET /api/strategy/:snapshotId` (polls status)
  - `GET /api/blocks-fast?snapshotId=xxx` (fetch blocks)
  - `SSE /api/sse/strategy/:snapshotId` (real-time updates)

#### **LocationContext**
- **Location:** `client/src/contexts/location-context-clean.tsx`
- **Purpose:** Global GPS state management
- **Provides:**
  - `coordinates` - lat/lng/accuracy
  - `city, weather, airQuality` - Enrichments
  - `createSnapshot()` - Trigger snapshot creation

#### **snapshot.ts** (Utility)
- **Location:** `client/src/lib/snapshot.ts`
- **Purpose:** Snapshot creation helper
- **Function:** `createSnapshot(coords, context)` → Returns snapshot_id

### Frontend → Backend Data Flow

```
User Action → Component State → API Call → Backend Route → Database
                                    ↓
                              Response ← JSON ← Query Result
```

**Example: Location Update**
```typescript
// 1. User grants GPS permission
LocationContext.tsx
  ↓
navigator.geolocation.getCurrentPosition()
  ↓
// 2. Get enrichments
POST /api/weather → { temp: 75, conditions: "clear" }
POST /api/air-quality → { aqi: 63 }
POST /api/geocode → { city: "Frisco", state: "TX" }
  ↓
// 3. Create snapshot
createSnapshot() in snapshot.ts
  ↓
POST /api/snapshot
  Body: { lat, lng, city, state, weather, air, ... }
  ↓
server/routes/location.js
  ↓
db.insert(snapshots).values({ ... })
  ↓
Returns: { snapshot_id: "uuid..." }
  ↓
// 4. Trigger waterfall
co-pilot.tsx useEffect
  ↓
POST /api/blocks-fast
  Body: { snapshot_id: "uuid..." }
```

---

## 5. Backend Architecture

### API Routes

#### **Location & Snapshot Routes**
```
File: server/routes/location.js

POST /api/snapshot
  Purpose: Create snapshot from user location
  Input: { lat, lng, city, state, weather, air, ... }
  Output: { snapshot_id: UUID }
  Database: INSERT INTO snapshots

POST /api/weather
  Purpose: Fetch weather data
  External API: Weather service (configured via env)
  
POST /api/air-quality
  Purpose: Fetch AQI data
  External API: Air quality service (configured via env)

POST /api/geocode
  Purpose: Reverse geocode coordinates
  External API: Google Geocoding API
```

#### **Waterfall Route (Main Pipeline)**
```
File: server/routes/blocks-fast.js

POST /api/blocks-fast
  Purpose: Execute synchronous AI waterfall
  Input: { snapshot_id: UUID }
  Output: { status: "ok", snapshot_id, blocks: [] }
  
  Flow:
  1. Create triad_job (prevent duplicates)
  2. Run providers in parallel
  3. Run consolidation
  4. Generate smart blocks
  5. Return success
  
  Calls:
  - runHolidayCheck(snapshotId)
  - runMinStrategy(snapshotId)  
  - runBriefing(snapshotId)
  - consolidateStrategy(...)
  - generateEnhancedSmartBlocks(...)

GET /api/blocks-fast?snapshotId=xxx
  Purpose: Fetch generated blocks
  Output: { blocks: [...], ranking_id, briefing, audit }
  
  Gates:
  1. Check strategy status (must be "ok")
  2. Query ranking_candidates
  3. Filter by 25-mile perimeter
  4. Sort by value_per_min DESC, distance ASC
```

#### **Strategy Routes**
```
File: server/routes/strategy.js

GET /api/strategy/:snapshotId
  Purpose: Check strategy status
  Output: { status: "pending|ok|failed", minstrategy, consolidated_strategy }
  Database: SELECT FROM strategies WHERE snapshot_id = ?

SSE /api/sse/strategy/:snapshotId
  Purpose: Real-time strategy status updates
  Emits: strategy_ready event when status=ok
```

### Backend Modules

#### **Connection Manager**
- **File:** `server/db/connection-manager.js`
- **Purpose:** Environment-aware database routing
- **Logic:**
  ```javascript
  const isProduction = 
    process.env.REPLIT_DEPLOYMENT === '1' ||
    process.env.DEPLOY_MODE === 'webservice';
  
  const dbUrl = isProduction 
    ? process.env.DATABASE_URL          // PROD DB
    : process.env.DEV_DATABASE_URL;     // DEV DB
  ```
- **Features:**
  - Neon connection resilience (auto-reconnect on 57P01 errors)
  - Health degradation detection
  - Connection pooling (max=10)

#### **Drizzle ORM Client**
- **File:** `server/db/drizzle.js`
- **Purpose:** Database query interface
- **Usage:**
  ```javascript
  import { db } from './server/db/drizzle.js';
  
  // Query
  const [snapshot] = await db.select()
    .from(snapshots)
    .where(eq(snapshots.snapshot_id, id))
    .limit(1);
  
  // Insert
  const [newSnapshot] = await db.insert(snapshots)
    .values({ ... })
    .returning();
  ```

---

## 6. AI Waterfall Pipeline

### Pipeline Architecture

The waterfall executes **synchronously** within a single HTTP request (35-50 seconds total) for Replit Reserved VM compatibility.

### Step-by-Step Execution

```
POST /api/blocks-fast → server/routes/blocks-fast.js
  ↓
[STEP 1] Create triad_job
  db.insert(triad_jobs).values({ snapshot_id, kind: 'triad', status: 'queued' })
  Purpose: Prevent duplicate pipelines
  
  ↓
[STEP 2] Ensure strategy row exists
  ensureStrategyRow(snapshotId)
  Creates: strategies table entry with status='pending'
  
  ↓
[STEP 3] Run Providers (PARALLEL - 10-15s)
  
  Promise.all([
    runHolidayCheck(snapshotId),    // Perplexity - Holiday detection
    runMinStrategy(snapshotId),     // Claude - Strategic overview
    runBriefing(snapshotId)         // Perplexity - Comprehensive research
  ])
  
  ↓
[STEP 4] Fetch provider outputs
  SELECT FROM snapshots, strategies, briefings WHERE snapshot_id = ?
  
  ↓
[STEP 5] Consolidate Strategy (15-20s)
  consolidateStrategy({
    snapshotId,
    claudeStrategy: strategies.minstrategy,
    briefing: briefings,
    snapshot: snapshots,
    holiday: strategies.holiday
  })
  
  Model: GPT-5
  Output: strategies.consolidated_strategy (actionable summary)
  
  ↓
[STEP 6] Generate Smart Blocks (10-15s)
  generateEnhancedSmartBlocks({
    snapshotId,
    consolidated: strategies.consolidated_strategy,
    briefing: briefings,
    snapshot: snapshots
  })
  
  Creates:
  1. rankings table entry
  2. 6x ranking_candidates (venues)
  
  ↓
[STEP 7] Enrich venues (parallel)
  - Google Places API (business hours)
  - Perplexity (venue events)
  
  ↓
[STEP 8] Emit SSE event
  strategy_ready event to /api/sse/strategy/:snapshotId
  
  ↓
[STEP 9] Return success
  { status: "ok", snapshot_id, blocks: [], message: "..." }
```

### Provider Details

#### **Holiday Checker**
- **File:** `server/lib/providers/holiday-checker.js`
- **Function:** `runHolidayCheck(snapshotId)`
- **Model:** Perplexity (sonar-pro)
- **Purpose:** Detect if current date is a holiday
- **Output:** Updates `briefings.holidays`
- **Env Vars:**
  - `PERPLEXITY_API_KEY`
  - `STRATEGY_BRIEFER` (model name, default: sonar-pro)

#### **MinStrategy (Strategist)**
- **File:** `server/lib/providers/minstrategy.js`
- **Function:** `runMinStrategy(snapshotId)`
- **Model:** Claude (Anthropic)
- **Purpose:** Generate strategic overview considering all context
- **Output:** Updates `strategies.minstrategy`
- **Env Vars:**
  - `ANTHROPIC_API_KEY`
  - `STRATEGY_STRATEGIST` (model name)
  - `STRATEGY_STRATEGIST_MAX_TOKENS`

#### **Briefing (Briefer)**
- **File:** `server/lib/providers/briefing.js`
- **Function:** `runBriefing(snapshotId)`
- **Model:** Perplexity (sonar-pro)
- **Purpose:** Comprehensive travel intelligence research
- **Output:** Updates `briefings` table (6 fields)
  - global_travel
  - domestic_travel
  - local_traffic
  - weather_impacts
  - events_nearby
  - rideshare_intel
- **Env Vars:**
  - `PERPLEXITY_API_KEY`
  - `STRATEGY_BRIEFER`
  - `STRATEGY_BRIEFER_MAX_TOKENS`

#### **Consolidator**
- **File:** `server/lib/providers/consolidator.js`
- **Function:** `consolidateStrategy(...)`
- **Model:** GPT-5 (OpenAI)
- **Purpose:** Synthesize all provider outputs into actionable strategy
- **Input:**
  - Claude minstrategy
  - Perplexity briefing
  - Snapshot context
- **Output:** Updates `strategies.consolidated_strategy`
- **Env Vars:**
  - `OPENAI_API_KEY`
  - `STRATEGY_CONSOLIDATOR` (model name)
  - `STRATEGY_CONSOLIDATOR_MAX_TOKENS`

#### **Venue Generator**
- **File:** `server/lib/enhanced-smart-blocks.js`
- **Function:** `generateEnhancedSmartBlocks(...)`
- **Model:** GPT-5 (OpenAI)
- **Purpose:** Generate 6 venue recommendations with tactical insights
- **Output:**
  - Creates rankings entry
  - Creates 6x ranking_candidates
- **Enrichments:**
  - Google Places API (business hours)
  - Google Routes API (drive time)
  - Perplexity (venue-specific events)
- **Env Vars:**
  - `OPENAI_API_KEY`
  - `GOOGLE_MAPS_API_KEY`
  - `PERPLEXITY_API_KEY`

### Model Configuration (Environment Variables)

All AI models are configurable via environment variables for easy model swaps:

```bash
# Strategist (Claude)
STRATEGY_STRATEGIST=claude-sonnet-4-5-20250929
STRATEGY_STRATEGIST_MAX_TOKENS=4000
STRATEGY_STRATEGIST_TEMPERATURE=0.2

# Briefer (Perplexity)
STRATEGY_BRIEFER=sonar-pro
STRATEGY_BRIEFER_MAX_TOKENS=4000
STRATEGY_BRIEFER_TEMPERATURE=0.2

# Consolidator (GPT-5)
STRATEGY_CONSOLIDATOR=gpt-5.1-turbo
STRATEGY_CONSOLIDATOR_MAX_TOKENS=2000
STRATEGY_CONSOLIDATOR_TEMPERATURE=0.3

# Venue Generator (GPT-5)
# Uses same OPENAI_API_KEY, model specified in code
```

---

## 7. File System Map

### Critical Files & Their Roles

#### **Entry Points**
```
gateway-server.js
  Purpose: Main server entry point
  Starts: Express server, routes, child processes
  Port: 5000
  Environment detection: DEPLOY_MODE, REPLIT_DEPLOYMENT
```

#### **Frontend**
```
client/
├── dist/                          # Built SPA (created by Vite)
│   └── index.html                 # Entry point served to users
├── src/
│   ├── pages/
│   │   └── co-pilot.tsx          # Main driver interface
│   ├── components/
│   │   └── GlobalHeader.tsx      # Header with location/weather
│   ├── contexts/
│   │   └── location-context-clean.tsx  # GPS state management
│   └── lib/
│       └── snapshot.ts           # Snapshot creation utility
```

#### **Backend Routes**
```
server/routes/
├── blocks-fast.js                # Waterfall execution + block retrieval
├── location.js                   # Snapshot creation
├── strategy.js                   # Strategy status queries
├── health.js                     # Health checks (/health, /ready)
├── feedback.js                   # User feedback collection
└── venue-events.js               # Venue event enrichment
```

#### **AI Providers**
```
server/lib/providers/
├── minstrategy.js                # Claude strategic overview
├── briefing.js                   # Perplexity comprehensive research
├── holiday-checker.js            # Perplexity holiday detection
└── consolidator.js               # GPT-5 strategy consolidation
```

#### **Core Libraries**
```
server/lib/
├── enhanced-smart-blocks.js      # GPT-5 venue generation
├── strategy-utils.js             # Strategy helpers (ensureStrategyRow, isStrategyReady)
├── persist-ranking.js            # Save venues to database
├── scoring-engine.js             # Value-per-minute calculations
├── driveTime.js                  # Google Routes API integration
└── gpt5-venue-generator.js       # GPT-5 venue coordinate generation
```

#### **Database**
```
server/db/
├── connection-manager.js         # Environment-aware DB routing
├── drizzle.js                    # Drizzle ORM client
└── pool-lazy.js                  # Lazy pool initialization (unused in main flow)

shared/
└── schema.js                     # Drizzle table definitions
```

#### **Configuration**
```
.replit                           # Replit deployment config
package.json                      # Dependencies + scripts
mono-mode.env                     # Development environment variables (gitignored)
```

---

## 8. Machine Learning Components

### Value-Per-Minute Algorithm

**File:** `server/lib/scoring-engine.js`  
**Function:** `scoreCandidate(candidate, snapshot)`

**Formula:**
```javascript
value_per_min = (estimated_earnings - dead_miles_cost) / total_minutes

Where:
- estimated_earnings = rate_per_min * trip_minutes
- dead_miles_cost = distance_miles * 0.655 (IRS mileage rate)
- total_minutes = drive_minutes + wait_minutes + trip_minutes

Grading:
- A+: value_per_min >= 1.50
- A:  value_per_min >= 1.00
- B:  value_per_min >= 0.75
- C:  value_per_min >= 0.50
- D:  value_per_min >= 0.25
- Not Worth: value_per_min < 0.25
```

### Drive Time Prediction

**File:** `server/lib/driveTime.js`  
**Function:** `predictDriveMinutes(origin, destination)`

**Method:**
1. **Primary:** Google Routes API (real-time traffic)
2. **Fallback:** Haversine distance estimation

**Integration:**
- Called during venue enrichment
- Results stored in `ranking_candidates.drive_minutes`

### Venue Discovery

**File:** `server/lib/gpt5-venue-generator.js`  
**Function:** `generateVenueCoordinates(snapshot, consolidated)`

**Process:**
1. GPT-5 analyzes consolidated strategy
2. Generates 6 venue recommendations
3. Returns: { name, lat, lng, reasoning }
4. No hardcoded locations - fully dynamic

### Event Intelligence

**Files:**
- `server/routes/venue-events.js`
- Perplexity API calls in `enhanced-smart-blocks.js`

**Process:**
1. After venues generated, query Perplexity per venue
2. Search: "Events today at [venue name] [city]"
3. Extract: Concerts, games, festivals
4. Store in: `ranking_candidates.venue_events` (JSONB)

---

## 9. Deployment Architecture

### Development Mode

**Command:** `npm run start:replit` (or Run button)  
**Environment:**
- Loads: `mono-mode.env` file
- Database: `DEV_DATABASE_URL`
- Detection: `REPLIT_DEPLOYMENT !== '1'`

**Process:**
```
scripts/start-replit.js
  ↓
Builds frontend (Vite)
  ↓
Starts gateway-server.js
  ↓
Serves SPA + API on port 5000
```

### Production Mode (Deployment)

**Command:** `.replit [deployment] run`  
**Environment:**
- Loads: Deployment secrets only (no .env files)
- Database: `DATABASE_URL`
- Detection: `DEPLOY_MODE=webservice`

**Build Process:**
```
npm ci --omit=dev          # Install production deps
npm run build:client       # Build Vite frontend
```

**Run Process:**
```
DEPLOY_MODE=webservice node gateway-server.js
```

**Required Secrets:**
```
DATABASE_URL                    # Production Neon DB
PERPLEXITY_API_KEY             # Perplexity research
ANTHROPIC_API_KEY              # Claude strategist
OPENAI_API_KEY                 # GPT-5 consolidator + venues
GOOGLE_MAPS_API_KEY            # Places + Routes
GOOGLE_GENERATIVE_AI_API_KEY   # Gemini (if used)
NEON_API_KEY                   # Neon DB management
```

### Database Routing Logic

**File:** `server/db/connection-manager.js`

```javascript
const isProduction = 
  process.env.REPLIT_DEPLOYMENT === '1' ||
  process.env.REPLIT_DEPLOYMENT === 'true' ||
  process.env.DEPLOY_MODE === 'webservice' ||
  (process.env.NODE_ENV === 'production' && !process.env.DEV_DATABASE_URL);

const dbUrl = isProduction 
  ? process.env.DATABASE_URL          // PROD
  : (process.env.DEV_DATABASE_URL || process.env.DATABASE_URL); // DEV
```

**Key Point:** Production should NEVER have `DEV_DATABASE_URL` secret set.

---

## 10. Troubleshooting Guide

### Issue: Snapshot not being created in production

**Symptoms:**
- Frontend loads, header shows weather/location
- Waterfall never starts
- No data in production database

**Debug Steps:**
1. Check deployment logs for database errors
2. Verify `DATABASE_URL` secret exists in deployment
3. Test database connection:
   ```sql
   SELECT NOW(); -- Should return current time
   ```
4. Check if snapshot INSERT fails in logs

**Common Causes:**
- Missing `DATABASE_URL` secret
- Database schema mismatch (run `npm run db:push`)
- Database connection timeout

### Issue: Waterfall fails with "PERPLEXITY_API_KEY not set"

**Symptoms:**
- Browser console shows: `❌ Waterfall failed: PERPLEXITY_API_KEY environment variable not set`
- Strategy stuck on "pending"

**Fix:**
1. Open deployment in Replit
2. Go to **Secrets** tab
3. Verify `PERPLEXITY_API_KEY` exists
4. If missing, add it
5. Deployment auto-restarts

### Issue: Blocks showing empty in production

**Symptoms:**
- Strategy completes successfully
- `GET /api/blocks-fast` returns `{ blocks: [] }`
- But DEV shows blocks fine

**Debug Steps:**
1. Check which database production is using:
   ```javascript
   console.log('[connection-manager] Database URL:', maskedUrl);
   ```
2. Query production database directly:
   ```sql
   SELECT COUNT(*) FROM ranking_candidates WHERE snapshot_id = 'xxx';
   ```
3. Verify production deployment has correct `DATABASE_URL`

**Common Causes:**
- Production writing to DEV database (remove `DEV_DATABASE_URL` from deployment secrets)
- Production using wrong database URL

### Issue: 404 errors on API endpoints in production

**Symptoms:**
- Frontend loads
- All API calls return 404
- Curl test shows `<title>Run this app to see the results here.</title>`

**Diagnosis:**
- Backend server is not running in production

**Fix:**
1. Check deployment logs for startup errors
2. Verify all required secrets are set
3. Check for missing dependencies:
   ```bash
   npm ci --omit=dev
   ```
4. Verify `gateway-server.js` starts without errors

### Checking Database Schema Sync

**File:** `shared/schema.js` defines all tables

**Sync Command:**
```bash
npm run db:push
```

**Force Sync (if errors):**
```bash
npm run db:push --force
```

**Verify Tables:**
```sql
\dt  -- List all tables
```

---

## Quick Reference Commands

### Development
```bash
npm run start:replit        # Start dev server with build
npm run dev                 # Start without build
npm run build:client        # Build frontend only
```

### Database
```bash
npm run db:push             # Sync schema to database
npm run db:push --force     # Force sync (caution!)
npm run db:studio           # Open Drizzle Studio UI
```

### Testing
```bash
# Test snapshot creation
curl -X POST http://localhost:5000/api/snapshot \
  -H "Content-Type: application/json" \
  -d '{"lat":33.12,"lng":-96.86,"city":"Frisco","state":"TX"}'

# Test waterfall
curl -X POST http://localhost:5000/api/blocks-fast \
  -H "Content-Type: application/json" \
  -d '{"snapshot_id":"your-uuid-here"}'

# Check strategy status
curl http://localhost:5000/api/strategy/your-uuid-here

# Get blocks
curl "http://localhost:5000/api/blocks-fast?snapshotId=your-uuid-here"
```

---

## Environment Variables Reference

### Required for Development
```bash
DEV_DATABASE_URL=postgresql://user:pass@host/db
PERPLEXITY_API_KEY=pplx-xxx
ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-xxx
GOOGLE_MAPS_API_KEY=AIza-xxx
GOOGLE_GENERATIVE_AI_API_KEY=AIza-xxx
```

### Required for Production Deployment
```bash
DATABASE_URL=postgresql://user:pass@host/db    # PROD DB only
DEPLOY_MODE=webservice                          # Auto-set by .replit
# Plus all API keys from development
```

### Optional Configuration
```bash
# Model selection
STRATEGY_STRATEGIST=claude-sonnet-4-5-20250929
STRATEGY_BRIEFER=sonar-pro
STRATEGY_CONSOLIDATOR=gpt-5.1-turbo

# Model parameters
STRATEGY_STRATEGIST_MAX_TOKENS=4000
STRATEGY_BRIEFER_MAX_TOKENS=4000
STRATEGY_CONSOLIDATOR_MAX_TOKENS=2000

# Database pool
PG_MAX=10                  # Max connections
PG_MIN=2                   # Min connections
PG_IDLE_TIMEOUT_MS=10000   # Idle timeout
```

---

## Critical Design Decisions

### 1. Synchronous Waterfall (No Background Workers)
**Why:** Replit Reserved VM deployment compatibility  
**Tradeoff:** Long HTTP request (35-50s) but simpler architecture  
**Alternative:** Autoscale mode with async workers (disabled by default)

### 2. Model-Agnostic Provider Architecture
**Why:** Easy model swaps via environment variables  
**Benefit:** No code changes needed to test new models  
**Files:** `server/lib/providers/` - each provider is independent

### 3. Separate DEV/PROD Databases
**Why:** Prevent production data corruption during development  
**Implementation:** `connection-manager.js` routes based on environment  
**Rule:** Production should NEVER have `DEV_DATABASE_URL` secret

### 4. Strategy-First Gating
**Why:** Blocks require consolidated strategy to be meaningful  
**Implementation:** `GET /api/blocks-fast` returns 202 until strategy ready  
**UX:** Frontend polls strategy status, then fetches blocks

### 5. 25-Mile Perimeter Enforcement
**Why:** Drive time > 25 miles rarely profitable for rideshare  
**Implementation:** `blocks-fast.js` filters candidates by `distance_miles <= 25`  
**Override:** None - hard limit for driver benefit

---

## Document Maintenance

**Update Frequency:** After major architectural changes  
**Owner:** Development team  
**Last Reviewed:** November 16, 2025

**Change Log:**
- 2025-11-16: Initial comprehensive architecture document created

---

**END OF DOCUMENT**
