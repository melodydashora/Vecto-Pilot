# Duplicate Functions — Fix Plan (2026-04-28)

**Status:** PROPOSAL — Group A approved by Melody 2026-04-28; remaining groups awaiting per-Group approval per CLAUDE.md Rule 1
**Canonical audit reference:** `docs/architecture/audits/CODEBASE_AUDIT_2026-04-27.md` (on branch `audit/codebase-2026-04-27`, pushed to GitHub) — this fix plan covers the briefing-pipeline subset of that audit
**Branch:** `coach-pass2-phase-b`

## Relationship to canonical audit

The canonical `CODEBASE_AUDIT_2026-04-27.md` identifies six priority buckets in its fix order. This fix plan addresses only bucket 5 — the items I have fully analyzed.

| # | Bucket | Status of this fix plan |
|---|---|---|
| 1 | Route/boot duplication (`sdk-embed.js`, `.replit`, `index.js`, `agent-server.js`) | NOT IN THIS PLAN — needs its own plan |
| 2 | DB correctness (SSL verification disabled at 3 sites, pool health stub, retry shallow, keepalive failures swallowed) | NOT IN THIS PLAN — see memory #241 (SSL contested fact); needs its own plan |
| 3 | Hard races (Gemini env mutation, briefing zombie recovery in-memory only, advisory-lock race) | NOT IN THIS PLAN — needs its own plan |
| 4 | Replace stubs that return success (unified AI health, semantic search, ML memory/search, SDK ghost `/ranking`) | NOT IN THIS PLAN — needs its own plan |
| **5** | **Clean duplicate briefing/map logic + stale `_future` modules** | **THIS PLAN — Groups A through E below** |
| 6 | Add limits around chat actions / coach memo file writes | NOT IN THIS PLAN — needs its own plan |

The other five buckets need separate plans before code edits — they touch surfaces I haven't read closely enough to recommend specific fixes safely. Memory rows #237 (this audit, reframed as a subset), #241 (SSL contested fact), #242 (audit corpus inventory), and #243 (static-analysis methodology floor) provide cross-references for future sessions.

## Approval protocol

Per CLAUDE.md Rule 1, code changes require:
1. Plan document (this doc)
2. Test cases for each change
3. Formal testing approval from Melody before implementation

This plan groups changes by risk + reversibility. Each Group can be approved independently. **No code is touched until each Group is signed off explicitly.**

---

## Group A — Trivial (delete duplicate log lines only, no behavioral change)

These remove duplicate EMITS without changing the underlying function calls. Safe to apply individually.

### A.1 — Remove caller-side hash dedup log

- **File:** `server/api/briefing/briefing.js:917-920`
- **Change:** Delete the `if (beforeDedup > allEvents.length) { console.log(...) }` block. The function-side log at `briefing-service.js:276` fires from both write and read paths.
- **Test:** Run a snapshot. Confirm `[BRIEFING] [EVENTS] [DEDUP] Hash dedup: ...` still appears once per dedup call (only function-side now).
- **Risk:** None — deleting a log statement only.

### A.2 — Remove caller-side freshness filter log

- **File:** `server/api/briefing/briefing.js:944`
- **Change:** Delete the `if (beforeFreshFilter > allEvents.length) { console.log(...) }` block. The function-side log at `strategy-utils.js:699` fires from inside `filterFreshEvents`.
- **Test:** Same as A.1.
- **Risk:** None.

### A.3 — Migrate orphan log lines to canonical chain

- **Files / lines:**
  - `server/lib/briefing/filter-for-planner.js:219` — `[BRIEFING] [Filter] Events: ...` → `[BRIEFING] [EVENTS] [FILTER] State-scoped: ...`
  - `server/api/briefing/briefing.js:955` — `[BRIEFING] Events filter=active: ...` → `[BRIEFING] [EVENTS] [FILTER] Active: ...`
  - `server/lib/briefing/briefing-service.js` — `[BRIEFING] Events: 29 from discovered_events table` (need to grep exact line) → `[BRIEFING] [EVENTS] [DB] [discovered_events] N rows ...`
- **Test:** Confirm log output matches doctrine row #229 canonical template.
- **Risk:** Trivial — string formatting only.

---

## Group B — Low-risk (remove duplicate invocations after verification)

### B.1 — Remove worker-side updatePhase('venues') from enhanced-smart-blocks.js

- **File:** `server/lib/venue/enhanced-smart-blocks.js:361`
- **Change:** Delete `await updatePhase(snapshotId, 'venues', { phaseEmitter });`
- **Rationale:** Orchestrator at `blocks-fast.js:839` already sets phase to 'venues' before invoking the worker. The worker re-emit at line 361 is redundant.
- **Test:** Run a snapshot. Confirm only ONE `[VENUE] [PHASE-UPDATE] -> venues` line in the log (instead of two 13ms apart).
- **Risk:** Low. If the orchestrator-side emit somehow fails, the worker emit was the safety net. Mitigation: keep the worker emit if Melody prefers belt-and-suspenders.

### B.2 — Investigate "Fix #15" before touching updatePhase('complete') × 4

- **Action:** Read git history for the comment at `blocks-fast.js:897` ("Fix #15 - prevents 98% stuck issue"). If the underlying bug is documented and resolved, propose removing the inner emit at line 272. If not, document the defense-in-depth explicitly so it's no longer accidental-looking.
- **No code change in this round.** Investigation only.
- **Outcome:** Updates this fix plan with either (a) a B.3 entry to remove line 272, or (b) a doc update making the defense-in-depth intent explicit.

---

## Group C — Medium-risk (consolidate the 7-route filter idiom)

### C.1 — Introduce withFreshEvents helper, delegate from each route

- **New helper:** `withFreshEvents(briefing, snapshot)` returns a briefing with events filtered. Lives in `server/lib/briefing/` (location TBD by Melody).
- **Files modified:** `server/api/briefing/briefing.js` — replace each of 7 inline filter calls with `withFreshEvents(briefing, snapshot)` (call sites at lines 237, 305, 371, 461, 545, 943, 1064).
- **Test:** Each of 7 routes returns the same filtered events as before. Use snapshots representative of each route path: `/current`, `/generate`, aggregate, `/refresh`, `/events`, `/discovered-events`.
- **Risk:** Medium — touches 7 routes. Mitigation: side-by-side comparison of filtered output before/after for at least one snapshot per route.

### C.2 — Cache /api/briefing/events/:snapshotId per snapshot_id (resolves Finding 9 partially)

- **File:** `server/api/briefing/briefing.js` (events route at line 856ish)
- **Change:** Cache the full filtered/deduped/active result keyed by `snapshot_id`. Invalidate on `briefing_events_ready` NOTIFY.
- **Test:** Confirm subsequent /events calls within TTL return cached output (no re-run of dedup pipeline). Verify cache invalidates when briefing_events updates.
- **Risk:** Medium — cache invalidation risk. Mitigation: pg_notify channel-based invalidation makes this safe.

---

## Group D — Frontend (out of scope for this server-side audit)

### D.1 — Investigate post-VENUE-COMPLETE briefing /events re-fetches (memory #236)

Frontend likely re-mounts a Briefing component after venue cards arrive, triggering re-fetch. Diagnosis required: which client lifecycle event triggers the re-fetch. **Out of scope for this audit; flagged for a separate frontend audit session.**

---

## Group E — Doc drift fixes (additive only)

### E.1 — Mark superseded docs

- **Files:**
  - `docs/EVENT_FRESHNESS_AND_TTL.md` — add header `> SUPERSEDED by docs/EVENTS.md (event sections)`
  - `docs/BRIEFING_AND_EVENTS_ISSUES.md` — add same header for architecture sections; preserve the issue tracker (verification status table is still useful)

### E.2 — Update EVENTS.md §4 to reflect actual state

- Add a TODO in §4 acknowledging the 7-route inline filter pattern (with cross-reference to this audit) and either:
  - Confirm the client-side filter exists by pointing at the actual code, or
  - Remove the client-side claim (grep returned no caller in `client/src/pages/co-pilot/BriefingPage.tsx`)

---

## Approval requested

For each Group (A, B, C, E), please indicate: **approve / defer / reject**.

- **Group A** is fully ready (trivial log-line edits, no behavioral risk)
- **Group B.1** is ready (low risk); **Group B.2** is investigation, not a code change
- **Group C** needs Melody's preference on Option A vs Option B from the audit doc Finding 1 before drafting concrete edits
- **Group D** is out of scope (frontend); will be a separate audit
- **Group E** is doc-only (additive)

Suggested ordering:
1. Group A (immediate wins, log-clean)
2. Group E (doc hygiene, parallel)
3. Group B (after A confirms log behavior)
4. Group C (largest, after B confirms the duplicate-invocation pattern is understood)

Each Group will get its own commit with a test plan attached.
