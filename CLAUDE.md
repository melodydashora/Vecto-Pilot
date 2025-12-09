# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Vecto Pilot is an AI-powered rideshare intelligence platform providing drivers with real-time strategic briefings. It uses a multi-model AI pipeline (Claude, Gemini, GPT-5.1) to generate venue recommendations and tactical guidance.

## Commands

```bash
# Development
npm run dev              # Start development server (port 5000)
npm run dev:client       # Start Vite dev server only

# Build & Deploy
npm run build            # Build production client
npm run build:client     # Build client only

# Database
npm run db:push          # Generate and push Drizzle schema to PostgreSQL

# Quality Checks
npm run lint             # ESLint (client/src)
npm run typecheck        # TypeScript type checking
npm run test             # Run unit + e2e tests
npm run test:unit        # Jest unit tests only
npm run test:e2e         # Playwright e2e tests only

# Pre-PR checklist
npm run lint && npm run typecheck && npm run build
```

## Architecture

### Entry Point & Server
- `gateway-server.js` - Main Express server, mounts all routes, spawns strategy-generator worker
- Server listens on port 5000, serves React SPA from `client/dist`

### AI Pipeline (Strategy Waterfall)
The strategy generation uses a parallel-then-sequential waterfall (~35-50 seconds):

```
Phase 1 (Parallel):
  - Strategist (Claude Sonnet 4.5) → minstrategy
  - Briefer (Gemini 3.0 Pro + Google Search) → events, traffic, news, weather
  - Holiday Checker (Gemini 3.0 Pro + Google Search) → holiday detection

Phase 2: Consolidator (GPT-5.1) → consolidated_strategy
Phase 3: Immediate Strategy (GPT-5.1) → strategy_for_now
Phase 4: Venue Planner (GPT-5.1) → Smart Blocks with enrichment
Phase 5: Validator (Gemini 2.5 Pro) → event verification
```

### Model Adapter Pattern
**Always use the adapter** - never call AI APIs directly:
```javascript
import { callModel } from './adapters/index.js';
const result = await callModel('strategist', { system, user });
```
The adapter at `server/lib/adapters/index.js` handles model selection, parameter normalization, and provider-specific quirks.

### Key Directories
- `client/src/` - React frontend (TypeScript, TailwindCSS, Radix UI)
- `server/routes/` - Express API endpoints
- `server/lib/providers/` - AI provider implementations (minstrategy, briefing, consolidator)
- `server/lib/adapters/` - Model API adapters
- `shared/schema.js` - Drizzle ORM schema (PostgreSQL)

### Data Flow (Snapshot-Centric)
All data links to `snapshot_id` for ML training correlation:
- `snapshots` - Point-in-time context (location, time, weather)
- `strategies` - AI outputs (minstrategy, consolidated_strategy, strategy_for_now)
- `briefings` - Real-time intelligence (events, traffic, news)
- `rankings` → `ranking_candidates` - Venue recommendations

## Critical Rules

### Model Parameters (Avoid 400 Errors)
**GPT-5.1**: NO temperature, NO top_p, use `reasoning_effort` (FLAT) and `max_completion_tokens`
```javascript
// CORRECT - flat reasoning_effort string
{ model: "gpt-5.1", reasoning_effort: "medium", max_completion_tokens: 32000 }
// WRONG - nested format causes 400 "Unknown parameter: reasoning"
{ model: "gpt-5.1", reasoning: { effort: "medium" } }
// WRONG - temperature causes 400
{ temperature: 0.7, max_tokens: 1000 }
```

**Gemini 3 Pro**: Use nested `thinkingConfig`, NOT flat `thinking_budget`
```javascript
// CORRECT
{ generationConfig: { thinkingConfig: { thinkingLevel: "HIGH" } } }
// WRONG
{ thinking_budget: 8000 }
```

### Code Conventions
- Unused variables: prefix with `_` (e.g., `_unused`)
- TypeScript: strict mode enabled in client
- Database: Drizzle schema-first, always link data to `snapshot_id`
- Sorting: Use `created_at DESC` (newest first) for debugging queries

### Before Creating New Files
1. Search for existing implementations: `grep -r "functionName" server/`
2. Check LESSONS_LEARNED.md for historical issues
3. This repo has accumulated duplicates - verify code doesn't already exist

### Location Context
- `client/src/contexts/location-context-clean.tsx` - Main location provider (do not delete)
- `coords_cache` table - Caches geocode lookups (4-decimal key ~11m precision)

### Coordinates and Business Hours
Coordinates and business hours come from Google APIs or DB, never from AI models:
- **Geocoding API**: Coordinates ↔ address conversion
- **Places Details API**: Business hours, open/closed status only
- **Routes API**: Distance and drive time calculations
- **DB-first**: Check `coords_cache` and `places_cache` before calling external APIs

## File Order and Mapping Rules

### GlobalHeader.tsx Critical Fixes (Do Not Revert)
From `client/src/components/GlobalHeader.tsx`:

**Issue #3**: Use `useContext(LocationContext)` directly, NOT a custom `useLocation` hook
- Import from: `@/contexts/location-context-clean`
- Get `refreshGPS` from context: `loc?.refreshGPS ?? loc?.location?.refreshGPS`

**Issue #5**: Device ID and Database Priority
- Get device_id from localStorage: `localStorage.getItem("vecto_device_id")`
- Query `/api/users/me?device_id=...` for fresh database location
- Priority order for location: database → override city → context city/state

**Issue #8**: Location String Resolution Priority
```
1. overrideCoords?.city (manual city search)
2. dbUserLocation?.city (database - freshest source)
3. loc?.city + loc?.state (context)
4. loc?.currentLocationString (fallback)
```

**Production Issue #1 (Dec 1, 2025)**: Polling Rate
- Problem: 2s polling caused 1643 req/6h spike (30 req/min × 50 users)
- Solution: `refetchInterval: false` - fetch on init only, updates via context events
- Stale time: 60000ms (1 minute)

### Location Context Rules
From `client/src/contexts/location-context-clean.tsx`:

**Snapshot Creation**: LocationContext handles ALL data fetching in parallel:
- Location resolve (`/api/location/resolve`)
- Weather (`/api/location/weather`)
- Air quality (`/api/location/airquality`)
- Snapshot save (`/api/location/snapshot`)

**No Fallbacks**: This is a GPS-first global app
- If browser geolocation fails, display "Location unavailable - enable GPS"
- Do NOT use IP-based fallback or default locations

**Enrichment Deduplication**:
- Uses `lastEnrichmentCoordsRef` to prevent duplicate API calls for same coordinates
- Key format: `${lat.toFixed(6)},${lng.toFixed(6)}`

**Generation Counter**:
- Uses `generationCounterRef` to handle race conditions
- If a newer request starts, older responses are ignored

### Weather API Call Location
**Single Source**: Weather is fetched ONLY in `location-context-clean.tsx` during enrichment
- GlobalHeader reads weather from state, does NOT fetch it separately
- Prevents duplicate API calls and billing

### Endpoint Mapping
```
GlobalHeader.tsx calls:
  - GET /api/users/me?device_id=...     → Fresh location from DB
  - (weather/AQ from context state, not direct fetch)

location-context-clean.tsx calls:
  - GET /api/location/resolve           → Geocode + city/state/timezone
  - GET /api/location/weather           → Weather data
  - GET /api/location/airquality        → Air quality data
  - POST /api/location/snapshot         → Save snapshot to DB
  - POST /api/auth/token                → JWT token for user
```

## Environment Variables

Required:
- `DATABASE_URL` - PostgreSQL connection
- `OPENAI_API_KEY` - GPT-5.1 + Realtime API (voice)
- `GEMINI_API_KEY` - Gemini 3.0 Pro (briefing, holidays, validation)
- `ANTHROPIC_API_KEY` - Claude Sonnet 4.5 (strategist)
- `GOOGLE_MAPS_API_KEY` - Places, Routes, Geocoding, Weather, Air Quality

## Removed Systems (December 2025)
- **Perplexity**: All Perplexity integration removed. Briefing system migrated to Gemini 3.0 Pro with Google Search for real-time research (events, traffic, news, holidays).

## Related Documentation
- `LESSONS_LEARNED.md` - Critical pitfalls and historical issues (read before making changes)
- `ARCHITECTURE.md` - Detailed system architecture and data flows
- `README.md` - Full project documentation
