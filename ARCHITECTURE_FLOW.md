# Vecto Pilot - Critical Data Flow

## Overview
This document maps the **exact flow** from GPS coordinates to Smart Blocks recommendations. Any future changes must preserve this critical path.

## End-to-End Flow (35-50 seconds total)

### 1. GPS Capture → Snapshot Creation (0-5s)
**Frontend**: `client/src/contexts/location-context-clean.tsx`
- Browser geolocation API captures GPS coordinates
- POST to `/api/location/snapshot`

**Backend**: `server/routes/location.js` (line 300-900)
- Reverse geocode coordinates → full address
- Parallel enrichment:
  - Weather API → temperature, conditions
  - Air Quality API → AQI, category
  - Airport detection → FAA delays (within 25 miles)
  - Holiday detection → Perplexity check
  - Timezone/day_part calculation
- **Single INSERT** to `snapshots` table with ALL enriched data (line 791)

**Critical Fields Populated**:
- `formatted_address` - Full user address
- `airport_context` - FAA data (delays, closures)
- `holiday` - Holiday name if applicable
- `weather` - Temperature, conditions
- `air` - AQI, category
- `timezone`, `dow`, `hour`, `day_part_key` - Temporal data

---

### 2. Strategy Pipeline Trigger (0s)
**Frontend**: `client/src/pages/co-pilot.tsx` (line 181)
- Receives `vecto-snapshot-saved` event
- POST to `/api/blocks-fast` (synchronous waterfall)

**Backend**: `server/routes/blocks-fast.js` (line 154-203)
- Creates `triad_job` record
- Runs **synchronous waterfall** (no background worker):

#### Step 1: AI Providers (Parallel, 10-15s)
- `providers/minstrategy.js` - Claude strategist
- `providers/briefing.js` - Perplexity research
- `providers/holiday-checker.js` - Holiday validation

**Critical**: All providers call `getSnapshotContext()` to fetch complete enriched snapshot

#### Step 2: Strategy Row Creation (0s)
**File**: `server/lib/strategy-generator-parallel.js` (line 226-233)
- **Single INSERT** with `onConflictDoNothing`
- Sets `model_name`: `claude→perplexity→gpt-5.1`
- Status: `pending`

#### Step 3: Consolidation (15-20s)
**File**: `server/lib/providers/consolidator.js`
- GPT-5.1 with reasoning + web search
- Fetches complete snapshot via `getSnapshotContext()`
- UPDATE `strategies.consolidated_strategy` (preserves model_name)
- Writes tactical intelligence to `briefings` table

---

### 3. Enhanced Smart Blocks Generation (10-15s)
**File**: `server/lib/enhanced-smart-blocks.js`

#### Step 1: GPT-5.1 Venue Planner (8-12s)
**File**: `server/lib/gpt5-tactical-planner.js`
- Input: Consolidated strategy + snapshot context
- Output: 5-8 venue recommendations with:
  - Coordinates (lat/lng)
  - Category (airport, entertainment, etc.)
  - Pro tips (3 per venue)
  - Staging locations

#### Step 2: Google API Enrichment (2-3s)
**File**: `server/lib/venue-enrichment.js`
- **Per venue** (parallel):
  - Reverse Geocoding → full address
  - **Routes API v2** (NEW) → traffic-aware drive time
  - **Places API v1** (NEW) → business hours, status, place_id

#### Step 3: Database Persistence
- INSERT `rankings` (model_name: `gpt-5.1-venue-planner`)
- INSERT `ranking_candidates` (5-8 venues with enriched data)
- NOTIFY `blocks_ready` event

---

### 4. Frontend Display
**File**: `client/src/pages/co-pilot.tsx`
- Receives `blocks_ready` SSE event
- GET `/api/blocks-fast?snapshotId={id}`
- Renders Smart Blocks with:
  - Venue names, addresses
  - Drive times with traffic
  - Value grades (A/B/C)
  - Pro tips
  - Staging locations

---

## Critical Constraints

### Single Strategy Row (1:1 with Snapshot)
- UNIQUE constraint on `strategies.snapshot_id`
- Model attribution set ONCE at creation
- NO UPDATE statements overwrite `model_name`

### Snapshot Enrichment BEFORE Strategy
- All data (address, FAA, holiday, weather) in snapshot row
- Strategy pipeline fetches complete snapshot via `getSnapshotContext()`
- NO re-computation of dates/times

### Google API Calls (Per Venue)
- Geocoding: 1 call per venue
- Routes API v2: 1 call per venue (traffic-aware)
- Places API v1: 1 call per venue (hours/status)
- All calls parallelized for speed

---

## File Map (Critical Path Only)

### Frontend
- `client/src/contexts/location-context-clean.tsx` - GPS capture
- `client/src/pages/co-pilot.tsx` - Waterfall trigger, display

### Backend - Snapshot
- `server/routes/location.js` - Snapshot creation with enrichment

### Backend - Strategy
- `server/lib/strategy-generator-parallel.js` - Single row creation
- `server/lib/providers/minstrategy.js` - Claude strategist
- `server/lib/providers/briefing.js` - Perplexity research
- `server/lib/providers/consolidator.js` - GPT-5.1 consolidation
- `server/lib/snapshot/get-snapshot-context.js` - Complete snapshot fetch

### Backend - Smart Blocks
- `server/routes/blocks-fast.js` - Synchronous waterfall
- `server/lib/enhanced-smart-blocks.js` - Orchestrator
- `server/lib/gpt5-tactical-planner.js` - GPT-5.1 venue planner
- `server/lib/venue-enrichment.js` - Google Routes/Places APIs

### Database Schema
- `snapshots` - Enriched location data
- `strategies` - AI-generated strategy (1:1 with snapshot)
- `briefings` - Perplexity research + GPT-5.1 tactical intel
- `rankings` - Smart Blocks metadata
- `ranking_candidates` - Individual venue recommendations

---

## Recent Fixes (November 15, 2025)

### Strategy Single-Row Architecture
- Removed triple INSERT (routes/snapshot.js, routes/location.js, strategy-utils.js)
- Single creation point: `strategy-generator-parallel.js` line 226
- Model attribution preserved: No UPDATEs overwrite `model_name`

### Smart Blocks Fixes
- Removed `.defaultNow()` from rankings.created_at (Drizzle conflict)
- Increased staging location reason validation: 300 → 500 chars
- Model name from env: `${STRATEGY_CONSOLIDATOR}-venue-planner` → `gpt-5.1-venue-planner`

---

## Testing Checklist

✅ GPS → Snapshot with all enrichments (address, FAA, holiday, weather)
✅ Strategy completes in ~20s with model_name intact
✅ Smart Blocks load in 35-50s total
✅ UI displays 5-8 venues with drive times, pro tips
✅ No duplicate API calls (one waterfall per snapshot)
✅ Holiday detection working ("Happy Veterans Day")
✅ Strategy bar progresses smoothly

