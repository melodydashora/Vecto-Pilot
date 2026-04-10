# TRANSLATION.md — Internationalization and Translation System

> **Canonical reference** for the real-time driver-rider translation feature, language support, speech recognition, TTS, and UI localization status.
> Last updated: 2026-04-10

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Server-Side Translation API](#2-server-side-translation-api)
3. [Translation Prompt and Language Support](#3-translation-prompt-and-language-support)
4. [Client-Side: Speech Recognition](#4-client-side-speech-recognition)
5. [Client-Side: Translation Overlay UI](#5-client-side-translation-overlay-ui)
6. [Text-to-Speech (Multilingual)](#6-text-to-speech-multilingual)
7. [Quick Phrases](#7-quick-phrases)
8. [Siri Shortcuts Translation](#8-siri-shortcuts-translation)
9. [UI Localization Status](#9-ui-localization-status)
10. [RTL Support Status](#10-rtl-support-status)
11. [Adding a New Language](#11-adding-a-new-language)
12. [Current State](#12-current-state)
13. [Known Gaps](#13-known-gaps)
14. [TODO — Hardening Work](#14-todo--hardening-work)

---

## 1. Architecture Overview

This is a **just-in-time translation system** — not a traditional i18n library. Only conversational text between driver and rider is translated. All UI labels remain hardcoded in English.

```
Driver speaks English          Rider speaks Spanish
        │                              │
   Web Speech API (STT)          Web Speech API (STT)
        │                              │
   POST /api/translate            POST /api/translate
   { text, sourceLang:'en',      { text, sourceLang:'auto',
     targetLang:'es' }             targetLang:'en' }
        │                              │
   Gemini 3.1 Flash Lite         Gemini 3.1 Flash Lite
   (~100-200ms)                  (~100-200ms)
        │                              │
   POST /api/tts                  POST /api/tts
   { text: translated,            { text: translated,
     language: 'es' }              language: 'en' }
        │                              │
   OpenAI TTS-1-HD              OpenAI TTS-1-HD
   (nova voice)                  (alloy voice)
        │                              │
   Speaker plays Spanish         Speaker plays English
```

**No i18n libraries used.** No react-i18next, formatjs, or locale files. Intentional — this is a driver app in English-speaking markets.

---

## 2. Server-Side Translation API

### Main Endpoint

**Route:** `POST /api/translate`
**File:** `server/api/translate/index.js` (96 lines)
**Auth:** `requireAuth`
**Rate limit:** 30 req/min per IP+deviceId composite

**Request:**
```json
{ "text": "Is the temperature okay?", "sourceLang": "auto", "targetLang": "es" }
```

**Response:**
```json
{
  "success": true,
  "translatedText": "¿La temperatura está bien?",
  "detectedLang": "en",
  "targetLang": "es",
  "confidence": 95,
  "response_time_ms": 145
}
```

**Validation:**
- Empty text → 400
- Text >2000 chars → 400
- Translation failure → 500

**Model:** `UTIL_TRANSLATION` → `gemini-3.1-flash-lite-preview` | maxTokens: 512 | temp: 0.1

### Language List Endpoint

**Route:** `GET /api/translate/languages`
**Auth:** `requireAuth`
**Returns:** Map of ISO 639-1 codes to language names

### Siri Shortcuts Endpoint

**Route:** `POST /api/hooks/translate`
**File:** `server/api/hooks/translate.js` (102 lines)
**Auth:** Device-based (device_id header, no JWT — Siri can't send JWTs)
**Extra field:** `voice` — formatted for Siri's "Speak Text" action (`"They said: ${translatedText}"`)

---

## 3. Translation Prompt and Language Support

### System Prompt

**File:** `server/api/translate/translation-prompt.js` (lines 34–44)

```
You are a real-time translator for a rideshare driver communicating with passengers.
Rules:
1. If sourceLang is "auto", detect the source language from the text.
2. Translate naturally — conversational tone for a car ride, not formal/literary.
3. Keep translations concise and clear.
4. Preserve the meaning and tone of the original.
Output format: {"translatedText":"...","detectedLang":"ISO 639-1","targetLang":"ISO 639-1","confidence":0-100}
```

### 20 Supported Languages

Prioritized for FIFA World Cup 2026 DFW market demographics:

| Code | Language | Code | Language |
|------|----------|------|----------|
| en | English | zh | Mandarin Chinese |
| es | Spanish | it | Italian |
| pl | Polish | ru | Russian |
| uk | Ukrainian | tr | Turkish |
| sv | Swedish | vi | Vietnamese |
| sq | Albanian | th | Thai |
| pt | Portuguese | tl | Filipino/Tagalog |
| fr | French | ar | Arabic |
| de | German | hi | Hindi |
| ja | Japanese | ko | Korean |

### JSON Response Parser (3-Attempt Fallback)

**File:** `translation-prompt.js` (lines 54–92)

1. Direct parse after stripping markdown fences
2. Extract first JSON object from prose (find `{` to `}`)
3. Aggressive cleanup: strip control chars, markdown links, URL fragments

---

## 4. Client-Side: Speech Recognition

### useSpeechRecognition Hook

**File:** `client/src/hooks/useSpeechRecognition.ts` (218 lines)
**Technology:** Web Speech API (on-device STT — free, zero API cost)
**Browser support:** Chrome 33+, Safari 14.1+, Edge 79+

### BCP 47 Locale Mapping (lines 68–89)

```typescript
const LANG_TO_BCP47 = {
  en: 'en-US', es: 'es-ES', pl: 'pl-PL', uk: 'uk-UA', sv: 'sv-SE',
  sq: 'sq-AL', pt: 'pt-BR', fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP',
  ko: 'ko-KR', zh: 'zh-CN', ar: 'ar-SA', hi: 'hi-IN', it: 'it-IT',
  ru: 'ru-RU', tr: 'tr-TR', vi: 'vi-VN', th: 'th-TH', tl: 'fil-PH'
};
```

**Features:**
- Interim results: real-time transcript while speaking
- Final results: committed on speech end
- Ref tracking to avoid stale closure bugs
- Error distinction: operational (`no-speech`, `aborted`) vs actual errors

---

## 5. Client-Side: Translation Overlay UI

### Component

**File:** `client/src/components/co-pilot/TranslationOverlay.tsx` (604 lines)
**Route:** `/co-pilot/translate` (via `TranslationPage.tsx` wrapper)

### Split-Screen Layout

```
┌─────────────────────────────┐
│   RIDER PANEL (rotated 180°)│  ← Backseat perspective
│   Shows translated text     │
│   in rider's language       │
│   🎤 Rider speak button     │
├─────────────────────────────┤
│   ─── Language Divider ───  │
├─────────────────────────────┤
│   DRIVER PANEL              │  ← Normal orientation
│   Shows English text        │
│   🎤 Driver speak button    │
│   📝 Quick phrases button   │
└─────────────────────────────┘
```

### Key Features

- **Language picker:** Modal with flag emoji + native script name + English name
- **Auto-detect rider language:** First translation auto-sets `riderLang` from detected language
- **Auto-translate on speech stop:** When recognizer finishes, auto-translates and plays TTS
- **Wake Lock:** Prevents screen sleep during translation sessions
- **Mic permission preflight:** Requests mic on mount (avoids prompt on first tap)
- **Auth pre-check:** Verifies JWT before API call (fails fast with toast on expired session)

### Rider Intro Text (15 languages)

Pre-translated intro shown in rider panel before conversation starts:
```
ES: "Tu conductor usa un traductor. Toca 🎤 para hablar en español."
AR: "يستخدم سائقك مترجمًا. اضغط على 🎤 للتحدث بالعربية."
ZH: "您的司机正在使用翻译器。点击 🎤 用中文说话。"
```

---

## 6. Text-to-Speech (Multilingual)

### TTS Endpoint

**Route:** `POST /api/tts`
**File:** `server/api/chat/tts.js` (48 lines)
**Auth:** `requireAuth`
**Model:** OpenAI `tts-1-hd`

### Voice Selection

**File:** `server/lib/external/tts-handler.js` (59 lines)

| Language | Voice | Reason |
|----------|-------|--------|
| English | `alloy` | Most natural for English |
| All 19 others | `nova` | Better pronunciation for non-English |

### Client Hook

**File:** `client/src/hooks/useTTS.ts` (101 lines)

- Interrupt & replace: stops current audio, plays new
- Auto-cleanup: releases audio URL after playback
- Error handling: toast notifications

---

## 7. Quick Phrases

**File:** `client/src/components/co-pilot/QuickPhrases.tsx` (104 lines)

16 pre-loaded English phrases across 5 categories:

| Category | Count | Examples |
|----------|-------|---------|
| Greeting | 3 | "Welcome!", "My name is...", World Cup wishes |
| Route | 5 | Destination confirm, preferred route, ETA, traffic |
| Comfort | 4 | Temperature, music, water, phone charger |
| Payment | 2 | "Your fare is pre-paid", tips |
| Safety | 2 | Seatbelt, safe pullover |

**Strategy:** All phrases stored in English, translated on-the-fly via API. Avoids maintaining 20 locale files.

---

## 8. Siri Shortcuts Translation

**Route:** `POST /api/hooks/translate`
**Auth:** `device_id` header (no JWT)

Same translation pipeline but returns extra `voice` field formatted for Siri's "Speak Text" action.

---

## 9. UI Localization Status

### Status: NOT IMPLEMENTED (Intentional)

All UI labels in GlobalHeader, BottomTabNavigation, StrategyPage, BriefingPage, etc. are **hardcoded in English**. This is intentional because:

1. This is a **driver app** — drivers in the target market speak English
2. Only **conversational text** between driver and rider gets translated
3. No user-facing UI needs localization
4. No i18n library (`react-i18next`, `formatjs`, etc.) is installed

### Which Strings Are Translated vs Hardcoded

| Content Type | Translated? | Method |
|-------------|------------|--------|
| Driver-rider conversation | Yes | LLM (Gemini Flash Lite) |
| Quick phrases | Yes | LLM on-the-fly |
| Rider intro text | Yes | Pre-translated (15 languages) |
| UI labels (tabs, headers, buttons) | No | Hardcoded English |
| Strategy text | No | Generated in English |
| Briefing content | No | Generated in English |
| Error messages | No | Hardcoded English |
| Coach chat | No | English only |

---

## 10. RTL Support Status

### Status: NOT IMPLEMENTED

Arabic (`ar`) is in the supported language list, and Arabic text renders correctly (Unicode RTL), but:

- No `dir="rtl"` attribute on any container
- No RTL-aware CSS (`writing-mode`, `text-align: right`, `direction: rtl`)
- Buttons and controls remain LTR
- Layout doesn't mirror for RTL languages

Arabic text displays but the UI chrome around it is wrong for RTL readers.

---

## 11. Adding a New Language

### Step 1: Server

Add language code + name to `SUPPORTED_LANGUAGES` in `server/api/translate/translation-prompt.js` (lines 9–30).

### Step 2: Client Speech Recognition

Add BCP 47 locale mapping in `client/src/hooks/useSpeechRecognition.ts` (lines 68–89):
```typescript
// Example: adding Indonesian
id: 'id-ID',
```

### Step 3: Client Rider Intro

Add pre-translated intro text in `TranslationOverlay.tsx` (lines 28–46).

### Step 4: TTS Voice

If the language needs the `nova` voice (most non-English do), add to `NOVA_LANGUAGES` set in `server/lib/external/tts-handler.js` (lines 13–19).

### Step 5: Test

Verify: Web Speech API recognizes the language, Gemini translates accurately, TTS pronounces correctly.

**No locale files to create.** No i18n keys to add. The LLM handles translation dynamically.

---

## 12. Current State

| Area | Status |
|------|--------|
| Real-time driver-rider translation | Working — 20 languages |
| Web Speech API (STT) | Working — on-device, free |
| Gemini Flash Lite translation | Working — ~100-200ms |
| OpenAI TTS (multilingual) | Working — nova/alloy voices |
| Split-screen UI (180° rider panel) | Working |
| Quick phrases (16 pre-loaded) | Working |
| Language auto-detection | Working — LLM-based |
| Wake Lock during session | Working |
| Siri Shortcuts translation | Working — device_id auth |
| Rate limiting (30/min) | Working |

---

## 13. Known Gaps

1. **No RTL support** — Arabic/Hebrew text renders but controls stay LTR.
2. **No offline fallback** — Requires internet for every phrase (LLM-dependent).
3. **No translation caching** — Common phrases re-translated every time. "Where are you going?" translates fresh each use.
4. **No translation quality feedback** — No thumbs up/down on translations.
5. **No dialect support** — Spanish is `es-ES` only, not `es-MX` (Mexican Spanish). Portuguese is `pt-BR` only.
6. **Web Speech API browser dependency** — Doesn't work in Firefox. No fallback STT.
7. **Single TTS voice per language** — No gender or accent options.
8. **UI labels not translatable** — If app expands to non-English markets, full i18n would be needed.

---

## 14. TODO — Hardening Work

- [ ] **Add RTL support** — `dir="rtl"` on containers, mirrored layout for Arabic/Hebrew
- [ ] **Translation caching** — LRU cache (client-side localStorage or server-side Redis) for repeated phrases
- [ ] **Add dialect variants** — `es-MX` for Mexican Spanish, `pt-PT` for European Portuguese
- [ ] **Translation quality feedback** — Thumbs up/down per translation for model tuning
- [ ] **Offline phrase pack** — Pre-translate top 50 phrases per language for offline use
- [ ] **Firefox STT fallback** — Integrate Whisper API or similar when Web Speech API unavailable
- [ ] **Multiple TTS voices** — Gender and accent selection per language
- [ ] **Add language confidence display** — Show auto-detection confidence to driver

---

## Supersedes

No existing architecture doc covers translation. `server/api/translate/README.md` (85 lines) provides API reference but not full system architecture.

---

## Key Files

| File | Purpose |
|------|---------|
| `server/api/translate/index.js` | Main translation endpoint (96 lines) |
| `server/api/translate/translation-prompt.js` | System prompt + languages + JSON parser |
| `server/api/hooks/translate.js` | Siri Shortcuts translation (102 lines) |
| `server/api/chat/tts.js` | TTS endpoint (48 lines) |
| `server/lib/external/tts-handler.js` | Voice selection logic (59 lines) |
| `client/src/components/co-pilot/TranslationOverlay.tsx` | Split-screen UI (604 lines) |
| `client/src/components/co-pilot/QuickPhrases.tsx` | Pre-loaded phrases (104 lines) |
| `client/src/hooks/useSpeechRecognition.ts` | Web Speech API hook (218 lines) |
| `client/src/hooks/useTTS.ts` | TTS playback hook (101 lines) |
| `server/lib/ai/model-registry.js` | UTIL_TRANSLATION config |

### Cost per Ride

| Component | Cost |
|-----------|------|
| Web Speech API (STT) | Free (on-device) |
| Gemini Flash Lite (translation) | ~$0.005/ride (20-30 phrases) |
| OpenAI TTS-1-HD | ~$0.005/ride |
| **Total** | **<$0.01/ride** |
