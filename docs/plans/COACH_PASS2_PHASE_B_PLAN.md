# Coach Pass 2 + Phase B — Execution Plan

> **Branch:** `coach-pass2-phase-b` (off `main`)
> **Created:** 2026-04-26
> **Owner:** Melody
> **Executor:** Claude Code (Repl-side, via shell on the live Repl)
> **Status:** Active — Step 1 ready to start
> **Companion `claude_memory` entry:** find by `category='plan'` AND `tags @> ["coach","pass-2","phase-b"]`. Each step's entry references it via `parent_id`.

## Why this exists

The Rideshare Coach voice architecture is mid-Phase-A. Phase A Pass 1 — relocate to `/co-pilot/coach`, embed MapTab on Strategy, GA Realtime token endpoint, mint rate-limit — is shipped on `main`. Pass 2 (component split + audio state rename) and Phase B (streaming/chunked read-aloud) are this plan's scope.

A full GPT-5.5 audit (2026-04-26) reduced the remaining work to 8 ordered steps. Items 5–9 from that audit (Realtime client, bridge, guardrails, fallback) are deferred to Phase C and beyond.

## Decisions already made — do not relitigate

| Decision | Source | Date |
|----------|--------|------|
| Strategy hosts embedded MapTab, not Coach launcher | `claude_memory` row 177; commit `7262213f` | 2026-04-26 |
| Compact Strategy→Coach affordance NOT restored — embedded MapTab took its slot intentionally | this plan; row 177 | 2026-04-26 |
| Single Rideshare Coach component (separate output/input state) | audit + `RIDESHARE_COACH.md` | 2026-04-14 |
| Gemini stays the Coach brain (`AI_COACH` role, streaming-only) | `server/lib/ai/model-registry.js:200-206` | unchanged |
| `gpt-realtime` is voice-only; chat/reasoning stays `gpt-5.5-2026-04-23` | commit `5344525d` | 2026-04-25 |
| `/api/realtime/token` is ready but UNCONSUMED until Phase C | this plan | 2026-04-26 |

## Verified facts that shape the plan (do not re-verify)

1. `cleanTextForTTS` (currently inline in `RideshareCoach.tsx:270-281`) uses bracket-style action tags `[SAVE_NOTE:{...}]` — NOT XML. Already strips markdown + collapses paragraphs to `. `. The sentence parser added in step 5 must wait for closing `]` before flushing a chunk and must treat post-substitution `.` as a boundary candidate.
2. `/api/tts` (`server/api/chat/tts.js` + `server/lib/external/tts-handler.js`) is **one-shot**: `text in → MP3 buffer out` via OpenAI `tts-1-hd`. There is no streaming TTS endpoint. Phase B is therefore N sentences × N round-trips, FIFO queue, sequential playback. Audio gaps between chunks are accepted as the price of word-time-to-first-audio.
3. `callModelStream(role, { system, messageHistory })` does **NOT** accept `AbortSignal` (`server/lib/ai/adapters/index.js:247`). `chat.js` has zero `req.on('close')` references. Step 2 plumbs this through; without it, "barge-in" only stops the audio queue while Gemini keeps generating + billing on the server.
4. `voiceEnabled` is persisted to `localStorage`. Step 4 introduces `coach_read_aloud_enabled` with an idempotent migration: read old key + new key, write new, leave old in place for one release as fallback. Verify the exact old key name in `RideshareCoach.tsx:86-90` before writing the migration.
5. There is no `components/coach/` or `hooks/coach/` directory yet; create them in step 3.
6. The Realtime token endpoint is wired and security-hardened, but no client consumer exists — Strategy and Coach both still use `useTTS` (one-shot) + `useSpeechRecognition` (browser Web Speech). Do not introduce a Realtime client in this plan.

## The 8 steps

Each step is a single commit. Each leaves the app in a working state. Stop after every commit and wait for Melody's confirmation before continuing.

### Step 1 — Lift `cleanTextForTTS` to a shared util

- **Scope:** move the inline function from `RideshareCoach.tsx:270-281` to a new file `client/src/utils/coach/cleanTextForTTS.ts` as a pure named export. Replace the inline definition with an import.
- **Files:** new `client/src/utils/coach/cleanTextForTTS.ts`; modify `client/src/components/RideshareCoach.tsx`.
- **LOC:** ~25.
- **Behavior change:** none.
- **Verify:** `npm run typecheck`; dev server boots; Coach tab smoke test (send a message, confirm response renders + auto-speak fires when read-aloud toggle is on).
- **Commit message:** `refactor(coach): lift cleanTextForTTS to shared util (no behavior change)`

### Step 2 — Plumb `AbortSignal` through `callModelStream`

- **Scope:** extend `callModelStream(role, { system, messageHistory, signal })` to accept an `AbortSignal`. Forward `signal` into the Gemini SDK call (the Node SDK supports `AbortController` natively). In `server/api/chat/chat.js`, create `const ac = new AbortController(); req.on('close', () => ac.abort());` and pass `ac.signal` to `callModelStream`. Existing happy-path behavior unchanged.
- **Files:** `server/lib/ai/adapters/index.js`; `server/lib/ai/adapters/<gemini adapter file>` (locate the actual streaming impl via grep before editing); `server/api/chat/chat.js`.
- **LOC:** ~25.
- **Behavior change:** none on happy path. New behavior: when client aborts SSE (or closes the tab), Gemini stream is cancelled server-side instead of running to completion.
- **Verify:** `npm run typecheck`; dev server boots; manual abort test — open Coach, send a long question, force-close the tab mid-stream, watch server logs for cancellation rather than full completion.
- **Commit message:** `feat(chat): plumb AbortSignal through callModelStream + req.on(close) → cancel Gemini`

### Step 3 — Extract `useCoachChat` hook (no rename, no behavior change)

- **Scope:** move SSE streaming logic, action-tag parsing call, persistence calls, attachments handling, and `controllerRef` ownership from `RideshareCoach.tsx` into a new hook `client/src/hooks/coach/useCoachChat.ts`. The hook returns `{ messages, setMessages, isStreaming, send(text, attachments), abort(), validationErrors, ... }`. Internal variable names unchanged (still `fullResponse`, `isStreaming`). The component now calls the hook and renders.
- **Files:** new `client/src/hooks/coach/useCoachChat.ts`; modify `client/src/components/RideshareCoach.tsx` (~−200 +20).
- **LOC:** ~270.
- **Behavior change:** none.
- **Verify:** typecheck; dev server boots; Coach tab smoke test (full happy path: send, stream, action-tag execution, persistence, abort mid-stream).
- **Commit message:** `refactor(coach): extract useCoachChat hook (no behavior change)`

### Step 4 — Extract `useCoachAudioState` and rename audio state

- **Scope:** new hook `client/src/hooks/coach/useCoachAudioState.ts` aggregates `useTTS()`, `useSpeechRecognition()`, the persisted read-aloud toggle, and derived flags. Returns:

```ts
readAloudEnabled: boolean    // persisted; renamed from voiceEnabled
micSessionActive: boolean    // = isListening today; reserved name for Phase C Realtime
realtimeConnected: false     // hardcoded; becomes real in Phase C
isListening: boolean         // from useSpeechRecognition
isThinking: boolean          // chatStreaming && !firstDeltaSeen
isSpeaking: boolean          // tts.isSpeaking
isStreamingText: boolean     // chatStreaming && firstDeltaSeen
canBargeIn: boolean          // isSpeaking || isStreamingText
setReadAloudEnabled(v): void
startMic(lang): void
stopMic(): void
speak(text, lang): Promise<void>   // direct passthrough to useTTS for now
stopSpeak(): void
warmUp(): void
```

- **localStorage migration:** read old key (`coach_voice_enabled` — verify exact name in `RideshareCoach.tsx:86-90` before coding) AND new key (`coach_read_aloud_enabled`). Initial value: `new ?? old ?? false`. On every change, write new key only. Leave old key in place for one release.
- **Wiring:** the component consumes `useCoachAudioState()`; replace `voiceEnabled` references with `readAloudEnabled` etc. The mute/unmute button title and aria-label keep the same UI strings ("Mute coach voice" / "Enable coach voice"); only internal state names change.
- **Files:** new `client/src/hooks/coach/useCoachAudioState.ts`; modify `RideshareCoach.tsx`.
- **LOC:** ~110.
- **Behavior change:** none (rename only). `localStorage` key change is invisible to user.
- **Verify:** typecheck; dev server boots; manually flip the toggle, reload, verify state persists; check `localStorage` in DevTools to confirm new key is written and old key remains untouched.
- **Commit message:** `refactor(coach): extract useCoachAudioState; rename voiceEnabled→readAloudEnabled with idempotent localStorage migrate`

### Step 5 — Add `useStreamingReadAloud` + sentence parser, wire flag-gated OFF

- **Scope:**
  - new `client/src/utils/coach/sentenceBoundary.ts` — pure function `findSentenceBoundary(buffer: string): number` returning the index immediately after a flushable boundary, or `-1` if none yet. Skips matches inside open `[...]` action tags. Treats `.`, `!`, `?` as candidates. Ignores decimals (`\d\.\d`). Ignores common abbreviations (`Mr.`, `Mrs.`, `Inc.`, `etc.`, `St.`, `Dr.`, `vs.`, `e.g.`, `i.e.`). Requires whitespace OR end-of-buffer after the terminator.
  - new `client/src/hooks/coach/useStreamingReadAloud.ts` — exposes `{ pushDelta(text), flush(), abort() }`. Maintains an internal buffer + FIFO chunk queue. On every `pushDelta`, append to buffer, repeatedly call `findSentenceBoundary`, slice and `cleanTextForTTS`-ify each completed sentence, and push non-empty results to the queue. Background worker awaits `audioState.speak(chunk)` per queue item, dequeueing on completion. `abort()`: clear queue + call `audioState.stopSpeak()`. `flush()`: append a synthetic `\n\n` (which `cleanTextForTTS` already converts to `. `) to coerce a final boundary, drain.
  - Add a feature flag `COACH_STREAMING_TTS_ENABLED` — default `false` in this commit — read from `import.meta.env.VITE_COACH_STREAMING_TTS`. Document the flag in `client/src/constants/featureFlags.ts` (create if absent).
  - Wire in `RideshareCoach.tsx`: when flag is `true`, on each delta call `streaming.pushDelta(delta)`; on stream end call `streaming.flush()`; skip the existing post-stream `tts.speak(spokenText.slice(0, 4000), 'en')`. When flag is `false`, the existing path runs unchanged. When mic starts during streaming (existing barge-in path on RideshareCoach.tsx:262-265), also call `streaming.abort()` in addition to `tts.stop()`.
- **Files:** 2 new (`utils/coach/sentenceBoundary.ts`, `hooks/coach/useStreamingReadAloud.ts`); 1 new or extended (`constants/featureFlags.ts`); modify `RideshareCoach.tsx`.
- **LOC:** ~170.
- **Behavior change:** none with default flag (off). When flag is set on locally, streaming chunked TTS replaces post-stream TTS.
- **Verify:** typecheck; dev server boots; default behavior unchanged (Coach still works exactly as before). Then set `VITE_COACH_STREAMING_TTS=true` in `.env.local` and smoke-test: send a multi-sentence question, verify chunks play in order with no overlap, no duplicate audio, no missed sentences. Verify barge-in (start mic mid-playback) drops the queue and stops audio. Unset the override before committing.
- **Commit message:** `feat(coach): streaming read-aloud hook + sentence parser (flag-gated, off by default)`

### Step 6 — Enable streaming read-aloud by default

- **Scope:** flip `COACH_STREAMING_TTS_ENABLED` default to `true` in the flag definition file. The env override still works for kill-switch (`VITE_COACH_STREAMING_TTS=false`).
- **Files:** `client/src/constants/featureFlags.ts`.
- **LOC:** ~2.
- **Behavior change:** **user-visible — chunked playback becomes default.**
- **Verify:** typecheck; dev server boots; full UAT on Coach tab on desktop AND mobile Safari (iOS audio unlock matters). Confirm: chunks play in order; no audio overlap; barge-in drops queue + stops Gemini server-side (verify in server logs); read-aloud toggle off → no audio at all; refresh persists toggle state.
- **Rollback:** set `VITE_COACH_STREAMING_TTS=false` in env; or `git revert` this single commit. Steps 1–5 stay regardless.
- **Commit message:** `feat(coach): enable streaming read-aloud by default`
- **DO NOT MERGE** to `main` until UAT passes. If UAT exposes issues, revert this commit only.

### Step 7 — Extract presentational subcomponents

- **Scope:** split `RideshareCoach.tsx` into:
  - `client/src/components/coach/CoachConversation.tsx` — message list + input + suggested questions + attachments preview + the existing "Listening..." indicator (line ~740 of current RideshareCoach.tsx).
  - `client/src/components/coach/CoachControls.tsx` — mic button + read-aloud toggle button + `warmUp()` wiring on toggle-on.
  - `client/src/components/coach/CoachNotesPanel.tsx` — existing notes UI (lift verbatim).
- `RideshareCoach.tsx` becomes a thin shell that composes the three subcomponents with the two hooks (`useCoachChat`, `useCoachAudioState`) and `useStreamingReadAloud`.
- **NO new UI surfaces.** No status badges added (would be an enhancement). Existing "Listening..." indicator stays inside `CoachConversation`.
- **Files:** 3 new in `client/src/components/coach/`; `RideshareCoach.tsx` slimmed to a wrapper.
- **LOC:** ~600 moved across files; net new ~50.
- **Behavior change:** none.
- **Verify:** typecheck; dev server; full Coach smoke test; visual regression — compare layout to the pre-step-7 state side-by-side.
- **Commit message:** `refactor(coach): extract presentational subcomponents (no UI change)`

### Step 8 — Phase A finishing items

- **Scope:**
  - Add a contract test `client/src/__tests__/strategy-no-coach.test.ts` that grep-asserts (a) `StrategyPage.tsx` does not import `RideshareCoach` from any path, (b) does not reference `/api/realtime/token`, `useCoachRealtimeSession`, `useTTS`, or `useSpeechRecognition`. Static text checks; no DOM rendering needed.
  - Update `docs/architecture/RIDESHARE_COACH.md` Voice Integration Status section: Phase A Pass 1 done, Pass 2 + Phase B done (cite this branch's commits), Phase C/D/E pending. Distinguish current legacy hook path (still used for mic input) from target Realtime path (not yet wired).
  - Move `client/src/components/AI_COACH_VOICE_PLAN.md` → `docs/architecture/legacy/AI_COACH_VOICE_PLAN.md` and prepend a banner: `> SUPERSEDED 2026-04-26 — see RIDESHARE_COACH.md and docs/plans/COACH_PASS2_PHASE_B_PLAN.md. Original kept for historical reference; do not implement from this doc.`
  - Update `README.md` route table: `/co-pilot/coach` is its own route; remove any "Strategy contains Coach" prose.
- **Files:** 1 new test; 3 doc edits; 1 file move.
- **LOC:** ~250 across docs + test.
- **Behavior change:** none.
- **Verify:** test passes; typecheck; markdown renders; doc links resolve.
- **Commit message:** `chore(coach): A.fin contract test + doc realignment + supersede legacy voice plan`

## Per-step contract — Repl-side Claude Code MUST follow this for every step

1. **Read** the relevant files using Read/Glob/Grep — never `cat` via Bash for file reads.
2. **Make ONLY the changes scoped above.** No scope creep, no enhancements, no refactors-on-the-side.
3. **Verify locally** before committing:
   - `npm run typecheck` exits 0
   - dev server boots without fatal errors
   - For UI-touching steps (1, 3, 4, 5, 6, 7): smoke-test the Coach tab in a browser:
     - Coach tab opens without crash
     - Type and send a message → response streams → renders
     - Read-aloud toggle on → auto-speak fires (chunks if step ≥ 6, single blob otherwise)
     - Mic button starts speech recognition; finalized transcript sends as message
4. `git status` — confirm only intended files changed. If extras showed up, revert them.
5. `git add <intended files only>` — never `git add -A` or `git add .`.
6. `git commit` with the conventional message exactly as specified for the step.
7. **POST to `/api/memory`** (running on `http://127.0.0.1:5000`) with this body:

```json
{
  "session_id": "coach-pass2-phase-b-2026-04-26",
  "category": "action",
  "title": "Coach Pass 2 — Step N: <one-line summary>",
  "content": "<commit-hash> | files: <comma list> | behavior: none|flag-gated|user-visible | verify: typecheck+dev-server+smoke",
  "source": "claude-code",
  "priority": "normal",
  "status": "active",
  "tags": ["coach", "pass-2", "phase-b", "step-N"],
  "related_files": ["client/src/...", "..."],
  "parent_id": <plan entry id — query GET /api/memory?category=plan&search=COACH_PASS2_PHASE_B_PLAN>,
  "metadata": {"step": N, "branch": "coach-pass2-phase-b"}
}
```

8. **STOP.** Do not start the next step. Report:
   - The commit hash
   - The new memory entry id
   - Any anomalies, deviations, or test failures
   - A 1-sentence summary

   Wait for Melody's confirmation before continuing to the next step.

## Loss-prevention safeguards

- Each step compiles and runs independently — no half-states between commits.
- Step 5 introduces all new streaming code as no-op behind a flag — flip back is `false`.
- Step 6 (flag flip) is the only user-visible change — isolated for clean revert; if UAT fails, revert just step 6.
- `cleanTextForTTS`, action-tag stripping, browser-`speechSynthesis` fallback, iOS audio unlock — preserved verbatim throughout the chain.
- Step 4 `localStorage` migration is idempotent (read both keys, write new, keep old for one release).
- Step 7 (the 600-LOC mechanical refactor) lands AFTER step 6 so a flag-flip bug isn't tangled with a layout refactor — easier bisection.
- Mic input path (browser Web Speech API) is untouched — it is not in Phase B scope. Replacement waits for Phase E.
- `RideshareCoach.tsx` props contract is preserved through all steps. `CoachPage.tsx` does NOT change.
- Never `git add -A` — only stage explicitly enumerated files. The repo has unstaged changes (`LESSONS_LEARNED.md`, `.env.local.example`) that are NOT part of this plan and must remain unstaged unless Melody asks otherwise.

## Out of scope (this plan)

- **Phase C** — Realtime/WebRTC client, `useCoachRealtimeSession`, Realtime↔Gemini server-side bridge (audit items 5, 6).
- **Phase D** — Cost/lifecycle guardrails: idle disconnect, daily session cap, daily/user budget, wake lock, page visibility, audio focus, OpenAI mic-audio consent UI (audit item 8).
- **Phase E** — Demote/replace browser Web Speech for mic input (depends on Phase C).
- **F-10** — Gemini outage fallback for the Coach (independent ticket; audit references `FEATURE_AUDIT.md` F-10).

## References

- Audit (2026-04-26): full GPT-5.5 evaluation of `main` state — captured in handoff conversation.
- `LESSONS_LEARNED.md` 2026-04-26 entry: render gating vs prop coercion. Unstaged at plan creation; commit when convenient — not part of this plan.
- `claude_memory` row 177: CoachLaunchCard removal decision (item 1 closed).
- `claude_memory` row 178: prop coercion engineering pattern.
- Commit `7262213f`: the embed (rationale + UX-bug recovery).
- Commit `d3804bb3`: Coach relocation; explicitly defers internals to "Pass 2 + Phase B" — see `CoachPage.tsx:4`.
- Commit `a4986b9d`: GA `/v1/realtime/client_secrets` migration.
- Commit `cd030abd`: realtime mint rate-limit + security headers.
- Commit `5344525d`: `gpt-realtime` voice + `gpt-5.5-2026-04-23` chat split.
- `server/api/chat/realtime.js`: ready endpoint, no client consumer (until Phase C).
- `server/lib/ai/model-registry.js:200-206`: `AI_COACH` role contract — Gemini-only, streaming-required.
- `docs/architecture/RIDESHARE_COACH.md`: canonical Coach doc; will be updated in step 8.
