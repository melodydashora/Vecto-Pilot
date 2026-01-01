
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
  - [server/lib/adapters/anthropic.js](/server/lib/adapters/anthropic.js)
  - [server/routes/chat.js](/server/routes/chat.js)
  - [server/eidolon/core/llm.ts](/server/eidolon/core/llm.ts)
- **Endpoints**: `https://api.anthropic.com/v1/messages`
- **Models**: 
  - `claude-sonnet-4-5-20250929` (primary)
- **Purpose**: Strategic analysis, chat responses, code assistance
- **UI Location**: StrategyCoach chat interface, StrategyPage strategy display

#### OpenAI (GPT-5)
- **Files**: 
  - [server/lib/adapters/openai.js](/server/lib/adapters/openai.js)
  - [server/lib/planning/gpt5-tactical-planner.js](/server/lib/planning/gpt5-tactical-planner.js)
  - [server/lib/venues/gpt5-venue-generator.js](/server/lib/venues/gpt5-venue-generator.js)
- **Endpoints**: `https://api.openai.com/v1/chat/completions`
- **Models**: 
  - `gpt-5` (tactical planning)
  - `o1-*` (reasoning models)
- **Purpose**: Tactical venue planning, coordinate generation
- **UI Location**: SmartBlocks venue recommendations, BarsTable venue list

#### Google Gemini
- **Files**: 
  - [server/lib/adapters/gemini.js](/server/lib/adapters/gemini.js)
  - [server/lib/enrichment/gemini-news-briefing.js](/server/lib/enrichment/gemini-news-briefing.js)
  - [server/lib/enrichment/gemini-enricher.js](/server/lib/enrichment/gemini-enricher.js)
- **Endpoints**: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- **Models**: 
  - `gemini-2.5-pro` (primary)
  - `gemini-2.0-flash-exp` (discovery)
- **Purpose**: News briefing, venue validation, earnings estimation
- **UI Location**: BriefingTab (news, traffic, events sections), SmartBlocks earnings estimates

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

## Summary Statistics

### External APIs
- **Google APIs**: 7 different services
- **LLM Providers**: 4 (Anthropic, OpenAI, Google, Perplexity)
- **Weather/Aviation**: 2 APIs
- **Total External APIs**: 13

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
