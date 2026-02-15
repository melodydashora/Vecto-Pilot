# Vecto Pilot — Comprehensive Codebase Analysis

**Analysis Date:** February 15, 2026
**Analyzed By:** Claude Opus 4.6
**Repository:** Vecto Pilot (Replit)
**Branch:** main
**Last Commit:** 437ca4e3 fix(models): Correct all Anthropic model IDs and remove .replit overrides

---

## Executive Summary

Vecto Pilot is a mature, production-grade AI-powered rideshare intelligence platform. The codebase spans **245 server-side files** and **161 client-side files** across a well-organized domain-driven architecture. The multi-model AI pipeline uses 3 frontier LLMs (Claude Opus 4.6, Gemini 3.0 Pro, GPT-5.2) orchestrated through a centralized adapter pattern with hedged routing and automatic fallback.

**Health Status: EXCELLENT** — All 32 previously-identified discrepancies are resolved. No critical code issues found. Documentation drift is the primary ongoing challenge, addressed by the now-fixed autonomous Docs Agent.

---

## 1. Architecture Overview

### System Topology

```
                    ┌─────────────────────────────┐
                    │     React Client (Vite)      │
                    │  TypeScript + TailwindCSS 4   │
                    │  React Query + Context API    │
                    │  48 shadcn/ui components      │
                    └──────────┬──────────────────┘
                               │ HTTPS
                    ┌──────────▼──────────────────┐
                    │   Gateway Server (Port 5000)  │
                    │   Express.js + Node.js 20+    │
                    │   PostgreSQL (Drizzle ORM)    │
                    └──────────┬──────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                     ▼
  ┌──────────────┐   ┌──────────────┐   ┌───────────────┐
  │ Claude Opus  │   │ Gemini 3 Pro │   │   GPT-5.2     │
  │   4.6        │   │   Preview    │   │               │
  │ Strategist   │   │ Briefer      │   │ Consolidator  │
  │ Discovery    │   │ Coach        │   │ Venue Scorer  │
  └──────────────┘   │ Events       │   │ Tactical Plan │
                     │ Traffic      │   └───────────────┘
                     │ Docs Agent   │
                     └──────────────┘
```

### Key Design Principles

1. **NO FALLBACKS** — Missing data is a bug, not a feature. Fail explicitly.
2. **FAIL HARD** — Critical data missing = blocking modal, not degraded UI.
3. **GPS-FIRST** — No IP geolocation, no default locations, no hardcoded coordinates.
4. **ADAPTER PATTERN** — All AI calls go through `callModel(role)`, never direct SDK calls.
5. **6-DECIMAL PRECISION** — GPS coordinates at ~11cm accuracy for cache keys and matching.
6. **ROOT CAUSE FIRST** — Never catch errors that should be architecturally impossible.

---

## 2. AI Pipeline — Model Registry (31 Roles)

The centralized model registry at `server/lib/ai/model-registry.js` is the **single source of truth** for all AI model configuration.

### BRIEFINGS TABLE (9 roles)

| Role | Model | Purpose | Thinking |
|------|-------|---------|----------|
| `BRIEFING_WEATHER` | gemini-3-pro-preview | Weather intelligence with Google Search | — |
| `BRIEFING_TRAFFIC` | gemini-3-pro-preview | TomTom JSON → Driver Advice synthesis | HIGH |
| `BRIEFING_NEWS` | gemini-3-pro-preview | Local news research (7 days) | HIGH |
| `BRIEFING_EVENTS_DISCOVERY` | gemini-3-pro-preview | Parallel event category search | HIGH |
| `BRIEFING_EVENTS_VALIDATOR` | gemini-3-pro-preview | Event schedule verification | — |
| `BRIEFING_FALLBACK` | gemini-3-pro-preview | Failed briefing call recovery | HIGH |
| `BRIEFING_SCHOOLS` | gemini-3-pro-preview | School closures and calendar | HIGH |
| `BRIEFING_AIRPORT` | gemini-3-pro-preview | Airport conditions and delays | — |
| `BRIEFING_HOLIDAY` | gemini-3-pro-preview | Holiday detection with search | HIGH |

### STRATEGIES TABLE (4 roles)

| Role | Model | Purpose | Config |
|------|-------|---------|--------|
| `STRATEGY_CORE` | claude-opus-4-6 | Core strategic plan generation | 8192 tokens, temp 0.7 |
| `STRATEGY_CONTEXT` | gemini-3-pro-preview | Real-time context gathering | HIGH thinking |
| `STRATEGY_TACTICAL` | gpt-5.2 | 1-hour tactical consolidation | 32K tokens, medium reasoning |
| `STRATEGY_DAILY` | gemini-3-pro-preview | 8-12hr daily strategy | HIGH thinking |

### VENUES/RANKING_CANDIDATES (6 roles)

| Role | Model | Purpose |
|------|-------|---------|
| `VENUE_SCORER` | gpt-5.2 | Smart Blocks venue scoring |
| `VENUE_FILTER` | claude-haiku-4-5-20251001 | Fast low-cost filtering |
| `VENUE_TRAFFIC` | gemini-3-pro-preview | Venue-specific traffic intel |
| `VENUE_EVENT_VERIFIER` | gemini-3-pro-preview | Verify venue events |
| `VENUE_REASONING` | gpt-5.2 | Closed venue staging rationale |
| `VENUE_EVENTS_SEARCH` | gemini-3-pro-preview | Search venue events |

### OTHER ROLES (12 roles)

| Category | Role | Model |
|----------|------|-------|
| Coach | `COACH_CHAT` | gemini-3-pro-preview (multimodal: vision, OCR) |
| Utility | `UTIL_RESEARCH` | gemini-3-pro-preview |
| Utility | `UTIL_WEATHER_VALIDATOR` | gemini-3-pro-preview |
| Utility | `UTIL_TRAFFIC_VALIDATOR` | gemini-3-pro-preview |
| Utility | `UTIL_MARKET_PARSER` | gpt-5.2 |
| Discovery | `DISCOVERY_GPT` | gpt-5.2 (web search) |
| Discovery | `DISCOVERY_CLAUDE` | claude-opus-4-6 (web search) |
| Concierge | `CONCIERGE_SEARCH` | gemini-3-pro-preview (LOW thinking) |
| Concierge | `CONCIERGE_CHAT` | gemini-3-pro-preview (LOW thinking) |
| Internal | `DOCS_GENERATOR` | gemini-3-pro-preview (HIGH thinking) |

### Fallback Configuration

- **Fallback Model:** `gemini-3-flash-preview` (fast, cheap)
- **Fallback-Enabled Roles:** STRATEGY_TACTICAL, STRATEGY_CONTEXT, STRATEGY_DAILY, BRIEFING_EVENTS_DISCOVERY, BRIEFING_NEWS, VENUE_FILTER, STRATEGY_CORE, BRIEFING_EVENTS_VALIDATOR, BRIEFING_FALLBACK
- **Legacy Role Map:** `strategist` → STRATEGY_CORE, `briefer` → STRATEGY_CONTEXT, `consolidator` → STRATEGY_TACTICAL, etc.

---

## 3. TRIAD Pipeline Flow

```
POST /api/blocks-fast → TRIAD Pipeline (~35-50s)
│
├── Phase 1 (Parallel):
│   ├── STRATEGY_CORE (Claude Opus 4.6) → Strategic overview
│   ├── STRATEGY_CONTEXT (Gemini 3 Pro) → News, events, traffic
│   └── BRIEFING_HOLIDAY (Gemini 3 Pro) → Holiday detection
│
├── Phase 2 (Parallel):
│   ├── STRATEGY_TACTICAL (GPT-5.2) → "Strategy for NOW" consolidation
│   └── STRATEGY_DAILY (Gemini 3 Pro) → Long-term daily strategy
│
├── Phase 3: Venue Scoring + Enrichment
│   ├── VENUE_SCORER (GPT-5.2) → Top venues with coordinates
│   ├── Google Routes API → Drive times and distances
│   ├── Google Places API → Business hours, place_id
│   └── VENUE_EVENT_VERIFIER (Gemini 3 Pro) → Event impact check
│
└── Phase 4: Event Validation
    └── BRIEFING_EVENTS_VALIDATOR (Gemini 3 Pro) → Schedule verification
```

---

## 4. Server Structure (245 files)

### API Routes (`server/api/`) — 14 domains

| Domain | Route | Key Endpoints |
|--------|-------|---------------|
| Auth | `/api/auth` | register, login, google-callback, uber-callback |
| Briefing | `/api/briefing` | events, traffic, discover-events |
| Chat | `/api/chat`, `/api/tts`, `/api/realtime` | AI Coach text, TTS, voice |
| Coach | `/api/coach` | notes, schema, validation |
| Feedback | `/api/feedback`, `/api/actions` | user sentiment, action logs |
| Health | `/api/health`, `/api/diagnostics` | system health, ML health |
| Intelligence | `/api/intelligence` | market intel, staging areas |
| Location | `/api/location`, `/api/snapshot` | GPS resolve, snapshot create |
| Platform | `/api/platform` | markets, cities, coverage |
| Research | `/api/research` | vector search, web research |
| Strategy | `/api/blocks-fast`, `/api/strategy` | TRIAD trigger, strategy fetch |
| Vehicle | `/api/vehicle` | vehicle management |
| Venue | `/api/venue` | venue intelligence |

### Business Logic (`server/lib/`) — 8 domains

| Domain | Files | Key Modules |
|--------|-------|-------------|
| AI | ~20 | model-registry, adapters (3), hedged-router, context |
| Strategy | ~10 | parallel generator, tactical planner, providers |
| Briefing | ~11 | briefing-service (1543 LOC), event cleanup |
| Venue | ~20 | enrichment, intelligence, hours parsing, cache |
| Events | ~15 | ETL pipeline: normalize, validate, hash, types |
| Location | ~11 | geocoding, snapshot context, holiday detection, coords-key |
| Auth | ~8 | password, OAuth (Google, Uber), email, SMS |
| External | ~10 | TomTom, FAA, Uber client |

### Event ETL Pipeline (`server/lib/events/pipeline/`)

4 canonical modules enforcing data integrity:

1. **normalizeEvent.js** — Provider format → canonical (`event_start_date`, `event_start_time`)
2. **validateEvent.js** — 11 hard validation rules (rejects TBD, Unknown, missing times)
3. **hashEvent.js** — MD5 deduplication: `title|venue_address|date|time`
4. **typeDefs.js** — TypeScript-compatible type constants

---

## 5. Client Structure (161 files)

### Route Map (20 routes)

```
/ → AuthRedirect (smart redirect)
├── /auth/sign-in, /auth/sign-up, /auth/forgot-password, /auth/reset-password
├── /auth/terms, /auth/google/callback (PUBLIC), /auth/uber/callback (PROTECTED)
├── /c/:token → PublicConciergePage (passengers)
└── /co-pilot (CoPilotLayout — PROTECTED)
    ├── /strategy → StrategyPage (AI + Smart Blocks + Coach)
    ├── /bars → VenueManagerPage
    ├── /briefing → BriefingPage (weather, traffic, news, events)
    ├── /map → MapPage (interactive venue/event map)
    ├── /intel → IntelPage (rideshare intelligence)
    ├── /concierge → ConciergePage (driver concierge tools)
    ├── /settings → SettingsPage (profile, Uber connection)
    ├── /about → AboutPage (no GlobalHeader)
    └── /policy → PolicyPage
```

### State Management — 3-Layer Architecture

| Layer | Tool | Purpose |
|-------|------|---------|
| Remote Data | React Query (TanStack) | API caching, background refetch |
| Global State | React Context (3 providers) | Auth, Location, CoPilot |
| Local State | useState/useReducer | Page-specific UI |

**Context Nesting Order:**
```
ErrorBoundary → QueryClientProvider → AuthProvider → LocationProvider → CoPilotProvider → Router
```

### Component Inventory

| Category | Count | Key Components |
|----------|-------|----------------|
| Feature Components | 14 | GlobalHeader, CoachChat, BriefingTab, MapTab, BarsMainTab |
| Briefing Cards | 7 | WeatherCard, TrafficCard, NewsCard, AirportCard, SchoolClosuresCard |
| Intel Components | 7 | DeadheadCalculator, DemandRhythmChart, ZoneCards |
| Auth Components | 5 | ProtectedRoute, AuthRedirect, UberConnectButton |
| Shadcn/UI Primitives | 48 | Full design system (forms, dialogs, navigation, display) |
| Custom Hooks | 16 | useBriefingQueries, useEnrichmentProgress, useTTS |

---

## 6. Database Schema (PostgreSQL + Drizzle ORM)

### Core Tables

| Table | Purpose | Primary Key |
|-------|---------|-------------|
| `snapshots` | Location + time context (GPS, city, timezone) | `snapshot_id` |
| `strategies` | AI strategy output | `id` (FK: `snapshot_id`) |
| `briefings` | Briefing data (weather, traffic, news, events) | `id` (FK: `snapshot_id`) |
| `rankings` | Venue ranking metadata | `ranking_id` (FK: `snapshot_id`) |
| `ranking_candidates` | Scored venues (Smart Blocks) | `id` (FK: `ranking_id`) |
| `discovered_events` | Events from AI discovery | `id` (dedupe: `event_hash`) |
| `venue_catalog` | Venue master data | `id` (unique: `place_id`) |
| `driver_profiles` | Driver identity (permanent) | `profile_id` |
| `users` | Session tracking (60 min TTL) | `user_id` |
| `auth_credentials` | Password hashes | `id` (FK: `user_id`) |
| `markets` | 140 global markets with timezones | `id` |
| `us_market_cities` | 3,333 city aliases for suburb matching | `id` |
| `coach_conversations` | AI Coach thread history | `id` |
| `coach_system_notes` | AI Coach observations | `id` |
| `user_intel_notes` | Per-user driver intel | `id` |
| `zone_intelligence` | Crowd-sourced zone knowledge | `id` |
| `market_intelligence` | Market-specific patterns | `id` |
| `oauth_states` | OAuth state tokens | `id` |
| `uber_connections` | Uber account links | `id` |
| `intercepted_signals` | Siri offer analysis (Level 4) | `id` |

### Key Relationships

- All AI output tables FK to `snapshots.snapshot_id`
- `ranking_candidates` FK to `rankings.ranking_id`
- `venue_catalog` unique on `place_id` (Google Places)
- `discovered_events` unique on `event_hash` (MD5 dedup)

---

## 7. Documentation Inventory

### Root-Level Documents (21 files)

| File | Purpose | Last Updated |
|------|---------|--------------|
| `README.md` | Project showcase | 2026-02-11 |
| `CLAUDE.md` | AI development rules (11 rules) | 2026-02-13 |
| `ARCHITECTURE.md` | System navigation | 2026-01-14 |
| `LESSONS_LEARNED.md` | Historical bugs & fixes | 2026-02-13 |
| `MODEL.md` | AI model reference guide | 2026-02-07 |
| `GEMINI.md` | Ultimate integration plan | 2026-02-07 |
| `GEMINIMEMORY.md` | Gemini agent context | 2026-02-11 |
| `GEMINIANALYSIS.md` | Gemini's system audit | Current |
| `SECURITY.md` | Security policy | 2026-01-05 |
| `PERFORMANCE_OPTIMIZATIONS.md` | Performance guide | Current |
| `LEXICON.md` | Terminology reference | Current |
| `UI_FILE_MAP.md` | Component mapping | 2026-01-08 |
| `APICALL.md` | External API reference | Current |
| `UBER_INTEGRATION_TODO.md` | Uber API roadmap | Current |
| `FEATURESANDNOTES.md` | Coach memory export | 2026-02-05 |

### README Coverage

- **95+ README files** across all folders
- **40 server READMEs**, **21 client READMEs**, **7 test READMEs**
- Every folder has documentation explaining its purpose

---

## 8. Autonomous Systems

### Change Analyzer (`server/jobs/change-analyzer-job.js`)
- Runs on server startup (3s delay)
- Detects git changes (uncommitted + last 5 commits)
- Maps file changes → affected documentation
- Outputs to `docs/review-queue/pending.md` and daily logs
- Triggers Docs Agent for auto-alignment

### Docs Agent (`server/lib/docs-agent/`)
- **Generator** — Uses `DOCS_GENERATOR` role (Gemini 3 Pro) to update docs
- **Validator** — Checks markdown structure, broken links, code block closure
- **Publisher** — Writes to disk with backup/rollback support
- **Orchestrator** — Coordinates generate → validate → publish pipeline
- **Status:** Fixed 2026-02-15 (was broken due to sparse mapping and path issues)

### Strategy Worker (`strategy-generator.js`)
- Background process for strategy generation
- Spawned by gateway server on startup
- Handles TRIAD pipeline execution

### Event Sync Job
- Daily event discovery at 6 AM
- Multi-provider ETL: Gemini, GPT-5.2, Claude
- Canonical normalization → validation → hash dedup → DB upsert

---

## 9. Security Posture

| Layer | Protection |
|-------|------------|
| Authentication | JWT (HMAC-SHA256) with sliding TTL |
| Authorization | `requireAuth` middleware on all data routes |
| Rate Limiting | Per-user and per-IP on expensive endpoints |
| Input Validation | Zod schemas on all API endpoints |
| SQL Injection | Drizzle ORM parameterized queries |
| XSS | React built-in escaping |
| CSRF | SameSite cookies |
| Secrets | Replit Secrets (never committed) |
| Push Protection | GitHub secret scanning enabled |

**Recent Security Fixes (2026-02-13):**
- 9 unprotected routes hardened with `requireAuth`
- IDOR vulnerability in feedback routes eliminated
- 8 direct API calls migrated to adapter pattern (prevents credential leaks)

---

## 10. Findings & Recommendations

### Resolved Issues (All Clear)

All 32 items in `docs/DOC_DISCREPANCIES.md` are marked FIXED. No active discrepancies.

### Low-Priority Observations

See `docs/review-queue/2026-02-15-findings.md` for 12 detailed findings including:
- F-001: Orphaned `models-dictionary.js`
- F-002: Gemini thinkingLevel validation gap
- F-003: District field dual source
- F-010: pending.md at 257KB needs archival
- F-011: Docs orchestrator fixed (4 bugs resolved)

### Architecture Strengths

1. Centralized model registry (31 roles, single source of truth)
2. Hedged router with automatic fallback
3. Canonical event ETL pipeline with schema versioning
4. Batch API optimization (Route Matrix, address resolution)
5. FAIL HARD pattern prevents silent UI degradation
6. 95+ README files providing comprehensive documentation
7. 3-layer state management (React Query + Context + Local)
8. SSE real-time updates with singleton connection manager

---

## 11. Codebase Statistics

| Metric | Value |
|--------|-------|
| Server JS/TS Files | ~245 |
| Client TSX/TS Files | ~161 |
| Total Lines of Code | ~50,000+ |
| Model Registry Roles | 31 |
| API Route Domains | 14 |
| Database Tables | 20+ |
| README Files | 95+ |
| Root MD Documents | 21 |
| Shadcn/UI Components | 48 |
| Custom React Hooks | 16 |
| Co-Pilot Routes | 12 |
| Auth Routes | 8 |
| Global Markets | 140 (69 US + 71 international) |
| City Aliases | 3,333 |
| Test Files | 55+ (events ETL) |
| DOC_DISCREPANCIES Resolved | 32/32 |

---

*Generated by Claude Opus 4.6 on February 15, 2026*
