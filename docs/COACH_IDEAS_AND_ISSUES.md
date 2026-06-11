# Coach Pipeline — Ideas & Issues

Capture file for Melody's notes. Drop anything here so it stops getting lost.

---

## Issues

<!-- Format: YYYY-MM-DD | symptom | suspected file or area -->

| Date | Symptom | Suspected File / Area |
|------|---------|----------------------|
| 2026-05-26 | 47/59 `user_intel_notes` rows are garbled — auto-tip extraction saves sentence fragments as both title and content | `server/api/chat/chat.js:1587+` (auto-tip extraction) |
| 2026-05-26 | Coach prefers `[SYSTEM_NOTE]` over `[COACH_MEMO]` for bug reports — bugs land in `coach_system_notes` which has no pull mechanism | `server/api/chat/chat.js` system prompt at L1178 vs L1161 |
| 2026-05-26 | Coach system prompt (L1162) still says COACH_MEMO "writes to docs/coach-inbox.md" — primary write is now to DB | `server/api/chat/chat.js:1162` |
| 2026-05-26 | `GET /api/chat/system-notes` endpoint exists but no UI calls it — 7 real observations invisible | `server/api/chat/chat.js:1735` |
| 2026-05-26 | Duplicate note endpoints: `/api/chat/notes` and `/api/coach/notes` both read `user_intel_notes` | `chat.js:769` + `rideshare-coach/notes.js` |
| 2026-05-26 | Coach has no read access to its own past `coach_memos` or `coach_system_notes` — `getCompleteContext()` loads 13 data elements but neither table is included; Coach reported "Agent Memory and Project State context came in completely empty" | `server/lib/ai/rideshare-coach-dal.js:732-838` (`getCompleteContext`), `server/lib/ai/rideshare-coach-dal.js:858-1235` (`formatContextForPrompt`) — repro: start any Coach chat session and observe the system prompt has no memo/system-note sections |

---

## Ideas

<!-- Format: YYYY-MM-DD | idea | why it matters -->

| Date | Idea | Why |
|------|------|-----|
| 2026-05-26 | Extend `pull-coach-memos.mjs` to also query `coach_system_notes WHERE status='new'` | Makes Coach bug reports visible to Claude Code without changing the Coach's system prompt behavior |
| 2026-05-26 | Add a UI card to the Coach tab showing `coach_system_notes` | The Coach's own observations (aha moments, bug reports) are valuable driver-facing content |
| 2026-05-26 | Fix auto-tip extraction or disable it entirely | 47 garbled rows in `user_intel_notes` = data pollution; the meaningful notes come from explicit `[SAVE_NOTE]` tags |
| 2026-05-26 | Consolidate `coach_system_notes` and `coach_memos` into one table | Both capture the same kind of content (bug reports, feature requests, observations) with different schemas and different read paths |
| 2026-05-26 | Add `coach_offer_decisions` HTTP read endpoint | DAL method exists (`getCoachOfferDecisions`) but no route exposes it — offer decision data is write-only |
