# VECTO PILOT™ - COMPLETE SYSTEM MAP

**Last Updated:** 2026-04-30 UTC

This document provides a complete visual mapping of the Vecto Pilot system, showing how every component connects from UI to database and back.

> Per Rule 14 (model-agnostic adapter architecture), specific model versions are not enumerated here — consult `server/lib/ai/model-registry.js` for current model assignments. Hardcoded model names appearing in diagrams below are illustrative only.

---

## 📲 EXTERNAL INPUT SOURCES (Level 4 Architecture)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      HEADLESS CLIENT INTEGRATION                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ⚠️  DUAL AUTH MODEL:                                                    │
│  • App users: JWT sign-up/sign-in (email + password)                    │
│  • Headless clients (Siri): device_id only (NO JWT - cannot send       │
│    Bearer tokens from iOS Shortcuts)                                     │
│  • user_id in offer tables has NO FK constraint (nullable)              │
│  • device_id → user_id linking happens when driver opens app            │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  iOS Siri Shortcut — THREE INPUT MODES                           │  │
│  │                                                                    │  │
│  │  Flow A: "Vecto Analyze" (Text/OCR Mode)                         │  │
│  │  • User shares screenshot → iOS OCR extracts text                 │  │
│  │  • POST { text, device_id, latitude, longitude }                  │  │
│  │  • Server: regex pre-parser (<1ms) → AI decision                  │  │
│  │                                                                    │  │
│  │  Flow B: "Vecto Vision" (Base64 Image Mode)                      │  │
│  │  • User shares screenshot → JPEG compress → base64 encode         │  │
│  │  • POST { image, image_type, device_id, latitude, longitude }     │  │
│  │  • Server: sends base64 to Gemini Flash vision API                │  │
│  │                                                                    │  │
│  │  Flow C: "Vecto Vision" (Multipart Upload — Fastest)              │  │
│  │  • User shares screenshot → JPEG compress → multipart form-data   │  │
│  │  • Server: Multer captures bytes → base64 internally (<1ms)       │  │
│  │  • Eliminates ~200ms base64 encoding on iOS client                │  │
│  │                                                                    │  │
│  │  All modes → POST /api/hooks/analyze-offer                        │  │
│  │  NO JWT token — uses device_id for identification                 │  │
│  │  TODO: User onboarding for Shortcut setup (needs more testing)    │  │
│  └────────────────────┬─────────────────────────────────────────────┘  │
│                       ↓                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  POST /api/hooks/analyze-offer (server/api/hooks/analyze-offer.js)│  │
│  │  • Auth: BYPASSES requireAuth (headless endpoint)                 │  │
│  │  • Accepts: text, base64 image, or multipart image upload         │  │
│  │  • Pre-parser: regex extraction (parse-offer-text.js, 325 lines) │  │
│  │  • Vision: Gemini 3 Flash extracts data from screenshots          │  │
│  │  • AI Decision: ACCEPT/REJECT with reasoning + confidence score   │  │
│  │  • Stores to: offer_intelligence table (30+ ML-ready columns)     │  │
│  │  • NOTE: user_id has NO FK — allows headless inserts              │  │
│  └────────────────────┬─────────────────────────────────────────────┘  │
│                       ↓                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  offer_intelligence table (migrated from intercepted_signals)     │  │
│  │  • Structured numeric columns (NOT JSONB blobs)                   │  │
│  │  • Offer metrics: price, per_mile, per_minute, hourly_rate, surge │  │
│  │  • Geography: pickup/dropoff addresses + lat/lng, H3 index        │  │
│  │  • Temporal: local_date, local_hour, day_part, is_weekend         │  │
│  │  • ML training: decision + user_override = labeled training data  │  │
│  │  • Sequence: offer_session_id, sequence_num (pattern analysis)    │  │
│  │  • Quality: parse_confidence, input_mode (text vs vision)         │  │
│  │  • 15+ indexes for daypart/geographic/platform analytics          │  │
│  └────────────────────┬─────────────────────────────────────────────┘  │
│                       ↓                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  SignalTerminal.tsx (/co-pilot/omni)                              │  │
│  │  • Real-time display via SSE/Polling                              │  │
│  │  • Shows: incoming offers + AI decision + reasoning               │  │
│  │  • Driver confirms/overrides AI decision                          │  │
│  │  • Override feedback → labeled training data for ML learning      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  Additional Headless Endpoints (all device_id auth):                    │
│  • GET  /api/hooks/offer-history?device_id=xxx&limit=20                 │
│  • POST /api/hooks/offer-override (driver disagrees with AI)            │
│  • POST /api/hooks/offer-cleanup (maintenance)                          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Why No FK Constraint on user_id?

> **Future consideration:** Could require email/username instead of device_id once
> Shortcut onboarding is mature. For now, device_id is correct for headless ingestion.

| Constraint Type | Problem with Headless Clients |
|-----------------|-------------------------------|
| `user_id UUID NOT NULL REFERENCES users(user_id)` | ❌ INSERT fails - Siri has no user session |
| `user_id UUID REFERENCES users(user_id)` | ❌ INSERT fails if device_id not in users table |
| `user_id UUID` (no FK, nullable) | ✅ INSERT succeeds - "fire and forget" pattern |

The `device_id` is the PRIMARY identifier for headless clients. The `user_id` can be linked later when the driver opens the app and logs in from that device.

### Offer Interceptor Data Flow (Vision + Text)

```
iOS Device                      Vecto Server                    Database
    │                               │                              │
    │  1. Screenshot shared         │                              │
    │  ──────────────────────►      │                              │
    │  (Siri Shortcut triggers)     │                              │
    │                               │                              │
    │  2a. OCR text (Flow A)        │                              │
    │  ──── OR ────                 │                              │
    │  2b. JPEG image (Flow B/C)    │                              │
    │  ──────────────────────►      │                              │
    │  POST /api/hooks/analyze-offer│                              │
    │  { text|image, device_id }    │  ← NO user_id required!      │
    │                               │                              │
    │                               │  3a. Text: regex pre-parse   │
    │                               │  3b. Vision: Gemini Flash    │
    │                               │      extracts from image     │
    │                               │  ─────────────────────────►  │
    │                               │  INSERT offer_intelligence   │
    │                               │  (30+ structured columns)    │
    │                               │                              │
    │  4. Immediate response        │                              │
    │  ◄──────────────────────      │                              │
    │  { decision: "ACCEPT",        │                              │
    │    reasoning: "Good $/mi",    │                              │
    │    confidence: 0.92 }         │                              │
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
│  │  │   • AICoach (Gemini 3 Pro Preview — text + vision + search)│  │  │
│  │  │     └─ Image uploads: heatmaps, surge maps, screenshots    │  │  │
│  │  │     └─ Voice: OpenAI Realtime API (integrated, disabled)   │  │  │
│  │  │     └─ TODO: capture uploaded images for AI/ML learning    │  │  │
│  │  │   • FeedbackModal                                          │  │  │
│  │  │   • SmartBlocksStatus (pipeline progress)                  │  │  │
│  │  │   • GreetingBanner (holiday OR daypart greeting)           │  │  │
│  │  │     └─ KNOWN ISSUE: shows holiday OR greeting, not both    │  │  │
│  │  │     └─ KNOWN ISSUE: getGreeting() uses 3 dayparts vs      │  │  │
│  │  │        GlobalHeader classifyDayPart() uses 7 — mismatch   │  │  │
│  │  ├────────────────────────────────────────────────────────────┤  │  │
│  │  │ /co-pilot/bars → VenueManagerPage.tsx (renamed 2026-01-09) │  │  │
│  │  │   • BarsDataGrid (premium venue listings, renamed 01-09)   │  │  │
│  │  │   • Filter: $$ and above, open only                        │  │  │
│  │  │   • ✅ Venues persist to venue_catalog (place_id captured) │  │  │
│  │  │   • ✅ Events also store place_id in venue_events table    │  │  │
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
│  │ OpenAI GPT-5.2 (Consolidation, Venues, TTS, Voice)            │   │
│  │ • File: server/lib/ai/adapters/openai-adapter.js                │   │
│  │ • Voice: Realtime API for AICoach (integrated, currently off)   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Google Gemini 3.0 Pro + Search (Events, Traffic, News, Coach)  │   │
│  │ • File: server/lib/ai/adapters/gemini-adapter.js                │   │
│  │ • Rideshare Coach: gemini-3.1-pro-preview (streaming, vision, search)  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Google Gemini 3.0 Flash (Offer Analysis — Vision)              │   │
│  │ • Role: OFFER_ANALYZER (gemini-3-flash-preview)                 │   │
│  │ • SDK: @google/genai (API key auth, NOT Vertex AI)              │   │
│  │ • Extracts ride offer data from screenshots (<3s response)      │   │
│  │ • Fallback: GPT-5.2 if Google is down                          │   │
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
3. Consolidator — STRATEGY_TACTICAL role (model: see registry)
   └─ strategies.strategy_for_now ✓ (NOW strategy — sole live strategy output)
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
| `/co-pilot/strategy` | StrategyPage.tsx | CoPilotContext (strategy, blocks), AICoach |
| `/co-pilot/bars` | VenueManagerPage.tsx | `/api/venues/nearby`, BarsDataGrid |
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
  ├─→ intercepted_signals (legacy — migrated to offer_intelligence)
  ├─→ offer_intelligence (structured offer analysis, 30+ ML columns)
  │     └─→ Real-time offer decisions from headless clients (text + vision)
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

venue_catalog (persistent venue store with Google place_id)
  └─→ Cache-first pattern: checks DB before calling Places API
  └─→ Haiku AI quality tier classification (premium/standard)

discovered_events (global event repository)
  └─→ venue_events (venue-event associations, stores place_id)

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
3. **Dual Auth Model:** JWT for app users, device_id for headless Siri clients
4. **Domain-Organized APIs:** server/api/* folders by domain (auth, briefing, chat, etc.)
5. **Model-Agnostic Providers:** Each AI role is pluggable via adapters (model-registry.js)
6. **Enrichment Pipeline:** Google APIs provide verified data + place_id stored
7. **Venue Persistence:** venue_catalog with cache-first pattern reduces API costs
8. **Snapshot-Centric:** All data scoped to snapshot_id for ML traceability
9. **Real-Time Updates:** SSE for briefing_ready, strategy_ready, blocks_ready
10. **Fail-Closed:** Missing data returns null/404, never hallucinated defaults
11. **Global Markets:** 102 pre-stored markets (31 US + 71 international) skip Google Timezone API
12. **Two-Phase UI Update:** Weather/AQI display before city/state resolution completes
13. **ML-Ready Offer Data:** offer_intelligence table with 30+ indexed columns for analytics
14. **Vision + Text Dual-Mode:** Siri Shortcuts support OCR text and direct image analysis

---

## 📋 OPEN ITEMS & TODOs

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Shortcut user onboarding flow | Needs design | Melody testing Siri Shortcuts before release |
| 2 | GreetingBanner: show holiday + greeting together | UI fix needed | Currently shows one OR the other |
| 3 | Daypart mismatch: getGreeting() (3 periods) vs classifyDayPart() (7) | Review needed | GreetingBanner vs GlobalHeader inconsistency |
| 4 | OpenAI Realtime voice for AICoach | Integrated, disabled | Functions prefixed with `_`, needs activation |
| 5 | Capture AICoach uploaded images for ML training | Feature idea | Heatmaps/surge maps could train models |
| 6 | Consider email-based auth for headless clients | Future | Would replace device_id once onboarding is mature |

---

**End of System Map**