# Coach Pipeline Forensic Audit — 2026-05-26

> **Scope:** Full forensic recon of the Rideshare Coach memo/notes/intel pipeline.
> **Method:** Disk-only reads (grep, psql workspace DB, file reads). No prod DB access. No writes to any pipeline.
> **Prior audit:** `docs/architecture/COACH_PIPELINE_AUDIT.md` (2026-05-05) exists but is pre-`coach_memos` DB migration.

---

## 1. WRITE PATH

The Coach emits **14 action tag types** from Gemini's response text, parsed in `server/api/chat/chat.js:88-145`. Each tag routes through the active DAL (`rideshare-coach-dal.js`) to a specific DB table. A secondary filesystem write to `docs/coach-inbox.md` is best-effort.

| # | Action Tag | Target Table | DAL Method | File:Line | Description |
|---|------------|-------------|------------|-----------|-------------|
| 1 | `SAVE_NOTE` | `user_intel_notes` | `saveUserNote` | `chat.js:254` | Driver preferences, insights, tips |
| 2 | `SYSTEM_NOTE` | `coach_system_notes` | `saveSystemNote` | `chat.js:387` | Coach observations, bug reports, feature requests |
| 3 | `COACH_MEMO` | `coach_memos` + `docs/coach-inbox.md` | `saveCoachMemo` + `fs.appendFile` | `chat.js:514` + `chat.js:531` | Bridge memos for Claude Code |
| 4 | `ZONE_INTEL` | `zone_intelligence` | `saveZoneIntelligence` | `chat.js:560` | Dead zones, honey holes, staging spots |
| 5 | `MARKET_INTEL` | `market_intelligence` | `saveMarketIntelligence` | `chat.js:604` | Market-wide patterns |
| 6 | `SAVE_VENUE_INTEL` | `venue_catalog` | `saveVenueCatalogEntry` | `chat.js:622+` | Venue intel, GPS dead zones |
| 7 | `LOG_OFFER_DECISION` | `coach_offer_decisions` | `saveCoachOfferDecision` | `chat.js:655` | Screenshot OCR + AI recommendation |
| 8 | `UPDATE_OFFER_DECISION` | `coach_offer_decisions` | `updateCoachOfferDecision` | `chat.js:681` | User verdict + reasoning update |
| 9 | `BACKFILL_OFFER_INTEL` | `offer_intelligence` | `updateOfferIntelligence` | `chat.js:705` | Ground-truth backfills from screenshots |
| 10 | `DEACTIVATE_EVENT` | `discovered_events` | `deactivateEvent` | `chat.js:276+` | Mark event inactive |
| 11 | `REACTIVATE_EVENT` | `discovered_events` | `reactivateEvent` | `chat.js:320+` | Mark event active again |
| 12 | `ADD_EVENT` | `discovered_events` | `addEvent` | `chat.js:409+` | Driver-reported events |
| 13 | `UPDATE_EVENT` | `discovered_events` | `updateEvent` | `chat.js:440+` | Correct event details |
| 14 | `DEACTIVATE_NEWS` | `news_deactivations` | `deactivateNews` | `chat.js:460+` | User hides news |

**Implicit write:** Every user/assistant message pair is saved to `coach_conversations` by the chat handler itself (not via action tags).

### Write path files

| File | Lines | Role |
|------|------:|------|
| `server/api/chat/chat.js` | 1790 | Action tag parser + dispatcher + HTTP endpoints |
| `server/api/chat/realtime.js` | ~300 | WebSocket variant (imports same DAL) |
| `server/lib/ai/rideshare-coach-dal.js` | 2786 | **ACTIVE DAL** — all write methods. Imported by `chat.js`, `realtime.js` |
| `server/lib/ai/coach-dal.js` | 2270 | **DEAD CODE** — zero importers (see §5) |
| `server/api/rideshare-coach/validate.js` | ~450 | Zod schemas for all action tags |
| `scripts/pull-coach-memos.mjs` | 131 | Reads `coach_memos` from DB, writes to `docs/coach-inbox.md` |

---

## 2. STORAGE

### Coach pipeline tables (workspace DB)

| Table | Rows | Date Range | Write Path | Read Path | Status |
|-------|-----:|-----------|------------|-----------|--------|
| `coach_memos` | 1 | 2026-05-16 | `COACH_MEMO` → `saveCoachMemo` | `pull-coach-memos.mjs` | **ACTIVE** — nearly empty in dev; prod data behind `PROD_DATABASE_URL` |
| `coach_system_notes` | 7 | 2026-04-16 → 2026-05-09 | `SYSTEM_NOTE` → `saveSystemNote` | `GET /api/chat/system-notes` | **ACTIVE** — real data, no pull mechanism |
| `coach_conversations` | 380 | 2026-01-14 → 2026-05-16 | Chat handler implicit | `GET /api/chat/conversations`, `GET /api/chat/history` | **ACTIVE** — real conversation data |
| `coach_offer_decisions` | 0 | — | `LOG_OFFER_DECISION` → `saveCoachOfferDecision` | `getCoachOfferDecisions` (DAL) | **ACTIVE** — no dev data; may have prod data |
| `user_intel_notes` | 59 | 2026-01-14 → 2026-05-09 | `SAVE_NOTE` → `saveUserNote` | `GET /api/chat/notes`, `GET /api/coach/notes` | **ACTIVE** — 47/59 rows are garbled (see §6) |
| `market_intelligence` | 33 | 2025-12-30 → 2026-02-02 | `MARKET_INTEL` → `saveMarketIntelligence` | Coach context loading | **STALE** — seed data only, no activity since Feb 2026 |
| `zone_intelligence` | 1 | 2026-01-02 | `ZONE_INTEL` → `saveZoneIntelligence` | Coach context loading | **STALE** — 1 row in 5 months |
| `offer_intelligence` | 448 | 2026-02-28 → 2026-03-30 | Siri Shortcut / analyze-offer hook | Coach context, `BACKFILL_OFFER_INTEL` | **ACTIVE** — real driving data |

### Adjacent memory tables (not Coach pipeline, but overlapping surface area)

| Table | Rows | Write Path | Read Path | Status |
|-------|-----:|-----------|-----------|--------|
| `claude_memory` | 331 | Claude Code sessions via `server/api/memory/index.js` + `tactical-planner.js` | Claude Code session start (psql) | **ACTIVE** — separate pipeline |
| `agent_memory` | 0 | `server/agent/thread-context.js:143` (raw SQL INSERT) | `server/agent/thread-context.js:404` (raw SQL SELECT) | **ACTIVE** — 0 rows but writer/reader exist in agent system |
| `eidolon_memory` | 1 | Eidolon enhanced-context | Eidolon enhanced-context | **STALE** — 1 diagnostic row |
| `cross_thread_memory` | 1 | Agent/Eidolon enhanced-context | Agent/Eidolon enhanced-context | **STALE** — 1 diagnostic row |
| `app_feedback` | 0 | No known writer in current code | No known reader | **ORPHANED** |

### Column schemas

<details><summary>coach_memos (14 cols)</summary>

`id(uuid PK), type(text), title(text), detail(text), priority(text), related_files(jsonb), status(text), source(text), exported_at(timestamptz), triggering_user_id(uuid FK), triggering_conversation_id(uuid), triggering_snapshot_id(uuid FK), created_at(timestamptz), updated_at(timestamptz)`
</details>

<details><summary>coach_system_notes (20 cols)</summary>

`id(uuid PK), note_type(text), category(text), priority(int), title(text), description(text), user_quote(text), triggering_user_id(uuid FK), triggering_conversation_id(uuid), triggering_snapshot_id(uuid FK), occurrence_count(int), affected_users(jsonb), market_slug(text), is_market_specific(bool), status(text), reviewed_at(timestamptz), reviewed_by(text), implementation_notes(text), created_at(timestamptz), updated_at(timestamptz)`
</details>

<details><summary>user_intel_notes (21 cols)</summary>

`id(uuid PK), user_id(uuid FK), snapshot_id(uuid FK), note_type(text), category(text), title(text), content(text), context(text), market_slug(text), neighborhoods(jsonb), importance(int), confidence(int), times_referenced(int), valid_from(timestamptz), valid_until(timestamptz), is_active(bool), is_pinned(bool), source_message_id(text), created_by(text), created_at(timestamptz), updated_at(timestamptz)`
</details>

<details><summary>coach_conversations (21 cols)</summary>

`id(uuid PK), user_id(uuid FK), snapshot_id(uuid FK), conversation_id(uuid), parent_message_id(uuid), role(text), content(text), content_type(text), topic_tags(jsonb), extracted_tips(jsonb), sentiment(text), location_context(jsonb), time_context(jsonb), tokens_in(int), tokens_out(int), model_used(text), is_edited(bool), is_regenerated(bool), is_starred(bool), created_at(timestamptz), updated_at(timestamptz), market_slug(text)`
</details>

---

## 3. READ/PULL PATH

| # | Mechanism | Source | Destination | Trigger | Status |
|---|-----------|--------|-------------|---------|--------|
| 1 | `npm run pull-coach-memos` | `coach_memos` (prod DB) | `docs/coach-inbox.md` | Manual operator run | **ACTIVE** — requires `PROD_DATABASE_URL` |
| 2 | `GET /api/chat/notes` | `user_intel_notes` | Coach UI notes panel | User opens Coach tab | **ACTIVE** |
| 3 | `GET /api/coach/notes` | `user_intel_notes` | **DUPLICATE** of #2 | Mounted at `/api/coach` | **DUPLICATE** |
| 4 | `GET /api/chat/system-notes` | `coach_system_notes` | No known UI consumer | HTTP endpoint exists | **ORPHANED ENDPOINT** |
| 5 | `GET /api/chat/conversations` | `coach_conversations` | Coach UI conversation list | User opens Coach tab | **ACTIVE** |
| 6 | `GET /api/chat/history` | `coach_conversations` | Coach UI message history | User opens conversation | **ACTIVE** |
| 7 | `GET /api/memory` | `claude_memory` | Claude Code sessions | Manual psql or HTTP | **ACTIVE** (separate pipeline) |
| 8 | Claude Code session-start | `docs/coach-inbox.md` (file) | Claude's context window | Per Rule 12 priority 6 | **ACTIVE** |

**No cron jobs, no scheduled pulls, no MCP tools** read coach memos. The pull is entirely manual.

---

## 4. CONSUMERS — Destination Chain

```
COACH (Gemini in prod)
  │
  ├── [COACH_MEMO] ──→ coach_memos DB (status='new')
  │                      │
  │                      └── npm run pull-coach-memos ──→ docs/coach-inbox.md
  │                                                          │
  │                                                          └── Claude Code reads at session start
  │
  ├── [COACH_MEMO] ──→ docs/coach-inbox.md (fs.appendFile, best-effort, ephemeral in prod)
  │
  ├── [SYSTEM_NOTE] ──→ coach_system_notes DB ──→ GET /api/chat/system-notes ──→ ??? (no UI consumer found)
  │
  ├── [SAVE_NOTE] ──→ user_intel_notes DB ──→ GET /api/chat/notes ──→ Coach UI notes panel
  │                                        └── GET /api/coach/notes ──→ (duplicate endpoint)
  │
  ├── [ZONE_INTEL] ──→ zone_intelligence DB ──→ Coach context loading (prompt injection)
  │
  ├── [MARKET_INTEL] ──→ market_intelligence DB ──→ Coach context loading (prompt injection)
  │
  ├── [LOG_OFFER_DECISION] ──→ coach_offer_decisions DB ──→ getCoachOfferDecisions (DAL, no HTTP endpoint)
  │
  └── (implicit) ──→ coach_conversations DB ──→ GET /api/chat/conversations + /history ──→ Coach UI
```

**Terminal consumers:**
- `docs/coach-inbox.md` → Claude Code context window (session start)
- Coach UI notes panel → driver sees their intel notes
- Coach system prompt → context loading injects market_intelligence, zone_intelligence, user_intel_notes
- **No Slack webhook, no email, no push notification, no external consumer**

---

## 5. DUPLICATES & DEAD CODE

### A. Competing write paths writing similar data to different tables

| Finding | Status |
|---------|--------|
| `coach_system_notes` and `coach_memos` both capture bug reports and feature requests. Pass-f audit (2026-04-17) found Coach prefers `[SYSTEM_NOTE]` over `[COACH_MEMO]` for bug reports — so bugs land in `coach_system_notes` (7 rows, **no pull mechanism**) while the pull script only reads `coach_memos` (1 row). **Result: bug reports are invisible to Claude Code.** | **DUPLICATE** |
| `user_intel_notes` captures "tips" that overlap with `coach_system_notes` observations. 47/59 `user_intel_notes` rows are garbled sentence fragments (see §6). | **DATA QUALITY** |

### B. Abandoned files / dead code

| File | Lines | Last Modified | Importers | Status |
|------|------:|--------------|-----------|--------|
| `server/lib/ai/coach-dal.js` | 2,270 | 2026-05-07 | **ZERO** | **DEAD CODE** — full duplicate of `rideshare-coach-dal.js` minus 7 methods. No file imports it. 82KB. |
| `server/api/coach/` directory | — | — | Referenced in `routes.js:64` comment as "stale fork (1,034 lines, zero importers)" | **ALREADY DELETED** — directory does not exist on disk. The comment in `routes.js:64` is stale. |
| `docs/architecture/COACH_PIPELINE_AUDIT.md` | 487 | 2026-05-05 | Referenced from this audit | **STALE** — pre-dates `coach_memos` DB migration. Superseded by this document. |

### C. Tables the write path uses but the read path ignores (or vice versa)

| Table | Written By | Read By | Gap |
|-------|-----------|---------|-----|
| `coach_system_notes` | `SYSTEM_NOTE` in chat.js | `GET /api/chat/system-notes` endpoint exists but **no UI calls it** | **Write-only in practice** — data goes in, nobody pulls it out |
| `coach_offer_decisions` | `LOG_OFFER_DECISION` in chat.js | DAL method `getCoachOfferDecisions` exists but **no HTTP endpoint exposes it** | **Write-only in practice** |
| `market_intelligence` | `MARKET_INTEL` in chat.js | Coach context loader in DAL | Both paths exist, but **33 rows are all seed data from Dec 2025 - Feb 2026** |
| `zone_intelligence` | `ZONE_INTEL` in chat.js | Coach context loader in DAL | Both paths exist, but **1 row in 5 months** |
| `app_feedback` | `server/api/feedback/feedback.js:349` | No known reader | **ACTIVE** — 0 rows but writer exists (no feedback submitted yet) |

### D. Duplicate HTTP endpoints

| Endpoint A | Endpoint B | Both Read | Status |
|-----------|-----------|-----------|--------|
| `GET /api/chat/notes` (chat.js:769) | `GET /api/coach/notes` (rideshare-coach/notes.js) | `user_intel_notes` | **DUPLICATE** — two routes serving the same data |

---

## 6. DATA SALVAGE INVENTORY

### coach_memos (1 row) — SALVAGEABLE

| id | type | title | detail (truncated) | priority | status |
|----|------|-------|--------------------|----------|--------|
| 60e4040e... | feature_request | Hands-free Voice Activation & TTS for Coach | Melody wants a fully hands-free, voice-activated mode... | high | exported |

**Assessment:** 1 real feature request. Prod DB likely has many more (the whole point of the survivability migration).

### coach_system_notes (7 rows) — ALL SALVAGEABLE

| id | type | title | date |
|----|------|-------|------|
| 19f26dbe... | bug_report | Strategy Engine Hallucinating Event Capacities | 2026-04-16 |
| e0592e31... | aha_moment | Background Audio/Tab Switching Success | 2026-05-04 |
| 39c2f910... | bug_report | TTS Stop Button Failure | 2026-05-04 |
| 4321bbf0... | aha_moment | Background audio during tab switching is a feature | 2026-05-04 |
| 54375b7e... | feature_request | Hands-free voice submission | 2026-05-04 |
| c6546314... | feature_request | Verbal trigger phrase to end listening | 2026-05-04 |
| 8b2f7e38... | bug_report | COACH_MEMO writes to ephemeral prod filesystem | 2026-05-09 |

**Assessment:** All 7 are real, meaningful observations. The Coach even self-diagnosed the memo survivability gap (row 8b2f7e38). **These have no pull mechanism — invisible to Claude Code.**

### user_intel_notes (59 rows) — 12 SALVAGEABLE, 47 GARBLED

**Good rows (12):** Preferences, insights, patterns with meaningful titles and content:
- "Early Morning Driver" — "Melody drives the 4 AM 'Early Bird' shift targeting airport runs from Frisco"
- "Home Base Location" — "Melody appears to be based in the North Dallas/Frisco area"
- "Tuesday Evening Rush" — "Drives Tuesday around 5 PM in Frisco"
- "Offer Analysis Workflow" — "Melody will send screenshots of accepted offers for instant analysis"

**Garbled rows (47):** All `note_type='tip'`, title = content = sentence fragment. Examples:
- title: "diagram and GIN metrics)." / content: "diagram and GIN metrics)."
- title: "USING GIN (metrics)`)." / content: "USING GIN (metrics)`)."
- title: "to use the wrong tool for the wrong query." / content: same

**Root cause:** The auto-tip-extraction in `chat.js:1587` appears to be slicing mid-sentence from the Coach's response and saving the fragment as both title and content. The `SAVE_NOTE` guard at chat.js:1587 skips auto-extraction when explicit `SAVE_NOTE` actions are present, but it fires freely otherwise.

### market_intelligence (33 rows) — SALVAGEABLE (seed data)

All 33 rows are from Dec 2025 – Feb 2026. Real market intelligence about US cities (LA, Phoenix, San Francisco, Stamford, Wilmington, etc.). Appears to be research-seeded data, not from live Coach conversations.

### zone_intelligence (1 row) — SALVAGEABLE

Single row: "Legends at Legacy Apartments" danger_zone, downgraded carjacking risk. From 2026-01-02.

### offer_intelligence (448 rows) — ALL SALVAGEABLE

Real offer data from "Melody's Iphone". 311 REJECT, 127 ACCEPT, 10 UNKNOWN. Date range: 2026-02-28 → 2026-03-30. Contains real fare, mileage, pickup/dropoff locations in Frisco area.

### coach_conversations (380 rows) — ALL SALVAGEABLE

Real conversation messages across multiple sessions. Most recent: 2026-05-16. Mix of user voice transcriptions and Gemini assistant responses.

### Other tables

| Table | Rows | Assessment |
|-------|-----:|-----------|
| coach_offer_decisions | 0 | Empty in dev — may have prod data |
| agent_memory | 0 | **ACTIVE** — writer/reader in agent system (corrected Phase 2) |
| eidolon_memory | 1 | Diagnostic artifact |
| cross_thread_memory | 1 | Diagnostic artifact |
| app_feedback | 0 | **ACTIVE** — writer at feedback.js:349 (corrected Phase 2) |

---

## 7. ENV & SECRETS

| Variable | Used By | Present in Workspace? |
|----------|---------|:--------------------:|
| `DATABASE_URL` | All DAL writes, `pull-coach-memos --dev` | **PRESENT** |
| `PROD_DATABASE_URL` | `pull-coach-memos` (prod default) | **MISSING** |
| `GEMINI_API_KEY` | Coach model (AI_COACH → gemini-pro-latest) | **PRESENT** |
| `REPLIT_DEPLOYMENT` | `saveCoachMemo` status logic ('new' vs 'exported') | **MISSING** (expected — this is workspace) |
| `REPL_ID` | IS_REPLIT detection | **PRESENT** |
| `AI_COACH_MODEL` | Coach model override | **MISSING** |
| `AI_COACH_MODE` | Coach feature flag | **MISSING** |
| `AI_COACH_TOKEN` | Coach auth token | **MISSING** |
| `AI_COACH_OVERRIDE_PROVIDER` | Provider override | **MISSING** |
| `AI_COACH_OVERRIDE_MODEL` | Model override | **MISSING** |

**Note on `PROD_DATABASE_URL`:** Melody stated this issue is resolved. It may be set as a Replit Secret (accessible in deployed contexts but not in this shell session). The script itself is functional — the env var just needs to be present when the operator runs it.

---

## 8. RECOMMENDED REBUILD PLAN

### Problem Statement

The Coach pipeline has **9 write targets**, **2 DAL files (one dead)**, **2 duplicate endpoints**, **47 garbled rows**, **1 orphaned table**, and **data siloed across tables with no unified read path**. The `coach_system_notes` table (7 real observations including the Coach's own self-diagnosis) has no pull mechanism and is invisible to Claude Code.

### Proposed Steps

| # | Action | Files | Est. Lines Removed | Est. Lines Added |
|---|--------|-------|-------------------:|:----------------:|
| 1 | **Delete `coach-dal.js`** — zero importers, full dead code | `server/lib/ai/coach-dal.js` | -2,270 | 0 |
| 2 | **Remove stale comment** about `server/api/coach/` directory (already deleted) | `server/bootstrap/routes.js:63-65` | -3 | 0 |
| 3 | **Merge `coach_system_notes` into `coach_memos` write path** — when Coach emits `[SYSTEM_NOTE]`, also emit a `coach_memos` row so the pull script captures it. OR: extend `pull-coach-memos.mjs` to also query `coach_system_notes WHERE status='new'`. | `rideshare-coach-dal.js` or `pull-coach-memos.mjs` | 0 | ~20 |
| 4 | **Fix auto-tip extraction** — the garbled `user_intel_notes` "tip" rows are caused by the auto-extraction at `chat.js:1587+`. Either disable it or fix the slicing logic. | `server/api/chat/chat.js:1587+` | ~10 | ~10 |
| 5 | **Consolidate duplicate note endpoints** — remove `GET /api/coach/notes` (rideshare-coach/notes.js) in favor of `GET /api/chat/notes` (chat.js:769), or vice versa | `server/api/rideshare-coach/notes.js` or `chat.js` | ~80 | 0 |
| 6 | **Add `coach_offer_decisions` HTTP read endpoint** — the DAL method exists but no route exposes it | `server/api/chat/chat.js` | 0 | ~15 |
| 7 | **Clean garbled `user_intel_notes` rows** — DELETE the 47 garbled "tip" rows that have title === content as sentence fragments | psql one-liner | 0 | 0 |
| ~~8~~ | ~~Drop `app_feedback` table~~ — **CANCELLED:** active writer at `feedback.js:349`; 0 rows = no submissions yet, not orphaned | — | 0 | 0 |
| 9 | **Document `PROD_DATABASE_URL`** in `.env.local.example` so future sessions know it exists | `.env.local.example` | 0 | +3 |

**Total estimated cleanup: ~2,360 lines removed, ~48 lines added.**

### Priority order

1. Step 1 (delete dead DAL) — biggest win, zero risk
2. Step 3 (unify system notes into pull path) — makes Coach bug reports visible to Claude Code
3. Step 4 (fix garbled tips) — stops data pollution
4. Step 7 (clean garbled rows) — data hygiene
5. Steps 2, 5, 6, 8, 9 — cleanup

---

## Discrepancies: Docs vs. Disk

| Doc claim | Disk reality | Source |
|-----------|-------------|--------|
| `routes.js:64` comment: "parallel stale fork at `server/api/coach/` (1,034 lines, zero importers)" | Directory **does not exist** — already deleted | `server/bootstrap/routes.js:63-65` |
| `COACH_PIPELINE_AUDIT.md` (2026-05-05) references pre-DB-migration architecture | `coach_memos` table + `saveCoachMemo` + `pull-coach-memos.mjs` all exist on disk | `docs/architecture/COACH_PIPELINE_AUDIT.md` |
| CLAUDE.md Rule 8 lists `coach_memos` table with migration `20260512` | Table exists in schema and DB, migration file exists | Consistent |
| Coach system prompt (chat.js:1162) says COACH_MEMO "writes to docs/coach-inbox.md" | Primary write is now to DB; FS write is secondary best-effort | `chat.js:488-493` comments are accurate; system prompt at L1162 is stale |
