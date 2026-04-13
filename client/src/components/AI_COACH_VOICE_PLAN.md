# AI Coach Voice Integration Plan

**Created:** 2026-04-13
**Author:** Claude Opus 4.6 (in session with Melody)
**Status:** PLAN — awaiting testing approval
**Priority:** HIGH (Feature Request from coach-inbox.md + production DB)

---

## 1. Objective

Add **voice input** (speak to the coach) and **voice output** (hear the coach's response) to the AI Coach chat, reusing the battle-tested `useSpeechRecognition` and `useTTS` hooks already powering the Translation feature.

**User Story:** As a rideshare driver, I want to tap a mic button to ask my AI Coach a question hands-free, and hear the response read aloud through my car speakers — without taking my eyes off the road.

---

## 2. Current State Assessment

### What EXISTS and works today

| Component | File | Status |
|-----------|------|--------|
| `useSpeechRecognition` hook | `client/src/hooks/useSpeechRecognition.ts` | Production, used by TranslationOverlay |
| `useTTS` hook | `client/src/hooks/useTTS.ts` | Production, used by TranslationOverlay |
| TTS server endpoint | `server/api/chat/tts.js` → `POST /api/tts` | Production, auth-protected |
| TTS engine | `server/lib/external/tts-handler.js` | Production, OpenAI TTS-1-HD |
| AI Coach chat | `client/src/components/AICoach.tsx` | Production, text-only |
| AI Coach streaming | `server/api/chat/chat.js` | Production, SSE streaming |

### What does NOT exist

| Gap | Detail |
|-----|--------|
| Mic button in Coach UI | No `useSpeechRecognition` import or mic button in AICoach.tsx |
| Auto-TTS on coach response | No `useTTS` import or auto-speak logic in AICoach.tsx |
| Voice mode toggle | No UI toggle for enabling/disabling voice output |
| Stream-completion TTS trigger | No mechanism to detect when streaming response is complete and send full text to TTS |

### Dead code to be aware of (DO NOT USE)

The `_startVoiceChat()` function (AICoach.tsx:287-367) uses the **OpenAI Realtime API** via WebSocket. This is:
- **Disabled** (prefixed with `_`)
- **Expensive** (Realtime API pricing is ~10x standard TTS)
- **Complex** (requires ephemeral token, WebSocket, MediaRecorder, PCM16 audio encoding)
- **Unnecessary** — the `useSpeechRecognition` + `useTTS` approach is simpler, cheaper, and already proven

**Decision:** Do NOT enable `_startVoiceChat()`. Use the same hook-based approach as Translation.

---

## 3. Architecture: How Translation Does It (The Pattern to Follow)

### Speech-to-Text (STT) in TranslationOverlay

```
User taps mic → useSpeechRecognition.start('en')
  → Browser listens (free, on-device)
  → interim transcript shows in real-time
  → user taps mic again or silence timeout
  → useSpeechRecognition.stop()
  → 300ms delay (wait for final onresult events)
  → read latestTranscriptRef.current
  → send to translation API
```

**Key patterns:**
- `latestTranscriptRef` (useRef) avoids stale closure bug — React state `transcript` can be stale inside setTimeout
- 300ms delay after `stop()` ensures final `onresult` events are captured
- `speech.clear()` called before each new recording

### Text-to-Speech (TTS) in TranslationOverlay

```
Translation completes → addMessage() called
  → tts.speak(translatedText, targetLang)
  → POST /api/tts with auth header
  → OpenAI generates MP3 (tts-1-hd model)
  → Client plays via HTMLAudioElement
  → Interrupt-and-replace if already speaking
```

**Key patterns:**
- Auto-plays immediately after translation — no user action needed
- Language parameter selects voice (nova for non-English, alloy for English)
- `isSpeaking` state tracks playback
- `tts.stop()` available for manual interrupt

---

## 4. Implementation Plan

### Phase 1: Add Mic Button (STT → Send as Chat Message)

**File:** `client/src/components/AICoach.tsx`

**Changes:**

#### 1A. Import hooks
```typescript
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { useTTS } from '@/hooks/useTTS';
import { Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
```

#### 1B. Initialize hooks inside component
```typescript
const speech = useSpeechRecognition();
const tts = useTTS();
const latestTranscriptRef = useRef('');
const [voiceEnabled, setVoiceEnabled] = useState(() => {
  // Persist voice preference
  return localStorage.getItem(STORAGE_KEYS.COACH_VOICE_ENABLED) === 'true';
});
```

#### 1C. Sync transcript to ref (avoid stale closure)
```typescript
useEffect(() => {
  latestTranscriptRef.current = speech.transcript;
}, [speech.transcript]);
```

#### 1D. Add handleMicToggle function
```typescript
const handleMicToggle = useCallback(() => {
  if (speech.isListening) {
    // Stop listening, wait for final results, then send
    speech.stop();
    setTimeout(() => {
      const text = latestTranscriptRef.current.trim();
      if (text) {
        setInput(text);
        // Auto-send after a brief render cycle
        setTimeout(() => {
          // Trigger send programmatically
          sendRef.current?.();
        }, 50);
      }
      speech.clear();
    }, 300);
  } else {
    // Start listening in English
    speech.clear();
    speech.start('en');
  }
}, [speech]);
```

**Note:** We need a `sendRef` to avoid stale closure on `send()`. The `send` function depends on `input` state, so we need to either:
- Option A: Use a ref that always points to the latest `send` function
- Option B: Accept the transcript as a parameter to `send()`
- **Recommended: Option B** — add optional `overrideMessage` parameter to `send()`

#### 1E. Modify `send()` to accept optional message parameter
```typescript
async function send(overrideMessage?: string) {
  const messageText = overrideMessage || input.trim();
  if (!messageText && attachments.length === 0 || isStreaming) return;
  
  setInput("");  // Clear input regardless
  // ... rest of send() uses messageText instead of my
```

#### 1F. Update handleMicToggle to use send(text) directly
```typescript
const handleMicToggle = useCallback(() => {
  if (speech.isListening) {
    speech.stop();
    setTimeout(() => {
      const text = latestTranscriptRef.current.trim();
      if (text) {
        send(text);  // Direct send with transcript
      }
      speech.clear();
    }, 300);
  } else {
    speech.clear();
    speech.start('en');
  }
}, [speech, send]);
```

#### 1G. Add mic button to input area (between file upload and send buttons)
```tsx
{/* Mic Button */}
<Button
  onClick={handleMicToggle}
  size="icon"
  className={`rounded-full h-10 w-10 ${
    speech.isListening
      ? 'bg-red-500 hover:bg-red-600 animate-pulse'
      : 'bg-green-600 hover:bg-green-700'
  } text-white`}
  title={speech.isListening ? 'Stop listening' : 'Speak to coach'}
  disabled={isStreaming}
  data-testid="button-mic-toggle"
>
  {speech.isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
</Button>
```

#### 1H. Show interim transcript in input field while listening
```typescript
// In the Input component, show interim transcript while listening
value={speech.isListening ? speech.transcript : input}
```

This gives visual feedback that the speech is being captured.

---

### Phase 2: Add Auto-TTS on Coach Response (Coach Speaks Back)

**File:** `client/src/components/AICoach.tsx`

#### 2A. Add voice toggle button in header
```tsx
{/* Voice Output Toggle */}
<Button
  onClick={() => {
    const next = !voiceEnabled;
    setVoiceEnabled(next);
    localStorage.setItem(STORAGE_KEYS.COACH_VOICE_ENABLED, String(next));
    if (!next) tts.stop(); // Stop any current playback
  }}
  size="sm"
  variant="ghost"
  className="text-white hover:bg-white/20"
  title={voiceEnabled ? 'Mute coach voice' : 'Enable coach voice'}
  data-testid="button-voice-toggle"
>
  {voiceEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
</Button>
```

#### 2B. Trigger TTS when streaming completes
The critical question: **when do we know the coach's full response is ready?**

Looking at the streaming loop in `send()`:
1. SSE `data:` chunks arrive with `msg.delta` — these are partial text
2. When `done` is true from the reader, streaming is complete
3. The `finally` block runs after streaming ends

**Approach:** After the streaming while-loop ends but before the `finally` block, read the final assistant message and speak it.

```typescript
// After the streaming while-loop completes:
// Read the final complete response for TTS
if (voiceEnabled) {
  setMsgs(currentMsgs => {
    const lastMsg = currentMsgs[currentMsgs.length - 1];
    if (lastMsg?.role === 'assistant' && lastMsg.content) {
      // Strip action tags from spoken text (don't read [SAVE_NOTE: {...}] aloud)
      const spokenText = lastMsg.content
        .replace(/\[[\w_]+:\s*\{[^}]*\}\s*\]/g, '')  // Remove action tags
        .replace(/\*\*([^*]+)\*\*/g, '$1')            // Remove markdown bold
        .replace(/\*([^*]+)\*/g, '$1')                 // Remove markdown italic
        .replace(/```[\s\S]*?```/g, '')                // Remove code blocks
        .replace(/`([^`]+)`/g, '$1')                   // Remove inline code
        .replace(/#{1,6}\s/g, '')                      // Remove headers
        .replace(/\n{2,}/g, '. ')                      // Paragraphs → pauses
        .trim();
      
      if (spokenText.length > 0 && spokenText.length <= 4000) {
        tts.speak(spokenText, 'en');
      }
    }
    return currentMsgs;  // Don't modify, just read
  });
}
```

**Why 4000 char limit:** OpenAI TTS has a practical limit. Very long responses (full strategy breakdowns) should be truncated or skipped to avoid expensive API calls and long playback times. For responses > 4000 chars, we could truncate to first 2-3 paragraphs.

#### 2C. Stop TTS when user starts speaking
```typescript
// In handleMicToggle, when starting to listen:
if (tts.isSpeaking) {
  tts.stop();  // Interrupt coach if user starts talking
}
```

---

### Phase 3: Storage Key Registration

**File:** `client/src/constants/storageKeys.ts`

```typescript
// Add to STORAGE_KEYS:
COACH_VOICE_ENABLED: 'vecto_coach_voice_enabled',
```

---

## 5. Files Affected

| File | Change | LOC Est. |
|------|--------|----------|
| `client/src/components/AICoach.tsx` | Import hooks, add mic button, add voice toggle, add TTS trigger, modify send() | ~80 lines added/modified |
| `client/src/constants/storageKeys.ts` | Add `COACH_VOICE_ENABLED` key | 1 line |

**No server changes required.** The `/api/tts` endpoint and `tts-handler.js` already work perfectly. The `useSpeechRecognition` and `useTTS` hooks are production-ready.

**No new files.** Everything integrates into existing components.

---

## 6. UX Flow (End-to-End)

### Happy Path: Voice Conversation

```
1. Driver opens Strategy page (Coach is visible at bottom)
2. Driver taps green Mic button 🎤
   → Button turns red + pulses (recording indicator)
   → Input field shows real-time transcript ("Where should I go...")
3. Driver taps red mic again (or silence timeout ~5s)
   → 300ms wait for final transcript
   → Message auto-sends to coach
   → Input clears
4. Coach streams response (text appears in chat)
5. When streaming completes:
   → If voice toggle ON: auto-speaks English response via TTS
   → Action tags stripped, markdown cleaned before speaking
6. Driver can:
   → Tap mic again to interrupt + ask follow-up
   → Tap volume icon to toggle voice on/off
   → Type normally if preferred (mic is additive, not exclusive)
```

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| User taps mic while coach is speaking TTS | TTS stops immediately, mic starts listening |
| User taps mic while coach is streaming text | Disabled (mic button grayed during streaming) |
| User speaks but no text recognized | Nothing happens (empty transcript ignored) |
| Browser doesn't support Web Speech API | Mic button hidden, text-only mode |
| TTS fails (network error) | Toast notification, chat continues normally |
| Very long coach response (>4000 chars) | TTS speaks first ~4000 chars, truncates gracefully |
| User toggles voice OFF mid-playback | TTS stops immediately |
| Coach response contains only action tags | Nothing spoken (cleaned text is empty) |

---

## 7. Test Cases

### Manual Tests (Melody)

| # | Test | Expected |
|---|------|----------|
| T-1 | Tap mic, say "Where should I go?", tap mic again | Transcript appears in input → auto-sends → coach responds |
| T-2 | With voice ON, wait for coach response to finish streaming | Response is read aloud automatically |
| T-3 | While coach is speaking, tap mic | TTS stops, mic starts listening |
| T-4 | Toggle voice OFF | Volume icon changes to muted, no TTS on next response |
| T-5 | Toggle voice OFF while TTS playing | Playback stops immediately |
| T-6 | Refresh page with voice ON | Voice preference persists (localStorage) |
| T-7 | Type normally while voice ON | Text input works as before, response still spoken |
| T-8 | Send message with attachment + voice ON | Coach response spoken after streaming |
| T-9 | Coach response with [SAVE_NOTE: {...}] | Action tag NOT read aloud |
| T-10 | Coach response with **bold** and `code` | Markdown stripped, reads clean text |
| T-11 | Open on browser without Web Speech API support | Mic button not shown, everything else works |
| T-12 | Speak, but say nothing (silence) | Mic auto-stops on browser timeout, nothing sent |

---

## 8. Architectural Decisions

### Why reuse hooks instead of OpenAI Realtime API?

| Factor | Hook Approach (Recommended) | OpenAI Realtime API (Dead Code) |
|--------|---------------------------|--------------------------------|
| **Cost** | STT: Free (browser), TTS: ~$0.015/1K chars | ~$0.06/min audio (both directions) |
| **Complexity** | 2 hook imports + ~80 LOC | WebSocket + MediaRecorder + PCM16 + ephemeral tokens |
| **Reliability** | Proven in production (Translation) | Never used in production |
| **Latency** | STT: instant (on-device), TTS: ~500ms | ~200ms (slightly faster but requires open WebSocket) |
| **Offline STT** | Yes (browser handles it) | No (requires network) |
| **Maintenance** | Zero — hooks already maintained | New code path to maintain |

### Why not stream TTS chunk-by-chunk?

Streaming TTS (speaking each sentence as it arrives) would be faster for long responses, but:
1. **Complexity**: Need sentence boundary detection in streaming text
2. **Interruption**: If user interrupts mid-stream, need to cancel remaining chunks
3. **Action tags**: Tags can appear mid-response; harder to strip in chunks
4. **Cost**: Multiple small TTS calls cost more than one large call

**Decision:** Wait for full response, clean it, speak it once. Simpler, cheaper, reliable.
This can be enhanced to sentence-streaming in a future iteration if needed.

### Why a toggle instead of always-on?

- **Data cost**: TTS calls cost money ($0.015/1K chars)
- **Social context**: Driver may have passengers who shouldn't hear strategy advice
- **Preference**: Some drivers prefer reading; voice should be opt-in
- **Persistence**: Toggle state saved to localStorage for session continuity

---

## 9. Dead Code Cleanup (Optional, Separate PR)

The following dead voice code in AICoach.tsx can be removed in a follow-up:

| Lines | Code | Reason |
|-------|------|--------|
| 74 | `const [_isVoiceActive, setIsVoiceActive] = useState(false)` | Unused state |
| 75 | `const [_voiceTranscript, setVoiceTranscript] = useState("")` | Unused state |
| 81 | `const _audioContextRef = useRef<AudioContext \| null>(null)` | Unused ref |
| 287-367 | `_startVoiceChat()` function | OpenAI Realtime API, never called |
| 369-393 | `stopVoiceChat()` function | Companion to dead _startVoiceChat |
| 395-448 | `startAudioCapture()` function | Companion to dead _startVoiceChat |
| 450-466 | `handleRealtimeMessage()` function | Companion to dead _startVoiceChat |

**~180 lines** of dead code. Recommend removing in same PR to keep things clean.

---

## 10. Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| Web Speech API not supported in all browsers | Check `speech.isSupported`, hide mic button if false |
| OpenAI TTS API key missing/invalid | TTS fails gracefully with toast, chat works normally |
| Long responses = expensive TTS | 4000 char cap, voice is opt-in toggle |
| Stale closure on transcript | `latestTranscriptRef` pattern (proven in Translation) |
| User talks over TTS | `tts.stop()` called when mic starts |

**No new npm packages needed.** All dependencies are already installed.
**No database changes.** Voice is purely client-side + existing TTS endpoint.
**No new API routes.** Uses existing `POST /api/tts`.

---

## 11. Implementation Order

1. Add `COACH_VOICE_ENABLED` to storageKeys.ts (1 line)
2. Import hooks and icons in AICoach.tsx
3. Initialize hooks and state (voiceEnabled, latestTranscriptRef)
4. Add transcript-to-ref sync effect
5. Modify `send()` to accept optional `overrideMessage` param
6. Add `handleMicToggle()` function
7. Add mic button to input bar UI
8. Show interim transcript in input while listening
9. Add voice toggle button to header bar
10. Add TTS trigger after streaming completes
11. Add TTS interrupt when mic starts
12. Remove dead OpenAI Realtime code (~180 lines)
13. Test all 12 test cases
14. Update README.md for components directory

---

*Plan ready for Melody's review and testing approval.*
