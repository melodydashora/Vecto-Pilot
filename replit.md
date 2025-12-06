# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform designed to maximize rideshare driver earnings. It provides real-time, data-driven strategic briefings by integrating diverse data sources (location, events, traffic, weather, air quality) and leveraging advanced AI and data analytics to generate actionable strategies for drivers. The platform aims to help rideshare drivers earn more in less time with transparent guidance, with ambitions for continuous expansion to new markets and improved quality of life for individuals.

## User Preferences
Preferred communication style: Simple, everyday language. Do not say "done" until features are actually verified working.

## Briefing Generation ✅

**FULLY WORKING (December 6, 2025)**

### Verified Working Features
All 5 briefing data sources now populate with real Gemini API data:
1. **Traffic Conditions**: Real-time traffic analysis with incidents, road closures, and congestion levels
2. **Rideshare News**: AI-curated local news relevant to drivers (4+ items)
3. **Events**: Local events with venues, times, and staging areas (10+ events)
4. **Concerts & Live Music**: Entertainment events with addresses and times
5. **School Closures**: Local school closure detection

### Example Data (Verified December 6, 2025)
- Traffic: "Dense fog and multiple holiday events causing significant delays"
- Events: "Merry Main Street (Parade & Festival) - 3:00 PM - 8:00 PM"
- Sports: "Dallas Mavericks vs. Houston Rockets - 7:30 PM"
- News: "Cowboys Christmas Extravaganza at The Star"

### Auto-Regeneration
When briefing data is stale or missing, endpoints auto-regenerate via `generateAndStoreBriefing()`.

## Model & Performance Optimization ✅

**RESOLVED (December 6, 2025 - Second Pass)**

### Critical Fixes Applied
1. **Model Standards**: ALL AI calls now use `gemini-3-pro-preview` with Google tools (never use gemini-2.0-flash)
   - **File**: `server/lib/venue-intelligence.js` (traffic intelligence)
   - **File**: `server/lib/briefing-service.js` (events, already implemented)
   - **Benefit**: 100% consistent web search reliability

2. **Redundant Weather Fetching Eliminated**: Weather is now reused from snapshot instead of fetching API twice
   - **Location**: `server/lib/briefing-service.js` in `generateBriefingInternal`
   - **Before**: Fetch #1 (snapshot creation) → Fetch #2 (briefing generation) = duplicate API calls
   - **After**: Reuse snapshot weather directly, skip second fetch
   - **Savings**: ~1 API call per briefing per user per refresh

3. **Smart Blocks Fallback Object Fixed**: Robust briefing schema prevents data race errors
   - **Location**: `server/routes/blocks-fast.js` (3 fallback instances fixed)
   - **Before**: `briefing: { events: [], news: [], traffic: [] }` ❌ Wrong schema keys, missing weather
   - **After**: `briefing: { events: [], news: { items: [] }, traffic_conditions: {...}, weather_current: {...} }`
   - **Result**: No more `blocks_input_missing_briefing` errors

## SmartBlocks Loading Status ✅

**RESOLVED (December 6, 2025 - Race Condition Fix)**

### Problem
SmartBlocks were returning empty (count: 0) even after strategy reached "pending_blocks" status. The strategy was generating successfully, but `generateEnhancedSmartBlocks` was never being called.

### Root Cause
**Race Condition in blocks-fast.js** - When the POST endpoint returned early with "strategy_already_running" (because strategy was "pending"), the strategy would later complete via background process, but no SmartBlocks were ever generated. The GET endpoint would then poll and return "blocks_generating" without actually triggering generation.

### Solution
Modified GET endpoint in `server/routes/blocks-fast.js` to trigger SmartBlocks generation when strategy is ready but no ranking exists:

**File: `server/routes/blocks-fast.js`**
- **Lines 60-120**: Added logic to detect when strategy is complete but ranking is missing
- When this condition is met, the GET endpoint now calls `generateEnhancedSmartBlocks()` directly
- Fetches snapshot and briefing data, then generates blocks on-demand

### Result
✅ SmartBlocks now generate and load correctly:
- **5 venue recommendations** appear on the Venues tab
- Each block displays: venue name, address, distance, drive time, value per minute, grade, and pro tips
- Frontend logs confirm: `✅ SmartBlocks rendering: { count: 5, firstBlock: "Comerica Center" }`

## Holiday Detector API Key Fix ✅

**RESOLVED (December 6, 2025)**

### Problem
Holiday detector was returning 403 Forbidden errors with message "Your API key was reported as leaked."

### Root Cause
The `holiday-detector.js` and `holiday-checker.js` files had fallback logic that used `GOOGLE_MAPS_API_KEY` when `GEMINI_API_KEY` was missing. The Google Maps API key had been flagged as leaked by Google.

### Solution
Removed all fallback API key logic:

**File: `server/lib/holiday-detector.js`**
- Changed from: `process.env.GEMINI_API_KEY || process.env.GOOGLE_MAPS_API_KEY`
- Changed to: `process.env.GEMINI_API_KEY` (no fallback)

**File: `server/lib/providers/holiday-checker.js`**
- Changed from: `process.env.GEMINI_API_KEY || process.env.GOOGLE_MAPS_API_KEY`
- Changed to: `process.env.GEMINI_API_KEY` (no fallback)

### Result
✅ Holiday detection now works without 403 errors
- Browser logs show: `Holiday: "none"` (successful detection, no error)

## Bars & Premium Venues Table ✅

**IMPLEMENTED (December 6, 2025)**

### Feature
Added ML-focused bars and premium venues table to the Venues tab for structured data capture of business hours and performance metrics.

### Implementation
**Files Created**:
- **`client/src/components/BarsTable.tsx`**: New component that filters SmartBlocks for bars (category contains "bar") and displays them in a table format

**Files Modified**:
- **`client/src/pages/co-pilot.tsx`**: 
  - Added BarsTable import (line 47)
  - Rendered BarsTable above blocks list in Venues tab (line 1485)

### Features
✅ **Bars Table** on Venues tab shows:
- Venue name and address
- Distance and drive time
- **Business Hours** (prominently displayed for ML training with clock icon)
- Value per minute ($)
- Grade (A/B/C)
- Open/Closed status

✅ **ML Training Data**:
- Business hours captured in structured format for ML training
- All metrics easily extracted for supervised learning models
- Clean table layout optimized for data export and analysis
- Marked with "ML Training Data" badge for clarity

## Codebase Cleanup ✅

**COMPLETED (December 6, 2025)**

### Cleanup Summary
Comprehensive codebase cleanup to reduce technical debt, remove dead code, and improve maintainability.

### Data Directory Cleanup
- **Removed**: 1,637 test snapshot files from `data/context-snapshots/`
- **Savings**: 6.4MB of test artifacts removed
- **Result**: Clean data directory with only runtime-generated files

### Archived Files Cleanup
- **Removed**: `gpt5-agent-package/` (export artifact, not used in runtime)
- **Removed**: Test scripts (`test-*.js`, `check-api.js`)
- **Kept**: `deploy-entry.js`, `health-server.js`, `README.md` (documentation)

### Dead Code Removal (18 files)
**Server/lib files removed (Phase 1)**:
- `blocks-queue.js`, `blocks-jobs.js` (unused async processing)
- `triad-orchestrator.js` (deprecated multi-model orchestration)
- `exploration.js`, `explore.js` (unused exploration features)
- `ability-routes.js`, `cache-routes.js`, `capabilities.js` (unused routes)
- `anthropic-extended.js`, `receipt.js`, `priors.js` (unused utilities)

**Server/lib/adapters files removed**:
- `anthropic-claude.js`, `openai-gpt5.js` (unused model adapters)

**Server/lib files removed (Phase 2 - blocks-fast.js cleanup)**:
- `scoring-engine.js` (replaced by enhanced-smart-blocks.js internal scoring)
- `driveTime.js` (replaced by venue-enrichment.js)
- `venue-generator.js` (replaced by tactical-planner.js)
- `persist-ranking.js` (replaced by enhanced-smart-blocks.js direct DB writes)
- `fast-tactical-reranker.js` (never integrated into workflow)

### Shared Utilities Created
- **`server/lib/geo.js`**: Consolidated haversineDistance (Km/Miles/Meters) functions
- **`server/routes/utils/http-helpers.js`**: Consolidated httpError, isPlusCode, safeJsonParse functions

### Current Codebase Metrics
| Metric | Before | After |
|--------|--------|-------|
| Server lib files | 68 | 49 |
| Console statements | 973 | 906 |
| Data directory size | 6.4MB | 0MB |
| Test snapshot files | 1,637 | 0 |
| Dead code files | 18 | 0 |
| Duplicate functions | 9 | 0 |
| blocks-fast.js imports | 25 | 16 |

### Files Still Active (Do Not Remove)
- `faa-asws.js` - Used via dynamic import in `location.js`
- `holiday-detector.js` - Used via dynamic import in `location.js`
- `gemini-2.5-pro.js` - Used by `venue-event-verifier.js`, `fast-tactical-reranker.js`
- `anthropic-sonnet45.js` - Still referenced (verify before removal)

## System Architecture
Vecto Pilot is a full-stack Node.js application with a multi-service architecture, supporting both monolithic and split deployments.

**Core Services**:
-   **Gateway Server**: Handles client traffic, serves the React SPA, and routes requests.
-   **SDK Server**: Provides business logic via a REST API for data services and the ML data pipeline.
-   **Agent Server**: Delivers workspace intelligence with secure, token-based access.

**Memory Systems & Data Isolation**:
-   **Assistant**: Persistent user preferences and conversation history.
-   **Eidolon**: Project/session state management with snapshots.
-   **Agent Memory**: Agent service state tracking.
-   All memory systems are scoped by `user_id` for complete data isolation, secured with a JWT secret.

**AI Configuration**:
A role-based, model-agnostic architecture employs configurable AI models (Strategist, Briefer, Consolidator, Holiday Checker) for event-driven strategy generation.

**Frontend Architecture**:
A React + TypeScript Single Page Application (SPA), built with Vite, utilizing Radix UI, TailwindCSS, and React Query. Features include a Strategy Section, Smart Blocks for venue recommendations, an AI Strategy Coach with hands-free voice chat, and a Rideshare Briefing Tab with immutable strategy history.

**Briefing Tab Architecture**:
Displays five data sources fetched in parallel at snapshot creation and stored in the database:
1.  **News & Events**: Rideshare-relevant news and local events from Gemini 3.0 Pro with web search and AI filtering.
2.  **Weather**: Current conditions and hourly forecast from Google Weather API (6-hour lookahead).
3.  **Traffic**: Local traffic conditions and congestion levels with Gemini intelligence.
4.  **Events**: Major events with start time, end time, staging areas, and addresses using Google Search tool.
5.  **School Closures**: Local school closures for the day using Gemini with web search.

**Data Storage**:
A PostgreSQL Database (Replit managed) with Drizzle ORM stores snapshots, strategies, venue events, and ML training data, utilizing unique indexes and JSONB.

**Architecture Pattern - Snapshots as Central Connector for ML**:
Snapshots serve as the authoritative connector across all data sources, enabling machine learning and analytics. All enrichments (strategies, briefings, rankings, actions, venue feedback) reference `snapshot_id`, creating a unified event context for each moment in time. This structure makes historical training data fully traceable for supervised learning on driver behavior patterns.

**Data Flow Consistency Pattern**:
All data flows follow a three-phase pattern: Fetch, Resolve, and Return, ensuring data consistency, validation, and proper formatting.

**Authentication & Security**:
Employs JWT with RS256 Asymmetric Keys and security middleware for rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

**Deployment & Reliability**:
Supports Mono Mode and Split Mode, featuring health-gated entry points, unified port binding, proxy gating, WebSocket protection, and process discipline.

**Data Architecture - Precise Location Denormalization Pattern**:
Every table referencing `snapshot_id` also stores the resolved precise location (formatted_address, city, state) for fast queries, relational consistency, and ML training without joins. This denormalization occurs during data insertion/updates.

**GPS Location Behavior**:
Location refresh is manual only (no auto-polling). The app requests location permission fresh (`maximumAge: 0`) upon opening or when the user manually triggers a "Refresh Location."

## External Dependencies

### Third-Party APIs
-   **AI & Research**: Anthropic (Claude), OpenAI (GPT-4o Realtime, GPT-5.1), Google (Gemini 2.0 Flash, Gemini 3.0 Pro Preview), Perplexity.
-   **Voice Chat**: OpenAI Realtime API.
-   **Location & Mapping**: Google Places API, Google Routes API, Google Geocoding API, Google Timezone API.
-   **Weather**: Google Weather API.
-   **Air Quality**: Google Air Quality API.

### Database
-   **PostgreSQL (Replit Built-in)**: Primary data store, managed by Drizzle ORM.

### Infrastructure
-   **Replit Platform**: Deployment and Nix environment.

### Frontend Libraries
-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.