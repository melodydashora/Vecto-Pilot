# SCALABILITY.md — Scalability Architecture Plan

> **Canonical reference** for current bottlenecks, horizontal scaling, caching, connection pooling, and capacity planning.
> Last updated: 2026-04-10

## Supersedes
- `docs/architecture/scalability.md` — Previous scalability overview (absorbed and expanded)
- `docs/architecture/environment.md` — Environment configuration (merged: deployment modes, SSL, env vars)
- `docs/architecture/server-structure.md` — Server file structure (merged: gateway, workers, bootstrap)
- `docs/architecture/realtime.md` — Real-time architecture (merged: SSE + WebSocket scaling)

---

## Table of Contents

1. [Current Bottlenecks](#1-current-bottlenecks)
2. [Server Architecture](#2-server-architecture)
3. [Database Connection Pooling](#3-database-connection-pooling)
4. [Horizontal Scaling Strategy](#4-horizontal-scaling-strategy)
5. [Caching Layers](#5-caching-layers)
6. [Queue-Based LLM Processing](#6-queue-based-llm-processing)
7. [SSE at Scale](#7-sse-at-scale)
8. [Capacity Planning](#8-capacity-planning)
9. [Current State](#9-current-state)
10. [Known Gaps](#10-known-gaps)
11. [TODO — Hardening Work](#11-todo--hardening-work)

---

## 1. Current Bottlenecks

| Bottleneck | Why | Impact | Fix |
|-----------|-----|--------|-----|
| **DB connections (25)** | 8-11 per active user session | Queue at 3+ concurrent users | PgBouncer, increase pool |
| **Single Node.js process** | No clustering, CPU-bound | Slow at 50+ concurrent requests | Cluster mode or autoscale |
| **LLM latency (35-90s pipeline)** | 7+ Gemini + Claude + GPT calls per session | Users wait 60-90s for strategy | Cache briefings, parallelize |
| **No Redis cache** | Rate limits in memory (lost on restart) | Inconsistent after redeploy | Add Redis |
| **Static assets from Express** | No CDN, same server | Bandwidth competition | External CDN |

---

## 2. Server Architecture

**File:** `gateway-server.js`

### Deployment Modes

| Mode | `DEPLOY_MODE` | Workers | SSE | Use Case |
|------|--------------|---------|-----|----------|
| `mono` (default) | omitted | Embedded | Yes | Dev / small deployments |
| `webservice` | `webservice` | Disabled | Yes | Autoscale: HTTP instances |
| `worker` | `worker` | Yes | No | Autoscale: background jobs |

### Autoscale Detection

```javascript
const isAutoscaleMode = process.env.CLOUD_RUN_AUTOSCALE === '1' || 
                        process.env.REPLIT_AUTOSCALE === '1';
```

When true: workers + snapshot observer forcibly disabled to prevent duplicate processing across instances.

### Server Timeouts

- Keep-alive: 65s
- Headers: 66s
- Request: 5s (server-level)
- LLM calls: 120s (per-call in HedgedRouter)

---

## 3. Database Connection Pooling

**File:** `server/db/connection-manager.js`

| Setting | Value | Justification |
|---------|-------|---------------|
| Max connections | 25 | Strategy(3) + Briefing(5) + Blocks(3) = 11/user + buffer |
| Idle timeout | 10,000ms | Aggressively recycles idle connections |
| Connection timeout | 15,000ms | Fails fast on DB unavailability |
| Statement timeout | 30,000ms | Prevents long-running query lock-up |
| Keep-alive | 10,000ms | Detects dead connections |
| Warning threshold | 80% (20/25) | Logs saturation every 30s |

### Auto-Recovery

Code 57P01 (admin shutdown) triggers automatic reconnection attempt.

### Scaling Path

| Users | Pool Size | Infrastructure |
|-------|-----------|---------------|
| 1-10 | 25 | Direct connection (current) |
| 10-100 | 50 | PgBouncer in transaction mode |
| 100-1K | 100+ | Managed PostgreSQL + PgBouncer |
| 1K+ | Sharded | Regional DB instances by market |

---

## 4. Horizontal Scaling Strategy

### Current: Single Instance

All traffic handled by one Node.js process on Replit.

### Phase 1: Web + Worker Split

```
Load Balancer
  ├─ Web Instance 1 (DEPLOY_MODE=webservice) → HTTP + SSE
  ├─ Web Instance 2 (DEPLOY_MODE=webservice) → HTTP + SSE
  └─ Worker Instance (DEPLOY_MODE=worker)     → Strategy + SmartBlocks
```

**Already supported** via `DEPLOY_MODE` env var. Advisory locks prevent duplicate LLM calls across instances.

### Phase 2: Add Redis

```
Web Instances ──→ Redis ──→ Rate limits (shared)
                         ──→ Session cache
                         ──→ Briefing cache (by coord_key)
                         ──→ SSE pub/sub (replaces DB LISTEN for scale)
```

### Phase 3: Queue-Based Processing

```
Web → Redis Queue → Worker Pool
                  → LLM calls distributed across workers
                  → Results → DB → SSE notification
```

---

## 5. Caching Layers

### Current Implementation

| Layer | Storage | TTL | What's Cached |
|-------|---------|-----|--------------|
| Coordinates | `coords_cache` (PostgreSQL) | Indefinite | Geocode → city/state/timezone |
| Google Places | `places_cache` (PostgreSQL) | ~7 days | Hours, phone, status |
| Briefings | `briefings` (PostgreSQL) | Snapshot lifetime (60 min) | All 7 data sources |
| Strategy | `localStorage` (client) | Until snapshot changes | Consolidated strategy text |
| Snapshot | `sessionStorage` (client) | 15 min | Full snapshot for app-switch resume |
| React Query | In-memory (client) | 30s–10 min per query | All API responses |
| Rate limits | In-memory (server) | Reset on restart | IP hit counts |

### Missing Cache Layers

| Layer | Benefit | Implementation |
|-------|---------|---------------|
| **Redis** | Shared rate limits, session cache, pub/sub | Add Redis instance |
| **CDN** | Static assets, reduce server bandwidth | CloudFlare or similar |
| **Briefing by coord_key** | Share across users at same location | Redis or DB-level dedup |

---

## 6. Queue-Based LLM Processing

### Current: Synchronous Pipeline

The blocks-fast waterfall runs synchronously in the request handler. If 10 users create snapshots simultaneously, all 10 trigger independent LLM calls.

### Proposed: Queue Architecture

```
User creates snapshot
  └─ Enqueue: { snapshotId, priority }
       └─ Worker picks from queue
            └─ Briefing (parallel Gemini calls)
            └─ Strategy (Claude)
            └─ Venues (GPT)
            └─ pg_notify results
                 └─ SSE → client
```

**Benefits:**
- Rate-limit-aware (respect provider quotas)
- Priority-based (premium users first)
- Retry-friendly (failed jobs re-queued)
- Horizontally scalable (add workers)

### Existing Infrastructure

`server/lib/infrastructure/job-queue.js` already provides: job tracking, exponential backoff retry (3 attempts), dead letter queue, hourly cleanup. Currently used for background tasks but not for the main pipeline.

---

## 7. SSE at Scale

### Current: PostgreSQL LISTEN/NOTIFY

All SSE events flow through PostgreSQL's LISTEN/NOTIFY. This is efficient for single-instance but doesn't scale to multiple server instances (each instance would need its own LISTEN connection).

### At Scale: Redis Pub/Sub

```
Worker emits event → Redis PUBLISH → All web instances SUBSCRIBE → SSE to connected clients
```

**Migration path:** Replace `db.execute(sql\`SELECT pg_notify(...)\`)` with `redis.publish(channel, payload)`. Replace `subscribeToChannel()` with `redis.subscribe(channel, callback)`.

### Client-Side Scaling

Current singleton SSE manager creates 4 connections per client (strategy, blocks, phase, briefing). At 1,000 clients = 4,000 connections. Node.js handles this well, but may need sticky sessions or connection-aware load balancing.

---

## 8. Capacity Planning

### Targets

| Scale | Users | Sessions/Day | LLM Calls/Day | DB Connections | Monthly Cost |
|-------|-------|-------------|----------------|----------------|-------------|
| **Current** | 1-5 | 5-15 | 50-150 | 25 | ~$200 |
| **100 users** | 100 | 200 | 2,000 | 50 (PgBouncer) | ~$700 |
| **1K users** | 1,000 | 2,000 | 20,000 | 100+ | ~$5,000 |
| **10K users** | 10,000 | 20,000 | 200,000 | Sharded | ~$40,000 |
| **100K users** | 100,000 | 200,000 | 2,000,000 | Multi-region | ~$350,000 |

### Auto-Scaling Triggers

| Metric | Threshold | Action |
|--------|-----------|--------|
| CPU > 70% | 5 min sustained | Add web instance |
| DB connections > 80% | Immediate | Alert + scale pool |
| LLM queue depth > 50 | 1 min sustained | Add worker instance |
| SSE connections > 500/instance | Monitoring | Evaluate Redis pub/sub |
| P95 latency > 5s | 5 min sustained | Add web instance |

---

## 9. Current State

| Area | Status |
|------|--------|
| Single-server deployment | Working — suitable for <10 concurrent |
| DB connection pool (25) | Working — with monitoring |
| Rate limiting (in-memory) | Working — lost on restart |
| Advisory locks (dedup) | Working — cross-instance safe |
| Deploy mode split (web/worker) | Implemented — not yet used |
| Autoscale detection | Implemented — workers disabled |
| Code splitting (Vite) | Working — vendor chunks separated |

---

## 10. Known Gaps

1. **No Redis** — Rate limits, cache, pub/sub all need shared state.
2. **No CDN** — Static assets served from same Express server.
3. **No clustering** — Single process, no CPU parallelism.
4. **No queue for LLM calls** — Synchronous pipeline, no rate-limit awareness.
5. **DB LISTEN doesn't scale** — Each instance needs own LISTEN connection.
6. **No load testing baseline** — Unknown breaking point.

---

## 11. TODO — Hardening Work

- [ ] **Add Redis** — Shared rate limits, session cache, briefing cache, SSE pub/sub
- [ ] **CDN for static assets** — CloudFlare or similar
- [ ] **Load test baseline** — k6 scripts targeting 10/50/100 concurrent users
- [ ] **Queue-based LLM pipeline** — Decouple from request handler
- [ ] **PgBouncer** — Connection pooling for >50 DB connections
- [ ] **DB read replica** — Offload analytics, intelligence, and health queries
- [ ] **Migrate SSE to Redis pub/sub** — Required before horizontal web scaling
- [ ] **Table partitioning** — snapshots and coach_conversations by month

---

## Key Files

| File | Purpose |
|------|---------|
| `gateway-server.js` | Server entry, deploy modes, autoscale |
| `server/db/connection-manager.js` | Pool config (25 max) |
| `server/db/pool.js` | Pool stats API |
| `server/bootstrap/workers.js` | Worker lifecycle (221 lines) |
| `server/middleware/rate-limit.js` | All rate limiters |
| `server/lib/infrastructure/job-queue.js` | Job queue with DLQ |
| `server/api/strategy/strategy-events.js` | SSE endpoints |
| `vite.config.js` | Build + code splitting config |
