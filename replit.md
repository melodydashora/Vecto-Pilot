# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform for Dallas-Fort Worth drivers. It maximizes earnings by providing real-time strategic briefings based on location, events, traffic, weather, and air quality data. The platform uses a multi-AI pipeline to generate actionable strategies, empowering drivers with data-driven decisions to increase income and optimize time.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application featuring a multi-service architecture that supports both monolithic and split deployments.

### Core Services
-   **Gateway Server**: Handles client traffic, serves the React SPA, routes requests, and manages child processes.
-   **SDK Server**: Provides business logic via a REST API for data services (location, venue, weather, air quality), snapshot creation, and the ML data pipeline.
-   **Agent Server**: Manages workspace intelligence with secure, token-based access to file system operations, shell commands, and database queries.

### AI Configuration
The platform utilizes a model-agnostic architecture where AI models are configurable via environment variables.

**Strategy Generation Pipeline**:
1.  **News Briefing Generator** (default: Gemini 2.5 Pro): Generates city-wide traffic, airport intelligence, and major events.
2.  **Strategist** (default: Claude Opus 4.5): Generates initial strategic analysis based on snapshot data.
3.  **Tactical Consolidator** (default: GPT-5): Consolidates Strategist output and News Briefing into a final `strategy_for_now` with time-windowed actionable intelligence.
4.  **Validator** (default: Gemini 2.5 Pro): Validates the final output and enforces structural constraints.

**Venue Events Intelligence**:
-   **Events Researcher** (default: Perplexity): Researches real-time, venue-specific events for UI display, not directly used in strategy generation.

### Frontend Architecture
A **React + TypeScript Single Page Application (SPA)** built with Vite, utilizing Radix UI for components, TailwindCSS for styling, and React Query for server state management.

**UI Layout**:
-   **Strategy Section**: Displays consolidated strategy with feedback controls.
-   **Smart Blocks**: Ranked venue recommendations with event badges, earnings, drive time, and value grades, contributing to ML training data.
-   **AI Coach**: Provides read-only context from enriched data (strategy, venues, events, business hours, pro_tips) without making external API calls.

### Data Storage
A **PostgreSQL Database** with Drizzle ORM for schema management. It stores snapshots, strategies, venue events, and ML training data. Enhanced memory systems include `cross_thread_memory` for system-wide state, `eidolon_memory` for agent sessions, and `assistant_memory` for user preferences.

### Authentication & Security
Uses **JWT with RS256 Asymmetric Keys** (15-minute expiry, 90-day rotation). Security middleware includes rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

### Deployment & Reliability
Supports **Mono Mode** (single process) and **Split Mode** (gateway spawns SDK and Agent as child processes). Ensures reliability via health-gated entry points, deterministic port binding, health polling, and zombie process cleanup.

### Data Integrity
All geographic computations use snapshot coordinates. Enrichment operations complete before a 200 OK response. Missing business hours default to "unknown," and all hour calculations use venue-local timezones. Driver's precise geocoded address is propagated unchanged throughout the pipeline.

### Strategy Freshness
Strategy refresh is triggered by location movement (500 meters), day part changes, or manual refresh. Strategies have explicit validity windows and an auto-invalidation mechanism.

## External Dependencies

### Third-Party APIs
-   **AI & Research**: Anthropic API (Claude), OpenAI API (GPT-5), Google Gemini API, Perplexity API.
-   **Location & Mapping**: Google Places API (venue details, business hours), Google Routes API (traffic-aware routing, multi-route calculations), Google Geocoding API (reverse geocoding).
-   **Weather and Air Quality**: Configurable via environment variables.

### Database
-   **PostgreSQL**: Primary data store, managed by Drizzle ORM.

### Infrastructure
-   **Replit Platform**: Deployment, Nix environment, `.replit` configuration.
-   **Process Management**: Node.js `child_process`, `http-proxy`.

### Frontend Libraries
-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.
## Recent Changes

### GPT-5 Venue Generation with Stabilization (2025-10-31)

#### Contract: `geo_blocks_v1`
Complete replacement of deterministic venue scoring with GPT-5 coordinate generation + Google API enrichment, with explicit reason codes for block quality.

**Pipeline Architecture**:
1. **GPT-5 Generation** (`server/lib/gpt5-venue-generator.js`):
   - Input: Consolidated strategy + precise driver location + snapshot context
   - Output: EXACTLY 8 venues (16 coordinates: 8 location + 8 staging)
   - Each venue includes: `location_lat/lng`, `staging_lat/lng`, `pro_tips`, `staging_tips`, `closed_reasoning`

2. **Enrichment via Google APIs (new)**:
   - **Reverse Geocoding**: Coordinates → place_id resolution
   - **Places API (new)**: `https://places.googleapis.com/v1/places/{place_id}` - Business hours, display name, formatted address
   - **Routes API (new)**: `https://routes.googleapis.com/directions/v2:computeRoutes` - Traffic-aware drive time, distance

3. **Database Persistence** (`server/routes/blocks-fast.js`):
   - Schema: `ranking_candidates` table with `staging_name`, `staging_lat`, `staging_lng`, `pro_tips[]`, `staging_tips`, `closed_reasoning`
   - Migration: `drizzle/0005_overjoyed_quicksilver.sql`
   - Model tracking: `model_name='gpt-5-venue-generator'`, `path_taken='gpt5-generated'`

#### Reason Codes & Block Status
Per stabilization document, each block includes explicit quality flags:

**Status Calculation**:
- `green`: All 4 flags pass (coordsOk, stagingOk, tipsOk, enrichmentOk)
- `yellow`: 2-3 flags pass
- `red`: 0-1 flags pass

**Reason Codes**:
- `coords_missing`: Location coordinates invalid or missing
- `staging_missing`: Staging area coordinates invalid or missing  
- `tips_missing`: No pro_tips generated by GPT-5
- `enrichment_incomplete`: Drive time enrichment failed (driveTimeMinutes ≤ 0)

**Response Contract**:
```typescript
{
  name: string,
  coordinates: { lat: number, lng: number },
  stagingArea: { name: string, coordinates: { lat, lng }, parkingTip: string },
  proTips: string,
  closed_venue_reasoning: string | null,
  estimated_distance_miles: number,
  driveTimeMinutes: number,
  surge: number,
  estimatedEarningsPerRide: number,
  value_per_min: number,
  value_grade: 'A' | 'B' | 'C',
  not_worth: boolean,
  status: 'green' | 'yellow' | 'red',
  flags: { coordsOk: boolean, stagingOk: boolean, tipsOk: boolean, enrichmentOk: boolean },
  reasons: string[] | null
}
```

#### Database Fixes (2025-10-31)
**Issue**: `DrizzleQueryError: Cannot read properties of null (reading 'query')`
**Root Cause**: Shared pool disabled (`PG_USE_SHARED_POOL=false`) returned `null` to Drizzle  
**Fix** (`server/db/drizzle.js`):
- When shared pool disabled, create dedicated Pool for Drizzle
- Prevents null pointer crashes in query execution
- Pool config: `max: 10, idleTimeoutMillis: 120000, connectionTimeoutMillis: 10000`

#### Constraints & Validation
- **Hard cap**: Exactly 8 venues, no more, no less (enforced at generator and endpoint levels)
- **Coordinate validation**: `Math.abs(lat) ≤ 90`, `Math.abs(lng) ≤ 180`
- **Required fields**: location_name, location_lat/lng, staging_name, staging_lat/lng
- **Distance constraint**: All venues within 15 mile radius of driver location
- **Prompt enforcement**: GPT-5 system prompt explicitly requires 8 venues with dual coordinates

#### API Verification (2025-10-31)
✅ **Places API (new)** tested with DFW coordinates (32.8968, -97.0380)  
✅ **Routes API (new)** tested DFW → Downtown Dallas (35km, 29min with traffic)  
✅ Schema verified - all fields present and correct types  
✅ Database connection fixed - dedicated pool when shared pool disabled

**Files Modified**:
- `server/lib/gpt5-venue-generator.js` - 8-venue cap, validation, reason codes
- `server/routes/blocks-fast.js` - Status calculation, undefined variable fixes
- `server/db/drizzle.js` - Dedicated pool fallback
- `shared/schema.js` - Staging coordinate fields
- `docs/google-api-endpoints.md` - API verification documentation

**Exit Criteria** (from stabilization doc):
- Three test snapshots return blocks with green/yellow status ✓
- Explicit reasons for any yellow/red blocks ✓
- No `DrizzleQueryError` in worker logs ✓
- Schema freeze tagged as `geo_blocks_v1` ✓

#### Known Limitations (2025-10-31)
**Event Matching**: Documented as "coords or ≤2 miles" but not yet implemented:
- `venue_events` table does not exist in database schema
- Event matching logic not present in blocks-fast.js
- UI shows `eventBadge` and `eventSummary` fields but they are always null
- **Status**: Aspirational - requires venue_events schema + haversine proximity matching

**Health Probes** (2025-10-31):
- `/ready` endpoint now probes DB with `SELECT 1` - returns 503 if DB unavailable
- `/health`, `/healthz`, `/api/health` remain instant 200 (transport-only checks)
- Blocks endpoint returns structured errors: `DATABASE_QUERY_ERROR`, `DATABASE_UNAVAILABLE`, `INTERNAL_ERROR`
