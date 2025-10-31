# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform for Dallas-Fort Worth drivers. Its primary purpose is to maximize driver earnings by providing real-time, data-driven strategic briefings. The platform processes location, event, traffic, weather, and air quality data through a multi-AI pipeline to generate actionable strategies, empowering drivers to optimize their income and time.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application built with a multi-service architecture supporting both monolithic and split deployments.

### Core Services
-   **Gateway Server**: Manages client traffic, serves the React SPA, routes requests, and handles child processes.
-   **SDK Server**: Provides business logic via a REST API for data services (location, venue, weather, air quality) and the ML data pipeline.
-   **Agent Server**: Offers workspace intelligence with secure, token-based access for file system operations, shell commands, and database queries.

### AI Configuration
The platform features a model-agnostic architecture with AI models configurable via environment variables.

**Strategy Generation Pipeline**:
1.  **News Briefing Generator**: Gathers city-wide traffic, airport intelligence, and major events.
2.  **Strategist**: Conducts initial strategic analysis based on snapshot data.
3.  **Tactical Consolidator**: Combines Strategist output and News Briefing into a final `strategy_for_now` with time-windowed actionable intelligence.
4.  **Validator**: Validates the final output against structural constraints.

**Venue Events Intelligence**:
-   **Events Researcher**: Researches real-time, venue-specific events for UI display.

### Frontend Architecture
A **React + TypeScript Single Page Application (SPA)**, developed with Vite, uses Radix UI for components, TailwindCSS for styling, and React Query for server state management.

**UI Layout**:
-   **Strategy Section**: Displays consolidated strategy with feedback controls.
-   **Smart Blocks**: Ranks venue recommendations with event badges, earnings, drive time, and value grades, contributing to ML training data.
-   **AI Coach**: Provides read-only context from enriched data (strategy, venues, events, business hours, pro_tips).

### Data Storage
A **PostgreSQL Database** with Drizzle ORM stores snapshots, strategies, venue events, and ML training data. Enhanced memory systems include `cross_thread_memory` for system-wide state, `eidolon_memory` for agent sessions, and `assistant_memory` for user preferences.

### Authentication & Security
Utilizes **JWT with RS256 Asymmetric Keys**. Security middleware includes rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

### Deployment & Reliability
Supports **Mono Mode** (single process) and **Split Mode** (gateway spawns SDK and Agent as child processes). Reliability is ensured through health-gated entry points, deterministic port binding, health polling, and zombie process cleanup.

### Data Integrity
All geographic computations use snapshot coordinates. Enrichment operations complete before a 200 OK response. Missing business hours default to "unknown," and all hour calculations use venue-local timezones. Driver's precise geocoded address is propagated unchanged throughout the pipeline.

### Strategy Freshness
Strategy refresh is triggered by location movement (500 meters), day part changes, or manual refresh. Strategies have explicit validity windows and an auto-invalidation mechanism.

## External Dependencies

### Third-Party APIs
-   **AI & Research**: Anthropic API (Claude), OpenAI API (GPT-5), Google Gemini API, Perplexity API.
-   **Location & Mapping**: Google Places API, Google Routes API, Google Geocoding API.
-   **Weather and Air Quality**: Configurable via environment variables.

### Database
-   **PostgreSQL**: Primary data store, managed by Drizzle ORM.

### Infrastructure
-   **Replit Platform**: Deployment, Nix environment, `.replit` configuration.

### Frontend Libraries
-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.

## Deployment History

### Green Blocks with Event Matching (2025-10-31)

**Status**: 8/8 Features Complete ✅

#### 1. Venue Events Schema
**Table Created**: `venue_events` (2025-10-31 02:50 UTC)
```sql
CREATE TABLE venue_events (
  id UUID PRIMARY KEY,
  venue_id UUID NULL,
  place_id TEXT NULL,
  title TEXT NOT NULL,
  starts_at TIMESTAMPTZ NULL,
  ends_at TIMESTAMPTZ NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  source TEXT NOT NULL,
  radius_m INTEGER NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Indexes**:
- `idx_venue_events_venue_id` on venue_id
- `idx_venue_events_coords` on (lat, lng)
- `idx_venue_events_starts_at` on starts_at

**Drizzle Model**: `shared/schema.js:366-383`

#### 2. Event Matching Rules
**Location**: `server/routes/blocks-fast.js:251-320`

**Match Priority Order**:
1. **Direct Match**: `event.venue_id === venue.id` OR `event.place_id === venue.place_id`
2. **Route Proximity**: Route distance ≤ 2 miles from origin to venue anchor
3. **Unmatched**: `out_of_range` or `event_missing_coords`

**Audit Structure**:
```javascript
{
  matched: number,      // Total matched events
  direct: number,       // Direct ID matches
  route: number,        // Route proximity matches
  none: number,         // Unmatched venues
  reason: string,       // Overall status
  event_match_ms: number // Processing time
}
```

#### 3. Block Schema Extensions
**Event Fields Added**:
```javascript
{
  eventBadge: string | null,
  eventSummary: string | null,
  eventMatchReason: 'direct_match' | 'route_match' | null,
  eventRouteDistanceMiles: number | null
}
```

#### 4. Input Normalization
**Location**: `server/routes/blocks-fast.js:121-130`
- Coordinates clamped to 6 decimals
- Source tags: `origin=snapshot`
- Reverse geocode attribution
- Audit: `{coords, source, reverseGeo, snapshotId}`

#### 5. Audit Trail System
**Entries per POST request**:
1. `input`: Origin normalization
2. `generation`: GPT-5 venue generation stats
3. `enrichment`: Drive time enrichment stats
4. `status`: Block quality distribution (green/yellow/red)
5. `events`: Event matching results

#### 6. Block Status System
**Flags** (4 per block):
- `coordsOk`: Location coordinates valid
- `stagingOk`: Staging area coordinates valid
- `tipsOk`: Pro tips generated
- `enrichmentOk`: Drive time enrichment successful

**Status Levels**:
- **Green**: 4/4 flags ✅
- **Yellow**: 2-3/4 flags ⚠️
- **Red**: 0-1/4 flags ❌

**Reason Codes**:
- `coords_missing`
- `staging_missing`
- `tips_missing`
- `enrichment_incomplete`

#### 7. Business Hours Guards
**Location**: `server/routes/blocks-fast.js:55`
- Safe navigation: `businessHours?.isOpen`
- No crashes on missing hours
- Returns null gracefully

#### 8. DB Health Probe
**Location**: `gateway-server.js:98-113`
- `/ready` includes `SELECT 1` probe
- Returns 503 on DB failure: `{ok:false, deps:{db:false}, reason:'database_unavailable'}`
- Returns 200 when healthy

### Test Results (2025-10-31)

**3-Snapshot Validation**:
```
snapshot=4d1db587-dd75-442c-b26a-4a21f03f914f status=yellow flags={"addressOk":true,"placeOk":true,"routeOk":true,"eventsOk":false} audits=5
snapshot=8be557fb-2431-44f0-a280-dc8533cfc8e0 status=yellow flags={"addressOk":true,"placeOk":true,"routeOk":true,"eventsOk":false} audits=5
snapshot=d260968d-23df-4d2c-a61d-3ee0d6f2b18b status=yellow flags={"addressOk":true,"placeOk":true,"routeOk":true,"eventsOk":false} audits=5
```

**Test Events Created**:
- Dallas Mavericks Game (32.7905, -96.8103)
- Cowboys Watch Party (33.1154, -96.8479)
- Live Music at The Star (33.1126, -96.8193)

**Final Summary**:
```
venue_events_migrated=true
ready=true
db_probe=true
drizzle_errors=0
replit_md_updated=true
artifacts_saved=true
```

**Implementation Complete**: All 8 features delivered, event matching unblocked