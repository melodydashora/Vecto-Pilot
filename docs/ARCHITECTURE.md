# Vecto Pilot™ - Architecture & Constraints Reference

---

**Last Updated:** 2025-10-26 18:00 UTC  
**Database Status:** ❌ CRITICAL - `snapshots` table missing  
**Workflow Status:** ✅ Running on port 5000 (mono-mode)  
**System State:** 🔴 BROKEN - Cannot persist snapshots

---

## 📋 **CURRENT SYSTEM STATE (2025-10-26)**

### Critical Issue: Missing Database Tables

**Problem:** Application attempting to write to `snapshots` table that does not exist in database.

**Error:**
```
error: relation "snapshots" does not exist
at server/routes/location.js:759
```

**Impact:**
- ❌ Cannot create location snapshots
- ❌ Cannot trigger AI strategy generation
- ❌ Cannot save recommendations
- ❌ Complete data pipeline blocked

**Root Cause:** Database schema drift - Drizzle ORM schema defines tables that were never created in PostgreSQL.

---

## 🗄️ **DATABASE SCHEMA - CURRENT STATE**

### Schema Definition vs Reality

**Schema Defined (shared/schema.js):** 20 tables  
**Schema Created (PostgreSQL):** ❓ UNKNOWN - needs verification

### Expected Tables (from shared/schema.js)

| Table | Status | Primary Key | Purpose |
|-------|--------|-------------|---------|
| `snapshots` | ❌ **MISSING** | `snapshot_id` UUID | GPS + context snapshots |
| `strategies` | ❓ Unknown | `id` UUID | Claude strategic analysis |
| `rankings` | ❓ Unknown | `ranking_id` UUID | GPT-5 recommendations |
| `ranking_candidates` | ❓ Unknown | `id` UUID | Individual venue scores |
| `actions` | ❓ Unknown | `action_id` UUID | User interactions |
| `venue_catalog` | ❓ Unknown | `venue_id` UUID | Venue master data |
| `venue_metrics` | ❓ Unknown | `venue_id` UUID | Performance tracking |
| `triad_jobs` | ❓ Unknown | `id` UUID | Job queue |
| `http_idem` | ❓ Unknown | `key` TEXT | Idempotency cache |
| `places_cache` | ❓ Unknown | `place_id` TEXT | Google Places cache |
| `venue_feedback` | ❓ Unknown | `id` UUID | Per-venue thumbs |
| `strategy_feedback` | ❓ Unknown | `id` UUID | Strategy thumbs |
| `app_feedback` | ❓ Unknown | `id` UUID | General feedback |
| `travel_disruptions` | ❓ Unknown | `id` UUID | Airport delays |
| `llm_venue_suggestions` | ❓ Unknown | `suggestion_id` UUID | AI discoveries |
| `agent_memory` | ❓ Unknown | `id` UUID | Agent session data |
| `assistant_memory` | ❓ Unknown | `id` UUID | User preferences |
| `eidolon_memory` | ❓ Unknown | `id` UUID | Project state |
| `cross_thread_memory` | ✅ Created | `id` SERIAL | Thread context |

---

## 📊 **SNAPSHOTS TABLE - COMPLETE FIELD MAPPING**

### Table: `snapshots` (❌ MISSING IN DB)

**Purpose:** Capture complete environmental context for ML training and AI decision-making.

**Schema Definition:** `shared/schema.js` lines 3-37

| Field | Type | Nullable | Source | Purpose |
|-------|------|----------|--------|---------|
| `snapshot_id` | UUID | NOT NULL | `crypto.randomUUID()` | Primary key, correlation ID |
| `created_at` | TIMESTAMP | NOT NULL | `new Date()` | Snapshot creation time (UTC) |
| `user_id` | UUID | NULL | Client `userId` or NULL | Driver identity (if authenticated) |
| `device_id` | UUID | NOT NULL | Client `deviceId` | Unique device identifier |
| `session_id` | UUID | NOT NULL | Client `sessionId` | App session identifier |
| `lat` | DOUBLE | NOT NULL | Browser Geolocation API | GPS latitude |
| `lng` | DOUBLE | NOT NULL | Browser Geolocation API | GPS longitude |
| `accuracy_m` | DOUBLE | NULL | Browser Geolocation API | GPS accuracy in meters |
| `coord_source` | TEXT | NOT NULL | `'gps'` or `'manual'` | How coordinates obtained |
| `city` | TEXT | NULL | Google Geocoding API | Reverse geocoded city |
| `state` | TEXT | NULL | Google Geocoding API | Reverse geocoded state |
| `country` | TEXT | NULL | Google Geocoding API | Reverse geocoded country |
| `formatted_address` | TEXT | NULL | Google Geocoding API | Full address string |
| `timezone` | TEXT | NULL | Google Timezone API | IANA timezone (e.g., `America/Chicago`) |
| `local_iso` | TIMESTAMP | NULL | Calculated from timezone | Local time (no TZ) |
| `dow` | INTEGER | NULL | `localTime.getDay()` | Day of week (0=Sunday) |
| `hour` | INTEGER | NULL | `localTime.getHours()` | Hour (0-23) |
| `day_part_key` | TEXT | NULL | `getDayPartKey(hour)` | Time segment (e.g., `overnight`) |
| `h3_r8` | TEXT | NULL | `latLngToCell(lat, lng, 8)` | H3 geohash resolution 8 |
| `weather` | JSONB | NULL | OpenWeather API | `{tempF, conditions, description}` |
| `air` | JSONB | NULL | Google Air Quality API | `{aqi, category}` |
| `airport_context` | JSONB | NULL | FAA ASWS + airport proximity | Delay data, distance to airport |
| `local_news` | JSONB | NULL | Perplexity API | Local events affecting rideshare |
| `device` | JSONB | NULL | Client metadata | `{ua, platform}` |
| `permissions` | JSONB | NULL | Client permissions | `{geolocation: 'granted'}` |
| `extras` | JSONB | NULL | Reserved | Future extensions |
| `last_strategy_day_part` | TEXT | NULL | Previous strategy context | Deduplication tracking |
| `trigger_reason` | TEXT | NULL | Why snapshot created | `location_change`, `time_shift` |

### Data Flow: Browser → Server → Database

```
1. Browser (client/src/contexts/location-context-clean.tsx)
   ├─ navigator.geolocation.getCurrentPosition() → {lat, lng, accuracy}
   ├─ Fallback: Google Geolocation API → {lat, lng, accuracy}
   └─ Build SnapshotV1 object with coord, device, permissions

2. POST /api/location/snapshot (server/routes/location.js:559)
   ├─ Validate SnapshotV1 schema (server/util/validate-snapshot.js)
   ├─ Calculate H3 geohash: latLngToCell(lat, lng, 8)
   ├─ Enrich context:
   │  ├─ Google Geocoding API → city, state, country, formatted_address
   │  ├─ Google Timezone API → timezone
   │  ├─ Calculate local_iso, dow, hour, day_part_key
   │  ├─ OpenWeather API → weather JSON
   │  ├─ Google Air Quality API → air JSON
   │  ├─ FAA ASWS API → airport_context JSON
   │  └─ Perplexity API → local_news JSON
   └─ Transform to dbSnapshot object (lines 653-688)

3. Database Insert (line 759)
   ❌ FAILS: db.insert(snapshots).values(dbSnapshot)
   Error: relation "snapshots" does not exist
```

---

## 🔄 **COMPLETE WORKFLOW MAPPING**

### Workflow: Snapshot Creation & Strategy Generation

```
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 1: GPS ACQUISITION                                        │
└─────────────────────────────────────────────────────────────────┘
CLIENT: useGeoPosition.ts (client/src/hooks/useGeoPosition.ts)
├─ navigator.geolocation.getCurrentPosition()
│  ├─ Success → {lat, lng, accuracy}
│  └─ Fail → Google Geolocation API (fallback)
└─ Emit 'gps-update' event

CLIENT: location-context-clean.tsx
├─ Listen for 'gps-update'
├─ Call /api/location/resolve?lat=X&lng=Y
│  └─ Returns: {city, state, country, timeZone, formattedAddress}
├─ Call /api/location/weather?lat=X&lng=Y
│  └─ Returns: {temperature, conditions, ...}
├─ Call /api/location/airquality?lat=X&lng=Y
│  └─ Returns: {aqi, category, ...}
└─ Build SnapshotV1 object

┌─────────────────────────────────────────────────────────────────┐
│ PHASE 2: SNAPSHOT PERSISTENCE                                   │
└─────────────────────────────────────────────────────────────────┘
CLIENT: POST /api/location/snapshot
├─ Body: SnapshotV1 (all fields populated)

SERVER: location.js:559 (POST /api/location/snapshot handler)
├─ Validate SnapshotV1 schema
├─ Calculate H3 geohash
├─ Fetch airport context (FAA ASWS)
├─ Fetch local news (Perplexity)
├─ Transform to dbSnapshot
└─ ❌ db.insert(snapshots).values(dbSnapshot) → FAILS

┌─────────────────────────────────────────────────────────────────┐
│ PHASE 3: STRATEGY GENERATION (BLOCKED)                          │
└─────────────────────────────────────────────────────────────────┘
SERVER: location.js:764-785 (never reached due to failure)
├─ Insert into strategies table (status: 'pending')
├─ Claim job with FOR UPDATE SKIP LOCKED
└─ Enqueue strategy generation job

JOB QUEUE: job-queue.js
└─ Calls generateStrategyForSnapshot(snapshot_id)

STRATEGY GENERATOR: strategy-generator.js
├─ Load snapshot from database
├─ Call Claude Sonnet 4.5 (Strategist)
├─ Update strategies table (status: 'ok', strategy text)
└─ Trigger client poll

┌─────────────────────────────────────────────────────────────────┐
│ PHASE 4: BLOCKS GENERATION (BLOCKED)                            │
└─────────────────────────────────────────────────────────────────┘
CLIENT: Poll GET /api/strategies/:snapshot_id
├─ Wait for status: 'ok'
└─ Enable blocks query

CLIENT: GET /api/blocks?snapshot_id=X
└─ Triggers Triad AI pipeline

SERVER: blocks.js or blocks-triad-strict.js
├─ Load snapshot + strategy from database
├─ Call GPT-5 Tactical Planner
├─ Call Gemini Validator
├─ Persist to rankings + ranking_candidates
└─ Return blocks to client
```

---

## 🗂️ **FILE-TO-TABLE MAPPING**

### Client Files → Database Tables

| File | Table(s) Written | Operation |
|------|------------------|-----------|
| `client/src/contexts/location-context-clean.tsx` | `snapshots` | Creates via POST /api/location/snapshot |
| `client/src/pages/co-pilot.tsx` | `actions` | Logs user interactions |
| `client/src/pages/co-pilot.tsx` | `venue_feedback` | Thumbs up/down per venue |
| `client/src/pages/co-pilot.tsx` | `strategy_feedback` | Thumbs up/down for strategy |

### Server Files → Database Tables

| File | Table(s) Written | Table(s) Read |
|------|------------------|---------------|
| `server/routes/location.js` | `snapshots`, `strategies` | None |
| `server/lib/strategy-generator.js` | `strategies` (UPDATE) | `snapshots` |
| `server/routes/blocks.js` | `rankings`, `ranking_candidates` | `snapshots`, `strategies` |
| `server/routes/actions.js` | `actions` | `rankings` |
| `server/routes/feedback.js` | `venue_feedback`, `strategy_feedback`, `app_feedback` | `rankings` |
| `server/lib/persist-ranking.js` | `venue_catalog`, `venue_metrics` | `venue_catalog` |
| `server/lib/gpt5-tactical-planner.js` | None | `snapshots`, `strategies` |
| `server/lib/gemini-enricher.js` | None | None |
| `server/lib/faa-asws.js` | `travel_disruptions` | None |

---

## 🔌 **API ENDPOINT COMPLETE REFERENCE**

### Location Endpoints (server/routes/location.js)

| Endpoint | Method | Request | Response | Database Impact |
|----------|--------|---------|----------|-----------------|
| `/api/location/geocode/reverse` | GET | `?lat=X&lng=Y` | `{city, state, country, formattedAddress}` | None |
| `/api/location/geocode/forward` | GET | `?city=Dallas,TX` | `{coordinates: {lat, lng}, city, state}` | None |
| `/api/location/timezone` | GET | `?lat=X&lng=Y` | `{timeZone, timeZoneName}` | None |
| `/api/location/resolve` | GET | `?lat=X&lng=Y` | Combined geocode + timezone | None |
| `/api/location/weather` | GET | `?lat=X&lng=Y` | `{temperature, conditions, ...}` | None |
| `/api/location/airquality` | GET | `?lat=X&lng=Y` | `{aqi, category, ...}` | None |
| `/api/location/snapshot` | POST | SnapshotV1 JSON | `{snapshot_id, h3_r8, status}` | ❌ INSERT `snapshots` (FAILS) |

### Blocks Endpoints

| Endpoint | Method | Request | Response | Database Impact |
|----------|--------|---------|----------|-----------------|
| `/api/blocks` | GET | `?snapshot_id=X` | Array of venue blocks | INSERT `rankings`, `ranking_candidates` |
| `/api/strategies/:snapshot_id` | GET | None | `{strategy, status}` | READ `strategies` |

### Feedback Endpoints (server/routes/feedback.js)

| Endpoint | Method | Request | Response | Database Impact |
|----------|--------|---------|----------|-----------------|
| `/api/feedback/venue` | POST | `{sentiment, place_id, ranking_id}` | `{ok: true}` | INSERT `venue_feedback` |
| `/api/feedback/strategy` | POST | `{sentiment, ranking_id}` | `{ok: true}` | INSERT `strategy_feedback` |
| `/api/feedback/app` | POST | `{sentiment, comment}` | `{ok: true}` | INSERT `app_feedback` |

### Action Endpoints (server/routes/actions.js)

| Endpoint | Method | Request | Response | Database Impact |
|----------|--------|---------|----------|-----------------|
| `/api/actions` | POST | `{action, snapshot_id, ranking_id}` | `{ok: true}` | INSERT `actions` |

---

## 🚨 **CRITICAL ISSUES - PRIORITY ORDER**

### Issue #1: Missing Database Tables (BLOCKER)

**Status:** 🔴 CRITICAL  
**Impact:** Complete data pipeline failure  
**Root Cause:** Schema defined in `shared/schema.js` never applied to PostgreSQL

**Evidence:**
```sql
-- Error from console:
error: relation "snapshots" does not exist
at server/routes/location.js:759
```

**Fix Required:**
1. Run Drizzle migrations: `npm run db:push`
2. Verify all 20 tables created
3. Test snapshot creation endpoint

**Files Involved:**
- `shared/schema.js` - Schema definition
- `drizzle.config.ts` - Drizzle configuration
- `server/db/drizzle.js` - ORM client
- `server/db/client.js` - PostgreSQL pool

---

### Issue #2: PostgreSQL Connection Pool Errors

**Status:** 🟡 HIGH  
**Impact:** Connection drops, query failures

**Evidence:**
```
[pool] Unexpected pool error: Error: Connection terminated unexpectedly
[pool] Client removed from pool
```

**Root Cause:** Neon free tier auto-sleep (5 min idle timeout)

**Fix Applied (Partial):**
- Shared pool with 120s idle timeout (`server/db/pool.js`)
- TCP keepalive enabled (30s intervals)
- Connection recycling (maxUses: 7500)

**Still Needed:**
- Verify `PG_USE_SHARED_POOL=true` in `mono-mode.env`
- Test pool under sustained load

---

### Issue #3: Workflow Configuration

**Status:** ✅ WORKING  
**Current:** Running on port 5000 (mono-mode)

**Workflow:** "Run App"
```bash
set -a && source mono-mode.env && set +a && node gateway-server.js
```

**Process:**
- Gateway: ✅ Listening on 0.0.0.0:5000
- Eidolon SDK: ✅ Embedded in gateway
- Agent: ✅ Embedded in gateway

**Port Mapping:**
- 5000 → Gateway (HTTP + WebSocket)
- No separate processes (mono-mode)

---

## 📋 **ENVIRONMENT VARIABLES - COMPLETE REFERENCE**

### Required for Database

| Variable | Source | Purpose |
|----------|--------|---------|
| `DATABASE_URL` | Replit Secrets | PostgreSQL connection string (Neon) |
| `PG_USE_SHARED_POOL` | `mono-mode.env` | Enable shared pool (`true`) |
| `PG_MAX` | `mono-mode.env` | Max connections (10) |
| `PG_IDLE_TIMEOUT_MS` | `mono-mode.env` | Idle timeout (120000 = 2 min) |

### Required for AI Models

| Variable | Source | Purpose |
|----------|--------|---------|
| `ANTHROPIC_API_KEY` | Replit Secrets | Claude Sonnet 4.5 |
| `OPENAI_API_KEY` | Replit Secrets | GPT-5 |
| `GOOGLE_API_KEY` or `GEMINI_API_KEY` | Replit Secrets | Gemini 2.5 Pro |
| `PERPLEXITY_API_KEY` | Replit Secrets | Local news research |

### Required for Location APIs

| Variable | Source | Purpose |
|----------|--------|---------|
| `GOOGLE_MAPS_API_KEY` | Replit Secrets | Geocoding, Timezone |
| `OPENWEATHER_API_KEY` | Replit Secrets | Weather data |
| `GOOGLEAQ_API_KEY` | Replit Secrets | Air quality data |
| `FAA_ASWS_CLIENT_ID` | Replit Secrets | Airport delays |
| `FAA_ASWS_CLIENT_SECRET` | Replit Secrets | Airport delays |

---

## 🔍 **NEXT STEPS - REPAIR PLAN**

### Step 1: Verify Database Schema

```bash
# Check if tables exist
psql $DATABASE_URL -c "\dt"

# Expected output: 20 tables
# snapshots, strategies, rankings, ranking_candidates, actions, ...
```

### Step 2: Apply Drizzle Migrations

```bash
npm run db:push
```

This will:
1. Read `shared/schema.js`
2. Compare to PostgreSQL schema
3. Generate and apply ALTER/CREATE TABLE statements
4. Report any conflicts

### Step 3: Test Snapshot Creation

```bash
curl -X POST http://localhost:5000/api/location/snapshot \
  -H "Content-Type: application/json" \
  -d '{
    "snapshot_id": "test-123",
    "created_at": "2025-10-26T18:00:00Z",
    "device_id": "test-device",
    "session_id": "test-session",
    "lat": 32.7767,
    "lng": -96.7970
  }'
```

Expected: `{"success": true, "snapshot_id": "test-123"}`  
Actual (before fix): `500 error: relation "snapshots" does not exist`

### Step 4: Update ISSUES.md

Document:
1. All database schema drift issues
2. Connection pool configuration
3. Workflow status
4. API endpoint failures

---

**End of ARCHITECTURE.md Update**  
**Status:** Ready for ISSUES.md update after database schema verification