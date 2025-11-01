# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform for Dallas-Fort Worth drivers, designed to maximize earnings through real-time, data-driven strategic briefings. It integrates various data sources (location, events, traffic, weather, air quality) and uses a multi-AI pipeline to generate actionable strategies for optimal income and time management. The project aims to provide a significant market advantage for rideshare drivers by leveraging advanced AI and data analytics.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application with a multi-service architecture, supporting both monolithic and split deployments.

**Core Services**:
-   **Gateway Server**: Manages client traffic, serves the React SPA, routes requests, and handles child processes.
-   **SDK Server**: Provides business logic via a REST API for data services (location, venue, weather, air quality) and the ML data pipeline.
-   **Agent Server**: Delivers workspace intelligence, including secure, token-based access for file system operations, shell commands, and database queries.

**AI Configuration**:
The platform uses a **role-based, model-agnostic architecture** with configurable AI models.
-   **Strategy Generation Pipeline**: An event-driven pipeline with three roles:
    - **Strategist** (`STRATEGY_STRATEGIST`): Generates initial strategic analysis (default: Claude)
    - **Briefer** (`STRATEGY_BRIEFER`): Provides real-time city intelligence (default: Gemini)
    - **Consolidator** (`STRATEGY_CONSOLIDATOR`): Combines outputs into final strategy (default: GPT-5)
-   **Model-Agnostic Schema**: Database columns use generic names (e.g., `minstrategy`, `briefing`, `consolidated_strategy`) to avoid provider-specific coupling. Environment variables use role names (`STRATEGY_STRATEGIST`, `STRATEGY_BRIEFER`, `STRATEGY_CONSOLIDATOR`) instead of provider names.
-   **Event-Driven Architecture**: PostgreSQL LISTEN/NOTIFY replaces polling, with a worker (`strategy-generator.js`) managing consolidation.
-   **Venue Events Intelligence**: An "Events Researcher" identifies real-time, venue-specific events for UI display.

**Frontend Architecture**:
A **React + TypeScript Single Page Application (SPA)**, built with Vite, uses Radix UI, TailwindCSS, and React Query.
-   **UI Layout**: Features a Strategy Section for consolidated strategies, Smart Blocks for ranked venue recommendations (with event badges, earnings, drive time, and value grades within a 15-minute perimeter), and an AI Coach.
-   **Debug Briefing Tab**: A debug view accessible via navigation tabs that displays raw database outputs from the AI pipeline, including sections for General Strategy (`minstrategy`), Traffic, News, Venues/Events (from `briefing` JSONB), and Consolidation (`consolidated_strategy`).

**Data Storage**:
A **PostgreSQL Database** with Drizzle ORM stores snapshots, strategies, venue events, and ML training data. It includes enhanced memory systems and uses unique indexes for data integrity.

**Authentication & Security**:
Uses **JWT with RS256 Asymmetric Keys**, with security middleware for rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

**Deployment & Reliability**:
Supports **Mono Mode** and **Split Mode**. Reliability features include health-gated entry points, unified port binding, proxy gating, WebSocket protection, and process discipline.

**Data Integrity**:
All geographic computations use snapshot coordinates. Missing business hours default to "unknown," and all hour calculations use venue-local timezones. Strategy refresh is triggered by location movement, day part changes, or manual refresh, and strategies have explicit validity windows and an auto-invalidation mechanism.

**Startup Configuration**:
Enforces single-process discipline with one host/port binding, readiness gated by database connectivity, and environment variables managed via `mono-mode.env` and `.env` files.

**Process Management**:
In Mono Mode, two main processes run: the **Gateway Server** (HTTP server, serves React SPA, routes API requests, manages WebSockets, no worker code) and the **Triad Worker** (`strategy-generator.js`, background job processor for strategy generation with a single-process guard).

**Strategy-First Gating & Pipeline**:
API access is gated until a strategy is ready. The pipeline involves parallel execution of Gemini and Claude, followed by GPT-5 consolidation.

**Smart Blocks Build & Perimeter Enforcement**:
Planner inputs include `user_address`, `city`, `state`, and `strategy_for_now`. Venues are matched with events by coordinates or proximity, and only blocks within a 15-minute driving perimeter are rendered.

**Locks, Job States & Indices**:
-   **Lock Semantics**: Distributed locks use a `worker_locks` table with a 9s TTL and 3s heartbeat for rapid recovery.
-   **Job State Machine**: The `triad_jobs` table tracks `queued`, `running`, `ok`, `error` states, with jobs claimed using `FOR UPDATE SKIP LOCKED`. A job seeding mechanism ensures the worker always has tasks.
-   **Unique Indices Alignment**: Critical unique indexes exist on `strategies(snapshot_id)`, `rankings(snapshot_id)`, and `ranking_candidates(snapshot_id, venue_id)` for data integrity.

## External Dependencies

### Third-Party APIs
-   **AI & Research**: Strategy pipeline uses role-based configuration via `STRATEGY_STRATEGIST`, `STRATEGY_BRIEFER`, `STRATEGY_CONSOLIDATOR` environment variables. Supported providers: Anthropic (Claude), OpenAI (GPT-5), Google (Gemini), Perplexity.
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

## Recent Changes (Nov 1, 2025)

### Role-Based Model Configuration - Nov 1, 2025 12:40 PM
**Issue**: Model names were hardcoded in adapter files, making the system inflexible and provider-coupled.

**Changes Applied**:
1. **Removed hardcoded model defaults** from all adapter files:
   - `server/lib/adapters/openai-gpt5.js` - Now requires `OPENAI_MODEL` env var
   - `server/lib/adapters/anthropic-sonnet45.js` - Now requires `ANTHROPIC_MODEL` env var
   - `server/lib/adapters/gemini-2.5-pro.js` - Now requires `GEMINI_MODEL` env var

2. **Introduced role-based environment variables** for strategy pipeline:
   - `STRATEGY_STRATEGIST` - Model for initial strategic analysis (e.g., `claude-sonnet-4-5-20250929`)
   - `STRATEGY_BRIEFER` - Model for real-time intelligence briefing (e.g., `gemini-2.5-pro`)
   - `STRATEGY_CONSOLIDATOR` - Model for final strategy consolidation (e.g., `gpt-5`)

3. **Updated strategy pipeline code** to use role-based variables:
   - `server/lib/providers/minstrategy.js` - Reads `STRATEGY_STRATEGIST`
   - `server/lib/gemini-news-briefing.js` - Reads `STRATEGY_BRIEFER`
   - `server/lib/strategy-consolidator.js` - Reads `STRATEGY_CONSOLIDATOR`

**Environment Variables Required**:
```bash
# Role-based strategy pipeline
STRATEGY_STRATEGIST=claude-sonnet-4-5-20250929
STRATEGY_BRIEFER=gemini-2.5-pro
STRATEGY_CONSOLIDATOR=gpt-5
```

**Benefits**: Models can now be swapped by changing environment variables only—no code changes required. System is truly model-agnostic and follows role-based naming instead of provider-specific coupling.

## Recent Changes (Nov 1, 2025)

### Startup Script Module Fix - Nov 1, 2025 11:39 AM
**Issue**: App crashed on startup - server wouldn't start after workflow restart.

**Root Cause**: `scripts/start-replit.js` mixed ES modules (`import`) and CommonJS (`require`) syntax in the same file, causing a runtime error:
- Line 15: `import { spawn } from 'node:child_process'` (ESM)
- Line 68: `const fs = require('fs')` (CommonJS) ❌
- Line 69: `const path = require('path')` (CommonJS) ❌
- Line 75: `const { execSync } = require('child_process')` (CommonJS, duplicate import) ❌

**Fix Applied**: Converted all `require` statements to ES module `import` statements (lines 14-21):
```javascript
import { spawn, execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

**Result**: Server starts successfully, health endpoint returns `{"ok":true,"spa":"ready","mode":"prod"}`

### Frontend Navigation Tabs
- Added NavigationTabs component with Copilot and Briefing tabs in App.tsx
- Created BriefingPage.tsx to display raw database outputs from AI pipeline
- Tabs positioned below GlobalHeader for easy switching between views

### Route Mounting Fix (gateway-server.js)
**Issue**: Frontend `/app/*` routes were mounted inside `setImmediate()` callback after heavy initialization (job seeding, strategy validation, cache warmup). This caused "Cannot GET /app/" errors when preview accessed the app before initialization completed.

**Fix**: Moved frontend route mounting (lines 293-355) to execute immediately after API routes, before background initialization. Background tasks now run in `setImmediate()` (lines 363-413) to avoid blocking the app.

**Route Order** (Mono Mode):
1. Health endpoints (`/health`, `/healthz`, `/ready`) - Lines 146-175
2. API routes (`/api/*`) - Lines 263-266 (SDK embed)
3. Agent routes (`/agent/*`) - Lines 273-275
4. Frontend routes (`/app/*`) - Lines 297-355 (immediate)
5. Background init (job seeding, validation, cache warmup) - Lines 363-413 (deferred)

### Header Positioning Fix (index.css) - Nov 1, 2025
**Issue**: Header used `position: fixed` which removed it from document flow, causing all page content (NavigationTabs, landing page) to render underneath the header and be visually blocked. Only the header was visible on screen.

**Root Cause**: `.vecto-header-stack` had `position: fixed; top: 0; z-index: 9999` while main content tried to compensate with `padding-top: 120px`, but the offset wasn't working correctly.

**Fix Applied** (client/src/index.css):
1. Changed `.vecto-header-stack` from `position: fixed` to `position: static` (line 115)
2. Removed `top`, `left`, `right`, `z-index` positioning (header now in normal flow)
3. Changed `.main-content-with-header` from `padding-top: 120px` to `padding-top: 0` (line 131)
4. Updated `html, body, #root` to use `height: auto; min-height: 100%; overflow: auto` (lines 83-87)

**Result**: Header flows normally in document layout. All content (tabs, pages) renders beneath header and is fully visible and scrollable.

**Build**: Client rebuilt with `npm run build:client` - new bundle: `index-D4hBqnqV.css` (73.94 kB)

### Known Issues

#### Workflow Restart Fix - Preventing "Cannot GET /app/" Errors
**Status**: PARTIALLY IMPLEMENTED - Two of three fixes applied

**Root Cause**: When workflow restarts, Replit preview can show cached "Cannot GET /app/" because:
1. Client build (`client/dist`) may not exist when server starts
2. No Cache-Control headers prevented browser/proxy from serving stale error pages
3. Preview opened before SPA files were available

**Fixes Applied** (Nov 1, 2025):

✅ **1. Cache-Control Headers Added** (gateway-server.js lines 167-173):
```javascript
// Prevent caching of SPA shell to avoid stale "Cannot GET" pages
app.use((req, res, next) => {
  if (req.path === '/' || req.path.startsWith('/app')) {
    res.set('Cache-Control', 'no-store, must-revalidate');
  }
  next();
});
```

✅ **2. Health Endpoint with Client Build Check** (gateway-server.js lines 152-165):
```javascript
app.get('/healthz', async (_req, res) => {
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const { existsSync } = await import('fs');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const clientDist = path.join(__dirname, 'client/dist');
  const indexPath = path.join(clientDist, 'index.html');
  
  if (existsSync(indexPath)) {
    return res.status(200).json({ ok: true, spa: 'ready', mode: isDev ? 'dev' : 'prod', ts: Date.now() });
  }
  return res.status(503).json({ ok: false, spa: 'missing', mode: isDev ? 'dev' : 'prod', ts: Date.now() });
});
```

⚠️ **3. Build-Before-Start Script** (MANUAL STEP REQUIRED):
The `prestart:replit` script in package.json must be manually updated to build client first:
```json
"prestart:replit": "npm run build:client && npm run agent:build"
```

**Current Workaround**: Hard refresh browser after workflow restart:
- Windows/Linux: `Ctrl+Shift+R`
- Mac: `Cmd+Shift+R`
- Or open preview in new browser tab

**Already in Place**:
- ✅ Server binds to `0.0.0.0` (all interfaces) on port from `process.env.PORT` (gateway-server.js line 194)
- ✅ Root `/` redirects to `/app/` (gateway-server.js lines 175-178)
- ✅ Frontend routes mounted early before heavy initialization (lines 290-352)