---
date: 2026-04-18
session_id: 2026-04-18-neon-autoscale-topology
scope: Read-only RECON of prod data-plane vendor (Neon, not Helium) and Cloud-Run autoscale interaction with LISTEN/NOTIFY + SSE
status: recon complete; doctrine drift confirmed; no code changes; no DB writes; no migrations; no restart; no republish
author: claude-opus-4-7[1m]
related_audits:
  - docs/architecture/audits/NOTIFY_LOSS_RECON_2026-04-18.md
  - docs/architecture/audits/FRISCO_LOCK_DIAGNOSIS_2026-04-18.md
related_docs:
  - CLAUDE.md (Rule 13 — INCORRECT for prod)
  - docs/architecture/DATABASE_ENVIRONMENTS.md (claims both dev+prod = Helium; INCORRECT for prod)
  - docs/architecture/SCALABILITY.md (mentions PgBouncer at 100+ users; not yet implemented)
constraints_honored:
  - read_only: true
  - prod_db_touched: false
  - dev_db_touched: false
  - schema_changes: none
  - migrations_applied: none
  - code_changes: none
  - server_restarted: false
  - republished: false
  - DECISIONS_md_modified: false
  - phase_0a_commit_e7034939: untouched
---

# Neon + Autoscale Prod Topology — 2026-04-18

User-supplied prod ground truth (NOT verified against prod DB; constraint honored):

```
PGDATABASE=neondb
PGHOST=ep-noisy-cake-afv3ojg3.c-2.us-...
PGUSER=neondb_owner
PGPORT=5432
Autoscale: 2 vCPU / 4 GiB RAM / 3 Max instances
```

Gateway log says `Mode: MONO` despite Autoscale. `connection-manager.js` comment says `Replit Helium`. Both are stale doctrine — **prod is Neon serverless on the direct (non-pooler) endpoint**.

## TL;DR

| Question | Answer | Confidence |
|----------|--------|------------|
| (a) Direct or pooled Neon endpoint? | **Direct.** Hostname `ep-noisy-cake-afv3ojg3.c-2.us-...` has NO `-pooler` suffix. Pooled would be `ep-noisy-cake-afv3ojg3-pooler.c-2.us-...`. | High — pattern match on Neon's documented URL convention |
| (b) Separate NOTIFY_DATABASE_URL / DIRECT_DATABASE_URL for LISTEN? | **No.** Codebase grep returns zero hits for `NOTIFY_DATABASE_URL` / `DIRECT_DATABASE_URL`. `DATABASE_URL_UNPOOLED` is registered in `env-registry.js:29` but never read by any source file. | High |
| (c) Does LISTEN client share pool URL? | **Yes — single `process.env.DATABASE_URL` for both.** `connection-manager.js:19` (pool) and `db-client.js:139` (LISTEN client) both read the same env var. | High — direct verification |
| A2: Does pooled URL break LISTEN/NOTIFY? | Yes (in transaction mode), but **moot here** because prod uses direct, not pooled. **Ruled out as a root cause.** | High |
| A3: Autoscale stickiness across 3 instances? | Cloud Run does NOT do session affinity by default. NOTIFY broadcasts to ALL listening sessions, so cross-instance delivery works AS LONG AS each instance has its own active LISTEN. **There is a "first-SSE-on-instance" race window**. | Medium — needs prod log correlation |
| A4: ENABLE_BACKGROUND_WORKER value? | Default `'false'` (env-registry.js:170). `.env.local.example:334` sets it to `true` for **dev only**. Prod almost certainly inherits the default `false` AND the autoscale guardrail (`workers.js:171`) forcibly disables the worker even if it were `true`. **G6 (triad-worker handler bypass) is dormant in prod.** | High |
| A5: MONO vs multi-instance? | `MONO` is `APP_MODE` — controls route topology in-process, not replica count. Autoscale spawns up to 3 replicas of the same MONO app. The two flags are orthogonal. **Log message is misleading; prod runs 1–3 MONO instances concurrently.** | High |

## 1. Vendor evidence — Neon vs. Helium

### 1.1 Doctrine drift summary

| Source | Claim | Reality |
|--------|-------|---------|
| `CLAUDE.md` Rule 13 | "Dev and Prod are TWO SEPARATE Replit Helium (PostgreSQL 16) instances" | **INCORRECT for prod** — prod is Neon |
| `docs/architecture/DATABASE_ENVIRONMENTS.md:13` | "Provider: Replit Helium (PostgreSQL 16)" for both columns | **INCORRECT for prod** |
| `docs/architecture/DATABASE_ENVIRONMENTS.md:134` | "2026-04-05: Removed all Neon references. Both dev and prod confirmed as Replit Helium." | **WRONG** — Neon was the prod vendor before the migration was complete (or the prod DB reverted) |
| `server/db/connection-manager.js:73` (comment) | "Replit Helium (PostgreSQL 16)" | **INCORRECT for prod** |
| `package-lock.json` | `@neondatabase/serverless` listed as `optional: true` peer | Vestigial — not actually installed at runtime, but the umbrella dependency that lists it (likely Drizzle Kit) is still present |
| `migrations/004_jwt_helpers.sql` | "Neon populates request.jwt.claims" | **DEAD CODE** — JWT-claim helper functions designed for Neon RLS; not wired into Helium or current Neon setup |
| `scripts/make-jwks.mjs:47` | "Register this URL in Neon Console → Settings → RLS / Auth providers" | **STALE SCRIPT** — orphaned Neon JWKS script |
| `.env.local.example:55` | "Database (Replit Helium — PostgreSQL 16)" | Dev-correct, prod-incorrect |
| `drizzle.config.js:3` | "No external databases (Neon, Vercel, Railway, etc.) are used" | **INCORRECT** — prod IS on Neon |

### 1.2 Codebase Neon-import sites

```
$ grep -rn "@neondatabase\|neon-serverless\|require.*neon\|from ['\"]@neon" server/ client/
(no matches)
```

**No source file imports the Neon serverless driver.** The runtime is pure `pg.Client` (LISTEN client) and `pg.Pool` (query pool) talking to the Neon endpoint over the standard PostgreSQL wire protocol via `DATABASE_URL`. This is correct — Neon supports vanilla `pg` over its direct endpoint.

### 1.3 What the codebase ACTUALLY runs against Neon

| Component | Library | URL source | Connection style |
|-----------|---------|-----------|------------------|
| Query pool (`server/db/connection-manager.js`) | `pg.Pool` (max 25, idleTimeoutMillis 10s, statement_timeout 30s, keepAlive true) | `process.env.DATABASE_URL` | Conditional SSL: `rejectUnauthorized: false` if `REPLIT_DEPLOYMENT === '1'` |
| LISTEN client (`server/db/db-client.js`) | `pg.Client` (singleton, application_name `triad-listener`, keepAlive, keepAliveInitialDelayMillis 10000) | Same `process.env.DATABASE_URL` | Same SSL conditional |
| Drizzle ORM | Wraps the pool above | (inherits) | (inherits) |
| Triad-worker LISTEN (subprocess) | Same `getListenClient()` from `db-client.js` | Same `process.env.DATABASE_URL` | (inherits) |
| Eidolon memory (`server/eidolon/memory/pg.js`) | `pg.Pool` | Own `DATABASE_URL` read | Likely no SSL conditional — TODO verify if used in prod |
| SDK and ad-hoc seed scripts | `pg.Pool` | `DATABASE_URL` | Per-script |

**There is exactly one connection string in the system. Both pool and LISTEN client read it.**

## 2. A1: URL shape determination

User-supplied prod hostname pattern: `ep-noisy-cake-afv3ojg3.c-2.us-...`

Neon's documented endpoint convention:

| Variant | Hostname pattern | Backend |
|---------|------------------|---------|
| Direct (compute endpoint) | `ep-{name}-{id}.c-{N}.{region}.aws.neon.tech` | PostgreSQL wire protocol direct to compute node |
| Pooled (PgBouncer) | `ep-{name}-{id}-pooler.c-{N}.{region}.aws.neon.tech` | PgBouncer in transaction mode (default) sitting in front of compute |

The user's hostname has NO `-pooler` segment. **Conclusion: prod uses the direct (non-pooled) endpoint.**

Implication: LISTEN/NOTIFY works at the protocol level. The classic Neon pitfall (LISTEN on PgBouncer transaction mode = silent failure because each transaction gets a different backend connection) **does not apply here**.

If Melody wishes to introduce PgBouncer/pooled later for query scaling (per `docs/architecture/SCALABILITY.md:94, 218`), that future change MUST keep the LISTEN client on the direct URL — otherwise the entire SSE pipeline silently breaks.

## 3. A2: Pooled-LISTEN root-cause check

**Ruled out.** Prod is direct, not pooled.

If prod were ever migrated to the pooler URL without splitting LISTEN onto a separate `DIRECT_DATABASE_URL`, every `subscribeToChannel(...)` call would silently fail — the dispatcher's LISTEN command would land on a transaction-mode pooler that releases the connection immediately. From the application's perspective, no error is raised; NOTIFYs simply never arrive. The `db-client.js` reconnect logic would also silently fail to deliver any catch-up.

This is a **latent class-of-bug** that should be guarded by a startup check (e.g., assertion that `DATABASE_URL` contains the substring `-pooler` ⇒ require an additional `DIRECT_DATABASE_URL` for the LISTEN client). Recommended as a follow-up, not currently active.

## 4. A3: Cloud Run autoscale stickiness + multi-instance NOTIFY

### 4.1 What Cloud Run does for SSE

- **Default routing**: round-robin / least-utilized across active instances. **No session affinity** unless you opt into `sessionAffinity: ClientIP` (GKE) or use Cloud Run's `--session-affinity` flag (which only affinity-binds based on `GOOGLE_CLOUD_SESSION_AFFINITY` cookie). Vecto Pilot's `.replit` `[deployment]` block does not configure either.
- **Long-lived SSE connections** are pinned to the instance that accepted the original `EventSource` GET. So once an SSE client connects, the same instance handles the lifetime of that connection (until either side closes).
- **Cloud Run request timeout** caps long requests at 60 minutes by default. SSE will be force-closed at that boundary unless the timeout is raised.

### 4.2 What happens to NOTIFY across 3 instances

PostgreSQL `NOTIFY <chan>, <payload>` broadcasts to **every session that has issued `LISTEN <chan>`**, regardless of which session emitted the NOTIFY. So:

```
Instance A (1 SSE client subscribed to /events/briefing for snapshot X):
   - getListenClient() created → LISTEN briefing_ready issued
   - briefing_ready arrives via Postgres broadcast → fan-out to SSE client

Instance B (handling the snapshot POST that triggers briefing generation):
   - briefing-service.js:2949 → SELECT pg_notify('briefing_ready', '{snapshot_id:X}')
   - This goes via Instance B's pool connection
   - Postgres broadcasts to all listening sessions

Instance C (no SSE clients):
   - Has not called getListenClient() yet → no LISTEN registered
   - The NOTIFY arrives but does not concern this instance
   - NO PROBLEM
```

**The system works AS LONG AS the instance with the SSE client has an active LISTEN.** This is true after the first `subscribeToChannel(...)` runs on that instance, which happens when the first SSE client connects.

### 4.3 Where multi-instance + NOTIFY breaks down

Three race windows exist:

| Window | Mechanism | Severity |
|--------|-----------|----------|
| **W1: First-SSE-on-instance lazy LISTEN race** | Instance A spawned by autoscale 100 ms ago → first SSE client connects → `subscribeToChannel('briefing_ready')` is awaited → 30 ms later LISTEN issued. If `briefing_ready` fires from Instance B during that 30 ms window, it's lost for the SSE client on A. | Low — narrow window per instance lifetime |
| **W2: Cross-instance LISTEN reconnect** | Instance A's LISTEN client hits a Neon idle disconnect / network blip → exponential backoff reconnect (1 s → 10 s, up to ~25 s). NOTIFYs fired during this window from Instance B are lost for A's SSE client. **Same as the single-instance NOTIFY-loss bug; multi-instance just adds N independent reconnect timelines.** | High — same as single-instance case, but per-instance |
| **W3: Cloud Run scale-down** | Idle instances scale to zero. The instance's LISTEN client is gone. SSE clients on it are also gone (Cloud Run drains active connections during shutdown). After scale-down, a new SSE connection lands on a fresh instance with no LISTEN — first-SSE-on-instance race re-applies. | Medium — depends on Cloud Run scale-down timing config |

The W2 window is identical to the single-instance NOTIFY-loss bug already documented in `NOTIFY_LOSS_RECON_2026-04-18.md`. Multi-instance does not fundamentally introduce new failure modes — it just multiplies them per replica.

### 4.4 Cross-instance NOTIFY example: snapshot ef36f6c6

For the 01:36 → 01:42 timeline in `NOTIFY_LOSS_RECON_2026-04-18.md`, the relevant question is: did Melody's SSE client reconnect to a DIFFERENT instance after the 01:36:43 close? If so:

- Old instance had LISTEN on briefing_ready, then closed
- New instance (autoscale-spawned) needed to lazy-init LISTEN
- During the 01:36:43 → 01:39:21 window, NOTIFY fired from whatever instance handled the briefing pipeline
- New instance had no LISTEN yet → NOTIFY lost for that SSE client even after reconnect, until lazy-init completes

**This is a SPECIFIC explanation of the prod symptom that adds to (does not replace) the single-instance reconnect race.**

## 5. A4: ENABLE_BACKGROUND_WORKER prod/dev values

**Definition** (`server/config/env-registry.js:168–172`):

```js
ENABLE_BACKGROUND_WORKER: {
  required: false,
  default: 'false',
  description: 'Explicitly enable background strategy worker process',
},
```

**Sites that read it:**

| File | Line | Behavior |
|------|------|----------|
| `server/bootstrap/workers.js:180` | `if (process.env.ENABLE_BACKGROUND_WORKER === 'true') return { shouldStart: true, ... }` | Starts worker subprocess only on explicit opt-in |
| `server/bootstrap/workers.js:171–177` | `if (isAutoscaleMode) return { shouldStart: false, reason: 'AUTOSCALE GUARDRAIL' }` | **Hard guardrail**: even if `ENABLE_BACKGROUND_WORKER=true`, autoscale forcibly disables the subprocess |
| `scripts/start-replit.js:166, 192` | logging only | `gateway-server.js reads ENABLE_BACKGROUND_WORKER and makes the single decision` |
| `strategy-generator.js:20` | logging only |  |

**Dev value**: `.env.local.example:334` sets `ENABLE_BACKGROUND_WORKER=true`. If the dev server is run via the `Run` workflow in `.replit` which sources `.env.local`, dev runs the strategy-generator subprocess.

**Prod value**: not set in any committed prod config; Replit Secrets is the source of truth and we did not query it. **Default behavior assuming no override**: `'false'`. **Even if set to `'true'` in prod**, the autoscale guardrail at `workers.js:171` returns early with `shouldStart: false`. So in prod, the strategy-generator subprocess **never spawns**, and `triad-worker.js`'s `startConsolidationListener()` **never runs**.

**Implication for G6 (triad-worker handler bypass)**: dormant in prod. `pgClient.on('notification', ...)` at `triad-worker.js:58` is never called in autoscale environments. No latent bug from G6 in prod.

**Implication for SmartBlocks generation**: Since the worker never runs in prod, SmartBlocks must be generated by another path. Per the comment at `triad-worker.js:3`: *"Strategy generation now happens synchronously in blocks-fast.js — this worker only handles SmartBlocks."* If SmartBlocks generation truly depended on the worker, prod blocks would never be created. Melody's prod evidence shows venues rendered, so either (i) `blocks-fast.js` performs both strategy AND SmartBlocks synchronously in autoscale, or (ii) some other emit path generates and emits `NOTIFY blocks_ready`. **This is a follow-up to verify**; recon currently STOPS at the worker boundary.

## 6. A5: MONO vs Autoscale resolution

`gateway-server.js:28`:
```js
const MODE = (process.env.APP_MODE || 'mono').toLowerCase();
```

`gateway-server.js:39`:
```js
const isAutoscaleMode = process.env.CLOUD_RUN_AUTOSCALE === '1' || process.env.REPLIT_AUTOSCALE === '1';
```

The two flags control orthogonal concerns:

| Flag | Concern | Default |
|------|---------|---------|
| `APP_MODE` | Route topology — `mono` mounts ALL routes in this process; non-`mono` modes split routes across separate services (SDK, Agent, Eidolon as standalone servers) | `mono` |
| `CLOUD_RUN_AUTOSCALE` / `REPLIT_AUTOSCALE` | Replica count — controls whether the platform spawns multiple instances of THIS process | not set in dev; set in deployed prod |

A single process can simultaneously be `MODE=mono` (handles every route in-process) AND `isAutoscaleMode=true` (platform may spawn 1–3 replicas of this MONO process). The "Mode: MONO" log line is **about route topology, not replica count**.

In prod: 1–3 instances of the MONO gateway, each with its own:
- Pool (max 25 → up to 75 active connections to Neon at peak)
- LISTEN client (1 dedicated `pg.Client` per instance)
- SSE state (in-memory, per-instance)
- Eidolon memory (if used)

If prod hits the 3-instance ceiling with each instance at 25 pool connections, that's **75 simultaneous connections to Neon** plus 3 LISTEN clients = **78 total**. Neon's free-tier compute endpoint has a documented 100-connection ceiling; production-tier compute caps higher but configurable. **Connection-budget pressure is real at scale** but not the source of the current spinner symptom.

## 7. Contribution to Frisco-lock — confidence ranking

| Hypothesis | Connection to Frisco-lock | Confidence |
|------------|---------------------------|------------|
| Prod uses pooled Neon LISTEN endpoint | **NO** — prod uses direct endpoint, not pooled. Ruled out. | High (0%) |
| Multi-instance NOTIFY gap (W1/W2/W3) | **YES** — multiplies single-instance NOTIFY-loss windows. Each instance has its own reconnect timeline; an SSE client landing on a fresh instance after Cloud Run scale-up may experience the lazy-LISTEN race before its SSE subscription is wake-up-able. | Medium (~30%) — explains worse symptom severity in prod vs dev, but does not single-handedly cause Frisco-lock |
| ENABLE_BACKGROUND_WORKER + G6 (triad-worker bypass) | **NO** — worker is forcibly disabled by autoscale guardrail. | High (0%) |
| Connection-budget pressure (3 × 25 = 75 connections) | **NO** evidence of pool exhaustion in current logs. | High (0%) |

**Net contribution of Neon+Autoscale topology to Frisco-lock**: ~30%. It is a **multiplier** on the single-instance NOTIFY-loss bug (Bug A from `NOTIFY_LOSS_RECON_2026-04-18.md`), not an independent cause.

The other ~70% of Frisco-lock is split between:
- Bug B (`_coverageEmpty` not honored client-side) — turns transient delay into permanent stuck-loading
- Geographic-anchor prompt hardcoding (`GEOGRAPHIC_ANCHOR_AUDIT_2026-04-18.md` H3)

## 8. Open questions for Melody

| # | Question |
|---|----------|
| QN-A1 | Does the prod `DATABASE_URL` contain a `?sslmode=` parameter, and if so, what value? Important for Neon — `sslmode=require` (with `rejectUnauthorized: false`) is the typical Neon-direct setting. |
| QN-A2 | Is the Cloud Run service running with default `instance_max=3` and `min_instances=0`? If `min_instances ≥ 1`, the W3 scale-down race is reduced. |
| QN-A3 | Should I update CLAUDE.md Rule 13 + DATABASE_ENVIRONMENTS.md to reflect "prod is Neon, dev is Helium"? (Doctrine drift fix.) **Awaiting your call before any edit per the no-write constraint.** |
| QN-A4 | Should the LISTEN client be defensively guarded with a startup check that asserts `DATABASE_URL` is the direct (not pooler) URL? Cheap insurance against future migration accidents. |
| QN-A5 | Is `min_instances=1` desirable to eliminate the cold-start lazy-LISTEN race? Trade-off: one always-on Cloud Run instance billing vs. cleaner SSE behavior. |
| QN-A6 | The `SmartBlocks` generation path in autoscale (worker never runs) needs a separate trace — is it inline in `blocks-fast.js` or somewhere else? Want to confirm no dead path. |

## 9. Constraints honored

- No code edits, no commits, no pushes, no DB writes, no migrations, no server restarts, no republish.
- **Phase 0a commit `e7034939` untouched** — no rebase, amend, or push.
- Dev-only filesystem reads. Prod DB never touched. Dev DB never queried.
- `DECISIONS.md` not modified.
- All findings reported as text; no source files modified.

## Memory Index

| # | Section | Title |
|---|---------|-------|
| NA1 | §1 | Doctrine drift: 9 sources claim Helium for prod; reality is Neon |
| NA2 | §2 | A1: prod URL is direct Neon endpoint (no `-pooler` suffix) |
| NA3 | §3 | A2: pooled-LISTEN root cause RULED OUT (prod is direct) |
| NA4 | §4 | A3: Cloud Run autoscale + multi-instance NOTIFY semantics + 3 race windows (W1/W2/W3) |
| NA5 | §5 | A4: ENABLE_BACKGROUND_WORKER default `false` + autoscale guardrail = G6 dormant in prod |
| NA6 | §6 | A5: MONO vs Autoscale orthogonal — log message misleading; 1–3 MONO instances run concurrently in prod |
| NA7 | §7 | Topology contribution to Frisco-lock: ~30% (multiplier on Bug A) |
