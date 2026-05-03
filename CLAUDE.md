# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

---

## 🚨 DEVELOPMENT PROCESS RULES (MANDATORY)

**These rules govern ALL development work. No exceptions.**

### Rule 1: Planning Before Implementation
- **BEFORE making any code changes**, create a plan document in the same directory as the relevant doc under `docs/`
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

**Note:** School closures and traffic conditions are stored in `briefings.school_closures` and `briefings.traffic_conditions` (JSONB columns), not separate tables. LLM consolidation via `callModel('BRIEFING_TRAFFIC')` at `pipelines/traffic.js`.

### Rule 9: ALL FINDINGS ARE HIGH PRIORITY

**This repo is a "how to code with AI" reference implementation. All issues must be completely resolved.**

- **Every audit finding** (from AI assistants, code review, or human inspection) is HIGH priority
- **No "low priority" bucket** — if an issue is found, it gets fixed or explicitly documented with a timeline
- **Includes "nice to have" suggestions** like model consolidation
- **Zero tolerance for drift** between docs, schema, metadata, and code
- **Duplicate logic = bug** — if the same calculation exists in multiple places, consolidate immediately

**Tracking Requirements:**
1. All findings MUST be logged in `docs/DOC_DISCREPANCIES.md` with:
   - Unique ID (D-XXX)
   - Exact file:line location
   - What code says vs. what it should say
   - Status (PENDING/IN_PROGRESS/FIXED)
2. Findings older than 24 hours without action = escalation
3. Before closing any session, verify all findings are tracked

**Why this matters:** stale docs/metadata cause AI assistants to hallucinate. "Low priority" issues compound into "tables with no data" confusion. Every discrepancy is a potential bug in AI-generated code.

### Rule 10: Unified AI Architecture
- The system uses a centralized AI capability layer defined in `server/lib/ai/unified-ai-capabilities.js`.
- **Do not** create ad-hoc AI implementations in individual services if they can be centralized.
- Ensure `startUnifiedAIMonitoring()` is active in the gateway bootstrap to maintain AI health.

### Rule 11: Event Sync Architecture (2026-02-17, reframed as principle 2026-04-26)
- **Principle: snapshot fidelity.** Events should reflect the user's current snapshot context, not stale background state. The briefing pipeline that drives a snapshot is where event discovery belongs, because that's where the user's location, time, and driving context are authoritative.
- **Current implementation:** event discovery runs per-snapshot via `fetchEventsForBriefing({ snapshot })` at `pipelines/events.js`. The legacy `startEventSyncJob` background worker was removed on 2026-02-17 because background-fetched events drifted from the snapshot context they were meant to inform.
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
- **Use this to remember tasks, issues you find, or anything worth remembering** — the rules and issues in CLAUDE.md drift, so use the table to build a session-portable memory.
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
- **Pre-INSERT pass location:** `pipelines/events.js` runs `deduplicateEvents` + `deduplicateEventsSemantic` on the validated Gemini batch BEFORE the per-event upsert loop; emits `[BRIEFING] [EVENTS] [DEDUP] [WRITE] hash: N → M, semantic: M → P`. The DB UNIQUE on `event_hash` is the race-safety backstop, not the primary defense.

### Rule 16: MELODY IS THE ARCHITECT

**Claude does NOT make architecture decisions. Melody (the human) is the architect.**

- **Do NOT propose architecture changes** — wait for Melody to define the design
- **Do NOT infer how systems should connect** — ask Melody first
- **Do NOT add fields, tables, or flows** without explicit direction from Melody
- **When confused about design**, STOP and ask — don't guess
- **Your role**: Help Melody code what she decides, not decide for her

**What Claude CAN do:** Point out potential issues or conflicts with existing code; ask clarifying questions; suggest implementation details AFTER architecture is defined; execute the implementation as directed.

**What Claude CANNOT do:** Decide how data flows between tables; decide which fields belong where; decide how UI should display data; make any "this makes sense so I'll do it" changes.

**If you catch yourself thinking "I think this should..."** — STOP and ask Melody instead.

### Rule 17: Pipeline Data Dependencies (2026-01-14)

**The AI pipeline has strict data dependencies. Skipping steps = garbage recommendations or cryptic errors.**

```
SNAPSHOT (lat/lng, time_context, resolved location)
  ↓ [BRIEFING requires SNAPSHOT]
BRIEFING (weather, traffic, events, news, airport)
  ↓ [STRATEGY requires SNAPSHOT + BRIEFING]
STRATEGY_FOR_NOW (consolidator output)
  ↓ [VENUES requires STRATEGY_FOR_NOW + SNAPSHOT]
VENUE RECOMMENDATIONS (tactical planner)
```

| Step | Requires | Error if Missing |
|------|----------|------------------|
| Briefing | `snapshot_id` with valid GPS | "Missing location data" |
| Strategy | `briefing_row` + `snapshot_row` | "Cannot generate strategy without briefing" |
| Venues | `strategy_for_now` + `snapshot.lat/lng` | "Cannot recommend venues without strategy" |

---

## Project Overview

Vecto Pilot is an AI-powered rideshare intelligence platform. It uses a multi-model AI pipeline (Claude Opus 4.5, Gemini 3.0 Pro, GPT-5.2) to generate venue recommendations and tactical guidance for drivers.

## Quick Start

```bash
npm run dev              # Development server (port 5000)
npm run typecheck        # TypeScript checking
npm run lint             # ESLint
npm run test             # All tests
npm run lint && npm run typecheck && npm run build  # Pre-PR
```

---

## Critical Code Rules

### NO FALLBACKS — GLOBAL APP RULE

**Never add location fallbacks or hardcoded defaults.** Required data missing → throw or return error. Optional data missing → omit the feature, don't fake it. Never hardcode: cities, states, countries, airports, coordinates, timezones.

```javascript
// WRONG — masks bugs, breaks global app
const city = snapshot?.city || 'Frisco';
const timezone = snapshot?.timezone || 'America/Chicago';

// CORRECT — fail explicitly
if (!snapshot?.city) throw new Error('Missing required location data');
const city = snapshot.city;
```

### NO SILENT FAILURES

**Never use graceful error handling that masks problems.** Throw with descriptive messages. Use `console.error`, never `console.debug` (often invisible in production logs). Re-throw so callers know something failed. If you're catching just to return null — you're masking a bug.

```javascript
// WRONG
if (res.status === 503) { console.debug('Service unavailable'); return null; }

// CORRECT
if (res.status === 503) throw new Error('Agent is disabled on server (AGENT_ENABLED !== true)');
```

### FAIL HARD — CRITICAL DATA RULE (2026-01-15)

**When critical data is missing, block the UI entirely.** Server returns 4xx/5xx (not 200 with empty data). Client validates critical fields exist. UI shows `CriticalError` modal blocking the dashboard.

| Critical Data | Why | Action |
|---|---|---|
| Snapshot ID | All queries depend on it | Block UI |
| City/Timezone | Strategy + events filtering | Block UI |
| GPS Coords | Maps + venue distances | Block UI |
| Auth Token | All API calls | Redirect to login |
| Ranking ID | Feedback linkage | Block UI |

See `client/src/components/CriticalError.tsx` and `LESSONS_LEARNED.md` > "FAIL HARD Pattern".

### ROOT CAUSE FIRST

**Never catch errors that should be architecturally impossible.** If your SQL is correct, the catch is unnecessary. If the catch fires, your SQL is wrong — fix the SQL, not the catch.

```javascript
// WRONG — defensive catch that masks SQL bugs
ON CONFLICT (event_hash) DO UPDATE SET ...
} catch (err) {
  if (err.code === '23505') skipped++;  // SILENT! With ON CONFLICT, 23505 is impossible
}

// CORRECT — surface unexpected errors
} catch (err) {
  if (err.code === '23505') throw new Error(`Unexpected duplicate despite ON CONFLICT: ${err.constraint}`);
}
```

| Anti-Pattern | Root Cause to Fix |
|---|---|
| Catch 23505 with ON CONFLICT | Wrong column in ON CONFLICT clause |
| Return `null` on 404 | Missing data upstream — fix the source |
| Silent retry on timeout | Connection pool exhausted — increase pool |
| Default value on missing data | Bug in data flow — trace the pipeline |

### ABSOLUTE PRECISION — GPS & DATA ACCURACY

- GPS coordinates: **6 decimals** (`makeCoordsKey(lat, lng)`) — ~11cm accuracy, prevents cache collisions
- Cache keys: exact match, no fuzzy/proximity matching
- Venue identification: Google `place_id`, not name similarity
- Event deduplication: hash of normalized fields (exact, not similarity)
- Coordinates always from Google APIs or DB, never from AI (AI hallucinates coordinates)

### Model Parameters

**GPT-5.2:**
```javascript
// CORRECT
{ model: "gpt-5.2", reasoning_effort: "medium", max_completion_tokens: 32000 }
// WRONG (causes 400)
{ reasoning: { effort: "medium" } }   // Nested format
{ temperature: 0.7 }                   // Not supported
```

**Gemini 3 Pro** (only LOW or HIGH — MEDIUM is Flash-only):
```javascript
{ generationConfig: { thinkingConfig: { thinkingLevel: "HIGH" } } }
// WRONG: { thinkingLevel: "MEDIUM" } or { thinking_budget: 8000 } (deprecated)
```

### Model Adapter Pattern

Always use the adapter — never call AI APIs directly:
```javascript
import { callModel } from './lib/ai/adapters/index.js';
const result = await callModel('strategist', { system, user });
```

### Code Conventions

- Unused variables: prefix with `_`
- TypeScript strict mode in client
- Database: link all data to `snapshot_id`
- Sorting: `created_at DESC` (newest first)

### Location Rules

- **GPS-first**: no IP fallback, no default locations, no hardcoded coordinates
- All location data (city, state, timezone, airports) comes from user's actual GPS position
- `location-context-clean.tsx` is the single weather source
- Coordinates from Google APIs or DB, never from AI

### Event Field Naming Convention (2026-01-10)

| Old Name | New Name | Notes |
|----------|----------|-------|
| `event_date` | `event_start_date` | YYYY-MM-DD format |
| `event_time` | `event_start_time` | HH:MM format (24h) or "7:00 PM" |
| N/A | `event_end_date` | Multi-day events (defaults to start date) |
| N/A | `event_end_time` | Required — no TBD/Unknown allowed |

All input formats are normalized via `normalizeEvent.js`. Why this matters: consistent field names prevent property access bugs (`event_date` vs `event_start_date` returning undefined).

### Venue Open/Closed Status

**Server** (`venue-enrichment.js`): `isOpen` calculated using **venue's timezone** via `Intl.DateTimeFormat`, stored in `ranking_candidates.features.isOpen`.
**Client** (`BarsTable.tsx`): trusts server's `isOpen` value. **No client-side recalculation** — browser timezone ≠ venue timezone, and client recalculation previously caused late-night venues to show "Closed" incorrectly.

### Catalog Provenance Doctrine (2026-05-03)

`venue_catalog.source_model` was dropped in Workstream 6 Step 2, mirroring the 2026-01-10 removal of the same column from `discovered_events`. **Doctrine:** AI model identity is pipeline-implicit (Gemini for events, model-agnostic adapter at runtime for venue creation), so per-row `source_model` is dead telemetry.

Catalog-entry provenance still lives on `venue_catalog`:
- `source` — external supplier (`google_places_new`, `briefing_discovery`, `smart_blocks_promotion`, `google_places`)
- `discovery_source` — internal flow that added the row (`address_resolver`, `briefing_discovery`, `smart_blocks_promotion`, `bar_discovery`, `seed`)

These are write-only operational telemetry — useful for ad-hoc audit queries, not consumed by runtime code. **Do NOT** add a new `source_model`-style column on `venue_catalog` or `discovered_events`. If model-attribution telemetry becomes genuinely needed, route it through structured logging (matrixLog), not the data tables.

Plan: `docs/review-queue/PLAN_workstream6_step2_catalog-cleanup-2026-05-03.md`.

---

## Environment Variables

### Required
```bash
DATABASE_URL=...           # PostgreSQL (auto-injected by Replit; see Rule 13)
OPENAI_API_KEY=...         # GPT-5.2
GEMINI_API_KEY=...         # Gemini 3.0 Pro
ANTHROPIC_API_KEY=...      # Claude Opus 4.5
GOOGLE_MAPS_API_KEY=...    # Places, Routes, Weather
```

### Model Configuration
```bash
STRATEGY_STRATEGIST=claude-opus-4-5-20251101
STRATEGY_BRIEFER=gemini-3-pro-preview
STRATEGY_CONSOLIDATOR=gpt-5.2
STRATEGY_EVENT_VALIDATOR=claude-opus-4-5-20251101
```

---

## Key Files

| File | Purpose |
|------|---------|
| `gateway-server.js` | Main Express server entry; bootstrap, env validation, mounts Unified AI capabilities |
| `server/lib/ai/unified-ai-capabilities.js` | Central registry for AI capabilities + health monitoring |
| `server/bootstrap/routes.js` | Central route mounting logic |
| `server/bootstrap/workers.js` | Worker process management (Strategy Worker) |
| `shared/schema.js` | Drizzle ORM schema |
| `server/lib/ai/adapters/index.js` | Model adapter dispatcher |
| `client/src/routes.tsx` | React Router configuration |
| `client/src/layouts/CoPilotLayout.tsx` | Shared layout with GlobalHeader |
| `client/src/contexts/co-pilot-context.tsx` | Shared state for co-pilot pages |
| `client/src/contexts/location-context-clean.tsx` | Location provider |
| `client/src/components/CriticalError.tsx` | Blocking error modal (FAIL HARD) |

For full folder structure see `ARCHITECTURE.md`.

---

## AI Pipeline Summary

```
POST /api/blocks-fast → TRIAD Pipeline (~35-50s)
├── Phase 1 (Parallel): Strategist + Briefer + Holiday
├── Phase 2 (Parallel): Daily + Immediate Consolidator
├── Phase 3: Venue Planner + Enrichment
└── Phase 4: Event Validator
```

See `docs/architecture/ai-pipeline.md` for details.

---

## Key Import Patterns

```javascript
// AI adapters (always use this — never call APIs directly)
import { callModel } from '../../lib/ai/adapters/index.js';

// Database
import { db } from '../../db/drizzle.js';
import { snapshots, strategies } from '../../../shared/schema.js';

// Logging — workflow-aware
import { triadLog, venuesLog, briefingLog, eventsLog, OP } from '../../logger/workflow.js';

// Events ETL Pipeline (canonical field names: event_start_date/event_start_time)
import { normalizeEvent, normalizeEvents } from '../../lib/events/pipeline/normalizeEvent.js';
import { validateEventsHard, needsReadTimeValidation } from '../../lib/events/pipeline/validateEvent.js';
import { generateEventHash, eventsHaveSameHash } from '../../lib/events/pipeline/hashEvent.js';

// Coordinate Key (6-decimal precision for cache keys)
import { makeCoordsKey, coordsKey, parseCoordKey } from '../../lib/location/coords-key.js';

// Snapshot context
import { getSnapshotContext } from '../../lib/location/get-snapshot-context.js';

// Strategy providers
import { providers } from '../../lib/strategy/providers.js';
```

---

## Logging Conventions

### Workflow Logger for Pipeline Operations

```javascript
import { triadLog, venuesLog, eventsLog, OP } from '../../logger/workflow.js';

triadLog.phase(1, `Starting for ${snapshotId.slice(0, 8)}`);   // [TRIAD 1/4 — Strategist]
venuesLog.phase(2, `Routes API: calculating distances`);        // [VENUES 2/4]
eventsLog.phase(4, `Upserting ${events.length} events`, OP.DB); // [EVENTS 4/5]
```

### Use Role Names, Not Model Names

Role-based: `Strategist`, `Briefer`, `Consolidator`. Don't reference `Claude`, `Gemini`, `GPT-5.2` in logs — models swap, roles don't.

### Venue-Specific Logs

Always include the venue name so you can trace one venue through the pipeline:
```javascript
console.log(`🏢 [VENUE "The Mitchell"] Route: 5.2mi, 12min`);  // GOOD
console.log(`[Venue Enrichment] ✅ Distance: 5.2 mi`);          // BAD
```

### Workflow Phases Reference

| Component | Phases | Labels |
|-----------|--------|--------|
| TRIAD | 4 | Strategist, Briefer, Daily+NOW Strategy, SmartBlocks |
| VENUES | 4 | Tactical Planner, Routes API, Places API, DB Store |
| BRIEFING | 3 | Traffic, Events Discovery, Event Validation |
| EVENTS | 5 | Extract\|Providers, Transform\|Normalize, Transform\|Geocode, Load\|Store, Assemble\|Briefing |

---

## Claude Code ↔ Gemini Bridge (2026-04-08)

You can delegate tasks to Gemini 3.1 Pro via `scripts/ask-gemini.mjs`. Use it for:

- **Live web knowledge** — anything past your training cutoff (API docs, current rate limits, recent incidents)
- **Large-context analysis** — a whole file or whole directory that would burn many Reads
- **Vision / screenshots** — Melody often shares UI screenshots; pass them with `--image` for layout/UX/visual-bug analysis
- **Second opinion** — when you're genuinely uncertain about a design call

```bash
node scripts/ask-gemini.mjs "your task"                                     # one-shot, search on by default
node scripts/ask-gemini.mjs --file path/to/file.js "task"                   # attach a file as context
node scripts/ask-gemini.mjs --image path/to/screenshot.png "what's wrong?"  # vision analysis
node scripts/ask-gemini.mjs --image a.png --image b.png "compare these"     # multi-image comparison
node scripts/ask-gemini.mjs --thread <name> "follow-up"                     # multi-turn conversation
node scripts/ask-gemini.mjs --no-search --no-diff "quick task"              # minimal context
node scripts/ask-gemini.mjs --help                                          # full options
```

Vision: `.png .jpg .jpeg .webp .gif .heic .heif`, 15MB cap per image. In thread mode, an image is visible only on the turn it's attached — re-attach on follow-ups if needed.

First turn auto-attaches `git diff HEAD` so Gemini sees what just changed; disable with `--no-diff`.

**Don't delegate small edits** — wake-up cost beats the value. Use it for high-context, high-value tasks only.

**Reverse direction:** the in-app Rideshare Coach (also Gemini) writes memos to `docs/coach-inbox.md` via `[COACH_MEMO]` tags. Rule 12 already requires checking this at session start.

---

## Workflow Control & E2E Testing (Replit-specific)

For controlling Replit's dev workflow from Claude's shell, running real browser E2E tests, and bypassing assumed limits, see `docs/architecture/audits/REPLIT_WORKFLOW_CONTROL.md`.

**Key facts:**
- **Stop the workflow** via `/proc/net/tcp` → inode → `kill -TERM <pid>` (pid2 reports workflow-ended to the IDE)
- **Run real Playwright tests** by pointing `launchOptions.executablePath` at `$REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` (do NOT use `npx playwright install chromium` — `libgbm.so.1` missing in Nix env)
- **Authenticated API testing**: `POST /api/auth/register` for HMAC token; pass realistic `User-Agent` (bot-blocker 403's curl default)
- **`bin/vecto-runner start`** runs the gateway from shell, but the IDE Run button shows Play (not Stop) — pid2's token gating is browser-side only and is not programmatically reachable from inside the workspace

---

## Holiday Override

```bash
node server/scripts/holiday-override.js list    # List overrides
node server/scripts/holiday-override.js test    # Test detection
```
Config: `server/config/holiday-override.json`

---

## Related Files

- `ARCHITECTURE.md` — System overview + folder index
- `LESSONS_LEARNED.md` — Historical issues (read before changes)
- `docs/review-queue/pending.md` — Unfinished doc updates
- `docs/DOC_DISCREPANCIES.md` — Open findings tracking
- `docs/coach-inbox.md` — Memos from the Rideshare Coach
- `docs/architecture/audits/REPLIT_WORKFLOW_CONTROL.md` — Replit/pid2 workflow & E2E reference (hoisted from CLAUDE.md 2026-04-28)
