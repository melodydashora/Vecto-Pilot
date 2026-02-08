
# Vecto Pilot - Architecture Reference

**Last Updated:** 2026-01-14 UTC

This file provides navigation to focused architecture documentation. Each linked document is designed to be readable in a single pass.

## Recent Changes (2026-01-14)

- **Canonical Event Field Names (2026-01-10)**
  - Renamed `event_date` to `event_start_date`, `event_time` to `event_start_time`
  - Schema migration: `migrations/20260110_rename_event_columns.sql`
  - All pipeline modules updated: normalizeEvent.js accepts both old and new names
  - Fixes S-006 (staleness detection) and D-031 (field name consistency)

- **Staleness Detection (2026-01-10)**
  - Added 30-minute staleness threshold in blocks-fast.js
  - Detects stuck `pending_blocks` states and resets for fresh pipeline run
  - Fixes bug where stale data was served instead of fresh briefing

- **Coordinate Key Consolidation (2026-01-10)**
  - New canonical module: `server/lib/location/coords-key.js`
  - Provides `makeCoordsKey()`, `coordsKey()`, `parseCoordKey()` for 6-decimal precision
  - Consolidated 4 duplicate implementations into single source of truth

## Changes (2026-01-10)

- **ETL Pipeline Refactoring**: Canonical event processing modules
  - New `server/lib/events/pipeline/` with 4 modules (types, normalizeEvent, validateEvent, hashEvent)
  - 5-phase EVENTS workflow logger (Extract, Transform-Normalize, Transform-Geocode, Load, Assemble)
  - 55 integration tests in `tests/events/`
  - Verification matrix in `docs/architecture/etl-pipeline-refactoring-2026-01-09.md`
  - Model-agnostic naming (functions named by capability, not model)
  - Key invariants: No Cached Data to LLMs, Hash Stability, No Timezone Fallbacks

## Changes (2026-01-08)

- **Level 4 Architecture: Omni-Presence & Siri Interceptor** ⏳ PLANNED - NOT YET IMPLEMENTED
  > **Status:** Database table exists (`intercepted_signals`), but UI components and API endpoints are not yet implemented. This is a future feature.
  - Planned: `/co-pilot/omni` route with `SignalTerminal.tsx` for real-time offer analysis
  - Planned: iOS Siri Shortcut integration via `POST /api/hooks/analyze-offer`
  - ✅ Exists: `intercepted_signals` database table for offer tracking
  - Planned: AI-powered ACCEPT/REJECT decisions with reasoning
  - Planned: Driver override capability with feedback loop
- **Dispatch Primitives** (schema only - not yet implemented):
  - `driver_goals` - earning targets and deadlines
  - `driver_tasks` - hard stops and obligations
  - `safe_zones` - geofence boundaries
  - `staging_saturation` - anti-crowding tracking

## Changes (2026-01-02)

- **Global Markets Table**: 140 markets (69 US + 71 international) with pre-stored timezones
  - 67 US markets with airport codes (71 airports total)
  - Multi-airport markets: Chicago, Dallas, Houston, NYC
  - Skips Google Timezone API for known markets (~200-300ms savings per request)
  - 3,333 city aliases for suburb/neighborhood matching
  - Countries: US, Canada, UK, Australia, Mexico, Brazil, India, Germany, France, Spain, Italy, Japan, Singapore, UAE, South Africa, + 20 more
- **Location Optimization**: Two-phase UI update in LocationContext
  - Weather/AQI display before city/state resolution completes
  - Parallel DB writes for snapshot + user location update
- **Coordinate Precision Fix**: Standardized 6-decimal precision across snapshot.js and location.js

## Changes (2026-01-01)

- **Server Reorganization Complete**: Moved from flat lib structure to domain-based organization
  - `server/lib/ai/` - AI adapters and providers
  - `server/lib/auth/` - Authentication services
  - `server/lib/briefing/` - Briefing generation
  - `server/lib/strategy/` - Strategy pipeline
  - `server/lib/venue/` - Venue intelligence
  - `server/lib/location/` - Location services
  - `server/lib/external/` - Third-party API integrations
  - `server/lib/infrastructure/` - Job queue
  - `server/lib/notifications/` - Email alerts
  - `server/lib/change-analyzer/` - File change tracking
  - `server/lib/subagents/` - AI sub-tasks
- **API Route Organization**: Routes organized by domain in `server/api/`
  - `auth/`, `briefing/`, `chat/`, `feedback/`, `health/`, `intelligence/`, `location/`, `platform/`, `research/`, `strategy/`, `utils/`, `vehicle/`, `venue/`
- **Bootstrap System**: Separated server startup concerns into `server/bootstrap/`
- **React Router Refactor**: Monolithic co-pilot.tsx split into 8 route-based pages
- **Auth System**: New authentication pages and protected routes
- **Documentation**: 95+ README files across all folders
- **Change Analyzer**: Automatic detection of repo changes that may need doc updates

## Quick Navigation

**Start here:** [docs/architecture/README.md](docs/architecture/README.md) - Master index with navigation guide

## Document Map

### Core System Documentation

| What | Document | When to Read |
|------|----------|--------------|
| **Server Organization** | [server-structure.md](docs/architecture/server-structure.md) | Modifying backend code |
| **Client Organization** | [client-structure.md](docs/architecture/client-structure.md) | Modifying frontend code |
| **Database** | [database-schema.md](docs/architecture/database-schema.md) | Working with tables |
| **API** | [api-reference.md](docs/architecture/api-reference.md) | Adding/modifying endpoints |

### AI System Documentation

| What | Document | When to Read |
|------|----------|--------------|
| **AI Pipeline** | [ai-pipeline.md](docs/architecture/ai-pipeline.md) | Modifying AI flow, model config |
| **Strategy Framework** | [strategy-framework.md](docs/architecture/strategy-framework.md) | Understanding recommendations |
| **Event Discovery** | [event-discovery.md](docs/architecture/event-discovery.md) | Modifying event detection |
| **Google APIs** | [google-cloud-apis.md](docs/architecture/google-cloud-apis.md) | Places, Routes, Weather |

### Rules & Decisions

| What | Document | When to Read |
|------|----------|--------------|
| **Critical Rules** | [constraints.md](docs/architecture/constraints.md) | Before ANY code change |
| **Why We Did X** | [decisions.md](docs/architecture/decisions.md) | Questioning architecture |
| **Don't Re-implement** | [deprecated.md](docs/architecture/deprecated.md) | Before adding features |

### Infrastructure

| What | Document | When to Read |
|------|----------|--------------|
| **Authentication** | [auth-system.md](docs/architecture/auth-system.md) | Modifying auth flow |
| **Logging** | [logging.md](docs/architecture/logging.md) | Adding logging |

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         REPLIT DEPLOYMENT                        │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │           React Client (Vite + React Router v6)             │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │ routes.tsx → CoPilotLayout → 8 Route Pages           │  │ │
│  │  │   /co-pilot/strategy   → StrategyPage                │  │ │
│  │  │   /co-pilot/bars       → BarsPage                    │  │ │
│  │  │   /co-pilot/briefing   → BriefingPage                │  │ │
│  │  │   /co-pilot/map        → MapPage                     │  │ │
│  │  │   /co-pilot/intel      → IntelPage                   │  │ │
│  │  │   /co-pilot/about      → AboutPage                   │  │ │
│  │  │   /co-pilot/settings   → SettingsPage                │  │ │
│  │  │   /privacy-policy      → PolicyPage                  │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              ↓                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              Gateway Server (Port 5000)                     │ │
│  │  ┌──────────────────┐  ┌──────────────────────────────┐   │ │
│  │  │   SDK Routes     │  │    Agent Routes (43717)       │   │ │
│  │  │   /api/*         │  │    /agent/*                   │   │ │
│  │  └──────────────────┘  └──────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              ↓                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                PostgreSQL Database                          │ │
│  │   (Replit Built-in, Drizzle ORM)                           │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    EXTERNAL AI/API SERVICES                      │
│  • Anthropic (Claude Opus 4.6)                                  │
│  • OpenAI (GPT-5.2, Realtime API)                               │
│  • Google (Gemini 3.0 Pro, Places, Routes, Weather, AQ)         │
└─────────────────────────────────────────────────────────────────┘
```

## TRIAD Pipeline Summary

```
POST /api/blocks-fast → TRIAD Pipeline (~35-50s)
├── Phase 1 (Parallel): Strategist + Briefer + Holiday
├── Phase 2 (Parallel): Daily + Immediate Consolidator
├── Phase 3: Venue Planner + Enrichment
└── Phase 4: Event Validator
```

See [ai-pipeline.md](docs/architecture/ai-pipeline.md) for details.

## Headless Client Integration (Level 4 Architecture)

The Omni-Presence feature enables **headless clients** (iOS Shortcuts, Android Automations) to interact with Vecto Pilot without opening the app.

### iOS Siri Shortcut Workflow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       SIRI INTERCEPTOR FLOW                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. Driver receives ride offer on Uber/Lyft app                         │
│  2. Driver shares screenshot to Siri Shortcut                            │
│  3. iOS OCR extracts text: "$12.50 • 4.2 mi • 8 min"                    │
│  4. Shortcut calls: POST /api/hooks/analyze-offer                        │
│     ┌─────────────────────────────────────────────────────────────┐     │
│     │ Request Body:                                                │     │
│     │ {                                                            │     │
│     │   "raw_text": "UberX $12.50 4.2 mi 8 min Main St → Airport",│     │
│     │   "user_id": "uuid-from-stored-auth",                       │     │
│     │   "device_id": "iPhone-14-Pro"                              │     │
│     │ }                                                            │     │
│     └─────────────────────────────────────────────────────────────┘     │
│  5. Server parses text, calculates $/mile, applies driver preferences  │
│  6. AI returns decision with reasoning                                   │
│     ┌─────────────────────────────────────────────────────────────┐     │
│     │ Response:                                                    │     │
│     │ {                                                            │     │
│     │   "decision": "ACCEPT",                                      │     │
│     │   "reasoning": "Good $/mi ($2.98), short trip, airport run", │     │
│     │   "parsed": { "price": 12.50, "miles": 4.2, "per_mile": 2.98}│     │
│     │ }                                                            │     │
│     └─────────────────────────────────────────────────────────────┘     │
│  7. Siri speaks: "Accept. Good rate at $2.98 per mile."                 │
│  8. Signal stored in `intercepted_signals` table                        │
│  9. SignalTerminal UI updates via SSE (if app is open)                  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Purpose |
|-----------|---------|
| `POST /api/hooks/analyze-offer` | Receives OCR text, returns AI decision |
| `intercepted_signals` table | Stores all offers with decisions |
| `SignalTerminal.tsx` | Real-time UI for viewing offers |
| iOS Siri Shortcut | Client-side automation (not in repo) |

### Decision Criteria

The AI considers:
- **$/mile threshold** (configurable per user)
- **Distance limits** (avoid long deadheads)
- **Current location context** (from last snapshot)
- **Driver goals** (if set in `driver_goals` table)
- **Safe zones** (if defined in `safe_zones` table)

### Security

- Endpoint requires valid JWT (stored in iOS Shortcut)
- Rate limited to prevent abuse
- PII (exact addresses) not logged
- User can revoke shortcut access via settings

## Complete Folder README Index

Every folder has a README.md. Total: **95 README files**.

### Root Level

| Folder | README |
|--------|--------|
| `/` | [README.md](README.md) |
| `attached_assets/` | [README.md](attached_assets/README.md) |
| `config/` | [README.md](config/README.md) |
| `data/` | [README.md](data/README.md) |
| `docs/` | [README.md](docs/README.md) |
| `docs/architecture/` | [README.md](docs/architecture/README.md) |
| `drizzle/` | [README.md](drizzle/README.md) |
| `migrations/` | [README.md](migrations/README.md) |
| `platform-data/` | [README.md](platform-data/README.md) |
| `public/` | [README.md](public/README.md) |
| `schema/` | [README.md](schema/README.md) |
| `scripts/` | [README.md](scripts/README.md) |
| `shared/` | [README.md](shared/README.md) |
| `tools/` | [README.md](tools/README.md) |

### Server Folders (40 READMEs)

| Folder | README | Purpose |
|--------|--------|---------|
| `server/` | [README](server/README.md) | Server overview |
| `server/agent/` | [README](server/agent/README.md) | Workspace agent |
| `server/api/` | [README](server/api/README.md) | API routes index |
| `server/api/auth/` | [README](server/api/auth/README.md) | JWT authentication |
| `server/api/briefing/` | [README](server/api/briefing/README.md) | Events, traffic, news |
| `server/api/chat/` | [README](server/api/chat/README.md) | AI Coach, voice, TTS |
| `server/api/feedback/` | [README](server/api/feedback/README.md) | User feedback |
| `server/api/health/` | [README](server/api/health/README.md) | Health checks |
| `server/api/location/` | [README](server/api/location/README.md) | GPS, geocoding |
| `server/api/research/` | [README](server/api/research/README.md) | Vector search |
| `server/api/strategy/` | [README](server/api/strategy/README.md) | Strategy generation |
| `server/api/utils/` | [README](server/api/utils/README.md) | HTTP helpers |
| `server/api/venue/` | [README](server/api/venue/README.md) | Venue intelligence |
| `server/assistant/` | [README](server/assistant/README.md) | Assistant proxy |
| `server/bootstrap/` | [README](server/bootstrap/README.md) | Server startup |
| `server/config/` | [README](server/config/README.md) | Configuration |
| `server/db/` | [README](server/db/README.md) | Database connection |
| `server/eidolon/` | [README](server/eidolon/README.md) | Enhanced SDK |
| `server/eidolon/memory/` | [README](server/eidolon/memory/README.md) | Memory management |
| `server/eidolon/tools/` | [README](server/eidolon/tools/README.md) | Tool definitions |
| `server/gateway/` | [README](server/gateway/README.md) | Gateway proxy |
| `server/jobs/` | [README](server/jobs/README.md) | Background workers |
| `server/lib/` | [README](server/lib/README.md) | Business logic |
| `server/lib/ai/` | [README](server/lib/ai/README.md) | AI layer |
| `server/lib/ai/adapters/` | [README](server/lib/ai/adapters/README.md) | Model adapters |
| `server/lib/ai/providers/` | [README](server/lib/ai/providers/README.md) | AI providers |
| `server/lib/briefing/` | [README](server/lib/briefing/README.md) | Briefing service |
| `server/lib/change-analyzer/` | [README](server/lib/change-analyzer/README.md) | Diff detection |
| `server/lib/external/` | [README](server/lib/external/README.md) | Third-party APIs |
| `server/lib/infrastructure/` | [README](server/lib/infrastructure/README.md) | Job queue |
| `server/lib/location/` | [README](server/lib/location/README.md) | Location services |
| `server/lib/notifications/` | [README](server/lib/notifications/README.md) | Push notifications |
| `server/lib/strategy/` | [README](server/lib/strategy/README.md) | Strategy pipeline |
| `server/lib/subagents/` | [README](server/lib/subagents/README.md) | AI sub-tasks |
| `server/lib/venue/` | [README](server/lib/venue/README.md) | Venue intelligence |
| `server/lib/events/` | [README](server/lib/events/pipeline/README.md) | ETL pipeline for event processing |
| `server/logger/` | [README](server/logger/README.md) | Workflow logging |
| `server/middleware/` | [README](server/middleware/README.md) | Express middleware |
| `server/scripts/` | [README](server/scripts/README.md) | Server scripts |
| `server/types/` | [README](server/types/README.md) | TypeScript types |
| `server/util/` | [README](server/util/README.md) | Utilities |
| `server/validation/` | [README](server/validation/README.md) | Schema validation |

### Client Folders (21 READMEs)

| Folder | README | Purpose |
|--------|--------|---------|
| `client/` | [README](client/README.md) | Client overview |
| `client/public/` | [README](client/public/README.md) | Static assets |
| `client/src/` | [README](client/src/README.md) | Source overview |
| `client/src/components/` | [README](client/src/components/README.md) | Components index |
| `client/src/components/_future/` | [README](client/src/components/_future/README.md) | Staged components |
| `client/src/components/co-pilot/` | [README](client/src/components/co-pilot/README.md) | Co-pilot specific |
| `client/src/components/strategy/` | [README](client/src/components/strategy/README.md) | Strategy display |
| `client/src/components/strategy/_future/` | [README](client/src/components/strategy/_future/README.md) | Staged strategy UI |
| `client/src/components/ui/` | [README](client/src/components/ui/README.md) | shadcn/ui primitives |
| `client/src/contexts/` | [README](client/src/contexts/README.md) | React contexts |
| `client/src/features/` | [README](client/src/features/README.md) | Feature modules |
| `client/src/features/strategy/` | [README](client/src/features/strategy/README.md) | Strategy feature |
| `client/src/hooks/` | [README](client/src/hooks/README.md) | Custom hooks |
| `client/src/layouts/` | [README](client/src/layouts/README.md) | Route layouts |
| `client/src/lib/` | [README](client/src/lib/README.md) | Core utilities |
| `client/src/pages/` | [README](client/src/pages/README.md) | Route pages |
| `client/src/pages/co-pilot/` | [README](client/src/pages/co-pilot/README.md) | Co-pilot route pages |
| `client/src/types/` | [README](client/src/types/README.md) | TypeScript types |
| `client/src/utils/` | [README](client/src/utils/README.md) | Feature helpers |
| `client/src/_future/` | [README](client/src/_future/README.md) | Staged features |
| `client/src/_future/engine/` | [README](client/src/_future/engine/README.md) | Reflection engine |

### Test Folders (7 READMEs)

| Folder | README | Purpose |
|--------|--------|---------|
| `tests/` | [README](tests/README.md) | Test overview |
| `tests/e2e/` | [README](tests/e2e/README.md) | E2E tests |
| `tests/eidolon/` | [README](tests/eidolon/README.md) | Eidolon tests |
| `tests/events/` | [README](tests/events/README.md) | ETL pipeline tests (55 integration tests) |
| `tests/gateway/` | [README](tests/gateway/README.md) | Gateway tests |
| `tests/scripts/` | [README](tests/scripts/README.md) | Test scripts |
| `tests/triad/` | [README](tests/triad/README.md) | TRIAD tests |

## Key Entry Points

### Server Entry Points

| File | Purpose |
|------|---------|
| `gateway-server.js` | Main Express server entry |
| `strategy-generator.js` | Background strategy worker |
| `sdk-embed.js` | SDK router factory |
| `shared/schema.js` | Drizzle ORM schema |

### Client Entry Points (React Router v6)

| File | Purpose |
|------|---------|
| `client/src/main.tsx` | React app bootstrap |
| `client/src/App.tsx` | RouterProvider wrapper |
| `client/src/routes.tsx` | Route definitions (createBrowserRouter) |
| `client/src/layouts/CoPilotLayout.tsx` | Shared layout with bottom nav |
| `client/src/contexts/co-pilot-context.tsx` | Shared state across pages |

### Route Pages

| Route | Page | Purpose |
|-------|------|---------|
| `/co-pilot/strategy` | StrategyPage.tsx | AI strategy + Smart Blocks + Coach |
| `/co-pilot/bars` | BarsPage.tsx | Premium venue listings |
| `/co-pilot/briefing` | BriefingPage.tsx | Weather, traffic, news, events |
| `/co-pilot/map` | MapPage.tsx | Venue + event map |
| `/co-pilot/intel` | IntelPage.tsx | Rideshare intelligence |
| `/co-pilot/omni` | OmniPage.tsx | Omni-Presence signal terminal [Level 4] |
| `/co-pilot/about` | AboutPage.tsx | About + donation |
| `/co-pilot/settings` | SettingsPage.tsx | User settings |
| `/privacy-policy` | PolicyPage.tsx | Privacy policy |

## Application Workflow

### User Flow

```
User opens app → LocationContext resolves GPS
                         ↓
              POST /api/blocks-fast (triggers TRIAD)
                         ↓
              SSE /api/strategy/subscribe (real-time updates)
                         ↓
              StrategyPage displays results
```

### Data Flow

```
LocationContext (GPS) ─────────────────────────────────────────────┐
                                                                    ↓
CoPilotContext ─── strategyQuery ─── POST /api/blocks-fast ─── TRIAD Pipeline
      │                                                             ↓
      ├── blocksQuery ──────────────────────────────── Smart Blocks
      │                                                             ↓
      └── SSE subscription ────────── /api/strategy/subscribe ── Live Updates
```

### Key Contexts

| Context | Scope | Purpose |
|---------|-------|---------|
| `LocationContext` | App-wide | GPS, city, timezone, overrides |
| `CoPilotContext` | Co-pilot pages | Strategy, blocks, SSE, progress |
| `AuthContext` | App-wide | User authentication state |
| `QueryClient` | App-wide | React Query cache |

## Missing/Needs Documentation

### High Priority

1. **Performance Monitoring** - No centralized metrics/monitoring system documented
2. **Error Tracking** - Beyond console logs, no error aggregation system
3. **Analytics** - User behavior tracking not documented
4. **Rate Limiting Config** - Implementation exists but config unclear
5. **API Versioning** - No versioning strategy documented
6. **Backup/Recovery** - Database backup procedures unclear
7. **Load Balancing** - Replit Autoscale configuration not detailed
8. **WebSocket Lifecycle** - SSE documented but WS connection management unclear

### Medium Priority

1. **SSL/TLS Setup** - Replit-managed but local dev guidance needed
2. **Environment Validation** - Comprehensive checklist missing
3. **Feature Flags** - No feature toggle system documented
4. **A/B Testing** - Not documented if implemented
5. **Cache Strategy** - Redis/in-memory caching not fully documented
6. **Session Management** - User session lifecycle unclear
7. **File Upload** - Vision API file handling not detailed
8. **Image Processing** - Screenshot/photo handling unclear

### Low Priority

1. **Build Optimization** - Vite bundle analysis not documented
2. **Code Splitting** - React lazy loading strategy unclear
3. **PWA Support** - Offline capabilities not documented
4. **Push Notifications** - Implementation unclear
5. **Internationalization** - i18n support not mentioned
6. **Accessibility** - WCAG compliance not documented
7. **SEO** - Meta tags/sitemap not detailed
8. **Social Sharing** - Open Graph tags not mentioned

## Pending Items / Roadmap

Tracked in [docs/DOC_DISCREPANCIES.md](docs/DOC_DISCREPANCIES.md) and [docs/review-queue/pending.md](docs/review-queue/pending.md).

### Critical (Must Fix)

*None currently - all critical issues resolved on 2026-01-01*

### Medium Priority

| Issue | Status |
|-------|--------|
| MCP memory tools verification | Unknown if configured |
| Legacy Replit docs review | In `docs/melswork/needs-updating/` |
| Component redundancy check | BarTab vs BarsTable unclear |

### Documentation Backlog

See [docs/melswork/needs-updating/](docs/melswork/needs-updating/) for documents requiring review.

## Related Files

- [CLAUDE.md](CLAUDE.md) - AI assistant quick reference
- [LESSONS_LEARNED.md](LESSONS_LEARNED.md) - Historical issues and fixes
- [docs/AI_PARTNERSHIP_PLAN.md](docs/AI_PARTNERSHIP_PLAN.md) - Documentation improvement roadmap
- [docs/DOC_DISCREPANCIES.md](docs/DOC_DISCREPANCIES.md) - Known documentation issues
- [REPO_FILE_LISTING.md](REPO_FILE_LISTING.md) - Complete file inventory

---

**Note:** This file was restructured on 2025-12-15 and updated on 2026-01-01 with current structure. Detailed content is in `docs/architecture/` for better readability. Complete folder README index includes 95 files. Missing documentation areas identified above require attention.
