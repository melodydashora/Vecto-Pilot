# Translation: current Siri pipeline

Source traced September 29, 2026. The browser Translator UI and `/api/translate`
were retired at Melody's request on September 13; see the retained
[retirement receipt](removals/2026-09-13-browser-translator.md). The old browser
walkthrough has been removed from this active document; its history remains in Git.

`Siri dictation → POST /api/hooks/translate → UTIL_TRANSLATION → validated JSON → Siri Speak Text`

| Boundary | Current source and contract |
|---|---|
| Mount | [server/bootstrap/routes.js](../../server/bootstrap/routes.js) mounts the independent hooks router. No MAIN run or snapshot is required. |
| Admission | [hooks/translate.js](../../server/api/hooks/translate.js) requires nonempty text and `device_id` in the JSON body; text is capped at 4,000 characters. `device_id` is metadata, **not authentication**. The deployed Shortcut's user-token migration remains deferred; this review did not add JWT authentication. |
| Rate limit | [rate-limit.js](../../server/middleware/rate-limit.js), `translationLimiter`: 30 requests/minute for the IP + submitted device identifier. This is not proof of device identity. |
| Model | The hook calls `callModel('UTIL_TRANSLATION')`. [model-registry.js](../../server/lib/ai/model-registry.js) owns its model/configuration; do not copy a dated model pin into this doc. |
| Prompt/parser | [translation-prompt.js](../../server/api/translate/translation-prompt.js) owns the conversational translation instructions and shared parser. Plain/fenced JSON and a JSON object embedded in prose are accepted; output must contain nonblank translated text, language codes, and finite confidence from 0 to 100. |
| Response | The returned target language must equal the requested target, case-insensitively. Success includes `voice`, `translatedText`, `detectedLang`, `targetLang`, confidence, and elapsed time. Confidence zero stays zero. Siri reads `voice`; the server does not call TTS here. |
| Cancellation | A response disconnect or 30-second deadline reaches the model adapter through `signal`; late completion cannot become success. This cannot guarantee a provider refunds work already accepted. |

The parser no longer “repairs” translation text by deleting control/URL/Markdown
fragments. Invalid output fails instead of becoming spoken success. Request logs
contain lengths/language metadata, not rider text or the device identifier.

This pipeline does not save driver preferences, generate Strategy, or invoke
Offer Analyzer. [Coach speech/TTS](RIDESHARE_COACH.md) is a separate authenticated
pipeline. No browser translation overlay, quick-phrase screen, browser STT,
retired routes, performance estimate, or language quality claim is implied here.

Verification: actual parser tests in `tests/translation-prompt.test.js` and mocked
route/provider regressions in `tests/independent/translation-welcome.test.js`
cover malformed output, wrong target language, zero confidence and disconnect.
No live translation provider was called in this review.
