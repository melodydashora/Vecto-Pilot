# Translation API

Real-time text translation for driver-rider communication during rides.

**Created:** 2026-03-16 (FIFA World Cup rider translation feature)

## Architecture

```
Web Speech API (on-device STT) → POST /api/translate → Gemini 3 Flash → useTTS()
```

- **STT**: Browser-native `SpeechRecognition` API (free, on-device)
- **Translation**: `UTIL_TRANSLATION` role → Gemini 3 Flash (~100-200ms)
- **TTS**: OpenAI `tts-1-hd` via existing `/api/tts` endpoint

## Endpoints

### `POST /api/translate` (Authenticated)

Translate text between languages.

**Request:**
```json
{
  "text": "Is the temperature okay?",
  "sourceLang": "en",
  "targetLang": "es"
}
```

**Response:**
```json
{
  "success": true,
  "translatedText": "¿La temperatura está bien?",
  "detectedLang": "en",
  "targetLang": "es",
  "confidence": 98,
  "response_time_ms": 145
}
```

### `GET /api/translate/languages` (Authenticated)

Returns supported languages for the UI language selector.

### `POST /api/hooks/translate` (Device Auth)

Siri Shortcut translation endpoint. Same as `/api/translate` but uses `device_id` header auth (no JWT).

**Request:**
```json
{
  "text": "¿Puede tomar la autopista?",
  "device_id": "ABC123",
  "target_lang": "en",
  "source_lang": "auto"
}
```

**Response:**
```json
{
  "success": true,
  "voice": "They said: Can you take the highway?",
  "translatedText": "Can you take the highway?",
  "detectedLang": "es",
  "targetLang": "en",
  "response_time_ms": 132
}
```

## Files

| File | Purpose |
|------|---------|
| `server/api/translate/index.js` | Authenticated translation endpoint |
| `server/api/hooks/translate.js` | Siri Shortcut translation endpoint |
| `server/lib/ai/model-registry.js` | `UTIL_TRANSLATION` role definition |
| `client/src/hooks/useSpeechRecognition.ts` | Web Speech API hook |
| `client/src/hooks/useTTS.ts` | TTS hook (enhanced with language param) |
| `client/src/components/co-pilot/TranslationOverlay.tsx` | Split-screen translation UI |
| `client/src/components/co-pilot/QuickPhrases.tsx` | Pre-loaded phrase buttons |
| `client/src/pages/co-pilot/TranslationPage.tsx` | Page wrapper |

## Cost

| Component | Cost |
|-----------|------|
| Web Speech API (STT) | Free |
| Gemini 3 Flash (translation) | ~$0.0001/phrase |
| OpenAI TTS (voice) | ~$0.015/1000 chars |
| **Total per ride** | **< $0.01** |
