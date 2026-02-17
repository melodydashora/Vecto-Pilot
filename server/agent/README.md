Here is the updated documentation. I have updated the **Security Layers** and **Files** sections to reflect the strict file access control logic implemented in `server/agent/config-manager.js`.

> **Last Verified:** 2026-01-07

# Agent (`server/agent/`)

## Purpose

AI agent infrastructure for enhanced context and WebSocket communication.

## ⚠️ Security Notice (Updated 2026-01-07)

**This module exposes powerful admin operations and MUST be protected.**

### Required Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `AGENT_ENABLED` | `false` | Must be `'true'` to enable agent routes |
| `AGENT_ALLOWED_IPS` | `127.0.0.1,::1,localhost` | Comma-separated IP allowlist (⚠️ `*` blocked in prod) |
| `AGENT_ADMIN_USERS` | _(none)_ | Comma-separated user IDs for admin operations |

### Security Layers

1. **Env Gate:** Agent routes return 503 unless `AGENT_ENABLED=true`
2. **IP Allowlist:** Requests blocked unless from allowed IPs
   - ⚠️ **2026-01-07:** Wildcard `*` is now blocked in production
3. **Auth Required:** All routes (except `/health`) require valid JWT token
4. **Admin Required:** Dangerous operations (`/config/env/update`, `/config/backup`) require admin user
5. **WebSocket Auth:** WS connections require `?token=` query parameter
6. **File Access Control:** Configuration operations are restricted to a strict allowlist of files (e.g., `.env`, `package.json`, build configs) defined in `config-manager.js`.

### Admin-Only Routes (2026-01-07)

These routes require the authenticated user to be in `AGENT_ADMIN_USERS`:

| Route | Reason |
|-------|--------|
| `POST /config/env/update` | Can modify API keys, DB credentials, secrets |
| `POST /config/backup/:filename` | Backups could leak sensitive config files |

### Production Checklist

- [ ] `AGENT_ENABLED` is NOT set (disabled by default)
- [ ] If enabled, `AGENT_ALLOWED_IPS` is set to specific admin IPs (NOT `*`)
- [ ] `AGENT_ADMIN_USERS` contains only trusted user IDs
- [ ] Never expose `/agent` to public internet without auth proxy

## Files

| File | Purpose |
|------|---------|
| `embed.js` | Mount agent routes and WebSocket |
| `routes.js` | Agent API endpoints (context, memory, thread mgmt) |
| `enhanced-context.js` | Context enrichment wrapper (uses `../lib/ai/context/enhanced-context-base.js`) |
| `context-awareness.js` | Contextual data gathering |
| `config-manager.js` | Configuration file utilities (read, update, backup) with strict allowlist enforcement |
| `agent-override-llm.js` | Unified Claude Opus 4.6 provider with self-healing circuit breaker |
| `thread-context.js` | Thread context management |
| `index.ts` | TypeScript entry point |

## LLM Configuration (Updated 2026-01-07)

The agent uses a **Unified Configuration** centered on **Claude Opus 4.6** defined in `agent-override-llm.js`.

### Provider Strategy
- **Primary:** Anthropic (Claude Opus 4.6)
- **Fallback:** None (Single provider architecture)
- **Context Window:** 200k tokens (default)
- **Temperature:** 1.0 (High creativity/reasoning)

### Configuration Variables
The system uses specific overrides with fallbacks to standard agent variables.

| Variable | Fallback Chain | Description |
|----------|----------------|-------------|
| `AGENT_OVERRIDE_API_KEY_C` | `ANTHROPIC_API_KEY` | API Key for Anthropic |
| `AGENT_OVERRIDE_CLAUDE_MODEL` | `AGENT_MODEL` → `"claude-opus-4-6"` | The specific model identifier |
| `CLAUDE_MAX_TOKENS` | `AGENT_MAX_TOKENS` → `200000` | Max output tokens |
| `CLAUDE_TEMPERATURE` | `AGENT_TEMPERATURE` → `1.0` | Sampling temperature |

### Self-Healing Circuit Breaker
To prevent cascading failures and API quota exhaustion, the agent implements a circuit breaker mechanism:
1. **Trigger:** 3 consecutive failures.
2. **Action:** Circuit opens, rejecting requests immediately.
3. **Cooldown:** 60 seconds (1 minute).
4. **Recovery:** Automatically resets after cooldown on the next request.

The circuit state is exposed via the `/agent/health` endpoint.

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/agent/context` | GET | Get enhanced project context |
| `/agent/health` | GET | Agent health check (includes circuit breaker status) |
| `/agent/capabilities` | GET | Agent capabilities list |
| `/agent/memory/preference` | POST | Store user preference |
| `/agent/memory/session` | POST | Store session state |
| `/agent/memory/project` | POST | Store project state |
| `/agent/memory/conversation` | POST | Log conversation |
| `/agent/memory/conversations` | GET | Get conversation history |
| `/agent/thread/init` | POST | Initialize new thread |
| `/agent/thread/:id` | GET | Get thread context |
| `/agent/thread/:id/message` | POST | Add message to thread |

## Mounting

Agent is mounted in `server/bootstrap/routes.js` via `embed.js`:

```javascript
const { mountAgent } = await import('./server/agent/embed.js');
mountAgent({
  app,
  basePath: '/agent',
  wsPath: '/agent/ws',
  server,
});
```

**2026-01-06 Fix:** `embed.js` now imports and mounts `routes.js`. Previously, the routes were orphaned and `/agent/context` returned 404 (useMemory hook failed).

## Connections

- **Mounted by:** `../bootstrap/routes.js`
- **Uses:** AI adapters from `../lib/ai/`
- **WebSocket:** `/agent/ws` for real-time communication
- **Client hook:** `useMemory` in `client/src/hooks/useMemory.ts`