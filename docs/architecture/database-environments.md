# Database Environments: Dev vs. Prod

> **Last Updated:** 2026-02-26
> **Status:** Verified — Neon → Helium migration complete
> **Priority:** CRITICAL — Read this document at every session start

---

## TL;DR for AI Agents

| Aspect | Development | Production |
|--------|-------------|------------|
| **Provider** | Replit Helium (PostgreSQL 16, local) | Replit Helium (PostgreSQL 16, deployed) |
| **When active** | Replit workspace / editor | Published deployment (Cloud Run) |
| **DATABASE_URL** | Auto-injected by Replit (dev Helium) | Auto-injected by Replit (prod Helium) |
| **Data** | Test data, dev accounts | Real driver data, real conversations |
| **Schema** | Identical to prod | Identical to dev |
| **Data sync** | None — completely isolated | None — completely isolated |
| **SSL** | **No** (Helium runs locally) | **Yes** (production requires SSL) |
| **Cold starts** | No (always warm) | Minimal (Helium is lower-latency than Neon) |

**Golden Rule:** `DATABASE_URL` is the ONLY variable that matters. Replit injects it automatically. The application code does NOT need to know which database it's talking to.

> **Migration Note (2026-02-26):** Dev database migrated from Neon Serverless to Replit Helium. Old Neon connection saved as `NEON_DATABASE_URL` in Replit Secrets. `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD` env vars removed. SSL disabled in dev (Helium is local). See code changes in `connection-manager.js`, `db-client.js`, `test-snapshot-workflow.js`.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    Replit Platform                             │
│                                                               │
│  ┌──────────────────────┐    ┌────────────────────────────┐  │
│  │   Dev Workspace       │    │   Production Deployment     │  │
│  │                       │    │   (Cloud Run / Autoscale)   │  │
│  │  DATABASE_URL ──────┐ │    │  DATABASE_URL ───────────┐ │  │
│  │                     │ │    │                          │ │  │
│  └─────────────────────┼─┘    └──────────────────────────┼─┘  │
│                        │                                 │    │
│                        ▼                                 ▼    │
│  ┌──────────────────────┐    ┌────────────────────────────┐  │
│  │  Replit Helium (Dev)  │    │  Replit Helium (Prod)       │  │
│  │  PostgreSQL 16        │    │  PostgreSQL 16              │  │
│  │  Local, no SSL        │    │  SSL required               │  │
│  │                       │    │                             │  │
│  │  - Test data          │    │  - Real driver data         │  │
│  │  - Dev accounts       │    │  - Coach conversations      │  │
│  │  - Safe to experiment │    │  - Production strategies    │  │
│  └───────────────────────┘    └─────────────────────────────┘  │
│                                                               │
│  Previous: Neon Serverless (disabled 2026-02-26)              │
│  Saved as: NEON_DATABASE_URL in Replit Secrets                │
└───────────────────────────────────────────────────────────────┘
```

---

## How It Works

### 1. Environment Detection

Replit determines the environment at deployment time, not at runtime in our code:

- **Workspace (Dev):** `DATABASE_URL` → Replit's internal Helium PostgreSQL
- **Deployment (Prod):** `DATABASE_URL` → Neon PostgreSQL (auto-provisioned on first publish)

The application code reads `process.env.DATABASE_URL` and connects. That's it. No branching, no env-file cascading needed.

### 2. Replit Secrets

The following database-related secrets exist in the Replit Secrets panel:

| Secret | Purpose | Environment |
|--------|---------|-------------|
| `DATABASE_URL` | Primary connection string (auto-injected by Replit) | Both |
| `NEON_DATABASE_URL` | Old Neon connection (saved for reference, endpoint disabled) | Archive |

### 3. Schema Synchronization

- **Schema is identical** in both environments
- Replit runs automated migrations on deployment to match schema
- Dev data is NEVER copied to prod (and vice versa)
- Migration files live in `/migrations/*.sql`

### 4. Helium vs. Neon Behavior

**Helium (Current — 2026-02-26):**
- Runs locally alongside the app — lower latency than Neon
- **No SSL in dev** (local connection). Production uses SSL.
- No cold-start delays — always warm
- 20 GB storage (up from Neon's 10 GB)
- `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD` are NOT set — use `DATABASE_URL` only

**Legacy Neon Behavior (for reference — disabled after Helium migration):**
- Error 57P01 (`connection terminated unexpectedly`) — was normal in Neon's serverless proxy
- Auto-recovery still in `connection-manager.js` (pool evicts dead connection, creates new one)
- Old Neon URL saved as `NEON_DATABASE_URL` in Replit Secrets

---

## Rules for Claude Code

### DO:
- Always use `process.env.DATABASE_URL` for connections
- Trust that Replit provides the correct database for the current environment
- Keep the 57P01 error handling in `connection-manager.js` (it's production-critical)
- Test migrations on dev before deploying to prod
- Use seed scripts (`scripts/seed-dev.js`) only in dev

### DO NOT:
- Hard-code any database connection strings
- Create custom env-swapping logic (Replit handles this)
- Write test data to prod (Melody will deploy; code doesn't control which DB)
- Remove the Neon cold-start handling (57P01 recovery)
- Assume dev data exists in prod or vice versa

### WHEN QUERYING:
- **From Claude Code in the workspace:** You are hitting the DEV database
- **From the live app:** Users are hitting the PROD database
- **To see prod data:** Use Replit's Database Studio UI (dropdown: "Production Database")
- **To run migrations:** Use `npm run db:push` (runs against current env's DATABASE_URL)

---

## Key Files

| File | Purpose |
|------|---------|
| `server/db/connection-manager.js` | Pool config, conditional SSL, 57P01 handling, monitoring |
| `server/db/db-client.js` | LISTEN/NOTIFY real-time client, keepalive |
| `server/db/drizzle.js` | Drizzle ORM instance |
| `server/config/load-env.js` | Environment loading (⚠️ over-engineered, cleanup needed) |
| `server/config/validate-env.js` | Startup validation of required env vars |
| `shared/schema.js` | Drizzle table definitions (universal, no env branching) |
| `drizzle.config.js` | Drizzle Kit config for migrations |
| `migrations/*.sql` | SQL migration files |

---

## Legacy Artifacts (Cleanup Status)

The following files/patterns were created by Replit Agents who didn't understand Replit's native environment handling:

| Artifact | Location | Status |
|----------|----------|--------|
| 3-tier env loading | `server/config/load-env.js` | **CLEANED** (2026-02-25) — simplified to GCP + .env.local |
| `DEPLOY_MODE` routing | `load-env.js` | **CLEANED** (2026-02-25) — removed, env/ dir never existed |
| `db-doctor.js` | `server/scripts/` | **DELETED** (2026-02-25) — superseded by /api/diagnostic/db-info |
| `agent-ai-config.js` | Root | **DELETED** (2026-02-25) — 3 exports, none used anywhere |
| `validate-strategy-env.js` | `server/config/` | **MERGED** (2026-02-25) — into validate-env.js |
| `start-mono.sh` | Root | **DELETED** (2026-02-25) — strict subset of start.sh |
| `env/shared.env`, `env/mono.env` | `env/` | N/A — directory was never created |
| `mono-mode.env` | Root | **RENAMED** (2026-02-25) → `.env.local` — dev baseline env file |
| `.env_override` | Root | **Kept** — local dev override mechanism |
| `db-detox.js` | `scripts/` | **Kept** — useful manual maintenance utility |

---

## Changelog

- **2026-02-26:** Neon → Helium migration complete. Removed hardcoded Neon URL from `.env.local`, made SSL conditional in all DB clients, removed stale `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD` vars, updated architecture diagram.
- **2026-02-25:** Created document based on Replit UI analysis with Melody. Confirmed dual-instance architecture.
