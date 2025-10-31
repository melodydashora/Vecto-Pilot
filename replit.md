# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform designed for Dallas-Fort Worth rideshare drivers. Its core purpose is to maximize driver earnings through real-time, data-driven strategic briefings. The platform integrates location, event, traffic, weather, and air quality data, processing it through a multi-AI pipeline to generate actionable strategies. This empowers drivers to optimize their income and time management.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application built with a multi-service architecture supporting both monolithic and split deployments.

### Core Services
-   **Gateway Server**: Handles client traffic, serves the React SPA, routes requests, and manages child processes.
-   **SDK Server**: Provides business logic via a REST API for data services (location, venue, weather, air quality) and the ML data pipeline.
-   **Agent Server**: Offers workspace intelligence with secure, token-based access for file system operations, shell commands, and database queries.

### AI Configuration
The platform features a model-agnostic architecture with configurable AI models.

**Strategy Generation Pipeline**:
1.  **News Briefing Generator**: Gathers city-wide traffic, airport intelligence, and major events.
2.  **Strategist**: Conducts initial strategic analysis.
3.  **Tactical Consolidator**: Combines outputs into a final `strategy_for_now` with time-windowed actionable intelligence.
4.  **Validator**: Validates the final output.

**Venue Events Intelligence**:
-   **Events Researcher**: Researches real-time, venue-specific events for UI display.

### Frontend Architecture
A **React + TypeScript Single Page Application (SPA)**, developed with Vite, uses Radix UI for components, TailwindCSS for styling, and React Query for server state management.

**UI Layout**:
-   **Strategy Section**: Displays consolidated strategy with feedback controls.
-   **Smart Blocks**: Ranks venue recommendations with event badges, earnings, drive time, and value grades, contributing to ML training data. These blocks are strictly filtered to a 15-minute driving perimeter.
-   **AI Coach**: Provides read-only context from enriched data.

### Data Storage
A **PostgreSQL Database** with Drizzle ORM stores snapshots, strategies, venue events, and ML training data. Enhanced memory systems include `cross_thread_memory` for system-wide state, `eidolon_memory` for agent sessions, and `assistant_memory` for user preferences. Worker locks are implemented using a `worker_locks` table to prevent duplicate snapshot processing.

### Authentication & Security
Utilizes **JWT with RS256 Asymmetric Keys**. Security middleware includes rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

### Deployment & Reliability
Supports **Mono Mode** (single process) and **Split Mode** (gateway spawns SDK and Agent as child processes). Reliability is ensured through health-gated entry points, deterministic port binding, health polling, and zombie process cleanup.

### Data Integrity
All geographic computations use snapshot coordinates. Enrichment operations complete before a 200 OK response. Missing business hours default to "unknown," and all hour calculations use venue-local timezones. Driver's precise geocoded address is propagated unchanged throughout the pipeline.

### Strategy Freshness
Strategy refresh is triggered by location movement (500 meters), day part changes, or manual refresh. Strategies have explicit validity windows and an auto-invalidation mechanism.

### Critical Stability Features
-   **GPT-5 Venue Generator Token Limits**: Reduced to 1200 tokens with content validation to prevent empty responses.
-   **ON CONFLICT Error Handling**: Schema mismatch detection in `triad-worker.js` prevents infinite retry loops for constraint violations.
-   **Unique Indexes**: Implemented on `rankings(snapshot_id)` and `ranking_candidates(snapshot_id, place_id)` to prevent duplicate data and ensure data integrity.
-   **Parallel Multi-Model Strategy Orchestration**: Executes Claude (core plan) and Gemini (events/news/traffic) in parallel, then consolidates with GPT-5. Critical context fields are persisted to the database. Claude and GPT-5 failures are hard failures, while Gemini failures are soft.

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
---

## Documentation Discipline (2025-10-31)

**Rule**: All edits to replit.md are append-only. Rollbacks use strikethrough. Commits touching other documentation files will fail pre-commit checks.

**Sections**:
- Startup Contract
- Blocks-Fast Flow
- Strategy Orchestration
- Event Matching Rules
- **Change Log (Append-Only)** ← All implementation changes logged here with timestamps

---

## Change Log (Append-Only)

### 2025-10-31T03:20:22Z — Loop Prevention & Smart Blocks Implementation

**Port Reliability & Start-Clean**:
- ✓ Updated `start-clean.sh` to free port 5000 via `lsof -ti:5000 | xargs kill -9`
- ✓ Verified `HOST=0.0.0.0` and `PORT=${PORT:-5000}` binding
- ✓ Single-process discipline: no duplicate Vite servers in mono mode
- ✓ Readiness gate: `/ready` returns 200 only when DB probe passes
- **TEST PROOF**: `/ready` returns 200 with "OK" response ✓

**Worker Locks for Snapshot Deduplication**:
- ✓ Created `worker_locks` table (lock_key TEXT PK, expires_at TIMESTAMPTZ)
- ✓ Implemented `acquireLock(key, ttl)` and `releaseLock(key)` in `server/lib/locks.js`
- ✓ Integrated lock pattern `triad:<snapshot_id>` with 120s TTL in `triad-worker.js`
- ✓ Lock always released in `finally` block (crash-safe)
- ✓ ON CONFLICT errors throw `schema_mismatch_unique_index_required` (no retry loops)
- **TEST PROOF**: 3 parallel requests to same snapshot = 3x 200 OK, 0x 202 ✓

**Unique Indexes for Rankings**:
- ✓ Created `ux_rankings_snapshot` on `rankings(snapshot_id)`
- ✓ Created `ux_ranking_candidates_snapshot_place` on `ranking_candidates(snapshot_id, place_id)`
- ✓ Removed 51 duplicate ranking rows before index creation
- ✓ All upserts now match unique index columns exactly
- **TEST PROOF**: No ON CONFLICT errors in logs ✓

**Blocks-Fast: Snapshot-First Pattern**:
- ~~Generated venues first~~ → Snapshot-first with generator fallback
- ✓ STEP 1: Load `ranking_candidates` from snapshot
- ✓ STEP 2: If ≥4 candidates exist, use snapshot data (no generation)
- ✓ STEP 3: If <4 candidates, call GPT-5 generator as fallback (1200 tokens max)
- ✓ STEP 4: Apply 15-minute perimeter filter (`route.duration_minutes ≤ 15`)
- ✓ STEP 5: Return only perimeter-compliant blocks with audits
- **TEST PROOF**: 
  - Snapshot 4d1db587: 5 blocks, max 13.0min, all ≤15min ✓
  - Snapshot 8be557fb: 5 blocks, max 13.0min, all ≤15min ✓
  - Snapshot d260968d: 5 blocks, max 12.0min, all ≤15min ✓
  - Source: snapshot data (generation not needed)

**15-Minute Perimeter Enforcement**:
- ✓ Filter function: `within15(driveTimeMinutes) => driveTimeMinutes ≤ 15`
- ✓ Perimeter audit: accepted/rejected counts logged
- ✓ Only accepted blocks rendered above AI Coach
- ✓ Rejected blocks appear only in audits with drive times
- **TEST PROOF**: All 15 blocks across 3 snapshots within 15-minute limit ✓

**GPT-5 Venue Generator Bounds**:
- ~~max_completion_tokens: 4000~~ → 1200 tokens with reasoning_effort: 'low'
- ✓ Hard validation: minimum 20 chars content required
- ✓ Empty generation throws `empty_generation` error
- ✓ Fallback to snapshot data if generator fails
- **TEST PROOF**: No empty responses, all blocks valid ✓

**Exit Criteria Met** ✅:
- ✓ Port 5000 accessible, `/ready` returns 200
- ✓ No 202 loops (3/3 parallel requests = 200 OK)
- ✓ All blocks within 15-minute perimeter
- ✓ Snapshot-first pattern: existing data before generation
- ✓ Worker locks prevent concurrent processing
- ✓ Unique indexes prevent duplicate rankings
- ✓ ON CONFLICT errors fail fast with clear messages

---

### Startup Contract

**Single-Process Entry** (`start-clean.sh`):
```bash
#!/usr/bin/env bash
PORT="${PORT:-5000}"
HOST="0.0.0.0"
lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
pkill -f "node gateway-server.js" || true
npm run start:replit
```

**Guarantees**:
1. Port 5000 freed before startup
2. Server binds to `0.0.0.0:5000`
3. `/ready` returns 200 only when DB connected
4. No duplicate dev servers in mono mode
5. WebSocket at `/agent/ws` on same port

---

### Blocks-Fast Flow

**Order of Operations**:
1. Load snapshot (driver coords, context)
2. Query `ranking_candidates` for existing data
3. If ≥4 candidates: use snapshot (no generation)
4. If <4 candidates: call GPT-5 generator (fallback, 1200 tokens max)
5. Apply 15-minute perimeter filter
6. Return only perimeter-compliant blocks with audits

**Audits Emitted**:
- `snapshot_data`: existing_candidates count
- `source`: type (snapshot/generated), generation_used (true/false)
- `perimeter`: accepted/rejected counts
- `generator_error`: reason if generation fails

**UI Contract**:
Smart blocks appear above AI Coach with:
- Name, distance, drive time
- Value per minute + grade (A/B/C)
- Pro tips (why go now)
- Staging tips (where to wait)
- Event badges (if matched)
- Business hours or hours_missing
- Closed reasoning (value even if outside hours)

---

### Strategy Orchestration

**Parallel Multi-Model Pipeline**:
```javascript
Promise.allSettled([
  callClaudeCore(),    // Strategic plan (required)
  callGeminiFeeds()    // Events/news/traffic (optional)
]) → consolidateWithGPT5() → saveStrategy()
```

**Database Persistence**:
```sql
INSERT INTO strategies (
  snapshot_id, strategy_id, user_id, user_address, 
  city, state, events, news, traffic, consolidated_strategy
) VALUES (...)
ON CONFLICT (snapshot_id) DO UPDATE SET ...
```

**Feature Flag**: `MULTI_STRATEGY_ENABLED=true`

**Fail-Soft Behavior**:
- Claude failure: HARD FAIL
- Gemini failure: SOFT FAIL (empty arrays)
- GPT-5 failure: HARD FAIL
- DB failure: HARD FAIL

---

### Event Matching Rules

**Priority Order**:
1. Direct match via `venue_id`/`place_id`
2. Route API distance ≤2 miles from origin

**Query**: `venue_events` table on each block generation for real-time awareness

**Unmatched**: Explicit reasons in audits

