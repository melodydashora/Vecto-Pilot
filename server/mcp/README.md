# server/mcp/

Modules for the standalone Model Context Protocol server, `mcp-server.js` (repo root).

| File | Purpose |
|---|---|
| `create-server.js` | `createVectoMcpServer()` — tools + resources, transport-agnostic |
| `continuity-store.js` | Drizzle access to `claude_memory`, `todo`, `lessons_learned`, `definitions`, `app_rules` (additive only; `db` injected) |
| `continuity-tools.js` | MCP tool registrations over the store |
| `repo-tools.js` | Read-only file / dir / grep / git tools with path guards |
| `http-app.js` | Express 4 app hosting the Streamable HTTP transport at `/mcp` |
| `auth.js` | `MCP_TOKEN` bearer guard (constant-time) |

Separate from `server/agent/` and the gateway `/agent/*` bridge by design (Melody, 2026-09-03). Full as-built, tool table, wiring, and the open decisions: [`docs/architecture/mcp-server.md`](../../docs/architecture/mcp-server.md). Tests: `tests/mcp/`.
