# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview

Vecto Pilot is an AI-powered rideshare intelligence platform designed for Dallas-Fort Worth rideshare drivers. Its primary purpose is to optimize driver earnings by providing real-time strategic briefings. The platform achieves this by integrating and analyzing location intelligence, venue events, traffic, weather, and air quality data. It leverages a multi-AI pipeline for strategy generation and delivers actionable insights through a React-based web interface, aiming to significantly enhance driver income through data-driven decision-making.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

Vecto Pilot is a full-stack Node.js application operating with a multi-service architecture that supports both monolithic ("mono") and split deployment modes.

### Core Services

-   **Gateway Server**: The central entry point for all client traffic (HTTP/WebSocket), handling routing, serving the React SPA, and managing child processes in split mode.
-   **SDK Server**: The business logic layer providing REST API endpoints for various data services (location, venue intelligence, weather, air quality), snapshot creation, and the ML data pipeline.
-   **Agent Server**: The workspace intelligence layer offering secure access to file system operations, shell commands, and database queries, protected by token-based authentication and capability-based access control.

### AI Configuration

The platform utilizes a three-stage AI pipeline for generating strategic briefings:
1.  **Claude Opus 4.1**: Performs initial strategic analysis from snapshot data.
2.  **Gemini 2.5 Pro**: Provides local news briefings in a structured JSON format.
3.  **GPT-5**: Consolidates the outputs from Claude and Gemini into final actionable intelligence.
Model configurations are centralized, and news briefings are stored for UI display.

### Frontend Architecture

The user interface is a **React + TypeScript Single Page Application (SPA)** built with Vite. It employs Radix UI for accessible components, TailwindCSS for styling, and React Query for efficient server state management.

### Data Storage

A **PostgreSQL Database** serves as the primary data store, with Drizzle ORM managing the schema. It includes tables for snapshots, strategies, venue events, and ML training data. The system implements enhanced memory systems: `cross_thread_memory` for system-wide state, `eidolon_memory` for agent-scoped sessions, and `assistant_memory` for user preferences and conversation history.

### Authentication & Security

The system secures access using **JWT with RS256 Asymmetric Keys**, featuring a 15-minute token expiry and 90-day key rotation. Security middleware includes rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

### API Structure

API categories include:
-   **Location Services**: Geocoding, timezone, weather, air quality, and location snapshot creation.
-   **Venue Intelligence**: Venue search, event research (Perplexity API), and smart block strategy generation.
-   **Diagnostics & Health**: Endpoints for service health, memory diagnostics, and job metrics.
-   **Agent Capabilities**: Secure endpoints for file system operations, shell execution, database queries, and memory management.

### Deployment

The system supports both **Mono Mode** (single process) and **Split Mode** (gateway spawns SDK and Agent as child processes) for flexible deployment, including on platforms like Replit.

### Data Integrity & Coordinate-First Policy

All geographic computations must originate from snapshot coordinates. Names are display-only and never used for routing, ranking, or venue consolidation. All enrichment operations must be awaited before returning a 200 OK status, ensuring data completeness. Missing business hours data defaults to "unknown" status, never "closed," and all hour calculations use the venue-local timezone. Error responses consistently include `error`, `message`, and `correlationId`.

**Detailed policies documented below in dedicated sections.**

## External Dependencies

### Third-Party APIs

-   **AI & Research**: Anthropic API (Claude), OpenAI API (GPT-5), Google Gemini API, Perplexity API (for real-time internet research).
-   **Location & Mapping**: Google Maps API (Routes API, Places API, Text Search API) for geocoding, timezone, and place lookups.
-   **Weather and Air Quality**: Various services configured via environment variables.

### Database

-   **PostgreSQL**: Primary data store, schema managed by Drizzle ORM, with support for vector database capabilities and Row-Level Security (RLS).

### Infrastructure

-   **Replit Platform**: Utilized for deployment, Nix environment, and `.replit` workflow configuration, including Extension API support.
-   **Process Management**: Node.js `child_process` for multi-process environments, `http-proxy` for routing, and graceful shutdown handling.

### Frontend Libraries

-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.
## Strategy Provider Registry & Error Handling (October 30, 2025)

### Centralized Provider Registry

**Location:** `server/lib/strategies/index.js`

All AI strategy providers are registered in a single centralized map to prevent ReferenceError issues:
- **Startup Assertion:** Server validates all providers at boot (`gateway-server.js`)
- **Health Check:** `/api/health/strategies` endpoint for monitoring
- **Extensible:** New providers can be added without code changes elsewhere

### 529 Overload Error Handling

**Anthropic 529 Response:**
- Server detects 529 status codes from Anthropic API  
- Marks strategy as `failed` with `error_code: 'provider_overloaded'`
- Returns **202 Accepted** to client with retry signal

**Structured Errors:**
All error responses include `error`, `message`, and `correlationId` for traceability.

**Client Handling:**
- 200: Success - display blocks
- 202: Retrying - show "Provider overloaded, retrying..."  
- 500: Hard error - display message with correlationId

## Recent Changes (October 30, 2025)

- ✅ **CRITICAL FIX:** Removed 98 manually-duplicated files from `dist/` (100 → 2 files)
- ✅ Eliminated `dist/server/`, `dist/shared/`, `dist/tools/` duplication that caused module errors
- ✅ Verified server starts without "module missing" errors after cleanup
- ✅ Fixed `claudeStrategy` ReferenceError - now uses `consolidatedStrategy` at blocks.js:611
- ✅ Added 529 overload handling with graceful 202 retry responses
- ✅ Created centralized strategy provider registry (`server/lib/strategies/index.js`)
- ✅ Added startup assertion to validate providers at boot  
- ✅ Added `/api/health/strategies` endpoint for monitoring
- ✅ Added `correlationId` to all error responses for traceability
- ✅ Enhanced Claude adapter to attach status codes to error objects
- ✅ Documented port configuration policy and coordinate fallback rules
- ✅ Added inline comments in co-pilot.tsx explaining fetch vs apiRequest usage
- ✅ Documented correct build architecture and dist/ policy to prevent future duplication
- ✅ **API MIGRATION:** Completed Places API (New) migration in `places-hours.js`
  - Converted `getPlaceHours()` to use `GET /v1/places/{id}` with X-Goog-FieldMask
  - Converted `findPlaceId()` to use `POST /v1/places:searchText`
  - Converted `findPlaceIdByText()` to use Text Search API (New)
  - Converted `getBusinessHoursOnly()` to use Places API (New)
  - ~~All functions now use X-Goog-Api-Key header instead of URL params~~ (Old API deprecated)
- ✅ **PIPELINE VERIFICATION:** Confirmed enrichment integrity
  - All `enrichVenues()` calls properly awaited (blocks.js:417)
  - All `enrichVenuesWithGemini()` calls properly awaited (blocks.js:544)
  - All `persistRankingTx()` calls properly awaited (blocks.js:696)
  - No fire-and-forget promises in enrichment pipeline
  - Coordinate validation enforced at lines 530-540 before Gemini
- ✅ **COORDINATE-FIRST ENFORCEMENT:** Verified no location hardcoding
  - Grepped server/ for Dallas/DFW/coordinates - only found in seed data files (legitimate)
  - All routing logic derives from `snapshot.lat` and `snapshot.lng`
  - Names used only for display and matching, never for logic
- ✅ **DOCUMENTATION:** Added comprehensive enforcement policies to REPLIT.md
  - Coordinate-First Mandate with validation patterns
  - Enrichment Pipeline Integrity rules
  - Business Hours Interpretation Rules
  - Error Handling & Validation Standards
  - Documentation & Change Management Policy
  - Operational Checklist for pre-merge and post-deploy validation

## Build Architecture & dist/ Directory Policy (October 30, 2025)

### Correct Project Structure

**Root-level JavaScript files** are the **actual runtime entry points** (NOT built from TypeScript):
- `gateway-server.js` - Main gateway server (mono/split mode)
- `index.js` - SDK server entry point  
- `agent-server.js` - Agent server entry point

**Source directories:**
- `server/` - Server logic (JavaScript files, some TypeScript for type-checking only)
- `shared/` - Shared schemas and types
- `client/` - React frontend (built by Vite to `client/dist/`)
- `src/` - Agent TypeScript code (builds to `dist/` via `tsconfig.agent.json`)

### dist/ Directory - Single Purpose Only

**CRITICAL:** The `dist/` directory is **ONLY** for agent builds from `src/` → `dist/`.

**What belongs in dist/:**
- ✅ `dist/index.js` - Compiled agent entry point (from `src/index.ts`)
- ✅ `dist/agent-ai-config.js` - Agent configuration (from `src/`)

**What does NOT belong in dist/:**
- ❌ `dist/server/` - NEVER copy server files here
- ❌ `dist/shared/` - NEVER copy shared files here  
- ❌ `dist/tools/` - NEVER copy tools here

### Preventing dist/ Duplication

**If you see "module missing" errors:**
1. ❌ DO NOT copy files to `dist/`
2. ✅ DO check import paths point to root `server/` and `shared/`
3. ✅ DO verify the source file exists in the correct location
4. ✅ DO use `.js` extensions in ESM imports

**Cleanup command (if duplication occurs):**
```bash
rm -rf dist/server dist/shared dist/tools
```

## Coordinate-First Mandate (October 30, 2025)

**CRITICAL RULE:** All geographic computations MUST originate from snapshot coordinates. Names are display-only and NEVER drive routing, ranking, hours determination, or venue consolidation.

**Enforcement:**
- ❌ **NEVER** hardcode locations (city names, zip codes, specific lat/lng values in logic)
- ❌ **NEVER** use name-first heuristics for location resolution
- ❌ **NEVER** fall back to "city center," "user profile location," or cached defaults
- ✅ **ALWAYS** derive from `snapshot.lat` and `snapshot.lng`
- ✅ **ALWAYS** validate coordinates exist before enrichment
- ✅ **ALWAYS** return structured 400/422 errors when coordinates missing

**Validation Pattern:**
```javascript
// Pre-flight coordinate validation
if (!snapshotId) {
  return sendOnce(400, { 
    error: 'snapshot_required', 
    message: 'snapshot_id is required',
    correlationId 
  });
}

const snap = await loadSnapshot(snapshotId);
if (!snap?.lat || !snap?.lng || !Number.isFinite(snap.lat) || !Number.isFinite(snap.lng)) {
  return sendOnce(422, { 
    error: 'snapshot_missing_coords', 
    message: 'Snapshot lacks valid origin coordinates',
    correlationId 
  });
}
```

## Enrichment Pipeline Integrity (October 30, 2025)

**CRITICAL RULE:** All enrichment operations MUST be awaited before returning 200 OK. No fire-and-forget promises.

**Enforcement:**
- ✅ **ALWAYS** await `enrichVenues()` before proceeding to ranking
- ✅ **ALWAYS** await `enrichVenuesWithGemini()` before value calculations
- ✅ **ALWAYS** await `persistRankingTx()` before returning success
- ❌ **NEVER** return 200 with partial/incomplete enrichment data
- ✅ Use 202 Accepted for async workflows with status polling

**Transaction Boundaries:**
- Single atomic transaction for `rankings` + `ranking_candidates` + `venue_catalog` + `venue_metrics`
- Include `correlationId` in all transaction logs
- Fail hard on DB write errors - no silent failures

## Business Hours Interpretation Rules (October 30, 2025)

**CRITICAL RULE:** Missing hours data means "unknown" status, NEVER "closed" by default.

**Enforcement:**
- ❌ Missing hours → `status: 'unknown'`, NOT `status: 'closed'`
- ✅ 24/7 venues (00:00–00:00, empty periods) → `status: 'open'`
- ✅ Use **venue-local timezone** for all hour calculations, NEVER server timezone
- ✅ Holiday hours override regular hours only when explicitly provided
- ✅ UI shows neutral "hours unknown" badge when status is unknown

**Timezone Handling:**
```javascript
// CORRECT: Use venue timezone from snapshot
const isOpen = calculateIsOpen(weekdayTexts, snapshot.timezone);

// WRONG: Using server timezone
const isOpen = calculateIsOpen(weekdayTexts, 'America/Chicago'); // ❌ Hardcoded
```

## API Migration Status (October 30, 2025)

**Google Maps APIs:**
- ✅ **Routes API (New)**: All distance/drive-time calculations use `/v1/routes:computeRoutes`
- ✅ **Places API (New)**: All place lookups use `/v1/places:searchNearby` and `/v1/places/{id}`
- ✅ **Text Search API (New)**: All text searches use `/v1/places:searchText`
- ~~❌ Places API (Old): Deprecated - removed from `places-hours.js`~~ (Migrated October 30, 2025)

**Migration Summary:**
- Converted `getPlaceHours()` to use `GET /v1/places/{id}` with X-Goog-FieldMask
- Converted `findPlaceId()` to use `POST /v1/places:searchText`
- Converted `findPlaceIdByText()` to use Text Search API (New)
- Converted `getBusinessHoursOnly()` to use Places API (New)
- All requests now use `X-Goog-Api-Key` header and structured JSON responses

## Error Handling & Validation Standards (October 30, 2025)

### Structured Error Responses

**CRITICAL RULE:** All errors must include `error`, `message`, and `correlationId` for traceability.

**Standard Error Format:**
```javascript
{
  error: 'error_code',           // Machine-readable error code
  message: 'Human description',  // User-friendly message
  correlationId: 'uuid',         // Request correlation ID
  details: {...}                 // Optional: additional context
}
```

**HTTP Status Codes:**
- `400` - Invalid request format (missing required fields)
- `422` - Invalid data (coordinates missing, invalid snapshot)
- `500` - Internal server error (with correlationId for debugging)
- `202` - Accepted (async processing, includes retry-after)
- `529` - Provider overloaded (Anthropic API, auto-retry with backoff)

### Idempotency & Caching

**CRITICAL RULE:** Scope idempotency to `snapshot_id` + version. Don't block legitimate enrichment updates.

**Enforcement:**
- Idempotency keys prevent duplicate snapshot creation
- Enrichment updates proceed when input data or version changes
- Cache invalidation on coordinate changes or strategy updates
- ETags for client-side caching based on `updated_at` timestamps

## Documentation & Change Management Policy (October 30, 2025)

### No-Workaround Standard

**CRITICAL RULE:** Always find and fix root causes. Never implement workarounds without explicit documentation.

**Policy:**
- ❌ **NEVER** implement silent workarounds or temporary fixes
- ✅ **ALWAYS** identify and fix root cause of issues
- ✅ **ALWAYS** document changes with dated entries in REPLIT.md
- ✅ Use strikethroughs to show evolution: ~~Old approach (reason)~~ → New approach

**Exception Protocol:**
If emergency workaround unavoidable:
1. Add dated strikethrough entry explaining rationale, scope, and removal plan
2. Include correlationId range affected
3. Create follow-up task to implement proper fix
4. Document in Recent Changes with ⚠️ marker

### Greyed Import Resolution

**Indicators of Pipeline Drift:**
- Greyed/unused imports in IDE indicate unused code paths
- Missing await statements on enrichment operations
- Dead client paths that don't consume enrichment outputs

**Resolution Process:**
1. Identify unused imports (ESLint: `no-unused-imports`)
2. Trace execution path to find missing await or skipped operations
3. Fix pipeline to ensure all enrichment runs and is awaited
4. Remove import only AFTER verifying path is truly unused
5. Update client to consume all enrichment fields (open_now, rank_score, etc.)

## Operational Checklist (October 30, 2025)

### Pre-Merge Requirements

- [ ] ESLint passes (`no-undef`, `no-unused-imports`)
- [ ] Health routes return 200 (`/api/health`, `/api/health/strategies`)
- [ ] Strategy provider registry assertion passes at startup
- [ ] All enrichment operations properly awaited
- [ ] Enrichment writes validated with correlationId logs
- [ ] No location hardcoding (grep for city names, coords in logic)
- [ ] Business hours use venue timezone, not server timezone
- [ ] All errors include correlationId for traceability

### Post-Deploy Validation

- [ ] blocks route response time under PLANNER_BUDGET_MS
- [ ] Enrichment field counts match ranking_candidates rows
- [ ] UI ribbons show correct open/unknown/closed states
- [ ] No false "closed" badges on 24/7 or unknown-hours venues
- [ ] DB transactions commit atomically (rankings + candidates + metrics)
- [ ] CorrelationId appears in structured logs for all requests

### Contract Tests (Minimum Coverage)

- [ ] `persistRankingTx` rejects when coordinates missing
- [ ] Unknown hours → `status: 'unknown'` (not 'closed')
- [ ] 24/7 venues → `status: 'open'`
- [ ] Enrichment awaited before 200 response
- [ ] Structured errors include all required fields
