# STRATEGY.md — Strategy Generation Architecture

> **Canonical reference** for the NOW (1-hour tactical) and 12-Hour (daily consolidated) strategy system.
> Last updated: 2026-04-14

## Supersedes
- `docs/architecture/Strategy.md` — High-level overview, now expanded here with full code paths
- `docs/architecture/strategy-framework.md` — Strategy events/status, now merged into this doc

---

## Table of Contents

1. [NOW vs 12HR Strategy Distinction](#1-now-vs-12hr-strategy-distinction)
2. [Strategy Generation Pipeline](#2-strategy-generation-pipeline)
3. [LLM Prompts and Output Format](#3-llm-prompts-and-output-format)
4. [Strategy Database Schema](#4-strategy-database-schema)
5. [Strategy Refresh Lifecycle](#5-strategy-refresh-lifecycle)
6. [How Strategy Feeds Into Coach and Briefing](#6-how-strategy-feeds-into-coach-and-briefing)
7. [Caching Behavior](#7-caching-behavior)
8. [Pipeline Phases and Progress](#8-pipeline-phases-and-progress)
9. [Client-Side State Management](#9-client-side-state-management)
10. [Current State](#10-current-state)
11. [Known Gaps](#11-known-gaps)
12. [TODO — Hardening Work](#12-todo--hardening-work)

---

## 1. NOW vs 12HR Strategy Distinction

| Property | NOW (Immediate/Tactical) | 12HR (Daily/Consolidated) |
|----------|--------------------------|---------------------------|
| DB column | `strategies.strategy_for_now` | `strategies.consolidated_strategy` |
| Trigger | Auto — part of blocks-fast waterfall | On-demand — user clicks "Daily Strategy" |
| Model | `STRATEGY_TACTICAL` → Claude Opus 4.6 | `STRATEGY_DAILY` → Claude Opus 4.6 |
| Time horizon | Next 1 hour | Next 8–12 hours |
| Input | Snapshot + briefing (traffic, events, weather, weather_forecast, news, closures, airport) + driver preferences + earnings context | Snapshot + briefing (same) + driver preferences + earnings context |
| Output format | GO / AVOID / WHEN / WHY / IF NO PING / INTEL | 4–6 paragraphs covering time blocks |
| Max tokens | 16,000 | 16,000 |
| Temperature | 0.5 | 0.5 |
| Typical latency | 5–8 seconds | 8–15 seconds |
| Route | Part of `POST /api/blocks-fast` | `POST /api/strategy/daily/:snapshotId` |

**Key design point:** The NOW strategy is always auto-generated as part of the main pipeline. The 12HR strategy is optional and user-initiated.

---

## 2. Strategy Generation Pipeline

### Entry Point: POST /api/blocks-fast

**File:** `server/api/strategy/blocks-fast.js` (lines 505–800+)

```
POST /api/blocks-fast { snapshotId }
  │
  ├─ Acquire PostgreSQL advisory lock (prevents duplicate generation)
  │
  ├─ Phase: analyzing (10-15s)
  │  └─ runBriefing(snapshotId)
  │     └─ generateAndStoreBriefing() — 7 parallel data sources
  │     └─ pg_notify('briefing_ready')
  │
  ├─ Briefing Readiness Gate (polls DB up to 90s)
  │  └─ Validates: traffic, events, news, weather, airport, schools all populated
  │  └─ DATA_CORRECTNESS > SPEED principle
  │
  ├─ Phase: immediate (5-8s)
  │  └─ runImmediateStrategy(snapshotId, { snapshot, briefingRow })
  │     └─ generateImmediateStrategy({ snapshot, briefing })
  │     └─ callModel('STRATEGY_TACTICAL', { system, user: prompt })
  │     └─ Write to strategies.strategy_for_now
  │     └─ DB trigger fires → pg_notify('strategy_ready')
  │
  ├─ Phase: venues (6-10s)
  │  └─ generateEnhancedSmartBlocks()
  │     └─ VENUE_SCORER generates 4-6 venue recommendations
  │
  ├─ Phase: routing (2-5s) → Google Routes API
  ├─ Phase: places (2-5s) → Google Places API
  ├─ Phase: verifying (5-8s) → Event verification
  └─ Phase: complete
```

**Total typical duration:** 35–90 seconds

### Daily Strategy Entry Point

**File:** `server/lib/ai/providers/consolidator.js` (lines 764–980)
**Route:** `POST /api/strategy/daily/:snapshotId`

```
POST /api/strategy/daily/:snapshotId
  │
  ├─ Check prerequisites: strategy row exists, briefing exists
  ├─ Check if consolidated_strategy already cached → return cached
  │
  ├─ Build 12HR prompt:
  │  ├─ Snapshot context (address, timezone, time, holiday)
  │  ├─ Briefing data (traffic, events, news, weather, closures, airport)
  │  ├─ Venue hours from venue_catalog (batch lookup)
  │  └─ Task: "Create DAILY STRATEGY covering 8-12 hours"
  │
  ├─ callModel('STRATEGY_DAILY', { system, user: prompt })
  │  └─ Claude Opus 4.6 | maxTokens: 16,000 | temp: 0.5
  │  └─ Retry: 2 attempts with 1s/2s backoff for 503/429
  │
  └─ Write to strategies.consolidated_strategy
```

### Briefing → Strategy Dependency

**Critical:** Briefing MUST complete before strategy generation. The briefing provides the real-time data (traffic conditions, events, weather, news) that the strategy LLM needs to make informed recommendations.

The briefing readiness gate (lines 707–743) polls the DB for up to 90 seconds to ensure all fields are populated before proceeding. If briefing is incomplete after 90 seconds, the pipeline proceeds with a warning — never blocks indefinitely.

---

## 3. LLM Prompts and Output Format

### NOW Strategy Prompt

**File:** `server/lib/ai/providers/consolidator.js` (lines 148–240)
**Function:** `generateImmediateStrategy()`

**Input context (enriched 2026-04-11):**
- Driver's exact address, coordinates, timezone
- Briefing: traffic (structured incidents/closures/zones), events (NEAR/FAR bucketed with haversine distances), weather + 6-hour forecast timeline, news, school closures, airport
- Driver preferences: vehicle class, service prefs, fuel economy, max deadhead miles, home base
- Earnings context: daily goal, shift hours target, computed $/hr requirement
- Time-of-day intelligence patterns (morning/midday/afternoon/evening/night)

**Output format:**
```
**GO:** Position near [specific venue/area]...
**AVOID:** [Specific roads/areas with reasons]...
**WHEN:** [Timing window, e.g., "Next 45 minutes"]...
**WHY:** [Specific condition driving the recommendation]...
**IF NO PING:** [Backup plan if no rides in 15 minutes]...
**INTEL:** [Additional context — events ending, weather shift, etc.]...
```

### 12HR Strategy Prompt

**File:** `server/lib/ai/providers/consolidator.js` (lines 850–936)

**Additional input:** Venue hours from `venue_catalog` (batch looked up via `batchLookupVenueHours()`)

**Output format:** 4–6 paragraphs covering:
- Today's overview (weather, events, holiday impact)
- Time-block strategy (morning → afternoon → evening → night)
- Events impact with END times (critical for post-event surge)
- Traffic & hazards
- Peak earning windows
- Airport & late-night strategy

### Data Optimization for Prompts

Before injection into LLM prompts, raw data is compressed:

| Function | Purpose | File Line |
|----------|---------|-----------|
| `optimizeWeatherForLLM()` | Full weather → 1-2 sentence `driverImpact` | consolidator.js:461 |
| `optimizeNewsForLLM()` | 8 items → top 5, HIGH=summary, LOW=headline | consolidator.js:607 |
| `optimizeAirportForLLM()` | Full JSON → `travelImpact` string | consolidator.js:642 |
| `optimizeEventsForLLM()` | Standardized: 12h times, coords, distance, open status | consolidator.js:476 |
| `filterEventsToTimeWindow()` | Events within now-1h to +6h | consolidator.js:394 |
| `filterStrategyWorthyEvents()` | Removes generic bar events (happy hours) | consolidator.js:525 |
| `filterDeactivatedNews()` | Removes user-dismissed news (MD5 hash match) | consolidator.js:103 |

---

## 4. Strategy Database Schema

**File:** `shared/schema.js` (lines 75–103)

### `strategies` Table

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | Row identifier |
| `snapshot_id` | UUID FK (unique, cascade delete) | 1:1 with snapshots |
| `user_id` | UUID | Owner |
| `status` | text | `pending` → `running` → `ok` / `pending_blocks` → `ok` / `failed` |
| `phase` | text | Pipeline phase (see Section 8) |
| `phase_started_at` | timestamp | When current phase began (for progress bar) |
| `error_message` | text | Failure reason |
| `strategy_for_now` | text | **NOW strategy** — 1-hour tactical |
| `consolidated_strategy` | text | **12HR strategy** — daily plan (nullable, on-demand) |
| `created_at` | timestamp | Row creation |
| `updated_at` | timestamp | Last update |

**Unique constraint:** One strategy per snapshot (`snapshot_id` is unique).

### DB Trigger: strategy_ready

**File:** `migrations/20260110_fix_strategy_now_notify.sql`

A PostgreSQL trigger fires `pg_notify('strategy_ready', ...)` when `strategy_for_now` or `consolidated_strategy` columns are updated. This drives the SSE notification to clients.

---

## 5. Strategy Refresh Lifecycle

| Trigger | What Happens | Endpoint |
|---------|-------------|----------|
| New snapshot (login/GPS) | Full waterfall: briefing → NOW strategy → venues | `POST /api/blocks-fast` |
| Manual GPS refresh | Clear all → release snapshot → fresh waterfall | `POST /api/blocks-fast` |
| Resume from app switch | Restore from localStorage if snapshot matches; skip waterfall | N/A (client-side) |
| User clicks "Retry" | New snapshot created → full waterfall | `POST /api/strategy/:id/retry` |
| User clicks "Daily Strategy" | Generate 12HR from existing briefing (no new snapshot) | `POST /api/strategy/daily/:snapshotId` |
| Stale strategy detected | Reset status → re-run waterfall | Automatic in blocks-fast |

### Staleness Detection

**File:** `blocks-fast.js` (lines 578–599)

```javascript
const STALENESS_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
```

If an existing strategy has `status === 'pending_blocks'` or is stuck in-progress AND is older than 30 minutes, the system resets it to `pending` and re-runs the pipeline.

---

## 6. How Strategy Feeds Into Coach and Briefing

### Strategy → AI Coach

**File:** `server/api/chat/chat-context.js` (92 lines)

The Coach receives strategy via a read-only context endpoint:
```
GET /api/chat/context → { strategy_for_now, consolidated_strategy, candidates[] }
```

This is injected into the Coach's system prompt alongside snapshot, briefing, venues, and notes. The Coach uses `strategy_for_now` to understand the driver's current tactical situation.

### Strategy → SmartBlocks (Venues)

The `strategy_for_now` text is passed to the VENUE_SCORER (`generateTacticalPlan()`) as input context. The venue scorer uses the strategy to align its recommendations with the tactical plan.

### Briefing → Strategy (Dependency)

Briefing data is a **required input** to strategy generation. The flow is strictly: Briefing first → Strategy second. Strategy without briefing produces low-quality advice.

---

## 7. Caching Behavior

### React Query Cache

**File:** `co-pilot-context.tsx` (lines 456–478)

```javascript
// Strategy polling query
{
  queryKey: ['blocks/strategy', lastSnapshotId],
  refetchInterval: (query) => {
    const status = query.state.data?.status;
    if (status === 'ok' || status === 'error') return false;  // Stop when done
    return 3000;  // Poll every 3s while pending
  },
  staleTime: 5 * 60 * 1000,   // 5 minutes
  gcTime: 10 * 60 * 1000,     // 10 minutes
}
```

### localStorage Persistence

| Key | Content | Cleared On |
|-----|---------|------------|
| `vecto_persistent_strategy` | Latest `consolidated_strategy` text | Logout, manual refresh, snapshot change |
| `vecto_strategy_snapshot_id` | Snapshot ID the strategy belongs to | Logout, manual refresh, snapshot change |

On resume: CoPilotContext restores strategy from localStorage only if `vecto_strategy_snapshot_id` matches the current `lastSnapshotId`. Mismatched strategies are discarded.

### SSE-Driven Cache Refresh

When `strategy_ready` SSE event fires → `queryClient.refetchQueries()` (background, no UI flash). Same for `blocks_ready` and `phase_change` events.

---

## 8. Pipeline Phases and Progress

### Phase Sequence

| Phase | Duration | What Happens |
|-------|----------|--------------|
| `starting` | Instant | Initialize, validate inputs |
| `resolving` | Instant | Validate snapshot location |
| `analyzing` | 10–15s | Run briefing (Gemini + Google Search) |
| `immediate` | 5–8s | Generate NOW strategy (Claude Opus) |
| `venues` | 6–10s | VENUE_SCORER generates SmartBlocks (GPT-5.4) |
| `routing` | 2–5s | Google Routes API batch (drive times) |
| `places` | 2–5s | Google Places API (business hours) |
| `verifying` | 5–8s | Event verification (Gemini) |
| `complete` | Instant | Mark done |

### Phase Updates

**Function:** `updatePhase(snapshotId, phase)` — `server/lib/strategy/strategy-utils.js`

Updates `strategies.phase` and `phase_started_at`, then emits via EventEmitter to SSE clients at `/events/phase`.

### Client Progress Calculation

**Hook:** `client/src/hooks/useEnrichmentProgress.ts`

Progress is calculated dynamically: `(sum of completed phase durations + fraction of current phase) / total expected duration`. Capped at 99% until `phase === 'complete'` AND blocks have arrived.

---

## 9. Client-Side State Management

**File:** `client/src/contexts/co-pilot-context.tsx`

### State Properties

```typescript
strategyData: StrategyData | null;      // Current query result (from React Query)
persistentStrategy: string | null;      // Stored in localStorage (survives reload)
immediateStrategy: string | null;       // From strategyData.strategy.strategyForNow
isStrategyFetching: boolean;            // React Query isFetching flag
```

### Strategy Update Flow

1. Snapshot created → `vecto-snapshot-saved` event
2. CoPilotContext triggers `POST /api/blocks-fast`
3. React Query polls `GET /api/blocks/strategy/:snapshotId` every 3s
4. When `status === 'ok'` → polling stops, data cached
5. `useEffect` extracts `strategyForNow` and `consolidatedStrategy` from response
6. `persistentStrategy` saved to localStorage for resume

### Cleanup on Logout/Refresh

- Auth drop: `setLastSnapshotId(null)`, `setPersistentStrategy(null)`, `setImmediateStrategy(null)`
- Manual refresh: Same cleanup + `localStorage.removeItem` + `waterfallTriggeredRef.clear()`

---

## 10. Current State

| Area | Status |
|------|--------|
| NOW strategy generation (Claude Opus) | Working — auto-generated in waterfall |
| 12HR strategy generation (Claude Opus) | Working — on-demand via button |
| Briefing → Strategy dependency | Working — 90s readiness gate |
| Strategy polling (3s) | Working — stops on ok/error |
| SSE strategy_ready notification | Working — pg_notify trigger |
| localStorage persistence | Working — survives reload, validated on resume |
| Staleness detection (30 min) | Working — auto-reset stuck strategies |
| Advisory lock dedup | Working — prevents parallel generation |

---

## 11. Known Gaps

1. **No strategy versioning** — When a strategy is regenerated for the same snapshot, the old text is overwritten. No history of previous recommendations.

2. **12HR strategy requires explicit user action** — The daily strategy is never auto-generated. Users who don't know about the button miss it entirely.

3. **No strategy quality scoring** — No automated evaluation of strategy quality. Only user feedback (thumbs up/down) exists.

4. **Briefing readiness gate is time-based, not content-based** — Waits up to 90 seconds regardless of which specific data sources are missing. Could be smarter about proceeding with partial data.

5. **No strategy diff** — When the driver refreshes, there's no way to see what changed between the old and new strategy.

6. ~~**Strategy prompt doesn't include driver preferences**~~ — **RESOLVED 2026-04-11.** Driver preferences (vehicle class, fuel economy, earnings goal, shift hours, max deadhead) and earnings context are now injected via `loadDriverPreferences()` + `buildDriverPreferencesSection()` + `buildEarningsContextSection()` in `consolidator.js`. See `STRATEGIST_ENRICHMENT_PLAN.md` for full details.

---

## 12. TODO — Hardening Work

- [x] **Inject driver preferences into strategy prompt** — DONE 2026-04-11. Vehicle class, fuel economy, earnings goal, shift hours, max deadhead, home base. Both immediate and daily paths.
- [ ] **Auto-generate 12HR strategy** — Generate alongside NOW strategy as part of waterfall
- [ ] **Add strategy quality scoring** — LLM self-evaluation or heuristic scoring of recommendation quality
- [ ] **Add strategy diff on refresh** — Show what changed between previous and new strategy
- [ ] **Smarter briefing gate** — Proceed with partial data after minimum threshold (e.g., traffic + events ready, skip airport)
- [ ] **Strategy versioning** — Keep history of strategies per snapshot for debugging and analysis
- [ ] **A/B test strategy models** — Compare Claude vs Gemini strategy quality with user feedback metrics

---

## Key Files

| File | Purpose |
|------|---------|
| `server/api/strategy/blocks-fast.js` | Main waterfall trigger (900+ lines) |
| `server/lib/ai/providers/consolidator.js` | Strategy generation + prompt optimization (1,098 lines) |
| `server/lib/strategy/strategy-generator.js` | Entry point (legacy, mostly disabled) |
| `server/lib/strategy/strategy-utils.js` | Phase management, timing info |
| `server/api/strategy/strategy.js` | Strategy API routes (392 lines) |
| `server/api/strategy/strategy-events.js` | SSE endpoints for strategy/blocks/phase |
| `client/src/contexts/co-pilot-context.tsx` | Client strategy state management |
| `client/src/hooks/useEnrichmentProgress.ts` | Progress bar calculation |
| `shared/schema.js` (lines 75–103) | `strategies` table schema |
| `migrations/20260110_fix_strategy_now_notify.sql` | DB trigger for strategy_ready |
