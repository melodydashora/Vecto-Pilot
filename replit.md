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
The platform uses a model-agnostic architecture with configurable AI models.
-   **Strategy Generation Pipeline**: An event-driven pipeline where Minstrategy (Claude) generates initial analysis, Briefing (Gemini) provides real-time city intelligence, and Consolidator (GPT-5) combines their outputs. This process is triggered by PostgreSQL LISTEN/NOTIFY.
-   **Model-Agnostic Schema**: Database columns use generic names (e.g., `minstrategy`, `briefing`, `consolidated_strategy`) to avoid provider-specific coupling.
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

## Recent Changes (Nov 1, 2025)

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

#### Browser Cache Shows Stale "Cannot GET /app/" Error After Workflow Restart
**Status**: ACTIVE - Requires implementation of build-before-start workflow

**Current Issue**: When workflow restarts, Replit preview shows cached "Cannot GET /app/" even though server is working. This happens because:
1. Client build (`client/dist`) may not exist or be stale when server starts
2. No Cache-Control headers prevent browser/proxy from serving stale error pages
3. Preview opens before SPA files are available

**Immediate Workaround**: Hard refresh browser to clear cached error page:
- Windows/Linux: `Ctrl+Shift+R`
- Mac: `Cmd+Shift+R`
- Or open preview in new browser tab (not embedded webview)

**Permanent Fix Required** (not yet implemented):

1. **Add client build to start script** (package.json):
```json
"scripts": {
  "build:client": "vite build",
  "start:server": "node gateway-server.js",
  "start:replit": "npm run build:client && npm run prestart:replit && node scripts/start-replit.js"
}
```

2. **Add Cache-Control headers** (gateway-server.js):
```javascript
// Prevent caching of SPA shell to avoid stale "Cannot GET" pages
app.use((req, res, next) => {
  if (req.path === '/' || req.path.startsWith('/app')) {
    res.set('Cache-Control', 'no-store, must-revalidate');
  }
  next();
});
```

3. **Add client/dist existence check** to health endpoint:
```javascript
app.get('/healthz', (req, res) => {
  const indexPath = path.join(clientDist, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.status(200).json({ ok: true, spa: 'ready' });
  }
  return res.status(503).json({ ok: false, spa: 'missing' });
});
```

**Why This Works**:
- Build step ensures `client/dist` exists before server advertises routes
- Cache-Control prevents Replit proxy and browser from serving stale error pages
- Health check gates readiness until SPA is actually available
- Early route mounting (already implemented lines 290-352) serves SPA immediately once built