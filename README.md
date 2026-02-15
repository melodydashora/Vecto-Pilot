# Vecto Pilot - AI-Powered Rideshare Intelligence Platform

**Last Updated:** 2026-02-15 | **Version:** 4.3.0 | **Status:** Production

> **Built by AI, For AI-Assisted Drivers.**
>
> This application is a reference implementation of AI-assisted software engineering — architected and built collaboratively by **Anthropic Claude Opus 4.6**, **Google Gemini 3.0 Pro**, and **OpenAI GPT-5.2**, with human architect oversight from Melody Dashora.

---

## Overview

Vecto Pilot is an AI-native rideshare intelligence platform that maximizes driver earnings through real-time, data-driven strategic briefings. Unlike traditional "hotspot" apps, Vecto Pilot uses a sophisticated **multi-model AI waterfall pipeline** (the "TRIAD") to synthesize weather, traffic, events, and news into actionable, narrative-driven strategies.

It operates globally across 140+ markets, requires no hardware integration, and provides a "Co-Pilot" experience via text and voice.

### What Makes This Different

| Traditional Apps | Vecto Pilot |
|------------------|-------------|
| Show surge heatmaps | Explains **why** demand exists and **when** it will shift |
| Static venue lists | AI-scored venues with real-time hours, pricing, and drive times |
| Generic tips | Personalized tactical strategies updated every 60 minutes |
| Single data source | 4 AI models + 13 external APIs synthesized into one directive |

---

## Feature Set

### Strategic Intelligence
- **TRIAD Waterfall Pipeline**: Parallel AI processing — Claude Opus 4.6 (strategy) + Gemini 3 Pro (briefing) + GPT-5.2 (tactical planning) — consolidated into a single directive in ~35-50 seconds
- **Smart Blocks**: Context-aware venue cards with validated hours, pricing tiers, "last call" countdowns, and drive-time estimates
- **Daily + Hourly Strategy**: Morning briefing covering weather/traffic/events, plus a rolling "Right Now" tactical plan for the next 60 minutes
- **Holiday Awareness**: Perplexity Sonar Pro detects local holidays and adjusts demand forecasts

### Venue & Location Intelligence
- **Real-time Venue Scoring**: Bars, clubs, and restaurants ranked by expense level, closing time, and proximity — enriched via Google Places + Routes APIs
- **Event ETL Pipeline**: 5-phase Extract-Transform-Load system discovering events from multiple providers, normalizing field names, geocoding, deduplicating via hash, and storing for briefings
- **6-Decimal GPS Precision**: ~11cm accuracy for cache keys and venue matching — coordinates always from Google APIs, never AI-generated
- **140+ Global Markets**: Pre-stored timezone and airport data for 69 US + 71 international markets, saving ~200-300ms per request

### AI Coach (Voice & Text)
- **Conversational AI**: Gemini 3 Pro-powered coach with full context awareness — knows your location, strategy, events, and market intelligence
- **Voice Mode**: Hands-free voice conversations via OpenAI Realtime API while driving
- **Cross-Session Memory**: Coach remembers preferences, vehicle type, past strategies, and driver-contributed zone intelligence
- **Action System**: Coach can write notes, deactivate irrelevant events/news, and contribute zone intelligence — all stored in the database

### Security & Authentication
- **Multi-Provider OAuth**: Email/password + Google OAuth + Uber OAuth (in progress)
- **JWT Authentication**: 15-minute access tokens + 7-day refresh tokens
- **Row-Level Security**: Database-level user data isolation via PostgreSQL RLS policies
- **9 Previously Unprotected Routes Secured**: Full auth audit completed Feb 2026

### Autonomous Documentation
- **Docs Agent**: Gemini-powered orchestrator that automatically detects code changes, maps them to affected documentation, generates updates, validates markdown, and publishes — reducing manual doc maintenance
- **Change Analyzer**: Runs on server startup, detects git changes, and flags documentation that may need updating
- **95+ README Files**: Every folder in the codebase has its own README

---

## Architecture

### System Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                         VECTO PILOT                               │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │         React Client (Vite 6 + React Router v6)              │ │
│  │  20 Routes (9 Co-Pilot + 5 Auth + 6 System)                 │ │
│  │  3 Context Providers | 48 shadcn/ui Components | 16 Hooks    │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                              ↓                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │             Gateway Server (Express, Port 5000)               │ │
│  │  30+ API Routes | SSE Real-time | Model Adapter Pattern       │ │
│  │  31 AI Roles via model-registry.js | Hedged Router            │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                              ↓                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │          PostgreSQL (Drizzle ORM, 25+ Tables)                 │ │
│  └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│                    EXTERNAL AI & API SERVICES                      │
│  • Anthropic Claude Opus 4.6  — Strategic reasoning               │
│  • OpenAI GPT-5.2             — Tactical planning                 │
│  • Google Gemini 3 Pro        — Briefing synthesis                │
│  • Perplexity Sonar Pro       — Real-time web research            │
│  • Google Maps Platform       — Places, Routes, Weather, AQ       │
│  • TomTom Traffic             — Incident prioritization            │
│  • FAA ASWS                   — Airport delay data                 │
└──────────────────────────────────────────────────────────────────┘
```

### AI Pipeline (TRIAD)

```
POST /api/blocks-fast → TRIAD Pipeline (~35-50s)
├── Phase 1 (Parallel): Strategist (Claude) + Briefer (Gemini) + Holiday (Perplexity)
├── Phase 2 (Parallel): Daily Strategy + Immediate "Right Now" Strategy (GPT-5.2)
├── Phase 3: Venue Planner (GPT-5.2) + Google Places/Routes Enrichment
└── Phase 4: Event Validator (Claude)
```

### Model Registry (31 Roles)

All AI interactions go through the adapter pattern — never direct API calls:

```javascript
import { callModel } from './lib/ai/adapters/index.js';
const result = await callModel('STRATEGY_CORE', { system, user });
// Routes to Claude Opus 4.6 with hedged fallback to Gemini Flash
```

| Category | Roles | Primary Model |
|----------|-------|---------------|
| Briefing | 9 roles (weather, traffic, news, events, validation) | Gemini 3 Pro |
| Strategy | 4 roles (core, context, tactical, daily) | Claude / GPT-5.2 |
| Venue | 6 roles (scorer, filter, traffic, events, reasoning) | GPT-5.2 |
| Coach | 1 role (conversational AI) | Gemini 3 Pro |
| Utilities | 4 roles (validators, parsers) | Mixed |
| Discovery | 2 roles (event/concierge) | Gemini 3 Pro |
| Docs | 1 role (autonomous doc generation) | Gemini 3 Pro |

---

## Technical Stack

**Frontend**
- **Framework**: React 18 + React Router v6
- **Build Tool**: Vite 6.x
- **Language**: TypeScript 5.x (strict mode)
- **Styling**: TailwindCSS 4 + Radix UI Primitives (48 shadcn/ui components)
- **State**: React Query (TanStack) + 3 Context Providers + Local State
- **Real-time**: SSE via singleton connection manager

**Backend**
- **Runtime**: Node.js 20+
- **Server**: Express.js (gateway-server.js)
- **Database**: PostgreSQL 15+ with Drizzle ORM (25+ tables)
- **Real-time**: Server-Sent Events (SSE) for strategy updates, WebSocket for Voice
- **Auth**: JWT (15min access + 7-day refresh) + Google OAuth + Uber OAuth
- **Workers**: Background strategy generator, change analyzer, event sync

**AI & APIs (13 External Services)**
- **Anthropic Claude Opus 4.6**: Strategic reasoning, event validation
- **Google Gemini 3.0 Pro Preview**: Briefing synthesis, coach, news/events
- **OpenAI GPT-5.2**: Tactical planning, venue scoring, consolidation
- **Perplexity Sonar Pro**: Real-time web research (holidays, local news)
- **Google Maps Platform**: Places, Routes, Weather, Air Quality, Geocoding, Timezone
- **TomTom Traffic API**: Traffic incident prioritization
- **FAA ASWS**: Airport delay and disruption data

---

## Route Structure

### Co-Pilot Routes (Protected)

| Route | Page | Purpose |
|-------|------|---------|
| `/co-pilot/strategy` | StrategyPage | AI strategy + Smart Blocks + Coach |
| `/co-pilot/bars` | VenueManagerPage | Premium venue listings |
| `/co-pilot/briefing` | BriefingPage | Weather, traffic, news, events |
| `/co-pilot/map` | MapPage | Interactive venue + event map |
| `/co-pilot/intel` | IntelPage | Rideshare intelligence |
| `/co-pilot/settings` | SettingsPage | User preferences + vehicle |
| `/co-pilot/about` | AboutPage | About + donation |
| `/co-pilot/policy` | PolicyPage | Privacy policy |

### Auth Routes (Public)

| Route | Page | Purpose |
|-------|------|---------|
| `/auth/sign-in` | SignInPage | Email/password login |
| `/auth/sign-up` | SignUpPage | Multi-step registration |
| `/auth/google/callback` | GoogleCallbackPage | Google OAuth code exchange |
| `/auth/uber/callback` | UberCallbackPage | Uber OAuth code exchange |
| `/auth/forgot-password` | ForgotPasswordPage | Password reset request |
| `/auth/reset-password` | ResetPasswordPage | Reset with token |

---

## Setup & Installation

### Prerequisites
- Node.js 20.x or higher
- PostgreSQL 15+ database
- API Keys: OpenAI, Anthropic, Google Gemini, Google Maps, Perplexity

### Quick Start

```bash
git clone <repo-url>
cd vecto-pilot
npm install
```

Create a `.env` file:
```bash
# Database
DATABASE_URL="postgresql://user:pass@host:5432/db"

# AI Providers
OPENAI_API_KEY="sk-..."
ANTHROPIC_API_KEY="sk-ant-..."
GEMINI_API_KEY="AIza..."
PERPLEXITY_API_KEY="pplx-..."

# Google Maps
GOOGLE_MAPS_API_KEY="AIza..."

# OAuth (optional)
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
UBER_CLIENT_ID="..."
UBER_CLIENT_SECRET="..."
```

```bash
npm run db:push    # Initialize database
npm run dev        # Start development server (port 5000)
```

### Commands

```bash
npm run dev              # Development server
npm run typecheck        # TypeScript checking
npm run lint             # ESLint
npm run test             # All tests
npm run lint && npm run typecheck && npm run build  # Pre-PR validation
```

---

## Usage Examples

### Calling an AI Model (Server)

```javascript
import { callModel } from './lib/ai/adapters/index.js';

// Use semantic role names — model is configured in model-registry.js
const strategy = await callModel('STRATEGY_CORE', {
  system: "You are a rideshare logistics expert...",
  user: "Analyze current conditions in downtown Austin."
});

// Hedged router automatically retries with fallback model on failure
```

### Triggering a Strategy Refresh (Client)

```typescript
const { refreshStrategy, isGenerating } = useCoPilot();

<Button onClick={() => refreshStrategy({ force: true })} disabled={isGenerating}>
  Generate New Strategy
</Button>
```

---

## Documentation

This codebase has **95+ README files** — every folder documents its own purpose.

### Quick Navigation

| Document | Purpose |
|----------|---------|
| [CLAUDE.md](CLAUDE.md) | AI assistant rules and development process |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture + folder index |
| [LESSONS_LEARNED.md](LESSONS_LEARNED.md) | Historical bugs and their fixes |
| [MODEL.md](MODEL.md) | AI model capabilities and parameters |
| [LEXICON.md](LEXICON.md) | Terminology and codebase reference |
| [docs/architecture/](docs/architecture/README.md) | 13 focused architecture documents |
| [docs/preflight/](docs/preflight/README.md) | Pre-flight cards (read before edits) |
| [docs/review-queue/](docs/review-queue/README.md) | Change analyzer findings |

### Architecture Documents

| Document | When to Read |
|----------|--------------|
| [ai-pipeline.md](docs/architecture/ai-pipeline.md) | Modifying AI flow or model config |
| [database-schema.md](docs/architecture/database-schema.md) | Working with tables |
| [api-reference.md](docs/architecture/api-reference.md) | Adding/modifying endpoints |
| [server-structure.md](docs/architecture/server-structure.md) | Modifying backend code |
| [client-structure.md](docs/architecture/client-structure.md) | Modifying frontend code |
| [constraints.md](docs/architecture/constraints.md) | Before ANY code change |

---

## Codebase Statistics

| Category | Count |
|----------|-------|
| Server JS/TS Files | ~245 |
| Client TSX/TS Files | ~161 |
| AI Model Roles | 31 |
| API Routes | 30+ |
| Database Tables | 25+ |
| README Files | 95+ |
| shadcn/ui Components | 48 |
| Custom React Hooks | 16 |
| Global Markets | 140+ |
| City Aliases | 3,333 |

---

## Security

- JWT authentication with token refresh
- Google OAuth 2.0 integration
- Row-Level Security (RLS) in PostgreSQL
- All API routes require `requireAuth` middleware (9 gaps fixed Feb 2026)
- IDOR vulnerability patched in feedback routes
- Push protection prevents secret commits
- Rate limiting on expensive endpoints
- Zod schema validation on all inputs

See [SECURITY.md](SECURITY.md) for full security policy.

---

## Performance Optimizations

- **90% reduction** in database queries via batch operations
- **70-90% reduction** in geocoding API calls via in-memory cache
- **60-80% reduction** in Routes API costs via traffic-aware cache
- **O(n*m) to O(n)** algorithm improvements via Set-based filtering
- **50-200ms** response time improvement via async snapshot backups

See [PERFORMANCE_OPTIMIZATIONS.md](PERFORMANCE_OPTIMIZATIONS.md) for details.

---

## Contribution Guidelines

1. **AI-First Workflow**: AI code is reviewed against `LESSONS_LEARNED.md` to avoid regression
2. **Adapter Pattern**: Never call AI APIs directly — always use `callModel(role)`
3. **Linting**: Run `npm run lint` before committing (zero-warning policy)
4. **Migrations**: Never modify existing SQL migrations — use `drizzle-kit generate`
5. **Testing**: Ensure `npm run typecheck` passes
6. **Documentation**: Update the folder README.md after any file changes
7. **No Fallbacks**: Missing data = error, not a default value (see CLAUDE.md)

---

## Roadmap

### Completed (v4.0 - v4.3)
- [x] Multi-model TRIAD pipeline (Claude + Gemini + GPT-5.2)
- [x] 31-role model registry with hedged routing and fallback
- [x] Smart Blocks with real-time venue enrichment
- [x] AI Coach with voice and text (Gemini 3 Pro + OpenAI Realtime)
- [x] Event ETL pipeline with 5-phase processing
- [x] Google OAuth integration
- [x] 140+ global market support with pre-stored timezones
- [x] Autonomous Docs Agent (Gemini-powered)
- [x] FAIL HARD pattern for critical data dependencies
- [x] 6-decimal GPS precision across all venue matching
- [x] Full auth audit — 9 routes secured
- [x] Adapter pattern hardening — 8 direct API calls eliminated
- [x] Change Analyzer with automated doc flagging

### In Progress
- [ ] Uber Driver API integration (OAuth connected, data sync pending)
- [ ] Concierge chat system for venue/event exploration
- [ ] Driver earnings analytics dashboard

### Planned
- [ ] Omni-Presence / Siri Interceptor (headless client for ride offer analysis)
- [ ] Reflection engine for AI self-improvement
- [ ] Redis caching for multi-instance deployments
- [ ] Push notifications for strategy alerts
- [ ] PWA offline support

---

## License

This project is licensed under the **MIT License**.

---

## Changelog

### v4.3.0 - Security & Autonomy (Feb 15, 2026)
- **Security**: Full auth audit — 9 unprotected routes secured, IDOR vulnerability patched
- **Autonomy**: Fixed Gemini Docs Agent orchestrator (4 critical bugs) — now auto-syncs docs with code
- **Auth**: Google OAuth integration complete with public callback routes
- **Hardening**: Eliminated 8 direct API calls; all AI now goes through adapter pattern with hedged fallback
- **Documentation**: Updated all 21 root documents; full codebase analysis published
- **Reliability**: Fixed logout race condition (cancel queries before clearing auth token)
- **Fix**: Resolved shell-level env overwrite that broke DOCS_GENERATOR API calls

### v4.2.0 - AI Coach & Identity (Feb 2026)
- **Feature**: AI Coach upgraded with full model identity, vision/OCR capabilities, and agent write access
- **Feature**: Concierge Chat system with venue/event exploration context
- **Auth**: Uber OAuth callback route and flow foundations
- **Fix**: Corrected all Anthropic model IDs from Claude 4.5 to Claude Opus 4.6 across adapters

### v4.1.0 - The "AI-Native" Update (Feb 2026)
- **Integration**: Merged "Vecto-Pilot-Ultimate" features — Hedged Routing, Uber Auth foundations
- **Infrastructure**: Migrated to ESLint v9 Flat Config
- **Architecture**: TRIAD parallel waterfall pipeline (~35s avg strategy generation)
- **Feature**: Voice AI Coach via OpenAI Realtime API
- **Reliability**: FAIL HARD pattern for critical data dependencies
- **Data**: 6-decimal GPS precision (~11cm accuracy)

### v4.0.0 - Global Scale (Jan 2026)
- Refactored from "Dallas-first" to purely location-agnostic architecture
- `coords_cache` reduces Google API costs by 40%
- Perplexity integration for global holiday awareness
- 140+ markets with pre-stored timezones and airport codes
- Server reorganization: domain-based `server/api/` + `server/lib/` structure
- 95+ README files across all folders
