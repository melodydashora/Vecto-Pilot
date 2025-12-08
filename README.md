# Vecto Pilot™ - AI-Powered Rideshare Intelligence Platform

**Complete System Documentation & Deployment Guide**

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Architecture](#architecture)
4. [Setup Guide](#setup-guide)
5. [Environment Configuration](#environment-configuration)
6. [Database Schema](#database-schema)
7. [AI Pipeline](#ai-pipeline)
8. [API Documentation](#api-documentation)
9. [Deployment](#deployment)
10. [Troubleshooting](#troubleshooting)

---

## 🎯 Overview

**Vecto Pilot** is an AI-powered rideshare intelligence platform that provides drivers with real-time, data-driven strategic briefings to maximize earnings. It integrates diverse data sources (location, events, traffic, weather, air quality) with advanced AI models to generate actionable venue recommendations and tactical intelligence.

### Key Features

- ✅ **Real-time Venue Intelligence**: AI-powered bar/restaurant discovery with expense-level sorting and last-call alerts
- ✅ **Smart Blocks System**: Structured, validated content blocks with 7 types
- ✅ **Voice AI Coach**: OpenAI Realtime API (GPT-4o) for hands-free voice chat (232-320ms latency)
- ✅ **Strategy Waterfall**: Claude (Strategist) → Perplexity (Briefer) → GPT-5.1 (Consolidator)
- ✅ **Holiday-Aware**: Dynamic holiday detection and special hours handling
- ✅ **Phone Number Enrichment**: Google Places integration for bar contact numbers
- ✅ **Location-Agnostic**: Works globally with any GPS location
- ✅ **Mobile-First UI**: React + TypeScript + TailwindCSS + Radix UI
- ✅ **Production Ready**: Comprehensive logging, security, database resilience

### Tech Stack

| Component | Technology |
|-----------|-----------|
| **Frontend** | React 18 + TypeScript + Vite + TailwindCSS + Radix UI |
| **Backend** | Node.js 20+ + Express + PostgreSQL |
| **ORM** | Drizzle ORM with automated migrations |
| **AI Models** | Claude (Anthropic) + GPT-5.1 (OpenAI) + Gemini 2.0 (Google) + Perplexity |
| **Voice** | OpenAI Realtime API (GPT-4o) |
| **APIs** | Google Maps, Google Places, Weather, Air Quality |
| **Database** | PostgreSQL (Replit managed or Neon) |
| **Hosting** | Replit, Cloud Run, or self-hosted Node.js |

---

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 15+ (or use Replit's managed database)
- npm/yarn package manager

### Installation (5 minutes)

```bash
# Clone repository
git clone <repo-url>
cd vecto-pilot

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Set up database
npm run db:push

# Start development server
npm run dev
```

Visit `http://localhost:5000` to access the app.

### Deploying to Replit

1. Create new Replit project from this repository
2. Configure secrets in Replit Secrets panel:
   - `DATABASE_URL` (from Replit PostgreSQL or Neon)
   - `OPENAI_API_KEY` (for voice + GPT-5.1)
   - `GEMINI_API_KEY` (for venue intelligence)
   - `GOOGLE_MAPS_API_KEY` (for location services)
   - `ANTHROPIC_API_KEY` (for Claude)
   - `PERPLEXITY_API_KEY` (for briefing research)
3. Click "Run" - the app starts automatically

---

## 🏗️ Architecture

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser / Mobile                        │
└────────────────────────┬────────────────────────────────────┘
                         │
                    HTTP/WebSocket
                         │
        ┌────────────────┴────────────────┐
        │                                 │
   ┌────▼──────────────────────────────┐  │
   │    Gateway Server (Port 5000)     │  │
   │  - Serves React SPA               │  │
   │  - Routes API requests            │  │
   │  - Manages child processes        │  │
   └────┬──────────────────────────────┘  │
        │                                 │
   ┌────▼──────────────────────────────┐  │
   │    Backend Routes & API           │  │
   │  - /api/location/*                │  │
   │  - /api/blocks-fast               │  │
   │  - /api/voice-token               │  │
   │  - /api/snapshots/*               │  │
   └────┬──────────────────────────────┘  │
        │                                 │
   ┌────▼──────────────────────────────┐  │
   │    AI Pipeline & External APIs    │  │
   │  - Strategy waterfall             │  │
   │  - Venue intelligence (Gemini)    │  │
   │  - Location/Weather/Air quality   │  │
   │  - Phone enrichment (Google)      │  │
   └────┬──────────────────────────────┘  │
        │                                 │
   ┌────▼──────────────────────────────┐  │
   │    PostgreSQL Database            │  │
   │  - users, snapshots               │  │
   │  - strategies, events             │  │
   │  - venues, analytics              │  │
   └───────────────────────────────────┘  │
        │                                 │
   ┌────▼──────────────────────────────┐  │
   │    External Services              │  │
   │  - Google Maps/Places/Routes      │  │
   │  - OpenAI (GPT-5, Realtime)       │  │
   │  - Anthropic Claude               │  │
   │  - Google Gemini                  │  │
   │  - Perplexity                     │  │
   │  - Weather/AQI APIs               │  │
   └───────────────────────────────────┘  │
```

### Data Flow

**1. User Opens App**
- Browser detects geolocation (GPS)
- Sends coordinates to `/api/location/resolve`

**2. Location & Context Gathering**
- Resolves city/state/timezone
- Fetches weather data
- Fetches air quality index
- Creates snapshot in database

**3. Strategy Waterfall** (parallel, ~30-40s)
- **Strategist** (Claude): Analyzes day part, location, holiday → generates strategic overview
- **Briefer** (Perplexity): Researches events, traffic, popular areas → comprehensive brief
- **Consolidator** (GPT-5.1): Combines strategies + web search → final tactical briefing
- Results emitted via SSE (Server-Sent Events)

**4. Venue Intelligence** (parallel, ~5-10s)
- **Gemini 2.0 Flash**: Searches nearby bars/restaurants
- **Google Places**: Enriches with phone numbers for bars
- Sorts by expense level, filters by hours, identifies last-call opportunities

**5. UI Rendering**
- Strategy blocks stream in as they complete
- Venue cards populate with expense badges, hours, crowds
- Phone numbers clickable for bar venues (tel: links)
- Navigate button opens Google Maps directions

---

## 🔧 Setup Guide

### Step 1: Clone & Install

```bash
git clone <repo-url>
cd vecto-pilot
npm install
```

### Step 2: Configure Environment

Create `.env` file (see examples below):

```bash
# Database (use one)
DATABASE_URL=postgresql://user:pass@localhost/vecto_pilot
# OR on Replit, use Secrets: DATABASE_URL from Replit PostgreSQL

# AI Models (required)
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIzaSy...
GOOGLE_MAPS_API_KEY=AIzaSy...
ANTHROPIC_API_KEY=sk-ant-...
PERPLEXITY_API_KEY=pplx-...

# Optional: Override default models
STRATEGY_STRATEGIST=claude-opus-4-1-20250805
STRATEGY_BRIEFER=sonar-pro
STRATEGY_CONSOLIDATOR=gpt-5.1
STRATEGY_HOLIDAY_CHECKER=llama-3.1-sonar-small-128k-online

# Optional: Database connection pool
PG_MAX=10
PG_MIN=2
PG_IDLE_TIMEOUT_MS=30000
```

### Step 3: Database Setup

```bash
# Push schema to database
npm run db:push

# Seed sample data (optional)
node scripts/seed-dev.js

# Verify connection
npm run db:check
```

### Step 4: Start Development

```bash
npm run dev
```

The app will start on `http://localhost:5000` with:
- Frontend: Vite dev server (hot reload)
- Backend: Express API on same port
- WebSocket: Strategy streaming via SSE

---

## ⚙️ Environment Configuration

### Database Connection

**Local PostgreSQL:**
```bash
DATABASE_URL=postgresql://postgres:password@localhost:5432/vecto_pilot
```

**Neon (External):**
```bash
DATABASE_URL=postgresql://user:password@ep-xxx-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require
```

**Replit PostgreSQL:**
- Use Replit Secrets: `DATABASE_URL` automatically provided
- Or view in Replit Database tab

### AI Model Configuration

**Current Default Models:**

| Role | Model | Provider | Purpose |
|------|-------|----------|---------|
| Strategist | `claude-opus-4-1-20250805` | Anthropic | Strategic overview |
| Briefer | `sonar-pro` | Perplexity | Research & context |
| Consolidator | `gpt-5.1` | OpenAI | Final tactical briefing |
| Holiday Checker | `llama-3.1-sonar-small-128k-online` | Perplexity | Fast holiday detection |
| Venue Intelligence | `gemini-2.0-flash-exp` | Google | Bar/restaurant discovery |
| Voice | `gpt-4-realtime-preview-20241217` | OpenAI | Voice chat (232-320ms) |

**To Change Models:**

1. Edit environment variables in `.env` or Replit Secrets
2. Set `STRATEGY_STRATEGIST`, `STRATEGY_BRIEFER`, etc.
3. Restart the application

Models are **model-agnostic** - any compatible model can be swapped:
- Strategist: Any Claude model (Opus, Sonnet)
- Briefer: Any web-search model (Perplexity Sonar)
- Consolidator: Any reasoning model (GPT-5, Claude)

### Connection Pool Settings

For **development** (single instance):
```bash
PG_MAX=10
PG_MIN=2
```

For **production/autoscale** (many instances):
```bash
PG_MAX=2
PG_MIN=0
PG_IDLE_TIMEOUT_MS=30000
```

**Math**: With N instances × M connections per instance = Total connections
- Development: 1 × 10 = 10 connections ✓
- Production (50 instances): 50 × 2 = 100 connections ✓

---

## 📊 Database Schema

### Users Table
Stores driver location (authoritative source).

```typescript
users: {
  id: UUID (primary key),
  device_id: string,
  device_user_agent: string,
  location_lat: float,
  location_lng: float,
  location_city: string,
  location_state: string,
  location_country: string,
  location_formatted_address: string,
  location_timezone: string,
  created_at: timestamp,
  updated_at: timestamp
}
```

### Snapshots Table
API-enriched contextual data linked to user location.

```typescript
snapshots: {
  id: UUID (primary key),
  user_id: UUID (FK → users),
  formatted_address: string,
  city: string,
  state: string,
  country: string,
  timezone: string,
  weather: JSONB,
  air_quality: JSONB,
  local_news: text,
  holiday: string,
  created_at: timestamp
}
```

### Rankings Table
Generated venue blocks and strategies.

```typescript
rankings: {
  id: UUID (primary key),
  snapshot_id: UUID (FK → snapshots),
  block_index: integer,
  block_type: string,
  block_data: JSONB,
  strategy_ready_at: timestamp,
  created_at: timestamp
}
```

### Strategies Table
Full strategy generation results.

```typescript
strategies: {
  id: UUID (primary key),
  snapshot_id: UUID (FK → snapshots),
  strategist_result: JSONB,
  briefer_result: JSONB,
  consolidator_result: JSONB,
  final_briefing: text,
  created_at: timestamp
}
```

---

## 🤖 AI Pipeline

### Strategy Generation Waterfall

**Execution Flow:**
```
Snapshot Created
    ↓
[Parallel Start]
    ├─ Strategist (Claude): Generate strategic overview
    ├─ Briefer (Perplexity): Research location context
    └─ Consolidator (GPT-5): Web search for latest info
[Parallel End]
    ↓
Results Streamed to Frontend (SSE)
```

### Each Role's Responsibility

**1. Strategist (Claude)**
- Analyzes: day part (morning/noon/evening), location, holiday
- Output: Strategic overview on where to position for optimal earnings
- Max tokens: 1024
- Temperature: 0.2 (deterministic)
- Example: "Day after Thanksgiving - expect mall traffic, stage at shopping centers"

**2. Briefer (Perplexity)**
- Researches: Real-time events, traffic conditions, popular areas
- Output: Comprehensive brief on current conditions
- Max tokens: 8192
- Includes web search grounding for live data
- Example: "3 concerts happening downtown, avoid I-35, north Dallas has surge"

**3. Consolidator (GPT-5.1)**
- Combines: Strategist + Briefer + web search
- Output: Final tactical briefing with actionable recommendations
- Max tokens: 4096
- Uses web search for latest venues/events
- Example: "Focus on Stonebriar Centre area, Eddie V's Prime has holiday pricing, last call at 2 AM"

**4. Holiday Checker (Perplexity)**
- Detects: If today is a holiday
- Output: Holiday name (e.g., "Day after Thanksgiving", "Black Friday")
- Used for: Context-aware strategy generation
- Run: Before strategy waterfall to inject holiday context

### Venue Intelligence (Gemini)

**Function**: `discoverNearbyVenues()`
- Uses: Gemini 2.0 Flash with web search grounding
- Input: lat, lng, city, state, 15-mile radius
- Output: 5-10 bars/restaurants sorted by expense level
- Features:
  - Expense level: $, $$, $$$, $$$$ (sorted descending)
  - Hours: Full operating hours for today
  - Last-call alerts: If closing within 1 hour
  - Crowd estimation: low/medium/high
  - Rideshare potential: low/medium/high
  - Phone enrichment: Google Places lookup for bars only

---

## 📡 API Documentation

### Location & Snapshot APIs

**GET /api/location/resolve**
- Purpose: Resolve GPS to city/state/timezone + weather + air quality
- Query params: `lat`, `lng`, `device_id`
- Returns: `{ city, state, timezone, weather, airQuality, userId }`

**POST /api/location/snapshot**
- Purpose: Create context snapshot for strategy generation
- Body: `{ lat, lng, deviceId }`
- Returns: `{ snapshotId, userId, formattedAddress, holiday }`
- Triggers: Strategy waterfall + venue intelligence

**GET /api/snapshots/:snapshotId**
- Purpose: Fetch specific snapshot with all context
- Returns: Complete snapshot data with strategies

### Venue & Blocks APIs

**POST /api/blocks-fast**
- Purpose: Generate venue recommendations and strategy blocks
- Body: `{ snapshotId }`
- Returns: SSE stream of blocks as they complete
- Includes: Smart blocks, venue cards, strategy sections

**GET /api/venues**
- Purpose: Get nearby venue recommendations
- Query params: `lat`, `lng`, `radius_miles` (default 15)
- Returns: Array of venue objects with phone numbers (bars)

### Voice APIs

**POST /api/voice-token**
- Purpose: Get ephemeral token for OpenAI Realtime API
- Body: `{ snapshotId }`
- Returns: `{ token, expiresIn }`
- Used by: Frontend to establish WebSocket with OpenAI

**WebSocket Connection**
- Endpoint: OpenAI Realtime API (wss://api.openai.com/v1/realtime)
- Token: From `/api/voice-token`
- Model: `gpt-4-realtime-preview-20241217`
- Latency: 232-320ms

### Health & Status APIs

**GET /health**
- Returns: `{ status: "healthy" }` (200 OK)

**GET /ready**
- Returns: `{ ready: true }` (200 OK when database connected)

**GET /healthz**
- Returns: Full system status JSON

---

## 🚀 Deployment

### Replit Deployment

1. **Create Project**
   - Fork/import this repository
   - Replit auto-detects Node.js project

2. **Configure Secrets**
   - Open "Secrets" (lock icon)
   - Add all API keys and DATABASE_URL
   - See [Environment Configuration](#environment-configuration)

3. **Click "Run"**
   - App starts on replit.dev domain automatically
   - Database: Use Replit PostgreSQL (created automatically)

4. **Monitor**
   - Logs appear in console
   - Check health: Visit `/.replit/healthz`

### Self-Hosted (Cloud Run, EC2, VPS)

**Build Docker Image** (optional):
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 5000
CMD ["node", "gateway-server.js"]
```

**Deploy Steps**:
```bash
# 1. Set environment variables
export DATABASE_URL=postgresql://...
export OPENAI_API_KEY=sk-...
export GEMINI_API_KEY=AIzaSy...
# ... other keys

# 2. Install and build
npm install
npm run build

# 3. Run application
PORT=5000 node gateway-server.js
```

**Environment File Method** (for container):
```bash
# Create .env file with all variables
# Or mount as Docker volume: -v /path/.env:/app/.env
docker run -p 5000:5000 --env-file .env vecto-pilot:latest
```

### Deployment Modes

**Development** (default):
```bash
npm run dev
# Starts: Frontend (Vite) + Backend (Express) on same port
```

**Production (webservice)**:
```bash
DEPLOY_MODE=webservice node gateway-server.js
# For autoscale deployments (Replit, Cloud Run)
# Uses smaller connection pools
```

**Production (background worker)**:
```bash
DEPLOY_MODE=worker node gateway-server.js
# For scheduled/reserved VM deployments
# Includes background job processing
```

---

## 🔍 Troubleshooting

### Database Connection Issues

**Error: "Cannot reach database"**
- Verify `DATABASE_URL` is set correctly
- Check network connectivity to database host
- Ensure SSL: Add `?sslmode=require` to PostgreSQL URLs
- Test locally: `psql "$DATABASE_URL" -c "SELECT 1"`

**Error: "Connection pool exhausted"**
- Reduce `PG_MAX` for autoscale deployments
- Set `PG_IDLE_TIMEOUT_MS=30000` for faster recycling
- Check: How many instances running? `instances × PG_MAX ≤ database_limit`

**Error: "Database terminated (57P01)"**
- Database admin shut down your connection
- Solution: Reconnection logic auto-triggers (exponential backoff)
- Check logs: Look for `db.reconnect` events
- If persistent: Contact database provider or increase pool limits

### API Key Issues

**Error: "401 Unauthorized" from OpenAI/Gemini/etc**
- Verify API key is correct in `.env` or Secrets
- Check key hasn't expired
- Ensure key has correct permissions/scopes
- Test: `curl -H "Authorization: Bearer $API_KEY" https://api.provider.com/v1/models`

**Error: "Rate limited by API"**
- Wait before retrying (exponential backoff implemented)
- Check API quota/usage dashboard
- Consider upgrading plan if consistently rate-limited

### Geolocation Issues

**Error: "Getting location..." persists**
- User hasn't granted location permission
- Browser console shows: "Geolocation permission denied"
- Solution: User clicks location icon → grants permission → try again
- Or: Enter latitude/longitude manually in dev tools

**Error: "Address resolution failed"**
- Coordinates are in ocean/remote location
- Google Geocoding API returns no address
- UI falls back to coordinates display
- Try: Use known city coordinates (e.g., Dallas: 32.7767, -96.7970)

### Strategy Generation Hangs

**Issue: Strategy doesn't complete after 60s**
- Check: Is Claude/GPT/Perplexity API responding?
- Check: Browser console for SSE connection errors
- Workaround: Refresh page, try again
- Debug: Check `npm run dev` terminal for error logs

**Issue: Venue intelligence timeout**
- Gemini web search is slow
- Timeout set to 30s
- If > 5 venues fail: UI shows empty venues section
- Check: Google API quota, network connectivity

---

## 📁 File Structure

```
vecto-pilot/
├── client/                    # React Frontend
│   ├── src/
│   │   ├── pages/            # Route pages (strategy, venues, coach)
│   │   ├── components/       # React components (SmartBlocks, etc)
│   │   ├── hooks/            # React hooks (useGeolocation, etc)
│   │   └── App.tsx           # Root component + routing
│   └── index.html            # Entry point
│
├── server/                    # Node.js Backend
│   ├── routes/               # API endpoints
│   │   ├── blocks-fast.js    # Venue + strategy blocks
│   │   ├── snapshot.js       # Snapshot creation
│   │   ├── location.js       # Geolocation + weather
│   │   └── voice-token.js    # OpenAI token generation
│   │
│   ├── lib/                  # Business logic
│   │   ├── providers/        # AI models (Claude, GPT, Perplexity)
│   │   ├── venue-intelligence.js    # Gemini venue discovery
│   │   ├── phone-enrichment.js      # Google Places phone lookup
│   │   ├── strategy-generator.js    # Waterfall orchestration
│   │   └── db-client.js      # Database connection + pool
│   │
│   ├── vite.ts               # Vite server integration
│   └── gateway-server.js     # Main entry point
│
├── shared/                    # Shared code
│   ├── schema.ts             # Drizzle ORM schema + Zod types
│   └── constants.ts          # Shared constants
│
├── scripts/                   # Utilities
│   ├── seed-dev.js           # Seed test data
│   └── migrate.js            # Database migration runner
│
├── drizzle/                   # ORM migrations
├── dist/                      # Built frontend (generated)
├── .env.example              # Environment template
├── package.json              # Dependencies
├── tsconfig.json             # TypeScript config
├── tailwind.config.ts        # TailwindCSS config
└── vite.config.ts            # Vite config
```

---

## 🔐 Security

### Authentication
- JWT tokens with RS256 asymmetric keys
- Session-based for frontend
- Token rotation on sensitive operations

### API Security
- Rate limiting: 100 requests/min per IP
- CORS: Configured for localhost + production domains
- Helmet.js: HTTP security headers (CSP, HSTS, etc)
- Path traversal protection: Input validation
- SQL injection prevention: Drizzle ORM parameterized queries
- CSRF protection: Tokens on state-changing requests

### Data Privacy
- No user tracking/analytics
- Location data: Not stored persistently (only in snapshots)
- Snapshots: Deleted after 7 days (optional)
- API keys: Environment variables only (never in code)
- Phone numbers: From public Google Places, not stored

---

## 📈 Performance Metrics

### Latency
- **Frontend load**: < 2s (Vite dev, < 500ms production)
- **GPS resolution**: ~1-2s
- **Weather/AQI fetch**: Parallel, ~2-3s
- **Strategy generation**: Parallel waterfall, ~30-40s
- **Venue intelligence**: ~5-10s (Gemini web search)
- **Voice latency**: 232-320ms (OpenAI Realtime)

### Database
- **Snapshot insert**: ~50ms
- **Strategy storage**: ~100ms
- **Query response**: < 20ms for indexed queries
- **Connection pool**: 2-10 connections based on deployment

### Scalability
- **Development**: Single instance, 10 connections
- **Production**: Auto-scales to 50+ instances, 2 connections each = 100 total
- **Venue discovery**: Rate-limited (Gemini quota)
- **API calls**: Cached where possible, exponential backoff on errors

---

## 🤝 Contributing

1. Fork repository
2. Create feature branch: `git checkout -b feature/my-feature`
3. Make changes (see [Code Conventions](#code-conventions))
4. Run tests: `npm test`
5. Commit: `git commit -am "Add feature"`
6. Push: `git push origin feature/my-feature`
7. Submit pull request

### Code Conventions

- **TypeScript**: Strict mode enabled
- **React**: Functional components + hooks
- **Database**: Drizzle schema-first, auto-migrations
- **API**: RESTful, versioned endpoints
- **Testing**: Jest (unit) + Playwright (E2E)
- **Logging**: Structured (JSON for production)

---

## 📞 Support & Feedback

- **Issues**: Create GitHub issue with reproduction steps
- **Questions**: Start discussion forum topic
- **Feature requests**: Open GitHub discussion
- **Security**: Email security@vecto.ai (do not create public issue)

---

## 📜 License

MIT License - See LICENSE file

---

## 🔗 Links

- **GitHub**: [github.com/your-org/vecto-pilot](https://github.com/your-org/vecto-pilot)
- **Docs**: [docs.vecto.ai](https://docs.vecto.ai)
- **Issues**: [github.com/your-org/vecto-pilot/issues](https://github.com/your-org/vecto-pilot/issues)

---

**Last Updated**: November 29, 2025  
**Status**: Production Ready ✅