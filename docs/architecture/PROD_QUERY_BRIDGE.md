# Prod Query Bridge (read-only)

> Lets the terminal dev agent (Claude Code) **monitor and analyze production data** without a direct DB connection. On current Replit infrastructure the prod database is **app-scoped** — only the deployed app's runtime can reach it; psql / external clients cannot (see `DATABASE_ENVIRONMENTS.md` and `claude_memory #351`). So the agent talks to the deployed **app** over HTTPS, and the app reaches prod.

## Security model — capability, not validation

- **Auth:** every route requires an agent/bridge token (`x-claude-bridge-token` → `CLAUDE_BRIDGE_TOKEN`, or `x-vecto-agent-secret` → `VECTO_AGENT_SECRET`), constant-time compared (`requireAgentOnly` in `server/middleware/auth.js`). No end-user session can reach these routes.
- **Structured** `GET /api/admin/offer-monitor`: fixed Drizzle `SELECT`s only → **zero user-SQL surface**. Runs on the app pool. Safe by construction.
- **Raw** `POST /api/admin/query`: arbitrary `SELECT`, but executed under a **dedicated read-only role** (`VECTO_READONLY_DATABASE_URL`) that *physically* cannot write or read non-allowlisted tables. Plus per-transaction `SET TRANSACTION READ ONLY`, `statement_timeout`, a single-statement / `SELECT`|`WITH`-prefix check, and a 1000-row cap. If the read-only role is **not** configured, raw query is **disabled (503)** — it never falls back to the app's full-privilege pool.

The role — not a regex — is the guarantee. The string checks are defense-in-depth.

## One-time setup

Run on **PROD** via the Replit Database tool → **Production** → SQL runner:

```sql
CREATE ROLE vecto_readonly WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '<strong-password>';
GRANT CONNECT ON DATABASE <prod_db> TO vecto_readonly;
GRANT USAGE  ON SCHEMA public TO vecto_readonly;
-- allowlist: analytical tables only
GRANT SELECT ON offer_intelligence, zone_intelligence, discovered_events,
                coach_conversations, coach_memos TO vecto_readonly;
ALTER ROLE vecto_readonly SET statement_timeout = '10000';                 -- 10s hard cap
ALTER ROLE vecto_readonly SET default_transaction_read_only = on;          -- belt: never writes
ALTER ROLE vecto_readonly SET idle_in_transaction_session_timeout = '15000';
```

**Harden against `PUBLIC`-granted functions** (a fresh role inherits `PUBLIC` EXECUTE on built-ins, which the table allowlist does not cover):
- `pg_sleep` and other heavy functions are bounded by the 10s `statement_timeout` (so the DoS is capped at one connection for 10s).
- `pg_read_file` / `COPY ... PROGRAM` require superuser or `pg_read_server_files` — the `NOSUPERUSER` role has neither, so they're already blocked.
- The one real residual vector is network-reaching **extensions** (`dblink`, `http`) *if installed*. On a stock Neon/Replit prod they aren't. If they are, revoke them: `REVOKE EXECUTE ON FUNCTION dblink(text, text) FROM PUBLIC;` (each overload). **Note:** `REVOKE … FROM PUBLIC` affects *all* roles — coordinate before running.

Then set secrets:

| Secret | Where | Purpose |
|--------|-------|---------|
| `VECTO_READONLY_DATABASE_URL` = `postgres://vecto_readonly:<pw>@<prod-host>/<db>?sslmode=require` | **Deployment** | the read-only role the raw `/query` runs under |
| `CLAUDE_BRIDGE_TOKEN` | **Deployment** (validate) + **dev workspace** (sign) | bridge auth |

> To add `VECTO_READONLY_DATABASE_URL` to the deployment: Deployments pane → Secrets. (Workspace secrets do **not** carry to the deployment.)

## Usage (from the dev terminal)

```bash
# Structured monitor (no raw SQL) — fleet-wide recent offers + stats:
node scripts/query-prod.js --monitor --limit=20

# Raw read-only SELECT:
node scripts/query-prod.js "SELECT created_at, ai_model, decision, confidence_score \
  FROM offer_intelligence ORDER BY created_at DESC LIMIT 10"

# Write JSON to a file for local analysis:
node scripts/query-prod.js --monitor --out=temp/prod-eval.json
```

> For deep multi-table analysis, pull to a JSON file and analyze **locally** — do **not** sync prod rows into the dev DB (breaks dev/prod isolation + driver-PII risk). The deliberately-dropped "sync prod→dev" idea is tracked in `todo #6`.

## Coach-memo access

`coach_memos` is in the allowlist specifically because the Coach writes memos to **prod**, while `npm run pull-coach-memos` reads the **dev** `DATABASE_URL` — so prod memos never reach the dev terminal that way. Use the bridge instead:

```bash
node scripts/query-prod.js "SELECT created_at, type, title, detail FROM coach_memos ORDER BY created_at DESC LIMIT 20"
```
