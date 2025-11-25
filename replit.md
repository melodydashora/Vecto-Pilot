# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform designed to maximize rideshare driver earnings. It provides real-time, data-driven strategic briefings by integrating diverse data sources (location, events, traffic, weather, air quality) and leveraging advanced AI and data analytics to generate actionable strategies for drivers.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application with a multi-service architecture, supporting both monolithic and split deployments, and features a model-agnostic AI configuration.

**Core Services**:
-   **Gateway Server**: Handles client traffic, serves the React SPA, routes requests, and manages child processes.
-   **SDK Server**: Provides business logic via a REST API for data services and the ML data pipeline.
-   **Agent Server**: Delivers workspace intelligence with secure, token-based access.

**AI Configuration**:
The platform utilizes a role-based, model-agnostic architecture with configurable AI models for its strategy generation pipeline. This pipeline is event-driven and comprises four components: Strategist, Briefer, Consolidator, and Holiday Checker. All AI models are configured via environment variables.

**Frontend Architecture**:
A React + TypeScript Single Page Application (SPA), built with Vite, utilizing Radix UI, TailwindCSS, and React Query. It features a Strategy Section, Smart Blocks for venue recommendations, an AI Strategy Coach, and a Rideshare Briefing Tab, including immutable strategy history with a retry workflow.

**Data Storage**:
A PostgreSQL Database (Replit built-in, Neon-backed) with Drizzle ORM stores snapshots, strategies, venue events, and ML training data. It uses unique indexes and JSONB for flexible storage. Replit automatically routes to development database during development and production database when published - no manual configuration needed.

**Authentication & Security**:
Employs JWT with RS256 Asymmetric Keys and security middleware for rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

**Deployment & Reliability**:
Supports Mono Mode and Split Mode, featuring health-gated entry points, unified port binding, proxy gating, WebSocket protection, and process discipline. An optional autoscale mode is optimized for Replit deployments.

**Environment Contract Architecture**:
A contract-driven environment system with mode-specific validation prevents configuration drift. `DEPLOY_MODE` (e.g., `webservice`, `worker`) dictates the loaded environment variables and enforces contracts.

**Connection Resilience**:
Includes a comprehensive Neon connection resilience pattern with `server/db/connection-manager.js` to wrap `pg.Pool`, detect admin-terminated connections, and implement auto-reconnect logic with exponential backoff. Health endpoints (`/health`, `/ready`) reflect database degradation status by returning 503 during outages.

## External Dependencies

### Third-Party APIs
-   **AI & Research**: Anthropic (Claude), OpenAI (GPT-5), Google (Gemini), Perplexity.
-   **Location & Mapping**: Google Places API, Google Routes API, Google Geocoding API.
-   **Weather and Air Quality**: Configurable via environment variables.

### Database
-   **PostgreSQL (Replit Built-in)**: Primary data store, managed by Drizzle ORM. Uses `DATABASE_URL` environment variable which Replit automatically configures for dev/prod separation. Features robust connection resilience with auto-reconnect logic and exponential backoff.

### Infrastructure
-   **Replit Platform**: Deployment and Nix environment.

### Frontend Libraries
-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.

## Database Schema - Snapshots Table

The **snapshots** table is the foundation for strategy generation and Coach context. Each snapshot captures a complete "moment in time" of driver location and environmental conditions.

### Location & Coordinates
| Field | Type | Purpose |
|-------|------|---------|
| `snapshot_id` | UUID | Primary key, unique identifier for each snapshot moment |
| `lat` | Float | Latitude coordinate from GPS or manual search |
| `lng` | Float | Longitude coordinate from GPS or manual search |
| `accuracy_m` | Float | GPS accuracy in meters (0.0-200.0m typical) |
| `coord_source` | Text | 'gps', 'manual_city_search', 'api', etc. |

### Location Names (Geocoded)
| Field | Type | Purpose |
|-------|------|---------|
| `city` | Text | City name (e.g., "Frisco") |
| `state` | Text | State code (e.g., "TX") |
| `country` | Text | Country code (e.g., "US") |
| `formatted_address` | Text | Full address (e.g., "Frisco, TX 75034, USA") |
| `timezone` | Text | IANA timezone (e.g., "America/Chicago") |
| `h3_r8` | Text | Hexagonal spatial index for grid-based analysis |

### Time Context
| Field | Type | Purpose |
|-------|------|---------|
| `local_iso` | Timestamp | Local time when snapshot created (no TZ) |
| `dow` | Integer | Day of week (0=Sunday, 1=Monday...6=Saturday) |
| `hour` | Integer | Hour of day (0-23) |
| `day_part_key` | Text | Time period label: 'early_morning' (5-9am), 'mid_morning' (9am-12pm), 'afternoon' (12-5pm), 'evening' (5-9pm), 'night' (9pm-5am) |

### Environmental Data (JSONB)
| Field | Type | Sample Structure | Coach Use |
|-------|------|------------------|-----------|
| `weather` | JSONB | `{temp: 63, condition: "Cloudy", windSpeed: 8}` | Context for surge patterns, outdoor vs airport demand |
| `air` | JSONB | `{aqi: 92, level: "Moderate", pollutants: {...}}` | Air quality context, pollution-related surge areas |
| `local_news` | JSONB | `{events: [...], incidents: [...]}` | Real-time disruptions Coach can discuss |
| `airport_context` | JSONB | `{nearestAirports: [...], delays: [...]}` | Airport activity for Q&A |

### Special Context
| Field | Type | Purpose |
|-------|------|---------|
| `holiday` | Text | Holiday name if applicable (e.g., "Thanksgiving", "Christmas") or null |
| `is_holiday` | Boolean | Quick flag for holiday surge detection |

### Metadata (JSONB)
| Field | Type | Purpose |
|-------|------|---------|
| `device` | JSONB | Device type, OS, app version |
| `permissions` | JSONB | GPS, location permissions status |
| `extras` | JSONB | Future extensibility fields |

### Timestamps
| Field | Type | Purpose |
|-------|------|---------|
| `created_at` | Timestamp | When snapshot was persisted to DB |
| `session_id` | UUID | Groups multiple snapshots in user session |
| `device_id` | UUID | Tracks unique device across sessions |
| `user_id` | UUID | Null if anonymous, references registered user |

## AI Coach Integration

**Early Engagement Model**: The Coach now shows **BEFORE strategy completes** using snapshot data as a backup plan for Q&A:

### Coach receives snapshot fields:
- **Location context**: `city`, `state`, `formatted_address`, `coordinates`
- **Time context**: `hour`, `dow` (day of week), `day_part_key` (time period)
- **Environmental data**: `weather` (temp, condition), `air` (AQI, pollution), `local_news` (events)
- **Holiday info**: `holiday` (name), `is_holiday` (boolean flag)
- **Timezone**: For displaying local time to driver

### Coach features snapshot-driven Q&A:
- "What's the weather affecting demand today?" → Uses `weather` field
- "What's the air quality?" → Uses `air.aqi`
- "What time of day is it?" → Uses `hour` + `day_part_key`
- "Are there events happening?" → Uses `local_news`, `airport_context`
- "Is today a holiday?" → Uses `holiday` + `is_holiday`

### API Endpoint
**GET `/api/snapshot/:snapshotId`** - Fetch snapshot for Coach context
- Returns all fields listed above
- Called automatically when snapshot is created
- Cached for 10 minutes to reduce database load
- Enables Coach to answer questions while strategy generates (35-50 second wait)

---

## Production Readiness & Critical Fixes Applied

### 🔴 CRITICAL ISSUES RESOLVED

#### 1. Database Schema Alignment (FIXED)
**Problem**: Auxiliary tables (eidolon_memory, assistant_memory, agent_memory, cross_thread_memory) conflicted between dev and production databases
**Solution**: Dropped conflicting auxiliary tables, synchronized 20 core production tables
**Impact**: ✅ Database now clean with unified schema across all environments

#### 2. Unique Constraint on triad_jobs.snapshot_id (VERIFIED)
**Status**: Constraint exists and enforced
```sql
ALTER TABLE "triad_jobs" ADD CONSTRAINT "triad_jobs_snapshot_id_unique" UNIQUE("snapshot_id");
```
**Impact**: ✅ Prevents duplicate job processing, ensures idempotency

#### 3. Connection Pool Exhaustion Risk (FIXED)
**Problem**: 5 different pool instances created across codebase, causing connection limit exhaustion
**Solution**: Centralized to single `server/db/connection-manager.js` pool with unified configuration
**Pool Configuration**:
- Max connections: Configurable via `PG_MAX` (default: 10)
- Min connections: Configurable via `PG_MIN` (default: 2)
- Idle timeout: `PG_IDLE_TIMEOUT_MS` (default: 10s)
- Connection timeout: 5s
- Max uses per connection: 7,500
- Keep-alive enabled with 5s initial delay
**Impact**: ✅ All requests use single shared pool, preventing exhaustion

#### 4. Connection Pooler URL for Production (FIXED)
**Problem**: Production was using direct database connections instead of Neon's connection pooler
**Solution**: Automatic URL conversion in `server/db/connection-manager.js`
```javascript
if (isProduction && dbUrl && !dbUrl.includes('-pooler')) {
  dbUrl = dbUrl.replace('.us-east-2', '-pooler.us-east-2')
    .replace('.us-west-2', '-pooler.us-west-2')
    .replace('.eu-west-1', '-pooler.eu-west-1');
}
```
**Impact**: ✅ Production uses connection pooler for better scalability and lower latency

#### 5. Race Condition in Briefing Insert (FIXED)
**Problem**: Concurrent requests for same snapshot could trigger duplicate Perplexity API calls
**Solution**: Added `ON CONFLICT DO UPDATE` clause to briefing insert
```javascript
await db.insert(briefings).values({...})
  .onConflictDoUpdate({
    target: briefings.snapshot_id,
    set: { /* all fields */ }
  });
```
**Impact**: ✅ Ensures idempotency, prevents duplicate API calls, saves Perplexity credits

### 🟠 HIGH-PRIORITY ISSUES RESOLVED

#### 1. Venue Enrichment Retry Logic (FIXED)
**Problem**: Transient Google API failures (429, 5xx) caused permanent data holes
**Solution**: Added exponential backoff retry logic (3 attempts: 1s, 2s, 4s delays)
```javascript
const maxRetries = 3;
const baseDelay = 1000; // exponential: 1s, 2s, 4s
// Retries on 429 (rate limit) and 5xx errors
```
**Behavior**:
- Attempt 1: Initial request
- Attempt 2: Retry after 1s if failed
- Attempt 3: Retry after 2s if failed
- Fail: After 4s total if all attempts fail
**Impact**: ✅ Resilient to temporary network and API issues, preserves venue data

#### 2. Connection Pooler Configuration
**Environment Variables**:
- `PG_MAX`: Maximum connections (default: 10)
- `PG_MIN`: Minimum connections (default: 2)
- `PG_IDLE_TIMEOUT_MS`: Idle timeout in milliseconds (default: 10000)
- `DATABASE_URL`: Automatically switches between dev/prod (Replit managed)
**Impact**: ✅ Production automatically uses pooler suffix for scalability

### 🟡 MEDIUM-PRIORITY IMPROVEMENTS

#### 1. Timezone Validation in Venue Hours
**Implementation**: Business hours calculations use snapshot timezone
```javascript
const timezone = snapshot?.timezone || "America/Chicago"; // Fallback to CDT
const isOpen = calculateIsOpen(weekdayTexts, timezone);
```
**Impact**: Accurate "Open Now" badges even across time zones

#### 2. Consolidation Dependency Management
**Status**: Consolidation correctly waits for both strategy AND briefing before execution
```javascript
const hasStrategy = row.minstrategy != null && row.minstrategy.length > 0;
const hasBriefing = briefingRow != null;
if (!hasStrategy || !hasBriefing) {
  return; // Skips consolidation until both complete
}
```
**Impact**: ✅ Prevents partial consolidations

### Database Migration Strategy
**For Production Deployment**:
1. Use `npm run db:push` to sync schema changes
2. If conflicts occur, use `npm run db:push --force` 
3. Never manually write SQL migrations
4. Replit automatically handles dev/prod database switching via `DATABASE_URL`

### Monitoring & Health Endpoints
- **GET `/health`**: Returns 200 if app healthy, 503 if database degraded
- **GET `/ready`**: Returns 200 if ready to accept traffic
- These endpoints reflect connection pool status and database availability

### Performance Metrics (Expected)
- **Full waterfall pipeline**: ~20 seconds (strategy generation + smart blocks)
- **Smart blocks generation**: ~10-15 seconds with 6 venue recommendations
- **Connection pool warmup**: <500ms after first request
- **Briefing completion**: ~15-20 seconds with Perplexity API calls

### Production Deployment Checklist
- ✅ Database schema synchronized (20 core tables)
- ✅ Connection pooling configured for single pool instance
- ✅ Connection pooler URL enabled for production
- ✅ Briefing race conditions eliminated via ON CONFLICT
- ✅ Google API retry logic with exponential backoff
- ✅ Timezone handling in venue business hours
- ✅ Health endpoints configured
- ✅ Error handling and logging in place
- ✅ Database auto-reconnect with backoff implemented

**Status**: 🟢 **PRODUCTION READY** - All critical and high-priority issues resolved. Database schema is clean, connection pooling is unified, and retry logic handles transient failures. Ready for publication on Replit.
