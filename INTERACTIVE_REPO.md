# 🗂️ Interactive Repository Map - Vecto Pilot™

<details>
<summary>📁 <b>Root Directory</b></summary>

## Configuration Files

<details>
<summary>📄 <code>.replit</code></summary>

**Purpose**: Replit deployment configuration  
**Description**: Defines the Run button behavior, port configurations, deployment settings, and environment setup for the Replit platform. Controls how the application starts and is deployed.

**Key Settings**:
- Run command: Executes the mono-mode startup script
- Port forwarding: 5000 (local) → 80/443 (public)
- Deployment target: Autoscale
</details>

<details>
<summary>📄 <code>package.json</code></summary>

**Purpose**: Node.js project configuration and dependencies  
**Description**: Defines all npm dependencies, scripts, and project metadata. Manages both frontend (React, Vite) and backend (Express, PostgreSQL) dependencies.

**Key Scripts**:
- `npm start`: Production server
- `npm run dev`: Development mode
- `npm run build`: Build frontend
- `npm run db:push`: Sync database schema
</details>

<details>
<summary>📄 <code>mono-mode.env</code></summary>

**Purpose**: Environment variables configuration  
**Description**: Contains all API keys, database URLs, and configuration settings. **Never commit to Git** - contains sensitive credentials.

**Critical Variables**:
- `DATABASE_URL`: Neon PostgreSQL connection
- `OPENAI_API_KEY`: GPT-5 access
- `GOOGLE_MAPS_API_KEY`: Location services
- `ANTHROPIC_API_KEY`: Claude API
</details>

<details>
<summary>📄 <code>gateway-server.js</code></summary>

**Purpose**: Main application entry point (mono-mode)  
**Description**: Unified server that combines gateway proxy, Vite dev server, and API routing. Runs on port 5000 and handles all incoming traffic.

**Responsibilities**:
- Serves React SPA
- Proxies API requests
- WebSocket support
- Health checks
</details>

<details>
<summary>📄 <code>drizzle.config.js</code></summary>

**Purpose**: Database ORM configuration  
**Description**: Configures Drizzle ORM for PostgreSQL connection, schema location, and migration output directory.
</details>

<details>
<summary>📄 <code>tsconfig.json</code></summary>

**Purpose**: TypeScript compiler configuration  
**Description**: Main TypeScript configuration that extends base configs for both client and server compilation.
</details>

</details>

---

<details>
<summary>📁 <b>client/</b> - Frontend React Application</summary>

<details>
<summary>📁 <b>client/src/</b></summary>

<details>
<summary>📄 <code>App.tsx</code></summary>

**Purpose**: Root React component  
**Description**: Main application component with routing (Wouter), location provider, and query client setup. Defines all application routes.

**Routes**:
- `/co-pilot`: Main AI recommendations page
- `/briefing`: Rideshare briefing tab
</details>

<details>
<summary>📄 <code>main.tsx</code></summary>

**Purpose**: React application entry point  
**Description**: Initializes React app, mounts to DOM, and sets up global providers.
</details>

<details>
<summary>📄 <code>index.css</code></summary>

**Purpose**: Global styles  
**Description**: Tailwind CSS imports, CSS variables for theming, and base styles.
</details>

<details>
<summary>📁 <b>client/src/pages/</b></summary>

<details>
<summary>📄 <code>co-pilot.tsx</code></summary>

**Purpose**: Main AI Co-Pilot interface  
**Description**: The primary driver dashboard showing AI-powered venue recommendations ("Smart Blocks"), strategic overview, and AI Strategy Coach chat.

**Features**:
- Strategy polling from GPT-5
- Smart Blocks recommendations
- AI chat interface
- Real-time location awareness
</details>

<details>
<summary>📄 <code>BriefingPage.tsx</code></summary>

**Purpose**: Rideshare briefing interface  
**Description**: Shows consolidated strategic briefing with news, events, traffic, and holiday information.
</details>

</details>

<details>
<summary>📁 <b>client/src/components/</b></summary>

<details>
<summary>📄 <code>GlobalHeader.tsx</code></summary>

**Purpose**: Global navigation and location display  
**Description**: Persistent header showing current location, GPS status, weather, and manual city search.

**Key Features**:
- GPS coordinates display
- City override search
- Weather/AQI indicators
- Snapshot creation
</details>

<details>
<summary>📄 <code>ErrorBoundary.tsx</code></summary>

**Purpose**: React error boundary  
**Description**: Catches React component errors and displays fallback UI to prevent full app crashes.
</details>

<details>
<summary>📁 <b>client/src/components/strategy/</b></summary>

<details>
<summary>📄 <code>SmartBlocks.tsx</code></summary>

**Purpose**: Venue recommendation cards  
**Description**: Displays AI-recommended venues with earnings estimates, drive times, and navigation actions.
</details>

<details>
<summary>📄 <code>StrategyCoach.tsx</code></summary>

**Purpose**: AI chat interface  
**Description**: Chat component for conversing with the AI Strategy Coach about driving strategies.
</details>

</details>

<details>
<summary>📁 <b>client/src/components/ui/</b></summary>

**Purpose**: shadcn/ui component library  
**Description**: Reusable UI components built on Radix UI primitives with Tailwind styling.

**Key Components**:
- `button.tsx`: Button variants
- `card.tsx`: Card containers
- `dialog.tsx`: Modal dialogs
- `sheet.tsx`: Slide-out panels
- `accordion.tsx`: Collapsible sections
- `tooltip.tsx`: Hover tooltips
</details>

</details>

<details>
<summary>📁 <b>client/src/contexts/</b></summary>

<details>
<summary>📄 <code>location-context-clean.tsx</code></summary>

**Purpose**: Global location state management  
**Description**: React Context providing GPS coordinates, city override, and location refresh to entire app.

**State Managed**:
- Current GPS coordinates
- Override coordinates (manual search)
- Location session ID
- Loading states
</details>

</details>

<details>
<summary>📁 <b>client/src/lib/</b></summary>

<details>
<summary>📄 <code>queryClient.ts</code></summary>

**Purpose**: TanStack Query configuration  
**Description**: Sets up React Query client with caching, retry, and API request wrapper.
</details>

<details>
<summary>📄 <code>snapshot.ts</code></summary>

**Purpose**: Snapshot creation utility  
**Description**: Creates ML-ready context snapshots (SnapshotV1 format) with GPS, weather, time data.
</details>

<details>
<summary>📄 <code>utils.ts</code></summary>

**Purpose**: General utilities  
**Description**: Helper functions including `cn()` for className merging with Tailwind.
</details>

</details>

<details>
<summary>📁 <b>client/src/hooks/</b></summary>

<details>
<summary>📄 <code>useGeoPosition.ts</code></summary>

**Purpose**: Browser geolocation hook  
**Description**: React hook wrapping browser Geolocation API with error handling and permission management.
</details>

<details>
<summary>📄 <code>use-toast.ts</code></summary>

**Purpose**: Toast notification hook  
**Description**: Hook for displaying temporary toast notifications.
</details>

<details>
<summary>📄 <code>useStrategy.ts</code></summary>

**Purpose**: Strategy polling hook  
**Description**: Custom hook for polling strategy generation status with automatic refetch.
</details>

</details>

</details>

<details>
<summary>📄 <code>index.html</code></summary>

**Purpose**: HTML entry point  
**Description**: Root HTML file that loads the React application via Vite.
</details>

<details>
<summary>📄 <code>vite.config.ts</code></summary>

**Purpose**: Vite bundler configuration  
**Description**: Configures React plugin, HMR port, proxy settings, and build output.
</details>

</details>

---

<details>
<summary>📁 <b>server/</b> - Backend Node.js Services</summary>

<details>
<summary>📁 <b>server/routes/</b> - API Route Handlers</summary>

<details>
<summary>📄 <code>blocks.js</code></summary>

**Purpose**: Smart Blocks recommendation endpoint  
**Description**: Main API route (`POST /api/blocks`) that orchestrates the Triad pipeline (GPT-5 Strategist → GPT-5 Planner → Gemini Validator) to generate venue recommendations.

**Flow**:
1. Load snapshot + strategy
2. Call GPT-5 tactical planner
3. Enrich with Google APIs
4. Validate with Gemini
5. Persist to database
</details>

<details>
<summary>📄 <code>location.js</code></summary>

**Purpose**: Location services endpoints  
**Description**: Handles GPS resolution, geocoding, weather, AQI, and snapshot persistence.

**Endpoints**:
- `GET /api/location/resolve`: GPS → city/state
- `GET /api/location/weather`: Current weather
- `POST /api/location/snapshot`: Save context
</details>

<details>
<summary>📄 <code>actions.js</code></summary>

**Purpose**: User interaction tracking  
**Description**: Logs user actions (view, click, dismiss) for ML training data.

**Endpoint**: `POST /api/actions`
</details>

<details>
<summary>📄 <code>strategy.js</code></summary>

**Purpose**: Strategy polling endpoint  
**Description**: Allows frontend to poll strategy generation status.

**Endpoint**: `GET /api/blocks/strategy/:snapshotId`
</details>

<details>
<summary>📄 <code>chat.js</code></summary>

**Purpose**: AI Strategy Coach chat endpoint  
**Description**: Handles chat messages to the AI coach with full context awareness.

**Endpoint**: `POST /api/chat`
</details>

<details>
<summary>📄 <code>health.js</code></summary>

**Purpose**: Health check endpoints  
**Description**: Application health monitoring for deployment platforms.

**Endpoints**: `GET /health`, `GET /healthz`
</details>

</details>

<details>
<summary>📁 <b>server/lib/</b> - Core Business Logic</summary>

<details>
<summary>📄 <code>strategy-generator.js</code></summary>

**Purpose**: Background strategy generation  
**Description**: GPT-5 strategy generation with database LISTEN/NOTIFY for real-time updates.

**Process**:
1. Listen for new snapshots
2. Generate strategy via GPT-5
3. Persist to strategies table
4. Notify frontend
</details>

<details>
<summary>📄 <code>gpt5-tactical-planner.js</code></summary>

**Purpose**: GPT-5 venue generation  
**Description**: Calls GPT-5 with reasoning mode to generate 6 venue recommendations with coordinates and tactical advice.
</details>

<details>
<summary>📄 <code>gemini-enricher.js</code></summary>

**Purpose**: Gemini validation and ranking  
**Description**: Uses Gemini 2.5 Pro to validate JSON structure and rerank venues by value-per-minute.
</details>

<details>
<summary>📄 <code>venue-enrichment.js</code></summary>

**Purpose**: Google APIs integration  
**Description**: Enriches venues with Google Places (hours), Routes API (drive times), and Perplexity (events).
</details>

<details>
<summary>📄 <code>persist-ranking.js</code></summary>

**Purpose**: Atomic database persistence  
**Description**: Saves rankings, candidates, and venue data in a single transaction.
</details>

<details>
<summary>📄 <code>coach-dal.js</code></summary>

**Purpose**: AI Coach data access layer  
**Description**: Read-only data access for AI Strategy Coach to query snapshot, strategy, and venue data.
</details>

<details>
<summary>📄 <code>perplexity-research.js</code></summary>

**Purpose**: Perplexity API integration  
**Description**: Uses Perplexity Sonar Pro for real-time internet research (news, events).
</details>

</details>

<details>
<summary>📁 <b>server/db/</b> - Database Layer</summary>

<details>
<summary>📄 <code>pool.js</code></summary>

**Purpose**: PostgreSQL connection pool  
**Description**: Shared connection pool with keepalive, idle timeout, and automatic reconnection.

**Configuration**:
- Max connections: 10
- Idle timeout: 120s
- TCP keepalive: 30s
</details>

<details>
<summary>📄 <code>drizzle.js</code></summary>

**Purpose**: Drizzle ORM instance  
**Description**: Type-safe database queries using Drizzle ORM.
</details>

<details>
<summary>📄 <code>rls-middleware.js</code></summary>

**Purpose**: Row-level security helpers  
**Description**: PostgreSQL RLS (Row Level Security) utility functions.
</details>

</details>

<details>
<summary>📁 <b>server/jobs/</b> - Background Jobs</summary>

<details>
<summary>📄 <code>triad-worker.js</code></summary>

**Purpose**: Strategy generation worker  
**Description**: Background process that listens for PostgreSQL NOTIFY events and generates strategies.
</details>

<details>
<summary>📄 <code>event-cleanup.js</code></summary>

**Purpose**: Database cleanup job  
**Description**: Periodic cleanup of old events and expired data.
</details>

</details>

<details>
<summary>📁 <b>server/eidolon/</b> - AI Assistant Override</summary>

<details>
<summary>📄 <code>index.ts</code></summary>

**Purpose**: Eidolon SDK entry point  
**Description**: Complete Replit Assistant override with enhanced AI capabilities.
</details>

<details>
<summary>📁 <b>server/eidolon/core/</b></summary>

<details>
<summary>📄 <code>llm.ts</code></summary>

**Purpose**: LLM integration layer  
**Description**: Unified interface for GPT-5, Claude, and Gemini with tool calling support.
</details>

<details>
<summary>📄 <code>memory-enhanced.ts</code></summary>

**Purpose**: Enhanced memory system  
**Description**: Persistent memory across assistant sessions with tagging and relationships.
</details>

<details>
<summary>📄 <code>deep-thinking-engine.ts</code></summary>

**Purpose**: Advanced reasoning engine  
**Description**: Multi-step reasoning with chain-of-thought for complex problems.
</details>

</details>

</details>

</details>

---

<details>
<summary>📁 <b>shared/</b> - Shared Code (Client + Server)</summary>

<details>
<summary>📄 <code>schema.js</code></summary>

**Purpose**: Database schema definition  
**Description**: Drizzle ORM schema for all 19 database tables. **Single source of truth** for database structure.

**Tables Defined**:
- `snapshots`: Context records
- `strategies`: GPT-5 strategic overviews
- `rankings`: Recommendation sets
- `ranking_candidates`: Individual venues
- `actions`: User interactions
- `venue_catalog`: Master venue list
- `venue_metrics`: Aggregated stats
- Plus 12 more...
</details>

<details>
<summary>📁 <b>shared/types/</b></summary>

<details>
<summary>📄 <code>snapshot.ts</code></summary>

**Purpose**: SnapshotV1 TypeScript type  
**Description**: Type definition for ML-ready context snapshots.
</details>

<details>
<summary>📄 <code>location.ts</code></summary>

**Purpose**: Location coordinate types  
**Description**: TypeScript types for GPS coordinates with accuracy and source tracking.
</details>

<details>
<summary>📄 <code>reco.ts</code></summary>

**Purpose**: Recommendation types  
**Description**: Types for rankings and venue recommendations.
</details>

</details>

</details>

---

<details>
<summary>📁 <b>docs/</b> - Documentation</summary>

<details>
<summary>📄 <code>ARCHITECTURE.md</code></summary>

**Purpose**: System architecture documentation  
**Description**: Complete V1 architecture reference (historical).
</details>

<details>
<summary>📄 <code>ARCHITECTUREV2.md</code></summary>

**Purpose**: Current architecture documentation  
**Description**: **Main architecture reference** with complete system design, data flow, AI model strategy, and development guardrails.

**Sections**:
- Vision & Mission
- Core Principles
- System Architecture
- Complete Data Flow
- Database Schema
- AI Model Strategy
- Testing Strategy
</details>

<details>
<summary>📄 <code>README.md</code></summary>

**Purpose**: Project quick start guide  
**Description**: Getting started guide with setup instructions, API reference, and core features.
</details>

<details>
<summary>📄 <code>MODEL.md</code></summary>

**Purpose**: AI model specifications  
**Description**: Detailed model IDs, parameters, API examples, and monthly verification protocol.
</details>

<details>
<summary>📄 <code>ISSUES.md</code></summary>

**Purpose**: Issue tracking and root cause analysis  
**Description**: Known issues, root causes, and fixes applied.
</details>

<details>
<summary>📄 <code>replit.md</code></summary>

**Purpose**: Project overview for Replit AI  
**Description**: High-level system overview, user preferences, and architecture summary for AI assistants.
</details>

</details>

---

<details>
<summary>📁 <b>migrations/</b> - Database Migrations</summary>

<details>
<summary>📄 <code>001_init.sql</code></summary>

**Purpose**: Initial database schema  
**Description**: Creates all 19 tables with indexes and foreign keys.
</details>

<details>
<summary>📄 <code>002_memory_tables.sql</code></summary>

**Purpose**: Memory system tables  
**Description**: Adds assistant_memory, eidolon_memory, and cross_thread_memory tables.
</details>

<details>
<summary>📄 <code>003_rls_security.sql</code></summary>

**Purpose**: Row-level security policies  
**Description**: Implements 30+ RLS policies for data protection.
</details>

</details>

---

<details>
<summary>📁 <b>tests/</b> - Testing Infrastructure</summary>

<details>
<summary>📄 <code>test-global-scenarios.js</code></summary>

**Purpose**: End-to-end test suite  
**Description**: Complete user journey tests from GPS acquisition to venue recommendation.
</details>

<details>
<summary>📁 <b>tests/scripts/</b></summary>

<details>
<summary>📄 <code>smoke-test.js</code></summary>

**Purpose**: Quick health check  
**Description**: Fast validation of API endpoints and database connectivity.
</details>

<details>
<summary>📄 <code>toggle-rls.js</code></summary>

**Purpose**: RLS toggle utility  
**Description**: Enable/disable row-level security for dev/prod environments.
</details>

</details>

</details>

---

<details>
<summary>📁 <b>scripts/</b> - Utility Scripts</summary>

<details>
<summary>📄 <code>start-replit.js</code></summary>

**Purpose**: Replit startup script  
**Description**: Custom startup logic for Replit deployment with health checks.
</details>

<details>
<summary>📄 <code>smoke-strategy.mjs</code></summary>

**Purpose**: Strategy generation test  
**Description**: Tests strategy generation pipeline end-to-end.
</details>

<details>
<summary>📄 <code>make-jwks.mjs</code></summary>

**Purpose**: JWT key generation  
**Description**: Generates RS256 key pair for JWT authentication.
</details>

</details>

---

<details>
<summary>📁 <b>tools/</b> - Developer Tools</summary>

<details>
<summary>📁 <b>tools/research/</b></summary>

<details>
<summary>📄 <code>model-discovery.mjs</code></summary>

**Purpose**: Monthly model verification  
**Description**: Uses Perplexity AI to discover latest flagship AI models and parameter constraints.

**Output**: JSON report with model IDs, pricing, and deprecation notices.
</details>

</details>

<details>
<summary>📁 <b>tools/debug/</b></summary>

<details>
<summary>📄 <code>eidolon-recovery.sh</code></summary>

**Purpose**: Emergency recovery script  
**Description**: Fixes common deployment issues (port conflicts, dependency errors).
</details>

<details>
<summary>📄 <code>export-clean-repo.mjs</code></summary>

**Purpose**: Repository export utility  
**Description**: Creates clean ZIP archive of codebase for sharing.
</details>

</details>

</details>

---

## 🎯 Quick Reference

**Start Application**: Click "Run" button or `npm start`  
**Environment Setup**: Copy `.env.example` → `mono-mode.env`  
**Database Migrations**: `npm run db:push`  
**Frontend Dev**: `npm run dev`  
**Test Suite**: `npm run test`

**Architecture Docs**: `docs/ARCHITECTUREV2.md`  
**API Reference**: `docs/README.md`  
**Model Specs**: `docs/MODEL.md`

---

**Last Updated**: December 22, 2024  
**Repository**: Vecto Pilot™ - AI-Powered Rideshare Intelligence Platform