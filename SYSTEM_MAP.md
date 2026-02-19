# VECTO PILOT™ - COMPLETE SYSTEM MAP

**Last Updated:** 2026-02-15 UTC

This document provides a complete visual mapping of the Vecto Pilot system, showing how every component connects from UI to database and back.

---

## 📲 EXTERNAL INPUT SOURCES (Level 4 Architecture)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      HEADLESS CLIENT INTEGRATION                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ⚠️  AUTH BYPASS: This flow does NOT use JWT authentication!  (Is this still accurate? Melody)          │
│  Security is via device_id registration + optional API key.  (I believe we are using user sign up/in now should this be updated? Melody)            │
│  user_id in intercepted_signals has NO FK constraint (nullable). (Verify and check codebase for accuracy. Melody)       │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  iOS Siri Shortcut (OCR Text) (We are using the vision workflow now where an image is sent now and this is now complex with a table where data is parsed, cleaned and usable for AI/ML future use - please update this to include the entire workflow and data extraction to table aswell)                                    │  │
│  │  • User shares screenshot of ride offer                           │  │
│  │  • iOS OCR extracts text (price, miles, time)                     │  │
│  │  • Shortcut calls POST /api/hooks/analyze-offer                   │  │
│  │  • NO JWT token - uses device_id for identification  (we need to discuss how we are going to help the user apply this shortcut after a lot more testing from me - Melody)             │  │
│  └────────────────────┬─────────────────────────────────────────────┘  │
│                       ↓                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  POST /api/hooks/analyze-offer (server/api/hooks/analyze-offer.js)│  │
│  │  • Auth: BYPASSES requireAuth middleware (headless endpoint)      │  │
│  │  • Receives: { raw_text, device_id } (user_id optional)           │  │
│  │  • Parses: price ($12.50), miles (4.2mi), time (8 min)            │  │
│  │  • AI Decision: ACCEPT/REJECT with reasoning                      │  │
│  │  • Stores result in: intercepted_signals table                    │  │
│  │  • NOTE: user_id column has NO FK - allows headless inserts       │  │
│  └────────────────────┬─────────────────────────────────────────────┘  │
│                       ↓                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  SignalTerminal.tsx (/co-pilot/omni)                              │  │
│  │  • Real-time display via SSE/Polling                              │  │
│  │  • Shows: incoming offers + AI decision + reasoning               │  │
│  │  • Driver confirms/overrides AI decision                          │  │
│  │  • Feedback loop improves future decisions                        │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Why No FK Constraint on user_id? (we can require username - email address used to login instead of device id?)

| Constraint Type | Problem with Headless Clients |
|-----------------|-------------------------------|
| `user_id UUID NOT NULL REFERENCES users(user_id)` | ❌ INSERT fails - Siri has no user session |
| `user_id UUID REFERENCES users(user_id)` | ❌ INSERT fails if device_id not in users table |
| `user_id UUID` (no FK, nullable) | ✅ INSERT succeeds - "fire and forget" pattern |

The `device_id` is the PRIMARY identifier for headless clients. The `user_id` can be linked later when the driver opens the app and logs in from that device.

### Siri Interceptor Data Flow

```
iOS Device                      Vecto Server                    Database
    │                               │                              │
    │  1. Screenshot shared         │                              │
    │  ──────────────────────►      │                              │
    │  (Siri Shortcut triggers)     │                              │
    │                               │                              │
    │  2. OCR extracts text         │                              │
    │  ──────────────────────►      │                              │
    │  POST /api/hooks/analyze-offer│                              │
    │  { raw_text, device_id }      │  ← NO user_id required!      │
    │                               │                              │
    │                               │  3. Parse & AI decision      │
    │                               │  ─────────────────────────►  │
    │                               │  INSERT intercepted_signals  │
    │                               │  (user_id = NULL is OK)      │
    │                               │                              │
    │  4. Immediate response        │                              │
    │  ◄──────────────────────      │                              │
    │  { decision: "ACCEPT",        │                              │
    │    reasoning: "Good $/mi" }   │                              │
    │                               │                              │
    │  5. Siri speaks decision      │                              │
    │  ◄── (TTS in Shortcut)        │                              │
    │                               │                              │
    │                               │  6. SSE push to app          │
    │                               │  ─────────────────────────►  │
    │                               │  SignalTerminal updates      │
    │                               │                              │
```

---

## 📊 COMPLETE DATA FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         REACT CLIENT (Port 5000)                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  App.tsx (React Router + Providers)                              │  │
│  │  • AuthProvider (auth-context.tsx)                               │  │
│  │  • CoPilotProvider (co-pilot-context.tsx)                        │  │
│  │  • QueryClientProvider (React Query)                             │  │
│  └────────────────────┬─────────────────────────────────────────────┘  │
│                       ↓                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  routes.tsx (Route Configuration)                                 │  │
│  │  • / → AuthRedirect (smart routing)                              │  │
│  │  • /auth/* → Public auth pages (no layout)                       │  │
│  │  • /co-pilot/* → Protected routes (CoPilotLayout)                │  │
│  └────────────────────┬─────────────────────────────────────────────┘  │
│                       ↓                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  CoPilotLayout.tsx (Shared Layout)                                │  │
│  │  ├── LocationProvider (location-context-clean.tsx)               │  │
│  │  │   └── Manages GPS, weather, snapshots                         │  │
│  │  ├── GlobalHeader (conditional - hidden on /about)               │  │
│  │  │   └── Location display, refresh button                        │  │
│  │  ├── <Outlet /> (current page renders here)                      │  │
│  │  └── BottomTabNavigation (React Router nav)                      │  │
│  └────────────────────┬─────────────────────────────────────────────┘  │
│                       ↓                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Route-Based Pages (8 co-pilot + 5 auth + SafeScaffold)          │  │
│  │  ┌────────────────────────────────────────────────────────────┐  │  │
│  │  │ /co-pilot/strategy  → StrategyPage.tsx                     │  │  │
│  │  │   • AI strategy display                                    │  │  │
│  │  │   • Smart Blocks (NOW strategy: top 3 Grade A, ≥1mi apart) │  │  │
│  │  │   • CoachChat (GPT-5.2 text + Realtime voice)  (Real-time voice is not integrated yet, we need to look at this. Please change the CoachChat to AICoach and gemini 3 pro with vision is used for uploading images such as heatmaps and surge maps - we should figure out a way to capture the images for further AI/ML learning if possible - Melody)            │  │  │
│  │  │   • FeedbackModal                                          │  │  │
│  │  │   • SmartBlocksStatus (pipeline progress)                  │  │  │
│  │  │   • GreetingBanner (holiday awareness)  (Banner should show the holiday in addition to the greeting. The greeting daypart seems to be different than the global header daypart - we need to review this - Melody)                   │  │  │
│  │  ├────────────────────────────────────────────────────────────┤  │  │
│  │  │ /co-pilot/bars → BarsPage.tsx    (update naming conventions in this map - Melody)                          │  │  │
│  │  │   • BarsTable (premium venue listings)                     │  │  │
│  │  │   • Filter: $$ and above, open only  (I feel like we should be capturing these venues into the venue_catelog table as the same names appear almost every day which reminds me that since google can return placesID maybe we should be requesting it do this with events as well - Melody)                      │  │  │
│  │  ├────────────────────────────────────────────────────────────┤  │  │
│  │  │ /co-pilot/briefing → BriefingPage.tsx                      │  │  │
│  │  │   • BriefingTab (weather, traffic, news, events)           │  │  │
│  │  │   • EventsComponent (active events display)                │  │  │
│  │  │   • useBriefingQueries (direct API fetch)                  │  │  │
│  │  ├────────────────────────────────────────────────────────────┤  │  │
│  │  │ /co-pilot/map → MapPage.tsx                                │  │  │
│  │  │   • MapTab (interactive venue map)                         │  │  │
│  │  │   • Strategy blocks + bar markers + active events          │  │  │
│  │  │   • useActiveEventsQuery (happening now filter)            │  │  │
│  │  ├────────────────────────────────────────────────────────────┤  │  │
│  │  │ /co-pilot/intel → IntelPage.tsx                            │  │  │
│  │  │   • RideshareIntelTab                                      │  │  │
│  │  │   • DeadheadCalculator, ZoneCards, StrategyCards           │  │  │
│  │  ├────────────────────────────────────────────────────────────┤  │  │
│  │  │ /co-pilot/about → AboutPage.tsx (no header)                │  │  │
│  │  │   • DonationTab + InstructionsTab                          │  │  │
│  │  ├────────────────────────────────────────────────────────────┤  │  │
│  │  │ /co-pilot/policy → PolicyPage.tsx                          │  │  │
│  │  │   • Privacy policy (static)                                │  │  │
│  │  ├────────────────────────────────────────────────────────────┤  │  │
│  │  │ /co-pilot/settings → SettingsPage.tsx                      │  │  │
│  │  │   • User profile editing                                   │  │  │
│  │  │   • Vehicle settings                                       │  │  │
│  │  │   • Platform data dropdowns                                │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  │  ┌────────────────────────────────────────────────────────────┐  │  │
│  │  │ Auth Pages (public, no layout)                             │  │  │
│  │  │ • /auth/sign-in → SignInPage.tsx                           │  │  │
│  │  │ • /auth/sign-up → SignUpPage.tsx                           │  │  │
│  │  │ • /auth/forgot-password → ForgotPasswordPage.tsx           │  │  │
│  │  │ • /auth/reset-password → ResetPasswordPage.tsx             │  │  │
│  │  │ • /auth/terms → TermsPage.tsx                              │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│         ↓                  ↓                  ↓                         │
│  [React Query hooks with Authorization: Bearer {token} headers]        │
└─────────┼──────────────────┼──────────────────┼─────────────────────────┘
          ↓                  ↓                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│              GATEWAY SERVER (Express, Port 5000, mono-mode)              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  [server/bootstrap/routes.js] - Centralized route mounting              │
│         ↓                                                                │
│  [requireAuth middleware] → JWT verification → user_id extraction        │
│         ↓                                                                │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  API Routes (server/api/* - organized by domain)                 │  │
│  │  ┌──────────────────────────────────────────────────────────────┐│  │
│  │  │ Health & Diagnostics (server/api/health/)                    ││  │
│  │  │ • /api/diagnostics → diagnostics.js                          ││  │
│  │  │ • /api/diagnostic → diagnostic-identity.js                   ││  │
│  │  │ • /api/health → health.js                                    ││  │
│  │  │ • /api/ml-health → ml-health.js                              ││  │
│  │  │ • /api/job-metrics → job-metrics.js                          ││  │
│  │  └──────────────────────────────────────────────────────────────┘│  │
│  │  ┌──────────────────────────────────────────────────────────────┐│  │
│  │  │ Chat & Voice (server/api/chat/)                              ││  │
│  │  │ • POST /api/chat/:snapshotId/message → chat.js (SSE stream)  ││  │
│  │  │ • POST /api/tts → tts.js (OpenAI TTS)                        ││  │
│  │  │ • POST /api/realtime/token → realtime.js (voice)             ││  │
│  │  └──────────────────────────────────────────────────────────────┘│  │
│  │  ┌──────────────────────────────────────────────────────────────┐│  │
│  │  │ Venue Intelligence (server/api/venue/)                       ││  │
│  │  │ • GET /api/venues/nearby → venue-intelligence.js             ││  │
│  │  │ • GET /api/venue/events → venue-events.js                    ││  │
│  │  │ • POST /api/closed-venue-reasoning → closed-venue-reasoning  ││  │
│  │  └──────────────────────────────────────────────────────────────┘│  │
│  │  ┌──────────────────────────────────────────────────────────────┐│  │
│  │  │ Briefing (server/api/briefing/)                              ││  │
│  │  │ • GET /api/briefing/weather/:snapshotId → briefing.js        ││  │
│  │  │ • GET /api/briefing/traffic/:snapshotId → briefing.js        ││  │
│  │  │ • GET /api/briefing/rideshare-news/:snapshotId → briefing.js ││  │
│  │  │ • GET /api/briefing/events/:snapshotId → briefing.js         ││  │
│  │  │ • GET /api/briefing/school-closures/:snapshotId → briefing   ││  │
│  │  │ (SSE: consolidated to /events/* via strategy-events.js)      ││  │
│  │  └──────────────────────────────────────────────────────────────┘│  │
│  │  ┌──────────────────────────────────────────────────────────────┐│  │
│  │  │ Auth (server/api/auth/)                                      ││  │
│  │  │ • POST /api/auth/sign-up → auth.js                           ││  │
│  │  │ • POST /api/auth/sign-in → auth.js                           ││  │
│  │  │ • POST /api/auth/verify-email → auth.js                      ││  │
│  │  │ • POST /api/auth/refresh → auth.js                           ││  │
│  │  │ • POST /api/auth/forgot-password → auth.js                   ││  │
│  │  │ • POST /api/auth/reset-password → auth.js                    ││  │
│  │  └──────────────────────────────────────────────────────────────┘│  │
│  │  ┌──────────────────────────────────────────────────────────────┐│  │
│  │  │ Location (server/api/location/)                              ││  │
│  │  │ • GET /api/location/resolve → location.js (GPS resolution)   ││  │
│  │  │ • GET /api/location/ip → location.js (IP fallback)           ││  │
│  │  │ • GET /api/location/weather → location.js                    ││  │
│  │  │ • GET /api/location/airquality → location.js                 ││  │
│  │  │ • POST /api/snapshot → snapshot.js (save snapshot)           ││  │
│  │  │ • GET /api/snapshot/:id → snapshot.js                        ││  │
│  │  │ • GET /api/users/me → location.js (user location from DB)    ││  │
│  │  └──────────────────────────────────────────────────────────────┘│  │
│  │  ┌──────────────────────────────────────────────────────────────┐│  │
│  │  │ Strategy (server/api/strategy/)                              ││  │
│  │  │ • POST /api/blocks-fast → blocks-fast.js (TRIAD trigger)     ││  │
│  │  │ • GET /api/blocks-fast → blocks-fast.js (fetch blocks)       ││  │
│  │  │ • GET /api/blocks/strategy/:id → content-blocks.js           ││  │
│  │  │ • GET /api/strategy/:snapshotId → strategy.js                ││  │
│  │  │ • GET /events/strategy → strategy-events.js (SSE-DB NOTIFY)  ││  │
│  │  │ • GET /events/briefing → strategy-events.js (SSE-DB NOTIFY)  ││  │
│  │  │ • GET /events/blocks → strategy-events.js (SSE-DB NOTIFY)    ││  │
│  │  │ • GET /events/phase → strategy-events.js (SSE-EventEmitter)  ││  │
│  │  └──────────────────────────────────────────────────────────────┘│  │
│  │  ┌──────────────────────────────────────────────────────────────┐│  │
│  │  │ Feedback (server/api/feedback/)                              ││  │
│  │  │ • POST /api/feedback/venue → feedback.js                     ││  │
│  │  │ • POST /api/feedback/strategy → feedback.js                  ││  │
│  │  │ • POST /api/feedback/app → feedback.js                       ││  │
│  │  │ • POST /api/actions → actions.js (log user actions)          ││  │
│  │  └──────────────────────────────────────────────────────────────┘│  │
│  │  ┌──────────────────────────────────────────────────────────────┐│  │
│  │  │ Platform Data (server/api/platform/)                         ││  │
│  │  │ • GET /api/platform/markets → index.js                       ││  │
│  │  │ • GET /api/platform/countries-dropdown → index.js            ││  │
│  │  │ • GET /api/platform/regions-dropdown → index.js              ││  │
│  │  │ • GET /api/platform/markets-dropdown → index.js              ││  │
│  │  │ • GET /api/platform/lookup → index.js (city lookup)          ││  │
│  │  └──────────────────────────────────────────────────────────────┘│  │
│  │  ┌──────────────────────────────────────────────────────────────┐│  │
│  │  │ Intelligence (server/api/intelligence/)                      ││  │
│  │  │ • GET /api/intelligence/markets → index.js                   ││  │
│  │  │ • GET /api/intelligence/coach/:market → index.js             ││  │
│  │  │ • GET /api/intelligence/lookup → index.js                    ││  │
│  │  └──────────────────────────────────────────────────────────────┘│  │
│  │  ┌──────────────────────────────────────────────────────────────┐│  │
│  │  │ Vehicle (server/api/vehicle/)                                ││  │
│  │  │ • GET /api/vehicle/years → vehicle.js                        ││  │
│  │  │ • GET /api/vehicle/makes → vehicle.js                        ││  │
│  │  │ • GET /api/vehicle/models → vehicle.js                       ││  │
│  │  └──────────────────────────────────────────────────────────────┘│  │
│  │  ┌──────────────────────────────────────────────────────────────┐│  │
│  │  │ Agent (server/agent/)                                        ││  │
│  │  │ • /agent/* → embed.js (workspace agent)                      ││  │
│  │  │ • /agent/ws → embed.js (WebSocket for agent)                 ││  │
│  │  └──────────────────────────────────────────────────────────────┘│  │
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
│  Additional tables: discovered_events, venue_events, market_intelligence │
│                     platform_data, countries, auth tables                │
│                                                                          │
│  Row-Level Security (RLS) policies filter all queries by user_id        │
└─────────────────────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         EXTERNAL AI/API SERVICES                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Anthropic Claude Sonnet 4.5 (Strategic Overview)               │   │
│  │ • File: server/lib/ai/adapters/anthropic-sonnet45.js            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ OpenAI GPT-5.2 (Consolidation, Venues, Coach)                  │   │
│  │ • File: server/lib/ai/adapters/openai-adapter.js                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Google Gemini 3.0 Pro + Search (Events, Traffic, News)         │   │
│  │ • File: server/lib/ai/adapters/gemini-adapter.js                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Google Gemini 2.5 Pro (Event Verification)                     │   │
│  │ • File: server/lib/ai/adapters/gemini-2.5-pro.js                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Google APIs (Maps Platform)                                    │   │
│  │ • Places API, Routes API, Geocoding, Weather, AQ, Timezone     │   │
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
   ├─ Strategist (Claude Sonnet 4.5)
   │  └─ strategies.minstrategy ✓
   ├─ Briefing (Gemini 3.0 Pro + Google Search)
   │  └─ briefings.{news, events, traffic, closures, airport} ✓
   └─ Holiday Detection (at snapshot creation)
      └─ snapshots.holiday, snapshots.is_holiday ✓
   ↓
3. Consolidator (GPT-5.2)
   └─ strategies.consolidated_strategy ✓ (NOW strategy)
   ↓
4. Enhanced Smart Blocks:
   ├─ GPT-5.2 Tactical Planner
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

### Route-Based Architecture

The UI uses **React Router** with:
- **AuthProvider** for authentication state
- **CoPilotProvider** for shared strategy/blocks state (persists across routes)
- **LocationProvider** for GPS/weather/snapshots
- **ProtectedRoute** wrapper for authenticated pages
- **CoPilotLayout** as shared layout (GlobalHeader + BottomTabNavigation)

### Page → API Mapping

| Route | Component | Primary Data Sources |
|-------|-----------|---------------------|
| `/co-pilot/strategy` | StrategyPage.tsx | CoPilotContext (strategy, blocks), CoachChat |
| `/co-pilot/bars` | BarsPage.tsx | `/api/venues/nearby`, BarsTable |
| `/co-pilot/briefing` | BriefingPage.tsx | useBriefingQueries (6 endpoints) |
| `/co-pilot/map` | MapPage.tsx | CoPilotContext (blocks), bars API, active events |
| `/co-pilot/intel` | IntelPage.tsx | RideshareIntelTab (static intelligence) |
| `/co-pilot/about` | AboutPage.tsx | Static (no API) |
| `/co-pilot/policy` | PolicyPage.tsx | Static (no API) |
| `/co-pilot/settings` | SettingsPage.tsx | Auth context, platform data APIs |

---

## 🗄️ TABLE DEPENDENCY GRAPH

```
users (session tracking, auth - NO location data)
  ├─→ auth_sessions (JWT tokens)
  ├─→ auth_verification_codes (email/SMS codes)
  ├─→ intercepted_signals (Siri/external offer analysis) [NEW - Level 4]
  │     └─→ Real-time offer decisions from headless clients
  └─→ snapshots (point-in-time context)
        ├─→ strategies (AI strategic outputs)
        │     └─→ triad_jobs (job tracking)
        ├─→ briefings (real-time intelligence)
        ├─→ rankings (venue recommendation sessions)
        │     └─→ ranking_candidates (individual venues)
        ├─→ actions (user behavior tracking)
        ├─→ venue_feedback (venue ratings)
        └─→ strategy_feedback (strategy ratings)

coords_cache (geocode cache with 6-decimal precision)
  └─→ Shared across devices for same location

markets (102 global markets with pre-stored timezones)
  └─→ 3,333 city aliases for suburb/neighborhood matching

discovered_events (global event repository)
  └─→ venue_events (venue-event associations)

market_intelligence (curated market knowledge)
platform_data (Uber/Lyft city coverage)
countries (ISO 3166-1 reference)
```

---

## 🔐 SECURITY FLOW

```
1. User signs up → POST /api/auth/sign-up
   ↓
2. Create user record + send verification email
   ↓
3. User verifies → POST /api/auth/verify-email
   ↓
4. User signs in → POST /api/auth/sign-in
   ↓
5. JWT access token (15min) + refresh token (7d) returned
   ↓
6. Client stores tokens in AuthContext (memory + localStorage for refresh)
   ↓
7. All API calls include: Authorization: Bearer {access_token}
   ↓
8. requireAuth middleware:
   - Verify JWT signature
   - Extract user_id from payload
   - Attach to req.auth.userId
   ↓
9. Database queries filtered by user_id (RLS policies)
   ↓
10. Response contains ONLY data for authenticated user
```

---

## 🎯 KEY TAKEAWAYS

1. **Single Source of Truth:** PostgreSQL database is authoritative for all data
2. **Route-Based UI:** React Router with 13 pages, shared CoPilotContext
3. **Authentication First:** All routes protected except auth pages
4. **Domain-Organized APIs:** server/api/* folders by domain (auth, briefing, chat, etc.)
5. **Model-Agnostic Providers:** Each AI role is pluggable via adapters
6. **Enrichment Pipeline:** Google APIs provide verified data
7. **JWT Authentication:** User isolation at every layer
8. **Snapshot-Centric:** All data scoped to snapshot_id for ML traceability
9. **Real-Time Updates:** SSE for briefing_ready, strategy_ready, blocks_ready
10. **Fail-Closed:** Missing data returns null/404, never hallucinated defaults
11. **Global Markets:** 102 pre-stored markets (31 US + 71 international) skip Google Timezone API
12. **Two-Phase UI Update:** Weather/AQI display before city/state resolution completes

---

**End of System Map**