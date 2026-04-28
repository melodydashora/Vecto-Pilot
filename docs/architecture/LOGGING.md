# LOGGING.md — Logging, Observability, and Audit Trail

> **Canonical reference** for logging implementation, structured logging, audit trail (flagged as critical gap in NIST/ISO), and observability pipeline.
> Last updated: 2026-04-10

## Supersedes
- `docs/architecture/logging.md` — Previous logging conventions doc (absorbed and expanded)
- `docs/architecture/observability.md` — Observability gaps doc (absorbed and expanded)

---

## Table of Contents

1. [Current Logging Implementation](#1-current-logging-implementation)
2. [Workflow-Aware Logging](#2-workflow-aware-logging)
3. [Structured Logging (NDJSON)](#3-structured-logging-ndjson)
4. [Correlation IDs](#4-correlation-ids)
5. [Health Monitoring](#5-health-monitoring)
6. [Performance Logging](#6-performance-logging)
7. [Audit Logging (CRITICAL GAP)](#7-audit-logging-critical-gap)
8. [Log Destinations and Rotation](#8-log-destinations-and-rotation)
9. [Current State](#9-current-state)
10. [Known Gaps](#10-known-gaps)
11. [TODO — Hardening Work](#11-todo--hardening-work)

---

## 1. Current Logging Implementation

**File:** `server/logger/logger.js` (61 lines)

### createLogger(module)

Creates module-specific logger instances with:
- **Log levels:** `info()`, `warn()`, `error()`, `debug()`, `stream()`
- **Format:** `[module:correlationId] [emoji] message [data]`
- **Debug gating:** `process.env.DEBUG === 'true'` controls debug output
- **Emoji indicators:** info, warn, error, debug, stream

### Pre-configured Loggers

`strategyLog` (canonical, since 2026-04-28), `triadLog` (back-compat alias for `strategyLog`), `venuesLog`, `briefingLog`, `eventsLog`, `weatherLog`, `authLog`, `sseLog`, `routesLog`, `placesLog` — each scoped to a domain.

### Canonical Chain Helper — `chainLog` (2026-04-28)

For new code, prefer `chainLog({ parent, sub, callTypes, callName, table })` over the legacy domain-loggers. It enforces the canonical positional template (memory 229):

```
[Parent] [Sub] [CallType...] [CallName] message
```

**Slots:**
- `parent` — required. Top-level workflow stage. UPPERCASED. `BRIEFING`, `VENUE`, `STRATEGY`, `RIDESHARE COACH`, etc.
- `sub` — optional. Narrower function (`TRAFFIC`, `NEWS`, `TTS`, `WEATHER`). UPPERCASED.
- `callTypes` — optional array. Operation footprint, stackable: `['AI']`, `['API','AI']`, `['DB','LISTEN/NOTIFY']`. UPPERCASED.
- `callName` — optional. Target identity. **Case preserved** so roles emit `TitleCase` (`Briefer`, `Planner`, `Strategist`), tables `snake_case` (`venue_cards`), services `TitleCase` (`TomTom`, `GooglePlaces`).
- `table` — alias for `callName` when DB is present (clarity at call sites).

**Validators (warn-loudly, don't throw):**
- DB in `callTypes` requires `table`/`callName` (memory 230). Once enforced, `grep "[DB] [table]"` finds every call site touching that table → duplicate-finding lever.
- `parent` must be a registered main category.

**Example:**
```js
chainLog({
  parent: 'BRIEFING', sub: 'TRAFFIC', callTypes: ['API','AI'], callName: 'Briefer'
}, 'Calling TomTom for traffic and sent to Briefer for consolidation');
// emits: [BRIEFING] [TRAFFIC] [API] [AI] [Briefer] Calling TomTom for traffic and sent to Briefer for consolidation
```

See also: `docs/architecture/log-format-merge-plan.md` for the full migration plan.

---

## 2. Workflow-Aware Logging

**File:** `server/logger/workflow.js` (459 lines)

### Phase Tracking by Domain

| Domain | Phases |
|--------|--------|
| LOCATION | GPS, Geocode/Cache, Weather+Air |
| SNAPSHOT | Create Record, Enrich |
| TRIAD | Strategist, Briefer, NOW, SmartBlocks |
| VENUES | Tactical Planner, Routes API, Places API, DB Store |
| BRIEFING | Traffic, Events, Validation |
| EVENTS | Extract, Transform (Normalize/Geocode), Load, Assemble |
| BARS | Query, Enrich |

### Operation Type Icons

| Icon | Operation | Icon | Operation |
|------|-----------|------|-----------|
| `OP.AI` | Model calls | `OP.CACHE` | Cache operations |
| `OP.API` | External APIs | `OP.RETRY` | Retry attempts |
| `OP.DB` | Database ops | `OP.FALLBACK` | Fallback activation |
| `OP.SSE` | Streaming | | |

### Logger Methods

`phase()`, `done()`, `error()`, `warn()`, `start()`, `complete()`, `info()`, `api()`, `ai()`, `db()`

---

## 3. Structured Logging (NDJSON)

**File:** `server/logger/ndjson.js` (5 lines)

Outputs newline-delimited JSON for machine-readable events:
```json
{"ts":"2026-04-10T22:40:28.000Z","type":"health.ok","service":"vecto-pilot"}
```

Currently used only for health check logging. NOT applied to all log output.

---

## 4. Correlation IDs

**File:** `server/logger/logger.js` (lines 8–18)

- Global stack-based correlation ID management
- `getCorrelationId()` returns 8-char UUID suffix or existing ID from stack
- `setCorrelationId(id)` returns cleanup function for stack popping
- Traces requests across middleware → route handler → service → DB

**Limitation:** Correlation IDs are per-request within a single Node.js process. No distributed tracing across services (Eidolon, external APIs).

---

## 5. Health Monitoring

### Health Endpoints

| Endpoint | Auth | Returns |
|----------|------|---------|
| `GET /health` | Public | Basic liveness: `{ok, service, timestamp}` |
| `GET /ready` | Public | Readiness probe |
| `GET /health/details` | Auth required | Uptime, memory, pool stats, PID, LLM diagnostics |
| `GET /health/pool-stats` | Auth required | `{idle, total, waiting, max, status}` |
| `GET /health/strategies` | Auth required | Provider registry health |
| `GET /health/metrics` | Auth required | Prometheus format: `db_connections_*`, `process_memory_*`, `process_uptime_seconds` |

### AI Health Monitoring

**File:** `server/lib/ai/unified-ai-capabilities.js` (226 lines)

- Monitors: Eidolon, Atlas Agent, Assistant health
- Auto-healing: restarts context, resets circuit breakers, refreshes memory
- Recovery attempts tracked and logged

### Job Queue Monitoring

**File:** `server/lib/infrastructure/job-queue.js` (134 lines)

- Metrics: `{total, succeeded, failed, retrying}`
- Dead letter queue for permanently failed jobs
- Hourly cleanup of completed jobs
- Endpoints: `GET /api/metrics/jobs`, `GET /api/metrics/jobs/:jobId`

---

## 6. Performance Logging

### LLM Latency

- Token counts stored in `strategies` and `rankings` tables (SUM aggregated in health endpoints)
- Response time tracked: `response_time_ms` in offer_intelligence
- Phase timing: `phase_started_at` in strategies table for progress tracking

### Database

- Pool stats: idle/total/waiting/max exported via `/health/pool-stats`
- Connection saturation warnings at 80% (20/25 connections)
- Statement timeout: 30s per query

### Missing

- No request-level latency tracking (no middleware timing)
- No frontend performance metrics (no Web Vitals)
- No LLM cost calculation from token counts

---

## 7. Audit Logging (CRITICAL GAP)

**Status: NOT IMPLEMENTED** — Flagged in NIST.md (DE.AE-3) and ISO.md (A.8.15)

### What Should Be Logged

| Event | Data | Priority |
|-------|------|----------|
| Login success | user_id, IP, timestamp, method (email/OAuth) | P0 |
| Login failure | email, IP, timestamp, reason | P0 |
| Logout | user_id, IP, timestamp | P0 |
| Password reset request | email, method (email/SMS), IP | P0 |
| Session expiry | user_id, reason (sliding/hard), timestamp | P1 |
| Account lockout | user_id, attempt_count, locked_until | P1 |
| Snapshot creation | user_id, snapshot_id, coords | P2 |
| LLM call | role, model, tokens_in, tokens_out, latency_ms, cost_estimate | P2 |
| Admin action | agent_id, action_type, target | P2 |

### Current Auth Logging

`auth_credentials` table stores `last_login_at`, `last_login_ip`, `failed_login_attempts` — but this is **state**, not an **event log**. When a user logs in, the previous login info is overwritten.

### Recommended: `audit_log` Table

```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,      -- 'login_success', 'login_failure', 'logout', etc.
  user_id UUID,                  -- May be null for failed logins
  ip_address TEXT,
  user_agent TEXT,
  details JSONB,                 -- Event-specific data
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_log_user ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_log_type ON audit_log(event_type, created_at DESC);
```

---

## 8. Log Destinations and Rotation

### Current Destinations

| Destination | What Goes There |
|-------------|----------------|
| `console.log/warn/error` | ALL logs (default) |
| NDJSON (stdout) | Health check events only |
| `/tmp/worker.log` | Strategy worker output (optional, Replit only) |
| `ndjsonLog()` | Machine-readable health events |

### Log Rotation

**Not implemented.** Console output is ephemeral — lost on restart. No log files persisted to disk beyond `/tmp/worker.log`.

### Recommended Observability Pipeline

```
Application Logs (structured JSON)
  └─ stdout/stderr
       └─ Log aggregator (Datadog/ELK/Loki)
            ├─ Dashboards (latency, error rates, LLM costs)
            ├─ Alerts (auth failures >10/min, rate limits, 5xx spikes)
            └─ Retention (30 days hot, 90 days cold)
```

---

## 9. Current State

| Area | Status |
|------|--------|
| Module-scoped loggers | Working — 10 pre-configured domains |
| Workflow phase tracking | Working — 7 domains with phase labels |
| Correlation IDs | Working — per-request, single process |
| Health endpoints (6) | Working — liveness, pool stats, metrics |
| AI health monitoring | Working — auto-healing |
| Job queue monitoring | Working — metrics + DLQ |
| NDJSON structured output | Partial — health events only |
| Audit log | **NOT IMPLEMENTED** |
| Centralized logging | **NOT IMPLEMENTED** |
| Alerting | **NOT IMPLEMENTED** |

---

## 10. Known Gaps

1. **No persistent audit log** — Auth events logged to console only, not DB. NIST DE.AE-3 and ISO A.8.15 non-compliant.
2. **No centralized log aggregation** — Console-only output, lost on restart.
3. **No alerting** — No notification on failed login spikes, rate limit exhaustion, or 5xx errors.
4. **No frontend error tracking** — React ErrorBoundary catches but doesn't report to server.
5. **No distributed tracing** — Correlation IDs don't span across Eidolon or external APIs.
6. **No LLM cost tracking** — Tokens logged but not converted to dollar cost.
7. **NDJSON not applied globally** — Only health events use structured JSON format.

---

## 11. TODO — Hardening Work

- [ ] **Create `audit_log` table** — Log all auth events with user_id, IP, timestamp (P0, NIST/ISO requirement)
- [ ] **Centralized logging** — Structured JSON to Datadog, ELK, or Loki (P1)
- [ ] **Alerting rules** — Failed logins >10/min, rate limit spikes, 5xx errors >1% (P1)
- [ ] **Frontend error reporting** — Send ErrorBoundary catches to server-side logger (P2)
- [ ] **Apply NDJSON globally** — All logs as structured JSON, not console.log strings (P2)
- [ ] **LLM cost dashboard** — Compute cost from token counts per model per role (P2)
- [ ] **Distributed tracing** — OpenTelemetry integration for cross-service correlation (P3)
- [ ] **Log retention policy** — Define hot (30d), warm (90d), cold (1yr) tiers (P3)

---

## Key Files

| File | Purpose |
|------|---------|
| `server/logger/logger.js` | Core logger (61 lines) |
| `server/logger/workflow.js` | Workflow-aware logging (459 lines) |
| `server/logger/ndjson.js` | Structured JSON output (5 lines) |
| `server/lib/ai/unified-ai-capabilities.js` | AI health monitoring (226 lines) |
| `server/lib/infrastructure/job-queue.js` | Job metrics + DLQ (134 lines) |
| `server/api/health/` | Health check endpoints |
