# Vecto Pilot™ - Build Documentation
**Clean Build from Ground Up**

---

## Overview

Vecto Pilot™ is a rideshare driver assistance platform with AI-powered location recommendations. Built from scratch with a focus on ML-ready data capture and counterfactual learning.

---

## What We've Built

### 1. GlobalHeader Component
**Location**: `client/src/components/GlobalHeader.tsx`

**Purpose**: Displays real-time context (location, weather, time, air quality) and creates immutable context snapshots for ML learning.

**Features**:
- **GPS Location**: Real-time coordinates with accuracy display
- **City Search Override**: Manual city search via Google Geocoding (shared with Co-Pilot)
- **Weather Display**: Live temperature and conditions via OpenWeather API
- **Air Quality**: AQI with color-coded health indicators via Google Air Quality API
- **Timezone**: Automatic timezone detection and local time display
- **Day Part Classification**: Categorizes time into morning/afternoon/evening/etc.
- **Context Snapshots**: Immutable snapshot creation on app open, GPS refresh, and city override

**Key Functions**:
- `buildAndSaveSnapshot()`: Creates ML-ready snapshots with all context data
- `reverseGeocode()`: Converts coordinates to city/state/country
- `getTimezone()`: Fetches timezone for coordinates
- `getWeather()`: Fetches current weather
- `getAirQuality()`: Fetches air quality index

---

### 2. Co-Pilot Page
**Location**: `client/src/pages/co-pilot.tsx`

**Purpose**: Shows "Where to Go RIGHT NOW" recommendations with AI-generated strategic blocks sorted by earnings potential.

**Features**:
- **Smart Blocks**: AI-curated location recommendations with drive times, earnings estimates, surge multipliers
- **Distance Filtering**: Strict enforcement of 8-10 min / 11-15 min / 20-30 min drive time ranges
- **City Search**: Manual city override (synced with GlobalHeader via shared context)
- **Strategy Overview**: Claude-generated city-wide strategic advice (peak times, demand patterns)
- **Real Drive Times**: Calculated via Google Directions API with DFW-calibrated fallback formula
- **Live Indicators**: Shows OPEN/CLOSED status, event info, staging area details

**Key Functions**:
- `useQuery` for blocks: Fetches AI recommendations from `/api/blocks`
- `citySearchMutation`: Geocodes city name and sets override coordinates
- Block sorting by `estimatedEarningsPerRide` (highest first)

---

### 3. Location Context Provider
**Location**: `client/src/contexts/location-context-clean.tsx`

**Purpose**: Centralized location state management with GPS and manual override support.

**Features**:
- **GPS Management**: Browser geolocation with permission handling
- **Override Coordinates**: Shared state for city search (used by both GlobalHeader and Co-Pilot)
- **Session Tracking**: Maintains location session across app
- **Event Broadcasting**: Dispatches location change events

**Key State**:
```typescript
{
  currentCoords: { latitude, longitude, accuracy },
  overrideCoords: { latitude, longitude, city, source },
  timeZone: string,
  hasPermission: boolean,
  isLoading: boolean
}
```

---

### 4. ML Infrastructure (NEW)

#### Identity System
**Location**: `shared/identity.ts`

**Purpose**: Track users across sessions for ML personalization and A/B testing.

**IDs Generated**:
- `user_id`: UUID persisted in localStorage (anonymous until account link)
- `device_id`: UUID persisted once per device install
- `session_id`: UUID that rotates after 30min inactivity or app restart

**Functions**:
- `getIdentity()`: Returns all three IDs
- `linkUserAccount(accountUserId)`: Links anonymous user to real account

---

#### Type Definitions
**Location**: `shared/types/`

**Files Created**:
1. `ids.ts`: UUID type definition
2. `location.ts`: Coordinate type with source tracking (gps, manual_city_search, etc.)
3. `snapshot.ts`: SnapshotV1 schema for ML-ready context capture
4. `reco.ts`: RankingV1 schema for recommendation tracking with exploration metadata
5. `action.ts`: ActionV1 schema for user interaction tracking

**Key Type: SnapshotV1**
```typescript
{
  schema_version: 1,
  snapshot_id: UUID,
  user_id: UUID | null,
  device_id: UUID,
  session_id: UUID,
  created_at: string (ISO UTC),
  coord: { lat, lng, accuracyMeters, source },
  resolved: { city, state, country, timezone },
  time_context: { local_iso, dow, hour, is_weekend, day_part_key },
  weather: { tempF, conditions, description },
  air: { aqi, category },
  device: { ua, platform },
  permissions: { geolocation }
}
```

---

#### Database Schema
**Location**: `shared/schema.ts`

**Tables Created**:

**1. snapshots** - Immutable context records
```sql
- snapshot_id (UUID, PK)
- created_at (TIMESTAMPTZ)
- user_id, device_id, session_id (UUIDs)
- lat, lng (DOUBLE PRECISION)
- accuracy_m (INTEGER)
- coord_source (TEXT: gps|manual_city_search|etc)
- city, state, country, timezone (TEXT)
- local_iso (TIMESTAMP)
- dow (INTEGER, 0-6)
- hour (INTEGER, 0-23)
- is_weekend (BOOLEAN)
- day_part_key (TEXT)
- h3_r8 (TEXT) - H3 geospatial index for ML
- weather, air, device, permissions, extras (JSONB)
```

**2. rankings** - Recommendation sets shown to users
```sql
- ranking_id (UUID, PK)
- created_at (TIMESTAMPTZ)
- snapshot_id (UUID, FK to snapshots)
- user_id (UUID)
- city (TEXT)
- ui (JSONB) - maxDistance, filters
- model_name (TEXT) - e.g., "claude-ops-202509"
```

**3. ranking_candidates** - Individual blocks within rankings
```sql
- id (UUID, PK)
- ranking_id (UUID, FK to rankings)
- block_id (TEXT) - stable place identifier
- name (TEXT)
- lat, lng (DOUBLE PRECISION)
- drive_time_min (INTEGER)
- straight_line_km (DOUBLE PRECISION)
- est_earnings_per_ride (DOUBLE PRECISION)
- model_score (DOUBLE PRECISION) - raw model output
- rank (INTEGER) - position shown to user (1..N)
- exploration_policy (TEXT) - none|epsilon_greedy|thompson|ucb
- epsilon (DOUBLE PRECISION)
- was_forced (BOOLEAN) - exploration bumped this up
- propensity (DOUBLE PRECISION) - P(shown|context) for IPS
- features (JSONB)
- h3_r8 (TEXT)
```

**4. actions** - User interactions
```sql
- action_id (UUID, PK)
- created_at (TIMESTAMPTZ)
- ranking_id (UUID, FK to rankings)
- snapshot_id (UUID, FK to snapshots)
- user_id (UUID)
- action (TEXT) - block_click|navigate_to_block|dismiss|start_shift|end_shift
- block_id (TEXT)
- dwell_ms (INTEGER) - time spent viewing
- from_rank (INTEGER) - which position clicked
- raw (JSONB)
```

---

#### Snapshot Utility
**Location**: `client/src/lib/snapshot.ts`

**Purpose**: Creates ML-ready snapshots in standardized SnapshotV1 format.

**Functions**:
- `createSnapshot()`: Builds snapshot with identity, coords, context
- `persistSnapshot()`: Saves snapshot to backend

---

#### Database Client
**Location**: `server/db/client.js`

**Purpose**: Postgres connection pool for ML data persistence.

```javascript
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export default pool;
```

---

### 5. Backend API Routes

#### Location Routes
**Location**: `server/routes/location.js`

**Endpoints**:

**GET /api/location/geocode/reverse**
- Converts lat/lng → city/state/country
- Uses Google Geocoding API

**GET /api/location/geocode/forward**
- Converts city name → lat/lng coordinates
- Used for manual city search

**GET /api/location/timezone**
- Fetches timezone for coordinates
- Uses Google Timezone API

**GET /api/location/weather**
- Fetches current weather
- Uses OpenWeather API

**GET /api/location/airquality**
- Fetches air quality index
- Uses Google Air Quality API

**POST /api/location/snapshot**
- Saves context snapshots
- Currently: file-based (will migrate to Postgres)

---

#### Blocks Routes
**Location**: `server/routes/blocks.js`

**Endpoint**: **GET /api/blocks**

**Parameters**:
- `lat`, `lng`: Current coordinates
- `maxDistance`: Max drive time in minutes (10, 15, or 30)

**Process**:
1. Loads latest context snapshot
2. Fetches candidate places from Google Places API
3. Calculates real drive times via Google Directions API
4. Filters blocks strictly by maxDistance
5. Sends context + candidates to Claude API
6. Claude returns strategy + scored blocks
7. Sorts blocks by `estimatedEarningsPerRide`
8. Returns top recommendations

**Response**:
```json
{
  "strategy": "Peak dinner rush - stay close to upscale dining...",
  "blocks": [
    {
      "name": "Toyota Stadium",
      "driveTimeMinutes": 9,
      "estimatedEarningsPerRide": 19,
      "surge": 1.5,
      "isOpen": false,
      "aiRecommendation": "...",
      "liveRecommendation": "Still Worth Going",
      "explanation": "..."
    }
  ],
  "metadata": { processingTimeMs, coordinates }
}
```

---

## Dependencies Installed

### Backend
- `pg` - Postgres client
- `drizzle-orm` - Type-safe ORM
- `drizzle-zod` - Zod schema generation
- `drizzle-kit` - Database migrations
- `h3-js` - Geospatial indexing for ML

### Frontend
- Location context already using React hooks
- Uses `@tanstack/react-query` for data fetching

### APIs Used
- **Google Maps API**: Geocoding, Directions, Timezone, Places
- **OpenWeather API**: Current weather
- **Google Air Quality API**: AQI data
- **Anthropic Claude API**: AI recommendations (model: claude-sonnet-4-5-20250929)

---

## Configuration

### Environment Variables
```
DATABASE_URL=<postgres connection>
GOOGLE_MAPS_API_KEY=<key>
OPENWEATHER_API_KEY=<key>
GOOGLEAQ_API_KEY=<key>
ANTHROPIC_API_KEY=<key>
```

### Drizzle Config
**Location**: `drizzle.config.ts`

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./shared/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

---

## Architecture Flow

### Normal GPS Flow
1. User opens app → LocationProvider requests GPS permission
2. GPS acquired → GlobalHeader creates snapshot
3. Snapshot saved to database with H3 index
4. User opens Co-Pilot → fetches blocks from `/api/blocks`
5. Backend creates ranking with exploration metadata
6. Blocks displayed → exposure tracked
7. User clicks block → action tracked

### City Override Flow
1. User searches "New York, NY" in Co-Pilot
2. Forward geocoding returns coordinates
3. `overrideCoords` set in shared LocationContext
4. GlobalHeader detects override → rebuilds snapshot with NYC coords
5. Co-Pilot refetches blocks with NYC coords
6. Both components show NYC data simultaneously

---

## ML Learning System (In Progress)

### Data Flow
```
Snapshot → Ranking → Exposure → Action → Outcome
```

### What We Capture
1. **Context** (snapshots): When/where user opened app
2. **Recommendations** (rankings): What we showed them and why
3. **Exposures**: What they could have chosen (with propensities)
4. **Actions**: What they actually clicked
5. **Outcomes** (future): Did they earn money there?

### Why This Matters
- **Counterfactual Learning**: Learn from what WASN'T chosen
- **Exploration**: Test new recommendations without hurting current performance
- **Personalization**: Track individual user preferences over time
- **A/B Testing**: Compare model versions with statistical rigor

---

## What's Next

### Remaining ML Tasks
1. **Update snapshot endpoint** to save to Postgres with H3 indexing
2. **Modify /api/blocks** to create rankings in database
3. **Add exposure tracking** when blocks render (IntersectionObserver)
4. **Add action tracking** for clicks and navigation
5. **Test end-to-end** flow

### Future Enhancements
- Train LightGBM ranking model
- Add ride logging UI
- Compute outcome labels (earnings, acceptance)
- Build warehouse training view
- Deploy model serving endpoint

---

## Files Created (This Build)

### Shared Types
- `shared/types/ids.ts`
- `shared/types/location.ts`
- `shared/types/snapshot.ts`
- `shared/types/reco.ts`
- `shared/types/action.ts`
- `shared/identity.ts`
- `shared/schema.ts` (database schema)

### Frontend
- `client/src/components/GlobalHeader.tsx` (enhanced with ML snapshots)
- `client/src/contexts/location-context-clean.tsx` (override coords support)
- `client/src/pages/co-pilot.tsx` (AI recommendations)
- `client/src/lib/snapshot.ts` (ML snapshot utility)

### Backend
- `server/routes/location.js` (geocoding, weather, AQI, snapshots)
- `server/routes/blocks.js` (AI recommendations)
- `server/db/client.js` (Postgres pool)
- `drizzle.config.ts` (DB configuration)

### Infrastructure
- Eidolon gateway server (`gateway-server.js`)
- Assistant override system (unchanged, preserved)

---

## Database Tables (Postgres)
- ✅ `snapshots` - Context records
- ✅ `rankings` - Recommendation sets
- ✅ `ranking_candidates` - Individual blocks
- ✅ `actions` - User interactions

---

**Build Date**: October 2, 2025  
**Status**: Core infrastructure complete, ML capture system in progress  
**Next Session**: Continue ML implementation (phases 5-9)
