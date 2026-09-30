# API Routes Registry

API endpoint navigation organized by domain. Route mounts and handlers are the
source of truth; sections have different verification dates.

**Last Updated:** 2026-09-29

> The broad inventory was assembled on 2026-08-17. The 2026-09-29 pass refreshed
> Analyzer contracts and consolidated the small uppercase API reference: health
> authentication, location news entry, and Coach note deletion were checked against
> their current handlers. This is not a fresh verification of every listed route.

---

## Quick Reference

| Domain | Base Path | Auth | Purpose |
|--------|-----------|------|---------|
| Health | `/healthz`, `/health`, `/ready`, `/api/health` | No | Health probes |
| Diagnostics | `/api/diagnostics/*` | Auth + operator | Operator diagnostics |
| Location | `/api/location/*` | Yes | GPS, geocoding, weather |
| Strategy | `/api/blocks-fast`, `/api/strategy/*` | Yes | Briefing → Strategy → Blocks pipeline (single STRATEGY_TACTICAL strategy) |
| Briefing | `/api/briefing/*` | Yes | Events, traffic, news |
| Chat | `/api/chat/*` | Yes | Rideshare Coach |
| Voice | `/api/realtime/*`, `/api/tts` | **Yes** | Voice + TTS |
| Offer Analyzer (ingest) | `/api/hooks/analyze-offer` + `offer-history` / `offer-override` / `offer-cleanup` | Shortcut token (optional on ingest, required on the rest) | Phone-shortcut offer verdicts (`docs/architecture/OFFER_ANALYZER.md`) |
| Offer Analyzer (editor) | `/api/offer-analyzer/*` | Yes | Per-driver rules, shortcut token, offers + outcomes |
| Feedback | `/api/feedback/*`, `/api/actions` | Yes | User feedback |
| Auth | `/api/auth/*` | No | Token generation |
| Venue | `/api/venues/*` | Yes | Venue intelligence |

---

## Health and Diagnostics Endpoints

| Method | Path | Handler | Auth | Purpose |
|--------|------|---------|------|---------|
| GET | `/healthz` | `bootstrap/health.js` | No | SPA-ready health check |
| GET/HEAD | `/health`, `/ready` | `bootstrap/health.js` | No | Fast load-balancer probes |
| GET | `/api/health` | `health.js` | No | Minimal public liveness JSON |
| GET | `/api/health/details`, `/api/health/pool-stats`, `/api/health/metrics` | `health.js` | Yes | Internal health, database-pool and metrics details |
| GET | `/api/unified/capabilities` | `unified-capabilities.js` | No | AI model capabilities |
| GET | `/api/diagnostics` | `diagnostics.js` | Auth + operator | Database, provider, activity and storage diagnostics |
| GET | `/api/diagnostics/db-data` | `diagnostics.js` | Auth + operator | Recent database records for diagnosis |
| GET | `/api/diagnostic/identity` | `diagnostic-identity.js` | Yes | Identity debugging |
| GET | `/api/ml-health/health`, `/api/ml-health/memory/:scope`, `/api/ml-health/search` | `ml-health.js` | Yes | ML health, memory and search diagnostics |
| GET | `/api/job-metrics` (+ `/:jobId`) | `job-metrics.js` | Yes | Background job stats |

Sources: [early health mounts](../server/bootstrap/health.js),
[route mounts](../server/bootstrap/routes.js), and
[diagnostics guards](../server/api/health/diagnostics.js).

---

## Location Endpoints

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | `/api/location/resolve` | `location.js` | GPS → Address + timezone |
| GET | `/api/location/weather` | `location.js` | Current weather + forecast |
| GET | `/api/location/airquality` | `location.js` | AQI data |
| POST | `/api/location/snapshot` | `location.js` | Save location snapshot |
| POST | `/api/location/news-briefing` | `location.js` | Generate briefing for the authenticated driver's explicitly admitted snapshot/run |
| GET | `/api/snapshot/:id` | `snapshot.js` | Fetch snapshot data |

All `/api/location` routes use the router's authentication guard. The legacy
`news-briefing` entry also checks owned MAIN run/snapshot lineage before generation;
it is not an independent start trigger. See
[location routes](../server/api/location/location.js) and
[MAIN admission](../server/lib/main-run-admission.js).

---

## Strategy Endpoints

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| POST | `/api/blocks-fast` | `blocks-fast.js` | **Main entry** — trigger Briefing → Strategy → Blocks pipeline |
| GET | `/api/blocks-fast` | `blocks-fast.js` | Get blocks for snapshot |
| GET | `/api/blocks/strategy/:snapshotId` | `content-blocks.js` | Get strategy with timing metadata |
| GET | `/api/strategy/:snapshotId` | `strategy.js` | Get strategy status |
| GET | `/events/strategy` (also `/events/briefing`, `/events/blocks`, `/events/phase`, `/events/offers`) | `strategy-events.js` | SSE for progress updates |

### Pipeline Flow
```
POST /api/blocks-fast
    ↓
Phase 1: Briefing — parallel fetch (weather, traffic, events,
         news, schools, airport) → briefings table
    ↓
Phase 2: Immediate Strategy — STRATEGY_TACTICAL via
         server/lib/ai/providers/consolidator.js (runImmediateStrategy) → strategies.strategy_for_now
    ↓
Phase 3: Smart Blocks — VENUE_SCORER + Google Places +
         Google Routes → rankings, ranking_candidates
         → pg_notify('blocks_ready')
    ↓
Response: { strategy_for_now, blocks }
```


---

## Briefing Endpoints

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | `/api/briefing/weather/:snapshotId` | `briefing.js` | Weather briefing |
| GET | `/api/briefing/traffic/:snapshotId` | `briefing.js` | Traffic conditions |
| GET | `/api/briefing/rideshare-news/:snapshotId` | `briefing.js` | Rideshare news |
| GET | `/api/briefing/events/:snapshotId` | `briefing.js` | Local events |
| GET | `/api/briefing/school-closures/:snapshotId` | `briefing.js` | School closures |
| GET | `/events/briefing` | `strategy-events.js` | SSE stream for briefing updates |

---

## Chat Endpoints (Auth Required)

| Method | Path | Handler | Auth | Purpose |
|--------|------|---------|------|---------|
| POST | `/api/chat` | `chat.js` | Yes | Rideshare Coach (SSE streaming) |
| GET | `/api/chat/context/:snapshotId` | `chat.js` | Yes + snapshot ownership | Full coach context for a snapshot |
| POST/GET | `/api/chat/notes` | `chat.js` | Yes | Coach notes about the user |
| DELETE | `/api/chat/notes/:noteId` | `chat.js` | Yes + note ownership | Soft-delete the driver's note; unknown or foreign IDs return 404 |
| POST | `/api/chat/voice-turns` | `chat.js` | Yes (25/min) | Persist verbatim voice turns (learning loop) |
| GET | `/api/chat/conversations`, `/conversations/:conversationId`, `/history`, `/snapshot-history` | `chat.js` | Yes | Conversation + history reads |
| POST | `/api/chat/conversations/:messageId/star` | `chat.js` | Yes | Star a message |
| GET | `/api/chat/system-notes`, `/deactivated-news` | `chat.js` | Yes | Coach system notes / deactivated news |
| POST | `/api/chat/deactivate-news`, `/deactivate-event` | `chat.js` | Yes | Coach-driven deactivations |

Source for note deletion and conversation/context routes:
[chat router](../server/api/chat/chat.js).

## Coach API (`/api/coach/*`, Auth Required)

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | `/api/coach/schema`, `/schema/tables`, `/schema/prompt` | `rideshare-coach/schema.js` | Schema awareness for the Coach |
| POST | `/api/coach/validate`, `/validate/batch`; GET `/validate/schemas` | `rideshare-coach/validate.js` | Action-tag validation |
| GET/POST/PUT/DELETE | `/api/coach/notes` (+ `/:id`, `/:id/pin`, `/:id/restore`, `/stats/summary`) | `rideshare-coach/notes.js` | User notes CRUD |

---

## Voice Endpoints (Auth Required - API Cost)

| Method | Path | Handler | Auth | Purpose |
|--------|------|---------|------|---------|
| POST | `/api/realtime/token` | `chat/realtime.js` | **Yes** | OpenAI Realtime token mint |
| POST | `/api/gemini-live/token` | `chat/gemini-live.js` | **Yes** | Gemini Live token mint (the Coach's voice) |
| POST | `/api/tts` | `chat/tts.js` | **Yes** | Text-to-speech |

---

## Translation, Memory, Traffic, Admin, Welcome

| Method | Path | Handler | Auth | Purpose |
|--------|------|---------|------|---------|
| POST | `/api/hooks/translate` | `hooks/translate.js` | No (device_id field + limiter) | Siri translation hook |
| POST | `/api/strategy/tactical-plan` | `strategy/tactical-plan.js` | Yes | Tactical plan |
| GET | `/api/memory` (+ `/stats`, `/rules`, `/session/:sessionId`); POST `/api/memory`; PATCH `/api/memory/:id` | `memory/index.js` | Operator/service account after authentication | Claude memory table API |
| GET | `/api/traffic/incidents` | `traffic/index.js` | Yes | discovered_traffic cache read |
| GET | `/api/admin/offer-monitor`; POST `/api/admin/query` | `admin/monitor.js` | Agent bridge token only | Read-only prod monitor / query bridge |
| POST | `/api/welcome-ai/icebreaker`, `/ask` | `welcome-ai/welcome-ai.js` | No (public limiter) | Welcome AI co-pilot |

**Why Auth Required:** These endpoints mint OpenAI tokens or call paid APIs. Auth prevents unauthenticated cost abuse.

---

## Feedback Endpoints

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| POST | `/api/feedback/venue` | `feedback.js` | Venue feedback |
| POST | `/api/feedback/strategy` | `feedback.js` | Strategy feedback |
| POST | `/api/feedback/app` | `feedback.js` | App feedback |
| POST | `/api/actions` | `actions.js` | Log user actions |

---

## Auth Endpoints

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| POST | `/api/auth/token` | `auth.js` | Generate JWT (DEV ONLY) |

**Security:** Token minting is **disabled in production** to prevent impersonation.

---

## Venue Endpoints

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | `/api/venues/*` | `venue-intelligence.js` | Venue recommendations |

---

## Offer Analyzer Endpoints

Current source: [Analyzer contract](architecture/OFFER_ANALYZER.md), §§4/12.
Public hooks use `offerHookLimiter` (20/min); browser APIs require authentication.
Supplied invalid/unreadable personal rules fail closed. Device labels are not identity.

| Method | Path | Handler | Auth | Purpose |
|--------|------|---------|------|---------|
| POST | `/api/hooks/analyze-offer` | `hooks/analyze-offer.js` | shortcut token optional | Text/image Phase-1 decision, matching voice and provenance; no token is personally unverified. |
| GET | `/api/hooks/offer-history?limit=` | `hooks/analyze-offer.js` | token required | Owner’s nonremoved recent analyses + bounded stats. |
| POST | `/api/hooks/offer-override` | `hooks/analyze-offer.js` | token required | Owner-scoped immediate disagreement. |
| POST | `/api/hooks/offer-cleanup` | `hooks/analyze-offer.js` | token required | Legacy hard deletion of owned rows (≤50 IDs). |
| GET | `/api/offer-analyzer/rules` | `offer-analyzer/index.js` | Bearer | Saved migrated rules or explicitly identified unsaved profile-derived rules. |
| PUT | `/api/offer-analyzer/rules` | `offer-analyzer/index.js` | Bearer | Validate + required expected-version save; stale writes return 409. |
| GET | `/api/offer-analyzer/shortcut-token` | `offer-analyzer/index.js` | Bearer | Get-or-create owner token. |
| POST | `/api/offer-analyzer/shortcut-token/regenerate` | `offer-analyzer/index.js` | Bearer | Rotate token. |
| POST | `/api/offer-analyzer/shortcut-token/label` | `offer-analyzer/index.js` | Bearer | Device label. |
| GET | `/api/offer-analyzer/offers` | `offer-analyzer/index.js` | Bearer | Owned rows + outcomes; local-day and bounded recent modes. |
| GET | `/api/offer-analyzer/offers/stats` | `offer-analyzer/index.js` | Bearer | Complete requested-period counts and recorded earnings. |
| POST | `/api/offer-analyzer/offers/:id/outcome` | `offer-analyzer/index.js` | Bearer | Partial driver-outcome updates with expected revision and canonical saved/conflict reply. |
| POST | `/api/offer-analyzer/offers/:id/remove` or `/restore` | `offer-analyzer/index.js` | Bearer | Reversible owner-scoped removal with expected removal revision. |
| GET | `/api/offer-analyzer/places/search?q=` | `offer-analyzer/index.js` | Bearer | Places picker with stable place identity and coordinates. |

---

## SSE (Server-Sent Events) Endpoints

| Path | Handler | Events |
|------|---------|--------|
| `/events` | `events.js` | `phase_change`, `strategy_complete` |
| `/api/strategy/events` | `strategy-events.js` | Strategy progress |
| POST `/api/chat` | `chat.js` | Chat streaming |
| `/events/offers` | `strategy-events.js` | `offer_analyzed` (per-user; Offer Analyzer) |

---

## Route Files by Domain

```
server/api/
├── auth/
│   ├── auth.js          → /api/auth/*
│   └── index.js         → Barrel exports
├── briefing/
│   ├── briefing.js      → /api/briefing/*
│   └── index.js
├── chat/
│   ├── chat.js          → /api/chat/*
│   ├── chat-context.js  → /api/chat/context
│   ├── realtime.js      → /api/realtime/*
│   ├── tts.js           → /api/tts
│   └── index.js
├── feedback/
│   ├── feedback.js      → /api/feedback/*
│   ├── actions.js       → /api/actions
│   └── index.js
├── health/
│   ├── health.js        → /api/health/* (mounted by bootstrap/health.js)
│   ├── diagnostics.js   → /api/diagnostics/*
│   ├── ml-health.js     → /api/ml-health/*
│   └── index.js
├── location/
│   ├── location.js      → /api/location/*
│   ├── snapshot.js      → /api/snapshot/*
│   └── index.js
├── research/
│   ├── research.js      → /api/research/*
│   ├── vector-search.js → /api/vector-search/*
│   └── index.js
├── strategy/
│   ├── blocks-fast.js   → /api/blocks-fast
│   ├── strategy.js      → /api/strategy/*
│   ├── content-blocks.js → /api/blocks/*
│   ├── strategy-events.js → SSE
│   └── index.js
├── venue/
│   ├── venue-intelligence.js → /api/venues/*
│   └── index.js
└── utils/
    ├── http-helpers.js  → Shared utilities
    ├── safeElapsedMs.js
    └── index.js
```

---

## Adding New Routes

1. Create route file in appropriate domain folder
2. Export router as default
3. Add export to folder's `index.js`
4. Mount in `server/bootstrap/routes.js`
5. Update this registry
6. Update folder's README.md
