# Database Environments: Dev vs. Prod

> **Last Updated:** 2026-04-24
> **Status:** Verified — **dev = Replit Helium local**; **prod = Neon serverless**. The 2026-04-05 "both Helium" claim was incorrect; see changelog.
> **Priority:** CRITICAL — Read this document at every session start

---

## TL;DR for AI Agents

| Aspect | Development | Production |
|--------|-------------|------------|
| **Provider** | Replit Helium (PostgreSQL 16, local) | **Neon serverless** (PostgreSQL, direct endpoint) |
| **When active** | Replit workspace / editor | Published deployment (Cloud Run) |
| **DATABASE_URL** | Auto-injected by Replit (dev Helium: `host=helium`) | Auto-injected by Replit (prod Neon: `host=ep-noisy-cake-afv3ojg3.c-2.us-...`) |
| **Data** | Test data, dev accounts | Real driver data, real conversations |
| **Schema** | Identical to prod | Identical to dev |
| **Data sync** | None — completely isolated | None — completely isolated |
| **SSL** | **No** (Helium runs locally, `sslmode=disable`) | **Yes** (Neon requires SSL; valid certs → `rejectUnauthorized: true`) |

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
│  │  Replit Helium (Dev)  │    │  Neon Serverless (Prod)     │  │
│  │  PostgreSQL 16        │    │  PostgreSQL (direct endpt)  │  │
│  │  host=helium          │    │  host=ep-noisy-cake-...     │  │
│  │  sslmode=disable      │    │  SSL required, valid certs  │  │
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

- **Workspace (Dev):** `DATABASE_URL` → Replit's internal Helium PostgreSQL (local, `sslmode=disable`)
- **Deployment (Prod):** `DATABASE_URL` → Neon serverless (PostgreSQL, SSL required, valid certs)

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

- **2026-04-24:** **CORRECTION.** The 2026-04-05 entry incorrectly stated "both dev and prod confirmed as Replit Helium." The 2026-04-18 NEON_AUTOSCALE audit (`docs/architecture/audits/NEON_AUTOSCALE_TOPOLOGY_2026-04-18.md`) proved prod runs Neon serverless (direct endpoint `ep-noisy-cake-afv3ojg3`). This doc, CLAUDE.md Rule 13, and `server/db/connection-manager.js` inline comments have been updated to match reality. The "removed all Neon references" in the 2026-04-05 entry was premature — Neon was still the prod provider.
- **2026-04-05:** Removed Neon references from `connection-manager.js` and `db-client.js` on the incorrect assumption that prod had also migrated to Helium. See 2026-04-24 correction above. Prod remained on Neon throughout.
- **2026-02-26:** Dev database migrated from Neon Serverless to Replit Helium. SSL made conditional.
- **2026-02-25:** Created document. Confirmed dual-instance architecture.
