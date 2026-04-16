# Pass F — Issue Logging / Feedback / Monitoring Survivability

**Date:** 2026-04-16
**Auditor:** Claude Opus 4.6 (architect on duty), verified against live code
**Triggered by:** Melody's product pain: "things are logged somewhere without becoming operationally visible"
**Status:** Verified. 1 bug fixed (app_feedback user link). Rules extracted. Pass G queued.

## Claim Verification Table

| Claim | Verdict | Evidence |
|-------|---------|----------|
| **1.1** POST /api/feedback/venue: auth, rate-limit 10/min, validate, sanitize, upsert venue_feedback, log to actions, async indexFeedback() + captureLearning() | **VERIFIED** | `feedback.js:56-163` — all 7 behaviors confirmed at cited lines |
| **1.2** GET /api/feedback/venue/summary: auth, aggregates up/down per venue | **VERIFIED** | `feedback.js:182-228` — requireAuth, GROUP BY place_id, returns items with up_count/down_count |
| **1.3** POST /api/feedback/strategy: auth, rate-limited, upserts strategy_feedback, NO summary endpoint | **VERIFIED** | `feedback.js:232-311` — upsert confirmed. Grep for `strategy/summary` returned 0 hits |
| **1.4** POST /api/feedback/app: auth required, BUT authUserId NOT in insert values | **VERIFIED TRUE — BUG FIXED** | `feedback.js:320` reads authUserId, lines 349-353 omitted it from insert. Fixed in commit `403a4b9f`. Schema also lacked user_id column — migration applied |
| **1.5** /api/actions is "opaque" — write-only | **VERIFIED** | `actions.js:33` — POST only (requireAuth, validate). Zero `router.get` handlers. Writes to `actions` table with user_id, ranking_id, snapshot_id, action, block_id, dwell_ms. User-linked. **Write-only — no read endpoint for operators** |
| **1.6** chat.js contains legacy /api/chat/notes CRUD duplicating /api/coach/notes | **VERIFIED** | `chat.js:588-666` — POST/GET/DELETE `/api/chat/notes` handlers are live-routed. Client uses `/api/coach/notes` per API_ROUTES constants. Legacy endpoints are reachable but unused by the canonical client |
| **1.7** COACH_MEMO appends to docs/coach-inbox.md via fs.appendFile | **VERIFIED** | `chat.js:6` imports appendFile; `chat.js:442-463` builds entry string + calls `appendFile(coachInboxPath, entry, 'utf-8')`. Not DB-persisted |
| **1.8** useMemory() uses /agent/memory/conversation, not /api/memory | **VERIFIED** | `useMemory.ts:95` — `fetch('/agent/memory/conversation', ...)`. Zero references to `/api/memory` in this hook |

## Live Evidence: Tonight's SYSTEM_NOTE Bug Report

The Rideshare Coach emitted a `SYSTEM_NOTE` action tag with `note_type: 'bug_report'` during the strategy hallucination session. Trace:

| Lane | Persisted? | Queryable via API? | Visible in UI? |
|------|-----------|-------------------|----------------|
| `coach_system_notes` table | **YES** — id `19f26dbe`, status `new` | **YES** — `GET /api/chat/system-notes` at `chat.js:1462` | **NO** — no client component renders system notes |
| `docs/coach-inbox.md` | Depends on whether COACH_MEMO was also emitted | File-based — grep only | **NO** |
| `/api/memory` | **NO** — separate internal store | N/A | N/A |

**Finding:** The SYSTEM_NOTE is queryable via `GET /api/chat/system-notes?status=new` (confirmed at `chat.js:1460-1473`). This is better than E-Rule 4 suggested — system notes ARE DB-persisted and API-queryable. However, there is NO client UI surface that displays them. An operator must know to call the endpoint directly. **E-Rule 5 is validated: observability exists at the API layer but not at the UI layer.**

## F-Rules

**F Rule 1:** Venue feedback is the most complete feedback lane: auth, rate-limited, validated, sanitized, upserted, action-logged, async-indexed, and learning-captured. It is the gold standard for how feedback should work.

**F Rule 2:** Strategy feedback follows the same pattern but lacks a summary read endpoint and does not trigger indexFeedback() or captureLearning(). It is one tier below venue feedback.

**F Rule 3:** App feedback was broken (no user link) until commit `403a4b9f`. It also has no rate limiting, no action-table logging, no async enrichment. It is the weakest feedback lane.

**F Rule 4:** /api/actions is write-only. It captures clicks, dwells, and views with full user/ranking/snapshot attribution — but no operator can query it via API. The data exists in the DB but requires direct SQL to access.

**F Rule 5:** SYSTEM_NOTE is DB-persisted and API-queryable (`GET /api/chat/system-notes`), but has no UI surface. Operators must call the endpoint directly. This is an observability gap, not a persistence gap.

## F-Gaps

**F-gap-1:** App feedback had no user link (FIXED — `403a4b9f`). Historical rows remain unlinked.

**F-gap-2:** /api/actions has no read endpoint. Operators cannot retrieve action data without direct DB access.

**F-gap-3:** Strategy feedback has no summary endpoint (unlike venue feedback which has `/venue/summary`). Aggregate strategy sentiment is invisible.

**F-gap-4:** SYSTEM_NOTE has no UI surface. Bug reports from the Coach are API-queryable but require knowing the endpoint exists.

**F-gap-5:** Legacy `/api/chat/notes` routes coexist with canonical `/api/coach/notes`. Maintenance risk — two code paths for the same concept.

**F-gap-6:** COACH_MEMO is file-only (`docs/coach-inbox.md`). Not queryable, not filterable, not dashboardable. Useful for handoff but poor for operational monitoring.

**F-gap-7:** No unified "issues dashboard" surface exists. Driver pain signals land across 5+ tables/files — an operator must know which lane to query for each type of signal.

## Next audit phase (Pass G)

**Pass G — Actions / Learning-Capture / Queryability Audit**

Questions Pass G answers:
- What does the `actions` table schema look like and how much data accumulates?
- Is `captureLearning()` / `indexFeedback()` actually producing queryable artifacts?
- What would a minimal "actions read endpoint" look like?
- Can actions + feedback + system notes be joined into a single operator view?

## Related commits

- `403a4b9f` — Fix: app_feedback user link (Pass F finding)
- `19f26dbe` — SYSTEM_NOTE bug report from tonight's hallucination session (live test data)
- `c605eabb` / `d6ce19e8` / `ceeb62b6` — Hallucination fixes that triggered the SYSTEM_NOTE
