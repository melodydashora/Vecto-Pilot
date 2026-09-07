# MCP Server — standalone Model Context Protocol surface

**Status:** Shipped uncommitted 2026-09-03. Every default marked ⚖️ below is a Claude-chosen candidate that Melody may overrule — tracked as todo #73 (decisions) and #74 (dead env names); session record: claude_memory #385.
**Date:** 2026-09-03
**Author:** Claude Code (Fable 5.1) — Claude-authored as-built. Melody's requirement is quoted verbatim; nothing else here is Melody-authored.
**Requirement provenance:** Melody added `@modelcontextprotocol/sdk@^1.30.0` to `package.json` on 2026-08-29 (uncommitted, nothing imported it) and said on 2026-09-03: *"The MCP needs to be seperate than the bridge."* No row in `claude_memory`, `todo`, or `definitions` recorded any other intent, so the tool set and defaults are candidates, not decisions.

---

## 1 · What it is, and what it is not

- A **real MCP-protocol server**: JSON-RPC 2.0 over the official `@modelcontextprotocol/sdk` (protocol `2025-06-18`), speaking Streamable HTTP or stdio. MCP clients (Claude Code, Claude Desktop / Cowork, claude.ai connectors) discover and call its tools natively.
- **Not** the 2025-12 `mcp-server/` + `server/api/mcp/` surface. That was a custom Express "tools" HTTP API (`GET /mcp/tools`, `POST /mcp/tools/:name`) that never spoke the MCP protocol; it was removed 2025-12-28 (commit `609a943d`). Several docs still described it as current — corrected in §9.
- **Separate from the agent bridge**, per Melody. Concretely:

| Surface | Process | Port (env) | Token (env name) | In gateway? | Capabilities |
|---|---|---|---|---|---|
| `agent-server.js` | standalone | 43717 (`AGENT_PORT`) | `AGENT_TOKEN` | reachable via the bridge | fs read/write, shell (whitelist), SQL query/execute, legacy memory tables, config |
| gateway `/agent/*` + `server/agent/bridge.js` | `gateway-server.js` | 5000 | `VECTO_AGENT_SECRET`, `CLAUDE_BRIDGE_TOKEN` | yes | embedded thread/memory/context routes + proxy to 43717 |
| **`mcp-server.js`** | **standalone** | **5055 (`MCP_PORT`)** ⚖️ | **`MCP_TOKEN`** | **no** | continuity tables (read + additive write) + read-only repo tools |

Nothing in the MCP server imports `server/agent/*`, `server/middleware/auth.js`, or `server/lib/auth.js`; no token is shared; nothing is mounted under `/agent` or proxied through 43717. Shell, SQL, and file writes are deliberately absent — they remain on the agent server behind its own token.

## 2 · Files

| File | Role |
|---|---|
| `mcp-server.js` (root) | Process entry. Env parsing, stdio-vs-HTTP selection, fail-loud boot, graceful shutdown. Mirrors `agent-server.js` placement. |
| `server/mcp/create-server.js` | `createVectoMcpServer({ store, baseDir, version, readOnly, audit })` — one factory used by HTTP, stdio, and tests. Registers tools + the three doc resources. |
| `server/mcp/continuity-store.js` | Drizzle data access for the five continuity tables. Takes `db` as an argument (no import-time pool). Additive-only contract. |
| `server/mcp/continuity-tools.js` | Tool registrations over the store; zod v4 input schemas; provenance stamp on writes. |
| `server/mcp/repo-tools.js` | Read-only file / dir / grep / git tools with traversal guard, deny list, and `git check-ignore`. |
| `server/mcp/http-app.js` | Express 4 app: `/health`, `/mcp` (POST/GET/DELETE), bearer guard, rate limit, per-session transport map. |
| `server/mcp/auth.js` | `MCP_TOKEN` bearer guard, constant-time compare, ≥32-char boot check. |
| `tests/mcp/*.test.js` | 29 tests: protocol-level (real MCP `Client` over `InMemoryTransport`), HTTP auth/session lifecycle (supertest), path guards. `tests/mcp/fake-store.js` is the DB stand-in. |

## 3 · Tools

All results carry both `content[0].text` (pretty JSON) and `structuredContent` (the same data; arrays are wrapped as `{ rows }`). Validation failures and unknown tools return `isError: true` with an `MCP error -32602: …` message naming the field — never a silent null. Every call logs one line to stderr: `[mcp] tool=<name> ok|error ms=<n> session=<8 chars>`.

### Tier 0 — read-only (always registered)

| Tool | Arguments | Notes |
|---|---|---|
| `boot_context` | `limit?` | The CLAUDE.md §3 wake-up pack in one call: active `app_rules` verbatim, newest active `claude_memory` titles, every open/in_progress `todo`, newest `lessons_learned`, all `definitions` terms, plus counts. |
| `memory_search` | `query? category? status? tag? limit?` | `status` defaults to `active`; `any` disables. `query` is ILIKE on title/content; `tag` is an exact jsonb containment match. |
| `memory_get` | `id` | Row + parent chain (via `parent_id`, nearest first, ≤5) + direct children. |
| `todo_list` | `statuses? limit?` | Default `['open','in_progress']`, ordered priority asc then newest. |
| `lessons_list` | `severity? limit?` | Newest first. |
| `definitions_lookup` | `query? limit?` | ILIKE over term / aliases / meaning; no query lists every term. |
| `app_rules_list` | `status?` | Melody's doctrine, verbatim with provenance. **No write tool exists for this table.** |
| `repo_read_file` | `path offset? limit?` | UTF-8 text, ≤512 KB or a line slice. Refuses: traversal, `.env*` (except `*.example`), key/cert files, `.replit-assistant-override.json`, gitignored paths, and `node_modules .git .cache .local .worktrees logs data dist coverage .npm`. |
| `repo_list_dir` | `path?` | Denied directories are omitted from listings. |
| `repo_search` | `pattern path? glob? max_results?` | `grep -rnIE` with fixed args; pattern passed after `-e` so it can never be read as an option; ≤200 rows. |
| `repo_git` | `subcommand count?` | Exactly `status`, `log`, `diff_stat` — fixed argument templates, no mutation possible. |

### Tier 1 — additive writes (registered unless `MCP_READ_ONLY` is truthy) ⚖️

| Tool | Arguments | Guard |
|---|---|---|
| `memory_add` | `session_id category title content source? priority? tags? related_files? parent_id? metadata?` | `parent_id` must exist. `metadata.mcp_client = {name, version}` from the initialize handshake is always stamped (provenance, AI_PARTNERSHIP_AGREEMENT §4). `source` defaults to `mcp` ⚖️. |
| `memory_set_status` | `id status` | `status` ∈ `active resolved superseded done pending archived disputed` — the union of the schema comment and the values live in the table on 2026-09-03 ⚖️. |
| `todo_add` | `title detail? priority? source_memory_id?` | `priority` int (1 = highest), default 3. |
| `todo_set_status` | `id status` | `open in_progress done wontfix` — mirrors `todo_status_check` exactly. |
| `lesson_add` | `lesson trigger? rule? severity?` | `severity` ∈ `low medium high critical`. |
| `definition_add` | `term meaning location? aliases?` | Fails loud with the existing row if the term exists. |
| `definition_update` | `id meaning? location? aliases?` | By id only; term immutable here; at least one field required. |

There is **no delete** anywhere and no write path to `app_rules` (CLAUDE.md §5; agreement §9.3).

### Resources

`vecto://doc/CLAUDE.md`, `vecto://doc/AI_PARTNERSHIP_AGREEMENT.md`, `vecto://doc/ARCHITECTURE.md` (text/markdown) so a connected session can read the wake-up protocol and constitution without a file round-trip. The server's `instructions` string tells clients to call `boot_context` first.

## 4 · Transports and wiring

```bash
# HTTP (remote clients). Needs MCP_TOKEN (≥32 chars) or it refuses to start.
set -a && . ./.env.local && set +a && npm run mcp        # → http://MCP_HOST:MCP_PORT/mcp

# stdio (same-machine clients). No token: the process belongs to the client.
npm run mcp:stdio
```

Claude Code, HTTP:
```bash
claude mcp add --transport http vecto-pilot http://127.0.0.1:5055/mcp \
  --header "Authorization: Bearer $MCP_TOKEN"
```
Claude Code, stdio (from inside this workspace):
```bash
claude mcp add vecto-pilot -- node /home/runner/workspace/mcp-server.js --stdio
```
Claude Desktop / Cowork: a remote connector pointed at the public `MCP_PORT` mapping with the bearer header, **if** that client can send a static bearer header — see §8 open question 1.

HTTP session model: stateful per the SDK reference pattern. `initialize` mints an `Mcp-Session-Id`; later POSTs, the GET SSE stream, and DELETE are routed by it. Sessions live in process memory (cap 64, LRU-evicted; a restart drops them and clients simply re-initialize). Default POST responses are SSE; `MCP_JSON_RESPONSE=1` switches to plain JSON.

## 5 · Auth and security posture

- `MCP_TOKEN` is required for HTTP, minimum 32 chars, compared with `crypto.timingSafeEqual`; boot fails with a descriptive message otherwise. `/health` is the only unauthenticated route and returns no secrets.
- Rate limit 240 req/min on `/mcp`; `trust proxy` set to 1 for Replit's proxy.
- Repo tools cannot read secrets even with a valid token (deny list + gitignore check, tested). Source code **is** readable — appropriate for this repo, but note it when choosing the bind host.
- Bind host ⚖️ defaults to `0.0.0.0`, like `agent-server.js`, because Replit's port forwarding (`.replit` maps local 5055 → external 6000) needs a non-loopback bind. Set `MCP_HOST=127.0.0.1` for a workspace-only server.
- No OAuth. The SDK ships `requireBearerAuth` and provider interfaces (`server/auth/*`) if a client turns out to require it.
- stdio mode redirects `console.log`/`console.info` to stderr before importing the DB layer, so stdout stays pure JSON-RPC (verified). It also exits on stdin EOF — the SDK transport does not listen for `end`, and the pg pool would otherwise keep the process alive.

## 6 · Environment (names only; values live in `.env.local`)

| Name | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Fail-loud at import via `server/db/connection-manager.js`; the only DB selector (CLAUDE.md §5). |
| `MCP_TOKEN` | HTTP only | — | Bearer token, ≥32 chars. Already declared in `.env.local.example` but was never read by any code before this change; the current `.env.local` value is 12 chars and must be regenerated (`openssl rand -hex 32`). |
| `MCP_PORT` | no | `5055` ⚖️ | Listen port. |
| `MCP_HOST` | no | `0.0.0.0` ⚖️ | Bind host. |
| `MCP_READ_ONLY` | no | unset ⚖️ | `1`/`true` → no write tools registered. |
| `MCP_JSON_RESPONSE` | no | unset | `1`/`true` → JSON instead of SSE for POST responses. |
| `BASE_DIR` | no | repo root | Root for repo tools (same variable `agent-server.js` uses). |

`MCP_REPLIT_TOKEN` and `VITE_MCP_REPLIT_TOKEN` are also declared in `.env.local(.example)` but are not read by any code as of 2026-09-03 (verified by grep). Their fate is Melody's call; nothing here uses them.

## 7 · Verification (2026-09-03)

- `npm run lint` clean with `mcp-server.js` added to the lint globs and the ESLint server-JS block; `npm run typecheck` clean.
- `jest tests/mcp`: 29/29. Protocol tests run a real MCP `Client` over `InMemoryTransport`; HTTP tests exercise the real Streamable HTTP transport via supertest.
- Live HTTP smoke against the dev DB on 127.0.0.1:5056 (default SSE mode): 401 without token; initialize → session id + `serverInfo vecto-pilot@4.3.0`; `tools/list` → 18 tools; `boot_context` → 322 active memory rows, 51 open todos, 33 lessons, 14 definitions, 14 app_rules; `memory_search`, `memory_get`, `definitions_lookup`, `repo_git status` all returned live rows; `.env.local` read denied; `resources/read` returned CLAUDE.md; DELETE 200; token absent from logs.
- Live stdio smoke: 2/2 stdout lines were JSON-RPC, exit 0 on EOF.
- Not exercised live: the write tools against the real DB (they are covered at the protocol layer with the fake store; the first real write will be this session's own `claude_memory` row via psql, and the SQL is identical Drizzle inserts).

## 8 · Open questions for Melody (one-word answers suffice; todo #73) ⚖️

1. **Client:** which MCP client is "the MCP" for — Cowork / Claude Desktop, a claude.ai custom connector, or Claude Code in this workspace? If that client cannot send a static `Authorization: Bearer` header and needs OAuth, that is the next build.
2. **Port:** is `5055` (mapped to external `6000` in `.replit` by the 2026-08-27 commit) reserved for this? The only other use of 5055 was a disposable smoke boot on 2026-08-26.
3. **Bind host:** `0.0.0.0` (reachable through the Replit mapping) or `127.0.0.1` (workspace-only)?
4. **Writes on by default**, or ship read-only until the client is trusted?
5. **Run workflow:** add a third `.replit` Run task (like the agent server's) so it boots with the Project workflow? Not done — that changes what the Run button starts.
6. **Token:** reuse the existing `MCP_TOKEN` name (regenerated to 32+ chars) or a new name?
7. **Next tier:** should MCP ever expose shell / SQL / file writes, or does that stay on the agent server permanently?

## 9 · Docs corrected in this change

- `docs/architecture/server-structure.md` — removed the stale `api/mcp/` entries; added `server/mcp/` and `mcp-server.js`.
- `docs/memory/README.md` — "The MCP server was removed" now distinguishes the removed 2025 API from this server and its different table set.
- `docs/architecture/README.md` — indexed this doc; added the MCP runtime entrypoint.
- `docs/architecture/agent-bridge.md` — cross-reference stating the MCP server is not part of the bridge.
- `.env.local.example` — MCP block documented.

## Rollback

Delete `mcp-server.js`, `server/mcp/`, `tests/mcp/`, and revert the two-line additions to `package.json` scripts/lint and `eslint.config.js`. Nothing else references them; no schema, no gateway route, no `.replit` task was changed.
