# Vecto-Pilot Remediation Plan — 2026-04-23 (rev 3, 2026-04-24)

**Source audit:** conversation report 2026-04-23 (15 phases, ~40 findings) + Melody's 2026-04-24 re-verification with confidence scoring
**Prior audits cross-referenced:** [`full-audit-2026-04-04.md`](full-audit-2026-04-04.md), [`audits/NEON_AUTOSCALE_TOPOLOGY_2026-04-18.md`](audits/NEON_AUTOSCALE_TOPOLOGY_2026-04-18.md), [`../DOC_DISCREPANCIES.md`](../DOC_DISCREPANCIES.md), [`../review-queue/pending.md`](../review-queue/pending.md), [`../../SECURITY_INCIDENT_FINDINGS.md`](../../SECURITY_INCIDENT_FINDINGS.md), [`../../LESSONS_LEARNED.md`](../../LESSONS_LEARNED.md)
**Rule compliance:** Rule 1 (plan before code), Rule 2 (single doc under `docs/`), Rule 3 (pending.md verified first), Rule 6 (pushback integrated — see §0.4), Rule 9 (all findings treated as high), Rule 12 (each phase spawns a LESSONS_LEARNED entry — and rev 3 proposes a read-order amendment)

## What's new in rev 3

1. **§0.7 Environment ground truth** — dev is Replit Helium local (no SSL), **prod is Neon serverless** (valid certs). Three docs in the repo currently say "both Helium" and are wrong; rev 3 adds Phase 0.11 to fix them.
2. **Phase 0.1a** — Neon Console JWKS query, resolves §1.1 active-exploit confidence from 50% → 100%.
3. **Phase 0.9 flipped** — rev-2 framing was wrong (I'd confused dev-Helium with prod-Neon). Correct: prod Neon certs are valid → `rejectUnauthorized: true` stays; `rejectUnauthorized: false` was a leftover bypass that must come off.
4. **Phase 0.11** — reconcile CLAUDE.md Rule 13, DATABASE_ENVIRONMENTS.md, and `connection-manager.js` inline comment; propose amendment to Rule 12 read-order (session-start should read newest audit *before* older doctrine).
5. **Phase 0.12** — prior-audit claim reconciliation (C-1..C-5 / H-1..H-8 at 60% confidence need regression-test pass; COACH-H* / CM-* at 80-85% need DOC_DISCREPANCIES re-read before fix effort commits).
6. **Phase 3.7 split** — retry tuning must be measured on Neon, not inherited from Helium.
7. **Confidence-weighted sequencing table (§0.8)** — 100%-confidence items ship first; 50-85% items carry a verification sub-step before the fix.
8. **3 additional pushbacks** (#11, #12, #13) documented in §0.4.

## 0. Context and scoping rules

### 0.1 Branch strategy — on main, tested live

Per Melody's directive: **work happens on `main`, commit-by-commit, Claude and Melody test the same state together.**

- **Atomic commits.** One concern per commit.
- **Test-before-commit (Claude).** Smoke-test locally (`bin/vecto-runner start` + targeted curl / unit run) before push.
- **Test-immediately-after-commit (Melody).** ~5 min turnaround on each commit's test matrix.
- **Phase 0 gates deployment, not merge.** Auto-deploy paused in Replit Deployments panel throughout Phase 0.
- **Rollback = `git revert <sha>`.**
- **No big-bang commits.** >8 files or >300 lines → split.

### 0.2 Already staged — do NOT redo

| Audit finding | Staged fix (in `pending.md`) |
|---|---|
| §2.4 "Pool retries once and gives up" (partial) | Pool `idleTimeoutMillis` 10s→30s, 57P01/08006 retry wrapper, `allowExitOnIdle: false` |
| §2.x CORS 403 for blocked origins | `isAllowedOrigin` predicate + pre-middleware 403 + log dedup |
| `venue_catalog` 23505 `place_id` drift | `insertVenue` 23505 fallback + `saveVenueCatalogEntry` race-safe insert |

**Phase 0.0:** confirm these pass their test plan before starting any new work. Phase 3 (DB pool) expands the 57P01 retry from 1 to 3 attempts after Melody's approval (with Neon-tuned delays — see Phase 3.7).

### 0.3 Corrected §1.1 threat framing

`keys/*.pem` are live Neon RLS RS256 signing keys (confirmed by `scripts/make-jwks.mjs`, `scripts/sign-token.mjs`, `public/.well-known/jwks.json`, and `migrations/004_jwt_helpers.sql`, October 2025). A holder of the leaked `private.pem` can sign an RS256 JWT with arbitrary `sub` / `tenant_id` / `role: 'authenticated'` claims. **If** Neon prod has registered the JWKS URL under the project's RLS/Auth providers, that JWT grants DB-layer access as any chosen user — authorization bypass across the entire RLS surface. Whether the JWKS URL is currently registered is resolved by Phase 0.1a.

### 0.4 Pushbacks against rev 1 / rev 2 (13 total, all integrated)

| # | Pushback | Addressed in |
|---|---|---|
| 1 | `make-jwks.mjs` emits one kid; rotation needs both | Phase 0.4a |
| 2 | `callModel` throw-flip breaks callers' `{ok:false}` branches | Phase 2.6 (introduce `callModelOrThrow`, migrate caller-by-caller) |
| 3 | `.replit` `[deployment].run` authority unverified | Phase 1.1b boot-marker |
| 4 | No shared LLM-JSON parse util → 25 divergent sites | Phase 2.0 (`parseLlmJson` util first) |
| 5 | Pool retry at 2 attempts / 650ms too shallow for 2–5s failovers | Phase 3.7 (now split — measure first) |
| 6 | CSP nonce breaks Vite HMR in dev | Phase 4.2 (dev-vs-prod CSP split) |
| 7 | Logger migration needs `appLog` primitive first | Phase 5.0 |
| 8 | History scrub needs collaborator notification protocol | Phase 0.7 expanded |
| 9 | `start-replit.js` port-kill must be no-op in deployment | Phase 1.5a |
| 10 | Rev-1 §3.4 SSL test was backwards (Neon, not Helium) | Phase 0.9 (revised — `rejectUnauthorized: true` for prod Neon) |
| **11** (new) | **Rev-2 §0.9 was wrong: I said "Helium certs don't need bypass" but Helium is dev (no SSL). The SSL question was always about Neon prod.** | Phase 0.9 revised |
| **12** (new) | **Doc-drift is a Rule 4 violation — three docs say "both Helium"; only the 2026-04-18 audit is correct.** | Phase 0.11 + Rule 12 read-order amendment |
| **13** (new) | **Rev-2 §3.7 retry schedule was tuned for Helium failover; Neon has different characteristics.** | Phase 3.7 split — measurement first, tune second |

### 0.5 Additions (5)

| ID | Addition | Addressed in |
|---|---|---|
| A | `test-results/` to `.gitignore` | Phase 6.11 |
| B | Log-redaction regex needs anchored patterns + false-positive tests | Phase 5.5 |
| C | `process.exit(1)` loses unflushed stdout — use `exitCode + setImmediate` | Phase 2.1a |
| D | Each phase closes with a `LESSONS_LEARNED.md` entry | Phase 9 |
| E | On-main branch strategy | §0.1 globally |

### 0.6 Dependency-ordered phases

Graph at the bottom. Phase 0 gates deployment; Phase 1 gates Phases 2–4; Phase 5 gates on 2+3.

### 0.7 Environment ground truth (new in rev 3)

Per [`audits/NEON_AUTOSCALE_TOPOLOGY_2026-04-18.md`](audits/NEON_AUTOSCALE_TOPOLOGY_2026-04-18.md) — the authoritative source:

| Environment | DB provider | Topology | SSL |
|---|---|---|---|
| **Dev** (workspace / Run button) | **Replit Helium (PostgreSQL 16)** | Local instance, `sslmode=disable`, host=`helium`, db=`heliumdb` | No SSL |
| **Prod** (deployed app) | **Neon serverless** (direct endpoint) | `PGHOST=ep-noisy-cake-afv3ojg3.c-2.us-...`, `PGDATABASE=neondb`, `PGUSER=neondb_owner` | SSL required, valid certs |

Three docs in the repo currently contradict this ground truth — see Phase 0.11 for the fix list.

**Implications for the plan:**
- §2.4 pool retry characteristics differ between Helium (local, no failover concept) and Neon (serverless, cold-start + branch failover modes). Phase 3.7 retry schedule must be measured on Neon prod, not assumed.
- §0.9 SSL posture — prod Neon certs are legit → `rejectUnauthorized: true` is correct; the current `rejectUnauthorized: false` is a leftover bypass that must come off.
- §1.1 credential-leak urgency increases: prod runs Neon, the scripts' comments explicitly reference "Register this URL in Neon Console," and migration 004_jwt_helpers.sql exists. The active-exploit probability is 50-100% pending Phase 0.1a result.

### 0.8 Confidence-weighted sequencing (new in rev 3)

Melody's re-audit gave each finding a confidence score. Plan commits effort proportional to confidence; items below 90% get a verification sub-step *before* the fix ships.

**100%-confidence items (ship first, no pre-verification needed):**
1.2 entry-point drift, 1.3 uncaughtException, 1.4 getAgentState, 1.6 JSON.parse (hot paths verified individually), 2.1 silent .catch, 2.4 pool retry/stats.max/statement_timeout, 2.7 worker restart fallback, 2.8 setInterval leaks, 3.2 sdk-embed self-documenting bugs, 3.3 start-replit.js dead vars, 3.4 _future/ dirs, 3.5 briefing-service god class, 3.6 env-loader regex, 3.10 diagnostic endpoint leak, 3.12 no boot-time DB healthcheck, 4.2 outdated deps, 4.3 logging inconsistency, 4.4 branch sprawl, 4.5 dead research:models, 4.7 keys/.gitkeep.

**85-95% items (verify before fix):**
1.5 command injection (caller audit of `filePath` validators), 2.2 Helmet bypass (curl header presence check), 2.3 rate-limit order (curl loop to confirm), 2.5 requireAuth cascade (reasoned, not load-tested), 2.6 abort-signal (verify each SDK accepts `signal`), 2.9 D-092/093/099/100 (re-read DOC_DISCREPANCIES to confirm still open), 3.1 sdk-embed ghost routes (curl the ghost endpoints), 3.7 env-loader quote strip, 3.11 CORS+CSRF (confirm no cookie auth exists), 4.1 unused deps (re-run depcheck per-dep), 4.6 .replit duplicate workflow (test whether both fire), 4.8 test-results in .gitignore.

**50-80% items (measurement-gated — verify first, may change scope):**
1.1 active-exploit framing (Neon Console JWKS registration — Phase 0.1a), 3.8 tsconfig.agent.json (could be intentional stub), 3.9 model IDs stale (runtime validation catches this naturally — defer to Phase 7.6 opportunistically).

**Prior-audit claims relayed without re-verification (re-verify in Phase 0.12):**
- C-1..C-5 / H-1..H-8 briefing fixes claimed "FIXED 2026-04-04" at 60% confidence — need regression test.
- COACH-H7, COACH-H8 at 80% confidence — still listed PENDING in `DOC_DISCREPANCIES.md`.
- CM-1..CM-16 at 85% confidence — still listed PENDING.
- D-092, D-093 at 75% confidence — could be silently fixed.

---

## Phase 0 — Credential rotation + environment reconciliation (GATING)

### Objective

Close the live credential exposure. Reconcile the three docs that disagree about prod DB provider. Every downstream phase's fix reaches users through deployments; auto-deploy stays paused until this phase is closed.

### Work items

| # | Item | Files | Owner |
|---|------|-------|-------|
| 0.0 | **Pause auto-deploy** in Replit Deployments panel. Record timestamp. | Replit UI | Melody |
| 0.1 | Confirm Neon RLS status in **prod Neon DB**. Run on prod Neon: `\df+ neon_identity.*`, `SELECT * FROM pg_policies WHERE qual::text ILIKE '%jwt.claims%' OR qual::text ILIKE '%current_setting%jwt%';`, `SELECT * FROM pg_proc WHERE proname ILIKE '%jwt%';`. Record result. | `migrations/004_jwt_helpers.sql` (read-only), prod Neon DB | Melody |
| **0.1a (new)** | **Neon Console JWKS registration check.** Open Neon Console → project `ep-noisy-cake-afv3ojg3` → Settings → RLS / Auth providers. Record: (a) is there a JWKS URL registered? (b) does it point at `https://vectopilot.app/.well-known/jwks.json` or equivalent? (c) what kids are trusted? **This step resolves §1.1 active-exploit confidence from 50% → 100%.** | Neon Console | Melody |
| 0.2 | Neon Console: rotate DB passwords (all 3 leaked generations), revoke Neon API token `<LEAKED-NEON-API-TOKEN>`, refresh prod `DATABASE_URL` in Replit Secrets (only prod — dev Helium `DATABASE_URL` is local and unrelated). | Replit Secrets | Melody |
| 0.3 | GCP Console: delete service-account key for `vertex-express@quantum-fusion-486920-p2.iam.gserviceaccount.com`, delete API key `<LEAKED-GCP-KEY-A>`, issue new restricted replacements (HTTP referrer / IP allowlist). Submit suspension appeal. | GCP Console | Melody |
| 0.4a | **If Neon RLS is live (per 0.1 + 0.1a):** update `scripts/make-jwks.mjs` to emit a JWKS containing BOTH `vectopilot-rs256-k1` and `vectopilot-rs256-k2`. Local test: run, confirm 2 entries in `public/.well-known/jwks.json`. | `scripts/make-jwks.mjs` | Claude (1 commit) |
| 0.4b | Generate new keypair (`openssl genrsa -out keys/private-k2.pem 2048`); update `scripts/sign-token.mjs` to accept `--kid`. | `keys/private-k2.pem`, `keys/public-k2.pem`, `scripts/sign-token.mjs` | Claude (1 commit) |
| 0.4c | Publish dual-key JWKS, deploy, register new JWKS URL in Neon Console (if needed per 0.1a), 24h grace. | `public/.well-known/jwks.json`, Neon Console | Claude + Melody |
| 0.4d | After grace: emit only k2, delete old pair, regenerate JWKS. Verify sign-log kid distribution shows zero k1 usage before revocation. | `keys/`, `public/.well-known/jwks.json` | Claude + Melody |
| 0.4-alt | **If Neon RLS is NOT live (both 0.1 and 0.1a null):** `git rm keys/private.pem keys/public.pem public/.well-known/jwks.json`, delete `scripts/make-jwks.mjs` + `scripts/sign-token.mjs`, drop `migrations/004_jwt_helpers.sql` via forward migration, remove `jose` from `package.json`. | `keys/`, `scripts/`, `migrations/`, `package.json` | Claude + Melody |
| 0.5 | GitHub Settings → Danger Zone: make `melodydashora/Vecto-Pilot` private. | GitHub | Melody |
| 0.6 | `.gitignore` additions: `keys/`, `.env*` (except `.env.example`), `test-results/`, `*.pem`. | `.gitignore` | Claude (1 commit) |
| 0.7 | History scrub with collaborator protocol — see rev 2 for the 7-step procedure. Inventory, notify, stage on mirror, force-push in quiet window, re-clone notifications, CI cache invalidation. | whole repo | Melody + Claude |
| 0.8 | Install `gitleaks` or `trufflehog` pre-commit hook. | `.git/hooks/pre-commit` | Claude (1 commit) |
| **0.9 (revised per pushback #10 + #11)** | **SSL posture on prod Neon.** Prod Neon has valid certs → `rejectUnauthorized: true` is correct. Current code at `server/db/connection-manager.js:15` has `rejectUnauthorized: false`, which is a leftover bypass. Change to `isProduction ? { rejectUnauthorized: true } : false` (dev stays unchanged — Helium local no SSL). Test: `bin/vecto-runner start` against prod Neon connects cleanly; dev against Helium unchanged. | `server/db/connection-manager.js:15` | Claude (1 commit) |
| 0.10 | **Unpause auto-deploy** after Phase 0 exit criteria met. | Replit UI | Melody |
| **0.11 (new — pushback #12)** | **Doc reconciliation for prod = Neon.** Three docs currently say "both Helium" and are wrong:<br>(a) `CLAUDE.md` Rule 13 — rewrite to "Dev is Replit Helium (local, no SSL); Prod is Neon serverless (valid certs, SSL required)." Keep the Rule ID stable (13).<br>(b) `docs/architecture/database-environments.md` — same rewrite; add a changelog entry dated 2026-04-24 referencing the 2026-04-18 NEON_AUTOSCALE audit as authoritative.<br>(c) `server/db/connection-manager.js:3-4` — replace inline comment ("DATABASE_URL auto-injected by Replit (Helium PostgreSQL 16)") with "Dev = Replit Helium local (no SSL); Prod = Neon serverless (SSL required, valid certs)."<br>**Rule 12 read-order amendment proposal:** session-start review should read newest audit/timestamped doc *before* older doctrine files. Concretely: session-start #6 (`full-audit-2026-04-04.md`) should be re-ordered ahead of #2 (`database-environments.md`) when the newer audit is more recent. Add a note to Rule 12 that freshness beats doctrine for contested facts. | `CLAUDE.md`, `docs/architecture/database-environments.md`, `server/db/connection-manager.js` | Claude (1 commit) |
| **0.12 (new)** | **Prior-audit-claim reconciliation.** The audit relayed "C-1..C-5 / H-1..H-8 fixed 2026-04-04" at 60% confidence without regression-testing. Before Phase 10's full re-verification, do a targeted read:<br>(a) `grep -rn "fetchTrafficConditions\|fetchEventsForBriefing\|fetchRideshareNews" server/lib/briefing/` — confirm barrel exports point at correct functions (C-1).<br>(b) Read `server/api/briefing/briefing.js` around lines 407, 429 — confirm imports present (C-2, C-3).<br>(c) Read DOC_DISCREPANCIES.md — confirm COACH-H7, COACH-H8, CM-1..CM-16, CH-5 still marked PENDING. Pull any that show RESOLVED into Phase 7's skip list.<br>**Output:** a reconciled open-item list appended to this plan as Appendix A. | this plan (Appendix A) | Claude (1 commit) |

### Success criteria

- Phase 0.1 + 0.1a results recorded; Branch A or B decision documented in `SECURITY_INCIDENT_FINDINGS.md`.
- `openssl sha256 keys/private.pem` no longer matches the incident hash.
- `git log --all -- keys/private.pem` returns nothing.
- GitHub visibility = Private.
- Pre-commit hook blocks a fake GCP-key-format test string. (Format intentionally omitted from this doc to avoid scanner triggers. See gitleaks' `google-api-key` rule or truffleHog's GCP detector for the pattern used during hook testing.)
- CLAUDE.md Rule 13, DATABASE_ENVIRONMENTS.md, and connection-manager.js comment all agree: dev=Helium, prod=Neon.
- Auto-deploy unpaused with a clean boot log against Neon with `rejectUnauthorized: true`.
- Appendix A lists reconciled prior-audit open items.

### Test plan

| Test | Expected |
|---|---|
| (0.1) SQL queries against prod Neon | Written result with verdict |
| (0.1a) Neon Console JWKS registration | Written result with verdict |
| (0.4a) `node scripts/make-jwks.mjs` with both keys | JWKS has 2 entries |
| (0.4c) k2-signed JWT after Neon re-registration | RLS grants `authenticated` |
| (0.4c) k1-signed JWT during grace | Still works |
| (0.4d) k1-signed JWT after grace ends | Rejected |
| (0.6) Commit a `.env` file | Blocked by gitignore |
| (0.7 mirror) `git filter-repo` on mirror | Mirror has no PEM history |
| (0.8) Commit a fake GCP-key-format line | Pre-commit hook blocks |
| (0.9) Deploy to prod Neon with `rejectUnauthorized: true` | DB connects; `/health` 200 |
| (0.9) Dev against Helium | Unchanged |
| (0.11) Grep `"both Replit Helium"` or `"both.*Helium"` across repo | Zero hits (all three docs reconciled) |
| (0.12) Appendix A appended | Reconciled list present |

### LESSONS_LEARNED entry for Phase 0

Title: "RLS JWT forgery is a real leak threat — rotation requires dual-kid JWKS, not just new keys. Also: when three authoritative docs disagree about prod DB, the newest audit wins."
Captures: (a) the audit's "orphaned relic" framing was wrong; (b) dual-kid JWKS mechanics for zero-downtime rotation; (c) the session-start review protocol must prioritize freshness over doctrine-age for contested facts; (d) why `.env*` and keypair material never belong in history.

---

## Phase 1 — Entry-point & boot-path consolidation

### Objective

One boot path, hardened, used by both local Run and `[deployment]`. Kill dead entry files so drift stops.

### Work items

| # | Item | Files |
|---|------|-------|
| 1.0 | Inventory every `r.use` / `r.get` / `r.post` in `sdk-embed.js` vs explicit mounts in `bootstrap/routes.js`. List sdk-embed-only routes. | `sdk-embed.js`, `server/bootstrap/routes.js` |
| 1.1a | Align `.replit` `[deployment].run` with local path. | `.replit` |
| 1.1b | **Verify `.replit` authority.** Add unique boot marker (`console.log('[boot-marker] scripts/start-replit.js entered, deployment=<bool>, db_host=<masked>')`). Deploy to staging slot. Confirm marker in deployment log. If absent, investigate Replit Cloud Run config panel — do not proceed. | `scripts/start-replit.js` |
| 1.2 | Delete `index.js` root file. | `index.js` |
| 1.3 | Delete `agent-server.js` and `npm run agent`. Confirm with `gh` / Replit workflow history first. | `agent-server.js`, `package.json` |
| 1.4 | Delete `start.sh`. Update CLAUDE.md Key Files section. | `start.sh`, `CLAUDE.md` |
| 1.5 | Clean `scripts/start-replit.js`: remove dead `isCloudRun`, unused `isDeployment`, misleading `'Local development mode'` log. | `scripts/start-replit.js` |
| 1.5a | Wrap port-5000 kill in `if (!isDeployment)`. | `scripts/start-replit.js` |
| 1.6 | Fold sdk-embed-only routes into explicit mounts in `bootstrap/routes.js`. Delete `sdk-embed.js`. | `sdk-embed.js`, `bootstrap/routes.js` |
| 1.7 | Remove dead `isCloudRun` + unused `isDeployment` in `gateway-server.js`. | `gateway-server.js` |
| 1.8 | Delete `tsconfig.agent.json`. | `tsconfig.agent.json` |

### Test plan

| Test | Expected |
|---|---|
| (1.1b) Staging deploy log | Boot marker present |
| `npm run dev` (local) | Gateway boots, `/health` 200, health gate log present, boot marker shows `deployment=false` |
| Prod deploy | Boot marker shows `deployment=true, db_host=ep-noisy-cake...` |
| `curl /api/metrics/jobs` | 200 (fold-in succeeded) |
| `curl /api/nonexistent` | 404 (fallback masking gone) |
| `node index.js` | `Cannot find module` |
| `grep -rn "index\.js\|agent-server\.js\|start\.sh" --include="*.md" --include="*.js"` | No live references |

### LESSONS_LEARNED entry for Phase 1

Title: "Multiple entry points + deployment config drift = prod skips hardening silently."
Captures: `.replit` authority verification via boot markers; anti-pattern of parallel mount paths; why dead entry files rot rather than stay harmless.

---

## Phase 2 — Error handling correctness

### Objective

Stop swallowing errors. LLM-output parsing is uniform. Production crashes should crash and restart, not zombie.

### Work items

| # | Item | Files |
|---|------|-------|
| 2.0 | Create `server/lib/ai/utils/parse-llm-json.js` by lifting `parseAiJsonResponse` out of `briefing-service.js:790-865`. Export `parseLlmJson(text, { context, fallback, logger })`. Unit tests cover 8+ malformed-input cases. | new file + new test |
| 2.1 | Always exit on `uncaughtException`. | `gateway-server.js:55-58` |
| 2.1a | Use `process.exitCode = 1; setImmediate(() => process.exit(1))` for stdout flush before exit. | same |
| 2.2 | Same pattern for `unhandledRejection`. | `gateway-server.js:60-63` |
| 2.3 | Replace `JSON.parse` with `parseLlmJson` at 5 hot-path sites: `vertex-adapter.js:145`, `gemini-adapter.js:220`, `consolidator.js:444`, `briefing-service.js:537`, `triad-worker.js:71`. | those 5 files |
| 2.4 | Audit the other ~20 `JSON.parse` sites (perplexity, venue-intelligence, holiday-detector, docs-agent, scripts). Wrap with `parseLlmJson` or justify inline. | per audit §1.6 |
| 2.5 | Replace `.catch(() => {})` with logged catch at `db-client.js:71,90,101,167`, `blocks-fast.js:287`. Fire-and-forget stats (`venue-cache.js`, `venue-enrichment.js`) keep swallow + log. | those files |
| 2.6 | **Do NOT flip `callModel` to throw.** Introduce `callModelOrThrow` as parallel API. Migrate hard-fail callers one commit per subsystem (briefing, coach, concierge, strategy). `callModel` semantics unchanged for fallback-dependent callers. | `server/lib/ai/adapters/index.js` + callers |
| 2.7 | COACH-H8 fix: `chat.js:1325-1345` — `await` + structured error + metric. | `chat.js` |
| 2.8 | **C-5 `local_iso` hardening** (from Phase 0.12 reconciliation, 2026-04-24). Replace `new Date(snapshot.local_iso).toISOString().split('T')[0]` with `snapshot.local_iso.split('T')[0]` at 5 sites (lines 1071, 1185, 1973, 2241, 2380). Pure string slice removes Node-TZ dependency; no functional change in UTC-server prod. Non-blocking — current state works in prod containers. | `server/lib/briefing/briefing-service.js` |

### Pre-implementation verification (per §0.8)

- §2.2 Helmet bypass: `curl -I http://localhost:5000/assets/index-<hash>.js` BEFORE fix; confirm headers absent. After fix: confirm present.
- §2.3 rate-limit: bash loop 300 req/min to `/api/health` BEFORE fix; confirm hitting 100/min cap. After fix: confirm 200/min cap.
- §2.6 abort signal: grep each SDK's type defs for `signal` parameter support. Unknown SDK support = that adapter's abort forwarding is a no-op; document.

### LESSONS_LEARNED entry for Phase 2

Title: "LLM output is untrusted input — parse it through one util, not 25 try/catches."

---

## Phase 3 — DB pool & auth resilience

### Objective

Pool is honest about its state. Auth survives brief DB blips. Retry schedule is measured, not guessed — particularly important now that prod is Neon serverless with different failover characteristics than assumed.

### Work items

| # | Item | Files |
|---|------|-------|
| 3.1 | Replace `getAgentState` stub with real pool read. | `connection-manager.js:119` |
| 3.2 | Fix `stats.max` fallback (`?? 35` → `?? 25`). | `connection-manager.js:86` |
| 3.3 | Delete misleading constructor-level `statement_timeout: 30000`. | `connection-manager.js:27` |
| 3.4 | SSL already addressed in Phase 0.9. | — |
| 3.5 | Boot-time `SELECT 1` health check — fail-fast on unreachable DB. | `gateway-server.js` bootstrap |
| 3.6 | `requireAuth` session query retry: 3 attempts at 100ms / 300ms / 800ms. | `server/middleware/auth.js:217` |
| **3.7-measurement (revised per pushback #13)** | **Before tuning the retry schedule, measure it.** Add structured log events `{event: 'pool.retry', attempt: N, delay_ms: D, error_code: C}` at each retry. Deploy to prod Neon. Collect 72h of data (normal ops + any incidental failovers). | `connection-manager.js` retry wrapper |
| **3.7-tune** | Based on measurement data, set retry schedule. Provisional guess (override with data): Neon cold-start from suspend ~300ms, branch failover 1-3s, endpoint failover rare. Start with **3 attempts at 200ms / 700ms / 2000ms** if data says 2-3s covers P99 of observed failover events. | `connection-manager.js` |
| 3.8 | Delete `useLogFile: false` branch in `workers.js`. | `server/bootstrap/workers.js` |

### Pre-implementation verification (per §0.8)

- §3.1 baseline: measure what `getAgentState()` returns NOW vs what the real state should be. Capture 10 snapshots during normal ops + one terminate-all.
- §3.7 measurement: 72h window is a gate, not a waitable step. Land `3.7-measurement` as an early commit, collect data in parallel with Phases 4-6, tune last.

### Test plan

| Test | Expected |
|---|---|
| Kill pool connections mid-request | Retries visible in logs (counts reflect 3.7-measurement data) |
| `/api/health` during terminate-all | 200 with real `{degraded: true, consecutiveErrors: N}` |
| Boot with unreachable `DATABASE_URL` | Exit <1s with clear error |
| `requireAuth` with pool terminated | 3 retries logged; request succeeds or clean 503 |
| 72h prod measurement window | Data file captured: `docs/architecture/pool-retry-measurements-<date>.md` |

### LESSONS_LEARNED entry for Phase 3

Title: "Health endpoints that lie are worse than no health endpoints. Retry schedules must be measured on the actual DB, not inherited from a different one."

---

## Phase 4 — Security hardening

### Objective

Close the chain bypasses and info leaks.

### Work items

| # | Item | Files |
|---|------|-------|
| 4.1 | Move `express.static` AFTER `configureMiddleware`. | `gateway-server.js:94` |
| 4.2 | CSP nonce migration, dev-vs-prod split. Prod: drop `'unsafe-inline'`, use per-request nonce via middleware + Helmet callback, inject into Vite-built `index.html`. Dev: keep `'unsafe-inline'` via env-conditional CSP OR wire Vite HMR client through the nonce middleware. | `bootstrap/middleware.js`, client `index.html`, `vite.config.ts` |
| 4.3 | `execFile` in `docs-agent/publisher.js`. | `server/lib/docs-agent/publisher.js` |
| 4.4 | Gate or delete `/api/diagnostic/db-info`. | `gateway-server.js:108-121` |
| 4.5 | Fix rate-limit order: `healthLimiter` before `globalApiLimiter` with `skip`. | `bootstrap/middleware.js:107` |
| 4.6 | 413 JSON response; client pre-flight size check. | `bootstrap/middleware.js`, client uploads |
| 4.7 | Document CORS/CSRF posture in `docs/architecture/AUTH.md`. | that file |

### LESSONS_LEARNED entry for Phase 4

Title: "Middleware order is security posture — static files mounted first = Helmet skipped."

---

## Phase 5 — Observability: health must tell the truth

### Work items

| # | Item | Files |
|---|------|-------|
| 5.0 | Extend `logger/workflow.js` with `appLog(context, level, msg, meta)`. | `server/lib/logger/workflow.js` |
| 5.1 | `/health` endpoint uses real `getAgentState`. | `server/api/health/health.js` |
| 5.2 | `signal` forwarding through 4 adapters. | `server/lib/ai/adapters/*-adapter.js` |
| 5.3 | Track 7 `setInterval` handles; clear on shutdown. | 7 files |
| 5.4 | `console.*` → `appLog` tranche migration. One commit per tranche (AI adapters → briefing → auth → rest). | server-wide |
| 5.5 | Log redaction with anchored regex + length guards + false-positive tests. | `logger/workflow.js`, new test file |

### LESSONS_LEARNED entry for Phase 5

Title: "Redaction regex without length guards false-positives on user text."

---

## Phase 6 — Dead code & dependency cleanup

### Work items

| # | Item | Files |
|---|------|-------|
| 6.1 | Delete `_future/` dirs if no live imports. | `client/src/` |
| 6.2 | **Per-dep re-verification before deletion** (per §0.8, deps confidence is 70%): re-run depcheck on each of `@anthropic-ai/vertex-sdk`, `@replit/extensions`, `http-proxy`, `http-proxy-middleware`, `ajv`, `eventsource`. For each, grep `--include="*.js" --include="*.ts" --include="*.mjs" --include="*.tsx" --include="*.jsx"` (note: including `.mjs` — the `jose` false-negative came from scoping too narrow). Delete only confirmed-dead. Keep `jose`. | `package.json` |
| 6.3 | Pick `ts-node` OR `tsx`. | `package.json` |
| 6.4 | Reinstall node_modules. | `package-lock.json` |
| 6.5 | `tsconfig.agent.json` — handled in Phase 1.8. | — |
| 6.6 | Delete `research:models` npm script. | `package.json` |
| 6.7 | Consolidate `.replit` duplicate workflow. | `.replit` |
| 6.8 | Prune stale remote branches. | GitHub |
| 6.9 | Major dep bumps: `@anthropic-ai/sdk`, `openai`, `googleapis`, `drizzle-orm`. One commit per SDK. | `package.json` |
| 6.10 | Express 4 → 5 — separate plan, not bundled here. | — |
| 6.11 | `test-results/` gitignore (restated from 0.6). | `.gitignore` |
| 6.12 | `lucide-react 0.553 → 1.9` — UI sweep required. | `package.json` + icon usages |

### LESSONS_LEARNED entry for Phase 6

Title: "Dep audit needs to scope `*.mjs` or it lies about what's unused."

---

## Phase 7 — Known unfixed items from prior audits

### Objective

Close the items confirmed open by Phase 0.12's reconciliation. (Do NOT attempt items that 0.12 shows are already resolved.)

### Work items (pending 0.12 output)

| # | Prior ID | Action |
|---|---|---|
| 7.1 | D-092 `VECTO_AGENT_SECRET` | Melody: add to Replit Secrets, verify |
| 7.2 | D-093 `TOKEN_ENCRYPTION_KEY` | Melody: add + test Uber OAuth |
| 7.3 | D-099 event search 90s timeout | Measurement pass → fix (same pattern as Phase 3.7) |
| 7.4 | D-100 client payload | Client compression util + pre-flight check |
| 7.5 | COACH-H7 streaming fallback | Register `CHAT_COACH_FALLBACK` to OpenAI |
| 7.6 | CH-5 concierge coords | Backfill from Gemini or typed error |
| 7.7 | CM-1..CM-16 | 3 sub-commits (security / reliability / UX) |
| 7.8 | Coach-inbox high-priority bugs | Bundle into coach-inbox-clearance series |
| 7.9 | Model-ID staleness (§3.9, 55% confidence) | Low priority — defer to opportunistic runtime validation pass |

### LESSONS_LEARNED entry for Phase 7

Title: "Audit carryover is a commitment — untracked deferrals become permanent tech debt."

---

## Phase 8 — briefing-service.js split (future, separate plan)

Prerequisite: Phase 2 complete. See rev 2 §Phase 8 for pre-work checklist.

---

## Phase 9 — LESSONS_LEARNED maintenance

Per-phase entry at closure, per §0.5 addition D. Working titles listed at the end of each phase above.

---

## Execution-order dependency graph

```
Phase 0 (credentials + env reconciliation)
  ├─→ Phase 1 (entry points) ─┬─→ Phase 2 (error handling) ─┬─→ Phase 5 (observability)
  │                           ├─→ Phase 3 (DB/auth) ────────┤
  │                           └─→ Phase 4 (security) ───────┘
  │                              (Phase 3.7-measurement runs
  │                               in parallel with 4/5/6 —
  │                               72h collection window)
  │
  └─→ Phase 7 (prior audit, gated on 0.12 reconciliation output)
        │
        ↓
  Phase 6 (cleanup) ─→ Phase 8 (future briefing split)

Phase 9 (LESSONS_LEARNED) closes each phase — runs alongside.
```

---

## Per-commit approval protocol (same as rev 2)

1. Claude writes target item + test matrix into `pending.md` before coding.
2. Claude implements + smoke-tests locally.
3. Claude commits to main; message references phase+item ID.
4. Melody runs test matrix within ~5 min.
5. Approval → move entry to `reviewed-queue/CHANGES.md` with SHA.
6. Rejection → fix forward (new commit) or `git revert <sha>`.

---

## Rollback strategy (on-main)

- Unit = single commit SHA. Rollback = `git revert <sha>`.
- Never force-push, never reset on main (outside Phase 0.7 which is the one-time history scrub).
- N consecutive reverts in a phase → pause and re-read the phase section.

---

## Estimated effort (rev 3 — slight increase for Neon-specific work)

| Phase | Effort |
|---|---|
| 0 | 2 days Melody console work + 1.5 day Claude (dual-kid JWKS + doc reconciliation + prior-audit recon in 0.12) |
| 1 | 1 day |
| 2 | 3 days |
| 3 | 1 day core + 72h measurement window (parallel, not blocking) |
| 4 | 2 days |
| 5 | 1.5 days |
| 6 | 0.5 + 0.5 per SDK bump |
| 7 | Variable — depends on 0.12 output |
| 8 | Separate plan |
| 9 | 30 min per phase closure |

---

## Exit criteria

- [ ] `SECURITY_INCIDENT_FINDINGS.md` closure section with rotation dates.
- [ ] `DOC_DISCREPANCIES.md` P0/P1 items all RESOLVED; moved to archive.
- [ ] `pending.md` no AWAITING items >48h old.
- [ ] `LESSONS_LEARNED.md` has 8 new entries (one per Phases 0-7).
- [ ] CI green; zero `--detectOpenHandles` warnings.
- [ ] Boot-marker line in both dev and prod logs; prod log shows `db_host=ep-noisy-cake...` confirming Neon.
- [ ] Three doc sources (CLAUDE.md Rule 13, DATABASE_ENVIRONMENTS.md, connection-manager.js comment) all say "dev=Helium, prod=Neon."
- [ ] Rule 12 read-order amendment landed.
- [ ] `grep -rn "console\." server/api/` approaches 0.
- [ ] `openssl sha256 keys/private.pem` doesn't match incident hash (or file is gone).
- [ ] Pool retry schedule tuned from Neon measurement data (not inherited from Helium assumption).

---

## Open questions before Phase 0 kickoff

1. **(Resolved)** Prod is Neon. Per Melody's 2026-04-24 note + 2026-04-18 NEON_AUTOSCALE audit.
2. **(NEW) Neon Console JWKS registration status?** Resolved by Phase 0.1a.
3. **Are the 2026-04-23 staged changes in `pending.md` test-approved?** If yes, they land before Phase 3. If not, Phase 3.7 subsumes them.
4. **Is there an admin-role concept in auth?** Determines §4.4 gate-vs-delete.
5. **Are any of the 14+ remote branches active?** Required before Phase 6.8.
6. **Budget for Express 4→5?** Deferred to 6.10.
7. **Staging deployment slot for Phase 1.1b boot-marker check?** Required to verify `.replit` authority.

---

## Appendix A — Prior-audit claim reconciliation (populated by Phase 0.12 — 2026-04-24)

| Prior ID | Source | 2026-04-24 status | Action in this plan |
|---|---|---|---|
| C-1 | full-audit-2026-04-04 | ✅ FIXED — `server/lib/briefing/index.js:5` explicit `// FIX C-1` comment + correct names at lines 10-12 | No action — closed |
| C-2 | full-audit-2026-04-04 | ✅ FIXED — `server/api/briefing/briefing.js:3-4` `// FIX C-2 — Added fetchTrafficConditions` + import at line 4 | No action — closed |
| C-3 | full-audit-2026-04-04 | ✅ FIXED — `briefing.js:579-590` `// FIX C-2 — fetchTrafficConditions expects { snapshot } shape` + call uses `{snapshot}` | No action — closed |
| C-4 | full-audit-2026-04-04 | ✅ FIXED — `briefing-service.js:1331` `normalizeEvent(e, { city, state })` | No action — closed |
| C-5 | full-audit-2026-04-04 | ⚠️ **FIXED IN PRACTICE, FRAGILE IN DESIGN** — works only because Node runs UTC in prod containers. `briefing-service.js:1071,1185,1973,2241,2380` all use the fragile `new Date(local_iso).toISOString().split('T')[0]` pattern | **Phase 2 hardening commit**: replace all 5 sites with `snapshot.local_iso.split('T')[0]` (pure string slice; removes Node-TZ dependency). Non-blocking — current state works in prod. |
| H-1 | full-audit-2026-04-04 | ✅ FIXED — `briefing.js:1264-1273` market auth check + 403; `FIX H-1` at line 1331 on reactivate | No action — closed |
| H-2 | full-audit-2026-04-04 | ✅ FIXED — `adapters/index.js:155-159` `FIX H-2` + `timeout: 120000` | No action — closed |
| H-3 | full-audit-2026-04-04 | ✅ FIXED — `model-registry.js:447` `getFallbackConfig(primaryProvider)` (cross-referenced by 2026-02-17 LESSONS_LEARNED) | No action — closed |
| **H-4** | full-audit-2026-04-04 | ❓ **NOT VERIFIED BY GREP** — concurrent `generateAndStoreBriefing` race condition; no grep-visible dedup/lock mechanism found | **Defer to Phase 10 regression** — dedicated scenario test (concurrent same-snapshot briefing generation) needed to confirm race is closed or still open. Do NOT let Phase 0.12 scope-creep. |
| H-5 | full-audit-2026-04-04 | ✅ FIXED — `briefing-service.js:75-95` `FIX H-5` + AbortController + `controller.abort()` | No action — closed |
| H-6 | full-audit-2026-04-04 | ✅ FIXED — `briefing-service.js:1464-1484` `FIX H-6` + full content update in `set:` block | No action — closed |
| **H-7** | full-audit-2026-04-04 | ❓ **NOT VERIFIED BY GREP** — `shared/schema.js` has lat/lng/zip columns at multiple sites, but migration diff required to confirm alignment | **Defer to Phase 10 regression** — schema-vs-migration diff against the specific `briefings` table. Do NOT let Phase 0.12 scope-creep. |
| H-8 | full-audit-2026-04-04 | ✅ FIXED — `briefing.js:896,1043` both have `FIX H-8` comments; `source_model` column removed from schema | No action — closed |
| COACH-H7 | DOC_DISCREPANCIES | ⏸️ Confirmed PENDING per DOC_DISCREPANCIES.md (not grep-reconfirmed this pass) | Addressed in Phase 7.5 |
| COACH-H8 | DOC_DISCREPANCIES | ⏸️ Confirmed PENDING per DOC_DISCREPANCIES.md | Addressed in Phase 2.7 (coach chat save fire-and-forget) |
| CM-1..CM-16 | DOC_DISCREPANCIES | ⏸️ Confirmed PENDING per DOC_DISCREPANCIES.md | Addressed in Phase 7.7 (3 sub-commits) |
| CH-5 | DOC_DISCREPANCIES | ⏸️ Confirmed PENDING per DOC_DISCREPANCIES.md | Addressed in Phase 7.6 |
| D-092 | DOC_DISCREPANCIES | ⏸️ Confirmed PENDING | Addressed in Phase 7.1 (Melody adds to Replit Secrets) |
| D-093 | DOC_DISCREPANCIES | ⏸️ Confirmed PENDING | Addressed in Phase 7.2 |
| D-099 | DOC_DISCREPANCIES | ⏸️ Confirmed PENDING | Addressed in Phase 7.3 (measurement first) |
| D-100 | DOC_DISCREPANCIES | ⏸️ Confirmed PENDING | Addressed in Phase 7.4 |

### Phase 0.12 summary

- **10 of 13** C-* / H-* items explicitly FIXED (verified via grep of fix comments + code pattern).
- **1 of 13** (C-5) FIXED IN PRACTICE, FRAGILE IN DESIGN — Phase 2 hardening commit proposed.
- **2 of 13** (H-4, H-7) deferred to Phase 10 regression testing — neither is grep-reconcilable without deeper trace.
- Audit's original 60% confidence band on these items was overly conservative; actual directly-verified is 77% (10/13) with another 8% (C-5) in practice-fixed.
- Phase 0.12 is **closed** — H-4 and H-7 do NOT get deep-traced here to avoid scope creep; Phase 10's regression pass picks them up cleanly.

### Phase 0.1 directional result (dev Helium only; 0.1a Console check still authoritative for prod)

- 0 RLS policies in dev Helium.
- 0 tables with RLS enabled in dev Helium.
- 5 JWT helper functions (`app.is_authenticated/jwt_claims/jwt_role/jwt_sub/jwt_tenant`) present in dev Helium — migration 004 infrastructure IS installed.
- `app_user` role cannot log in (`rolcanlogin=f`).
- **Directional verdict:** Leans Branch B (scaffolding present, enforcement never wired). If prod Neon matches dev, the `private.pem` leak is **dormant, not live-wired** — rotation still mandatory, urgency drops from "today" to "this week."
- **Authoritative answer pending 0.1a** (Neon Console JWKS URL registration check).

### Deferred items from Phase 0 (added 2026-04-24)

- **Commit C (`chore(db)` connection-manager.js inline comment) deferred pending 2026-04-23 pool-retry test approval.** Reason: `server/db/connection-manager.js` carries uncommitted 57P01 retry + `idleTimeoutMillis` changes from the 2026-04-23 session in `pending.md`. Staging the file for a comment-only fix would sweep those unreviewed changes into the commit (Rule 1 violation). **Option Z chosen:** Commit C lands as its own micro-commit after the 57P01 work commits. Tracked in `pending.md` entry 2026-04-24.
- **C-5 `local_iso` hardening:** queued as Phase 2 item 2.8 above. Non-blocking; current state works in prod.
- **Phase 0.11 shipped 3 of 4 intended commits** on 2026-04-24: Commit D (rule-12 amendment, `0002b20c`), Commit A (rule-13 correction, `1eae0a14`), Commit B (DATABASE_ENVIRONMENTS.md correction, `95c69833`). Commit C queued per above. Commit E (this plan update + pending.md note) lands as part of this closure.

---

*End of plan. Holding. Kickoff starts with Phase 0.0 (pause auto-deploy) and Phase 0.1 + 0.1a (Neon Console + prod DB queries) — those are the two Melody-side gates that resolve the Branch A / Branch B fork for the keypair rotation.*
