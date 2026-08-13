# API Routes Registry

Complete reference of all API endpoints organized by domain.

**Last Updated:** 2026-04-30

> **Note:** This registry is known to be missing entries for several routes (memory, translate, hooks, tactical-plan, coach updates, realtime). A completeness pass is on the follow-up list.

---

## Quick Reference

| Domain | Base Path | Auth | Purpose |
|--------|-----------|------|---------|
| Health | `/`, `/health`, `/ready` | No | Health probes |
| Location | `/api/location/*` | Yes | GPS, geocoding, weather |
| Strategy | `/api/blocks-fast`, `/api/strategy/*` | Yes | Briefing → Strategy → Blocks pipeline (single STRATEGY_TACTICAL strategy) |
| Briefing | `/api/briefing/*` | Yes | Events, traffic, news |
| Chat | `/api/chat/*` | Yes | Rideshare Coach |
| Voice | `/api/realtime/*`, `/api/tts` | **Yes** | Voice + TTS |
| Feedback | `/api/feedback/*`, `/api/actions` | Yes | User feedback |
| Auth | `/api/auth/*` | No | Token generation |
| Venue | `/api/venues/*` | Yes | Venue intelligence |

---

## Health Endpoints (No Auth)

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | `/healthz` | `bootstrap/health.js` | SPA-ready health check |
| GET | `/health` | `health.js` | Kubernetes liveness probe |
| GET | `/ready` | `health.js` | Kubernetes readiness probe |
| GET | `/api/unified/capabilities` | `unified-capabilities.js` | AI model capabilities |
| GET | `/api/diagnostics/*` | `diagnostics.js` | Debug endpoints |
| GET | `/api/diagnostic/identity` | `diagnostic-identity.js` | Identity debugging |
| GET | `/api/ml/*` | `ml-health.js` | ML model health |
| GET | `/api/job-metrics` | `job-metrics.js` | Background job stats |

---

## Location Endpoints

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | `/api/location/resolve` | `location.js` | GPS → Address + timezone |
| GET | `/api/location/weather` | `location.js` | Current weather + forecast |
| GET | `/api/location/airquality` | `location.js` | AQI data |
| POST | `/api/location/snapshot` | `location.js` | Save location snapshot |
| GET | `/api/snapshot/:id` | `snapshot.js` | Fetch snapshot data |

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
| GET | `/api/chat/context` | `chat-context.js` | No | Read-only chat context |

---

## Voice Endpoints (Auth Required - API Cost)

| Method | Path | Handler | Auth | Purpose |
|--------|------|---------|------|---------|
| POST | `/api/realtime/token` | `realtime.js` | **Yes** | OpenAI Realtime token |
| POST | `/api/tts` | `tts.js` | **Yes** | Text-to-speech |

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

## SSE (Server-Sent Events) Endpoints

| Path | Handler | Events |
|------|---------|--------|
| `/events` | `events.js` | `phase_change`, `strategy_complete` |
| `/api/strategy/events` | `strategy-events.js` | Strategy progress |
| POST `/api/chat` | `chat.js` | Chat streaming |

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
│   ├── health.js        → /, /health, /ready
│   ├── diagnostics.js   → /api/diagnostics/*
│   ├── ml-health.js     → /api/ml/*
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
