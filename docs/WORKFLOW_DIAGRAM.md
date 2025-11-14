# Vecto Pilot - Complete End-to-End Workflow

**Last Updated:** 2025-11-14  
**Status:** ✅ PRODUCTION READY - All critical workflow bugs resolved

---

## 🎯 Complete Workflow: Snapshot → Strategy → Smart Blocks → UI

This document maps the complete end-to-end flow from user location capture to smart venue recommendations displayed in the UI.

### Timeline Summary
- **Snapshot Creation:** <1s
- **Holiday Check (Fast Path):** 1-2s ⚡
- **MinStrategy Generation:** 5-10s
- **Briefing Research (Perplexity):** 8-15s
- **Consolidation (GPT-5):** 15-30s
- **Smart Blocks Generation:** 10-20s
- **Total End-to-End:** 45-75 seconds

---

## 📊 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER FRONTEND                           │
│                     (client/src/pages/co-pilot.tsx)             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 1. GPS location captured
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    POST /api/snapshots                          │
│              (server/routes/snapshot-v1.js)                     │
│  - Saves snapshot to database                                   │
│  - Returns snapshot_id                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 2. Frontend calls POST /api/blocks
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│               POST /api/blocks (FIRE-AND-FORGET)                │
│           (server/routes/blocks-idempotent.js)                  │
│  ✅ FIX #106: Direct provider triggers                          │
│                                                                 │
│  1. Check if strategy exists (de-dupe)                          │
│  2. Insert triad_jobs row (idempotent)                          │
│  3. ensureStrategyRow(snapshotId)                               │
│  4. TRIGGER PROVIDERS IN PARALLEL:                              │
│     ├─ runHolidayCheck(snapshotId)      [1-2s]                 │
│     ├─ runMinStrategy(snapshotId)       [5-10s]                │
│     └─ runBriefing(snapshotId)          [8-15s]                │
│  5. Return HTTP 202 immediately                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            │                 │                 │
            ↓                 ↓                 ↓
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│ runHolidayCheck  │ │ runMinStrategy   │ │  runBriefing     │
│                  │ │                  │ │                  │
│ Provider: Gemini │ │ Provider: Claude │ │ Provider: Pplx   │
│ Time: 1-2s       │ │ Time: 5-10s      │ │ Time: 8-15s      │
│                  │ │                  │ │                  │
│ Writes:          │ │ Writes:          │ │ Writes:          │
│ strategies       │ │ strategies       │ │ briefings        │
│   .holiday       │ │   .minstrategy   │ │   .global_travel │
│                  │ │   .status='ok'   │ │   .domestic...   │
│                  │ │                  │ │   .local_traffic │
│                  │ │ NOTIFY:          │ │   ...            │
│                  │ │ strategy_ready   │ │                  │
└──────────────────┘ └──────────────────┘ └──────────────────┘
                              │
                              │ 3. PostgreSQL NOTIFY event
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│              TRIAD WORKER (Background Process)                  │
│              (server/jobs/triad-worker.js)                      │
│  ✅ FIX #105: Auto-restart + connection retry                   │
│                                                                 │
│  LISTEN-ONLY MODE (no polling)                                  │
│  1. LISTEN on channel: strategy_ready                           │
│  2. Receives NOTIFY with snapshotId                             │
│  3. Validates:                                                  │
│     - strategies.minstrategy IS NOT NULL ✓                      │
│     - briefings row exists ✓                                    │
│  4. Triggers consolidation if both ready                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    CONSOLIDATION STEP                           │
│      (server/lib/strategy-generator-parallel.js)                │
│                                                                 │
│  consolidateStrategy(snapshotId):                               │
│  - Input: minstrategy + briefing data                           │
│  - Provider: GPT-5 (with reasoning)                             │
│  - Time: 15-30s                                                 │
│  - Output: strategies.consolidated_strategy                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│               SMART BLOCKS GENERATION                           │
│         (server/lib/enhanced-smart-blocks.js)                   │
│                                                                 │
│  generateEnhancedSmartBlocks(snapshotId):                       │
│  - Calls GPT-5 venue generator                                  │
│  - Enriches with drive times                                    │
│  - Ranks with scoring engine                                    │
│  - Writes to rankings + ranking_candidates tables               │
│  - Time: 10-20s                                                 │
│  - Output: 4-6 ranked venues                                    │
│                                                                 │
│  NOTIFY blocks_ready sent!                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 4. SSE event to frontend
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    FRONTEND SSE LISTENER                        │
│           (client/src/services/strategyEvents.ts)               │
│                                                                 │
│  subscribeBlocksReady():                                        │
│  - Receives blocks_ready event with snapshotId                  │
│  - Invalidates React Query cache                                │
│  - Triggers GET /api/blocks-fast                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                   GET /api/blocks-fast                          │
│              (server/routes/blocks-fast.js)                     │
│                                                                 │
│  1. Fetch rankings + ranking_candidates                         │
│  2. Filter to 15-minute perimeter                               │
│  3. Return venue blocks with:                                   │
│     - name, coordinates, placeId                                │
│     - driveTimeMinutes, value_per_min                           │
│     - businessHours, eventBadge                                 │
│     - proTips, stagingArea                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      UI RENDERS BLOCKS                          │
│              (client/src/pages/co-pilot.tsx)                    │
│                                                                 │
│  React Query blocks query:                                      │
│  - Displays 2-4 venue cards                                     │
│  - Shows drive time, value grade                                │
│  - Includes pro tips and staging info                           │
│  - Event badges if applicable                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔥 Critical Fixes Applied

### Issue #106: Broken Workflow - Providers Not Triggering
**Problem:** POST /api/blocks only queued jobs but never triggered providers  
**Root Cause:** After disabling worker polling (#105), endpoint relied on non-existent polling loop  
**Solution:** Modified blocks-idempotent.js to fire-and-forget trigger providers directly  
**Status:** ✅ FIXED & VERIFIED

### Issue #105: Worker Crashes on DB Connection Loss
**Problem:** Worker process crashed when database connection dropped  
**Root Cause:** No connection retry logic, no auto-restart  
**Solution:** Added reconnection with exponential backoff + auto-restart in boot script  
**Status:** ✅ FIXED & VERIFIED

### Issue #104: esbuild Dependency Conflict
**Problem:** Deployment blocked by conflicting esbuild versions  
**Root Cause:** Vite 6.0.7 and Drizzle-Kit both require esbuild, npm couldn't resolve  
**Solution:** Locked Vite to 6.0.6 in package.json  
**Status:** ✅ FIXED & VERIFIED

---

## 🎯 Event-Driven Architecture

### PostgreSQL NOTIFY Channels

**1. strategy_ready**
- Fired by: MinStrategy provider (runMinStrategy)
- Trigger: UPDATE strategies SET status='ok', minstrategy=<text>
- Listener: Triad worker (triad-worker.js)
- Action: Validates providers → triggers consolidation

**2. blocks_ready**
- Fired by: Enhanced smart blocks generator
- Trigger: After successful ranking_candidates insert
- Listener: Frontend SSE connection
- Action: Invalidates React Query → fetches blocks

### No Polling!
- ❌ No job queue polling loops
- ❌ No database polling
- ❌ No interval timers
- ✅ Pure event-driven with PostgreSQL LISTEN/NOTIFY
- ✅ SSE (Server-Sent Events) to frontend

---

## 📁 Key Files Reference

### Backend (Strategy Generation)
- `server/routes/blocks-idempotent.js` - POST /api/blocks (triggers workflow)
- `server/lib/providers/minstrategy.js` - Claude strategist
- `server/lib/providers/briefing.js` - Perplexity research
- `server/lib/providers/holiday-checker.js` - Gemini holiday detection
- `server/lib/strategy-generator-parallel.js` - GPT-5 consolidation
- `server/lib/enhanced-smart-blocks.js` - Venue generation + ranking
- `server/jobs/triad-worker.js` - Background worker (LISTEN-only)

### Backend (API Routes)
- `server/routes/snapshot-v1.js` - POST /api/snapshots
- `server/routes/blocks-fast.js` - GET /api/blocks-fast (returns venues)
- `server/routes/sse-strategy-events.js` - SSE event streaming

### Frontend
- `client/src/pages/co-pilot.tsx` - Main UI component
- `client/src/contexts/location-context-clean.tsx` - Location + snapshot management
- `client/src/services/strategyEvents.ts` - SSE event subscriptions

### Database Schema
- `shared/schema.js` - Drizzle ORM schema
  - `snapshots` - User context (location, weather, etc.)
  - `strategies` - MinStrategy + consolidated outputs
  - `briefings` - Perplexity research data
  - `rankings` - Smart block rankings
  - `ranking_candidates` - Individual venue recommendations

---

## 🚀 Deployment Notes

### Production Compatibility
✅ All fixes work identically in Replit autoscale deployment:
- No environment-specific code
- LISTEN/NOTIFY works with pooled + unpooled connections
- Fire-and-forget provider triggers are stateless
- Worker auto-restart handled by boot script

### Environment Variables Required
```bash
# AI Models (all required)
STRATEGY_MODEL=claude-sonnet-4-5-20250929
BRIEFER_MODEL=sonar-pro
CONSOLIDATOR_MODEL=gpt-5

# Background Worker
ENABLE_BACKGROUND_WORKER=true

# Database (external Neon PostgreSQL)
DATABASE_URL=postgresql://...
DATABASE_URL_UNPOOLED=postgresql://...
```

### Health Checks
- `GET /health` - Basic server health
- `GET /ready` - Application readiness
- Worker logs: `/tmp/worker-output.log`

---

## ✅ Verification Checklist

End-to-end workflow validated with snapshot: `6d7a1e38-e077-4655-9984-bd9e7e5d5595`

- [x] Snapshot created successfully
- [x] POST /api/blocks returns 202 with kicked providers
- [x] Holiday check completes in 1-2s
- [x] MinStrategy generated in ~8s
- [x] Briefing data saved to database
- [x] NOTIFY strategy_ready fired
- [x] Worker receives notification
- [x] Consolidation completes (~30s total)
- [x] Smart blocks generated (3 venues)
- [x] NOTIFY blocks_ready fired
- [x] SSE event received by frontend
- [x] GET /api/blocks-fast returns venues
- [x] UI displays venue cards correctly
- [x] All database fields populated (minstrategy, consolidated_strategy, briefing)

---

**Document Version:** 1.0  
**Workflow Status:** ✅ PRODUCTION READY  
**Last Validation:** 2025-11-14 21:49:46 UTC
