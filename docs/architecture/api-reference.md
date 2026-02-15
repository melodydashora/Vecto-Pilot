Here is the updated documentation including the new **Automation & Hooks** section for the `analyze-offer` endpoint.


# API Reference

Complete frontend → backend API endpoint reference.

## Core Endpoints

### Strategy & Venues

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/blocks-fast` | POST | `server/api/strategy/blocks-fast.js` | Full TRIAD pipeline (strategy + venues) |
| `/api/blocks-fast` | GET | `server/api/strategy/blocks-fast.js` | Retrieve existing blocks (generates if missing) |
| `/api/blocks/strategy/:id` | GET | `server/api/strategy/content-blocks.js` | Fetch strategy content blocks |
| `/api/strategy/:snapshotId` | GET | `server/api/strategy/strategy.js` | Fetch strategy for snapshot |
| `/api/strategy/daily/:snapshotId` | POST | `server/api/strategy/daily.js` | On-demand daily strategy (user-triggered) |

#### Strategy API Details (Updated 2026-01-14)

**POST /api/blocks-fast**

Triggers the full TRIAD pipeline:
1. Phase 1 (Resolving): Location validation
2. Phase 2 (Analyzing): Briefing generation (Gemini with Google Search)
3. Phase 3 (Immediate): GPT-5.2 immediate strategy
4. Phase 4 (Venues): SmartBlocks generation + Google enrichment

**Response Fields:**
- `status`: ok | pending | pending_blocks | running | failed
- `blocks[]`: Array of venue recommendations (camelCase)
- `strategy.strategyForNow`: Immediate 1hr strategy
- `strategy.consolidated`: Daily strategy (if generated)
- `audit[]`: Pipeline execution trace

**Staleness Detection (2026-01-10):**
- Strategies older than 30 minutes with incomplete status are automatically reset
- Prevents serving stale cached data from interrupted sessions

**GET /api/blocks-fast**

Returns 202 with `reason: strategy_pending` until immediate strategy is ready.
Strategy-first gating ensures blocks are not generated until strategy_for_now exists.

### Location & GPS

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/location/resolve` | POST | `server/api/location/location.js` | Resolve GPS → address + user_id |
| `/api/location/weather` | GET | `server/api/location/location.js` | Current weather for location |
| `/api/location/airquality` | GET | `server/api/location/location.js` | Air quality index for location |
| `/api/location/snapshot` | POST | `server/api/location/location.js` | Create location snapshot |
| `/api/geocode/reverse` | GET | `server/api/location/location.js` | Reverse geocode coordinates |
| `/api/timezone` | GET | `server/api/location/location.js` | Get timezone for coordinates |
| `/api/users/me` | GET | `server/api/location/location.js` | Get current user data |
| `/api/snapshot/:id` | GET | `server/api/location/snapshot.js` | Fetch snapshot by ID |

### Briefing Data

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/briefing/weather/:snapshotId` | GET | `server/api/briefing/briefing.js` | Weather briefing data |
| `/api/briefing/traffic/:snapshotId` | GET | `server/api/briefing/briefing.js` | Traffic conditions data |
| `/api/briefing/events/:snapshotId` | GET | `server/api/briefing/briefing.js` | Local events (7-day window, timezone-aware) |
| `/api/briefing/events/:snapshotId?filter=active` | GET | `server/api/briefing/briefing.js` | Events happening NOW (active filter) |
| `/api/briefing/rideshare-news/:snapshotId` | GET | `server/api/briefing/briefing.js` | Rideshare-relevant news |
| `/api/briefing/school-closures/:snapshotId` | GET | `server/api/briefing/briefing.js` | School/college closures |
| `/api/briefing/airport/:snapshotId` | GET | `server/api/briefing/briefing.js` | Airport delays and conditions |
| `/api/briefing/refresh-daily/:snapshotId` | POST | `server/api/briefing/briefing.js` | On-demand refresh of events + news (daily data) |

### Chat & Voice

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/chat` | POST | `server/api/chat/chat.js` | AI Coach chat with SSE streaming + action parsing |
| `/api/chat/notes` | POST | `server/api/chat/chat.js` | Save a coach note about the user |
| `/api/chat/notes` | GET | `server/api/chat/chat.js` | Get user's coach notes |
| `/api/chat/notes/:noteId` | DELETE | `server/api/chat/chat.js` | Delete a coach note (soft delete) |
| `/api/chat/context/:snapshotId` | GET | `server/api/chat/chat.js` | Get full context for strategy coach |
| `/api/chat/conversations` | GET | `server/api/chat/chat.js` | List all conversations for user |
| `/api/chat/conversations/:conversationId` | GET | `server/api/chat/chat.js` | Get messages for a conversation |
| `/api/chat/conversations/:messageId/star` | POST | `server/api/chat/chat.js` | Toggle star on a message |
| `/api/chat/history` | GET | `server/api/chat/chat.js` | Get all conversation history |
| `/api/chat/system-notes` | GET | `server/api/chat/chat.js` | Get AI system observations |
| `/api/chat/deactivate-news` | POST | `server/api/chat/chat.js` | Deactivate a news item for user |
| `/api/chat/deactivated-news` | GET | `server/api/chat/chat.js` | Get deactivated news hashes |
| `/api/chat/deactivate-event` | POST | `server/api/chat/chat.js` | Deactivate an event for user |
| `/api/chat/snapshot-history` | GET | `server/api/chat/chat.js` | Get user's location snapshot history |
| `/api/realtime/token` | GET | `server/api/chat/realtime.js` | OpenAI Realtime API token for voice |
| `/api/tts` | POST | `server/api/chat/tts.js` | Text-to-speech generation |

#### AI Coach Action Parsing

The `/api/chat` POST endpoint parses special action tags from AI responses and executes them:

| Action Tag | Purpose | Example |
|------------|---------|---------|
| `[SAVE_NOTE: {...}]` | Save coach note about user | `[SAVE_NOTE: {"type": "preference", "title": "Airport runs", "content": "Prefers DFW"}]` |
| `[SYSTEM_NOTE: {...}]` | AI-generated observation | `[SYSTEM_NOTE: {"type": "pain_point", "title": "...", "description": "..."}]` |
| `[DEACTIVATE_NEWS: {...}]` | Hide news item for user | `[DEACTIVATE_NEWS: {"news_title": "Article Title", "reason": "outdated"}]` |
| `[DEACTIVATE_EVENT: {...}]` | Deactivate event (title-based lookup) | `[DEACTIVATE_EVENT: {"event_title": "Event Name", "reason": "event_ended"}]` |
| `[REACTIVATE_EVENT: {...}]` | Undo mistaken event deactivation | `[REACTIVATE_EVENT: {"event_title": "Event Name", "reason": "wrong date assumed"}]` |
| `[ZONE_INTEL: {...}]` | Crowd-sourced zone learning | `[ZONE_INTEL: {"zone_type": "dead_zone", "zone_name": "Airport Cellphone Lot", "reason": "No rides here after 10pm"}]` |

**Date/Time Awareness:** The Coach receives the user's local date/time in the system prompt (e.g., "Wednesday, January 1, 2026 at 11:45 PM") to prevent date-related mistakes when deactivating events.

**Zone Intelligence Types:**
- `dead_zone` - Areas with no ride requests
- `danger_zone` - Unsafe areas to avoid
- `honey_hole` - High-earnings sweet spots
- `surge_trap` - Fake surges that don't convert
- `staging_spot` - Good waiting spots
- `event_zone` - Event-related hotspots

**Cross-Driver Learning:** Zone intel is aggregated across drivers in the same market. Confidence scores increase when multiple drivers report the same zone.

### Feedback & Actions

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/feedback/venue` | POST | `server/api/feedback/feedback.js` | Venue thumbs up/down feedback |
| `/api/feedback/strategy` | POST | `server/api/feedback/feedback.js` | Strategy thumbs up/down feedback |
| `/api/feedback/app` | POST | `server/api/feedback/feedback.js` | General app feedback |
| `/api/actions` | POST | `server/api/feedback/actions.js` | Log user actions (view, select, navigate) |

### Venue Intelligence

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/closed-venue-reasoning` | POST | `server/api/venue/closed-venue-reasoning.js` | AI reasoning for closed venues |
| `/api/venues/:placeId` | GET | `server/api/venue/venue-intelligence.js` | Get venue details |

### Authentication

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/auth/register` | POST | `server/api/auth/auth.js` | Create new driver account |
| `/api/auth/login` | POST | `server/api/auth/auth.js` | Login with email/password |
| `/api/auth/verify-email` | POST | `server/api/auth/auth.js` | Verify email with code |
| `/api/auth/resend-verification` | POST | `server/api/auth/auth.js` | Resend verification email |
| `/api/auth/forgot-password` | POST | `server/api/auth/auth.js` | Request password reset |
| `/api/auth/reset-password` | POST | `server/api/auth/auth.js` | Reset password with token |
| `/api/auth/me` | GET | `server/api/auth/auth.js` | Get current user profile |
| `/api/auth/profile` | PUT | `server/api/auth/auth.js` | Update driver profile |
| `/api/auth/token` | POST | `server/api/auth/auth.js` | **DISABLED** - Legacy token endpoint |

### Health & Diagnostics

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/` | GET | `server/api/health/health.js` | Basic health check |
| `/health` | GET | `server/api/health/health.js` | Detailed health with DB/API status |
| `/ready` | GET | `server/api/health/health.js` | Kubernetes readiness probe |
| `/api/diagnostic/identity` | GET | `server/api/health/diagnostic-identity.js` | System identity check |

### Coach API (Added 2026-02-01)

AI Coach endpoints for notes, schema discovery, and data validation.

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/coach/notes` | GET | `server/api/coach/notes.js` | List user's coach notes |
| `/api/coach/notes/:id` | GET | `server/api/coach/notes.js` | Get specific note |
| `/api/coach/notes` | POST | `server/api/coach/notes.js` | Create new note |
| `/api/coach/notes/:id` | PUT | `server/api/coach/notes.js` | Update note |
| `/api/coach/notes/:id` | DELETE | `server/api/coach/notes.js` | Soft delete note |
| `/api/coach/notes/:id/pin` | POST | `server/api/coach/notes.js` | Pin/unpin note |
| `/api/coach/notes/:id/restore` | POST | `server/api/coach/notes.js` | Restore deleted note |
| `/api/coach/notes/stats/summary` | GET | `server/api/coach/notes.js` | Notes statistics |
| `/api/coach/schema` | GET | `server/api/coach/schema.js` | Full database schema info |
| `/api/coach/schema/tables` | GET | `server/api/coach/schema.js` | List available tables |
| `/api/coach/schema/table/:name` | GET | `server/api/coach/schema.js` | Get table schema details |
| `/api/coach/schema/prompt` | GET | `server/api/coach/schema.js` | Schema formatted for AI prompts |
| `/api/coach/validate` | POST | `server/api/coach/validate.js` | Validate data against schema |
| `/api/coach/validate/schemas` | GET | `server/api/coach/validate.js` | Get validation schemas |
| `/api/coach/validate/batch` | POST | `server/api/coach/validate.js` | Batch validation |
| `/api/coach/validate/event` | POST | `server/api/coach/validate.js` | Validate event data |
| `/api/coach/validate/venue` | POST | `server/api/coach/validate.js` | Validate venue data |

### Intelligence API (Added 2026-02-01)

Market intelligence endpoints for rideshare strategy research.

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/intelligence` | GET | `server/api/intelligence/intelligence.js` | List all intelligence records |
| `/api/intelligence/markets` | GET | `server/api/intelligence/intelligence.js` | List markets with intel |
| `/api/intelligence/markets-dropdown` | GET | `server/api/intelligence/intelligence.js` | Markets for dropdown UI |
| `/api/intelligence/for-location` | GET | `server/api/intelligence/intelligence.js` | Intel for specific location |
| `/api/intelligence/market/:slug` | GET | `server/api/intelligence/intelligence.js` | Market details by slug |
| `/api/intelligence/coach/:market` | GET | `server/api/intelligence/intelligence.js` | Coach-ready intel for market |
| `/api/intelligence/staging-areas` | GET | `server/api/intelligence/intelligence.js` | Staging area recommendations |
| `/api/intelligence/:id` | GET | `server/api/intelligence/intelligence.js` | Specific intel record |
| `/api/intelligence` | POST | `server/api/intelligence/intelligence.js` | Create intel record |
| `/api/intelligence/add-market` | POST | `server/api/intelligence/intelligence.js` | Add market intelligence |
| `/api/intelligence/:id` | PUT | `server/api/intelligence/intelligence.js` | Update intel record |
| `/api/intelligence/:id` | DELETE | `server/api/intelligence/intelligence.js` | Delete intel record |

### Platform API (Added 2026-02-01)

Platform statistics and market data endpoints.

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/platform/stats` | GET | `server/api/platform/platform.js` | Platform statistics |
| `/api/platform/markets` | GET | `server/api/platform/platform.js` | List all markets |
| `/api/platform/markets/:market` | GET | `server/api/platform/platform.js` | Market details |
| `/api/platform/countries` | GET | `server/api/platform/platform.js` | List countries |
| `/api/platform/countries-dropdown` | GET | `server/api/platform/platform.js` | Countries for dropdown UI |
| `/api/platform/regions-dropdown` | GET | `server/api/platform/platform.js` | Regions for dropdown UI |
| `/api/platform/markets-dropdown` | GET | `server/api/platform/platform.js` | Markets for dropdown UI |
| `/api/platform/search` | GET | `server/api/platform/platform.js` | Search markets/cities |
| `/api/platform/city/:city` | GET | `server/api/platform/platform.js` | City details |

### Automation & Hooks (Added 2026-02-15)

Endpoints designed for external automation tools (Siri Shortcuts, Mobile Automation).

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/hooks/analyze-offer` | POST | `server/api/hooks/analyze-offer.js` | Real-time ride offer analysis |

#### Offer Analysis Details

**POST /api/hooks/analyze-offer**

High-speed endpoint for analyzing rideshare offers via Siri Shortcuts.

- **Authentication:** Public (No JWT required) to accommodate Siri limitations.
- **Performance:** Uses `OFFER_ANALYZER` (Gemini 3 Flash) for 1-3s response times.
- **Real-time:** Broadcasts analysis results via `pg_notify` to the web frontend (SSE).
- **Location:** Captures driver coordinates (rounded to 3 decimals) to derive market context.

**Request Body:**
json
{
  "text": "OCR text content...",
  "image": "base64...",
  "device_id": "user_device_uuid",
  "latitude": 30.267,
  "longitude": -97.743,
  "source": "siri_shortcut"
}


**Response:**
Returns `decision` (ACCEPT/REJECT), `reasoning`, and parsed data optimized for notification display.

## Authentication

All API calls should include the JWT token:

javascript
const headers = {
  'Authorization': `Bearer ${localStorage.getItem('vectopilot_auth_token')}`,
  'Content-Type': 'application/json'
};


## Error Responses

Standard error format:

json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {}
}


Common HTTP codes:
- `400` - Bad request / validation error
- `401` - Unauthorized (missing/invalid token)
- `404` - Resource not found
- `429` - Rate limited
- `500` - Internal server error
- `504` - Gateway timeout (AI processing took too long)

## Timezone Handling (2026-01-15)

**Events endpoints use snapshot timezone, not UTC.**

When querying events by date, the API uses the user's timezone from `snapshot.timezone` to calculate "today":

javascript
// Uses user's timezone to avoid events "disappearing" at night
const today = new Date().toLocaleDateString('en-CA', { timeZone: snapshot.timezone });


**Why?** At 8:20 PM CST, UTC is already the next day. Using UTC would cause events dated "today" (local) to not match the UTC "tomorrow" filter.

Affected endpoints:
- `GET /api/briefing/events/:snapshotId`
- `GET /api/briefing/discovered-events/:snapshotId`

## Related Documentation

For more comprehensive API documentation including external APIs, database queries, and LLM patterns, see:

- **[APICALL.md](/APICALL.md)** - Full API call documentation (external APIs, LLM providers, circuit breakers)
- **[database-schema.md](./database-schema.md)** - Database table schemas and relationships
- **[ai-pipeline.md](./ai-pipeline.md)** - AI model pipeline and provider details