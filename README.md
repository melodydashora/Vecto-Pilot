# Vecto Pilot - AI-Powered Rideshare Intelligence Platform

**Last Updated:** 2026-08-17 | **Version:** 4.3.0 | **Status:** Deployed (Replit → Cloud Run) — field-testing the Offer Analyzer shortcuts

> **Built by AI, For AI-Assisted Drivers.**
>
> This application is a reference implementation of AI-assisted software engineering — architected and built as a partnership between **Melody Dashora** (product intent, rules, field testing) and **Anthropic Claude** (Fable 5 / Opus 4.8) as engineering partner, with **Google Gemini** and **OpenAI GPT** models doing the runtime work through a model-agnostic adapter (roles, not vendors). See [`AI_PARTNERSHIP_AGREEMENT.md`](AI_PARTNERSHIP_AGREEMENT.md) and [`CLAUDE.md`](CLAUDE.md).

---

## Overview

Vecto Pilot is an AI-native rideshare intelligence platform that maximizes driver earnings through real-time, data-driven strategic briefings and instant offer verdicts. It uses a **multi-model AI waterfall** (Strategist → Briefer → Consolidator → Planner roles) to synthesize weather, traffic, events, and news into actionable, narrative-driven strategies, and a **per-driver rules engine + vision model** to answer "take this ride?" from a screenshot in under a second.

It operates globally across 140+ markets, requires no hardware integration, and provides a "Co-Pilot" experience via text and voice — plus phone shortcuts (iPhone Shortcuts, Android automation apps) that speak ACCEPT/REJECT hands-free.

### What Makes This Different

| Traditional Apps | Vecto Pilot |
|------------------|-------------|
| Show surge heatmaps | Explains **why** demand exists and **when** it will shift |
| Static venue lists | AI-scored venues with real-time hours, pricing, and drive times |
| Generic tips | Personalized tactical strategies updated every 60 minutes |
| Single data source | Multiple AI roles + 13 external APIs synthesized into one directive |
| "Is this offer worth it?" guesswork | **Offer Analyzer**: your own sliders (floor $/mi, $/min, max minutes, max miles, avoid places, gates) applied to a screenshot in ~0.7 s, spoken back |

---

## Feature Set

### Strategic Intelligence
- **Waterfall Pipeline**: Parallel AI roles — Strategist (Claude Opus 4.8) + Briefer (Gemini 3.5 Flash) + Planner (GPT-5.5) — consolidated into a single directive in ~35-50 seconds
- **Smart Blocks**: Context-aware venue cards with validated hours, pricing tiers, "last call" countdowns, and drive-time estimates
- **Daily + Hourly Strategy**: Morning briefing covering weather/traffic/events, plus a rolling "Right Now" tactical plan for the next 60 minutes
- **Holiday Awareness**: Gemini (BRIEFING_HOLIDAY role, search-grounded) detects local holidays in the briefing pipeline and adjusts demand forecasts

### Venue & Location Intelligence
- **Real-time Venue Scoring**: Bars, clubs, and restaurants ranked by expense level, closing time, and proximity — enriched via Google Places + Routes APIs
- **Event ETL Pipeline**: 5-phase Extract-Transform-Load system discovering events from multiple providers, normalizing field names, geocoding, deduplicating via hash, and storing for briefings
- **6-Decimal GPS Precision**: ~11cm accuracy for cache keys and venue matching — coordinates always from Google APIs, never AI-generated
- **330+ Global Markets**: Pre-stored timezone and airport data for 267 US + 71 international markets, saving ~200-300ms per request

### Offer Analyzer (iPhone + Android shortcuts)
- **Per-driver rules, sliders only**: floor $/mi, optional $/min, max trip minutes, max total miles per tier; rating floor, Verified, pickup/time limits, acceptance-rate protection; avoid-places by Google `place_id`; road-safety and notice toggles — edited on the web page, applied by the server
- **Two lanes, one ruleset**: a deterministic engine owns every numeric rule (text rejects answer in ~1 ms with no model); the vision model (`gemini-3.5-flash-lite`, live-benchmarked 2026-08-17) reads the screenshot for what only a picture shows, and the engine re-checks its numbers — **~0.7 s verdicts, spoken back** ("Accept. dollar forty per mile, 6 miles.")
- **Honest floor**: no fabricated verdicts — a non-offer screenshot says "No data. Decide manually."
- **Learning dataset**: every offer stored with the driver's own outcome and earnings (`offer_intelligence` + `offer_outcomes`), geocoded pickup/drop-off, and the exact ruleset hash that decided it
- Guides: [iPhone](docs/architecture/SIRI_SHORTCUT_ANALYZE.md) · [Android](docs/architecture/ANDROID_SHORTCUT_ANALYZE.md) · [as built](docs/architecture/OFFER_ANALYZER.md) · [roadmap](docs/architecture/OFFER_ANALYZER_ROADMAP.md)

### Rideshare Coach (Voice & Text)
- **One Coach, wellbeing first**: Gemini 3.6 Flash brain with full context awareness — location, strategy, events, market intelligence, your offer history — driver support is the main function, strategy serves it
- **Voice**: Gemini Live is the Coach's voice (auto-starts on the tab, hands-free "hey coach" resume, transparent reconnect); GPT Realtime and classic TTS remain selectable. The voice model is the *mouth*; the backend brain answers the hard questions
- **Cross-Session Memory + learning loop**: preferences, vehicle, past strategies, driver-contributed zone intelligence, and verbatim voice turns captured for learning
- **Action System**: Coach can write notes, deactivate irrelevant events/news, and contribute zone intelligence — all stored in the database. The Coach never analyzes live offers (that's the Offer Analyzer's lane)

### Security & Authentication
- **Multi-Provider OAuth**: Email/password + Google OAuth + Uber OAuth (in progress)
- **Standard JWT Auth Tokens (HS256)**: 3-segment JWTs via `server/lib/jwt.js` (AUTH-003); legacy `userId.signature` HMAC accepted only during the transition window — see [SECURITY.md](docs/architecture/SECURITY.md)
- **9 Previously Unprotected Routes Secured**: Full auth audit completed Feb 2026
- **Public endpoint exceptions**: `/api/hooks/analyze-offer` (phone shortcuts — identity is a per-driver shortcut token, rate-limited 20/min; the read/mutate hook routes require the token), `/api/platform/*` (reference data), health/monitoring — see SECURITY.md for full list
- **RLS**: Planned (currently enforced at application layer via `requireAuth` middleware)

### Assisted Documentation Maintenance
- **Docs Agent**: Gemini-powered orchestrator that detects code changes and proposes documentation updates — operates under guard rails (protected-file list, shrinkage detection, structural validation, trust tiers)
- **Change Analyzer**: Available as a manual job (`server/jobs/change-analyzer-job.js`) that detects git changes and flags documentation for review — not currently wired into server startup
- **300+ README Files**: Most folders in the codebase have their own README

---

## Architecture

### System Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                         VECTO PILOT                               │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │         React Client (Vite 7 + React Router v7)              │ │
│  │  28 Routes (14 Co-Pilot + 6 Auth + 8 Public)                 │ │
│  │  3 Context Providers | 47 shadcn/ui Components | 16 Hooks    │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                              ↓                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │             Gateway Server (Express, Port 5000)               │ │
│  │  35+ API Routes | SSE Real-time | Model Adapter Pattern       │ │
│  │  25 AI Roles via model-registry.js | Hedged Router            │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                              ↓                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │          PostgreSQL (Drizzle ORM, 66 Tables)                  │ │
│  └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│                    EXTERNAL AI & API SERVICES                      │
│  • Anthropic Claude Opus 4.8  — Strategic + tactical reasoning    │
│  • OpenAI GPT-5.5             — Venue planning/parsing            │
│  • Google Gemini 3.5 Flash-Lite / 3.5 Flash / 3.6 Flash / 3.1 Pro / Live — offer analysis, briefing, coach + voice │
│  • Google Maps Platform       — Places, Routes, Weather, AQ       │
│  • TomTom Traffic             — Incident prioritization            │
│  • FAA ASWS                   — Airport delay data                 │
└──────────────────────────────────────────────────────────────────┘
```

### AI Pipeline (strategy waterfall)

```
POST /api/blocks-fast → waterfall (~35-50s)
├── Phase 1 (Parallel): Strategist (Claude) + Briefer (Gemini) + Holiday (Gemini)
├── Phase 2: Immediate "Right Now" tactical strategy (Claude Opus 4.8)
├── Phase 3: Venue Planner (GPT-5.5) + Google Places/Routes Enrichment
└── Phase 4: Deterministic event validation + venue event verification (Gemini Flash)
```

### Model Registry (25 Roles)

All AI interactions go through the adapter pattern — never direct API calls:

```javascript
import { callModel } from './lib/ai/adapters/index.js';
const result = await callModel('STRATEGY_CORE', { system, user });
// Routes to Claude Opus 4.8 with hedged fallback to Gemini Flash
```

| Category | Roles | Primary Model |
|----------|-------|---------------|
| Briefing | 7 roles (traffic, news, events, fallback, schools, airport, holiday) | Gemini 3.5 Flash |
| Strategy | 3 roles (core, context, tactical) | Claude Opus 4.8 / Gemini Flash |
| Venue | 4 roles (scorer, filter, traffic, event verifier) | GPT-5.5 / Claude Haiku / Gemini Flash |
| Coach | 3 roles (brain, Gemini Live voice, GPT Realtime voice) | Gemini 3.6 Flash / Gemini 3.1 Flash Live / gpt-realtime |
| Utilities | 3 roles (research, market parser, translation) | Mixed |
| Concierge | 2 roles (search, chat) | Gemini 3.5 Flash |
| Offer Analyzer | 2 roles (Phase 1 sync verdict, Phase 2 async deep extraction) | Gemini 3.5 Flash-Lite / Gemini 3.1 Pro |
| Docs | 1 role (autonomous doc generation) | Gemini 3.5 Flash |

---

## Technical Stack

**Frontend** (see `package.json` for exact versions)
- **Framework**: React 19 + React Router v7
- **Build Tool**: Vite 7
- **Language**: TypeScript 5 (strict mode)
- **Styling**: TailwindCSS 4 + Radix UI Primitives (47 shadcn/ui components)
- **State**: React Query (TanStack) + 3 Context Providers + Local State
- **Real-time**: SSE via singleton connection manager

**Backend**
- **Runtime**: Node.js 18+
- **Server**: Express.js (gateway-server.js)
- **Database**: PostgreSQL 16 (Replit Helium) with Drizzle ORM (66 tables)
- **Real-time**: Server-Sent Events (SSE) for strategy updates, WebSocket for Voice
- **Auth**: Standard JWT (HS256) + Google OAuth + Uber OAuth
- **Workers**: Background strategy generator

**AI & APIs** (see [docs/AI_ROLE_MAP.md](docs/AI_ROLE_MAP.md) for current model assignments)
- **Anthropic**: Strategy, validation
- **Google Gemini**: Briefing synthesis, coach, news/events
- **OpenAI**: Venue scoring, voice
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
| `/co-pilot/intel` | IntelPage | Rideshare intelligence |
| `/co-pilot/settings` | SettingsPage | User preferences + vehicle |
| `/co-pilot/about` | AboutPage | About + donation |
| `/co-pilot/policy` | PolicyPage | Privacy policy |
| `/co-pilot/coach` | CoachPage | Dedicated AI Coach surface |
| `/co-pilot/concierge` | ConciergePage | Driver concierge/QR management |
| `/co-pilot/offer-analyzer` | OfferAnalyzerPage | Per-driver offer rules (sliders) + shortcut token + offers/outcomes |
| `/co-pilot/translate` | TranslationPage | Real-time rider translation |
| `/co-pilot/schedule` | SchedulePage | Driving schedule |
| `/co-pilot/donate` | DonatePage | Donations |
| `/co-pilot/help` | HelpPage | Help |

### Auth Routes (Public)

| Route | Page | Purpose |
|-------|------|---------|
| `/auth/sign-in` | SignInPage | Email/password login |
| `/auth/sign-up` | SignUpPage | Multi-step registration |
| `/auth/google/callback` | GoogleCallbackPage | Google OAuth code exchange |
| `/auth/terms` | TermsPage | Terms of service |
| `/auth/forgot-password` | ForgotPasswordPage | Password reset request |
| `/auth/reset-password` | ResetPasswordPage | Reset with token |

> Uber OAuth is handled server-side at GET /api/auth/uber/callback (no client route).

---

## Setup & Installation

### Prerequisites
- Node.js 18+ (see `package.json` engines)
- PostgreSQL 16 (Replit Helium, or any PostgreSQL 15+)
- API Keys: OpenAI, Anthropic, Google Gemini, Google Maps

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
OPENAI_API_KEY="$OPENAI_API_KEY"
ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"
GEMINI_API_KEY="$GEMINI_API_KEY"
PERPLEXITY_API_KEY="$PERPLEXITY_API_KEY"  # optional — currently unused

# Google Maps
GOOGLE_MAPS_API_KEY="$GOOGLE_MAPS_API_KEY"

# OAuth (optional)
GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID"
GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET"
UBER_CLIENT_ID="$UBER_CLIENT_ID"
UBER_CLIENT_SECRET="$UBER_CLIENT_SECRET"
```

```bash
npm run dev        # Start development server (port 5000) — migrations/*.sql apply automatically at boot (server/db/run-migrations.js)
```

### Commands

```bash
npm run dev              # Development server
npm run typecheck        # TypeScript checking
npm run lint             # ESLint
npm run test:unit        # Unit tests (jest, ESM)
npm run lint && npm run typecheck && npm run build  # Pre-PR validation
node scripts/offer-analyzer-smoke.mjs               # Offer Analyzer smoke against any deployment (BASE/TOKEN/IMAGE)
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
const { refetchBlocks, isBlocksLoading } = useCoPilot();

<Button onClick={() => refetchBlocks()} disabled={isBlocksLoading}>
  Refresh Blocks
</Button>
```

---

## Documentation

This codebase has **300+ README files** — most folders document their own purpose.

### Quick Navigation

| Document | Purpose |
|----------|---------|
| [CLAUDE.md](CLAUDE.md) | Partnership orientation — principles + the session boot sequence |
| [AI_PARTNERSHIP_AGREEMENT.md](AI_PARTNERSHIP_AGREEMENT.md) | The constitution: authority, provenance, working rules |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture + folder index |
| [LESSONS_LEARNED.md](LESSONS_LEARNED.md) | Historical bugs and their fixes |
| [docs/preflight/ai-models.md](docs/preflight/ai-models.md) | AI model reference and parameter constraints |
| [LEXICON.md](LEXICON.md) | Terminology and codebase reference |
| [docs/architecture/](docs/architecture/README.md) | 75+ architecture documents (canonical index) |
| [docs/preflight/](docs/preflight/README.md) | Pre-flight cards (read before edits) |
| [docs/review-queue/](docs/review-queue/README.md) | Change analyzer findings |

### Architecture Documents

> Full index at [docs/architecture/README.md](docs/architecture/README.md) (75+ documents). Key entry points:

| Document | When to Read |
|----------|--------------|
| `app_rules` table (Postgres) — active product invariants | **Before ANY code change** |
| [DB_SCHEMA.md](docs/architecture/DB_SCHEMA.md) | Working with tables or migrations |
| [API_REFERENCE.md](docs/architecture/API_REFERENCE.md) | Adding/modifying endpoints |
| [ai-pipeline.md](docs/architecture/ai-pipeline.md) | Modifying strategy pipeline |
| [OFFER_ANALYZER.md](docs/architecture/OFFER_ANALYZER.md) + [ROADMAP](docs/architecture/OFFER_ANALYZER_ROADMAP.md) | Offer Analyzer as built + plan going forward |
| [SIRI_SHORTCUT_ANALYZE.md](docs/architecture/SIRI_SHORTCUT_ANALYZE.md) / [ANDROID_SHORTCUT_ANALYZE.md](docs/architecture/ANDROID_SHORTCUT_ANALYZE.md) | Setting up a phone for offer analysis |
| [VENUES.md](docs/architecture/VENUES.md) | Working with venues/blocks |
| [AI_ROLE_MAP.md](docs/AI_ROLE_MAP.md) | AI model assignments per role |

---

## Codebase Statistics

| Category | Count |
|----------|-------|
| Server JS/TS Files | ~260 |
| Client TSX/TS Files | ~195 |
| AI Model Roles | 25 |
| API Routes | 35+ |
| Database Tables | 66 |
| README Files | 300+ |
| shadcn/ui Components | 47 |
| Custom React Hooks | 16 |
| Global Markets | 338 |
| City Aliases | 3,437 |

---

## Security

- Standard JWT auth tokens (HS256); legacy HMAC transition path pending removal
- Google OAuth 2.0 integration
- Most API routes require `requireAuth` middleware (9 gaps fixed Feb 2026); intentionally public exceptions documented
- RLS planned — currently enforced at application layer
- IDOR vulnerability patched in feedback routes
- Push protection prevents secret commits
- Rate limiting on expensive endpoints; public offer hook keyed by per-driver shortcut token (unguessable, revocable)
- Zod schema validation on all inputs

- [docs/architecture/SECURITY.md](docs/architecture/SECURITY.md) — internal security architecture and gap analysis
- [SECURITY.md](SECURITY.md) — vulnerability reporting policy (for external security researchers)

---

## Performance Optimizations

- **90% reduction** in database queries via batch operations
- **70-90% reduction** in geocoding API calls via in-memory cache
- **60-80% reduction** in Routes API costs via traffic-aware cache
- **O(n*m) to O(n)** algorithm improvements via Set-based filtering
- **50-200ms** response time improvement via async snapshot backups

See [docs/architecture/SCALABILITY.md](docs/architecture/SCALABILITY.md) for canonical scalability posture.

---

## Contribution Guidelines

1. **AI-First Workflow**: AI code is reviewed against `LESSONS_LEARNED.md` to avoid regression
2. **Adapter Pattern**: Never call AI APIs directly — always use `callModel(role)`
3. **Linting**: Run `npm run lint` before committing (zero-warning policy)
4. **Migrations**: Never modify existing migration files. New schema changes via `drizzle-kit generate`; direct-SQL exceptions allowed per [DB_SCHEMA.md §13](docs/architecture/DB_SCHEMA.md) policy
5. **Testing**: Run `npm test` (unit + E2E) and `npm run typecheck`. See [TESTING.md](docs/architecture/TESTING.md) for full test doctrine
6. **Documentation**: Update the folder README.md after any file changes
7. **No Fallbacks**: Missing data = error, not a default value (see CLAUDE.md)

---

## Roadmap

### Completed (v4.0 - v4.3)
- [x] Multi-model waterfall pipeline (Claude + Gemini + GPT)
- [x] 23-role model registry with hedged routing and fallback
- [x] Smart Blocks with real-time venue enrichment
- [x] Rideshare Coach with voice and text (Gemini 3 Pro + OpenAI Realtime)
- [x] Event ETL pipeline with 5-phase processing
- [x] Google OAuth integration
- [x] 140+ global market support with pre-stored timezones
- [x] Autonomous Docs Agent (Gemini-powered)
- [x] FAIL HARD pattern for critical data dependencies
- [x] 6-decimal GPS precision across all venue matching
- [x] Full auth audit — 9 routes secured
- [x] Adapter pattern hardening — 8 direct API calls eliminated
- [x] Change Analyzer with automated doc flagging
- [x] Concierge chat system (public /c/:token passenger page + driver concierge management)
- [x] Offer Analyzer v3 → v3.1 (2026-07/08): per-driver DB rulesets edited with sliders, shortcut-token identity, deterministic engine + vision arbitration, ~0.7 s verdicts on `gemini-3.5-flash-lite`, honest-floor NO DATA, iPhone + Android setup guides
- [x] One Coach voice (Gemini Live) with backend brain, wake-phrase resume, learning loop (2026-08)
- [x] Multi-user integrity sweep — per-user scoping of offers/coach context/hooks (2026-08)

### In Progress
- [ ] Offer Analyzer field test on real phones (iPhone Shortcuts + Android HTTP Shortcuts) — see roadmap G1–G3
- [ ] Coach offer-pattern intelligence (daypart / day-of-week / zone / season steering from `offer_intelligence`)
- [ ] Uber Driver API integration (OAuth connected, data sync pending)
- [ ] Driver earnings analytics dashboard

### Planned
- [ ] Native phone shell (background voice, one-tap offer capture) — todo #37
- [ ] Offer Analyzer Phase-B sliders: drought fallback, budge, acceptance-rate punchcard
- [ ] Reflection engine for AI self-improvement
- [ ] Redis caching for multi-instance deployments
- [ ] Push notifications for strategy alerts
- [ ] PWA offline support

---

## License

This project is licensed under the **MIT License**.

---

## Changelog

### 2026-08-17 — Offer Analyzer v3.1 + docs consolidation (unreleased tag)
- **Offer Analyzer**: Phase-1 model → `gemini-3.5-flash-lite` after a live 8-model bench (~0.7 s vision, 0 truncated replies); temperature 0.1 honored; JSON-repair parser; honest-floor guard; vision arbitration (engine owns numeric rules on extracted numbers); sliders-only Rate Targets (D4) with per-tier max minutes/miles and a $/hr readout
- **Docs**: `OFFER_ANALYZER.md` rewritten as-built, `OFFER_ANALYZER_ROADMAP.md`, iPhone + Android shortcut guides; plan/design docs retired; route registry completeness pass; live-DB schema doc regenerated
- **Repo**: `CLAUDE.md` adopted the principles revision; comment-hygiene and schema-drift cleanups

### 2026-08 (early) — One Coach voice + multi-user integrity
- Gemini Live as the Coach's voice with backend brain, wake-phrase resume, learning loop; per-user scoping sweep; app_rules `coach-never-analyzes-offers`

### 2026-07 — Offer Analyzer v3 + product rules table
- Per-driver DB rulesets (v3 engine), editor page, shortcut-token bridge; `app_rules` table; GPS-only timezone doctrine; boot-time migration runner

### v4.3.0 - Security & Autonomy (Feb 15, 2026)
- **Security**: Full auth audit — 9 unprotected routes secured, IDOR vulnerability patched
- **Autonomy**: Fixed Gemini Docs Agent orchestrator (4 critical bugs) — now auto-syncs docs with code
- **Auth**: Google OAuth integration complete with public callback routes
- **Hardening**: Eliminated 8 direct API calls; all AI now goes through adapter pattern with hedged fallback
- **Documentation**: Updated all 21 root documents; full codebase analysis published
- **Reliability**: Fixed logout race condition (cancel queries before clearing auth token)
- **Fix**: Resolved shell-level env overwrite that broke DOCS_GENERATOR API calls

### v4.2.0 - Rideshare Coach & Identity (Feb 2026)
- **Feature**: Rideshare Coach upgraded with full model identity, vision/OCR capabilities, and agent write access
- **Feature**: AI Concierge Assistant with venue/event exploration context
- **Auth**: Uber OAuth callback route and flow foundations
- **Fix**: Corrected all Anthropic model IDs from Claude 4.5 to Claude Opus 4.6 across adapters

### v4.1.0 - The "AI-Native" Update (Feb 2026)
- **Integration**: Merged "Vecto-Pilot-Ultimate" features — Hedged Routing, Uber Auth foundations
- **Infrastructure**: Migrated to ESLint v9 Flat Config
- **Architecture**: TRIAD parallel waterfall pipeline (~35s avg strategy generation)
- **Feature**: Voice Rideshare Coach via OpenAI Realtime API
- **Reliability**: FAIL HARD pattern for critical data dependencies
- **Data**: 6-decimal GPS precision (~11cm accuracy)

### v4.0.0 - Global Scale (Jan 2026)
- Refactored from "Dallas-first" to purely location-agnostic architecture
- `coords_cache` reduces Google API costs by 40%
- Perplexity integration for global holiday awareness
- 140+ markets with pre-stored timezones and airport codes
- Server reorganization: domain-based `server/api/` + `server/lib/` structure
- 95+ README files across all folders
