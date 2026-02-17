## ⚠️ Security Notice (Updated 2026-02-17)

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
   - ℹ️ **2026-02-17:** `/memory` routes are exempt from IP restrictions (safe for browser clients)
3. **Auth Required:** All routes (except `/health`) require valid JWT token
4. **Admin Required:** Dangerous operations (`/agent/config/env/update`, `/agent/config/backup`) require admin user
5. **WebSocket Auth:** WS connections require `?token=` query parameter
6. **File Access Control:** Configuration operations are restricted to a strict allowlist of files (e.g., `.env`, `package.json`, build/test/linting configs, Docker/Replit files, monorepo tools, root server files, and assistant policies) defined in `config-manager.js`.

### Admin-Only Routes (2026-01-07)

These routes require the authenticated user to be in `AGENT_ADMIN_USERS`:

| Route | Reason |
|-------|--------|
| `POST /agent/config/env/update` | Can modify API keys, DB credentials, secrets |
| `POST /agent/config/backup/:filename` | Backups could leak sensitive config files |

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
| `config-manager.js` | Configuration utilities (read, list, update, backup, env management) with strict allowlist enforcement |
| `agent-override-llm.js` | Unified Claude Opus 4.6 provider with self-healing circuit breaker |
| `thread-context.js` | Thread context management |
| `index.ts` | TypeScript entry point |