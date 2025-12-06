# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform designed to maximize rideshare driver earnings. It provides real-time, data-driven strategic briefings by integrating diverse data sources (location, events, traffic, weather, air quality) and leveraging advanced AI and data analytics to generate actionable strategies for drivers. The platform aims to help rideshare drivers earn more in less time with transparent guidance, with ambitions for continuous expansion to new markets and improved quality of life for individuals.

## User Preferences
Preferred communication style: Simple, everyday language. Do not say "done" until features are actually verified working.

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

**RESOLVED (December 6, 2025 - Initial Fix)**

### Problem
SmartBlocks waterfall was completing successfully on the server and generating venue recommendations with full enrichment data, but the frontend couldn't fetch them from the API. Frontend errors: `Failed to execute 'json' on 'Response': Unexpected token '<'` (HTML error response instead of JSON).

### Root Cause
**Missing JWT Authentication Headers** - The frontend POST and GET requests to `/api/blocks-fast` were not including the `Authorization: Bearer <token>` header, causing the backend to reject requests and return HTML error pages instead of JSON responses.

### Solution
Added JWT authentication headers to both SmartBlocks API requests in `client/src/pages/co-pilot.tsx`:

**File: `client/src/pages/co-pilot.tsx`**
- **Line 199-203**: Created `getAuthHeader()` helper function to retrieve JWT token from localStorage
- **Line 219**: POST request to `/api/blocks-fast` waterfall now includes `...getAuthHeader()`
- **Line 586**: GET request to `/api/blocks-fast?snapshotId=...` retrieval now includes `...getAuthHeader()`

**Related File: `server/routes/blocks-fast.js`**
- **Line 187**: Replaced `validateBody(blocksRequestSchema)` middleware with manual UUID validation to avoid HTML error pages from middleware

### Result
✅ SmartBlocks now load and render successfully:
- **5 venue recommendations** appear on the Venues tab
- Each block displays: venue name, address, distance, drive time, value per minute, grade (A/B/C), and pro tips
- Frontend logs confirm: `✅ SmartBlocks rendering: { count: 5, firstBlock: "Kroger Marketplace (Main St & FM 423)" }`
- Full data enrichment pipeline working: Strategy → Consolidation → SmartBlocks Generation → Database Persistence → Frontend Retrieval

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