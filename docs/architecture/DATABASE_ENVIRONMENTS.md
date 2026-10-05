# Database Environments: Dev vs. Prod

> **Last Updated:** 2026-10-04 (bootstrap and verification boundaries; provider history retained)
> **Provider history:** development was Replit Helium; production was Neon serverless at the recorded inspections below. The current supplied development connection was checked read-only; current production provider, schema and deployed revision were not inspected in this review.
> **Priority:** CRITICAL — Read this document at every session start

---

## TL;DR for AI Agents

| Aspect | Development | Production |
|--------|-------------|------------|
| **Provider** | Replit Helium (PostgreSQL 16, local) | **Neon serverless** (PostgreSQL, direct endpoint) |
| **When active** | Replit workspace / editor | Published deployment (Cloud Run) |
| **DATABASE_URL** | Auto-injected by Replit (dev Helium: `host=helium`) | Auto-injected by Replit (prod Neon: `host=ep-noisy-cake-afv3ojg3.c-2.us-...`) |
| **Data** | Test data, dev accounts | Real driver data, real conversations |
| **Schema** | Verify this connection against the source; a development result is scoped to development. | Requires a separate current check; do not infer parity from development. |
| **Data sync** | None — completely isolated | None — completely isolated |
| **SSL** | **No** (Helium runs locally, `sslmode=disable`) | **Yes** (Neon requires SSL; valid certs → `rejectUnauthorized: true`) |

The provider table and diagram retain historical environment observations, not a current production receipt. Treat either database as containing valuable data until its actual contents and purpose are established.

**Golden Rule:** `DATABASE_URL` selects the connection. Use the supplied environment and verify the intended target without printing credentials; application code must not invent a second database selector.

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

The application code selects its target only from `process.env.DATABASE_URL`.
`server/db/connection-config.js` parses that URL once for the pool, LISTEN client
(including reconnects), and migration runner. Exact known local targets
(`helium`, `localhost`, `127.0.0.1`, `::1`, or Unix sockets) retain plaintext when
TLS is absent or disabled; other targets require certificate and hostname
verification. Explicit local TLS and URL CA/client certificate/key material are
preserved. `NODE_ENV` and `REPLIT_DEPLOYMENT` do not choose the target or bypass
verification. Invalid configuration fails without printing URL credentials.

The old runtime used `rejectUnauthorized: false` in the pool/migration runner
and different TLS configuration during LISTEN reconnect. Those implementations
contradicted this document's verification requirement and were replaced on
2026-09-29. Mocked lifecycle tests and actual parser/configuration tests verify
this policy; they do **not** prove a live remote TLS handshake. See
[`server/db/README.md`](../../server/db/README.md) for source and test entry points.

### 2. Replit Secrets

| Secret | Purpose | Environment |
|--------|---------|-------------|
| `DATABASE_URL` | Primary connection string (auto-injected by Replit) | Both |

### 3. Schema Synchronization

- **Versioned migration application runs at boot (since 2026-08-06):**
  `server/db/run-migrations.js` runs at the top of `gateway-server.js` bootstrap
  and applies unrecorded `/migrations/*.sql` in filename order, tracked
  in the `schema_migrations` table and serialized across autoscale instances by
  a pg advisory lock. **Fail-loud**: a bad migration crashes boot visibly.
  Successful ledger entries prevent replay; the ledger alone does not verify
  schema or reference-data effects. Files older than the `20260703` cutoff were recorded as
  already-applied without execution (both DBs verifiably predate-applied them).
- **Doctrine note (Melody, 2026-08-06):** "no prod migrations without explicit
  human approval" is satisfied at *design time* — a migration file reviewed,
  merged, and published IS the approval; the runner just executes it
  deterministically. Migrations MUST be idempotent/additive (`IF NOT EXISTS`,
  `ON CONFLICT`, type guards) — the runner re-executes post-cutoff files on any
  DB that hasn't recorded them.
- **Empty-database path (corrected 2026-10-04):** the core `public.snapshots` table
  must be absent and the ledger empty. The reviewed baseline, airport identity
  seed and all covered ledger rows commit together. Incomplete executed-baseline
  history and unledgered existing schemas stop before historical replay. Read
  [the bootstrap contract](DATABASE_BOOTSTRAP.md), including extension requirements
  and the unresolved current `app_rules` restoration prerequisite. The September
  13 zero-difference report concerned schema catalogs, not seeded reference data.
- **Historical pre-publish check for `20260913_schema_repair.sql`** (production
  had not run it at that recorded review; current production state is unknown): it
  drops 11 tables ONLY if they are empty and RAISES (boot fails loud) otherwise. Before
  publishing, open Database Studio → Production Database and confirm zero rows in
  `block_jobs, llm_venue_suggestions, eidolon_snapshots, venue_events, traffic_zones,
  market_intel, driver_goals, driver_tasks, safe_zones, staging_saturation,
  uber_connections`. If any has rows, decide (delete them, or keep the table) before
  publishing; the error message names the table.
- **History (kept so the lesson survives):** from the death of the original
  drizzle-kit pipeline (its artifacts live in `migrations/manual/`) until
  2026-08-06, parity was manual, and this doc falsely claimed "Replit runs
  automated migrations on deployment." The gap silently cost prod the
  `airports` and `offer_rulesets` tables for a month (2026-07-06 publish).
- Dev data is NEVER copied to prod (and vice versa). The one deliberate
  exception: provenance-carrying data migrations (e.g.
  `20260806_seed_airports_data.sql`, Google-sourced identity data) that both
  environments need identically.
- Migration files live in `/migrations/*.sql`

---

## Rules for Claude Code

### DO:
- Always use `process.env.DATABASE_URL` for connections
- Verify the supplied connection's intended environment before writing
- Test migrations on an explicitly prepared disposable database before deployment
- Inspect seed-script effects and preserve existing data before considering a run

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
- **To inspect schema metadata:** `npm run check:schema` performs a read-only check using the supplied `DATABASE_URL` and the same TLS policy as the app. Its coverage is documented in `server/db/README.md`; it is not proof of full schema or data parity.
- **To apply reviewed migrations:** `npm run db:migrate` runs canonical `migrations/*.sql` against the supplied `DATABASE_URL`. Review pending SQL and confirm the intended environment before execution. `db:push` is not the canonical migration path.

---

## Environment files and precedence (2026-09-15)

Only two env files exist: `.env.local` (gitignored, workspace-only) and its tracked template
`.env.local.example`. The old `.env` and `.env.example` copies were deleted; nothing loaded
them for the app (the agent config-manager's `.env` editor is the one reader, now pointing at
an absent file — treat it as legacy).

| Where | Precedence, highest first |
|---|---|
| Workspace (Run button, workflows) | `.env.local` (sourced with `set -a` by `.replit` run), then Replit Secrets, then code defaults |
| Deployment | Replit Secrets, then `.env.local` if present (loader fills only unset keys), then code defaults |

`.env.local` was trimmed on 2026-09-15 to the keys the code actually reads (a repo-wide
`process.env.X` / `import.meta.env.X` scan, 216 → 80 keys). Model names are never env
keys — see `server/lib/ai/model-registry.js`. Replit Secrets were trimmed to the same
consumed set; the app-required ones are `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`,
`GOOGLE_MAPS_API_KEY`, `GOOGLEAQ_API_KEY`, `TOMTOM_API_KEY`, `VITE_GOOGLE_MAPS_API_KEY`,
`VITE_GOOGLE_MAPS_MAP_ID`, `JWT_SECRET`, `VECTO_AGENT_SECRET`, `CLAUDE_BRIDGE_TOKEN`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CLIENT_URL`, `MCP_TOKEN` (+ `SENDGRID_API_KEY`
for email, unset as of this date). `DATABASE_URL` is Replit-managed and stays the only DB selector.

## Key Files

| File | Purpose |
|------|---------|
| `server/db/connection-config.js` | Shared DATABASE_URL parsing, local/remote TLS and certificate preservation |
| `server/db/connection-manager.js` | Shared pool, query handling, monitoring |
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

- **2026-09-29:** Reconciled the documented strict TLS requirement with pool, migration-runner, and LISTEN/reconnect source. Added shared URL/certificate parsing and lifecycle regression coverage. No remote database handshake or deployment was performed for this verification.

- **2026-04-24:** **CORRECTION.** The 2026-04-05 entry incorrectly stated "both dev and prod confirmed as Replit Helium." The 2026-04-18 NEON_AUTOSCALE audit (`docs/architecture/audits/NEON_AUTOSCALE_TOPOLOGY_2026-04-18.md`) proved prod runs Neon serverless (direct endpoint `ep-noisy-cake-afv3ojg3`). This doc, CLAUDE.md Rule 13, and `server/db/connection-manager.js` inline comments have been updated to match reality. The "removed all Neon references" in the 2026-04-05 entry was premature — Neon was still the prod provider.
- **2026-04-05:** Removed Neon references from `connection-manager.js` and `db-client.js` on the incorrect assumption that prod had also migrated to Helium. See 2026-04-24 correction above. Prod remained on Neon throughout.
- **2026-02-26:** Dev database migrated from Neon Serverless to Replit Helium. SSL made conditional.
- **2026-02-25:** Created document. Confirmed dual-instance architecture.
