
# API Call Documentation

## External API Calls

### Google Maps APIs

#### Geocoding API
- **Files**: 
  - [server/lib/geo/geocoding.js](/server/lib/geo/geocoding.js)
  - [server/routes/location.js](/server/routes/location.js)
- **Endpoints**:
  - `https://maps.googleapis.com/maps/api/geocode/json` (reverse geocoding)
  - `https://maps.googleapis.com/maps/api/geocode/json` (forward geocoding)
- **Purpose**: Convert coordinates to addresses and vice versa
- **UI Location**: GlobalHeader (displays city name like "Frisco, TX"), Manual city search input

#### Google Maps Timezone API
- **Files**: [server/routes/location.js](/server/routes/location.js)
- **Endpoints**: `https://maps.googleapis.com/maps/api/timezone/json`
- **Purpose**: Get timezone information for coordinates
- **UI Location**: Used internally for time-based calculations, not directly displayed

#### Google Places API (New)
- **Files**: 
  - [server/lib/venues/venue-enrichment.js](/server/lib/venues/venue-enrichment.js)
  - [server/lib/venues/places-hours.js](/server/lib/venues/places-hours.js)
- **Endpoints**: 
  - `https://places.googleapis.com/v1/places:searchNearby`
  - `https://places.googleapis.com/v1/places/{placeId}`
- **Purpose**: Get place details, business hours, and venue information
- **UI Location**: SmartBlocks venue cards (hours, status), BarsTable, MapTab venue details

#### Google Routes API
- **Files**: [server/lib/routes/routes-api.js](/server/lib/routes/routes-api.js)
- **Endpoints**: 
  - `https://routes.googleapis.com/directions/v2:computeRoutes`
  - `https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix`
- **Purpose**: Calculate traffic-aware distances and ETAs
- **UI Location**: SmartBlocks venue cards (drive time display), MapTab route visualization

#### Google Air Quality API
- **Files**: [server/routes/location.js](/server/routes/location.js)
- **Endpoints**: `https://airquality.googleapis.com/v1/currentConditions:lookup`
- **Purpose**: Get current air quality index
- **UI Location**: GlobalHeader (displays "AQI 83"), BriefingTab air quality section

#### Google Geolocation API
- **Files**: [client/src/hooks/useGeoPosition.tsx](/client/src/hooks/useGeoPosition.tsx)
- **Endpoints**: `https://www.googleapis.com/geolocation/v1/geolocate`
- **Purpose**: Browser fallback for GPS coordinates
- **UI Location**: Triggers GlobalHeader location update when browser GPS unavailable

### Weather API

#### OpenWeather API
- **Files**: [server/routes/location.js](/server/routes/location.js)
- **Endpoints**: `https://api.openweathermap.org/data/2.5/weather`
- **Purpose**: Get current weather conditions
- **UI Location**: GlobalHeader (displays "69°F"), BriefingTab weather section

### LLM APIs

#### Anthropic (Claude)
- **Files**:
  - [server/lib/ai/adapters/anthropic-adapter.js](/server/lib/ai/adapters/anthropic-adapter.js)
  - [server/api/chat/chat.js](/server/api/chat/chat.js)
  - [server/eidolon/core/llm.ts](/server/eidolon/core/llm.ts)
- **Endpoints**: `https://api.anthropic.com/v1/messages`
- **Models**:
  - `claude-opus-4-6` (primary — STRATEGY_CORE, BRIEFING_EVENTS_VALIDATOR)
- **Purpose**: Strategic analysis, event validation, code assistance
- **UI Location**: StrategyPage strategy display, event validation pipeline

#### OpenAI (GPT-5.2)
- **Files**:
  - [server/lib/ai/adapters/openai-adapter.js](/server/lib/ai/adapters/openai-adapter.js)
  - [server/lib/strategy/planner-gpt5.js](/server/lib/strategy/planner-gpt5.js)
- **Endpoints**: `https://api.openai.com/v1/chat/completions`
- **Models**:
  - `gpt-5.2` (primary — STRATEGY_TACTICAL, VENUE_SCORER, UTIL_MARKET_PARSER)
- **Purpose**: Tactical venue planning, strategy consolidation, venue scoring
- **UI Location**: SmartBlocks venue recommendations, BarsTable venue list

#### Google Gemini
- **Files**:
  - [server/lib/ai/adapters/gemini-adapter.js](/server/lib/ai/adapters/gemini-adapter.js)
  - [server/lib/ai/providers/](/server/lib/ai/providers/)
- **Endpoints**: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- **Models**:
  - `gemini-3-pro-preview` (primary — 9 BRIEFING_* roles, COACH_CHAT, DOCS_GENERATOR)
  - `gemini-3-flash-preview` (fallback, low-cost tasks)
- **Purpose**: News briefing, event discovery, traffic analysis, coach chat, docs generation
- **UI Location**: BriefingTab (news, traffic, events sections), CoachChat, SmartBlocks

#### Perplexity API
- **Files**: 
  - [server/lib/adapters/perplexity.js](/server/lib/adapters/perplexity.js)
  - [server/lib/enrichment/perplexity-research.js](/server/lib/enrichment/perplexity-research.js)
  - [server/lib/venues/venue-event-research.js](/server/lib/venues/venue-event-research.js)
- **Endpoints**: `https://api.perplexity.ai/chat/completions`
- **Models**: `sonar-pro`
- **Purpose**: Real-time event research, internet-powered search
- **UI Location**: BriefingTab events section, EventsComponent event details

### Aviation APIs

#### FAA ASWS (Airport Status Web Service)
- **Files**: [server/lib/integrations/faa-asws.js](/server/lib/integrations/faa-asws.js)
- **Endpoints**: 
  - `https://nasstatus.faa.gov/api/airport-status-information` (public)
  - `https://external-api.faa.gov/asws/api/airport/status/{code}` (authenticated)
- **Purpose**: Flight delays, ground stops, weather at airports
- **UI Location**: BriefingTab airport conditions section (shows DFW/DAL status)

---

## Internal API Routes

### Location & Snapshot Routes

#### `/api/location/*` - Location Services
- **File**: [server/routes/location.js](/server/routes/location.js)
- **Endpoints**:
  - `GET /api/location/geocode/reverse` - Reverse geocoding
  - `GET /api/location/geocode/forward` - Forward geocoding
  - `GET /api/location/timezone` - Get timezone
  - `GET /api/location/resolve` - Combined geocoding + timezone
  - `GET /api/location/weather` - Weather conditions
  - `GET /api/location/airquality` - Air quality data
  - `POST /api/location/snapshot` - Save location snapshot

#### `/api/snapshot` - Snapshot Management
- **File**: [server/routes/snapshot.js](/server/routes/snapshot.js)
- **Endpoints**:
  - `POST /api/snapshot` - Create snapshot

### Strategy & Planning Routes

#### `/api/strategy/*` - Strategy Engine
- **File**: [server/routes/strategy.js](/server/routes/strategy.js)
- **Endpoints**:
  - `GET /api/strategy/:snapshotId` - Get strategy
  - `POST /api/strategy/seed` - Initialize strategy row
  - `POST /api/strategy/run/:snapshotId` - Trigger strategy generation

#### `/api/blocks/*` - Smart Blocks (Venue Recommendations)
- **Files**: 
  - [server/routes/blocks.js](/server/routes/blocks.js)
  - [server/routes/blocks-fast.js](/server/routes/blocks-fast.js)
- **Endpoints**:
  - `POST /api/blocks` - Get venue recommendations
  - `GET /api/blocks/strategy/:snapshotId` - Get strategy for snapshot

### Chat & Coach Routes

#### `/api/chat` - AI Strategy Coach
- **File**: [server/api/chat/chat.js](/server/api/chat/chat.js)
- **DAL**: [server/lib/ai/coach-dal.js](/server/lib/ai/coach-dal.js)
- **Endpoints**:
  - `POST /api/chat` - Chat with AI coach (streaming + action parsing)
  - `GET /api/chat/context/:snapshotId` - Get snapshot context
  - `GET /api/chat/notes` - Get user's coach notes
  - `POST /api/chat/notes` - Save a coach note
  - `DELETE /api/chat/notes/:noteId` - Delete a coach note
  - `GET /api/chat/conversations` - List all conversations
  - `GET /api/chat/conversations/:id` - Get conversation messages
  - `POST /api/chat/conversations/:id/star` - Toggle star on message
  - `GET /api/chat/system-notes` - Get AI system observations
  - `POST /api/chat/deactivate-news` - Deactivate news item
  - `POST /api/chat/deactivate-event` - Deactivate event
  - `GET /api/chat/snapshot-history` - Get location history

##### AI Coach Action Parsing
The chat endpoint parses special action tags from AI responses:

| Action Tag | Table | Purpose |
|------------|-------|---------|
| `[NOTE: {...}]` | `coach_notes` | Save note about user |
| `[SYSTEM_NOTE: {...}]` | `coach_system_notes` | AI-generated observation |
| `[DEACTIVATE_NEWS: {...}]` | `news_deactivations` | Hide news for user |
| `[DEACTIVATE_EVENT: {...}]` | `event_deactivations` | Hide event for user |
| `[ZONE_INTEL: {...}]` | `zone_intelligence` | Crowd-sourced zone learning |

##### Zone Intelligence (Cross-Driver Learning)
- **Table**: `zone_intelligence`
- **Zone Types**: `dead_zone`, `danger_zone`, `honey_hole`, `surge_trap`, `staging_spot`, `event_zone`
- **Algorithm**: Confidence score increases (+10, max 95) when multiple drivers report same zone
- **Market Isolation**: Zone data is scoped by `market_slug` (e.g., "dallas-tx")

### Feedback Routes

#### `/api/feedback/*` - User Feedback
- **File**: [server/routes/feedback.js](/server/routes/feedback.js)
- **Endpoints**:
  - `POST /api/feedback/venue` - Venue feedback
  - `GET /api/feedback/venue/summary` - Venue feedback summary
  - `POST /api/feedback/strategy` - Strategy feedback
  - `POST /api/feedback/app` - App feedback

### Actions & Analytics Routes

#### `/api/actions` - User Action Tracking
- **File**: [server/routes/actions.js](/server/routes/actions.js)
- **Endpoints**:
  - `POST /api/actions` - Log user actions (clicks, dwells, views)

### Research Routes

#### `/api/research/*` - Internet Research
- **File**: [server/routes/research.js](/server/routes/research.js)
- **Endpoints**:
  - `GET /api/research/search` - Quick research query
  - `POST /api/research/deep` - Deep research topic

### Health & Diagnostics Routes

#### `/health` - Health Checks
- **File**: [server/routes/health.js](/server/routes/health.js)
- **Endpoints**:
  - `GET /health` - Basic health check
  - `GET /ready` - Readiness check
  - `GET /health/pool-stats` - PostgreSQL pool statistics
  - `GET /health/strategies` - Strategy provider health

#### `/api/diagnostics/*` - System Diagnostics
- **Files**: 
  - [server/routes/diagnostics.js](/server/routes/diagnostics.js)
  - [server/routes/diagnostics-strategy.js](/server/routes/diagnostics-strategy.js)
- **Endpoints**:
  - `GET /api/diagnostics` - System diagnostics
  - `GET /api/diagnostics/strategy/:snapshotId` - Strategy diagnostics

---

## Database Queries

### PostgreSQL via Drizzle ORM
- **Files**: 
  - [server/db/drizzle.js](/server/db/drizzle.js)
  - [server/db/client.js](/server/db/client.js)
  - [server/db/pool.js](/server/db/pool.js)
- **Tables Accessed**:
  - `snapshots` - Location snapshots
  - `strategies` - AI-generated strategies
  - `rankings` - Venue rankings
  - `ranking_candidates` - Individual venue candidates
  - `venue_catalog` - Venue database
  - `venue_metrics` - Venue performance metrics
  - `actions` - User action logs
  - `venue_feedback` - Venue feedback
  - `strategy_feedback` - Strategy feedback
  - `app_feedback` - App feedback
  - `events_facts` - Event data
  - `places_cache` - Cached place data
  - `briefings` - News briefings
  - `llm_venue_suggestions` - LLM-suggested venues
  - `eidolon_memory` - Eidolon memory store
  - `assistant_memory` - Assistant memory
  - `coach_conversations` - AI Coach chat history (with `market_slug`)
  - `coach_notes` - User notes from AI Coach
  - `coach_system_notes` - AI-generated observations
  - `news_deactivations` - Hidden news items
  - `event_deactivations` - Hidden events
  - `zone_intelligence` - Crowd-sourced zone learning (cross-driver)

### Direct SQL Queries
- **Files**:
  - [server/lib/ai/coach-dal.js](/server/lib/ai/coach-dal.js) - Coach data access (notes, conversations, zone intel)
  - [server/lib/providers/briefing.js](/server/lib/providers/briefing.js) - Briefing queries
  - [server/routes/actions.js](/server/routes/actions.js) - Metrics updates
  - [scripts/database/postdeploy-sql.mjs](/scripts/database/postdeploy-sql.mjs) - Migration runner

---

## Agent & Extension APIs

### Agent Server Routes
- **File**: [server/agent/routes.js](/server/agent/routes.js)
- **Endpoints**:
  - `GET /context` - Get thread-aware context
  - `GET /context/summary` - Workspace analysis summary
  - `POST /thread/init` - Initialize thread
  - `GET /thread/:threadId` - Get thread context
  - `POST /thread/:threadId/message` - Add message to thread
  - `POST /thread/:threadId/decision` - Track decision
  - `GET /threads/recent` - Get recent threads
  - `POST /memory/preference` - Store user preference
  - `POST /memory/session` - Store session state
  - `POST /memory/project` - Store project state
  - `POST /memory/conversation` - Log conversation
  - `GET /memory/conversations` - Get conversations
  - `POST /search` - Internet search
  - `GET /config/list` - List config files
  - `GET /config/read/:filename` - Read config file
  - `POST /config/env/update` - Update env file
  - `POST /config/backup/:filename` - Backup config file

---

## LLM Router & Circuit Breakers

### Multi-Model Router
- **Files**: 
  - [server/lib/llm/llm-router.js](/server/lib/llm/llm-router.js)
  - [server/lib/llm/llm-router-v2.js](/server/lib/llm/llm-router-v2.js)
- **Features**:
  - Circuit breakers for each provider
  - Hedging (parallel requests)
  - Fallback chains
  - Timeout management

---

## Google Cloud Console — API Setup & Restrictions

**Last Updated:** 2026-02-15

This section documents how to configure Google Cloud Console for all Google APIs used by Vecto Pilot. Every API key must have both **application restrictions** (who can use it) and **API restrictions** (what it can call).

### Key Architecture: 3 Separate Keys

> **Rule:** Never share a key between client-side and server-side code. Use separate keys with separate restrictions.

| Key | Env Variable | Purpose | Application Restriction |
|-----|-------------|---------|------------------------|
| **Server Key** | `GOOGLE_MAPS_API_KEY` | All Google Maps Platform web services | IP addresses |
| **Client Key** | `VITE_GOOGLE_MAPS_API_KEY` | Maps JavaScript API (browser rendering) | HTTP referrers |
| **Gemini Key** | `GEMINI_API_KEY` | Generative Language API (AI calls) | IP addresses |

### APIs That Must Be Enabled

All APIs must be individually enabled in **APIs & Services > Library**. None are enabled by default.

| # | API Name in Console | Service Name | Used By |
|---|---------------------|-------------|---------|
| 1 | Geocoding API | `geocoding-backend.googleapis.com` | Reverse/forward geocoding |
| 2 | Time Zone API | `timezone-backend.googleapis.com` | Timezone lookup by coords |
| 3 | Places API (New) | `places.googleapis.com` | Venue search, hours, details |
| 4 | Routes API | `routes.googleapis.com` | Drive time, distance matrix |
| 5 | Air Quality API | `airquality.googleapis.com` | AQI lookup |
| 6 | Geolocation API | `geolocation.googleapis.com` | GPS fallback (server-side) |
| 7 | Maps JavaScript API | `maps.googleapis.com` | Map rendering in browser |
| 8 | Generative Language API | `generativelanguage.googleapis.com` | Gemini 3 Pro/Flash AI calls |

> **Important:** "Places API (New)" is a separate API from the legacy "Places API". Enable the **New** version.

### Server Key Configuration (`GOOGLE_MAPS_API_KEY`)

**Console path:** APIs & Services > Credentials > click key > "Restrict and rename API key"

```
Name: "Vecto Pilot Server Key"

Application restriction: IP addresses
  → Add your server's static outbound IP or CIDR range
  → For dynamic-IP platforms (Replit): see "Dynamic IP" note below

API restrictions: Restrict key → select:
  ☑ Geocoding API
  ☑ Time Zone API
  ☑ Places API (New)
  ☑ Routes API
  ☑ Air Quality API
  ☑ Geolocation API
```

### Client Key Configuration (`VITE_GOOGLE_MAPS_API_KEY`)

```
Name: "Vecto Pilot Client Key"

Application restriction: HTTP referrers (websites)
  → https://vectopilot.com/*
  → https://*.vectopilot.com/*
  → http://localhost:5000/*         (local dev)
  → http://localhost:5173/*         (Vite dev server)

API restrictions: Restrict key → select:
  ☑ Maps JavaScript API
  (nothing else — this key only needs Maps JS)
```

### Gemini Key Configuration (`GEMINI_API_KEY`)

```
Name: "Vecto Pilot Gemini Key"

Application restriction: IP addresses
  → Add your server's static outbound IP

API restrictions: Restrict key → select:
  ☑ Generative Language API
  (nothing else)
```

> **Note:** If the Gemini key was created in Google AI Studio, it may not appear in Cloud Console Credentials by default. AI Studio keys are linked to a GCP project — manage restrictions via that project's Cloud Console.

### Restriction Types Explained

There are **two distinct restriction layers** on every API key:

**1. Application Restrictions** (WHO can use the key) — pick one per key:

| Type | Use Case | Example |
|------|----------|---------|
| HTTP referrers | Client-side web apps | `*.vectopilot.com/*` |
| IP addresses | Server-side apps | `34.56.78.90/32` |
| Android apps | Mobile (Android) | Package name + SHA-1 |
| iOS apps | Mobile (iOS) | Bundle identifier |

**2. API Restrictions** (WHAT the key can call):
- "Don't restrict key" → key can call ANY enabled API (insecure)
- "Restrict key" → select specific APIs from dropdown (recommended)

> **Always apply BOTH types.** Application restrictions without API restrictions still let an attacker call any enabled API from a valid origin.

### Geolocation API — Client-Side Warning

Despite being used as a browser GPS fallback in the app, the Geolocation API is classified by Google as a **server-side web service**. HTTP referrer restrictions **will NOT work** — you'll get:

```
"API keys with referer restrictions cannot be used with this API."
```

**Solution:** The Geolocation API call should go through the server-side key. In the app, `useGeoPosition.tsx` calls this API — if used, it should proxy through the server or rely on `navigator.geolocation` (no API key needed) as the primary GPS method.

### Dynamic IP Environments (Replit, Cloud Run, etc.)

If your server runs on a platform with dynamic outbound IPs:

| Option | Security Level | Complexity |
|--------|---------------|------------|
| No application restriction + API restrictions only | Medium | Low |
| Static outbound IP via proxy/NAT gateway | High | Medium |
| OAuth 2.0 service accounts instead of API keys | Highest | High |

**For Replit:** Leave application restriction as "None" but **always** apply API restrictions. This still prevents the key from calling APIs you haven't selected.

### Pricing & Free Tiers

| API | Free Monthly | Cost per 1,000 (after free tier) |
|-----|-------------|----------------------------------|
| Geocoding API | 10,000 requests | $5.00 |
| Time Zone API | 10,000 requests | $5.00 |
| Places API (New) — basic details | 10,000 requests | $5.00 |
| Places API (New) — searchNearby | 5,000 requests | $32.00 |
| Places API (New) — hours/contact | 5,000 requests | $17.00 |
| Routes API — basic | 10,000 requests | $5.00 |
| Routes API — traffic-aware | 5,000 requests | $10.00 |
| Routes API — matrix (per element) | 10,000 elements | $5.00–$10.00 |
| Air Quality API | 10,000 requests | $5.00 |
| Geolocation API | 10,000 requests | $5.00 |
| Maps JavaScript API | 10,000 map loads | $7.00 |

> **Places API cost tip:** Always use `X-Goog-FieldMask` to request only needed fields. Requesting `id, displayName, formattedAddress` (Essentials tier @ $5) costs far less than requesting `reviews, rating, currentOpeningHours` (Enterprise tier @ $25).

> **Routes API billing note:** `computeRouteMatrix` is billed **per element** (origins × destinations), not per request. A 5×5 matrix = 25 elements = 25 billable events.

### Cost Protection Steps

1. **Set daily quota caps:** APIs & Services > each API > Quotas → set daily request limit
2. **Set billing alerts:** Billing > Budgets & alerts → alerts at $50, $100, $200
3. **Monitor usage:** APIs & Services > Dashboard → real-time usage per API
4. **Use field masks:** Places API pricing is determined by which fields you request

### Quick Setup Checklist

```
□ 1. Go to Google Cloud Console → APIs & Services → Library
□ 2. Enable all 8 APIs listed above
□ 3. Go to Credentials → Create API Key (×3: server, client, gemini)
□ 4. Configure Server Key:
      □ Application restriction: IP addresses (or None for Replit)
      □ API restrictions: 6 APIs (Geocoding, Timezone, Places New, Routes, Air Quality, Geolocation)
□ 5. Configure Client Key:
      □ Application restriction: HTTP referrers (your domains + localhost)
      □ API restrictions: Maps JavaScript API only
□ 6. Configure Gemini Key:
      □ Application restriction: IP addresses (or None for Replit)
      □ API restrictions: Generative Language API only
□ 7. Set env variables:
      □ GOOGLE_MAPS_API_KEY=<server key>
      □ VITE_GOOGLE_MAPS_API_KEY=<client key>
      □ GEMINI_API_KEY=<gemini key>
□ 8. Set billing alerts and daily quota caps
□ 9. Verify: run app and check that Maps, geocoding, and AI calls all work
```

---

## Summary Statistics

### External APIs
- **Google APIs**: 8 services (7 Maps Platform + Generative Language)
- **LLM Providers**: 4 (Anthropic, OpenAI, Google Gemini, Perplexity)
- **Weather/Aviation**: 2 APIs
- **Total External APIs**: 14
- **API Keys Required**: 3 (server, client, gemini)

### Internal APIs
- **HTTP Routes**: 35+ endpoints
- **Database Tables**: 15+ tables
- **WebSocket**: Strategy generation events

### Key Patterns
- **Circuit Breakers**: All external LLM calls
- **Caching**: Routes API, Geocoding API, Places API
- **Rate Limiting**: Feedback endpoints, geocoding proxy
- **Retry Logic**: LLM calls, database operations
- **Idempotency**: Action logging, snapshot creation
