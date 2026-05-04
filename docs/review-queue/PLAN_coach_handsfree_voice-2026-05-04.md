# [INTENT_MAPPING] Coach Hands-Free Voice Mode (Driving Safety)

> **Status:** Phase 0 — awaiting Y/N approval. **No code changes yet.**
> **Date:** 2026-05-04
> **Branch:** `feat/coach-handsfree-2026-05-04` (based on `origin/main` @ `9c81fd66`)
> **Ticket label:** COACH-V1 (proposed — Coach Voice version 1)
> **Antecedent:** New feature request 2026-05-04, post-AUTH-003 publish freeze lift.

---

## 1. Problem Statement (Melody's words, framed)

Drivers need **hands-free, eyes-on-the-road** Coach interaction during active driving. Common questions cited:

- *"What's the best TSA entrance?"*
- *"Where should I go right now?"*
- *"What language is this passenger speaking?"*

The original move of the Coach component into its own tab (`/co-pilot/coach` via `CoachPage.tsx`) was specifically to enable auto-activation of listening mode — so a driver can switch to the Coach tab and immediately start talking without taking eyes off the road.

**This is a driving-safety feature, not a UX enhancement.** Every design decision must be sized to the on-trip case (zero glances tolerated), not the between-rides case (re-tappable).

**Specific safety constraint Melody emphasized:** the in-app stop control must be **physically large** — *"tiny right now could mean the difference between an accident and an accident."* Industry references for in-car emergency-touch targets justify 80–100px height + full-width band rather than the standard 44pt CTA size.

---

## 2. Scope (the seven features)

| # | Feature | Plain-language behavior |
|---|---|---|
| 1 | **Auto-activate microphone** on Coach tab select | When `/co-pilot/coach` mounts, request mic permission immediately (TranslationOverlay pattern) |
| 2 | **Auto-start listening** | After permission grant, `startMic('en')` fires automatically — no tap required |
| 3 | **Stop phrase: "stop and output"** | Detected in live transcript → stop mic → existing auto-send flow fires (preserved) → strip phrase from sent message |
| 4 | **Reduce TTS pauses** | Slightly between periods, more between paragraphs — fluider playback |
| 5 | **Continuous listen-while-TTS + "stop replying"** | Mic stays on during TTS; "stop replying" stops TTS but mic keeps listening; non-stop-phrase speech during TTS is suppressed (feedback-loop guard) |
| 6 | **Auto-resume listening after TTS finishes** | TTS `onended` → automatic `startMic('en')` (no tap to re-enable) |
| 7 | **Big STOP button, isolated React component** | Large always-visible component at top of Coach UI; tap stops TTS only (mic continues) |

---

## 3. Locked Decisions (with safety rationale)

| # | Question | Locked Answer | Why |
|---|---|---|---|
| Q1 | Auto-listen default state | **Default ON** for everyone, with persisted disable toggle in localStorage (`COACH_AUTO_LISTEN_ENABLED`, default `true`) | Safety: an opt-in toggle that requires reading the UI to find on first run defeats the hands-free goal. Default-on serves the high-stakes case (driver mid-trip, never tapped voice settings) |
| Q2 | Stop-phrase exact text + matching | `"stop and output"` (sends) and `"stop replying"` (interrupts TTS only). **Case-insensitive substring match** on live transcript (interim + final). **Strip from sent message** before send | Substring match handles trailing words ("stop and output please"). Case-insensitive handles dictation casing variations |
| Q3 | TTS period-pause reduction | **Paragraph collapse only** in v1: `text.replace(/\n{2,}/g, '\n')`. Period reduction deferred to v2 | Paragraph collapse is engine-agnostic and meaning-preserving. Period reduction (`. ` → `, `) changes semantics and is engine-limited (OpenAI TTS doesn't honor SSML; iOS speechSynthesis is OS-driven) |
| Q4 | Mic-while-TTS feedback handling | **Aggressive filter:** while `isSpeaking`, the transcript watcher only fires on stop-phrase regex matches. Normal speech captured during TTS is **discarded** (feedback-loop guard) | Mic captures TTS audio bleed → ASR transcribes Coach's own voice → false sends. Filtering to stop-phrase-only during TTS eliminates this attack surface |
| Q5 | Auto-resume after `stopSpeak` | **Yes, always** — even when triggered by "stop replying" stop phrase | Hands-free goal. Mic stays on; TTS just stops. User can fully disable mic via the toggle button (already exists at line 672 of RideshareCoach.tsx) |
| Q6 | Big STOP button visibility | **Always visible**, at top of Coach scroll container, full-width band, **80–100px height**, high contrast (red), **disabled state** (greyed) when not speaking. Sticky position so visible while scrolling | Predictable location reduces eyes-off-road time. Always-visible-but-disabled avoids layout-shift surprise mid-drive. 80–100px sized for peripheral-vision tapping |
| Q7 | STOP button scope | **TTS only.** Mic remains listening | Per Melody's spec — "stop the playback while still listening to the next question" |
| Q8 | Permission-denied UX | Show a non-blocking banner: *"Voice unavailable — auto-listen needs microphone permission. Tap mic icon below to enable."* The existing manual mic toggle button (line 672, RideshareCoach.tsx) continues to work | Drivers may already be mid-trip when permission is denied. Non-blocking banner keeps the chat usable; manual toggle remains as fallback |
| Q9 | Coach mount trigger location | **`RideshareCoach.tsx` mount effect** (verified — `CoachPage.tsx` is a thin wrapper that mounts/unmounts the component on tab switch via React Router). `useEffect(() => {}, [])` in RideshareCoach is the correct trigger | Recon confirmed: `routes.tsx:157` mounts `<CoachPage />`, which directly mounts `<RideshareCoach />`. Tab switch = component unmount, return = component mount |
| Q10 | "What language is the passenger speaking?" — new feature or example question? | **Example question, no new feature.** Coach (Gemini AI) can answer if the driver provides context ("they're saying X — what language?"). If a true audio-language-detection feature is needed, it's a separate scope (Translation tab does live detection but only with the passenger's voice, not the driver's description) | Re-reading Melody's message, language-detection was offered as an example use-case, not a feature ask. Coach already has this capability via the AI_COACH model role |

---

## 4. Architecture (per-feature)

### 4.1. Items 1+2: Auto-activate mic on Coach tab mount

**Where:** `client/src/components/RideshareCoach.tsx`, new mount-time `useEffect`

```tsx
useEffect(() => {
  // Skip if user has explicitly disabled auto-listen
  const autoListenEnabled = localStorage.getItem(STORAGE_KEYS.COACH_AUTO_LISTEN_ENABLED);
  if (autoListenEnabled === 'false') return;

  // Pre-flight mic permission (TranslationOverlay pattern, lines 131-138)
  if (!navigator.mediaDevices?.getUserMedia) return;
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      stream.getTracks().forEach(t => t.stop());
      // Permission granted — auto-start listening
      if (micSupported) startMic('en');
    })
    .catch(() => {
      // Permission denied — fall through to manual toggle (existing UI at line 672)
    });
}, []);  // Mount-only effect
```

**Storage key:** new entry in `client/src/constants/storageKeys.ts`:
```ts
COACH_AUTO_LISTEN_ENABLED: 'vecto_coach_auto_listen_enabled',  // default: true
```

### 4.2. Item 3: Stop phrase "stop and output"

**Where:** new effect in `RideshareCoach.tsx` watching `transcript`. Optionally extracted to `client/src/hooks/coach/useStopPhrases.ts` if the regex set grows.

```tsx
const STOP_AND_OUTPUT_REGEX = /\bstop and output\b/i;

useEffect(() => {
  if (!isListening) return;
  if (!STOP_AND_OUTPUT_REGEX.test(transcript)) return;
  
  // Strip phrase from transcript before send fires
  const cleaned = transcript.replace(STOP_AND_OUTPUT_REGEX, '').trim();
  // The existing isListening→false effect at line 268-area auto-sends.
  // Stop the mic; the existing send-on-stop flow takes over with the cleaned transcript.
  stopMic();
  // Note: latestTranscriptRef sync needs to use cleaned text — see implementation step 4
}, [transcript, isListening, stopMic]);
```

**Implementation detail:** the existing `latestTranscriptRef` pattern (line 182, RideshareCoach.tsx) needs a small modification — when `STOP_AND_OUTPUT_REGEX` matches, the ref should hold the *cleaned* text, not the raw transcript. This is one or two lines.

### 4.3. Item 4: TTS pause reduction

**Where:** `client/src/utils/coach/cleanTextForTTS.ts`

```ts
// Add to existing cleanTextForTTS pipeline:
text = text.replace(/\n{2,}/g, '\n');  // Collapse paragraph breaks
```

**Engine note:** OpenAI TTS-1-HD and browser `speechSynthesis` both honor `\n` as a smaller break than `\n\n`. Period-level reduction is deferred (engine-limited + meaning-changing).

### 4.4. Item 5: Continuous listen-while-TTS + "stop replying"

**Where:** `RideshareCoach.tsx`, layered on top of item 3's stop-phrase effect.

```tsx
const STOP_REPLYING_REGEX = /\bstop replying\b/i;

// Effect 1: while TTS is speaking, ONLY look for "stop replying"; suppress all other transcript-driven actions
useEffect(() => {
  if (!isSpeaking) return;
  if (!STOP_REPLYING_REGEX.test(transcript)) return;
  
  stopSpeak();
  // Mic keeps listening — clearTranscript so the matched phrase doesn't pollute the next message
  clearTranscript();
}, [transcript, isSpeaking, stopSpeak, clearTranscript]);

// Effect 2: while TTS is speaking, suppress the existing auto-send-on-stop flow
// This is the feedback-loop guard. Implementation: gate the existing isListening→false effect on (!isSpeaking).
```

**Critical interaction with existing TTS-interruption (line 286 of RideshareCoach.tsx):** the current code does `stopSpeak()` when the user taps the mic. With auto-listen always on, "tapping the mic to start" no longer happens, so this interruption path is replaced by the verbal "stop replying" path. The existing line 286 logic is preserved as a fallback for users who do tap.

### 4.5. Item 6: Auto-resume after TTS finishes

**Where:** `RideshareCoach.tsx`, new effect watching `isSpeaking` transition true→false.

```tsx
const wasSpeakingRef = useRef(false);

useEffect(() => {
  if (wasSpeakingRef.current && !isSpeaking) {
    // Just transitioned from speaking to silent — auto-resume mic if not already on
    if (!isListening && micSupported) {
      const autoListenEnabled = localStorage.getItem(STORAGE_KEYS.COACH_AUTO_LISTEN_ENABLED) !== 'false';
      if (autoListenEnabled) startMic('en');
    }
  }
  wasSpeakingRef.current = isSpeaking;
}, [isSpeaking, isListening, micSupported, startMic]);
```

### 4.6. Item 7: Big STOP button isolated component

**New file:** `client/src/components/coach/CoachStopBar.tsx` (~40 lines)

```tsx
import { Square } from 'lucide-react';

interface CoachStopBarProps {
  isSpeaking: boolean;
  onStop: () => void;
}

export function CoachStopBar({ isSpeaking, onStop }: CoachStopBarProps) {
  return (
    <div
      className="sticky top-0 z-40 w-full"
      data-testid="coach-stop-bar-container"
    >
      <button
        onClick={onStop}
        disabled={!isSpeaking}
        aria-label="Stop Coach playback"
        data-testid="button-coach-stop-bar"
        className={`
          w-full
          h-20
          flex items-center justify-center gap-3
          font-bold text-2xl
          transition-colors
          ${isSpeaking
            ? 'bg-red-600 hover:bg-red-700 active:bg-red-800 text-white shadow-lg'
            : 'bg-gray-200 text-gray-400 cursor-not-allowed'}
        `}
      >
        <Square className="h-8 w-8" fill={isSpeaking ? "currentColor" : "none"} />
        STOP
      </button>
    </div>
  );
}
```

**Integration in `RideshareCoach.tsx`:** insert at the very top of the scroll container, above the chat header:

```tsx
<CoachStopBar isSpeaking={isSpeaking} onStop={stopSpeak} />
```

**Sizing rationale:** `h-20` = 80px. Full-width = 100% of the viewport at any breakpoint. This is **2-3x the size of standard primary CTAs** by deliberate choice — the safety constraint trumps visual hierarchy concerns. High contrast (red on bright vs. grey on dim) for peripheral-vision tappability.

---

## 5. Files Affected

### 5.1. Code

| File | Change | Est. LOC |
|---|---|---|
| `client/src/components/RideshareCoach.tsx` | Mount effect (auto-mic), 2 stop-phrase effects, auto-resume effect, integrate `<CoachStopBar />` | +60 / -0 |
| `client/src/components/coach/CoachStopBar.tsx` | **NEW** — isolated stop button component | +40 |
| `client/src/utils/coach/cleanTextForTTS.ts` | Add `\n{2,}` → `\n` collapse | +1 |
| `client/src/constants/storageKeys.ts` | Add `COACH_AUTO_LISTEN_ENABLED` key | +1 |
| `client/src/hooks/coach/useStopPhrases.ts` (optional) | Extracted hook if regex set grows beyond 2 phrases | +30 (deferred unless needed) |

### 5.2. Tests

| File | Type | Status |
|---|---|---|
| `tests/components/CoachStopBar.test.tsx` | NEW — Unit: renders disabled state, fires onStop only when isSpeaking | Create |
| `tests/utils/cleanTextForTTS.test.ts` | NEW or extend — Unit: `\n\n` → `\n` collapse | Create or extend |
| `tests/hooks/useStopPhrases.test.ts` | NEW (if hook is extracted) | Conditional |
| Manual: driving-context smoke tests | Behavioral — see §6.4 below | Melody runs |

### 5.3. Docs

| File | Change |
|---|---|
| `docs/architecture/RIDESHARE_COACH.md` | New §11 "Hands-free voice mode (COACH-V1)" — auto-listen default, stop phrases, big stop bar, feedback-loop guard rationale |
| `client/src/components/AI_COACH_VOICE_PLAN.md` | Append "2026-05-04 amendment: hands-free safety mode added" pointer to this plan doc |
| `LESSONS_LEARNED.md` | Defer — only add if non-obvious lesson surfaces during implementation |

---

## 6. Test Cases

### 6.1. Unit (automated, jest)

| # | Case | Expected |
|---|---|---|
| U-1 | `cleanTextForTTS` collapses `\n\n` to `\n` | `"a\n\nb"` → `"a\nb"` |
| U-2 | `cleanTextForTTS` preserves single `\n` | `"a\nb"` → `"a\nb"` |
| U-3 | `cleanTextForTTS` collapses 3+ newlines to 1 | `"a\n\n\nb"` → `"a\nb"` |
| U-4 | `<CoachStopBar isSpeaking={false}>` is disabled, ignores click | onStop NOT called |
| U-5 | `<CoachStopBar isSpeaking={true}>` is enabled, fires onStop on click | onStop called once |
| U-6 | `<CoachStopBar>` has correct large-target a11y label | aria-label === "Stop Coach playback" |

### 6.2. Stop-phrase regex (unit)

| # | Case | Expected |
|---|---|---|
| U-7 | "stop and output" matches | true |
| U-8 | "STOP AND OUTPUT" matches (case-insensitive) | true |
| U-9 | "stop and output please" matches | true |
| U-10 | "stopand output" does NOT match | false |
| U-11 | "stop replying" matches | true |
| U-12 | "stop replying now coach" matches | true |
| U-13 | "stop and output" embedded mid-sentence does NOT trigger when feature disabled | (per disable toggle) |

### 6.3. Integration (manual or browser)

| # | Case | Expected |
|---|---|---|
| I-1 | Open `/co-pilot/coach` first time, grant mic permission | Mic auto-starts, listening indicator visible |
| I-2 | Open `/co-pilot/coach` after prior grant | Mic auto-starts immediately, no permission prompt |
| I-3 | Open `/co-pilot/coach`, deny mic permission | Banner shows; manual mic button at line 672 still works |
| I-4 | Auto-listen enabled, say "where should I go" → say "stop and output" | Mic stops; message sends as "where should I go" (phrase stripped) |
| I-5 | Coach answers via TTS; say "stop replying" mid-TTS | TTS stops; mic remains listening |
| I-6 | Coach finishes TTS naturally | Mic auto-resumes (no tap required) |
| I-7 | Tap big STOP button mid-TTS | TTS stops; mic remains listening |
| I-8 | Tap big STOP button when TTS not playing | Visually disabled, no action |
| I-9 | Auto-listen disabled in localStorage | Mic does NOT auto-start; manual toggle still works |
| I-10 | TTS playing, driver says "actually I changed my mind" (non-stop-phrase during TTS) | Speech captured but **suppressed** (feedback-loop guard); not sent |
| I-11 | TTS playing, driver says "actually I changed my mind STOP REPLYING" | TTS stops on "stop replying"; "actually I changed my mind" is suppressed (was during TTS) |

### 6.4. Driving-context manual smoke test (Melody)

| # | Case | Expected |
|---|---|---|
| D-1 | Switch to Coach tab while driving (parking-lot test) | Auto-listen starts within 1s of tab being visually active |
| D-2 | Ask Coach a question with hands on wheel + eyes on imagined road | Question is captured + sent without any tap |
| D-3 | Coach speaks back, mid-answer driver says "stop replying" | TTS stops within 500ms; mic stays on for follow-up |
| D-4 | Big stop bar visually located via peripheral vision (eyes forward) | Yes — full-width band at top is detectable peripherally |
| D-5 | Stop bar tappable without focal-attention (thumb to top-of-screen, eyes forward) | Yes — 80px target accommodates thumb travel without precision |

### 6.5. Feedback-loop integrity (the non-obvious risk from Q4)

| # | Case | Expected |
|---|---|---|
| F-1 | Phone speaker volume max, mic open during TTS, no headphones | TTS audio is captured by mic but **suppressed** (only stop-phrase regex acts during TTS) |
| F-2 | Same as F-1, TTS contains the literal phrase "stop replying" in its content | The Coach saying "you'll need to stop replying to..." within an answer **does NOT** trigger feedback-stop because the regex match is on the user's transcript, not the TTS output. The feedback-loop happens when ASR transcribes the TTS audio — at that point, the suppression rule fires. *Edge case to validate manually.* |
| F-3 | Headphone use (typical for paid drivers) | Feedback near-zero; behavior matches non-driving baseline |

---

## 7. Implementation Sequence (locked, post-approval)

1. Add `COACH_AUTO_LISTEN_ENABLED` to `storageKeys.ts` (1 line)
2. Modify `cleanTextForTTS.ts` for paragraph collapse (1 line)
3. Create `CoachStopBar.tsx` component
4. Add unit tests for `CoachStopBar` + `cleanTextForTTS`
5. Add mount-time auto-mic effect in `RideshareCoach.tsx`
6. Add stop-phrase effects in `RideshareCoach.tsx` (item 3 + 5)
7. Add auto-resume effect in `RideshareCoach.tsx` (item 6)
8. Integrate `<CoachStopBar />` at top of Coach scroll container
9. Add stop-phrase regex unit tests
10. Run `npm run typecheck` + `npm run lint` + `npm run test:unit tests/components tests/utils`
11. Update `RIDESHARE_COACH.md` §11
12. Append note to `AI_COACH_VOICE_PLAN.md`
13. Commit + push + create PR
14. Melody runs §6.4 driving-context smoke tests + §6.5 feedback-loop validation
15. Optional follow-up PR: extract `useStopPhrases` hook if regex set grows

---

## 8. Open Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Phone speaker + open mic feedback loop creates false stops | Medium | Per-call regex test only fires on user-said phrases; TTS-said "stop replying" within an answer doesn't trigger because the user's mic is what we read. Manual test F-2 validates |
| iOS Safari mic permission edge cases (background tab, low power mode) | Medium | Pre-existing constraint per `useTTS.ts:5-7`. Manual mic toggle remains as fallback |
| Stop phrase false positives ("stop and output the best venue") | Low | Substring match is intentional; user can avoid the phrase or use the big button. Documented in user-facing help |
| Battery cost of always-on mic | Low | Web Speech API uses on-device recognition; minimal radio cost. No worse than the existing mic-toggled mode while listening |

---

## 9. Stop Gate

**No code changes will occur until this plan is approved.**

Does this Phase 0 plan align with your problem statement and lock the seven features correctly? **(Y/N)**

- **Y** → I proceed to Phase 1 execution following §7's 15-step sequence.
- **N** → Tell me which Q1–Q10 to override or which architecture choice to revisit.

Specific items I'd flag for your attention before approving:
- **Q1** — defaulting auto-listen to ON for everyone (privacy implications for users who hadn't opted in to voice yet).
- **Q3** — paragraph-only pause reduction (less aggressive than your "slightly between periods, more between paragraphs" wording, because period-level control isn't engine-supported).
- **Q4** — feedback-loop suppression heuristic (filtering speech captured during TTS to stop-phrases only). This is technically correct but UX-unusual; if you want full transcription during TTS instead, say so and I'll redesign with headphone-required documentation.
- **Q6** — 80px (`h-20` Tailwind) full-width band. If you want it bigger, name a number and I'll size to it.

---

*Phase 0 ready for Melody's review. Plan locked, no code touched.*
