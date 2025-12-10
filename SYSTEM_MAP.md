
# VECTO PILOT™ - COMPLETE SYSTEM MAP

**Last Updated:** 2025-12-09 UTC

This document provides a complete visual mapping of the Vecto Pilot system, showing how every component connects from UI to database and back.

---

## 📊 COMPLETE DATA FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         REACT CLIENT (Port 5000)                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  GlobalHeader.tsx                                                 │  │
│  │  • GPS status display                                            │  │
│  │  • Location display (DB → context → header)                      │  │
│  │  • Refresh button                                                │  │
│  └────────────────────┬─────────────────────────────────────────────┘  │
│                       ↓                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  location-context-clean.tsx (LocationProvider)                    │  │
│  │  • useGeoPosition() → Browser GPS                                │  │
│  │  • POST /api/location/resolve → users table                      │  │
│  │  • POST /api/auth/token → JWT generation                         │  │
│  │  • localStorage.setItem('token')                                 │  │
│  └────────────────────┬─────────────────────────────────────────────┘  │
│                       ↓                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  co-pilot.tsx (Main UI)                                          │  │
│  │  ┌────────────────┬────────────────┬────────────────┬──────────┐ │  │
│  │  │ Strategy Tab   │ Venues Tab     │ Briefing Tab   │ Map Tab  │ │  │
│  │  └────────────────┴────────────────┴────────────────┴──────────┘ │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│         ↓                  ↓                  ↓                         │
│  [useQuery hooks with Authorization: Bearer {token} headers]            │
└─────────┼──────────────────┼──────────────────┼─────────────────────────┘
          ↓                  ↓                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                    GATEWAY SERVER (Express, Port 5000)                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  [requireAuth middleware] → JWT verification → user_id extraction        │
│         ↓                                                                │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  SDK Routes (/api/*)                                             │  │
│  │  ┌──────────────────────────────────────────────────────────────┐│  │
│  │  │ Location Routes (location.js)                                ││  │
│  │  │ POST /api/location/resolve                                   ││  │
│  │  │   → Google Geocoding API                                     ││  │
│  │  │   → users table (INSERT/UPDATE)                              ││  │
│  │  │   → return user_id                                           ││  │
│  │  └──────────────────────────────────────────────────────────────┘│  │
│  │  ┌──────────────────────────────────────────────────────────────┐│  │
│  │  │ Snapshot Routes (snapshot.js)                                ││  │
│  │  │ POST /api/snapshot                                           ││  │
│  │  │   → snapshots table (self-contained context)                 ││  │
│  │  │   → POST /api/blocks-fast (trigger waterfall)                ││  │
│  │  │   → return snapshot_id                                       ││  │
│  │  │ GET /api/snapshot/:snapshotId                                ││  │
│  │  │   → snapshots table                                          ││  │
│  │  │   → return full snapshot context                             ││  │
│  │  └──────────────────────────────────────────────────────────────┘│  │
│  │  ┌──────────────────────────────────────────────────────────────┐│  │
│  │  │ Strategy Routes (strategy.js)                                ││  │
│  │  │ GET /api/strategy/:snapshotId                                ││  │
│  │  │   → strategies table                                         ││  │
│  │  │   → return minstrategy + consolidated_strategy               ││  │
│  │  └──────────────────────────────────────────────────────────────┘│  │
│  │  ┌──────────────────────────────────────────────────────────────┐│  │
│  │  │ Blocks Routes (blocks-fast.js)                               ││  │
│  │  │ POST /api/blocks-fast (waterfall trigger)                    ││  │
│  │  │   → runMinStrategy (minstrategy provider)                    ││  │
│  │  │   → runBriefing (briefing provider)                          ││  │
│  │  │   → runHolidayCheck (holiday provider)                       ││  │
│  │  │   → runConsolidator (consolidator provider)                  ││  │
│  │  │   → generateEnhancedSmartBlocks (venue planner)              ││  │
│  │  │   → return { ok: true }                                      ││  │
│  │  │ GET /api/blocks?snapshotId=X                                 ││  │
│  │  │   → rankings table                                           ││  │
│  │  │   → ranking_candidates table                                 ││  │
│  │  │   → return enriched venue blocks                             ││  │
│  │  └──────────────────────────────────────────────────────────────┘│  │
│  │  ┌──────────────────────────────────────────────────────────────┐│  │
│  │  │ Briefing Routes (briefing.js)                                ││  │
│  │  │ GET /api/briefing/weather/:snapshotId                        ││  │
│  │  │   → briefings.weather_current, weather_forecast              ││  │
│  │  │ GET /api/briefing/traffic/:snapshotId                        ││  │
│  │  │   → briefings.traffic_conditions                             ││  │
│  │  │ GET /api/briefing/news/:snapshotId                           ││  │
│  │  │   → briefings.news                                           ││  │
│  │  │ GET /api/briefing/events/:snapshotId                         ││  │
│  │  │   → briefings.events                                         ││  │
│  │  │ GET /api/briefing/closures/:snapshotId                       ││  │
│  │  │   → briefings.school_closures                                ││  │
│  │  └──────────────────────────────────────────────────────────────┘│  │
│  │  ┌──────────────────────────────────────────────────────────────┐│  │
│  │  │ Chat Routes (chat.js, realtime.js)                           ││  │
│  │  │ POST /api/chat                                               ││  │
│  │  │   → CoachDAL (read all tables for context)                   ││  │
│  │  │   → GPT-5.1 API                                              ││  │
│  │  │   → return AI response                                       ││  │
│  │  │ WebSocket /api/realtime                                      ││  │
│  │  │   → OpenAI Realtime API (voice)                              ││  │
│  │  └──────────────────────────────────────────────────────────────┘│  │
│  │  ┌──────────────────────────────────────────────────────────────┐│  │
│  │  │ Auth Routes (auth.js)                                        ││  │
│  │  │ POST /api/auth/token                                         ││  │
│  │  │   → JWT.sign({ userId })                                     ││  │
│  │  │   → return { token }                                         ││  │
│  │  └──────────────────────────────────────────────────────────────┘│  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────────────────────┐
│               POSTGRESQL DATABASE (Replit Built-in, Drizzle ORM)         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  users → snapshots → strategies → rankings → ranking_candidates          │
│     ↓       ↓           ↓            ↓              ↓                    │
│  actions    briefings   triad_jobs   venue_feedback strategy_feedback    │
│                                                                          │
│  Row-Level Security (RLS) policies filter all queries by user_id        │
└─────────────────────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         EXTERNAL AI/API SERVICES                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Anthropic Claude Sonnet 4.5                                     │   │
│  │ • Strategic overview (minstrategy provider)                     │   │
│  │ • File: providers/minstrategy.js → adapters/anthropic-adapter.js│   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ OpenAI GPT-5.1                                                  │   │
│  │ • Strategy consolidation (consolidator provider)                │   │
│  │ • Venue recommendations (tactical planner)                      │   │
│  │ • AI Coach (text chat)                                          │   │
│  │ • File: providers/consolidator.js → adapters/openai-adapter.js  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Google Gemini 3.0 Pro (with Google Search)                     │   │
│  │ • Events discovery (briefing provider)                          │   │
│  │ • Traffic analysis (briefing provider)                          │   │
│  │ • News filtering (briefing provider)                            │   │
│  │ • School closures (briefing provider)                           │   │
│  │ • File: briefing-service.js → adapters/gemini-adapter.js        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Google Gemini 2.5 Pro                                           │   │
│  │ • Event verification (venue-event-verifier.js)                  │   │
│  │ • File: venue-event-verifier.js → adapters/gemini-adapter.js    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Gemini 3.0 Pro (Holiday Detection - at Snapshot Creation)       │   │
│  │ • Holiday detection with Google Search grounding                │   │
│  │ • File: lib/holiday-detector.js (called by location.js)         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Google APIs (Maps Platform)                                     │   │
│  │ • Places API → business details, hours (places-cache.js)        │   │
│  │ • Routes API → distance, drive time (routes-api.js)             │   │
│  │ • Geocoding API → address resolution (geocoding.js)             │   │
│  │ • Weather API → current + forecast (briefing-service.js)        │   │
│  │ • Air Quality API → AQI data (location.js)                      │   │
│  │ • Timezone API → timezone resolution (location.js)              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 WATERFALL PIPELINE (POST /api/blocks-fast)

**Synchronous execution flow:**

```
1. POST /api/blocks-fast { snapshotId }
   ↓
2. Parallel Providers (Promise.allSettled):
   ├─ runMinStrategy (Claude Sonnet 4.5)
   │  └─ strategies.minstrategy ✓
   ├─ runBriefing (Gemini 3.0 Pro)
   │  └─ briefings.{news, events, traffic, closures} ✓
   └─ Holiday Detection (at snapshot creation)
      └─ snapshots.holiday, snapshots.is_holiday ✓
      └─ Supports override via server/config/holiday-override.json
   ↓
3. runConsolidator (GPT-5.1)
   └─ strategies.consolidated_strategy ✓
   ↓
4. generateEnhancedSmartBlocks:
   ├─ GPT-5.1 Tactical Planner
   │  └─ venue coords + staging coords
   ├─ Google Places API
   │  └─ business hours, place_id
   ├─ Google Routes API
   │  └─ distance, drive time
   ├─ Gemini 2.5 Pro
   │  └─ event verification
   └─ Google Geocoding
      └─ venue addresses
   ↓
5. rankings + ranking_candidates tables populated ✓
   ↓
6. Return { ok: true }
```

**Total time:** 35-50 seconds (full waterfall, synchronous)

---

## 📱 UI COMPONENT MAPPING

### GlobalHeader.tsx
**Data Sources:**
- `location-context-clean.tsx` (currentLocation string)
- `users` table via LocationContext
- GPS via `useGeoPosition.ts`

**Display:**
- Location string (e.g., "Frisco, TX")
- GPS status (getting/updating/ready)
- Refresh button

---

### co-pilot.tsx (Main UI)
**Tabs:**
1. **Strategy Tab**
   - Data: `strategies.consolidated_strategy`
   - Query: `GET /api/strategy/:snapshotId`
   - Component: Text display with markdown

2. **Venues Tab**
   - Data: `ranking_candidates.*`
   - Query: `GET /api/blocks?snapshotId=X`
   - Component: `SmartBlocks.tsx` (venue cards)

3. **Briefing Tab**
   - Data: `briefings.*`
   - Queries:
     - `GET /api/briefing/weather/:snapshotId`
     - `GET /api/briefing/traffic/:snapshotId`
     - `GET /api/briefing/news/:snapshotId`
     - `GET /api/briefing/events/:snapshotId`
     - `GET /api/briefing/closures/:snapshotId`
   - Component: `BriefingTab.tsx`

4. **Map Tab**
   - Data: `ranking_candidates.{lat, lng, name}`
   - Component: `MapTab.tsx`

---

### MarketIntelligenceBlocks.tsx (formerly SmartBlocks.tsx)
**Props from briefing data:**
- `name` - Venue name
- `address` - Full street address
- `estimated_distance_miles` - Distance
- `driveTimeMinutes` - Drive time
- `value_per_min` - Earnings per minute
- `value_grade` - A/B/C grade
- `proTips` - Tactical tips array
- `businessHours` - Hours object
- `venue_events` - Event data

---

### BriefingTab.tsx
**Props from briefings:**
- `weather_current` - Current conditions
- `weather_forecast` - 6-hour forecast
- `traffic_conditions` - Traffic summary + incidents
- `news` - Filtered news items
- `events` - Local events array
- `school_closures` - School/college closures

---

### CoachChat.tsx
**Backend Context (via CoachDAL - ALL Fields from ALL Tables):**
- `snapshots.*` - Complete snapshot (31 fields):
  - Location: GPS coords, city, state, formatted_address, timezone, H3 grid
  - Time: local_iso, dow, hour, day_part_key
  - Environment: weather (tempF, conditions), air (AQI), airport_context
  - News: local_news, news_briefing (Gemini 60-min intel)
  - Device: device metadata, permissions
- `strategies.*` - Full strategy (12 fields):
  - Strategic text: minstrategy (Claude), consolidated_strategy (GPT-5.1)
  - Metadata: model_name, model_params, prompt_version, latency_ms, tokens
  - Status: pending/ok/failed, error tracking
- `briefings.*` - Comprehensive briefing (15 fields):
  - Events: Gemini-discovered events with citations
  - Traffic: Real-time incidents, congestion from Google Search
  - News: Filtered rideshare-relevant news
  - Weather: Current conditions + 6-hour forecast
  - Closures: School/college closures affecting demand
- `rankings.*` - Session metadata (6 fields):
  - Model: venue planner model name
  - Timing: planner_ms, total_ms
  - Path: enhanced-smart-blocks workflow
- `ranking_candidates.*` - Enriched venues (25 fields each):
  - Identity: name, place_id, address, category, coordinates
  - Navigation: distance_miles, drive_minutes (Google Routes API)
  - Economics: value_per_min, value_grade, earnings projections, surge
  - Intelligence: pro_tips[], staging_name/lat/lng, closed_reasoning
  - Events: venue_events (Gemini verification), event impact
  - Hours: business_hours, isOpen status
- `venue_feedback.*` - Community ratings:
  - Sentiment: thumbs up/down counts per venue
  - Comments: Driver feedback text
  - Aggregation: up_count, down_count per ranking
- `strategy_feedback.*` - Strategy ratings:
  - Sentiment: thumbs up/down on overall strategy
  - Comments: Driver strategy feedback
- `actions.*` - Behavior history:
  - Actions: view, select, navigate, dismiss, dwell
  - Timing: dwell_ms, from_rank
  - Context: block_id, ranking_id linkage

**Enhanced Features:**
- **Thread Awareness**: Full conversation history via `assistant_memory` table
- **Google Search Tool**: Gemini 3.0 Pro with real-time web search for briefing data
- **File Upload**: Vision analysis of images, screenshots, documents
- **Memory Context**: Cross-session personalization and learning

**AI Models:** 
- GPT-5.1 (text chat, reasoning_effort=medium)
- GPT-4o Realtime (voice chat with streaming)
- Google Gemini 3.0 Pro (briefing generation with Google Search)

---

## 🗄️ TABLE DEPENDENCY GRAPH

```
users (GPS coordinates, location)
  ↓
snapshots (point-in-time context)
  ├─→ strategies (AI strategic outputs)
  │     └─→ triad_jobs (job tracking)
  ├─→ briefings (real-time intelligence)
  ├─→ rankings (venue recommendation sessions)
  │     └─→ ranking_candidates (individual venues)
  ├─→ actions (user behavior tracking)
  ├─→ venue_feedback (venue ratings)
  └─→ strategy_feedback (strategy ratings)
```

**Foreign Key Relationships:**
- `snapshots.user_id` → `users.user_id`
- `strategies.snapshot_id` → `snapshots.snapshot_id`
- `briefings.snapshot_id` → `snapshots.snapshot_id`
- `rankings.snapshot_id` → `snapshots.snapshot_id`
- `ranking_candidates.ranking_id` → `rankings.ranking_id`
- `ranking_candidates.snapshot_id` → `snapshots.snapshot_id`
- `actions.snapshot_id` → `snapshots.snapshot_id`
- `venue_feedback.snapshot_id` → `snapshots.snapshot_id`
- `strategy_feedback.snapshot_id` → `snapshots.snapshot_id`

---

## 🔐 SECURITY FLOW

```
1. Browser GPS → lat/lng coordinates
   ↓
2. POST /api/location/resolve
   ↓
3. INSERT/UPDATE users table → user_id returned
   ↓
4. POST /api/auth/token { user_id }
   ↓
5. JWT signed with secret → { userId: user_id }
   ↓
6. localStorage.setItem('token', jwt)
   ↓
7. All API calls include: Authorization: Bearer {jwt}
   ↓
8. requireAuth middleware:
   - Verify JWT signature
   - Extract user_id from payload
   - Attach to req.auth.userId
   ↓
9. Database queries filtered by user_id:
   - RLS policies enforce user_id isolation
   - Drizzle queries use eq(table.user_id, req.auth.userId)
   ↓
10. Response contains ONLY data for authenticated user
```

---

## 🎯 KEY TAKEAWAYS

1. **Single Source of Truth:** PostgreSQL database is authoritative for all data
2. **Model-Agnostic Providers:** Each AI role (strategist, briefer, consolidator) is pluggable
3. **Enrichment Pipeline:** Google APIs provide verified data (coords, hours, distance)
4. **JWT Authentication:** User isolation at every layer (middleware, RLS, queries)
5. **Snapshot-Centric:** All data scoped to snapshot_id for ML traceability
6. **Real-Time Updates:** SSE for strategy_ready, polling for blocks
7. **Fail-Closed:** Missing data returns null/404, never hallucinated defaults

---

**End of System Map**
