# Pass F — Issue Logging & Monitoring **Survivability**

**Date:** 2026-04-17
**Auditor:** Claude Opus 4.7 (1M ctx), live verified against dev DB and source.
**Tracer bullet:** Tonight's `[SYSTEM_NOTE]` bug report from the 2026-04-16 strategy-hallucination session.
**Predecessor:** `pass-f-issue-logging-observability.md` (2026-04-16, Claude Opus 4.6) — established lane inventory; this pass re-verifies *survivability* through a single tracer.
**Scope:** Read-only. Dev DB only (no prod). No schema changes, no migrations.

---

## Verdict in one line

> **Coach SYSTEM_NOTE bug reports survive as `coach_system_notes` rows that are HTTP- and SQL-queryable but invisible in the driver UI and operationally unreviewed (status still `new` 18+ hours after emission).**

---

## Lane map (verified during recon)

| # | Lane | Mount → handler → backing store | Read endpoints | Notes |
|---|------|--------------------------------|----------------|-------|
| **a-i** | `coach_system_notes` (where SYSTEM_NOTE actually lands) | `/api/chat` → `chat.js` parses `[SYSTEM_NOTE: …]` tag → `rideshareCoachDAL.createSystemNote()` at `server/lib/ai/rideshare-coach-dal.js:1579` → `INSERT INTO coach_system_notes` | `GET /api/chat/system-notes` (`chat.js:1462`, requireAuth) | columns: `id, note_type, category, priority, title, description, user_quote, triggering_user_id, triggering_conversation_id, triggering_snapshot_id, occurrence_count, affected_users, market_slug, is_market_specific, status, reviewed_at, reviewed_by, implementation_notes, created_at, updated_at` |
| **a-ii** | `coach_notes` route (the path in the brief) | `/api/coach` → `server/api/rideshare-coach/index.js` mounts `notes.js` → `user_intel_notes` table (NOT `coach_notes`; `coach_notes` does NOT exist in DB) | `GET /api/coach/notes` (`notes.js:32`, requireAuth) | **Naming drift flagged:** the prior Pass F doc and the brief both refer to "`coach_notes`" — actual table is `user_intel_notes`. CLAUDE.md schema list calls it correctly. |
| **b** | `docs/coach-inbox.md` (filesystem) | `chat.js:442-463` — `fs.appendFile(coachInboxPath, entry, 'utf-8')` on `[COACH_MEMO: …]` tag | None — `cat` / `grep` only | 119 lines total. Last modified 2026-04-14 — **untouched since the hallucination session**. |
| **c** | `/agent/memory/*` (separate process) | `agent-server.js:550-640` — POST `preference\|session\|project\|conversation`, GET `/conversations` | `GET /agent/memory/conversations` only (1 of 5 routes is GET) | Backing: `agent_memory` table — `(id, scope, key, user_id, content, created_at, updated_at, expires_at)`. **0 rows in dev DB**. |
| **d** | `claude_memory` via `/api/memory` | `routes.js:107` → `server/api/memory/index.js` → `INSERT INTO claude_memory` | `GET /api/memory`, `/stats`, `/rules`, `/session/:id`, `PATCH /:id` | Used by Claude Code for session-spanning notes. 20 recent rows from the 2026-04-16/17 work; tracer SYSTEM_NOTE itself NOT replicated here, only meta-rows about the fixes. |
| **e** | `app_feedback` | `/api/feedback/app` (`feedback.js:315`, requireAuth) → `INSERT INTO app_feedback` | None for app feedback. Only `/venue/summary` GET exists for the venue lane. | Recently fixed in `403a4b9f` to link `user_id`. 0 rows in last 2 days. |
| **f** | `actions` | `/api/actions` (`actions.js:33`, requireAuth, validate) → `INSERT INTO actions` | None — POST-only. Zero `router.get` handlers. | PK is `action_id`, not `id`. 9 `blocks_viewed` rows from the tracer-user during 2026-04-16 — captures driver behavior around the bug, but not the bug report itself. |

### Memory-table sprawl noted (not in scope, but observed)

`information_schema.tables` shows **6** memory-like tables in dev: `agent_changes`, `agent_memory`, `assistant_memory`, `claude_memory`, `cross_thread_memory`, `eidolon_memory`. Only `agent_memory` and `claude_memory` are reachable via the documented HTTP lanes Melody asked about. The other four are write paths from various AI subsystems with no first-class read surface — separate audit territory.

---

## Tracer bullet results — SYSTEM_NOTE per lane

| Lane | Present? | Evidence |
|------|----------|----------|
| **(a) coach_system_notes** | **PRESENT** | `id 19f26dbe-1b14-4056-859c-63ab96618770`, `note_type=bug_report`, `category=strategy`, `status=new`, `priority=50`, `created_at=2026-04-16 21:11:32 UTC`, title `"Strategy Engine Hallucinating Event Capacities and Dates"`, description begins `"The strategy engine is consistently inflating expected attendance numbers well beyond the physical maximum capacities of the venues..."` |
| **(b) docs/coach-inbox.md** | **ABSENT** | File last modified 2026-04-14 05:13 (BEFORE the hallucination session). Only one keyword hit (`hallucinations`, line 18) is a generic 2026-04-14 architectural suggestion, not the tracer. **Coach did not emit a `[COACH_MEMO]` tag alongside the `[SYSTEM_NOTE]`** — only the SYSTEM_NOTE lane was used. |
| **(c) agent_memory (`/agent/memory/*`)** | **ABSENT** | `agent_memory` table holds 0 rows in dev. Semantically wrong lane anyway — agent_memory is for AI session state, not bug reports. |
| **(d) claude_memory (`/api/memory`)** | **ABSENT directly; ADJACENT meta-rows present** | No claude_memory row replicates the SYSTEM_NOTE. However, ids 140/141/142/143/145/146/147 capture the *fixes* downstream of the tracer (H-1, H-2, H-3, doctrine codification, app_feedback fix, prior Pass F, visual verification). claude_memory is a Claude-Code-driven journal, not a Coach output. |
| **(e) app_feedback** | **ABSENT** | 0 rows in last 2 days. Wrong lane — app_feedback is for driver-submitted feedback, not Coach AI output. |
| **(f) actions** | **ABSENT (only contextual evidence)** | 9 `blocks_viewed` rows from user `2f22004b-…02f50ccff571` between 2026-04-16 13:19 and 23:22 UTC — confirms the user was actively viewing the strategy blocks during the day the hallucination was caught. Useful for joining behavioral evidence to the bug, but the bug itself is not in `actions`. |

**Summary:** SYSTEM_NOTE landed in **exactly one** of the 6 lanes — `coach_system_notes`.

---

## Q1 — Where did tonight's SYSTEM_NOTE land?

| Lane | Verdict |
|------|---------|
| (a) coach_system_notes via `/api/chat/system-notes` | **PRESENT** — id `19f26dbe-…`, status `new` |
| (b) `docs/coach-inbox.md` and siblings | **ABSENT** — file untouched since 2026-04-14 |
| (c) `/agent/memory/*` | **ABSENT** — `agent_memory` table empty in dev |
| (d) `claude_memory` via `/api/memory` | **ABSENT** (adjacent meta-rows about the fix only) |
| (e) `app_feedback` | **ABSENT** — wrong lane (driver-submitted, not Coach-emitted) |
| (f) `actions` | **ABSENT** — wrong lane (clicks/dwells, not bug reports). Contextual `blocks_viewed` rows present. |

---

## Q2 — Which lane is QUERYABLE right now?

| Lane | HTTP read | SQL read |
|------|-----------|----------|
| (a-i) coach_system_notes | **YES** — `GET /api/chat/system-notes` (`chat.js:1462`, requireAuth) | `SELECT … FROM coach_system_notes` |
| (a-ii) /api/coach/notes → user_intel_notes | YES — `GET /api/coach/notes` (`notes.js:32`, requireAuth) | `SELECT … FROM user_intel_notes` |
| (b) coach-inbox.md | **NO HTTP** | filesystem `cat` / `grep` only |
| (c) /agent/memory/* | PARTIAL — only `GET /agent/memory/conversations` (1 of 5 routes) | `SELECT … FROM agent_memory` |
| (d) claude_memory | **YES** — full CRUD on `/api/memory` (no auth) | `SELECT … FROM claude_memory` |
| (e) app_feedback | **NO** — `/venue/summary` GET exists, no `/app/summary` | `SELECT … FROM app_feedback` |
| (f) actions | **NO** — POST-only, zero `router.get` | `SELECT … FROM actions` |

---

## Q3 — Which lane is VISIBLE to the driver in the UI?

**None.** All 6 lanes are operationally internal. No client component renders `coach_system_notes`, `user_intel_notes`, `coach-inbox.md`, agent memory, claude_memory, app_feedback, or actions to a driver-facing surface. The prior Pass F doc established this as F-Rule 5; this pass reaffirms — even with HTTP read endpoints in place, the driver sees nothing of the operational telemetry the system collects about itself.

---

## Q4 — Which lanes are effectively WRITE-ONLY?

| Lane | Write-only? | Why |
|------|-------------|-----|
| (a-i) coach_system_notes | NO | HTTP GET exists |
| (a-ii) user_intel_notes | NO | HTTP GET exists |
| (b) coach-inbox.md | **YES over HTTP** (file is locally readable) | No HTTP endpoint; operator must SSH or grep file directly |
| (c) /agent/memory/preference, /session, /project | **YES** | 3 of 4 POST routes have no matching GET; only `/conversation` has `/conversations` GET |
| (d) claude_memory | NO | rich CRUD |
| (e) app_feedback | **YES** | POST exists; no GET, no summary, no dashboard |
| (f) actions | **YES** | POST-only; verified at `actions.js:33`. F-Rule 4 (prior pass) carries forward unchanged. |

**Effectively write-only:** (b) coach-inbox over HTTP, parts of (c) agent_memory, (e) app_feedback, (f) actions. Four of seven lanes investigated lack a documented HTTP read surface.

---

## Q5 — Fastest reliable path to find the SAME runtime issue tomorrow

**One lane, one command:**

```bash
psql "$DATABASE_URL" -c "SELECT id, note_type, category, status, priority, title, created_at FROM coach_system_notes WHERE status='new' ORDER BY created_at DESC LIMIT 20;"
```

**Why this beats every alternative:**
- HTTP path (`curl -H "Authorization: Bearer …" http://localhost:5000/api/chat/system-notes?status=new`) requires a valid session token — friction during incident response.
- SQL bypasses auth, returns immediately, sorts by recency, filters to *unreviewed* notes (the action queue).
- `coach_system_notes.status` is the *only* lane that has a state machine on it (`new → reviewed → implemented`), so filtering by `status='new'` is a true work queue.
- All other lanes either require manual archaeology (grep coach-inbox), have no read endpoint at all (actions, app_feedback), or are semantically wrong for AI-emitted bug reports (claude_memory, agent_memory).

**One-line answer:**
> `psql "$DATABASE_URL" -c "SELECT id, status, title, created_at FROM coach_system_notes WHERE status='new' ORDER BY created_at DESC LIMIT 20"` — the only lane with a real state machine + recency sort + non-zero rows.

---

## Survivability findings (delta vs prior Pass F)

1. **Tracer survived the 18+ hour gap unchanged.** The SYSTEM_NOTE row from 2026-04-16 21:11 UTC is still `status='new'` at audit time (2026-04-17). DB persistence works; **operational triage does not** — no human or automation has touched the row.
2. **Coach used a single lane for the bug report.** Despite the prior Pass F doc speculating that COACH_MEMO might also fire, this tracer shows the Coach emitted **only** `[SYSTEM_NOTE]` — `docs/coach-inbox.md` is untouched. The lanes are exclusive in practice for this category of output.
3. **Naming drift between docs and DB.** Prior Pass F audit and CLAUDE.md both reference "`coach_notes`" but the actual table is `user_intel_notes`. Recommend a docs sweep to standardize on `user_intel_notes` — the route name `/api/coach/notes` can stay, but documentation should not invent a phantom table name.
4. **Memory-table sprawl deserves its own pass.** Six tables match the `%memory%` / `agent%` patterns; only two are reachable via the lanes Melody catalogued. Likely target for a future Pass G or H.
5. **The driver sees zero of this.** Every lane investigated is operator-facing or AI-internal. If a driver hits the same hallucination tomorrow and the Coach emits a SYSTEM_NOTE, the driver will see strategy output unchanged and have no signal that the system flagged itself.

---

## Recommended follow-ups (capture only — no work performed)

| ID | Recommendation | Effort | Why it matters |
|----|----------------|--------|----------------|
| F-survive-1 | Wire a daily cron or `/api/health` extension that reports `count(*) FROM coach_system_notes WHERE status='new'` to a visible surface (Slack, email, dashboard) | Low | Tracer proves the row sits forever otherwise |
| F-survive-2 | Add `GET /api/feedback/app` and `GET /api/feedback/app/summary` to make app_feedback symmetric with venue feedback | Low | Closes write-only gap (e) |
| F-survive-3 | Add `GET /api/actions` operator endpoint (auth-gated) — even a paginated raw list is better than zero | Medium | Closes write-only gap (f); enables joining `actions` to `coach_system_notes` for incident reconstruction |
| F-survive-4 | Standardize doc references from "`coach_notes`" to "`user_intel_notes`" across CLAUDE.md, prior audits, APICALL.md | Low | Phantom table name causes recon friction |
| F-survive-5 | Pass G or H: catalog the 6 memory-like tables (`agent_changes`, `agent_memory`, `assistant_memory`, `claude_memory`, `cross_thread_memory`, `eidolon_memory`) and decide which are still load-bearing vs deprecated | Medium | Sprawl is invisible until the next migration tries to touch one |

---

## Related artifacts

- **Tracer SYSTEM_NOTE row:** `coach_system_notes.id = 19f26dbe-1b14-4056-859c-63ab96618770`
- **Predecessor audit:** `docs/architecture/audits/pass-f-issue-logging-observability.md`
- **Triggering session commits:** `c605eabb` (H-1), `d6ce19e8` (H-2), `ceeb62b6` (H-3), `1842af3d` (DECISIONS.md #17/#18/#19)
- **Related claude_memory ids (this session):** 140, 141, 142, 143, 145, 146, 147 (captured the fixes; not the tracer itself)
- **DECISIONS.md NOT modified** per Melody's constraint.
