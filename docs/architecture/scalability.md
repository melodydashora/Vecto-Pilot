# Scalability Architecture

**Last Updated:** 2026-02-10

This document details the scalability mechanisms of Vecto Co-Pilot, including rate limiting, load balancing, and caching strategies.

## 1. Rate Limiting Configuration

Implemented in `server/middleware/rate-limit.js` using `express-rate-limit`.

| Limiter | Config | Applied To | Purpose |
| :--- | :--- | :--- | :--- |
| **Expensive Endpoint** | 5 req/min | `POST /api/blocks-fast`<br>`POST /api/briefing/generate` | Protects high-cost AI pipelines (Triad, Briefing). |
| **Chat Limiter** | 3 req/min | `POST /api/chat/*` | Prevents token exhaustion from rapid-fire chat. |
| **General Limiter** | 30 req/min | All other API routes | Basic DDoS protection. |

**Bypass:** Health checks (`/health`) and Auth endpoints (`/api/auth`) are excluded from some limiters.

## 2. Load Balancing (Replit Autoscale)

### Configuration
The application is deployed on Replit with **Autoscale** enabled (in production).
- **Environment:** `DEPLOY_MODE=webservice` (or `split` for separation of concerns).
- **Behavior:** Replit automatically spins up additional instances based on CPU/RAM usage.

### Constraints
- **State:** Application server is **stateless**. No in-memory sessions allowed.
- **WebSockets:** Requires "Sticky Sessions" or a dedicated WS service (`server/agent/index.ts` runs on a separate port 43717).
- **Background Jobs:** Autoscale instances MUST NOT run background workers (risk of duplication).
    - **Contract:** `server/config/load-env.js` enforces `ENABLE_BACKGROUND_WORKER=false` when `CLOUD_RUN_AUTOSCALE=1`.
    - **Solution:** Dedicated worker instance (`DEPLOY_MODE=worker`) handles `server/lib/infrastructure/job-queue.js`.

## 3. Caching Strategy

### A. Database Caching (Persistent)
- **`coords_cache` Table:**
    - **Purpose:** Caches Google Geocoding & Timezone API results.
    - **Key:** `coord_key` (Lat/Lng at 6 decimal precision ~11cm).
    - **TTL:** Indefinite (Location metadata rarely changes).
- **`places_cache` Table:**
    - **Purpose:** Caches Google Places details (hours, phone).
    - **TTL:** Refresh on access if > 7 days old (logic in `venue-cache.js`).
- **`briefings` Table:**
    - **Purpose:** Caches expensive AI-generated briefings (Events, Traffic, News).
    - **Scope:** Per `snapshot_id`.
    - **TTL:** Valid for the duration of the snapshot (60 mins).

### B. In-Memory Caching (Ephemeral)
- **Rate Limiters:** Stores hit counts in memory (resets on restart/scale-out). *Note: Use Redis for distributed rate limiting in future.*
- **Deduplication Maps:** `sync-events.mjs` uses `inFlightBriefings` map to prevent duplicate processing within a single instance.

### C. Client Caching (React Query)
- **Stale Time:**
    - **Snapshots:** 10 minutes.
    - **Strategy:** 5 minutes.
    - **Briefing:** 30 seconds (Traffic needs freshness).
- **Invalidation:** Triggered by SSE events (`strategy_ready`, `blocks_ready`).
