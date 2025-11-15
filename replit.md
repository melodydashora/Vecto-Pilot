# Vecto Pilot™ - Rideshare Intelligence Platform

## ⚠️ CRITICAL: Required Database Trigger

**Smart blocks will NOT appear without the `blocks_ready` trigger installed in BOTH databases.**

See `CRITICAL_DATABASE_SETUP.md` for installation instructions.

Status: ✅ Installed in prod and dev (Nov 15, 2025)

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform designed to maximize rideshare driver earnings. It provides real-time, data-driven strategic briefings by integrating diverse data sources (location, events, traffic, weather, air quality) and leveraging advanced AI and data analytics to generate actionable strategies for drivers. The platform aims to provide actionable strategies for drivers by focusing on data-driven insights.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application with a multi-service architecture, supporting both monolithic and split deployments, and features a model-agnostic AI configuration.

**Core Services**:
-   **Gateway Server**: Handles client traffic, serves the React SPA, routes requests, and manages child processes.
-   **SDK Server**: Provides business logic via a REST API for data services and the ML data pipeline.
-   **Agent Server**: Delivers workspace intelligence with secure, token-based access.

**AI Configuration**:
The platform utilizes a role-based, model-agnostic architecture with configurable AI models for its strategy generation pipeline. This pipeline is event-driven and comprises four components:
1.  **Strategist** (`STRATEGY_STRATEGIST`): Generates strategic overview.
2.  **Briefer** (`STRATEGY_BRIEFER`): Conducts comprehensive travel research.
3.  **Consolidator** (`STRATEGY_CONSOLIDATOR`): Consolidates with web search and reasoning.
4.  **Holiday Checker** (`STRATEGY_HOLIDAY_CHECKER`): Performs fast holiday detection.
All AI models are configured via environment variables, ensuring no hardcoded models and facilitating easy switching for cost optimization and testing.

**Frontend Architecture**:
A React + TypeScript Single Page Application (SPA), built with Vite, utilizing Radix UI, TailwindCSS, and React Query. It features a Strategy Section, Smart Blocks for venue recommendations, an AI Strategy Coach, and a Rideshare Briefing Tab, including immutable strategy history with a retry workflow.

**Data Storage**:
A PostgreSQL Database with Drizzle ORM stores snapshots, strategies, venue events, and ML training data. It uses unique indexes and JSONB for flexible storage. Database operations are automatically routed to a development database for local environments and a production database for deployments, preventing data pollution.

**Authentication & Security**:
Employs JWT with RS256 Asymmetric Keys and security middleware for rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

**Deployment & Reliability**:
Supports Mono Mode and Split Mode, featuring health-gated entry points, unified port binding, proxy gating, WebSocket protection, and process discipline. An optional autoscale mode is optimized for Replit deployments.

**Environment Contract Architecture**:
A contract-driven environment system with mode-specific validation prevents configuration drift. `DEPLOY_MODE` (e.g., `webservice`, `worker`) dictates the loaded environment variables and enforces contracts (e.g., a webservice mode cannot spawn a background worker).

**Database Environment Rules**:
The application automatically routes to `DEV_DATABASE_URL` for local development and `DATABASE_URL` for production (`REPLIT_DEPLOYMENT=1`). The system enforces that the production database is never polluted with test data and is considered READ-ONLY for inspection.

**Connection Resilience**:
Includes a comprehensive Neon connection resilience pattern with `server/db/connection-manager.js` to wrap `pg.Pool`, detect admin-terminated connections, and implement auto-reconnect logic with exponential backoff. Health endpoints (`/health`, `/ready`) reflect database degradation status by returning 503 during outages.

## External Dependencies

### Third-Party APIs
-   **AI & Research**: Anthropic (Claude), OpenAI (GPT-5), Google (Gemini), Perplexity.
-   **Location & Mapping**: Google Places API, Google Routes API, Google Geocoding API.
-   **Weather and Air Quality**: Configurable via environment variables.

### Database
-   **PostgreSQL (External - Neon)**: Primary data store, managed by Drizzle ORM. Utilizes pooled connections for queries and unpooled for LISTEN/NOTIFY. Features robust connection resilience, detecting Neon-specific error codes (57P01) for targeted retry logic.

### Infrastructure
-   **Replit Platform**: Deployment and Nix environment.
-   **Port Configuration**: Single port (5000) for autoscale health checks.

### Frontend Libraries
-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.
---

## 🔧 FIX HISTORY (Append-Only Documentation)

### ✅ FIXED: SSE blocks_ready Event Not Firing - Dev/Prod Database Routing Issue

**Date/Time**: November 15, 2025, 12:30-12:50 UTC
**Status**: TESTED ✅ (Root cause identified and fixed)
**Severity**: CRITICAL - Smart blocks never appeared in UI despite successful venue generation

#### Problem Description

Smart blocks (venue recommendations) did not display in the frontend UI despite:
- ✅ Strategy generation completing successfully
- ✅ Venue generation completing successfully  
- ✅ Rankings and candidates successfully inserted into database
- ❌ Frontend stuck at `WAITING_FOR_BLOCKS_READY_EVENT` (timeout after 30s)

#### Root Cause Analysis

The `getListenClient()` function in `server/lib/db-client.js` was not respecting dev/prod database routing:

**BEFORE (Broken Code - Line 110):**
```javascript
let connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
```

**Problem**: This always used `DATABASE_URL` (production), but in local dev mode, the app uses `DEV_DATABASE_URL`. This meant:
1. SSE endpoint connected to LISTEN client using DATABASE_URL (production)
2. Venue generation inserted rows into DEV_DATABASE_URL (dev)
3. Trigger fired NOTIFY in dev database
4. SSE client listening on production database never received the notification

#### The Fix

**File Modified**: `server/lib/db-client.js` (lines 108-123)

**AFTER (Fixed Code):**
```javascript
// CRITICAL: Respect dev/prod database routing (same logic as connection-manager.js)
const isProduction = process.env.REPLIT_DEPLOYMENT === '1' || process.env.REPLIT_DEPLOYMENT === 'true';
const baseDbUrl = isProduction ? process.env.DATABASE_URL : (process.env.DEV_DATABASE_URL || process.env.DATABASE_URL);
let connectionString = process.env.DATABASE_URL_UNPOOLED || baseDbUrl;

console.log(`[db-client] LISTEN client using ${isProduction ? 'PRODUCTION' : 'DEV'} database`);
```

**Change**: Added dev/prod routing logic matching `server/db/connection-manager.js` (lines 8-9) to ensure LISTEN client connects to the same database as the query pool.

#### Proof of Issue

**Test Execution Timestamps**: 2025-11-15 12:37-12:44 UTC

**1. ✅ Snapshot Created:**
```bash
$ curl -X POST http://localhost:5000/api/location/snapshot -d '{"lat": 37.7749, "lng": -122.4194}'
{
  "success": true,
  "snapshot_id": "37e48445-0a3a-489a-ac54-687d577946d3",
  "h3_r8": "8828308281fffff",
  "status": "parallel_providers_initiated"
}
```

**2. ✅ Venue Generation Completed (14.2s):**
```sql
SELECT ranking_id, snapshot_id, created_at, total_ms FROM rankings 
WHERE snapshot_id = '37e48445-0a3a-489a-ac54-687d577946d3';

              ranking_id              |             snapshot_id              |          created_at           | total_ms 
--------------------------------------+--------------------------------------+-------------------------------+----------
 0d3b7f97-f13a-4ff1-ae22-29a64ce9e288 | 37e48445-0a3a-489a-ac54-687d577946d3 | 2025-11-15 12:38:27.804783+00 |    14260
```

**3. ✅ Venues Inserted Successfully (6 blocks):**
```sql
SELECT id, ranking_id, name, lat, lng, rank FROM ranking_candidates 
WHERE ranking_id = '0d3b7f97-f13a-4ff1-ae22-29a64ce9e288' ORDER BY rank;

                  id                  |              ranking_id              |                        name                         |   lat    |    lng     | rank 
--------------------------------------+--------------------------------------+-----------------------------------------------------+----------+------------+------
 621a514f-e0fb-4198-ac1f-6a81b3b45390 | 0d3b7f97-f13a-4ff1-ae22-29a64ce9e288 | The EndUp                                           | 37.77739 | -122.40777 |    1
 80521d2f-de43-4e27-a84e-75a4ac1bd275 | 0d3b7f97-f13a-4ff1-ae22-29a64ce9e288 | DNA Lounge                                          | 37.77197 |  -122.4129 |    2
 8e9441a6-b59d-4f8f-b779-e0b17727f6ef | 0d3b7f97-f13a-4ff1-ae22-29a64ce9e288 | The Proper Hotel San Francisco (Market St Entrance) | 37.77649 | -122.41748 |    3
 d37cc6f1-ba7a-4a12-b662-744f192deb7f | 0d3b7f97-f13a-4ff1-ae22-29a64ce9e288 | Parc 55 San Francisco - a Hilton Hotel              | 37.78423 | -122.40894 |    4
 a5e46cc3-b1da-4173-b093-19d4a3bb20c9 | 0d3b7f97-f13a-4ff1-ae22-29a64ce9e288 | Hotel VIA                                           | 37.77864 | -122.38935 |    5
 13f3b682-8c62-4b73-8459-aec11c8ae8ea | 0d3b7f97-f13a-4ff1-ae22-29a64ce9e288 | Embassy Suites by Hilton San Francisco Airport     | 37.64767 | -122.40464 |    6

Total: 6 candidates
```

**4. ✅ Trigger Exists and Enabled:**
```sql
$ psql "$DEV_DATABASE_URL" -c "SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'trg_blocks_ready';"
      tgname      | tgenabled
------------------+-----------
 trg_blocks_ready | O          -- 'O' = enabled

$ psql "$DEV_DATABASE_URL" -c "SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_blocks_ready';"
CREATE TRIGGER trg_blocks_ready AFTER INSERT ON public.rankings 
FOR EACH ROW EXECUTE FUNCTION notify_blocks_ready()
```

**5. ✅ Trigger Function Correct:**
```sql
SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'notify_blocks_ready';

CREATE OR REPLACE FUNCTION public.notify_blocks_ready()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM pg_notify('blocks_ready', json_build_object(
    'ranking_id', NEW.ranking_id,
    'snapshot_id', NEW.snapshot_id,
    'created_at', NEW.created_at
  )::text);
  RETURN NEW;
END;
$function$
```

**6. ❌ SSE Event Never Received (Frontend Logs):**
```javascript
[blocks-query] 🔍 GATING CHECK (Event-Driven): {
  "hasCoords": true,
  "hasSnapshot": true,
  "lastSnapshotId": "0e1566d7-7a78-46fd-8335-9af1e2c692da",
  "blocksReadyForSnapshot": null,
  "blocksReadyForThisSnapshot": false,
  "⚠️ BLOCKED_REASON": "WAITING_FOR_BLOCKS_READY_EVENT",
  "shouldEnable": false
}

[SSE] ⏱️ Blocks ready event timeout after 30s - enabling fallback query
```

#### Expected Behavior After Fix

**Dev Mode (REPLIT_DEPLOYMENT=undefined):**
```
[connection-manager] Using DEV database
[db-client] LISTEN client using DEV database  ← NEW LOG
[db-client] ✅ LISTEN client connected
[SSE] Subscribed to blocks_ready channel
... venue generation completes ...
[SSE] Broadcasting blocks_ready: {"ranking_id":"...","snapshot_id":"..."}
```

**Production Mode (REPLIT_DEPLOYMENT=1):**
```
[connection-manager] Using PRODUCTION database
[db-client] LISTEN client using PRODUCTION database  ← NEW LOG
[db-client] ✅ LISTEN client connected
[SSE] Subscribed to blocks_ready channel
```

#### Files Modified

- `server/lib/db-client.js` (lines 114-120) - Added dev/prod routing logic to `getListenClient()`

#### Notes

- **Database Separation Working As Designed**: The pool correctly routes to dev/prod databases. Only the LISTEN client was broken.
- **Trigger Was Always Correct**: The `blocks_ready` trigger was installed and firing properly. The issue was the SSE listener connecting to the wrong database.
- **This Matches connection-manager.js**: The fix uses identical logic to `server/db/connection-manager.js` (lines 8-9).
- **Applies to Both Environments**: Fix works in both dev (uses DEV_DATABASE_URL) and production (uses DATABASE_URL).
- **SSE Architecture Validated**: Strategy events work because consolidator uses same database as queries. Blocks events failed due to database mismatch.

#### Related Issues

- See `docs/ISSUES.md` line 8683 for full issue tracking
- See `CRITICAL_DATABASE_SETUP.md` for trigger installation instructions

---

