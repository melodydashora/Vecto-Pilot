# SDK.md — Eidolon SDK Documentation

> **Canonical reference** for the Eidolon agent server: architecture, tool definitions, API surface, and integration with the main app.
> Last updated: 2026-04-10

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Agent Server](#2-agent-server)
3. [Core Components](#3-core-components)
4. [API Surface](#4-api-surface)
5. [Memory Persistence](#5-memory-persistence)
6. [Authentication](#6-authentication)
7. [Integration with Main App](#7-integration-with-main-app)
8. [Current State](#8-current-state)
9. [Known Gaps](#9-known-gaps)
10. [TODO — Hardening Work](#10-todo--hardening-work)

---

## 1. Architecture Overview

Eidolon is a **standalone agent server** that runs alongside the main Vecto Pilot app. It provides an AI agent with full system access: filesystem, shell, database, and network.

```
Main App (gateway-server.js)     Eidolon (agent-server.js)
     Port 3000                        Port 43717
         │                                │
         │  Shared PostgreSQL DB          │
         └────────────────────────────────┘
```

**Version:** 8.0.0-unified-max
**Identity:** Eidolon Unified AI — Complete IDE Integration
**Model:** Gemini 3.1 Pro Preview (1M context, high thinking)

---

## 2. Agent Server

**Entry:** `agent-server.js` (28,640 bytes)
**Port:** `AGENT_PORT` env var or 43717 default
**Host:** `0.0.0.0` (all interfaces)

### Capabilities

- File system: Full read/write/delete/create/rename
- Shell: Whitelisted command execution (git, npm, node, grep, find, cat, ls)
- Database: Complete SQL (DDL/DML/DQL) via shared PostgreSQL
- Network: HTTP, WebSocket, API integration
- Memory: Enhanced with cross-chat awareness
- Reasoning: Deep thinking and predictive analysis
- Circuit Breaker: Active with override capability
- Recovery: Autonomous recovery & auto-remediation

---

## 3. Core Components

**Directory:** `server/eidolon/`

| Component | File | Purpose |
|-----------|------|---------|
| Config | `config.ts` | System identity, AI model config |
| LLM Client | `core/llm.ts` | Claude API wrapper with token tracking |
| Context Awareness | `core/context-awareness.ts` | Workspace state snapshots |
| Deep Thinking | `core/deep-thinking-engine.ts` | Multi-step reasoning |
| Memory Enhanced | `core/memory-enhanced.ts` | Cross-session persistence |
| Memory Store | `core/memory-store.ts` | JSON storage utilities |
| Code Map | `core/code-map.ts` | Codebase structure mapping |
| Deployment Tracker | `core/deployment-tracker.ts` | Environment state |
| PostgreSQL Memory | `memory/pg.js` | DB-backed memory ops |
| Memory Compactor | `memory/compactor.js` | Hourly TTL cleanup |
| SQL Client | `tools/sql-client.ts` | Type-safe DB queries |
| Enhanced Context | `enhanced-context.js` | Context enrichment |
| Policy Loader | `policy-loader.js` | Config policy loading |

---

## 4. API Surface

### Health

| Endpoint | Response |
|----------|----------|
| `GET /health` | 200 OK |
| `GET /ready` | READY |
| `GET /agent/health` | Pool stats + port info |
| `GET /healthz` | OpenTelemetry-compatible |

### File Operations (Auth Required)

| Endpoint | Purpose |
|----------|---------|
| `POST /agent/fs/read` | Read file (max 10MB) |
| `POST /agent/fs/write` | Write/create file |

### Shell (Auth Required)

| Endpoint | Purpose |
|----------|---------|
| `POST /agent/shell` | Execute whitelisted command |

### Database (Auth Required)

| Endpoint | Purpose |
|----------|---------|
| `POST /agent/sql/query` | Execute SELECT |
| `POST /agent/sql/execute` | Execute INSERT/UPDATE/DELETE |

### Configuration

| Endpoint | Purpose |
|----------|---------|
| `GET /agent/config/list` | List env vars |
| `GET /agent/config/read/:filename` | Read config file |
| `POST /agent/config/env/update` | Update env vars |
| `POST /agent/config/backup/:filename` | Backup file |

### Memory & Context

| Endpoint | Purpose |
|----------|---------|
| `POST /agent/memory/preference` | Store preference |
| `POST /agent/memory/session` | Store session memory |
| `POST /agent/memory/project` | Store project memory |
| `GET /agent/context` | Workspace context |
| `GET /agent/context/summary` | Context summary |
| `GET /agent/context/enhanced` | Enriched context |
| `POST /agent/memory/conversation` | Store conversation |
| `GET /agent/memory/conversations` | List conversations |

### Advanced

| Endpoint | Purpose |
|----------|---------|
| `POST /agent/search/internet` | Internet search |
| `GET /agent/analyze/deep` | Deep analysis |

---

## 5. Memory Persistence

### DB Tables

- `agent_memory` — Agent-specific entries
- `assistant_memory` — Assistant state
- `eidolon_memory` — Cross-session persistence (user_id scoped)
- `cross_thread_memory` — Cross-chat awareness (thread_id scoped)

### Operations

```javascript
memoryPut(scope, key, content, options)   // Upsert
memoryGet(scope, key)                     // Retrieve
memoryList(scope, options)                // List entries
memoryDel(scope, key)                     // Delete
memoryCompact()                           // Remove expired (hourly)
```

### Scopes

- `project` — Project-wide state
- `user` — Per-user state
- `session` — Session-scoped (temporary)

### Compaction

Hourly job removes entries older than TTL (default 30 days).

---

## 6. Authentication

- **Method:** Bearer token in `Authorization` header
- **Token source:** `AGENT_TOKEN` env var
- **Rate limit:** 100 requests per 15 minutes per IP
- **CORS:** Enabled, credentials=false
- **Payload limits:** JSON 10MB, URL-encoded 1MB
- **Path traversal:** Protected via path resolution validation

---

## 7. Integration with Main App

### Shared Database

Both servers connect to the same PostgreSQL instance via `DATABASE_URL`. Eidolon has full SQL access — can read and write all tables.

### No HTTP Integration

The main app does NOT call Eidolon's API. They operate independently, sharing only the database. Eidolon is used as an IDE-integrated AI agent, not as a runtime service for the app.

### UnifiedAIManager

**File:** `server/lib/ai/unified-ai-capabilities.js`

The `UnifiedAIManager` class checks Eidolon's health as part of the AI system monitoring:
- Checks Eidolon endpoint availability
- Reports health state alongside Atlas and Assistant components
- Does not control Eidolon — only observes

---

## 8. Current State

| Area | Status |
|------|--------|
| Agent server running | Working — port 43717 |
| File operations | Working |
| Shell (whitelisted) | Working |
| SQL access | Working |
| Memory persistence (4 tables) | Working |
| Health monitoring | Working |

---

## 9. Known Gaps

1. **Not used at runtime** — Eidolon is an IDE tool, not a production service. No user-facing features depend on it.
2. **Full DB access** — No row-level access control. Agent can read/write any user's data.
3. **Shell whitelist is limited** — Only basic commands. More complex operations may fail.
4. **No audit trail** — Agent changes logged to `agent_changes` table but not comprehensively.

---

## 10. TODO — Hardening Work

- [ ] **Evaluate production role** — Determine if Eidolon should be a user-facing service or remain IDE-only
- [ ] **Add DB access scoping** — Restrict agent SQL to read-only for user data tables
- [ ] **Comprehensive audit logging** — Log all file writes, DB mutations, and shell commands
- [ ] **Rate limit per operation type** — Different limits for read vs write vs shell

---

## Key Files

| File | Purpose |
|------|---------|
| `agent-server.js` | Eidolon entry point |
| `server/eidolon/config.ts` | Configuration |
| `server/eidolon/core/` | Core components (7 files) |
| `server/eidolon/memory/pg.js` | DB-backed memory |
| `server/eidolon/memory/compactor.js` | TTL cleanup |
| `server/eidolon/tools/sql-client.ts` | SQL execution |
