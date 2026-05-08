# Agent Bridge — Public `/agent` → Standalone agent-server.js

**Status:** Pending testing approval (Melody) per CLAUDE.md Rule 1.
**Date:** 2026-05-08
**Author:** Claude Code (Opus 4.7)

---

## Objective

Make the standalone `agent-server.js` surface (running on `localhost:43717`, loopback-only) reachable from the public Replit URL (`*.replit.dev/agent/*`) via the gateway, so external clients (MCP env, browser tools, Claude Desktop, etc.) can call `/agent/fs/read`, `/agent/shell`, `/agent/sql/*`, and `/agent/search/internet` without being inside the workspace.

## Current state (before bridge)

| Surface | Address | Auth scheme | Routes available |
|---|---|---|---|
| Standalone | `localhost:43717` (loopback) | `x-agent-token` header | ~25: fs/shell/sql/memory/context/search/config |
| Gateway-embedded | `*.replit.dev/agent/*` (public, port 5000) | `Authorization: Bearer` user token *or* `x-vecto-agent-secret` Service Account | ~17: thread/memory/context/search/config (no fs/shell/sql) |

The two agents grew separately; the public surface is missing the high-power endpoints (fs/shell/sql) on purpose because exposing them publicly without the bridge's auth-translation layer would leak the standalone token format and bypass the gateway's IP allowlist + bot-blocker chain.

## After bridge

External callers reach the full standalone surface through the gateway's auth+allowlist layers:

```
External → bot-blocker (UA check) → requireAuth (Bearer | x-vecto-agent-secret | x-claude-bridge-token)
        → IP allowlist (checkAgentAllowlist) → bridge proxy → 127.0.0.1:43717/agent/* (with x-agent-token injected)
        → response back through gateway
```

The standalone token (`AGENT_TOKEN`) never leaves the workspace; external callers never need to know it exists.

## Files affected

| File | Change | Lines (approx) |
|---|---|---|
| `server/agent/bridge.js` | NEW — exports `proxyToStandaloneAgent` middleware | ~80 |
| `server/agent/embed.js` | MODIFY — import bridge, mount it as catch-all *after* existing routes | +5 |
| `server/middleware/auth.js` | MODIFY — extend `validateAgentAuth` to also accept `x-claude-bridge-token` header | +12 |
| `docs/architecture/agent-bridge.md` | NEW — this file | ~120 |

## Auth flow detail

`validateAgentAuth` already accepts `x-vecto-agent-secret` for Service Account auth. We add a parallel check for `x-claude-bridge-token` so:

- `VECTO_AGENT_SECRET` — existing, broad Service Account access. Used by MCP env, infra checks, etc.
- `CLAUDE_BRIDGE_TOKEN` — new, narrow Claude-only access. Can be rotated independently as a kill-switch for Claude's bridge usage without disturbing other Service Account consumers.

Both grant identical capability (system user, `isAgent: true`); the separation is operational, not authoritative — easy revocation.

## Security posture

**Before bridge:** an attacker who steals `VECTO_AGENT_SECRET` gets `/agent/thread/*`, `/agent/memory/*`, `/agent/config/list`, `/agent/context/*` — read-heavy, write-limited.

**After bridge:** the same stolen secret gets `/agent/shell` (arbitrary `execFile`), `/agent/fs/write` (arbitrary file write within workspace), `/agent/sql/execute` (arbitrary DB write) plus everything that was previously reachable.

**Mitigations:**
1. **Two-token separation** (above) — rotate Claude's token without breaking other consumers.
2. **Structured audit logging** — every proxied call logs `method/path/auth-type/status/elapsed_ms` via `console.log`; downstream `agent-server.js` ALSO logs to `data/agent-logs/` (double-record, intentional).
3. **Bot-blocker still in front** — non-browser UAs get 403 before reaching auth.
4. **IP allowlist still in front** — `checkAgentAllowlist` runs before the proxy; production won't allow `*` wildcard.
5. **`AGENT_SHELL_WHITELIST=*` in dev only** — production should set to a real allowlist or unset (defaults to ALLOWED_COMMANDS hardcoded set).

## Non-goals

- **Not** changing the standalone agent's auth (`x-agent-token` stays exactly as it is on 43717).
- **Not** changing the gateway-embedded routes that already exist (thread/memory/context). Those keep working from `server/agent/routes.js`; the bridge is additive.
- **Not** adding new endpoints. The bridge is a transparent proxy — it exposes whatever 43717 exposes, no more, no less.
- **Not** caching or transforming responses. The proxy is byte-faithful (modulo hop-by-hop header strip).

## Test plan (REQUIRES Melody's approval before merging)

| # | Test | Expected | Result (2026-05-08 verification run) |
|---|---|---|---|
| 1 | `GET /agent/health` (no auth, browser UA) | 401 `no_token` ⚠️ pre-existing wart — `embed.js:120` comment claims "PUBLIC" but `app.use` mount on `embed.js:115` runs requireAuth first; auth-gates the health route. Not introduced by the bridge. | ✅ 401 (matches actual behavior) |
| 2 | `GET /agent/health` (curl, no UA spoof) | 403 bot-blocker (unchanged) | ✅ 403 |
| 3 | `POST /agent/shell` with `x-vecto-agent-secret` + browser UA, body `{"cmd":"git","args":["status","--short"]}` | 200, returns same shell output as direct call to 43717 | ✅ 200, 72ms |
| 4 | `POST /agent/shell` with `x-claude-bridge-token` + browser UA, body `{"cmd":"node","args":["--version"]}` | 200, identical response shape | ✅ 200, 33ms, returned `v20.20.0\n` |
| 5 | `POST /agent/shell` with NO auth + browser UA | 401 `no_token` | ✅ 401 |
| 6 | `POST /agent/shell` with WRONG token (random 64-char hex of correct length) | 401 `no_token` (constant-time compare in validateAgentAuth rejects) | ✅ 401 |
| 7 | `GET /agent/threads/recent` with `x-vecto-agent-secret` (existing embedded route, NOT proxied) | 200 from gateway-embedded routes.js — bridge does not interfere | ✅ 200, `{threads:[],count:0}` |
| 8 | `POST /agent/fs/read` with `x-claude-bridge-token`, body `{"path":"package.json"}` | 200, returns package.json contents | ✅ 200, 6ms |
| 9 | Standalone agent-server.js stopped, then `POST /agent/shell` via bridge | 502 `AGENT_BRIDGE_FAILURE` (graceful fail) | ⏭️ Skipped — would require killing the agent. Code path verified by inspection (`bridge.js` try/catch around `fetch` returns 502 with explicit error). |
| 10 | Audit log: `[AGENT-BRIDGE] METHOD /path → STATUS (Nms) auth=<source>` in `logs/server-current.log` + JSON entry in `data/agent-logs/` for every standalone-handled call | Both visible | ✅ Verified — gateway log has 3 entries with `auth=service-account` (then upgraded to `auth=vecto-secret`/`auth=claude-bridge` per-token after the 2026-05-08 follow-up commit). Standalone log has matching JSON entries with PID + cmd/args/exitCode/elapsedMs. |

## Open questions for Melody

1. **Secret name:** I'm using `CLAUDE_BRIDGE_TOKEN`. If you'd prefer a different name (e.g. `AGENT_BRIDGE_TOKEN`, `MELODY_CLAUDE_TOKEN`), tell me and I'll rename the auth.js check.
2. **Production posture:** the bridge will work in production iff `AGENT_ENABLED=true` and `VECTO_AGENT_SECRET` is set. Should I add an explicit `BRIDGE_ENABLED` flag for prod kill-switch separate from the agent itself?
3. **WebSocket coverage:** the standalone agent doesn't have WebSocket; the gateway-embedded does (`/agent/ws`). Bridge is HTTP-only — confirm that's fine.

## Rollback

Single-file revert of `server/agent/embed.js` (remove the `app.use(basePath, proxyToStandaloneAgent)` line). The bridge.js file becomes inert. The auth.js change is forward-compatible — leaving the `x-claude-bridge-token` check in place when `CLAUDE_BRIDGE_TOKEN` is unset is harmless (auth header check returns null).
