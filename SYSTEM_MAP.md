# VECTO PILOT™ - COMPLETE SYSTEM MAP

**Last Updated:** 2026-04-30 UTC

This document provides a complete visual mapping of the Vecto Pilot system, showing how every component connects from UI to database and back.

> Per Rule 14 (model-agnostic adapter architecture), specific model versions are not enumerated here — consult `server/lib/ai/model-registry.js` for current model assignments. Hardcoded model names appearing in diagrams below are illustrative only.

---

## 📲 Offer Analyzer inputs and downstream data

> Analyzer section reconciled against source on 2026-09-29. Other diagrams retain
> historical system context; consult actual source before treating them as current.
> [Canonical Analyzer reference](docs/architecture/OFFER_ANALYZER.md).

```text
Signed-in browser capture          Configured native phone automation
current screenshot + precise GPS   OCR/image + shortcut token; GPS optional
                 \                 /
                  /api/hooks/analyze-offer
                  owner rules + selected-service provenance
                  parse/sanity -> numeric and model reconciliation
                              |
                  Phase 1 decision/voice + original timestamp
                              |
                  eligible in-process Phase 2 enrichment
                  trusted address/timezone resolution -> storage
                              |
              offer_intelligence -> owner SSE/history -> Coach evidence
                        |
              separate driver override / revisioned offer_outcomes
```

The shortcut token maps to an owner; `device_id` is telemetry, not identity, and a
headless request needs no browser login session. Anonymous defaults are marked
personally unverified; supplied invalid tokens/rules do not silently use defaults.
Current selected services are distinct from vehicle eligibility. Legacy-null selection
is unverified; explicit selections gate disabled/unknown service classification.

The quick browser page and downloaded Android launcher require screenshot selection;
they are not unattended cross-app capture. Both text and vision inputs enter Phase 1.
The original decision survives later deep-model dissent. A spoken result does not
prove a row was stored; Phase 2 has no durable queue and unresolved trusted timezone
prevents storage.

The authenticated editor owns rules, tokens, visible history, reversible removal and
explicit outcomes. Legacy hook history/override/cleanup require the owner token;
cleanup remains hard deletion. Coach reads owner rules, full recent offer records and
patterns; retired model-emitted offer mutations cannot overwrite capture evidence.

MAIN is a separate Continue → location/snapshot → briefing → Strategist → VenuePlanner
→ enrichment/output sequence. Admission pins settings for freshness checks. Current
MAIN prompt projection supplies profile/vehicle only; Analyzer integration is held for
later review. It does not consume offer history through that receipt.

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
│  │  Route-Based Pages (14 co-pilot + 5 auth + public pages +        │  │
│  │  SafeScaffold)                                                   │  │
│  │  ┌────────────────────────────────────────────────────────────┐  │  │
│  │  │ /co-pilot/strategy  → StrategyPage.tsx                     │  │  │
│  │  │   • AI strategy display                                    │  │  │
│  │  │   • Smart Blocks (NOW strategy: top 3 Grade A, ≥1mi apart) │  │  │
│  │  │   • Includes the venue map (former MapPage,                │  │  │
│  │  │     merged 2026-04-26)                                     │  │  │
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
│  │  │ /co-pilot/coach → CoachPage.tsx                            │  │  │
│  │  │   • AI Coach (streaming, vision, search — own route        │  │  │
│  │  │     since 2026-04-25)                                      │  │  │
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
│  │  ┌──────────────────────────────────────────────────────────────┐│  │
│  │  │ Offer Analyzer (server/api/offer-analyzer/)                  ││  │
│  │  │ • /api/offer-analyzer → index.js (per-driver rules, shortcut ││  │
│  │  │   token, offer history/outcomes — authed)                    ││  │
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
│  Additional tables: discovered_events, venue_events, market_intelligence,│
│                     platform_data, countries, auth tables,               │
│                     offer_rulesets, offer_outcomes, airports,            │
│                     schema_migrations                                    │
│                                                                          │
│  Per-user filtering is enforced in application queries                  │
│  (WHERE user_id = ...); RLS exists only on agent_memory                 │
└─────────────────────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         EXTERNAL AI/API SERVICES                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Anthropic adapter (registry-selected roles)               │   │
│  │ • File: server/lib/ai/adapters/anthropic-adapter.js             │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ OpenAI adapter (registry-selected roles and voice)            │   │
│  │ • File: server/lib/ai/adapters/openai-adapter.js                │   │
│  │ • Coach: active GPT live voice delegates to registry brain   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Google adapters (registry-selected extraction/briefing roles)  │   │
│  │ • File: server/lib/ai/adapters/gemini-adapter.js                │   │
│  │ • Coach has separate Responses/live paths; see chat README  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Offer Analysis (registry-selected role)              │   │
│  │ • Roles: OFFER_ANALYZER / OFFER_ANALYZER_DEEP      │   │
│  │ • SDK: @google/genai (API key auth, NOT Vertex AI)              │   │
│  │ • Screenshot/text + deterministic reconciliation; <3s goal │   │
│  │ • Model failure is not proof that judgment checks passed│   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Google APIs (Maps Platform)                                    │   │
│  │ • Places API, Routes API, Geocoding, Weather, AQ, Timezone     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 MAIN waterfall

The [source-linked pipeline trace](docs/architecture/ai-pipeline.md) is canonical:
explicit Continue → admitted configuration → fresh saved GPS snapshot → seven
parallel Briefing sections → complete saved Briefing → Strategist → venue planner
→ verified Places/Routes → atomic ranking publication → saved display.

The Strategist waits for Briefing; `minstrategy`, a separate active CORE stage and
an event-verifier model pass are not current stages. SSE signals readers to refetch
saved state. There is no fixed measured duration promised by this source map.
The [independent pipeline guide](docs/architecture/INDEPENDENT_PIPELINES.md) covers
horizontal lifecycles and the [Google API inventory](docs/architecture/google-cloud-apis.md)
distinguishes actual use from enabled console services.

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
| `/co-pilot/strategy` | StrategyPage.tsx | CoPilotContext (strategy, blocks) |
| `/co-pilot/bars` | VenueManagerPage.tsx | `/api/venues/nearby`, BarsDataGrid |
| `/co-pilot/briefing` | BriefingPage.tsx | useBriefingQueries (one aggregate, seven required sections) |
| `/co-pilot/intel` | IntelPage.tsx | RideshareIntelTab (static intelligence) |
| `/co-pilot/about` | AboutPage.tsx | Static (no API) |
| `/co-pilot/policy` | PolicyPage.tsx | Static (no API) |
| `/co-pilot/coach` | CoachPage.tsx | AI Coach (streaming, vision, search) |
| `/co-pilot/settings` | SettingsPage.tsx | Auth context, platform data APIs |

---

## 🗄️ TABLE DEPENDENCY GRAPH

```
users (session tracking, auth - NO location data)
  ├─→ auth_credentials (password hashes, refresh/reset tokens)
  ├─→ verification_codes (email/SMS codes)
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

markets (338 global markets with pre-stored timezones)
  └─→ 3,400+ city aliases for suburb/neighborhood matching

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
9. Database queries filtered by user_id in application WHERE clauses (RLS only on agent_memory)
   ↓
10. Response contains ONLY data for authenticated user
```

---

## 🎯 KEY TAKEAWAYS

1. **Single Source of Truth:** PostgreSQL database is authoritative for all data
2. **Route-Based UI:** React Router with 14 co-pilot routes + auth + public pages, shared CoPilotContext
3. **Dual Auth Model:** JWT for app users, owner shortcut token for headless capture; device_id is telemetry
4. **Domain-Organized APIs:** server/api/* folders by domain (auth, briefing, chat, etc.)
5. **Model-Agnostic Providers:** Each AI role is pluggable via adapters (model-registry.js)
6. **Enrichment Pipeline:** Google APIs provide verified data + place_id stored
7. **Venue Persistence:** venue_catalog with cache-first pattern reduces API costs
8. **Snapshot-Centric MAIN:** Snapshot-scoped strategy data; offers also have independent owner/capture-session scope
9. **Real-Time Updates:** SSE for briefing_ready, strategy_ready, blocks_ready
10. **Fail-Closed:** Missing data returns null/404, never hallucinated defaults
11. **Global Markets:** 338 pre-stored markets (267 US + 71 international) skip Google Timezone API
12. **Two-Phase UI Update:** Weather/AQI display before city/state resolution completes
13. **ML-Ready Offer Data:** offer_intelligence table with 30+ indexed columns for analytics
14. **Vision + Text Dual-Mode:** Siri Shortcuts support OCR text and direct image analysis

---

## 📋 OPEN ITEMS & TODOs

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Offer capture setup | Browser capture/token-free launcher and legacy native setup are distinct | Current physical-phone verification remains a gate; see Analyzer roadmap. |
| 2 | GreetingBanner: show holiday + greeting together | UI fix needed | Currently shows one OR the other |
| 3 | Daypart mismatch: getGreeting() (3 periods) vs classifyDayPart() (7) | Review needed | GreetingBanner vs GlobalHeader inconsistency |
| 4 | Coach voice | Active GPT live voice delegates to the brain | Legacy routes remain separate; see `server/api/chat/README.md`. |
| 5 | Capture AICoach uploaded images for ML training | Feature idea | Heatmaps/surge maps could train models |
| 6 | Headless owner identity | Shortcut token is implemented | device_id is not an authentication mechanism. |

---

**End of System Map**