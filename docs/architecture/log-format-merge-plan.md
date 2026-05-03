# Log Format Merge Plan — Console Waterfall Refactor

**Status:** PROPOSED — awaiting Melody's per-phase approval
**Created:** 2026-04-28
**Canonical source spec:** `.code_based_rules/.rules_do_not_change/Up to Venue console wish.txt` (Melody's edited target log; lines 1–358 finalized, lines 363–554 are raw unedited reference)
**Sibling doc:** `docs/architecture/LOGGING.md` (existing logging reference)

## Canonical chain template (memory 229)

**`[Parent] [Sub] [CallType…] [CallName] — why-description`**

| Position | Purpose | Examples |
|----------|---------|----------|
| Parent | Top-level workflow stage. **Required.** | BRIEFING, VENUE, STRATEGY, RIDESHARE COACH, BARS, LOCATION, SNAPSHOT |
| Sub | Narrower function within parent. Optional. | TRAFFIC, AIRPORT, NEWS, EVENTS, TTS, PLACES, ROUTES |
| CallType | One or more brackets describing the operation footprint. Stackable. | AI, API, DB |
| CallName | Specific target of the call. | Role for AI: Briefer, Planner, Strategist, AI_COACH_Voice. Table for DB: discovered_events, venue_catalog. Service for API: TomTom, GoogleRoutes, GooglePlaces. |
| Description | Starts with WHY, not WHAT. | "Calling TomTom for traffic and sent to Briefer for consolidation" |

**Canonical example:** `[BRIEFING] [TRAFFIC] [API] [AI] [Briefer] Calling TomTom for traffic and sent to Briefer for consolidation`

This single chain replaces what would otherwise be two emit lines (one for the TomTom API call, one for the AI handoff). The chain encodes the cross-system flow.

## Naming rules (referenced from memory rows)

- **Role-name doctrine (memory 224):** primary stream emits role names not model names.
- **Multi-category stacking (memory 224):** CallTypes stack — `[API] [AI]`, `[DB] [API]`, etc.
- **Coach label rule (memory 225):** **OPTION A LOCKED** — `[RIDESHARE COACH]` everywhere. Concierge stays `[CONCIERGE ASSISTANT]`.
- **Outcome not metrics (memory 226):** response lines describe what was accomplished, not byte/char counts.
- **Coach role split (memory 228):** AI_COACH_Voice (voice streaming) and AI_COACH (text streaming) are distinct CallNames.
- **Lexicon cleanup pending (memory 227):** "Tactical Planner" vs "Planner" vs `VENUE_SCORER` — audit-flagged.

## Implementation note for Phase B

`server/logger/workflow.js` should expose a positional helper:

```js
tagChain({ parent, sub, callTypes = [], callName }) → "[Parent] [Sub] [CallType...] [CallName]"
```

NOT an arbitrary `tags = []` array. The positional template enforces the rule at the API surface.

---

## Objective

Make the primary console stream read as a clean end-to-end waterfall: boot → auth → snapshot release → location resolve → snapshot create+enrich → briefing readiness → strategy → venue cards → workflow complete → coach.

The infrastructure already exists in `server/logger/workflow.js` (env-driven control plane, per-domain loggers, level filters). What's missing is **owner-aware bracket-chain emission** and **adapter-level demotion**.

This is a **cosmetic** refactor. It does NOT fix workflow ordering bugs (those are filed separately as audit memories 210–222). If a phase here would *hide* a bug, we surface the bug via another channel before hiding it.

---

## Target taxonomy (from GPT merged-log + role-name doctrine 2026-04-27)

Bracket chain reads main → sub → operation. AI calls own a parent stage AND emit a role name (not a model name):

| Registry role | Role name (canonical) | Model | Console emission |
|---------------|----------------------|-------|------------------|
| `BRIEFING_AIRPORT` | airport-fetcher | Gemini | `[BRIEFING] [AI] [AIRPORT]` |
| `BRIEFING_NEWS` | news-fetcher | GPT search | `[BRIEFING] [AI] [NEWS]` |
| `BRIEFING_TRAFFIC` | traffic-analyzer | Gemini | `[BRIEFING] [AI] [TRAFFIC]` |
| `BRIEFING_EVENTS` | events-discoverer | Gemini | `[BRIEFING] [AI] [EVENTS]` |
| `STRATEGY_TACTICAL` | **STRATEGIST** | **Claude** | `[STRATEGY] [AI] [STRATEGIST]` |
| `VENUE_SCORER` | **PLANNER** | **GPT-5.5** | `[VENUE] [AI] [PLANNER]` |
| `AI_COACH` | coach-stream | Gemini | `[COACH] [AI] [STREAM]` |

**Role-name doctrine (Melody 2026-04-27, memory row 224):** Primary console stream emits ROLE NAMES only — never model names. Strings like `claude-opus-X`, `gpt-5-search-api`, `gemini-3-flash-preview`, `gemini-3.1-pro-preview` must not appear in INFO-level output. Adapter logs that contain model names get demoted to debug.

**`[AI]` in the bracket chain — acknowledged orphan (Melody 2026-04-27):** `[AI]` appears between the parent stage and the role name. Per memory row 205's "every log line classifiable under a main category" rule, `[AI]` is technically orphan-like (it isn't a sub-category of the parent stage in the strict hierarchical sense). Melody accepts this as an intentional design choice — the visual marker that a line is an AI call adds clarity that outweighs the orphan-rule violation. Chain is `[STAGE] [AI] [ROLE]`.

**Multi-category stacking:** operation categories can stack when a line involves multiple operation types simultaneously. Example: `[BRIEFING] [AI] [API] [DB] message` — a briefing-stage line that involves an AI call, an external API, and a DB write. The leftmost bracket is always the parent stage; remaining brackets describe the operation footprint. The existing log already produces lines like `[BRIEFING] [EVENTS] [AI] [DB] [EVENTS_DISCOVERY] [DEDUP] ...`.

**"Consolidator" label is bug-tier:** there is no Consolidator role. The string appearing in log emit `[STRATEGY] Consolidator: Immediate strategy saved` is either a stale label OR a routing bug (file `server/lib/ai/providers/consolidator.js` is active). Investigate and resolve as part of Phase B.

DB/SSE channels derive parent from channel/endpoint name:
- `briefing_weather_ready` → `[BRIEFING] [WEATHER] [DB] [LISTEN/NOTIFY]`
- `/events/strategy` → `[STRATEGY] [SSE]`

Suppressed from primary stream (debug-only at `LOG_LEVEL=debug`):
- Naked `[AI]` adapter logs (`calling gemini-3.1-pro-preview ...`, `resp: { model: ... }`)
- Per-venue Places search attempts
- Repeated TTS request/byte-count lines
- `[BRIEFING] [EVERYTHING]` (rename to specific stage)
- Boot mounting line spam (collapse to per-domain summaries)
- `Consolidator` label (legacy — replaced by `STRATEGY_TACTICAL` → `[STRATEGY] [AI] [IMMEDIATE]`)
- SmartBlocks/blocks-* emitted text (internal source names stay; emitted text says "VENUE CARDS")

---

## Phase order — Stream A bugs first, Stream B cosmetics last

Sequencing is deliberate. Stream A (workflow ordering bugs in audit rows 210–222) MUST be resolved before final Stream B suppressions, because some Stream A bugs surface only via the lines we'd suppress.

### Phase A — Adapter demotion (this commit)
**Files:** `server/lib/ai/adapters/anthropic-adapter.js`, `gemini-adapter.js`, `openai-adapter.js`, `vertex-adapter.js`
**Change:** Replace `console.log("[AI] ...")` with debug-gated emission so adapter chatter only surfaces at `LOG_LEVEL=debug`.
**Expected delta:** ~30 lines per session removed from primary stream. No behavior change.
**Risk:** Low. If a debugger needs adapter detail, `LOG_LEVEL=debug` restores it.

### Phase B — Caller-owned bracket chains
**Files:** `server/logger/workflow.js` (extend `logAICall` to derive subcategory from role), and ~6 caller sites: `briefing-service.js`, `blocks-fast.js`, `content-blocks.js`, coach service.
**Change:** Each caller already knows its registry role. Extend the logger to format `[STAGE] [AI] [SUBROLE]` from the role argument.
**Risk:** Low. Backward-compatible — adapters' debug lines still exist if needed.

### Phase C — DB/SSE re-homing (memory row 208's TODO)
**Files:** `server/db/db-client.js`, `server/api/strategy/strategy-events.js`
**Change:** Add a `channelOrEndpoint → tagChain` helper. `[DB]` and `[SSE]` move to the right of the parent stage bracket.
**Risk:** Low.

### Phase D — Suppressions and renames
**Files:** Per-venue Places attempts site, TTS chatter site, briefing entry log lines (`[BRIEFING] [EVERYTHING]` → specific stage), boot mount sequence in `server/bootstrap/routes.js`.
**Change:** Demote noise to debug, rename misleading tags.
**Risk:** Low to medium — boot mount collapse needs to keep error visibility.

### Phase E — Doc + memory updates
**Files:** `docs/architecture/LOGGING.md` (add bracket-chain taxonomy section), `claude_memory` (log progress as `status='active'` rows per CLAUDE.md Rule 15; `pending.md` retired 2026-04-29), mark memory row 208 resolved.
**Risk:** None.

---

## Test cases

**T1 (after Phase A):** Run a full briefing/strategy/venue cycle. Diff stdout against the prior-session baseline. Expected: ~30+ adapter `[AI]` lines absent. Stream A bug-emitting lines still present and unchanged.

**T2 (after Phase A):** Set `LOG_LEVEL=debug`, run same cycle. Expected: adapter `[AI]` lines re-appear. Verifies the demotion is reversible for engineering inspection.

**T3 (after Phase B):** Run cycle. Expected: every AI call line in primary stream has a parent-stage bracket (`[BRIEFING]`, `[STRATEGY]`, `[VENUE]`, `[COACH]`). Zero naked `[AI]` lines. "Consolidator" string absent.

**T4 (after Phase C):** Run cycle. Expected: every `[DB]` and `[SSE]` bracket is preceded by a parent-stage bracket (e.g., `[BRIEFING] [WEATHER] [DB] [LISTEN/NOTIFY]`).

**T5 (after Phase D):** Run cycle. Expected: per-venue Places attempts, repeated TTS chatter, `[BRIEFING] [EVERYTHING]` all absent from primary stream. Match Melody's GPT merged-log target line-for-line within timing tolerance.

**T6 (regression check):** Verify all Stream A bug-emitting lines still emit at INFO level, not silenced as part of the cosmetic refactor. (See audit rows 210–222 for the full list.)

**Approval gate per CLAUDE.md Rule 1:** Melody confirms each phase with "All tests passed" or equivalent before next phase begins.

---

## Rollback notes

Each phase is a separate commit. Reverting Phase X is `git revert <sha>` and does not affect later phases. Adapters' raw `console.log` calls in Phase A are demoted, not deleted — `LOG_LEVEL=debug` brings them back without code changes.
