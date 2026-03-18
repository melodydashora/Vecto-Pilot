# AI Coach System: Issues & Findings

**Generated:** 2026-03-18
**Branch:** `claude/analyze-briefings-workflow-Ylu9Q`
**Companion doc:** `ai-coach-deep-dive-analysis.md`

> Per CLAUDE.md Rule 9: ALL findings are HIGH priority. No "low priority" bucket.

---

## Summary

| Severity | Count | Description |
|----------|-------|-------------|
| **CRITICAL** | 4 | Silent write failures, missing capabilities, broken feedback loop |
| **HIGH** | 8 | Validation gaps, null snapshotId, dead UI code, no fallback |
| **MEDIUM** | 8 | Cosmetic leaks, stale docs, inconsistencies |
| **Total** | 20 | |

---

## The Core Problem: "Coach Says It's Noting Issues But Can't"

**Root Cause Analysis:** This is a COMPOUND bug — multiple issues work together to create the illusion of working writes:

1. **The coach generates a response that SAYS "I've noted that"** (streamed to client FIRST)
2. **Actions are parsed AFTER the stream completes** (line 1191)
3. **Actions execute fire-and-forget** (no await, line 1198)
4. **If the write fails, the error only goes to server console** (line 1204)
5. **The client has ZERO feedback** — no confirmation event, no error banner
6. **The notes panel doesn't auto-refresh** — even successful writes are invisible

So the coach confidently tells Melody "I've saved that observation!" but:
- The action tag might not parse correctly (see C-2)
- The validation might reject it silently (see H-1)
- The DAL might return null on DB error (see C-3)
- Even if it succeeds, the notes panel won't show it until manually refreshed (see C-4)

**The user has NO WAY to verify** whether the write actually happened.

---

## CRITICAL Issues (4)

### C-1: Fire-and-forget actions — client never learns outcome

**File:** `server/api/chat/chat.js` ~line 1197-1204
**Impact:** Coach claims to save notes/observations but user can never verify

The `executeActions()` call is non-blocking:
```javascript
executeActions(actions, userId, snapshotId, conversationId)
  .then(result => { console.log(...) })
  .catch(e => console.error(...));
```

The SSE `{ done: true }` event is sent BEFORE actions complete. The client closes the connection. Action results (success or failure) are only logged server-side.

**The AI response text (which may say "I've saved that to your notes") is streamed BEFORE `executeActions` even begins. If the write fails, the user sees a false confirmation.**

**Fix:** After `executeActions` completes, send an additional SSE event:
```javascript
const result = await executeActions(actions, userId, snapshotId, conversationId);
res.write(`data: ${JSON.stringify({ actions_result: result })}\n\n`);
```
Then send `{ done: true }` after. The client can show a confirmation toast or error banner.

---

### C-2: DAL write methods silently return null on failure

**Files:** `server/lib/ai/coach-dal.js` (saveUserNote, saveSystemNote, saveZoneIntelligence, etc.)
**Impact:** Database errors are swallowed — caller doesn't know the write failed

Every DAL write method follows this pattern:
```javascript
} catch (error) {
  console.error('[CoachDAL] saveX error:', error);
  return null;  // ← silent failure
}
```

The `executeActions` function wraps calls in try/catch too, but since the DAL catches and returns null instead of throwing, the `executeActions` catch block never fires. The method just returns null, `results.saved++` is NOT incremented (it only increments after the await succeeds — wait, actually it DOES still increment because `await coachDAL.saveUserNote(...)` resolves to `null`, not throws).

**Actually worse than expected:** Looking at the code again:
```javascript
await coachDAL.saveUserNote({ ... });  // returns null on error
results.saved++;  // ← STILL INCREMENTS even when write failed!
```

The server log says "Executed 1 actions" even when 0 rows were written.

**Fix:** DAL methods should throw on failure instead of returning null. Or `executeActions` should check the return value:
```javascript
const result = await coachDAL.saveUserNote({ ... });
if (!result) { results.errors.push('Note: write returned null'); continue; }
results.saved++;
```

---

### C-3: Missing action types for CLAUDE.md-required tables

**Files:** `server/api/chat/chat.js` (parseActions, executeActions)
**Impact:** Coach cannot write to `venue_catalog` or `market_intelligence` despite CLAUDE.md Rule 8 requirement

CLAUDE.md Rule 8 specifies the AI Coach needs write access to:

| Table | Required by CLAUDE.md | Has Action Tag? | Has DAL Method? |
|-------|----------------------|-----------------|-----------------|
| `venue_catalog` | Yes | **NO** | **NO** |
| `market_intelligence` | Yes | **NO** | Yes (`saveMarketIntelligence`) |
| `user_intel_notes` | Yes | Yes (SAVE_NOTE) | Yes |
| `zone_intelligence` | Yes | Yes (ZONE_INTEL) | Yes |
| `coach_conversations` | Yes | Auto-saved | Yes |
| `coach_system_notes` | Yes | Yes (SYSTEM_NOTE) | Yes |
| `discovered_events` | Yes | Yes (4 action types) | Yes |
| `news_deactivations` | Yes | Yes (DEACTIVATE_NEWS) | Yes |

**Two tables are completely inaccessible to the coach:**

1. **`venue_catalog`** — The DAL has `saveVenueCatalogEntry()` and `addVenueStagingNotes()` but there is NO action tag to reach them from the chat pipeline. The coach cannot contribute driver-reported venue intel (staging spots, GPS dead zones, etc.) as specified in CLAUDE.md Rule 8 use cases.

2. **`market_intelligence`** — The DAL has `saveMarketIntelligence()` but there is NO action tag (`MARKET_INTEL` or similar) in `parseActions()` or `executeActions()`. The method exists but is unreachable from the chat pipeline. (Note: `/api/intelligence` REST endpoints exist but are separate from the coach chat flow.)

**Fix:**
1. Add `SAVE_VENUE_INTEL` action type → wire to existing `coachDAL.saveVenueCatalogEntry()` and `addVenueStagingNotes()`
2. Add `MARKET_INTEL` action type → wire to existing `coachDAL.saveMarketIntelligence()`
3. Add both to parseActions, executeActions, and validate.js
4. Add to system prompt action documentation

---

### C-4: Notes panel never auto-refreshes after coach saves a note

**File:** `client/src/components/AICoach.tsx` ~line 118-122
**Impact:** User can't see newly saved notes without closing and reopening the panel

The notes panel only fetches when:
```javascript
useEffect(() => {
  if (notesOpen && notes.length === 0) {
    fetchNotes();
  }
}, [notesOpen]);
```

This means:
- If the panel is closed → notes won't load until opened
- If the panel is already open with existing notes → **it will NEVER refetch**
- After the coach saves a note via SAVE_NOTE action → the notes panel shows stale data

**Fix:** After the coach response completes, if any SAVE_NOTE actions were detected, call `fetchNotes()`. Or better: after `executeActions` sends a confirmation SSE event, the client refetches.

---

## HIGH Issues (7)

### H-1: Three action types skip Zod validation entirely

**File:** `server/api/chat/chat.js` (executeActions)
**Impact:** Malformed AI-generated JSON goes directly to DAL

| Action Type | Validates? | Risk |
|-------------|-----------|------|
| SAVE_NOTE | Yes | — |
| DEACTIVATE_EVENT | Yes | — |
| ADD_EVENT | Yes | — |
| UPDATE_EVENT | Yes | — |
| COACH_MEMO | Yes | — |
| ZONE_INTEL | Yes | — |
| **REACTIVATE_EVENT** | **No** | Raw data to `coachDAL.reactivateEvent()` |
| **DEACTIVATE_NEWS** | **No** | Raw data to `coachDAL.deactivateNews()` |
| **SYSTEM_NOTE** | **No** | Raw data to `coachDAL.saveSystemNote()` |

The Zod schemas EXIST in `validate.js` for all 3 types, but `executeActions` never calls `validateAction()` for them.

**Fix:** Add validation calls for REACTIVATE_EVENT, DEACTIVATE_NEWS, and SYSTEM_NOTE matching the pattern used by SAVE_NOTE and DEACTIVATE_EVENT.

---

### H-2: Super-user prompt claims capabilities the system can't deliver

**File:** `server/api/chat/chat.js` ~lines 940-1055
**Impact:** Admin user gets frustrated when "full system access" doesn't work

The super-user prompt claims:
- "Shell execution" — **Not implemented.** No action tag for shell commands.
- "File system full read/write" — **Only COACH_MEMO** (append to one file).
- "Database DBA access (DDL)" — **Only action tags.** No raw SQL capability.
- "Network/API integration" — **Only Google Search** grounding.
- "MCP tool access" — **Not implemented.** No MCP integration in chat pipeline.
- "Memory operations (730-day TTL)" — **Only notes.** No separate memory system.

The prompt says "No restrictions. Full transparency. Maximum capability." but the actual execution pipeline is identical to a regular user — same 9 action tags, same DAL methods.

**Fix:** Either implement the claimed capabilities (complex) or reduce the prompt to match reality (recommended). The super-user should get accurate documentation of what they CAN do, not aspirational claims.

---

### H-3: JSON envelope regex captures wrong code block

**File:** `server/api/chat/chat.js` ~line 49
**Impact:** If AI includes a code example before the action envelope, actions are silently lost

```javascript
const jsonEnvelopeMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
```

`String.match()` returns only the FIRST match. If the AI response contains a code example with ` ```json ``` ` before the actual action envelope, the parser tries to parse the example as actions, fails, falls to legacy regex parsing — which may or may not find the actions depending on whether they're in the envelope format.

**Fix:** Try all ` ```json ``` ` blocks, not just the first:
```javascript
const allBlocks = [...responseText.matchAll(/```json\s*([\s\S]*?)\s*```/g)];
for (const block of allBlocks) {
  try { const envelope = JSON.parse(block[1]); if (envelope.actions) { ... } } catch {}
}
```

---

### H-4: Validation error banner exists but is dead code

**File:** `client/src/components/AICoach.tsx` ~lines 87, 194, 657-671
**Impact:** Wasted infrastructure; error visibility was designed but never connected

The client has:
- `validationErrors` state array
- `_handleValidationErrors` callback (prefixed with `_` = unused)
- Red `AlertCircle` banner UI

But `_handleValidationErrors` is never called from any code path. The banner never displays.

**Fix:** Wire this to the action confirmation SSE event (once C-1 is fixed). Display errors when `executeActions` reports failures.

---

### H-5: `results.saved++` counts null returns as success

**File:** `server/api/chat/chat.js` (executeActions)
**Impact:** Server logs report successful saves that actually failed

For `SYSTEM_NOTE` (lines 276-293):
```javascript
await coachDAL.saveSystemNote({ ... });  // returns null on DB error
results.saved++;                          // ← still increments!
```

The DAL catches errors and returns null. `executeActions` awaits the null (no throw), then increments `saved`. The server log says "Executed 1 actions" even when 0 rows were written.

This affects: SYSTEM_NOTE, REACTIVATE_EVENT, DEACTIVATE_NEWS (all skip validation AND don't check return values).

**Fix:** Check return value before incrementing:
```javascript
const result = await coachDAL.saveSystemNote({ ... });
if (result) results.saved++;
else results.errors.push('SystemNote: write returned null');
```

---

### H-6: `activeSnapshotId` null when client sends only `strategyId`

**File:** `server/api/chat/chat.js` ~line 699
**Impact:** ADD_EVENT actions fail silently with "Cannot determine city/state"

The variable `activeSnapshotId` is set as `snapshotId || null` (line 699). If the client sends only `strategyId` (not `snapshotId`), then `activeSnapshotId` is null. The ADD_EVENT handler (line 315) tries `coachDAL.getHeaderSnapshot(null)` which returns null, causing the city/state lookup to fail. The action is skipped with an error pushed to `results.errors` — but per C-1, the client never sees this error.

**Fix:** Resolve `snapshotId` from `strategyId` via `coachDAL.resolveStrategyToSnapshot()` before entering the action execution path. The DAL method already exists for this.

---

### H-7: No streaming fallback — Gemini outage kills the coach entirely (renumbered)

**File:** `server/lib/ai/model-registry.js`, `server/api/chat/chat.js`
**Impact:** If Gemini is down, the coach returns an error with no alternative

The AI_COACH role uses `callModelStream()` which only supports Gemini. There is no fallback to Claude or OpenAI streaming. Unlike the briefing pipeline which has fallback chains, the coach has a single point of failure.

**Fix:** Add streaming support for at least one fallback provider (Claude or OpenAI) in the chat pipeline.

---

### H-8: Conversation messages saved without error feedback

**File:** `server/api/chat/chat.js` ~lines 719-742, 1207-1240
**Impact:** If conversation persistence fails, the coach loses memory

Both user and assistant message saves are fire-and-forget with try/catch:
```javascript
try {
  await coachDAL.saveConversationMessage({ ... });
} catch (e) {
  console.warn('[chat] Failed to save message:', e.message);
}
```

If the DB is under load or the conversation table has issues, messages are silently lost. The coach's cross-session memory degrades without anyone noticing.

**Fix:** At minimum, track consecutive save failures and alert. Consider making user message save blocking (it's fast) so the user gets feedback.

---

## MEDIUM Issues (8)

### M-1: Orphan `]` brackets leak into cleaned response text

**File:** `server/api/chat/chat.js` (extractBalancedJson)
**Impact:** Cosmetic — user may see stray `]` characters in coach responses

When the AI generates `[SAVE_NOTE: {"title":"x"}  some text]`, the regex for trailing `]` requires it immediately after `}` (with only whitespace). If there's content between, the `]` remains in `cleanedText`.

**Fix:** Expand the closing bracket search to handle any content between `}` and `]`.

---

### M-2: `String.replace()` only removes first occurrence of action tag

**File:** `server/api/chat/chat.js` ~line 107
**Impact:** Duplicate action tags in response leave orphan text visible to user

If the AI generates the exact same action tag twice, both are parsed and executed, but `cleanedText.replace()` only removes the first occurrence. The second tag's text remains visible.

**Fix:** Use `cleanedText.replaceAll()` or regex with global flag.

---

### M-3: `extractBalancedJson` silently drops actions with unclosed braces

**File:** `server/api/chat/chat.js` ~line 170
**Impact:** Malformed JSON from AI is silently lost — no error, no log

When the AI generates `[SYSTEM_NOTE: {"type":"pain_point"` (missing `}`), `extractBalancedJson` returns `{ json: null }`. The caller silently skips it — no console.warn, no error tracking.

**Fix:** Add `console.warn` when `extractBalancedJson` returns null for a known action prefix.

---

### M-4: `saveSystemNote` dedup may miss similar notes with different titles

**File:** `server/lib/ai/coach-dal.js` ~lines 1552-1573
**Impact:** Duplicate system notes for the same issue with slightly different AI-generated titles

Dedup is by exact `title + category` match. If the AI generates:
- "GPS signal issues in parking garages"
- "Parking garage GPS dead zones"

Both are inserted as separate notes for the same underlying issue.

**Fix:** Consider fuzzy matching or include `description` hash in dedup.

---

### M-5: Schema metadata lists writable tables that don't match reality

**File:** `server/api/coach/schema.js` ~lines 87-147
**Impact:** Schema endpoint reports 5 writable tables, but `venue_catalog` and `market_intelligence` are documented as readable-only despite CLAUDE.md requiring write access

The schema endpoint's `writableTables` list shows: user_intel_notes, discovered_events, zone_intelligence, coach_system_notes, news_deactivations. This matches the actual action tags. But it doesn't include `venue_catalog` or `market_intelligence` which CLAUDE.md Rule 8 requires.

**Fix:** Update schema endpoint after implementing C-3 (adding missing action types).

---

### M-6: Notes panel `fetchNotes` has no loading state during CRUD operations

**File:** `client/src/components/AICoach.tsx`
**Impact:** User sees stale notes during async operations

Delete, pin, and edit operations use optimistic UI with rollback on error, but there's no loading indicator during the API call. If the network is slow, the user doesn't know the operation is in progress.

**Fix:** Add per-note loading states for CRUD operations.

---

### M-7: `extractAndSaveTips` runs after every response

**File:** `server/api/chat/chat.js` ~line 1211
**Impact:** Potential duplicate notes if tips are also saved via SAVE_NOTE action

After every assistant response, `extractAndSaveTips()` automatically scans the response text and saves extracted tips as notes. But if the AI also generated a `[SAVE_NOTE]` action for the same tip, it could create duplicates.

**Fix:** Skip `extractAndSaveTips` if SAVE_NOTE actions were already parsed for this response.

---

### M-8: Documentation says AI Coach has "shell execution" but no implementation exists

**File:** `docs/architecture/ai-coach.md`
**Impact:** Developer confusion — architecture doc doesn't match actual capabilities

The existing architecture doc lists capabilities from the super-user prompt without noting they're aspirational. New developers may try to build on top of claimed but non-existent features.

**Fix:** Update architecture doc to clearly distinguish "implemented" from "declared in prompt but not yet implemented."

---

## Missing Capability Inventory

Per CLAUDE.md Rule 8, the AI Coach needs write access to these tables. Current status:

| Table | CLAUDE.md Requires | Action Tag Exists | DAL Method Exists | Status |
|-------|-------------------|-------------------|-------------------|--------|
| `venue_catalog` | Yes | No | Yes (`saveVenueCatalogEntry`, `addVenueStagingNotes`) | **BROKEN** — DAL exists but no action tag to reach it |
| `market_intelligence` | Yes | No | Yes (`saveMarketIntelligence`) | **BROKEN** — DAL exists but no action tag to reach it |
| `user_intel_notes` | Yes | SAVE_NOTE | Yes | Working |
| `zone_intelligence` | Yes | ZONE_INTEL | Yes | Working |
| `coach_conversations` | Yes | Auto-saved | Yes | Working |
| `coach_system_notes` | Yes | SYSTEM_NOTE | Yes | Working (no validation) |
| `discovered_events` | Yes | 4 action types | Yes | Working |
| `news_deactivations` | Yes | DEACTIVATE_NEWS | Yes | Working (no validation) |

---

## Dead Code Inventory

| Item | File | Notes |
|------|------|-------|
| `_handleValidationErrors` callback | AICoach.tsx ~line 194 | Prefixed `_`, never called |
| `validationErrors` state + banner UI | AICoach.tsx ~lines 87, 657-671 | Wired but no code path triggers it |
| `consolidateNewsItems` reference | briefing-service.js | Jaccard dedup — never called |

---

## Recommended Fix Priority

### Immediate (the "coach can't actually note things" fix)
1. **C-2:** Fix DAL methods to throw on failure (or check return values in executeActions)
2. **H-5:** Fix `results.saved++` counting null returns as success
3. **H-1:** Add validation for REACTIVATE_EVENT, DEACTIVATE_NEWS, SYSTEM_NOTE
4. **M-3:** Add logging when extractBalancedJson returns null

### Short-term (user-visible feedback)
5. **C-1:** Send action confirmation SSE event to client
6. **C-4:** Auto-refresh notes panel after SAVE_NOTE actions
7. **H-4:** Wire validation error banner to action results

### Medium-term (missing capabilities)
8. **C-3:** Add MARKET_INTEL and SAVE_VENUE_INTEL action types
9. **H-2:** Reduce super-user prompt to match actual capabilities
10. **M-5:** Update schema metadata endpoint

### Short-term (action reliability)
11. **H-6:** Resolve snapshotId from strategyId before action execution

### Long-term (reliability)
12. **H-7:** Add streaming fallback provider
13. **H-8:** Track conversation save failures
13. **M-4:** Improve system note deduplication
14. **M-7:** Prevent duplicate notes from extractAndSaveTips + SAVE_NOTE
