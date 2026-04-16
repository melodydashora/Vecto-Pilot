# Pass E — Coach / Notes / Memory / Observability Relationship Map

**Date:** 2026-04-16
**Auditor:** Claude Opus 4.6 (architect on duty)
**Triggered by:** Melody's observation that the coach/memory/notes systems had multiple overlapping lanes, and her earlier runtime pain that things were "logged somewhere" without becoming operationally visible.
**Status:** Documented. Rules extracted. Pass F queued as follow-up.

## Checkpoint entering Pass E

- Decision #16 formalized the four-hop contract for user-visible computed fields (beyond_deadhead lesson — durable doctrine).
- `beyond_deadhead` is live end-to-end on dev: compute → persist → serialize → client map → render. Commit 6b321afb closed the client-side survivability gap.
- Amber badge is shipped — not just the data path.
- Client field survivability (Pass D) effectively closed by 6b321afb.
- Bars pipeline remains intentionally separate / open architectural fork.

## 1. Topology — "Rideshare Coach" is not one API

The gateway route mount file shows the runtime split clearly:

| Route | Purpose |
|-------|---------|
| `/api/chat` | AI Coach conversation surface |
| `/api/coach` | Coach schema/validation/notes CRUD |
| `/api/memory` | Claude Memory API (internal tooling) |
| `/agent/*` | Separate embedded agent/memory surface |
| `/api/feedback`, `/api/actions` | Adjacent operational logging lanes |

The client API map matches the same split:

- `CHAT.SEND` → `/api/chat`
- `COACH.NOTES*` → `/api/coach/notes...`
- `AGENT.MEMORY.*` → `/agent/memory/...`

## 2. What the user-facing coach actually uses today

`client/src/components/RideshareCoach.tsx` uses two distinct persistence layers simultaneously:

**A. Visible notes panel** — fetches notes from `API_ROUTES.COACH.NOTES_WITH_PARAMS`, supports fetch/pin/delete/edit through `/api/coach/notes` endpoints with optimistic UI.

**B. Conversation logging** — same component imports `useMemory()` and calls `logConversation()` on stream end. That hook does NOT use `/api/memory`; it calls `/agent/memory/conversation` and other `/agent/*` endpoints.

So the live coach UI already proves the split:
- Notes drawer → `/api/coach/notes`
- Conversation memory logging → `/agent/memory/*`

Different stores, different contracts, same component.

## 3. What the chat server actually writes

`server/api/chat/chat.js` makes the split even more explicit.

**A. Chat itself:** `POST /api/chat` is authenticated, resolves the active snapshot, loads full context through `rideshareCoachDAL.getCompleteContext(...)`, saves the user message to `coach_conversations`, streams the model response, parses action tags, executes actions, saves the assistant response.

**B. Action-tag writes** — the chat action executor writes to multiple destinations:

| Action Tag | Destination |
|------------|-------------|
| `SAVE_NOTE` | user notes (coach_notes table) |
| `SYSTEM_NOTE` | system notes |
| `ZONE_INTEL` | zone intelligence |
| `MARKET_INTEL` | market intelligence |
| `SAVE_VENUE_INTEL` | venue catalog |
| `COACH_MEMO` | filesystem append to `docs/coach-inbox.md` |
| `UPDATE_EVENT` / `DEACTIVATE_EVENT` / `ADD_EVENT` | events table |

**The COACH_MEMO path is the observability risk.** Memos go to a markdown file on disk — not the same store as coach notes or agent memory. Useful for handoff, poor for operational query.

**C. Legacy note endpoints still exist inside chat** — `chat.js` still contains `/api/chat/notes` endpoints for save/get/delete behavior, even though the canonical client route map points the notes UI at `/api/coach/notes`. Route-level duplication.

## 4. What `/api/memory` actually is

`server/api/memory/index.js` header explicitly states:
- It's for the `claude_memory` table
- Created for the memory-keeper agent and internal tooling
- No auth middleware
- Not exposed to end users unless hardened

It supports list, stats, rules, session, create, and patch over `claudeMemory`.

**Resolved architecture map:**

- `/api/memory` = internal Claude Code / doctrine memory (this is what memory-log commands use)
- `/agent/memory/*` = agent-memory context / conversation / preference / session / project state
- `/api/coach/notes` = user-visible coach notes
- `coach_conversations` table = message persistence
- `docs/coach-inbox.md` = filesystem memo handoff from AI coach to Claude Code bridge

**That is why "memory" feels fragmented. It is fragmented.**

## 5. Observable gaps

**E-1: User-visible notes, conversation logging, and developer-observable issues are not one surface.** A driver interacts with notes drawer / chat / coach memos / memory logging — those signals land in DB tables, agent endpoints, internal memory API, and a markdown inbox file. Five destinations, one user perception.

**E-2: The client uses `/agent/memory/*`, not `/api/memory`.** The new memory API is not used by the coach UI for its own conversation logging — that still depends on the older agent memory surface.

**E-3: Coach memos are file-based, not queryable.** `COACH_MEMO` appends to `docs/coach-inbox.md`. Useful for handoff, poor for operational query, filtering, alerting, dashboarding.

**E-4: Notes routes have historical overlap.** `/api/coach/notes` is canonical per the route map + client constants, but `chat.js` still exposes `/api/chat/notes`. Even if unused, the duplication makes maintenance harder.

## 6. Rules extracted (E-Rules)

**E Rule 1:** Coach conversation, coach notes, agent memory, Claude Memory, and coach memos are different persistence lanes unless explicitly unified. The codebase treats them as separate concerns.

**E Rule 2:** User-facing coach notes are canonical through `/api/coach/notes`, not `/api/memory`. That's what the client uses.

**E Rule 3:** `/api/memory` is internal tooling memory, not end-user memory. Do not confuse with the user-visible coach memory system.

**E Rule 4:** Filesystem coach memos are a handoff mechanism, not an observability system. Useful, but not a robust monitoring plane.

**E Rule 5:** If the product goal is "issues should be easy to monitor," coach memo writes need a queryable persistence surface, not just a markdown append path. Not yet implemented — a doctrine implication from current architecture.

## 7. Interpretation of current reality

The coach stack is stronger than it used to be: UI coach is real and active, notes CRUD is real, conversations are persisted, memory logging exists, internal doctrine memory exists. But the observability story is split into 5 lanes, which is why the system can "remember things" without making them straightforward to inspect or operationalize.

## 8. Next audit phase (Pass F)

**Pass F — Issue logging / feedback / monitoring survivability audit**

Questions Pass F answers:
- Where does driver-reported pain actually land?
- Are `/api/feedback`, `/api/actions`, coach memos, system notes, and memory overlapping or complementary?
- Which are queryable by operators?
- Which are visible in the UI?
- Which are effectively write-only?

Most valuable next pass because it addresses the exact product pain behind "I have to manually go search for them."

## 9. Related decisions / commits

- DECISIONS.md #16 — Four-hop contract (predecessor doctrine)
- Commit 6b321afb — Pass D closure (client field survivability)
- Follow-up: this session's `SYSTEM_NOTE` bug report from the Rideshare Coach is live test data for Pass F — whether it's queryable will validate or disprove E Rule 4/5.
