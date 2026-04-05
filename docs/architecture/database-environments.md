# Database Environments: Dev vs. Prod

> **Last Updated:** 2026-04-05
> **Status:** Verified — both environments use Replit Helium (PostgreSQL 16)
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

**Golden Rule:** `DATABASE_URL` is the ONLY variable that matters. Replit injects it automatically. The application code does NOT need to know which database it's talking to.

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
└───────────────────────────────────────────────────────────────┘
```

---

## How It Works

### 1. Environment Detection

Replit determines the environment at deployment time, not at runtime in our code:

- **Workspace (Dev):** `DATABASE_URL` → Replit's internal Helium PostgreSQL (local, no SSL)
- **Deployment (Prod):** `DATABASE_URL` → Replit's production Helium PostgreSQL (SSL required)

The application code reads `process.env.DATABASE_URL` and connects. That's it. No branching, no env-file cascading needed.

### 2. Replit Secrets

| Secret | Purpose | Environment |
|--------|---------|-------------|
| `DATABASE_URL` | Primary connection string (auto-injected by Replit) | Both |

### 3. Schema Synchronization

- **Schema is identical** in both environments
- Replit runs automated migrations on deployment to match schema
- Dev data is NEVER copied to prod (and vice versa)
- Migration files live in `/migrations/*.sql`

---

## Rules for Claude Code

### DO:
- Always use `process.env.DATABASE_URL` for connections
- Trust that Replit provides the correct database for the current environment
- Test migrations on dev before deploying to prod
- Use seed scripts (`scripts/seed-dev.js`) only in dev

### DO NOT:
- Hard-code any database connection strings
- Create custom env-swapping logic (Replit handles this)
- Write test data to prod (Melody will deploy; code doesn't control which DB)
- Assume dev data exists in prod or vice versa
- Reference PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE — only `DATABASE_URL` exists

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
| `server/config/load-env.js` | Environment loading |
| `server/config/validate-env.js` | Startup validation of required env vars |
| `shared/schema.js` | Drizzle table definitions (universal, no env branching) |
| `drizzle.config.js` | Drizzle Kit config for migrations |
| `migrations/*.sql` | SQL migration files |

---

## Legacy Artifacts (Cleanup Status)

| Artifact | Location | Status |
|----------|----------|--------|
| 3-tier env loading | `server/config/load-env.js` | **CLEANED** (2026-02-25) |
| `DEPLOY_MODE` routing | `load-env.js` | **CLEANED** (2026-02-25) |
| `db-doctor.js` | `server/scripts/` | **DELETED** (2026-02-25) |
| `agent-ai-config.js` | Root | **DELETED** (2026-02-25) |
| `validate-strategy-env.js` | `server/config/` | **MERGED** (2026-02-25) |
| `start-mono.sh` | Root | **DELETED** (2026-02-25) |
| `.env_override` | Root | **DELETED** (2026-04-05) — contained stale credentials |
| `db-detox.js` | `scripts/` | **Kept** — useful manual maintenance utility |

---

## Changelog

- **2026-04-05:** Removed all Neon references. Both dev and prod confirmed as Replit Helium. Cleaned stale comments from connection-manager.js and db-client.js.
- **2026-02-26:** Dev database migrated from Neon Serverless to Replit Helium. SSL made conditional.
- **2026-02-25:** Created document. Confirmed dual-instance architecture.
