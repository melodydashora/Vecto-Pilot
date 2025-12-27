# Vecto Pilot - AI-Powered Rideshare Intelligence Platform

**Production-Ready System Documentation**

---

## Overview

Vecto Pilot is an AI-powered rideshare intelligence platform that provides drivers with real-time, data-driven strategic briefings to maximize earnings. It integrates diverse data sources (location, events, traffic, weather, air quality) with advanced AI models to generate actionable venue recommendations and tactical intelligence.

### Key Features

- **Real-time Venue Intelligence**: AI-powered bar/restaurant discovery with expense-level sorting and last-call alerts
- **Smart Blocks System**: Structured, validated content blocks with venue recommendations
- **Voice AI Coach**: OpenAI Realtime API for hands-free voice chat
- **Strategy Waterfall**: Claude (Strategist) -> Gemini (Briefer/Consolidator) -> GPT-5.2 (Immediate Strategy)
- **Holiday-Aware**: Dynamic holiday detection via Perplexity
- **Location-Agnostic**: Works globally with any GPS location
- **Mobile-First UI**: React + TypeScript + TailwindCSS + Radix UI

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| **Frontend** | React 18 + TypeScript + Vite + TailwindCSS + Radix UI |
| **Backend** | Node.js 20+ + Express + PostgreSQL |
| **ORM** | Drizzle ORM with automated migrations |
| **AI Models** | Claude 4.5 (Anthropic) + GPT-5.2 (OpenAI) + Gemini 3 Pro Preview (Google) |
| **Voice** | OpenAI Realtime API (GPT-5.2) |
| **APIs** | Google Maps, Places, Routes, Weather, Air Quality |
| **Database** | PostgreSQL (Replit managed) |

---

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 15+ (or use Replit's managed database)
- npm package manager

### Installation

```bash
# Clone repository
git clone <repo-url>
cd vecto-pilot

# Install dependencies
npm install

# Set up database
npm run db:push

# Start development server
npm run dev
```

Visit `http://localhost:5000` to access the app.

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost/vecto_pilot

# AI Models (required)
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIzaSy...
GOOGLE_MAPS_API_KEY=AIzaSy...
ANTHROPIC_API_KEY=sk-ant-...
PERPLEXITY_API_KEY=pplx-...

# Model Configuration (optional - defaults shown)
STRATEGY_STRATEGIST=claude-opus-4-5-20251101
STRATEGY_BRIEFER=gemini-3-pro-preview
STRATEGY_CONSOLIDATOR=gemini-3-pro-preview
STRATEGY_HOLIDAY_CHECKER=sonar-pro
```

---

## Architecture

### System Overview

```
Browser/Mobile
      |
  HTTP/WebSocket
      |
Gateway Server (Port 5000)
  |-- SDK Routes (/api/*)
  |-- Agent Routes (/agent/*)
      |
PostgreSQL Database (Drizzle ORM)
      |
External AI/API Services
  |-- Anthropic (Claude Sonnet 4.5)
  |-- OpenAI (GPT-5.2, Realtime API)
  |-- Google (Gemini 3 Pro, Places, Routes, Weather, AQ)
  |-- Perplexity (Holiday detection)
```

### AI Pipeline - Strategy Waterfall

The strategy generation uses a parallel waterfall pipeline:

```
Snapshot Creation
      |
[Parallel Phase 1]
  |-- Strategist (Claude 4.5): Strategic overview
  |-- Briefer (Gemini 3 Pro): Events, traffic, news, weather
  |-- Holiday Checker (Perplexity): Holiday detection
      |
[Phase 2]
  |-- Consolidator (Gemini 3 Pro): Combine all data -> Daily Strategy
      |
[Phase 3]
  |-- Immediate Strategy (GPT-5.2): "Right now" tactical guidance
      |
[Phase 4]
  |-- Venue Generation (GPT-5.2): Smart Blocks with enrichment
```

**Total time**: 35-50 seconds for full waterfall

### Model Roles

| Role | Model | Purpose |
|------|-------|---------|
| `strategist` | Claude Sonnet 4.5 | Strategic overview (minstrategy) |
| `briefer` | Gemini 3 Pro Preview | Events, traffic, news, weather, closures |
| `consolidator` | Gemini 3 Pro Preview | Daily tactical strategy |
| `immediate` | GPT-5.2 | "Right now" guidance (next 1 hour) |
| `venue_planner` | GPT-5.2 | Smart Blocks venue recommendations |
| `validator` | Gemini 2.5 Pro | Event verification |
| `holiday_checker` | Perplexity Sonar Pro | Holiday detection |

---

## Database Schema

### Core Tables

- **`users`**: GPS coordinates, resolved address, timezone (authoritative location source)
- **`snapshots`**: Point-in-time context (location, time, weather, air quality)
- **`strategies`**: AI strategy outputs (minstrategy, consolidated_strategy, strategy_for_now)
- **`briefings`**: Comprehensive briefing data (events, news, traffic, weather, closures)
- **`rankings`**: Venue recommendation session metadata
- **`ranking_candidates`**: Individual venues with Google API enrichment
- **`coords_cache`**: Coordinate resolution cache (eliminates duplicate API calls)

### Key Relationships

```
users
  |-> snapshots (point-in-time context)
        |-> strategies (AI strategic outputs)
        |-> briefings (real-time intelligence)
        |-> rankings -> ranking_candidates (venue recommendations)
        |-> actions (user behavior tracking)
        |-> venue_feedback / strategy_feedback
```

---

## API Endpoints

### Location
- `POST /api/location/resolve` - Resolve GPS to city/state/timezone + weather + air quality

### Snapshot
- `POST /api/snapshot` - Create context snapshot (triggers waterfall)
- `GET /api/snapshot/:snapshotId` - Fetch specific snapshot

### Strategy
- `GET /api/strategy/:snapshotId` - Fetch strategy for snapshot
- `POST /api/blocks-fast` - Trigger full waterfall + venue generation

### Briefing
- `GET /api/briefing/weather/:snapshotId`
- `GET /api/briefing/traffic/:snapshotId`
- `GET /api/briefing/news/:snapshotId`
- `GET /api/briefing/events/:snapshotId`
- `GET /api/briefing/closures/:snapshotId`

### Chat
- `POST /api/chat` - AI coach text chat (SSE streaming)
- `WebSocket /api/realtime` - Voice chat

### Health
- `GET /health` - Basic health check
- `GET /ready` - Database connection status
- `GET /healthz` - Full system status

---

## File Structure

```
vecto-pilot/
├── client/                    # React Frontend
│   └── src/
│       ├── pages/            # Route pages (co-pilot.tsx is main dashboard)
│       ├── components/       # React components
│       ├── hooks/            # Custom hooks (TTS, strategy polling)
│       ├── contexts/         # React contexts (location, auth)
│       ├── features/         # Feature modules
│       └── App.tsx           # Root component
│
├── server/                    # Node.js Backend
│   ├── api/                  # API routes (domain-organized)
│   │   ├── auth/             # Authentication
│   │   ├── briefing/         # Events, traffic, news
│   │   ├── chat/             # AI Coach, voice
│   │   ├── health/           # Health checks, diagnostics
│   │   ├── location/         # GPS, geocoding
│   │   ├── strategy/         # Strategy generation (blocks-fast.js)
│   │   ├── venue/            # Venue intelligence
│   │   └── utils/            # Shared utilities
│   │
│   ├── lib/                  # Business logic
│   │   ├── ai/               # AI adapters and providers
│   │   │   ├── adapters/     # Model adapters (anthropic, openai, gemini)
│   │   │   └── providers/    # AI providers (minstrategy, briefing, etc.)
│   │   ├── strategy/         # Strategy pipeline
│   │   ├── venue/            # Venue intelligence
│   │   ├── location/         # Location services
│   │   └── infrastructure/   # Logging, job queue
│   │
│   ├── config/               # Configuration
│   ├── db/                   # Database connection
│   ├── middleware/           # Request middleware
│   ├── bootstrap/            # Server startup
│   └── jobs/                 # Background workers
│
├── shared/                    # Shared code
│   └── schema.js             # Drizzle ORM schema
│
├── docs/                      # Documentation
│   └── architecture/         # API reference, database schema, AI pipeline
│
├── gateway-server.js          # Main entry point
└── package.json
```

**Every folder has a README.md** - start exploring from any folder's README.

---

## Development

### Commands

```bash
npm run dev        # Start development server
npm run build      # Build for production
npm run lint       # Run ESLint
npm run typecheck  # TypeScript type checking
npm run db:push    # Push schema to database
```

### Code Conventions

- **TypeScript**: Strict mode enabled
- **React**: Functional components + hooks
- **Database**: Drizzle schema-first
- **API**: RESTful endpoints
- **Unused variables**: Prefix with `_` (e.g., `_unused`)

---

## Caching Strategy

### Briefing Data (Split Cache)
- **Daily Briefing** (news, events, closures): 24-hour cache
- **Traffic**: Always refreshes on app open (0 TTL)

### Coords Cache
- **Purpose**: Eliminate duplicate Google API calls
- **Key**: 4-decimal coordinate hash (~11m precision)
- **Storage**: 6-decimal coordinates (~11cm precision)
- **Benefit**: ~$0.005 saved per repeat location lookup

---

## Troubleshooting

### Database Connection Issues
- Verify `DATABASE_URL` is set correctly
- Check network connectivity
- For Replit: Use built-in PostgreSQL

### API Key Issues
- Verify all API keys are set in environment
- Check key permissions and quotas
- Test with curl examples in MODEL.md

### Strategy Generation Hangs
- Check AI provider API status
- Review server logs for errors
- Refresh page and retry

---

## Related Documentation

| Document | Purpose |
|----------|---------|
| [CLAUDE.md](CLAUDE.md) | AI assistant instructions (start here) |
| [docs/README.md](docs/README.md) | Documentation index |
| [docs/architecture/api-reference.md](docs/architecture/api-reference.md) | Complete API documentation |
| [docs/architecture/database-schema.md](docs/architecture/database-schema.md) | PostgreSQL tables |
| [docs/architecture/ai-pipeline.md](docs/architecture/ai-pipeline.md) | TRIAD AI pipeline |
| [docs/architecture/constraints.md](docs/architecture/constraints.md) | Critical rules |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Detailed system architecture |
| [LESSONS_LEARNED.md](LESSONS_LEARNED.md) | Pitfalls and best practices |
| [REORGANIZATION_PLAN.md](REORGANIZATION_PLAN.md) | Codebase organization status |

---

**Last Updated**: December 10, 2025
**Status**: Production Ready
