# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform designed for Dallas-Fort Worth rideshare drivers. Its primary goal is to maximize driver earnings by providing real-time strategic briefings. The platform achieves this by integrating and analyzing location intelligence, venue events, traffic, weather, and air quality data. It leverages a multi-AI pipeline to generate actionable strategies, delivered through a React-based web interface, enabling drivers to make data-driven decisions to increase their income.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application built with a multi-service architecture, supporting both monolithic (mono) and split deployment.

### Core Services
-   **Gateway Server**: Handles client traffic (HTTP/WebSocket), serves the React SPA, routes requests, and manages child processes in split mode.
-   **SDK Server**: Contains the business logic, providing a REST API for data services (location, venue, weather, air quality), snapshot creation, and the ML data pipeline.
-   **Agent Server**: Manages workspace intelligence, offering secure, token-based access to file system operations, shell commands, and database queries.

### AI Configuration
A three-stage AI pipeline generates strategic briefings:
1.  **Claude Opus 4.1**: Performs initial strategic analysis from snapshot data.
2.  **Gemini 2.5 Pro**: Provides local news briefings in JSON format.
3.  **GPT-5**: Consolidates outputs into the final actionable intelligence.
Model configurations are centralized, and news briefings are stored for UI display.

### Frontend Architecture
The user interface is a **React + TypeScript Single Page Application (SPA)** developed with Vite. It utilizes Radix UI for accessible components, TailwindCSS for styling, and React Query for server state management.

### Data Storage
A **PostgreSQL Database** serves as the primary data store, with Drizzle ORM managing the schema. It includes tables for snapshots, strategies, venue events, and ML training data. The system uses enhanced memory systems: `cross_thread_memory` for system-wide state, `eidolon_memory` for agent-scoped sessions, and `assistant_memory` for user preferences.

### Authentication & Security
The system employs **JWT with RS256 Asymmetric Keys**, featuring a 15-minute token expiry and 90-day key rotation. Security middleware includes rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

### API Structure
APIs are categorized into:
-   **Location Services**: Geocoding, timezone, weather, air quality, location snapshots.
-   **Venue Intelligence**: Venue search, event research, smart block strategy generation.
-   **Diagnostics & Health**: Service health, memory diagnostics, job metrics.
-   **Agent Capabilities**: Secure endpoints for file system operations, shell execution, database queries, and memory management.

### Deployment & Preview Reliability
The system supports both **Mono Mode** (single process) and **Split Mode** (gateway spawns SDK and Agent as child processes) to offer deployment flexibility, including on Replit.

**Preview Reliability Architecture:**
-   **Canonical Entry Point**: `scripts/start-replit.js` spawns gateway-server.js with health gate
-   **PORT Binding**: Deterministic binding to port 5000 (ENV var configurable)
-   **Health Gate**: Health polling at `/api/health` ensures preview only resolves when server is ready
-   **Zombie Process Cleanup**: `start-clean.sh` kills leftover node processes before restart
-   **Artifact Discipline**: `dist/` contains only agent TypeScript build output (`index.js`, `agent-ai-config.js`); server runs from canonical `server/*.js` sources
-   **Fast-Fail Boot**: Server exits immediately on bind errors or missing strategy providers
-   **Health Endpoints**: `/health`, `/api/health`, `/healthz`, `/ready` for different monitoring needs

### Data Integrity & Coordinate-First Policy
All geographic computations must originate from snapshot coordinates. Names are for display only. All enrichment operations must be completed before returning a 200 OK. **Missing business hours default to "unknown" and never "closed"** - this prevents false "closed" states (e.g., IKEA showing closed when hours data is unavailable). All hour calculations use the venue-local timezone. Error responses consistently include `error`, `message`, and `correlationId`.

### Address & Origin Invariance Policy
The driver's precise address must be captured once, normalized to rooftop geocoding precision, and propagated unchanged through the entire pipeline (Strategy → Planner → Enrichment → DB → UI). All stages must read the origin from the snapshot; re-geocoding or substitution is not allowed. The system requires rooftop precision geocoding for all addresses.

## External Dependencies

### Third-Party APIs
-   **AI & Research**: Anthropic API (Claude), OpenAI API (GPT-5), Google Gemini API, Perplexity API.
-   **Location & Mapping**: Google Maps API (Routes API, Places API, Text Search API).
-   **Weather and Air Quality**: Configured via environment variables.

### Database
-   **PostgreSQL**: Primary data store, schema managed by Drizzle ORM, with support for vector database capabilities and Row-Level Security (RLS).

### Infrastructure
-   **Replit Platform**: Used for deployment, Nix environment, and `.replit` workflow configuration.
-   **Process Management**: Node.js `child_process` for multi-process environments, `http-proxy` for routing.

### Frontend Libraries
-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.

## AI Coach/Companion Data Access

### Full Context Integration (2025-10-30)
The AI Coach (chat endpoint) has been enhanced to receive complete driver context for highly personalized responses:

**What Coach Can Access:**
1. **Full Snapshot Data** (snapshots table):
   - Location: lat/lng, city, state, timezone, formatted_address
   - Time: local_iso, day_part_key, hour (for time-aware advice)
   - Weather: temperature, conditions, description
   - Air Quality: AQI, category
   - Airport: name, code, distance, driving_status
   - News Briefing: Gemini's 60-min intel (0:15 Airports, 0:30 Traffic, 0:45 Events, 1:00 Policy)
   - Local News: Perplexity daily news affecting rideshare

2. **Full Strategy Data** (strategies table):
   - strategy: Full Claude Opus 4.1 strategic analysis
   - strategy_for_now: Full GPT-5 tactical briefing
   - Model metadata: name, params, prompt version

3. **Full Blocks/Rankings** (ranking_candidates table):
   - All venue fields: name, lat/lng, place_id, address, category
   - Distance & Time: drive_time_min, distance_miles, driveTimeMinutes
   - Earnings: est_earnings_per_ride, earnings_per_mile, value_per_min, value_grade
   - Pro Tips: GPT-5 tactical tips array
   - Staging Tips: Parking and staging guidance
   - **Event Data**: Full Perplexity venue_events JSONB (summary, badge, citations, impact_level)
   - Business Hours: Open/closed status, businessHours string
   - User Feedback: up_count, down_count aggregates

4. **UI Integration**:
   - Event tooltips: Info icon reveals full Perplexity event summary with impact level
   - All user-visible data + additional database fields for deeper analysis

**Data Flow:**
- Frontend sends full blocks array (not just name/category/address)
- Backend enriches with snapshot weather, air quality, airport intel, news briefings
- Coach receives ~100+ data points vs previous ~9 (1100% increase in context)

**Example Coach Response Capabilities:**
- "Legacy Hall has a 🎸 Concert tonight - Hall-O-Ween Bash with Emerald City Band. Large crowd expected, high surge likely ($2.1x). Stage in Lexus Box Garden parking (2-min walk)."
- Weather-aware: "It's 59°F and clear - perfect for outdoor staging at Trinity Groves"
- Traffic-aware: "Avoid I-35 south - major accident at Exit 428 (from 60-min briefing)"
- Pattern recognition: "You gave this venue 👍 last time - matches your preference for event hotspots"

See COACH_DATA_ACCESS.md for comprehensive field inventory.

## Code Hygiene & Import Management

### Unused Import Policy
**Rule: Use it, remove it, or annotate it with expiry**

All unused imports must be:
1. **Removed** if no longer needed, with documentation in this file
2. **Annotated** with `@reason` and `expiry: YYYY-MM-DD` if intentionally staged
3. **Documented** with strikethrough history showing when and why removed

### Import History (Strikethrough Record)

#### ~~`getPlaceHours`, `findPlaceIdByText` in venue-enrichment.js~~ (Removed 2025-10-30)
- **Status**: Removed - were greyed/unused imports
- **Reason**: Hours normalization moved to `getPlaceDetails()` local function in venue-enrichment.js; these helpers only used in venue-discovery.js
- **History**: Imported from places-hours.js but never called in venue-enrichment.js
- **Resolution**: Removed import, added annotation comment documenting removal
- **CorrelationId**: ENRICH-412
- **Still Used In**: server/lib/venue-discovery.js (legitimate usage remains)

## Preview Reliability Status

### Current State: ⚠️ Preview Not Resolving
**Issue**: Workflow configuration not using health-gated entry point

### Root Cause
The `.replit` workflow runs `node gateway-server.js` directly without health gating. Preview may be waiting for a signal that never comes.

**Current Configuration:**
```ini
[[workflows.workflow.tasks]]
task = "shell.exec"
args = "set -a && source mono-mode.env && set +a && node gateway-server.js"
```

**What We Built:**
- ✅ `scripts/start-replit.js` with health gate polling `/api/health`
- ✅ `/api/health` endpoint in gateway-server.js
- ✅ `start-clean.sh` for zombie process cleanup
- ✅ Strategy provider validation on boot

**What's Missing:**
- ⚠️ `.replit` workflow not using the health-gated entry point (file is restricted from automated edits)
- ⚠️ `package.json` scripts need `start:replit` added (file is restricted from automated edits)

### Manual Configuration Required

#### 1. Update `.replit` Workflow
Change line 31 in `.replit` from:
```ini
args = "set -a && source mono-mode.env && set +a && node gateway-server.js"
```

To use health-gated entry:
```ini
args = "set -a && source mono-mode.env && set +a && npm run start:replit"
```

Or for zombie cleanup:
```ini
args = "set -a && source mono-mode.env && set +a && ./start-clean.sh"
```

#### 2. Add `package.json` Scripts
Add to the `"scripts"` section:
```json
"prestart:replit": "npm run agent:build",
"start:replit": "node scripts/start-replit.js"
```

### Testing Preview Resolution
After manual configuration:
1. Restart workflow
2. Wait for `[boot] ✅ Health check passed` in logs
3. Preview should auto-resolve when health gate succeeds
4. Verify: `curl http://localhost:5000/api/health` returns `{"ok":true,"port":5000,"mode":"mono"}`