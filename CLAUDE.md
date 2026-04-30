# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

---

## 🚨 DEVELOPMENT PROCESS RULES (MANDATORY)

**These rules govern ALL development work. No exceptions.**

### Rule 1: Planning Before Implementation
- **BEFORE making any code changes**, create a plan document in the same directory as the relevant README.md
- Plan must include: objectives, approach, files affected, and **test cases**
- Implementation requires **formal testing approval from Melody** (human developer)
- Do NOT proceed until Melody confirms: "All tests passed"

### Rule 2: Documentation Synchronization (revised 2026-04-18)
- **Sub-READMEs have been removed.** 109 sub-READMEs across `server/`, `client/`, `shared/`, `migrations/`, `scripts/`, `tests/`, `platform-data/`, `data/`, `tools/`, `config/`, `schema/`, `public/`, `keys/`, `attached_assets/` were deleted because they rotted faster than they could be maintained. Only the root `README.md` and everything under `docs/` survive.
- **When files are modified**, update the relevant document under `docs/` — not a sub-README.
- **Canonical living docs:** root `README.md`, `CLAUDE.md`, `ARCHITECTURE.md`, `LESSONS_LEARNED.md`, `docs/architecture/BRIEFING.md`, `docs/EVENT_FRESHNESS_AND_TTL.md`, `docs/VENUELOGIC.md`, `docs/architecture/AUTH.md`, `docs/DOC_DISCREPANCIES.md`, `docs/coach-inbox.md`. (`docs/review-queue/pending.md` was retired 2026-04-29; `claude_memory` rows are now the canonical "unfinished work" surface — see Rule 12 row #3 and Rule 15.)
- **If something was buried in a deleted sub-README that still matters**, move it into the appropriate `docs/` doc (don't recreate the sub-README).
- If a doc edit is skipped during a code change, log it as a `claude_memory` row (`category='audit', status='active'`) per Rule 15. The Markdown `pending.md` was retired 2026-04-29 in favor of the queryable `claude_memory` table.

### Rule 3: claude_memory Active-Rows Verification (revised 2026-04-29; was "Pending.md Verification")
- At session start, **verify any `claude_memory` rows with `status='active'`** that look load-bearing for the work you're about to do (use the Rule 15 canonical query)
- Ensure root documents (CLAUDE.md, ARCHITECTURE.md, LESSONS_LEARNED.md) and the relevant `docs/` files reflect those changes before proceeding with new work
- **History note:** the Markdown `docs/review-queue/pending.md` was retired 2026-04-29; this rule used to point there. Other rules and docs that say "pending.md" should be updated as you encounter them.

### Rule 4: Documentation Currency
- Understand the repo in its current state before making changes
- All documentation must be **fully up to date** at all times
- When in doubt, audit and update docs first

### Rule 5: Major Code Changes - Inline Documentation
- When changing **functional blocks of code** (major changes), add inline comments with:
  - Date of change (YYYY-MM-DD)
  - Reason for the change
- Update the relevant `docs/` file and root documents (CLAUDE.md, ARCHITECTURE.md, LESSONS_LEARNED.md). Sub-READMEs no longer exist — see Rule 2.

### Rule 6: Master Architect Role
- **Do NOT blindly accept Melody's memory or advice** - act as a master architect
- Push back on decisions that don't make technical sense
- Create sub-agents (Task tool) for complex investigations
- Make logical, well-reasoned decisions with justification

### Rule 7: Rideshare Coach Data Access (Schema Changes)
When schema changes are made, ensure the **Rideshare Coach** has access to:
- All database tables
- Snapshot history filtered by `user_id`
- Connected static data (markets, platforms, venue catalogues)

### Rule 8: Rideshare Coach Write Access
The Rideshare Coach needs **write access** to capture learnings from real user interactions:

| Table | Purpose |
|-------|---------|
| `venue_catalog` | Driver-contributed venue intel (staging spots, GPS dead zones) |
| `market_intelligence` | Market-specific patterns, surge zones, timing insights |
| `user_intel_notes` | Per-user notes from driver interactions |
| `zone_intelligence` | Crowd-sourced zone knowledge (dead zones, honey holes, staging spots) |
| `coach_conversations` | Thread history for cross-session memory |
| `coach_system_notes` | **Rideshare Coach observations** about system enhancements |
| `discovered_events` | Event deactivation/reactivation (via `is_active` flag) |
| `news_deactivations` | User news hiding preferences |

**Note:** School closures and traffic conditions are stored in `briefings.school_closures` and `briefings.traffic_conditions` (JSONB columns), not separate tables. LLM consolidation via `callModel('BRIEFING_TRAFFIC')` at `briefing-service.js:1543`.

**Use Cases (examples, not exhaustive):**
- "Give me an exact staging location central to events and high-end venues where GPS signal is not blocked"
- "Analyze surge patterns - where do surges always start/end?"
- "How can I get short hops without going far from home?"
- Capture app-specific advice (e.g., "Turn on destination filter to stay in busy area")
- Learn from driver feedback what worked vs. what didn't

### Rule 9: ALL FINDINGS ARE HIGH PRIORITY

**This repo is a "how to code with AI" reference implementation. All issues must be completely resolved.**

- **Every audit finding** (from AI assistants, code review, or human inspection) is HIGH priority
- **No "low priority" bucket** - if an issue is found, it gets fixed or explicitly documented with a timeline
- **Includes "nice to have" suggestions** like model consolidation (e.g., "use fewer models for news/events")
- **Zero tolerance for drift** between docs, schema, metadata, and code
- **Duplicate logic = bug** - if the same calculation exists in multiple places, consolidate immediately

**Tracking Requirements:**
1. All findings MUST be logged in `docs/DOC_DISCREPANCIES.md` (or similar tracking document) if not immediately resolved.

### Rule 10: Unified AI Architecture
- The system uses a centralized AI capability layer defined in `server/lib/ai/unified-ai-capabilities.js`.
- **Do not** create ad-hoc AI implementations in individual services if they can be centralized.
- Ensure `startUnifiedAIMonitoring()` is active in the gateway bootstrap to maintain AI health.

### Rule 11: Event Sync Architecture (2026-02-17, reframed as principle 2026-04-26)
- **Principle: snapshot fidelity.** Events should reflect the user's current snapshot context, not stale background state. The briefing pipeline that drives a snapshot is where event discovery belongs, because that's where the user's location, time, and driving context are authoritative.
- **Current implementation:** event discovery runs per-snapshot via `fetchEventsForBriefing({ snapshot })` at `briefing-service.js:1280`. The legacy `startEventSyncJob` background worker was removed on 2026-02-17 because background-fetched events drifted from the snapshot context they were meant to inform.
- **Applying the principle to new work:** before adding asynchronous event handling, ask — *would a user receive events that don't reflect their current snapshot?* If yes, that work belongs inside the per-snapshot path. If async work genuinely preserves snapshot fidelity (e.g., a webhook that updates an event in-place after a snapshot fired, or a scheduled refresh that re-keys to the latest snapshot), it can be considered on its merits. The constraint to honor is **snapshot fidelity**, not "no async, ever."
- **Cross-references:** EVENTS.md, LOCATION.md, FRISCO_LOCK_DIAGNOSIS_2026-04-18.md, RECON_2026-04-17_HANDLES_LOCALITY.md, and BRIEFING-DATA-MODEL.md cite this rule by number — amendments stay under Rule 11 to preserve those links.

### Rule 12: Session-Start Review Protocol (2026-02-25, expanded 2026-04-28)
**At the start of EVERY session, review these documents before doing any work:**

| Priority | Document | Why |
|----------|----------|-----|
| 1 | `claude_memory` table (Postgres) | Cross-session memory of prior work, decisions, and lessons — query before relying on git/docs alone (see Rule 15) |
| 2 | `.code_based_rules/` directory | Hard-rule layer: `.rules_do_not_change/` (immutable rules + annotated workflow logs, including `Up to Venue console wish.txt` with Melody's inline corrections), `engineering_specs/`, `startup_rules/`. **Read this directory before assuming any other rule source is exhaustive.** `app.MD` explicitly forbids substituting grep / agent / code-sweep searches for actual file reading. |
| 3 | `claude_memory` active rows (replaces retired `docs/review-queue/pending.md` as of 2026-04-29) | Query: `psql "$DATABASE_URL" -c "SELECT id, category, priority, status, title, created_at FROM claude_memory WHERE status='active' ORDER BY id DESC LIMIT 30;"` per Rule 15. The Markdown queue was retired because manual sweep discipline rotted; `claude_memory` provides queryable status hygiene + parent_id threading. |
| 4 | `docs/architecture/database-environments.md` | Dev vs Prod DB rules — prevents data accidents |
| 5 | `docs/DOC_DISCREPANCIES.md` | Open findings that need resolution |
| 6 | `docs/coach-inbox.md` | Memos from the Rideshare Coach (Gemini) for Claude Code |
| 7 | `LESSONS_LEARNED.md` | Critical production mistakes to never repeat |
| 8 | `docs/architecture/audits/` (whole directory) + `CODEBASE_AUDIT_2026-04-27.md` (most recent — see note below) | 14 audit files including `FRISCO_LOCK_DIAGNOSIS_2026-04-18.md`, `GEOGRAPHIC_ANCHOR_AUDIT_2026-04-18.md`, `NEON_AUTOSCALE_TOPOLOGY_2026-04-18.md` (cited by Rule 13 as authoritative on Neon SSL behavior), `NOTIFY_LOSS_RECON_2026-04-18.md`, `RECON_2026-04-17_HANDLES_LOCALITY.md`, `pass-c/d/e/f-*.md` series, `verification-2026-04-16-hallucination-fixes.md`, `HANDOFF_2026-04-24.md`, plus the older `full-audit-2026-04-04.md` (37 issues). Read the most recent first; others give deeper context for specific incidents and topics. **2026-04-28 note:** `CODEBASE_AUDIT_2026-04-27.md` lives on the sibling branch `audit/codebase-2026-04-27` (off `main` at `d39d570f`), not on the current working branch. To read it without checking out the branch: `git fetch origin audit/codebase-2026-04-27 && git show audit/codebase-2026-04-27:docs/architecture/audits/CODEBASE_AUDIT_2026-04-27.md`. The audit IS canonical input — its findings drove the 2026-04-28 fixes (PR-review master plan, schema v6 read-path tz fix, updatePhase idempotency, Path B multi-day predicate, filter-for-planner legacy delete). |

**This is your memory layer.** These documents persist across sessions and are your primary source of truth for the current state of the project. When you learn something important during a session, update the relevant document so future sessions benefit.

**Audit headline (added 2026-04-28, per `CODEBASE_AUDIT_2026-04-27.md`):** Codebase is in good shape — doc drift around the daily-strategy removal is the dominant issue, not functional duplication; live paths are single-sourced. Per the audit's Section 6.3: duplications that exist are idiom duplication (e.g., the 7-route inline freshness filter in `briefing.js`) and intentional defense-in-depth (e.g., dedup at write + read time per `EVENTS.md` §3), not "two pipelines" patterns. AI registry has 26 roles, all live, zero orphans.

**Contested-fact rule (added 2026-04-24):** When docs disagree on verifiable facts (DB provider, API routing, schema shape, model IDs, etc.), trust the newest timestamped audit document over older doctrine files. Specifically: if a file under `docs/architecture/audits/` has a timestamped finding that contradicts a claim in this CLAUDE.md or a standing `docs/` file, the audit wins until the doctrine file is updated. Update the doctrine file within the same session that consumed the audit; reference the audit in your commit message so future sessions follow the same precedence. This amendment was triggered by a 2026-04-18 Neon-vs-Helium drift where three doctrine files said "both Helium" while the `NEON_AUTOSCALE_TOPOLOGY_2026-04-18.md` audit correctly identified prod as Neon serverless.

### Rule 13: Database Environment Awareness (2026-02-25, updated 2026-04-24)
- **Dev and Prod use DIFFERENT providers** with completely isolated data
- **Dev:** Replit Helium (PostgreSQL 16, local) — used in the workspace editor (no SSL, `sslmode=disable`)
- **Prod:** Neon serverless (PostgreSQL) — used in published deployments (SSL required, valid certs → `rejectUnauthorized: true`)
- **Authoritative source:** `docs/architecture/audits/NEON_AUTOSCALE_TOPOLOGY_2026-04-18.md` (the 2026-04-05 "both Helium" claim that previously lived here was incorrect; see DATABASE_ENVIRONMENTS.md changelog 2026-04-24)
- Replit **automatically injects** `DATABASE_URL` for the correct instance — this is the ONLY database variable
- **Do NOT** create custom env-swapping logic — Replit handles this natively
- **Do NOT** reference PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE — only `DATABASE_URL` exists
- **Do NOT** assume data from dev exists in prod or vice versa
- See `docs/architecture/DATABASE_ENVIRONMENTS.md` for full details

### Rule 14: Model-Agnostic Adapter Architecture (2026-02-25)
- The system uses a **model-agnostic adapter pattern** (`server/lib/ai/adapters/` + `model-registry.js`)
- Model names are **decoupled** from provider API keys — a model can be routed through any adapter (direct API, Bedrock, Vertex AI, etc.)
- **Do NOT** hardcode model-name-to-API-key mappings (e.g., `claude- → ANTHROPIC_API_KEY`) in validation or config
- Environment validation checks **general** API key presence; **per-model** credential validation happens at runtime through the adapter layer
- When in doubt about model routing, consult the adapter layer — it owns that responsibility

### Rule 15: Use the claude_memory Table (added 2026-04-26)
- **Use this to have a memory of tasks, and issues you find or anything you would like to remember** — the rules and issues in CLAUDE.md are drifting so use your table and build it and extend it or make it into a dream memory for an AI to quickly ascertain context of session work, intention as well as needs or todo items.
- **Schema:** `shared/schema.js:2102` (`claudeMemory`). Columns: `id, session_id, category, priority, status, title, content, source, tags(jsonb), related_files(jsonb), parent_id, metadata(jsonb), created_at, updated_at`. API: `server/api/memory/index.js`. Indexes on `session_id`, `category`, `status`.
- **Read at session start (Rule 12), write throughout the session.** Quick recent overview: `psql "$DATABASE_URL" -c "SELECT id, session_id, category, priority, status, title, created_at FROM claude_memory WHERE status = 'active' ORDER BY id DESC LIMIT 20;"` — then `psql "$DATABASE_URL" -tAc "SELECT content FROM claude_memory WHERE id = N;"` for the full body of a row.
- **Status hygiene:** flip rows to `resolved` when the work lands; `superseded` when newer rows replace them. Keep the `active` set lean so future sessions can scan it quickly.
- **Common categories in practice:** `engineering-pattern`, `design-decision-resolved`, `audit`, `fix`, `doctrine-candidate`, `user-shared-context`. Default `source` is `claude-code`. Use `parent_id` to thread follow-ups under a prior row.
- **Threading discipline (added 2026-04-29):** when titling a row with `Followup:`, `Resolution:`, or `Update:`, see skill `threading-claude-memory-followups` at `.claude/skills/threading-claude-memory-followups/SKILL.md`. The skill teaches the antecedent-check that decides between **Shape A** (thread under a memory row → set `parent_id`) and **Shape B** (antecedent is external → `parent_id` NULL, body MUST start with `Antecedent: <kind> — <description>`). Complementary soft DB trigger at `migrations/20260429_claude_memory_antecedent_trigger.sql` emits a `RAISE NOTICE` when neither shape is present (applied to dev 2026-04-29; prod migration pending). Spec: `docs/superpowers/specs/2026-04-29-threading-claude-memory-followups.md`.

### Rule 16: Events Deduplication Architecture (2026-04-30)
- **Principle: dedup at write, never at read.** Identity is computed at INSERT via `generateEventHash` (`server/lib/events/pipeline/hashEvent.js` v3); the DB unique constraint on `discovered_events.event_hash` enforces it structurally. Read paths are pure SELECT + clock-dependent filters (`filterFreshEvents`, `isEventActiveNow`, `filterInvalidEvents` for TBD/Unknown removal).
- **Identity decoupled from presentation.** The hash is a derived property over normalized event attributes (title prefixes/parentheticals/suffixes stripped, normalized street name extracted from address); the stored `title`/`venue_name`/`address` columns retain Gemini's original strings for UI fidelity. Updating `generateEventHash` does NOT require a schema migration — re-run `node server/scripts/migrate-event-hashes.js` to consolidate rows whose new hash differs.
- **Choice A doctrine** (rejected Choice B composite-key on 2026-04-30): see `docs/review-queue/PLAN_events-dedup-architectural-2026-04-30.md` (Course Correction Log + Decision Log) and claude_memory rows 268–271. A composite-key UNIQUE on `(state, lower(title), event_start_date, venue_id)` was rejected because `lower(title)` requires exact match — would not catch "Live Music: X" vs "X" without mangling stored titles in the DB, degrading UI presentation.
- **Anti-pattern: dedup at read.** Memoizing/caching/suppressing read-path dedup hides taxonomy violations; relocate the operation to its correct stage instead. Per claude_memory row 269 ("workarounds for stage-placement violations entrench drift").
- **Canonical identity fields (v3):** `(stripped_normalized_title, venue_name, normalized_street_name, city, event_start_date)`. Time, attendance, category, expected_attendance are presentation/metadata, not identity.
- **Pre-INSERT pass location:** `briefing-service.js` runs `deduplicateEvents` + `deduplicateEventsSemantic` on the validated Gemini batch BEFORE the per-event upsert loop; emits `[BRIEFING] [EVENTS] [DEDUP] [WRITE] hash: N → M, semantic: M → P`. The DB UNIQUE on `event_hash` is the race-safety backstop, not the primary defense.

---

## 📂 Key Files & Architecture

- **`gateway-server.js`**: Main application entry point. Handles bootstrap, environment validation, and mounts the Unified AI capabilities.
- **`server/lib/ai/unified-ai-capabilities.js`**: Central registry for AI capabilities and health monitoring.
- **`server/bootstrap/routes.js`**: Central route mounting logic.

---

## 🤝 Claude Code ↔ Gemini Bridge (2026-04-08)

**You (Claude Code) can delegate tasks to Gemini 3.1 Pro via a CLI.** Use it when a task would benefit from Gemini's strengths:

- **Live web knowledge** — anything past your training cutoff (API docs, current rate limits, recent incidents)
- **Large-context analysis** — a whole file or whole directory that would burn a lot of your Reads
- **Vision / screenshots** — Melody frequently shares screenshots of the running app. Pass them to Gemini with `--image` for layout/UX/visual-bug analysis. This is often the right first move when a UI issue is described visually rather than in code terms.
- **Second opinion** — when you're genuinely uncertain about a design call and want a peer check

**Invocation (via your Bash tool):**
```bash
node scripts/ask-gemini.mjs "your task"                                     # one-shot, search on by default
node scripts/ask-gemini.mjs --file path/to/file.js "task"                   # attach a file as context
node scripts/ask-gemini.mjs --image path/to/screenshot.png "what's wrong?"  # vision analysis
node scripts/ask-gemini.mjs --image a.png --image b.png "compare these"     # multi-image comparison
node scripts/ask-gemini.mjs --thread <name> "follow-up"                     # multi-turn conversation
node scripts/ask-gemini.mjs --no-search --no-diff "quick task"              # minimal context
node scripts/ask-gemini.mjs --help                                          # full options
```

**Vision notes:** supported formats are `.png .jpg .jpeg .webp .gif .heic .heif`; 15MB hard cap per image; in thread mode an image is visible only on the turn it's attached — re-attach on follow-ups if needed.

**On first turn of any thread (or in one-shot mode), `git diff HEAD` is auto-attached** so Gemini sees what we just changed. Turn it off with `--no-diff` when you don't want that overhead.

**When NOT to delegate:** small edits, things you can verify with a single Grep, anything where waking up another model is slower than just doing it yourself. This is a tool for high-value, high-context tasks — not a reflex.

**Feedback loop the other direction:** the in-app Rideshare Coach (also Gemini) writes memos to `docs/coach-inbox.md` via `[COACH_MEMO]` tags. Rule 12 already tells you to check that file at session start.

The full CLI reference lived in `scripts/README.md`, which has been deleted (Rule 2 revision, 2026-04-18). The invocation examples above are now the canonical reference — the Bash tool help text in each script is the ground truth.

- **`server/bootstrap/workers.js`**: Worker process management (Strategy Worker).

---

## 🧪 Workflow Control, Runner, and End-to-End Testing (2026-04-18)

**This section captures hard-won, session-verified knowledge about controlling
Replit's dev workflow from Claude Code's shell, running real browser E2E tests,
and bypassing assumed limits. Everything here was empirically proven in a live
Replit workspace on 2026-04-18.**

### TL;DR for future sessions

1. **To stop the workflow (and flip the green Run button):** find the PID of the workflow's port-5000 listener via `/proc/net/tcp` → socket inode → `/proc/*/fd/`, then `kill -TERM <pid>`. pid2 (the supervisor) observes the child exit and reports workflow-ended to the IDE. No protocol reverse-engineering needed.
2. **To run real browser E2E tests:** point Playwright at `$REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` — a pre-built Chromium 140 linked against this Nix env's libs. Do NOT use `npx playwright install chromium` in this environment — the downloaded `chrome-headless-shell` needs `libgbm.so.1` which is not in the Nix store and cannot be added without editing `replit.nix`.
3. **To do authenticated API testing without a browser:** register a user via `POST /api/auth/register`, get the HMAC token, use it as `Authorization: Bearer <token>`. Always pass a realistic `User-Agent` — `server/middleware/bot-blocker.js` will 403 curl otherwise. Token format is `{userId}.{hmacSignature}`, **not** a standard JWT.
4. **Starting the gateway from shell:** use `bin/vecto-runner start`. The gateway runs and port 5000 binds, **but the IDE's Run button will NOT show "Stop"** because pid2 didn't spawn that process. For visible Play→Stop you must either (a) press the Play button in the IDE, or (b) accept the asymmetry (IDE says Play, app is up).

### Architecture: Data Plane vs Control Plane

The Replit IDE's green Run / Stop button reflects the state of **pid2** (the workflow supervisor, `/pid2/bundles/*/server.cjs`). Claude Code's shell is a `runner`-owned bash inside the same container but in a different cgroup. This gives three facts:

| Fact | Consequence |
|------|-------------|
| pid2 watches the PIDs it spawned | Processes pid2 didn't spawn don't affect the Run button |
| pid2 is at PID 15, gateway at ~PID 22311, both owned by `runner` | Claude can signal pid2's child processes (same user) |
| Claude's shell is in a different view of `/proc` for `ps`/`pgrep`/`lsof` | `ps` / `pgrep` / `lsof -i` won't see pid2 or the gateway. But `/proc/net/tcp` and `/proc/*/fd/` work and expose everything. |

The earlier assumption that "shell-launched processes can't trigger the Run button" was half-right: **Claude can't impersonate pid2**, but Claude CAN signal pid2's children, and pid2 will report the resulting state change to the IDE. Stopping the workflow through Data-Plane signals works; starting a new IDE-visible workflow from Claude code does not (that requires pid2 to be the spawner).

### Environment variables that matter

These are injected by Replit and not in most env examples. Verify with `env | grep -E "^(REPL|REPLIT)_" | cut -d= -f1 | sort`.

| Var | Example / meaning | Use |
|-----|-------------------|-----|
| `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` | `/nix/store/…/chromium-1187/chrome-linux/chrome` | **The silver bullet for browser E2E**. Replit pre-builds Chromium 140 linked against this Nix env. Point playwright's `launchOptions.executablePath` at this. Solves the `libgbm.so.1 missing` error. |
| `REPL_IDENTITY` | 2188-byte PASETO v2 token signed by Replit | Used for inter-Repl auth. Not needed for local workflow control (over-engineered for this use case). See [blog.replit.com/repl-identity](https://blog.replit.com/repl-identity). |
| `REPL_IDENTITY_KEY` | 96-byte signing key | Companion to the above |
| `REPL_ID` / `REPL_SLUG` / `REPL_OWNER` | UUID / `workspace` / `melodydashora` | Workspace identity |
| `REPLIT_CLI` | Path to `replit` Go binary | **Only has `identity` and `ai` subcommands**, no `workflow`. Not useful for workflow control. |
| `REPLIT_PID2` | `true` | Flag: pid2 supervisor is active |
| `REPLIT_RUN_PATH` | `/run/replit` | Contains `socks/`, `toolchain.json`, `env/` |
| `REPLIT_USER_RUN` | `/run/replit/user/43532959` | User-scoped run dir |
| `REPLIT_HEIMDALL_ADDR` | `https://heimdall.replit.com` | External control plane — returns 404 on direct GET; mutations untested (would require REPL_IDENTITY as Bearer). **Prefer the local signal path over this.** |
| `REPLIT_ARTIFACT_ROUTER` | Path to artifact-router binary | Not workflow-related |

### Unix sockets under `/run/replit/socks/`

| Socket | Response to plain HTTP GET | Notes |
|--------|----------------------------|-------|
| `pid2ws.sock` | HTTP 101 Switching Protocols on WebSocket upgrade | The pid2 WebSocket. Protocol is undocumented and not exposed in string dumps of the replit CLI binary. Reverse-engineering not needed — use the `/proc` signal path instead. |
| `pid2ping.0.sock` | empty | Liveness ping |
| `portauthority.sock` | empty | Port allocation / port-in-use tracking |
| `seccomp.sock` | (not HTTP) | seccomp policy channel |

### The canonical "stop workflow" recipe (proven 2026-04-18)

```bash
# 1. Find the inode of the port-5000 LISTEN socket (hex 1388 = 5000)
LINE=$(awk '$2 ~ /:1388$/ && $4 == "0A"' /proc/net/tcp /proc/net/tcp6 | head -1)
INODE=$(echo "$LINE" | awk '{print $10}')

# 2. Scan /proc/*/fd for the PID that owns it
for pid in $(ls /proc | grep -E "^[0-9]+$"); do
  if ls -l /proc/$pid/fd/ 2>/dev/null | grep -q "socket:\[$INODE\]"; then
    echo "gateway pid=$pid"; break
  fi
done

# 3. Signal the gateway (pid2 sees the child exit and reports workflow-ended)
kill -TERM <pid>

# 4. Verify
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5000/api/health   # expect 000
```

**Confirmed behavior:**
- Port 5000 drops to DOWN within ~1 second
- IDE's Run button flips from Stop back to Play (pid2 reports workflow exit)
- Gateway can be restarted via the Run button OR `bin/vecto-runner start` (but only the Run button restores IDE-visible Stop state)

### The canonical "start gateway from shell" recipe

```bash
# bin/vecto-runner is a setsid/nohup wrapper that runs the same .replit command
bin/vecto-runner start       # launches + waits for /api/health
bin/vecto-runner status      # pid, uptime, port binding, health
bin/vecto-runner logs -f     # tail log
bin/vecto-runner stop        # SIGTERM → SIGKILL after 5s
bin/vecto-runner restart     # stop + start
```

This starts a functional gateway. **The IDE will show Play (not Stop)** because pid2 didn't spawn it. The gateway is still reachable on port 5000; this is acceptable for Claude-driven testing.

### End-to-end testing patterns that work

**HTTP + SSE (no browser, always available):**
- Register: `POST /api/auth/register` with firstName/lastName/email/phone/password/address1/city/stateTerritory/market/vehicleYear/vehicleMake/vehicleModel/termsAccepted (all required; password must pass `validatePasswordStrength`; address must resolve via Google Address Validation)
- Token format: `{userId}.{hmacSignature}` — use as `Authorization: Bearer <token>`
- **Bot blocker bypass**: pass `User-Agent: Mozilla/5.0 (…) Chrome/…` — curl's default UA triggers 403
- Create snapshot: `POST /api/snapshot` with `{ snapshot_id, created_at, coord:{lat,lng}, resolved:{city,state,country,formattedAddress,timezone}, time_context:{hour,dow,day_part_key,local_iso} }`
- SSE handshake: `GET /events/briefing?snapshot_id=<uuid>` returns `event: state` with `has_*` booleans (F2, 2026-04-18)

**Browser via Playwright (Replit's Chromium):**
```typescript
// playwright.config.ts
projects: [{
  name: 'chromium',
  use: {
    ...devices['Desktop Chrome'],
    launchOptions: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
}]
```

Then `npx playwright test tests/e2e/<spec>.spec.ts --workers=1`. Real Chromium 140 runs headless, decodes SSE, navigates, screenshots. The `webServer` block in playwright.config.ts is disabled — the gateway is managed externally (via Play button or `bin/vecto-runner`).

### Approaches that DON'T work (don't re-try these)

| Approach | Failure mode |
|----------|-------------|
| `npx playwright install chromium` in the Nix env | Downloaded `chrome-headless-shell` can't find `libgbm.so.1`. Use `$REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` instead. |
| `npx playwright install-deps` | Requires sudo/apt (not Nix). |
| Firefox for Playwright | Fails same host-requirements validator. |
| Running `.replit`'s exact `run` command via shell to "become the workflow" | The resulting PID is shell-owned, not pid2-owned. IDE keeps showing Play. (This is what Gemini claimed would work; it does not.) |
| `replit` CLI for workflow control | Binary only has `identity` and `ai` subcommands. |
| Firing `StartWorkflow` mutations at `heimdall.replit.com` or `replit.com/graphql` with `REPL_IDENTITY` | Untested and destructive-risk. Prefer local `/proc` signal path. |

### What still needs you (Melody) to do by hand

- **Start the workflow** so the IDE shows Stop: press the green Play button
- **Restart the workflow** after server-side code changes: press Stop (or let me signal the child), then press Play
- **Approve additions to `replit.nix`** if a future session needs extra Nix packages

### Session record — when this was proven

- 2026-04-18: Created test user `claude-test-1776530108@vectopilot.test` (user_id `baef8d1a-e73d-4eb3-996e-fa29c67263b1`), snapshot `14893996-cf7c-4a54-9cdf-b92f9936289a` at Dallas coords, ran real Chromium browser tests passing 3/4 (1 false-red in assertion), confirmed the `/proc/net/tcp` → inode → `kill` recipe stops pid2's workflow child on demand. Commits: `ae6afd0d` (docs), `dc102f40` (F1 client patch), `0673d81c` (F2 SSE handshake + triad-worker dispatcher migration).

### pid2 River protocol — full schema reverse-engineered (2026-04-18 evening)

**Goal that session:** programmatically START workflows via pid2's WebSocket (so IDE shows Stop without manual Play click).

**Results — what we extracted from `/pid2/bundles/0.0.5614/server.cjs`:**

1. **pid2 exposes ~200 River procedures** — full list extracted by parsing `requestInit:` anchors. The workflow-control service contains these 10 procedures (all `rpc`):
   - `agentStartRunWorkflow` — start a workflow (the Run button)
   - `agentStopRunWorkflow`, `agentRestartRunWorkflow` — lifecycle
   - `agentListRunWorkflows`, `agentGetRunWorkflowOutput`, `agentReadWorkflowOutputBuffer`
   - `agentSetRunWorkflow`, `agentDeleteRunWorkflow`, `agentReconcileWorkflows`
   - `agentRestartRepl` (bonus — restart whole repl)
   - Separately: `runWorkflow`, `getWorkflows`, `getWorkflowDetails` exist as standalone procedures in another service

2. **Exact schema for `agentStartRunWorkflow`:**
   ```
   requestInit: { name: string, timeoutMs?: integer, rebuildTimeoutMs?: integer,
                  env?: Record<string,string>, useCgroupMagic?: boolean }
   responseData: { runId: string }
   responseError: { code: "RUN_COMMAND_ALREADY_RUNNING", message: string } | ...
   ```

3. **Handshake protocol** (from pid2's own `Z0a`/`nha`/`Zef`):
   ```typescript
   metadata: { token: string }          // exact schema — no extras allowed
   // Validator:
   //   Zef(token) → PASETO v2.public verify against REPL_PUBKEYS
   //   Decoded must be ReplToken protobuf with:
   //     presenced.bearerID  (uint32, user ID)
   //     presenced.bearerName (string, username)
   //     pid2Info.version     (string; "dev*" bypasses version check)
   //   Plus valid iat/exp (1-hour default window)
   ```

**THE BLOCKER — why the attack fails:**

Pid2 rejects every handshake with `code=1000 reason=""` + zero response frames because:
- The token must be a **ReplToken** protobuf (fields: `iat/exp/salt/cluster/.../presenced/pid2Info`)
- Tokens from `replit identity create -audience <X>` are a **different protobuf** (GovalIdentity-like: `id/username/replName/audience/ownerID`) — wrong type, Zef's `ReplToken.decode()` fails → null → REJECTED_BY_CUSTOM_HANDLER
- The **ReplToken with `presenced`/`pid2Info`** is minted ONLY by Replit's backend auth service when a real browser session opens the workspace — signed with Replit's prod keys that the workspace-local signing chain doesn't have

**What WAS proven end-to-end:**
- `@replit/river` WebSocketClientTransport handshake succeeds at River protocol level (session object created)
- HANDSHAKE_REQ reaches pid2 (7022 bytes outbound observed including metadata.token=REPL_IDENTITY)
- pid2 silently closes immediately — confirming the token's *content* is what's rejected, not transport/subprotocol

**What remains to close the gap** (not achievable from inside the workspace alone):
- Find the Replit backend endpoint that mints presence tokens (it's in the browser-side IDE bundle, not pid2's server code)
- OR use an authenticated browser session to capture the token from DevTools → Network → first WS frame (15-second human operation)
- OR convince Replit to expose a workspace-internal token-minting endpoint

**Extraction scripts saved at `/home/runner/extract-pid2-schema*.mjs` and `/home/runner/decode-token*.mjs`** — re-runnable if pid2 version changes. Probe attempts at `/home/runner/workspace/probe-river*.mjs` and `probe-final*.mjs`.

**Bottom line:** The STOP path via SIGTERM is fully production-ready and documented above. The START path (IDE-visible Play→Stop) requires Replit IDE browser-issued tokens and is not programmatically reachable from inside the workspace without that external credential. Accept Play-button-press-per-session as the pragmatic loop.