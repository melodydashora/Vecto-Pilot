# Plan: Real-Time Rider Translation Feature

**Date:** 2026-03-16
**Author:** Claude (Opus 4.6) + Melody
**Status:** IMPLEMENTED (Phase 1-5 complete, awaiting testing)
**Branch:** `claude/plan-translation-feature-arvDr`

---

## Context

Toyota Stadium in Frisco has been selected as a 2026 FIFA World Cup Team Base Camp Training Site. The team will be the winner of UEFA Play-Off Path B (Albania, Poland, Sweden, or Ukraine — decided March 26-31). The World Cup runs June 11 – July 19, 2026, meaning the Frisco/Toyota Stadium area will be flooded with international travelers for over a month.

Melody has already downloaded offline language packs on iOS via Siri. This feature enables real-time driver-rider communication across language barriers — a significant competitive advantage for airport runs and event-area pickups during the World Cup window.

---

## Objectives

1. **Real-time speech-to-text** in the rider's language (browser-native, free)
2. **AI-powered translation** via Gemini 3 Flash (fastest, cheapest — ~$0.0001/phrase)
3. **Text-to-speech playback** of translations for hands-free driving (existing `useTTS` hook)
4. **Split-screen "Rearview" UI** — driver sees English, rider sees their language (upside-down for backseat readability)
5. **Quick phrase buttons** for common rideshare phrases (zero-speech interaction)
6. **Siri Shortcut endpoint** for voice-triggered translation outside the app

---

## Architecture

### System Flow

```
┌─────────────────────────────────────────────────────┐
│              TranslationOverlay.tsx                  │
│  ┌───────────────────────────────────────────────┐  │
│  │  RIDER VIEW (CSS rotate 180°, 48-64px font)   │  │
│  │  Shows rider's language text                   │  │
│  ├───────────────────────────────────────────────┤  │
│  │  DRIVER VIEW (English, auto-TTS via speakers)  │  │
│  │  [🎤 Listen] [Quick Phrases ▼] [🌐 Lang]      │  │
│  └───────────────────────────────────────────────┘  │
└──────────────────┬──────────────────────────────────┘
                   │
        ┌──────────▼──────────┐
        │  Web Speech API     │  (on-device STT, free, no API cost)
        │  SpeechRecognition  │  Uses browser's built-in recognizer
        └──────────┬──────────┘
                   │ transcribed text + detected language
        ┌──────────▼──────────┐
        │  POST /api/translate│  (new endpoint)
        │  Gemini 3 Flash     │  UTIL_TRANSLATION role
        │  ~100-200ms         │  Detects language if unknown
        └──────────┬──────────┘
                   │ { translated_text, source_lang, target_lang }
        ┌──────────▼──────────┐
        │  useTTS() hook      │  (existing, enhanced with lang param)
        │  OpenAI tts-1-hd    │  Multi-language voice support
        └─────────────────────┘
```

### Siri Shortcut Flow (Secondary Input)

```
Driver says "Vecto Translate" →
  Siri listens to rider →
  POST /api/hooks/translate (device_id auth, no JWT) →
  Gemini Flash translates →
  Response: { voice: "They asked: Can you take the highway?", translated_text, detected_language } →
  Siri speaks English translation aloud
```

---

## Approach: Phased Implementation

### Phase 1: Core Translation Engine (Server)

**New file:** `server/api/translate/index.js`
- `POST /api/translate` — Authenticated endpoint for in-app translation
- Accepts: `{ text, sourceLang?, targetLang? }`
- Returns: `{ translatedText, detectedLang, targetLang, confidence }`
- Uses `callModel('UTIL_TRANSLATION')` via existing adapter infrastructure

**Modified file:** `server/lib/ai/model-registry.js`
- Add `UTIL_TRANSLATION` role → Gemini 3 Flash
- Config: `maxTokens: 512, temperature: 0.1` (deterministic translation)
- No thinking level needed (translation is extraction, not reasoning)

**New file:** `server/api/hooks/translate.js`
- `POST /api/hooks/translate` — Device-auth endpoint for Siri Shortcuts
- Same pattern as `analyze-offer.js` (device_id header, no JWT)
- Returns `voice` field for Siri "Speak Text" action

### Phase 2: Speech Recognition Hook (Client)

**New file:** `client/src/hooks/useSpeechRecognition.ts`
- Wraps browser `SpeechRecognition` / `webkitSpeechRecognition` API
- Exposes: `{ isListening, transcript, lang, start(lang), stop(), error }`
- Continuous mode for real-time transcription
- Language parameter for rider's language selection
- Graceful fallback if browser doesn't support it

### Phase 3: Translation UI Component (Client)

**New file:** `client/src/components/co-pilot/TranslationOverlay.tsx`
- Split-screen layout (CSS Grid, 50/50 vertical split)
- Top half: rider-facing, `transform: rotate(180deg)`, large font (48-64px)
- Bottom half: driver-facing, English text + controls
- Wake Lock API (`navigator.wakeLock.request('screen')`) to prevent sleep
- Auto-scroll on new messages
- Language selector (dropdown with flag icons)

**New file:** `client/src/components/co-pilot/QuickPhrases.tsx`
- Pre-loaded rideshare phrase buttons
- Categories: Greetings, Route, Comfort, Payment, Safety
- Examples: "Is the temperature okay?", "Do you have a preferred route?", "We're arriving now"
- Tapping a phrase instantly translates + displays + speaks

### Phase 4: TTS Enhancement (Client + Server)

**Modified file:** `client/src/hooks/useTTS.ts`
- Add optional `targetLang` parameter to `speak()` function
- Pass language to server for correct voice/accent selection

**Modified file:** `server/lib/external/tts-handler.js`
- Accept optional `language` parameter
- Map language codes to appropriate OpenAI voice (alloy for English, etc.)
- OpenAI TTS supports 57 languages natively

### Phase 5: Route Integration (Client)

**Modified file:** `client/src/constants/apiRoutes.ts`
- Add `TRANSLATE: { SEND: '/api/translate' }` route constant

**Modified file:** `client/src/pages/co-pilot/` (or routes file)
- Mount TranslationOverlay at `/co-pilot/translate`
- Add navigation button from Co-Pilot dashboard

**Modified file:** `server/bootstrap/routes.js`
- Mount `/api/translate` route group
- Mount `/api/hooks/translate` for Siri

---

## Files Affected

| File | Action | Purpose |
|------|--------|---------|
| `server/lib/ai/model-registry.js` | MODIFY | Add UTIL_TRANSLATION role |
| `server/api/translate/index.js` | CREATE | Authenticated translation endpoint |
| `server/api/hooks/translate.js` | CREATE | Siri Shortcut translation endpoint |
| `client/src/hooks/useSpeechRecognition.ts` | CREATE | Web Speech API wrapper hook |
| `client/src/hooks/useTTS.ts` | MODIFY | Add language parameter |
| `client/src/components/co-pilot/TranslationOverlay.tsx` | CREATE | Split-screen translation UI |
| `client/src/components/co-pilot/QuickPhrases.tsx` | CREATE | Pre-loaded phrase buttons |
| `client/src/constants/apiRoutes.ts` | MODIFY | Add TRANSLATE routes |
| `server/lib/external/tts-handler.js` | MODIFY | Multi-language TTS support |
| `server/bootstrap/routes.js` | MODIFY | Mount translation routes |
| `server/api/translate/README.md` | CREATE | API documentation |
| `client/src/components/co-pilot/README.md` | MODIFY | Component documentation |

---

## Priority Languages

Based on FIFA World Cup context and DFW demographics:

| Priority | Languages | Reason |
|----------|-----------|--------|
| P0 | Spanish | Largest non-English DFW population |
| P0 | Polish, Ukrainian, Swedish, Albanian | UEFA Play-Off Path B candidates |
| P1 | Portuguese, French, German | Major World Cup fan bases |
| P1 | Japanese, Korean | Significant DFW international traveler population |
| P2 | Arabic, Hindi, Mandarin | DFW airport international arrivals |

Web Speech API supports 100+ languages. Gemini Flash supports all major languages. No language limitation on the translation engine.

---

## Cost Analysis

| Component | Cost | Notes |
|-----------|------|-------|
| Web Speech API (STT) | **Free** | Browser-native, on-device |
| Gemini 3 Flash (translation) | ~$0.0001/phrase | 50-token input, 50-token output |
| OpenAI TTS (voice output) | ~$0.015/1000 chars | Existing cost, already budgeted |
| **Total per ride** | **< $0.01** | Even with 20+ phrases per ride |

---

## Test Cases

### Unit Tests

1. **Translation endpoint** — Verify JSON response structure `{ translatedText, detectedLang, targetLang }`
2. **Language detection** — Send Spanish text, confirm `detectedLang: "es"`
3. **Quick phrases** — Verify all phrase keys have translations for all P0 languages
4. **TTS language parameter** — Verify language is passed through to OpenAI API call
5. **Model registry** — Verify `UTIL_TRANSLATION` role resolves to Gemini 3 Flash

### Integration Tests

6. **Full translation pipeline** — STT → translate → TTS round-trip
7. **Siri hook endpoint** — `POST /api/hooks/translate` with device_id returns `voice` field
8. **Error handling** — Empty text, unsupported language, API timeout

### Manual Tests (Melody)

9. **Split-screen UI** — Rider text visible and readable from backseat (upside-down)
10. **Wake lock** — Screen stays on during translation session
11. **Auto-TTS** — Translation automatically plays through car speakers via Bluetooth
12. **Quick phrases** — Tap phrase → instant translation → auto-speak
13. **Siri Shortcut** — "Vecto Translate" → listen → speak English translation
14. **Offline degradation** — Graceful message when no network for translation API

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Web Speech API not supported on all browsers | Feature detection + graceful fallback message; Safari/Chrome both support it |
| Translation latency on slow networks | Show "Translating..." skeleton; Quick Phrases work with cached translations |
| TTS voice quality in non-English languages | OpenAI TTS-1-HD natively supports 57 languages with good quality |
| Screen rotation UX confusion | Clear visual divider between driver/rider halves; tutorial on first use |
| Battery drain from wake lock + continuous STT | Auto-timeout after 30s of silence; manual toggle to disable |

---

## What This Does NOT Include

- **No native iOS bridge** — Vecto-Pilot is a web app, not Capacitor/React Native
- **No offline translation** — Translation requires network (Gemini API); STT works offline in some browsers
- **No conversation history storage** — Translation is ephemeral per-ride (could be added later via coach_conversations)
- **No database schema changes** — This feature is stateless, no new tables needed

---

## Implementation Order

1. Model registry update (UTIL_TRANSLATION role) — 5 min
2. Server translation endpoint — 30 min
3. Siri hook endpoint — 20 min
4. Client speech recognition hook — 30 min
5. TTS enhancement (language param) — 15 min
6. TranslationOverlay component + QuickPhrases — 60 min
7. Route integration + API routes — 10 min
8. Testing + documentation — 30 min

**Total estimated scope: ~3.5 hours of implementation**

---

## Approval Checklist

- [ ] Melody approves architecture approach
- [ ] Melody approves file list (no unnecessary files)
- [ ] Melody approves Quick Phrase list
- [ ] Test cases pass (pending implementation)
- [ ] Documentation updated (README.md files)
