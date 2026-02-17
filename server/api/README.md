> **Gemini Analysis (2026-02-11):**
> **Structure:** The API is structured by domain (`auth`, `briefing`, `strategy`, `location`, etc.) to enforce modularity.
> **Key Pattern:** Import paths must be strictly relative (`../../lib/` or `../../../shared/`) to avoid alias issues in the server.
> **Mount Order:** Critical endpoints (Health, Diagnostics) are mounted before authenticated API routes.
> **Role:** Serves as the interface between the client and the TRIAD pipeline, handling validation (Zod) and request processing.

> **Last Verified:** 2026-01-06

# API Routes (`server/api/`)

## Purpose

Express API endpoints organized by domain. Each domain folder contains related routes.

## Domain Structure

```
api/
├── auth/           # Authentication (JWT, login, register)
├── briefing/       # Events, traffic, news
├── chat/           # AI Coach, voice
├── coach/          # AI Coach schema, validation, notes CRUD
├── feedback/       # User feedback, actions
├── health/         # Health checks, diagnostics
├── intelligence/   # Market intelligence (zones, strategies)
├── location/       # GPS, geocoding, snapshots
├── platform/       # Platform data (Uber/Lyft intel)
├── research/       # Vector search, research
├── strategy/       # Strategy generation
├── vehicle/        # Vehicle makes/models (NHTSA proxy)
├── venue/          # Venue intelligence
└── utils/          # Shared utilities
```

## Domain Folders

### auth/
| File | Route | Purpose |
|------|-------|---------|
| `auth.js` | `/api/auth/*` | JWT token generation |
| `index.js` | - | Router barrel export |

### briefing/
| File | Route | Purpose |
|------|-------|---------|
| `briefing.js` | `/api/briefing/*` | Events, traffic, news |
| `events.js` | `/events` | SSE stream for real-time updates |
| `index.js` | - | Router barrel export |

### chat/
| File | Route | Purpose |
|------|-------|---------|
| `chat.js` | `/api/chat` | AI Coach (SSE streaming) |
| `chat-context.js` | `/coach/context/*` | Read-only chat context |
| `realtime.js` | `/api/realtime` | OpenAI Realtime voice API |
| `tts.js` | `/api/tts` | Text-to-speech |
| `index.js` | - | Router barrel export |

### coach/
| File | Route | Purpose |
|------|-------|---------|
| `index.js` | `/api/coach/*` | AI Coach router (mounts sub-routers) |
| `schema.js` | `/api/coach/schema/*` | Database schema awareness for Coach |
| `validate.js` | `/api/coach/validate/*` | Coach validation endpoints |
| `notes.js` | `/api/coach/notes/*` | User notes CRUD operations |

### feedback/
| File | Route | Purpose |
|------|-------|---------|
| `feedback.js` | `/api/feedback/*` | User feedback capture |
| `actions.js` | `/api/actions/*` | User interaction tracking |
| `index.js` | - | Router barrel export |

### health/
| File | Route | Purpose |
|------|-------|---------|
| `health.js` | `/`, `/health`, `/ready` | Health probes |
| `diagnostics.js` | `/api/diagnostics/*` | Debug endpoints |
| `diagnostics-strategy.js` | `/api/diagnostic/*` | Strategy debugging |
| `diagnostic-identity.js` | `/api/diagnostic/identity` | Identity debugging |
| `job-metrics.js` | `/api/job-metrics` | Background job stats |
| `ml-health.js` | `/api/ml/*` | ML model health |
| `unified-capabilities.js` | `/capabilities` | AI capabilities |
| `index.js` | - | Router barrel export |

### location/
| File | Route | Purpose |
|------|-------|---------|
| `location.js` | `/api/location/*` | GPS, geocoding, weather, AQ |
| `snapshot.js` | `/api/snapshot/*` | Location snapshot CRUD |
| `index.js` | - | Router barrel export |

Key location endpoints:
```
GET  /api/location/resolve       - Geocode + city/state/timezone
GET  /api/location/weather       - Current weather + 6hr forecast
GET  /api/location/airquality    - AQI data
POST /api/location/snapshot      - Save location snapshot
GET  /api/users/me               - Current user session (via snapshot)
```

### research/
| File | Route | Purpose |
|------|-------|---------|
| `research.js` | `/api/research/*` | Research queries |
| `vector-search.js` | `/api/vector-search/*` | Vector similarity search |
| `index.js` | - | Router barrel export |

### strategy/
| File | Route | Purpose |
|------|-------|---------|
| `blocks-fast.js` | `/api/blocks-fast` | Strategy + venue generation (main endpoint) |
| `strategy.js` | `/api/strategy/*` | Strategy fetching, retry |
| `content-blocks.js` | `/api/blocks/*` | Block status polling |
| `strategy-events.js` | `/events/*` | SSE real-time strategy updates |
| `tactical-plan.js` | `/api/strategy/tactical-plan` | AI tactical analysis for missions |
| `index.js` | - | Router barrel export |

Key strategy endpoints:
```
POST /api/blocks-fast            - Trigger full strategy + venue generation
GET  /api/blocks-fast            - Get existing blocks for snapshot
GET  /api/strategy/:snapshotId   - Get strategy for snapshot
```

### venue/
| File | Route | Purpose |
|------|-------|---------|
| `venue-intelligence.js` | `/api/venues/*` | Venue recommendations |
| `venue-events.js` | `/api/venue/events/*` | Venue-specific events |
| `closed-venue-reasoning.js` | `/api/closed-venue-reasoning` | GPT-5 venue reasoning |
| `index.js` | - | Router barrel export |

### intelligence/
| File | Route | Purpose |
|------|-------|---------|
| `index.js` | `/api/intelligence/*` | Market intelligence CRUD |

Key intelligence endpoints:
```
GET  /api/intelligence           - List all intelligence with filters
GET  /api/intelligence/markets   - List markets with intel counts
GET  /api/intelligence/market/:slug - Get intel for specific market
GET  /api/intelligence/coach/:market - AI Coach context for market
```

See [intelligence/README.md](intelligence/README.md) for full documentation.

### vehicle/
| File | Route | Purpose |
|------|-------|---------|
| `vehicle.js` | `/api/vehicle/*` | NHTSA vehicle makes/models proxy |

Key vehicle endpoints:
```
GET  /api/vehicle/makes          - All vehicle makes (cached)
GET  /api/vehicle/models?make=X&year=Y - Models for make/year
GET  /api/vehicle/years          - Available years (2005-present)
```

See [vehicle/README.md](vehicle/README.md) for full documentation.

### platform/
| File | Route | Purpose |
|------|-------|---------|
| `index.js` | `/api/platform/*` | Rideshare platform data (Uber/Lyft market coverage) |

Key platform endpoints:
```
GET  /api/platform/stats          - Overall statistics
GET  /api/platform/markets        - List all markets with city counts
GET  /api/platform/markets/:market - Cities in a specific market
GET  /api/platform/search?q=      - Search cities by name
GET  /api/platform/city/:city     - Details for a specific city
```

### utils/
| File | Purpose |
|------|---------|
| `http-helpers.js` | Response helpers, JSON parsing |
| `safeElapsedMs.js` | Safe timing utilities |
| `index.js` | Barrel export |

## Connections

- **Imports from:** `../../lib/*` (all domain modules)
- **Mounted by:** `../../bootstrap/routes.js`, `../../sdk-embed.js`
- **Uses middleware from:** `../../middleware/*`

## Import Path Reference (from `server/api/*/`)

| Target | Import Path |
|--------|-------------|
| `server/lib/` | `../../lib/` |
| `server/db/` | `../../db/` |
| `server/middleware/` | `../../middleware/` |
| `server/util/` | `../../util/` |
| `server/validation/` | `../../validation/` |
| `server/logger/` | `../../logger/` |
| `server/jobs/` | `../../jobs/` |
| `shared/` (project root) | `../../../shared/` |
| `server/api/utils/` | `../utils/` |

**Common mistakes:**
- `../../shared/` resolves to `server/shared/` (wrong) - use `../../../shared/`
- `./utils/` from subfolder resolves to `server/api/subfolder/utils/` - use `../utils/`
- Dynamic imports (`await import()`) need the same path corrections

See `health/README.md` for detailed path documentation.

## Mount Order

Routes are mounted in specific order (see `bootstrap/routes.js`):
1. Health endpoints (no auth)
2. Diagnostics
3. API routes (auth required)
4. SSE events
5. Catch-all fallback

## Adding New Routes

1. Create route file in appropriate domain folder
2. Add mount entry to `../bootstrap/routes.js`
3. Add import to `../../sdk-embed.js` if needed for SDK access
4. Update this README
