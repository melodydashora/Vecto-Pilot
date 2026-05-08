# MASTER_COACH_PIPELINE.md — Coach Master Pipeline (Verified Ground-Truth Map)

**File:** `.code_based_rules/code_to_requirements/Pipeline_Updated/Master Pipeline/MASTER_COACH_PIPELINE.md`
**Author:** Claude (drafted at Melody's direction)
**Date written:** 2026-05-04
**Working tree branch when audited:** `feat/coach-handsfree-2026-05-04` @ `acedd54f` (merged to main as `61a2d417`, branch deleted)
**Doctrine:** This document is a **map**, not a refactor. It records *where every Coach function and call lives in the repo today*, what is done, what is open, and what new options Melody has not yet decided on. It never says "delete this" or "move this" without flagging it as a Melody-decision pending. Per Rule 16 (Melody is the Architect), no architectural change in this document is committed; everything that would alter behavior is presented as **options to choose**.

**Anti-junk rule:** When a TODO is implemented, mark it `DONE → file:line` in §8 or §9. Do **not** delete the row. Do **not** remove file references that were superseded. The point of this document is to show *what currently exists in the repo* so that next session does not "leave junk behind" by losing track of where functions used to live.

---

## 0. How to Read This Document

| Symbol | Meaning |
|---|---|
| ✅ DONE | Implemented, current location given as `file:line` |
| 🟡 OPEN | Not implemented; current location is "where it would land" |
| ⚠️ DRIFT | Doc and code disagree; both locations given |
| 💀 DEAD | Code exists but is not imported by any live path |
| ❓ DECIDE | Melody must choose an option before implementation can begin |

**Status semantics:**
- `DONE` rows still keep their file path so future sessions know where the function lives, even after refactor.
- `OPEN` rows have the proposed file path so when implementation lands, you update status to DONE and keep the same row.
- `DECIDE` rows enumerate options A/B/C/D and never recommend one.

---

## 1. Branch Model — Three Layers

This Coach pipeline is **not on one branch.** Three branch layers contribute to it. Reading any single branch as "the Coach pipeline" misses dependencies.

| Layer | Branch / Ref | PR | Status | What lives here |
|---|---|---:|---|---|
| L1 — Frozen historical baseline | `main` @ `274cadc5c96fb4244c81c711951c1b43cb981fd5` | n/a | historical | Baseline state of `chat.js`, `rideshare-coach-dal.js`, `validate.js`, etc. before the hook refactor. Audited in `coach_finalizing/coach_full_pipeline.md`. **Not current main** — line anchors there are stale. |
| L2 — Hook architecture | `coach-pass2-phase-b` (deleted after merge) | #18, #19 | merged | Introduced `useCoachChat`, `useCoachAudioState`, `useStreamingReadAloud`, `cleanTextForTTS.ts`, `sentenceBoundary.ts`, `featureFlags.ts`. PR #18 was the runtime refactor; PR #19 was docs/spec follow-up. |
| L3 — Hands-free driver-safety | `feat/coach-handsfree-2026-05-04` (deleted post-merge; canonical state on main) | #31 | ✅ merged (2026-05-04 via `61a2d417`) | COACH-V1: auto-listen on tab mount, voice stop phrases, three-state `CoachStopBar`, hard-cancel TTS, paragraph-comma TTS cleanup, TTS-persists-on-tab-leave. |

**Verification:**
- Both PR #18 and PR #19 merge commits exist in `git log` (`e0d79ad6`, `bfbbb18d`).
- L3 is 5 commits ahead of `main` (`f370a7d4 → cf482adc → e57b4673 → 54e0ea0d → acedd54f`).
- Branch `coach-pass2-phase-b` does **not** appear in `git branch -a` — it was deleted after merge. Use the merge commits as the authoritative reference, not a branch checkout.

---

## 2. Current Ground-Truth File Map (HEAD verified)

Every Coach file. Live line counts at `feat/coach-handsfree-2026-05-04` HEAD. **Bytes verified 2026-05-04.**

### 2.1 Client (browser) — 8 files, 1,624 lines

| File | Lines | Mounted/used by | Status |
|---|---:|---|---|
| `client/src/pages/co-pilot/CoachPage.tsx` | 33 | Route entrypoint at `/co-pilot/coach` | ✅ |
| `client/src/components/RideshareCoach.tsx` | 855 | Imported by `CoachPage.tsx` | ✅ |
| `client/src/components/coach/CoachStopBar.tsx` | 113 | Imported by `RideshareCoach.tsx:10` | ✅ NEW (PR #31) |
| `client/src/hooks/coach/useCoachChat.ts` | 309 | Imported by `RideshareCoach.tsx:6` | ✅ NEW (PR #18) |
| `client/src/hooks/coach/useCoachAudioState.ts` | 132 | Imported by `RideshareCoach.tsx:7` | ✅ NEW (PR #18) |
| `client/src/hooks/coach/useStreamingReadAloud.ts` | 116 | Imported by `RideshareCoach.tsx:8` | ✅ NEW (PR #18) |
| `client/src/utils/coach/cleanTextForTTS.ts` | 24 | Imported by `RideshareCoach.tsx:9` and `useStreamingReadAloud.ts:12` | ✅ Modified (PR #31) |
| `client/src/utils/coach/sentenceBoundary.ts` | 88 | Imported by `useStreamingReadAloud.ts:11` | ✅ NEW (PR #18) |
| `client/src/constants/storageKeys.ts` | 72 | Coach keys at lines 36, 37, 41, 46 | ✅ Modified (PR #31) |
| `client/src/constants/featureFlags.ts` | (~50) | `COACH_STREAMING_TTS_ENABLED` flag | ✅ NEW (PR #18) |

### 2.2 Server (Node) — Live path

| File | Lines | Mount/import path | Status |
|---|---:|---|---|
| `server/api/chat/chat.js` | 1,579 | Mounted at `/api/chat` (`bootstrap/routes.js:57`) | ✅ live |
| `server/lib/ai/rideshare-coach-dal.js` | 2,593 | Imported by `chat.js:12` and notes route | ✅ live |
| `server/api/rideshare-coach/index.js` | 21 | Mounted at `/api/coach` (`bootstrap/routes.js:63`) | ✅ live |
| `server/api/rideshare-coach/notes.js` | 448 | Sub-router under `/api/coach/notes` | ✅ live |
| `server/api/rideshare-coach/schema.js` | 261 | Sub-router under `/api/coach/schema` | ✅ live |
| `server/api/rideshare-coach/validate.js` | 423 | Sub-router under `/api/coach/validate` + `validateAction()` named export | ✅ live |
| `server/api/chat/realtime.js` | (~200) | Mounted at `/api/realtime` (`bootstrap/routes.js:59`) | ✅ live (OpenAI Realtime endpoint) |
| `server/api/chat/tts.js` | (~50) | Mounted at `/api/tts` (`bootstrap/routes.js:58`) | ✅ live |
| `server/api/chat/chat-context.js` | (~80) | Imported as needed | ✅ live |

### 2.3 Server — DEAD parallel folder ⚠️

| File | Lines | Importers | Status |
|---|---:|---|---|
| `server/api/coach/index.js` | 21 | **None** — byte-identical to live `rideshare-coach/index.js` | ✅ DELETED 2026-05-04 (was 💀 DEAD) |
| `server/api/coach/notes.js` | 448 | **None** — diverged from live (older log prefixes `[CoachNotes]` vs `[COACH] [NOTES]`) | ✅ DELETED 2026-05-04 (was 💀 DEAD) |
| `server/api/coach/validate.js` | 338 | **None** — **stale fork**, missing `addEventSchema`, `updateEventSchema`, `marketIntelSchema`, `venueIntelSchema` (added 2026-02-17 / 2026-03-18) | ✅ DELETED 2026-05-04 (was 💀 DEAD) |
| `server/api/coach/schema.js` | 227 | **None** — **stale fork**, missing `offer_intelligence`, `market_intelligence`, `venue_catalog` writable sections | ✅ DELETED 2026-05-04 (was 💀 DEAD) |

**Verification:** `grep -rn "from ['\"]\.\./.*api/coach\b"` against `server/`, `client/`, `shared/` returned zero non-self importers (verified 2026-05-04 before deletion). `bootstrap/routes.js:61` mentioned `server/api/coach/` only in a **comment** — the actual mounted module on line 63 is `./server/api/rideshare-coach/index.js`. Total dead code: **1,034 lines** across 4 files in `/server/api/coach/`.

✅ **RESOLVED 2026-05-04 — folder deleted at Melody's instruction.** `bootstrap/routes.js:61-65` comment corrected to point at `rideshare-coach/` and to log the cleanup inline. Rows above are preserved per anti-junk doctrine (§15 clause 1) so future sessions can see what was removed and why. See §13 for the original options enumeration and the decision record.

---

## 3. Live vs Dead Inventory — Detailed Diff

These are not "old copies of the same files." They are **divergent stale forks** missing months of additions.

### 3.1 `validate.js` divergence

| Item | Live (`rideshare-coach/`) | Dead (`coach/`) |
|---|---|---|
| `noteSchema` | L29-L41 | L26-L38 ✓ |
| `eventDeactivationSchema` (with `z.preprocess` reason normalization) | L46-L56 | L43-L51 — **missing preprocess** |
| `eventReactivationSchema` | L61-L66 | L56-L61 ✓ |
| `zoneIntelSchema` | L71-L82 | L66-L77 ✓ |
| `systemNoteSchema` | L87-L98 | L82-L93 ✓ |
| `newsDeactivationSchema` | L103-L107 | L98-L102 ✓ |
| `addEventSchema` (2026-02-17) | L113-L123 | **MISSING** |
| `updateEventSchema` (2026-02-17) | L129-L140 | **MISSING** |
| `rideshareCoachMemoSchema` | L146-L154 | **MISSING** |
| `marketIntelSchema` (2026-03-18) | L157-L168 | **MISSING** |
| `venueIntelSchema` (2026-03-18) | L171-L181 | **MISSING** |
| `ACTION_SCHEMAS` registry | L184-L196 (11 entries) | (~5 entries — dead-code state) |

### 3.2 `schema.js` divergence

| Item | Live (`rideshare-coach/`) | Dead (`coach/`) |
|---|---|---|
| Export name | `rideshareCoachSchemaMetadata` | `coachSchemaMetadata` |
| `offer_intelligence` readable section | present | **MISSING** |
| `market_intelligence` writable section | present | **MISSING** |
| `venue_catalog` writable section | present | **MISSING** |

### 3.3 `notes.js` divergence

Diff is log-prefix only (`[CoachNotes]` vs `[COACH] [NOTES]`). Same logic. Still dead — nothing imports it.

---

## 4. Canonical Coach Pipeline E2E (current main + PR #31)

```text
Driver navigates to /co-pilot/coach
  └─ CoachPage.tsx:14 mounts <RideshareCoach />
      └─ RideshareCoach.tsx:79 component mounts
          ├─ useCoachAudioState() :91         (TTS, STT, read-aloud toggle, playback speed)
          ├─ useStreamingReadAloud() :121     (sentence-boundary chunked TTS)
          ├─ useCoachChat() :194              (SSE chat lifecycle, persistence, attachments)
          ├─ Auto-listen mount effect :216    (best-effort getUserMedia → startMic('en'))
          └─ <CoachStopBar /> :461            (three-state safety bar)

User speaks or types
  └─ handleSubmit() :441 OR voice-submit-phrase :377 OR mic-tap :335
      └─ useCoachChat.send() :149
          └─ POST /api/chat (SSE) :168
              ↓
SERVER:
  /api/chat
    ├─ requireAuth :704
    ├─ timezone validation :725
    ├─ snapshot resolution :763-794
    │     ├─ UI snapshotId (priority)
    │     ├─ resolveStrategyToSnapshot() (DAL :51)
    │     └─ latest snapshot for authenticated user
    ├─ rideshareCoachDAL.getCompleteContext() :800   (DAL :769)
    │     └─ Promise.all of 7 + 4 parallel reads (see §5)
    ├─ rideshareCoachDAL.formatContextForPrompt() :801  (DAL :887, ~358 lines)
    ├─ saveConversationMessage(role='user') :873     (DAL :1380, fire-and-forget — see COACH-H8)
    ├─ Build systemPrompt :898-1155
    ├─ Build messageHistory + Gemini multimodal parts :1170-1226
    ├─ callModelStream('AI_COACH', { system, messageHistory, signal }) :1245
    │     ├─ AbortController on req.close :1242    ✅ (good — cancels Gemini)
    │     └─ adapter dispatcher → Gemini REST API
    ├─ SSE streaming loop :1264-1300
    │     └─ res.write(`data: { delta }`) per chunk
    ├─ parseActions(totalText) :1309               (chat.js :33-127, JSON envelope + regex fallback)
    ├─ executeActions(...) :1318                   (chat.js :187, awaited per FIX C-1)
    │     └─ each action validated via validateAction() (validate.js :403)
    ├─ saveConversationMessage(role='assistant') :1342  (DAL :1380, fire-and-forget — see COACH-H8)
    └─ res.write(`data: { done: true, conversation_id, actions_result }`) :1374
              ↓
CLIENT receives SSE:
  └─ useCoachChat reader loop :217-266
      ├─ msg.delta → onStreamDelta() → handleStreamDelta() :174 → streaming.pushDelta() (if flag on)
      ├─ msg.actions_result.errors → setValidationErrors() :253-258
      └─ msg.done → onStreamComplete() → handleStreamComplete() :156
            └─ if read-aloud OR voice-sent: streaming.flush() OR speak(fullText)

While TTS is speaking:
  ├─ STOP_REPLYING_REGEX detected :407 → handleStopAllAudio() :367
  ├─ CoachStopBar red state tap → handleStopAllAudio() :367
  └─ TTS naturally ends → useEffect :425 clears transcript + auto-resumes mic

If driver leaves Coach tab:
  └─ unmount cleanup :247 → stopMic() ONLY; TTS intentionally persists
```

---

## 5. DAL Function Map — All 36 Methods, Verified Line Numbers

`server/lib/ai/rideshare-coach-dal.js`. Class declared at L45, singleton exported at L2593.

| Method | Line | Purpose |
|---|---:|---|
| `resolveStrategyToSnapshot(strategyId)` | 51 | Strategy → snapshot/user/session resolver |
| `getHeaderSnapshot(snapshotId)` | 91 | Snapshot location/time/weather/air |
| `getLatestStrategy(snapshotId)` | 170 | Latest strategy for snapshot |
| `getComprehensiveBriefing(snapshotId)` | 227 | Full briefing (events, traffic, news, closures, weather, airport) |
| `getFeedback(snapshotId)` | 268 | Venue + strategy feedback |
| `getVenueData(snapshotId)` | 294 | Ranking candidates + venue catalog rows |
| `getActions(snapshotId)` | 332 | Driver action / dwell data |
| `getBriefing(snapshotId)` | 353 | ⚠️ Duplicate-read risk — overlaps with `getComprehensiveBriefing` |
| `getSmartBlocks(snapshotId)` | 392 | Top Smart Blocks for prompt |
| `getMarketIntelligence(city, state)` | 460 | Market position + research-backed intel |
| `getUserNotes(userId, limit)` | 553 | Active user_intel_notes (pinned > importance > created) |
| `saveUserNote(noteData)` | 587 | Insert into `user_intel_notes` |
| `incrementNoteReference(noteId)` | 641 | Bump reference counter |
| `getDriverProfile(userId)` | 660 | Driver profile + primary vehicle |
| **`getCompleteContext(snapshotId, strategyId, authenticatedUserId)`** | **769** | **Parallel context aggregator** — see §5.1 |
| `_determineStatus(...)` | 873 | Returns `missing_snapshot` / `pending_strategy` / `pending_blocks` / `ready` |
| **`formatContextForPrompt(context)`** | **887** | **Builds the ~358-line system prompt** — see §6 |
| `getOfferHistory(limit)` | 1246 | Last N offer_intelligence rows |
| `getSnapshotHistory(userId, limit, since)` | 1317 | User's recent snapshots |
| `saveConversationMessage(messageData)` | 1380 | Insert into `coach_conversations` (currently fire-and-forget — COACH-H8) |
| `getConversationHistory(userId, conversationId, limit)` | 1443 | Thread history reader |
| `getConversations(userId, limit)` | 1473 | List conversations |
| `toggleMessageStar(messageId, starred)` | 1507 | Star/unstar a message |
| `saveSystemNote(noteData)` | 1528 | Insert into `coach_system_notes` |
| `getSystemNotes(status, limit)` | 1605 | List system notes |
| `deactivateNews(deactivationData)` | 1660 | Hide a news item per-user |
| `getDeactivatedNewsHashes(userId)` | 1719 | List deactivated news |
| `deactivateEvent(deactivationData)` | 1747 | Mark event inactive |
| `reactivateEvent(reactivationData)` | 1846 | Re-activate an event |
| `addEvent(eventData)` | 1946 | Driver-reported event creation (uses Event Catalog validation) |
| `updateEvent(updateData)` | 2028 | Driver-corrected event details |
| `saveMarketIntelligence(intelData)` | 2105 | Insert into `market_intelligence` |
| `saveVenueCatalogEntry(venueData)` | 2173 | Insert into `venue_catalog` |
| `addVenueStagingNotes(placeId, stagingNotes)` | 2282 | Append to existing venue catalog row |
| `extractAndSaveTips(userId, content, ctx)` | 2319 | Auto-extract tips from response (skipped if SAVE_NOTE actions present) |
| `generateMarketSlug(city, state)` | 2373 | `dallas-tx` style slug |
| `saveZoneIntelligence(zoneData)` | 2398 | Insert into `zone_intelligence` |
| `getZoneIntelligence(marketSlug, options)` | 2517 | Read zone intel rows |
| `getZoneIntelligenceSummary(marketSlug)` | 2551 | Compact summary string for prompt injection |

### 5.1 `getCompleteContext` parallel batches (DAL L769-867)

```text
Batch 1 (Promise.all, 7 parallel reads):
  [snapshot, strategy, briefing, smartBlocks, feedback, venueData, driverActions]

Batch 2 (depends on snapshot, Promise.all, 4 parallel reads):
  [marketIntelligence, userNotes, driverData, offerData]
```

**Total inside the DAL: 11 context sources.** The route adds 2 more outside the aggregator: `snapshotHistory` (`chat.js:812`) and `zoneIntelligenceSummary` (`chat.js:835`). **Per-turn end-to-end: 13 context sources.**

---

## 6. `formatContextForPrompt` Token-Shape Audit

Function at `rideshare-coach-dal.js:887`. Approximate length **~358 lines** (runs to start of `getOfferHistory` at L1246). Builds the entire context-injection string passed as the system prompt.

**This is the largest contributor to per-turn token cost.** Section sizes are estimates (sampled, not measured per-section).

| Prompt section | DAL line range (approx) | Volatility | Token risk |
|---|---|---|---|
| Driver profile | ~930-1010 | low (per-driver, stable) | small |
| Vehicle info | ~1010-1025 | low | small |
| Snapshot/location/time/weather/air | ~1025-1065 | per-turn (fresh snapshot) | small |
| Strategy text + status | ~1065-1100 | per-turn | medium |
| Briefing (traffic, weather, news, events, closures, airport) | ~1100-1160 | per-turn (newest data) | **large** |
| Smart Blocks (top venues with details) | ~1160-1210 | per-turn | **large** |
| Feedback + actions | ~1210-1250 | per-session | medium |
| Market intelligence (research items) | ~1250-1280 | mostly stable | medium |
| User notes (Coach memory) | ~1280-1300 | grows over time | **growing** |

**Plus:** in `chat.js`, the system prompt also includes:
- The full identity/capabilities preamble (`chat.js:898-988`, ~90 lines)
- All action-tag instructions (`chat.js:996-1090`, ~95 lines)
- Critical rules + super-user context (`chat.js:1100-1155`, ~55 lines)
- Snapshot history (last 5 sessions, `chat.js:817-822`)
- Zone intelligence summary (`chat.js:837`, only when present)
- Full thread history (`chat.js:1215-1226` — every prior turn re-sent)

**Concrete observation:** every Coach turn re-sends the full system prompt + full thread history. There is **no token estimation, no trimming, no summarization**. See §11 for the token-budget options.

---

## 7. Doc-vs-Code Drift Table

`docs/architecture/RIDESHARE_COACH.md` is the canonical doc. It is stale on multiple verifiable claims.

| Claim in `RIDESHARE_COACH.md` | Doc line | Actual on `feat/coach-handsfree-2026-05-04` HEAD | Status |
|---|---:|---|---|
| `RideshareCoach.tsx` ~1000 lines (was 885; +122 for COACH-V1) | 270 | 855 lines | ⚠️ DRIFT |
| `CoachStopBar.tsx` 50 lines | 271 | 113 lines | ⚠️ DRIFT |
| `chat.js` 1,572 lines | 276 | 1,579 lines | ⚠️ DRIFT (minor) |
| `rideshare-coach-dal.js` 2,575 lines | 277 | 2,593 lines | ⚠️ DRIFT (minor) |
| `validate.js` 423 lines | 278 | 423 lines | ✅ matches |
| `notes.js` 448 lines | 279 | 448 lines | ✅ matches |
| `schema.js` 261 lines | 280 | 261 lines | ✅ matches |
| §9.5: "Always rendered; disabled (greyed) when `!isSpeaking`. High-contrast red when active." | 236 | **Three-state** bar (red SPEAKING / blue LISTENING / green IDLE), never disabled | ⚠️ **CONTRADICTION** — doc describes 2-state, code is 3-state |
| §9.2: phrase set listed as `"stop and output"` and `"stop replying"` only | 220-224 | **8 phrases** in `STOP_AND_OUTPUT_REGEX` and **8 phrases** in `STOP_REPLYING_REGEX` (`RideshareCoach.tsx:28-30`) | ⚠️ DRIFT — doc lists 2 phrases, code has 16 |
| §9.1 lifecycle: "Tab leave (component unmount) = listening stops via cleanup." | 198 | Code stops mic only; **TTS intentionally persists** across tab leave (`RideshareCoach.tsx:238-251`, with inline rationale from Melody's in-vehicle test) | ⚠️ CONTRADICTION |
| §9.3 says feedback-loop guard is `!isSpeaking` gate only | 226-228 | Same gate present (`RideshareCoach.tsx:382`), but **no AEC, no VAD, no mic-mute-during-TTS** — guard is an output-suppression filter, not a feedback eliminator | OK + caveat (echo risk — see §9) |
| §9.7 storage key `vectopilot_coach_auto_listen` | 251 | `vectopilot_coach_auto_listen` (`storageKeys.ts:46`) | ✅ matches |
| §1: "callModelStream('AI_COACH')" | 37 | Verified at `chat.js:1245` ✅ | ✅ matches |

❓ DECIDE — §15.

---

## 8. COACH-V1 Done Matrix (PR #31)

Every COACH-V1 item from the corrected TODO §1, mapped to current code locations. **Status = ✅ for all** — these are the items the branch was authored to ship.

| Item | File:Line | Notes |
|---|---|---|
| Auto-activate microphone on Coach tab open (best-effort) | `RideshareCoach.tsx:216-256` | `getUserMedia` preflight then `startMic('en')`; cancellation flag handles unmount race |
| Auto-listen default ON, opt-out via `localStorage[COACH_AUTO_LISTEN_ENABLED] = 'false'` | `RideshareCoach.tsx:217-219`; `storageKeys.ts:46` | Absent key = ON |
| Submit/stop-mic phrase grammar (8 variants) | `RideshareCoach.tsx:28` (regex) + `:377-401` (effect) | Phrases: `stop and output`, `i'm done`, `i am done`, `i've completed my thoughts`, `this feature is complete`, `go ahead`, `send it`, `that's all` |
| Interrupt-TTS phrase grammar (8 variants) | `RideshareCoach.tsx:30` (regex) + `:407-420` (effect) | Phrases: `stop replying`, `stop and listen`, `stop talking`, `be quiet`, `hold on`, `pause`, `i'm done`, `i am done` |
| Once-per-session phrase guards | `RideshareCoach.tsx:114-115` (refs), reset at `:379` and `:409` | Prevents transcript-tick re-fires |
| Feedback-loop guard | `RideshareCoach.tsx:382` (`if (isSpeaking) return`) | Suppresses submit-phrase during TTS |
| Auto-resume mic on TTS end | `RideshareCoach.tsx:425-436` | `wasSpeakingRef` tracks transition; clears transcript before resuming |
| Three-state CoachStopBar (priority: speaking > listening > idle) | `CoachStopBar.tsx:42-110` | 80px (`h-20`); `data-state` attr exposes state for tests |
| Hard-cancel both audio paths | `RideshareCoach.tsx:367-370` (`handleStopAllAudio`) | Calls both `streaming.abort()` and `stopSpeak()` |
| TTS paragraph-comma cleanup | `cleanTextForTTS.ts:21` | `\n{2,}` → `, ` (was `. `) |
| TTS persists across tab leave | `RideshareCoach.tsx:247-251` | Inline comment cites Melody's 2026-05-04 in-vehicle feedback |
| Centralized storage key for auto-listen | `storageKeys.ts:46` | `COACH_AUTO_LISTEN_ENABLED: 'vectopilot_coach_auto_listen'` |
| Speed selector visible only when read-aloud is on | `RideshareCoach.tsx:494-523` | 1.0×/1.25×/1.5×/2.0× chips |

**PR #31 also did NOT change:**

| System | Confirmed unchanged |
|---|---|
| Server `/api/chat` route | ✅ |
| `AI_COACH` model registry config | ✅ |
| `rideshare-coach-dal.js` context loading | ✅ |
| Action-tag parsing/execution | ✅ |
| Zod validation schemas | ✅ |
| Notes API duplication (`/api/chat/notes` vs `/api/coach/notes`) | ✅ unchanged → see §9 |
| Conversation persistence (fire-and-forget) | ✅ unchanged → see §9 |

---

## 9. Open Hardening Items — Each with Landing Location

For every open item, the row gives **(a) the precise current code location** where it would land and **(b) status**. When the work lands, change status to ✅ DONE and keep the row.

| # | Item | Current location for the change | Status | Source / Rationale |
|---|---|---|---|---|
| H1 | **Echo / feedback risk** during auto-resume after TTS | `RideshareCoach.tsx:425-436` (auto-resume effect) — currently relies on `clearTranscript()` to wipe captured Coach voice; no AEC, no VAD, no mic-mute-during-TTS | ✅ DONE (c7280ea8) | Corrected TODO §2 P0; advisor-flagged in prior turn |
| H2 | **Mic-permission-denied UX path** | `RideshareCoach.tsx:233-236` (currently `console.warn` only); `CoachStopBar.tsx` has no denied state | ✅ DONE (c7280ea8) | Corrected TODO §2 P0 |
| H3 | **Silence detection / VAD / timeout** | Would land in `useSpeechRecognition.ts` or a Coach-specific wrapper; `useCoachAudioState.ts:86-96` is the current STT seam | ✅ DONE (c7280ea8) | Corrected TODO §2 P1 |
| H4 | **COACH-H7 — Streaming fallback for AI_COACH provider outage** | `chat.js:1233-1380` (model call + stream loop). Currently no fallback — Gemini error → SSE error → end. | ✅ DONE (c7280ea8) | RIDESHARE_COACH.md §6 (severity: high) |
| H5 | **COACH-H8 — Conversation persistence is fire-and-forget** | `chat.js:872-895` (user message save) and `chat.js:1342-1362` (assistant save). Both wrapped in `try/catch` with `console.warn` only — failures swallowed. | ✅ DONE (c7280ea8) | RIDESHARE_COACH.md §6 (severity: high) |
| H6 | **Notes API surface duplication** | `/api/chat/notes` lives in `chat.js:629-669` (POST/GET/DELETE); `/api/coach/notes` lives in `rideshare-coach/notes.js` (full CRUD). Both wired live. | 🟡 OPEN | Corrected TODO §4; baseline audit §13.E |
| H7 | **No per-user Coach rate limit** | Would land in middleware before `chat.js:704` (the `POST /` handler). Global rate limit only. | 🟡 OPEN | RIDESHARE_COACH.md §6 |
| H8 | **No context size estimation / token budget** | Would land in `rideshare-coach-dal.js:887` (`formatContextForPrompt`) or as a wrapper before `chat.js:1245` (`callModelStream`) | 🟡 OPEN | RIDESHARE_COACH.md §6, §7 — see §11 below for option set |
| H9 | **No conversation summarization for long threads** | `useMemory` hook already has `summarizeConversation` — currently called *after* the turn (`useCoachChat.ts:100-104`), not *before* sending. Could be moved server-side at `chat.js:1215-1226` to compress thread history. | 🟡 OPEN | RIDESHARE_COACH.md §6 |
| H10 | **Action-tag legacy regex parser** still present | `chat.js:99-124` (legacy `[TAG: {...}]` parsing). JSON envelope is preferred (`chat.js:52-81`). Plan: log usage so it can be retired. | 🟡 OPEN (maybe-dead) | Baseline audit §14.4; CLAUDE.md Rule 14.4 |
| H11 | **Dead `getBriefing()` overlap** | `rideshare-coach-dal.js:353-381` (`getBriefing`) overlaps `getComprehensiveBriefing` at `:227`. Confirm if still called anywhere; if not, candidate for removal (see Rule 16). | ✅ DONE (c7280ea8) | Baseline audit §5 (duplicate-read risk) |
| H12 | **TTS streaming flag still default-OFF** | `featureFlags.ts:COACH_STREAMING_TTS_ENABLED` default is `false`. Plan said Step 6 flips to `true`. | ✅ DONE (c7280ea8) | Comment in `featureFlags.ts` |
| H13 | **Documentation drift (RIDESHARE_COACH.md)** | See §7 — multiple line-count and behavior contradictions | ✅ DONE (Updated to reflect PR #31 behavior) | This document |
| H14 | **`/server/api/coach/` dead folder** | 4 files, 1,034 lines, no importers — see §3 | ✅ DONE 2026-05-04 — folder deleted; `bootstrap/routes.js:61-65` comment corrected. ⚠️ Re-introduced 2026-05-05 via merge 2ee72a20; permanently re-deleted via 02a481cd. See §13 second-resolution addendum. | This document; resolved per Melody decision in §13 |
| H15 | **Phase 0 plan is historical / not amended** | `docs/review-queue/PLAN_coach_handsfree_voice-2026-05-04.md` says "no code changes yet" but PR #31 has shipped the implementation | ✅ DONE (Marked as historical) | Corrected TODO §3 P1 |
| H16 | **`coach_full_pipeline.md` line anchors are at `274cadc5`, not current main** | The audit doc itself says it's frozen, but doesn't have a banner | ✅ DONE (File consolidated and deleted during audit) | Corrected TODO §3 P0 |
| H17 | **`docs/coach-inbox.md` items now resolved by PR #31** | Some inbox items are addressed by PR #31 but inbox is unchanged | ✅ DONE (Appended resolution notes) | Corrected TODO §3 P1 |

---

## 10. ❓ DECIDE — Routing Options (Melody has not considered this)

Melody said she has never considered a routing feature. "Routing" is ambiguous — there are at least **four distinct things** the word could mean in the Coach pipeline. Each is a separate decision. Pick zero, one, several, or define a fifth.

| Option | What it means | Where it would land | Tradeoff |
|---|---|---|---|
| **R1 — URL routing / deep links** | `/co-pilot/coach?q=<question>&snapshot=<id>` so a notification, a Smart Block tap, or another tab can drop the driver into a specific Coach prompt. | `client/src/pages/co-pilot/CoachPage.tsx:14` (read URL params); `client/src/components/RideshareCoach.tsx:79` (accept initial-prompt prop) | Adds shareable/referrable Coach prompts. Low surface area. |
| **R2 — Tab-persistence routing for in-flight generation** | When the driver navigates to Strategy or Briefing mid-generation, the SSE stream is currently torn down on unmount (server keeps generating, client loses it). Option: persist the streaming session across tab-switches. | Server: `chat.js:1264-1300` (stream loop) needs a session-keyed store. Client: `useCoachChat.ts:212-266` reader needs to reconnect to a server-held buffer. | This is the "chat state persistence during active generation" inbox item. Substantial new server state (in-memory or Redis) + client reconnect logic. |
| **R3 — Server-side model fallback / provider routing (COACH-H7)** | When Gemini streaming fails (outage, safety block, network), route the request to a fallback model. Currently the failure becomes an SSE `error` event and ends the turn. | `chat.js:1245-1380` (model call + stream loop). Adapter at `server/lib/ai/adapters/index.js` would gain a `withFallback` wrapper or chain. | This is the COACH-H7 hardening item framed as routing. Tradeoff: fallback model has different capabilities (may not have web search, vision, etc.) — answer quality differs. |
| **R4 — Intent-based sub-agent routing** | Driver says "translate this" → translation agent; "analyze this offer" → offer-intelligence agent; "where should I go" → strategy. Coach becomes a router, not a single brain. | `chat.js:898+` (system prompt) gains intent classification preface; new server module `server/lib/coach/intent-router.js` (proposed location) | Major architecture change. Unifies fragmented assistants but adds hop latency. Probably out of scope unless explicitly wanted. |

Melody: **which of R1–R4 (or a different definition) did you mean?** If multiple, give priority order. The master plan won't pick.

---

## 11. ❓ DECIDE — Token-Budget Options (Melody has not considered this)

**Important framing:** AI_COACH (`model-registry.js:193-203`) uses `gemini-pro-latest` with `maxTokens: 8192` (output cap) on a model with **1M-token input context window**. The risk is **not** "exceeding the input context window" — that almost can't happen. The real risks are:

1. **Cost** — every turn re-injects the full ~358-line `formatContextForPrompt` output (§6) + full thread history. Estimated ~30-60K input tokens per turn currently. Cost scales linearly per token per driver per turn.
2. **Latency** — Gemini ingests the full prompt before producing the first token. Bigger prompt = slower time-to-first-audio in hands-free mode.
3. **Output truncation** — `maxTokens: 8192` is plenty for chat answers but can cut off long planning responses (e.g., "list every venue with full justification").

These are **four orthogonal options**. Melody can pick any combination.

| Option | What it does | Where it would land | Tradeoff |
|---|---|---|---|
| **A — Estimation-only (observability)** | Log token count per turn (input prompt + thread history). No behavior change. Establishes baseline before deciding to optimize. | New helper `server/lib/coach/estimate-tokens.js`; called once before `chat.js:1245`. Log line: `[COACH] [TOKENS] input=N output_cap=8192 driver=...`. | Cheapest. Zero risk. Reveals the real cost shape before committing to (B)/(C). |
| **B — Priority-based context trimming** | Drop low-priority sections when estimated input > threshold. Priority order suggested (Melody to confirm): keep snapshot/strategy/SmartBlocks/recent-notes always; trim `offerHistory`, then older `userNotes`, then `marketIntelligence` body, then session-history detail. | `rideshare-coach-dal.js:887` (`formatContextForPrompt`) gains a `budget` param; or wrap at `chat.js:801`. | Coach loses memory selectively when over budget. Risk: dropped sections may have been load-bearing for this driver's question. |
| **C — Conversation summarization** | Replace old thread history with a one-paragraph summary above N turns (e.g., keep last 6 verbatim, summarize the rest into ~200 tokens). | Currently `useCoachChat.ts:100-104` summarizes *after* (logging only). Move/duplicate to *before* send: server-side at `chat.js:1215-1226`, or client-side before POST. | Coach forgets specifics from earlier in the same session. Mitigated by keeping last N verbatim. |
| **D — Output-cap bump** | Raise `maxTokens` from 8192 → 16384 or 32768 for long planning answers. | `model-registry.js:197` | Cost per long-answer turn doubles or quadruples. Counter-pressure: most Coach turns are short, so the average is barely affected. |

**The advisor's view (and mine):** A is harmless and always worth doing first because it tells you whether B/C/D are needed. B and C address different problems (B = giant context per turn; C = giant thread history over time). D is independent.

Melody: pick zero or more. The master plan won't pick.

---

## 12. ❓ DECIDE — PR #31 Merge Gate

**Question still open from prior turn:** Are the doc-currency fixes from §7 and the Corrected TODO §3 (RIDESHARE_COACH.md §9.2/§9.5/lifecycle, plan-storage-key drift, plan-paragraph-collapse drift, coach-inbox resolution notes) **merge-blockers for PR #31**, or **post-merge cleanup**?

The corrected TODO §3 marks the §9.2/§9.5/lifecycle items P0 and the plan/inbox items P1. P0 doesn't automatically mean "blocks merge" — it means "highest priority within docs." The choice between blocking PR #31 vs cleaning up on `main` afterwards is yours.

If you say "merge-block": items become first-pass on this branch before merge.
If you say "post-merge": PR #31 ships, then a small `docs/coach/sync-RIDESHARE_COACH-2026-05-04` branch fixes the doc.

This master plan doesn't pick; it just preserves the question.

---

## 13. ✅ DECIDED 2026-05-04 — Dead Folder `/server/api/coach/` (D1 chosen, executed)

**Outcome:** Melody chose **D1 — Delete the folder.** Executed 2026-05-04 via `rm -rf server/api/coach`. `bootstrap/routes.js:61-65` comment was updated in the same change to point at the live `rideshare-coach/` path and to leave a one-line cleanup record inline. The original options table is preserved below per the anti-junk doctrine (§15 clause 1) so future readers can see why D1 was picked over D2/D3.

### Original options (frozen)

**Verified:** zero external importers. The 4 files (1,034 lines) are not on any live code path. The live mount path goes through `/server/api/rideshare-coach/`.

Three options:

| Option | What | Cost |
|---|---|---|
| **D1 — Delete the folder** | `rm -rf server/api/coach/` (4 files, 1,034 lines). Update the comment at `bootstrap/routes.js:61`. | Clean. Reversible via git. |
| **D2 — Leave it but add a `_DEPRECATED` marker** | `mv server/api/coach server/api/_coach_DEPRECATED_2026-05-04` (or add a top-of-file `// DEPRECATED — see /server/api/rideshare-coach/`) so the next session is warned but the file path stays for git-blame archaeology. | Documents the dead state without removing it. |
| **D3 — Investigate before deciding** | Confirm via `git log --follow --oneline server/api/coach/` that no in-flight branch depends on it. | Belt-and-suspenders. ~30 seconds. |

Per Rule 16: this is a Melody decision. Master plan flags it; doesn't act.

**Pre-run history check (saves you a step if you pick D1):** `git log --oneline -- server/api/coach/` returns 8 commits, oldest visible is `9c71b8ba Add AI Coach enhancements: schema awareness, validation, notes CRUD` (the original add); newest is `f0246048 refactor(strategy): drop consolidated_strategy column + rewrite ready trigger` (incidental — not Coach-related). No active branches reference these files (verified zero importers in §3 and confirmed no in-flight work touches them).

### 2026-05-05 Follow-up
The dead folder was accidentally re-introduced on 2026-05-05 via merge `2ee72a20` ("Merge origin/main, keeping server/api/coach/"). It was permanently re-deleted via commit `02a481cd` (5 files / 1,106 lines — the discrepancy from the original 1,034 lines is the 72-line `README.md` that wasn't counted in the initial line audit).

---

## 14. Test Cases per Pending Item (Rule 1 requires test cases)

For each open hardening item from §9. **Manual smoke** unless noted.

| Item | Test |
|---|---|
| H1 (echo) | Open Coach on phone, max volume, no headphones. Ask "What's at the Cowboys stadium tonight?" Wait for TTS to finish. Verify auto-resumed mic does NOT capture the Coach's tail and re-trigger a turn. Repeat 3×. |
| H2 (permission denied) | First Coach load: deny mic in browser permission prompt. Verify: no React error, IDLE green bar appears, transcript stays empty, `console.warn` fires once. Tap green bar — verify mic prompt re-appears (or, if browser blocked permanently, verify a clear UI message — currently absent). |
| H3 (VAD/silence) | Tap green IDLE bar. Speak nothing for 60s. Currently: mic stays on indefinitely. Decide acceptance vs. timeout-and-stop. |
| H4 (COACH-H7 fallback) | Set `AI_COACH_OVERRIDE_MODEL` to an invalid model. Send a Coach message. Verify SSE stream surfaces a fallback (or, today, fails cleanly). |
| H5 (COACH-H8 persistence) | Force `saveConversationMessage` to throw (e.g., disconnect DB mid-turn). Verify SSE `done` event includes a persistence warning instead of silently dropping the conversation. |
| H6 (notes API dup) | Hit `POST /api/chat/notes` and `POST /api/coach/notes` with identical bodies. Verify: same DB write, same response shape, no schema divergence. (After consolidation: only one returns 200.) |
| H7 (rate limit) | Send 31 Coach messages from one user in 60 minutes. Verify request 31 returns 429 with retry-after. |
| H8 (token budget — option A only) | Trigger a Coach turn. Inspect logs for `[COACH] [TOKENS] input=N`. Verify N is reasonable (<200K). |
| H9 (summarization) | Run a Coach session for 20 turns. Verify subsequent turns: input token count stops growing linearly. |
| H10 (legacy regex) | Add a log line to legacy parser path. Run for 7 days. If hits = 0, candidate for removal. |
| H11 (`getBriefing` overlap) | grep callers of `getBriefing` (line 353). If only `getCompleteContext` indirectly references it, candidate for removal. |
| H12 (streaming TTS flag flip) | Set `VITE_COACH_STREAMING_TTS=true`, verify Coach speaks per-sentence as deltas arrive (not after full response). |
| H13 (RIDESHARE_COACH.md drift) | Diff the doc table-of-files against actual `wc -l` after each merge. |
| H14 (dead folder) | `grep -rn "from.*api/coach\b" server client shared` returns zero non-self importers. |
| H15 (Phase 0 plan history) | Add banner; verify renders correctly in markdown viewer. |
| H16 (`coach_full_pipeline.md` history) | Add banner; verify renders correctly. |
| H17 (coach-inbox resolution) | For each PR #31-resolved inbox item, append `RESOLVED — see PR #31` and date. |

**COACH-V1 regression tests** (PR #31 itself — for the manual smoke before merge):

| Scenario | Test |
|---|---|
| Auto-listen happy path (desktop) | Open `/co-pilot/coach`, grant mic, verify mic starts within 2s. |
| Auto-listen happy path (iOS Safari) | Same, but expect green IDLE bar — tap should start mic from sync gesture. |
| Submit phrase | Say "Where should I go right now, I'm done" while listening. Verify: mic stops, transcript "Where should I go right now" sent, Coach responds. |
| Interrupt phrase | While Coach speaks, say "stop talking". Verify: TTS cuts immediately, mic stays on. |
| Auto-resume after TTS | Let Coach finish naturally. Verify mic resumes within 1s. |
| Tab leave persistence | While Coach speaking, switch to Strategy tab. Verify: TTS continues, mic stops. Switch back. |
| Three-state bar — speaking | While Coach speaks, verify red bar with "STOP" label. Tap. Verify TTS cancels. |
| Three-state bar — listening | While mic on, verify blue bar with "LISTENING" label. Tap. Verify mic stops, transcript sent. |
| Three-state bar — idle | After auto-listen fails, verify green bar with "TAP TO ENABLE MIC". Tap. Verify mic starts. |
| TTS paragraph cleanup | Send a Coach question that returns multiple paragraphs. Verify TTS reads them with short comma-pause (~150ms) instead of full sentence pause. |

---

## 15. Anti-Junk Preservation Rules (Doctrine)

This document exists because the codebase has accumulated parallel/dead code (`/server/api/coach/`), drift between docs and code (§7), and partially-shipped refactors (§9 H10–H12). Going forward:

1. **This document is the map.** When a function moves, the row stays — only the file/line and status change. Do not delete rows. Do not rename "OPEN" rows that became "DONE" — flip status, preserve everything else.
2. **Status changes are append-only in spirit.** When `H5` (COACH-H8) ships, the row reads `✅ DONE — chat.js:872 + chat.js:1342 (now awaited; failures included in SSE done payload)`. The original `🟡 OPEN` description stays so future readers know what was hardened.
3. **Dead code does not get silently removed.** Removing a folder is a Melody-decision (see §13). Adding a `_DEPRECATED` marker is a doc-edit with low blast radius and should be preferred over silent deletion.
4. **Doc drift counts as junk.** If `RIDESHARE_COACH.md §9.5` says "two-state bar" and the code is three-state (§7), that drift is a bug — fix it during the same session that consumed the contradiction.
5. **No new feature without a §11/§10/§9-style row.** Master Pipeline gains rows; it doesn't lose them.
6. **`coach_full_pipeline.md` stays frozen.** It's the historical baseline at `274cadc5`. Every line anchor in it is anchored to that ref. Don't update it. Add new audits as new files; reference them from this master plan.
7. **PR #18 / PR #19 / PR #31 facts stay in §1.** Even after they merge to `main`, those rows are how a future session understands what landed when. Do not collapse them.

---

## 16. One-Line Current State

```text
Coach is a three-layer pipeline (frozen baseline 274cadc5 → merged hook architecture coach-pass2-phase-b PR #18+#19 → open hands-free branch feat/coach-handsfree-2026-05-04 PR #31). PR #31 ships COACH-V1 (auto-listen, voice phrases, three-state CoachStopBar, hard-cancel TTS, paragraph-comma TTS cleanup, TTS-persists-on-tab-leave). Open hardening items are echo/feedback risk (H1), permission-denied UX (H2), COACH-H7 fallback (H4), COACH-H8 persistence observability (H5), notes API duplication (H6), rate limit (H7), token budget (H8 — see §11 options A/B/C/D), summarization (H9), and a 1,034-line dead parallel folder /server/api/coach/ (§13). Doc drift in RIDESHARE_COACH.md (§7) is real and includes a two-state-vs-three-state CoachStopBar contradiction. Routing was raised by Melody as an unconsidered feature (§10 enumerates R1–R4); token budget was raised similarly (§11 enumerates A–D). Master plan presents options, never picks; per Rule 16 every architectural decision below the line is Melody's.
```

---

## 17. Cross-References

**Consolidation note (2026-05-04):** Five predecessor audit documents were consolidated into this master plan and then deleted from the branch at Melody's direction. Their content is fully reproduced here; their git history is preserved in the consolidation commit's tree. The historical baseline ref `274cadc5` remains queryable via `git show 274cadc5:<path>` for any archaeology needs.

| Removed-and-consolidated file | Where its content lives now |
|---|---|
| `coach_finalizing/coach_full_pipeline.md` (frozen baseline at `274cadc5`) | §1 (branch model), §3 (frozen-baseline anchors), §4 (E2E pipeline), §5 (DAL function map). For exact 274cadc5 line anchors, query `git show 274cadc5:server/...`. |
| `coach_finalizing/coach_pipeline_branch_audit.md` | Was already marked superseded by `coach_three_branch_reconciliation.md`; final consolidated form is this document. |
| `coach_finalizing/coach_remaining_todo_from_last24.md` | Was already marked superseded by `coach_corrected_remaining_todo.md`; final form is this document. |
| `coach_finalizing/coach_three_branch_reconciliation.md` (GPT's corrected three-layer audit) | §1 (branch model), §2.1 (PR #18 hook architecture), §4 (E2E pipeline), §5 (DAL map). |
| `coach_finalizing/coach_corrected_remaining_todo.md` (GPT's corrected TODO split) | §8 (done matrix), §9 (open hardening), §10 (routing — new), §11 (token budget — new), §12 (merge gate). |

| Live external doc still referenced | Purpose |
|---|---|
| `docs/architecture/RIDESHARE_COACH.md` | Canonical Coach doctrine doc. Drift items in §7 of this master plan. |
| `docs/review-queue/PLAN_coach_handsfree_voice-2026-05-04.md` | Phase 0 plan for COACH-V1. Now historical (H15). |
| `docs/coach-inbox.md` | Coach → Claude memos. PR #31 resolved several items not yet annotated (H17). |
| `DUPLICATE_FILENAMES_AUDIT.md` (sibling) | Repo-wide duplicate-name risk map. §6 (dead `/server/assistant/` folder) was the open Melody-decision sibling to this doc's §13. ✅ Resolved 2026-05-05 via `86156fd6` (folder deleted, 6 files / 379 lines). |

---

## 18. Update Log

| Date | What changed | By |
|---|---|---|
| 2026-05-04 | Document created. Verified line numbers across all 16 Coach files (8 client + 8 server-live + 4 server-dead + DAL). Confirmed dead folder via grep. Branch state at `acedd54f`. | Claude (at Melody's direction) |
| 2026-05-04 | §13 D1 executed. `/server/api/coach/` deleted (4 files, 1,034 lines). `bootstrap/routes.js:61-65` comment corrected to reflect the live `rideshare-coach/` path. §2.3, §3, §9 H14, §13, and §18 updated to mark DONE while preserving prior rows per §15 clause 1. | Claude (at Melody's instruction "Delete the dead folder") |
| 2026-05-04 | Repo-wide duplicate-filename audit completed (sibling file `DUPLICATE_FILENAMES_AUDIT.md`). Found a second dead parallel folder at `/server/assistant/` — same shape as the deleted `/server/api/coach/`. Open as §6 of the audit. | Claude (at Melody's direction) |
| 2026-05-04 | **Consolidation commit.** Five predecessor audit files in `coach_finalizing/` deleted after verifying full content coverage in this master plan: `coach_full_pipeline.md`, `coach_pipeline_branch_audit.md`, `coach_remaining_todo_from_last24.md`, `coach_three_branch_reconciliation.md`, `coach_corrected_remaining_todo.md`. §17 updated to record where each predecessor's content now lives. Empty `coach_finalizing/` folder removed. | Claude (at Melody's instruction "if all of the todo's and full understanding of the coach pipeline are in [master plan] remove them from the branch") |
| 2026-05-04 | PR #31 merged as `61a2d417`, branch deleted. | Melody |
| 2026-05-05 | `/server/api/coach/` re-introduced via merge `2ee72a20`; permanently re-deleted via `02a481cd`. Cross-refs §9 H14 and §13 updated. | Claude (at Melody's instruction) |
| 2026-05-05 | Duplicate-filename audit cleanups landed via `86156fd6` (D1, C1–C5). Sibling audit §6 (`/server/assistant/`) resolved; §17 row updated. Same commit flipped H13/H15/H16/H17 to DONE. | Claude (at Melody's instruction) |
| 2026-05-05 | Hardening implementations landed via `c7280ea8`. Flipped statuses to DONE for H1 (Echo prevention), H2 (Mic denied UX), H3 (VAD/Stop UX), H4 (Graceful fallback), H5 (Conversation persistence), H11 (getBriefing removal), and H12 (TTS streaming flag). | Antigravity (at Melody's instruction) |
| _(future)_ | _Append a row each time §8 / §9 / §10 / §11 status flips. Never delete prior rows._ | _(implementer)_ |
