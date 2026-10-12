# AI adapters

Reviewed October 12, 2026 against the current dispatcher and Gemini request contract. Offer Analyzer text and image requests now use `gemini-3.8-flash`; Rideshare Coach and VenuePlanner retain their GPT assignments. This describes repository behavior, not proof of production deployment.

Use `callModel()` or `callModelStream()` from [index.js](index.js) for application model calls. Role names, model pins, image-specific settings, and fallback eligibility come from [model-registry.js](../model-registry.js). API keys remain environment variables; model names have no environment override.

## Files

| File | Purpose |
| --- | --- |
| `index.js` | Role dispatcher, hedged requests, and streaming dispatch |
| `gemini-adapter.js` | Gemini GenerateContent and streamed GenerateContent |
| `gemini-live-adapter.js` | Gemini Live token minting, separate from text generation |
| `coach-responses.js` | Canonical AI Coach OpenAI Responses transport |
| `openai-adapter.js` | OpenAI completions and web search |
| `anthropic-adapter.js` | Anthropic messages and web search |
| `anthropic-sonnet45.js` | Specialized Anthropic calls |
| `vertex-adapter.js` | Separate Google Cloud Vertex AI integration |

## Usage and responses

```javascript
import { callModel } from './index.js';

const result = await callModel('BRIEFING_EVENTS_DISCOVERY', {
  system: 'You are an event researcher.',
  user: 'Find events in Dallas, TX.',
});

if (result.ok) {
  console.log(result.output);
} else {
  console.error(result.error);
}
```

Successful dispatched responses contain `ok`, `success`, `output`, `text`, `model`, and `provider`, with optional latency and citation fields. Failed dispatched calls return `ok: false`, `success: false`, `error`, and `text: null`; unknown roles fail during resolution. Streaming returns a provider `Response` or throws. The reported configured model does not independently establish a provider's internal alias routing.

Use `MODEL_ROLES`, `getRoleConfig()`, and `LEGACY_ROLE_MAP` for the current role inventory. `getRoleConfig(role, { hasImages: true })` selects an explicit vision configuration when defined. Current Offer Analyzer text and image requests share the same Gemini 3.8 Flash pin.

## Gemini thinking and sampling

`getGeminiModelPolicy(model)` is the single exact-model policy used by both Gemini generation paths. This capability table does not assign models to roles.

| Exact model | Accepted thinking levels | Provider default | Adapter sampling parameters |
| --- | --- | --- | --- |
| `gemini-3.6-flash` | `MINIMAL`, `LOW`, `MEDIUM`, `HIGH` | `MEDIUM` | Omitted |
| `gemini-3.8-flash` | `LOW`, `MEDIUM`, `HIGH` | `MEDIUM` | Omitted |
| `gemini-3.5-flash-lite` | `MINIMAL`, `LOW`, `MEDIUM`, `HIGH` | `MINIMAL` | Omitted |
| `gemini-3.1-pro-preview` | `LOW`, `MEDIUM`, `HIGH` | `HIGH` | Existing behavior retained |

Explicit unsupported thinking levels fail before a provider request; they are never changed to a different level. Explicit levels also fail for a model without a verified policy. An unknown model with no explicit level remains subject to provider validation; a missing policy does not establish availability.

`callGemini()` defaults to `thinkingLevel: null`, omitting `thinkingConfig` and using the provider default. `callGeminiStream()` preserves its existing implicit `HIGH` default; explicit `null` omits its thinking configuration. Neither omission nor `MINIMAL` guarantees that thinking is off. [Google thinking guide](https://ai.google.dev/gemini-api/docs/generate-content/thinking#controlling-thinking)

The SDK path sends `config.thinkingConfig.thinkingLevel` in lowercase. Streamed REST sends `generationConfig.thinkingConfig.thinkingLevel` in uppercase. These adapters do not send `thinkingBudget`; Google rejects a request combining a budget with a level. [REST reference](https://ai.google.dev/api/generate-content#ThinkingConfig), [Gemini 3 guide](https://ai.google.dev/gemini-api/docs/generate-content/gemini-3)

Both paths omit `temperature`, `topP`, and `topK` when the exact policy sets `omitSamplingParameters`. Google documents these controls as ignored from 3.6 Flash and 3.5 Flash-Lite onward, with errors planned for future generations. HTTP 200 with a temperature proves acceptance, not that the value influenced generation. [Google migration guide](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.6#api-changes-and-parameter-updates)

Models retaining sampling keep the synchronous JSON temperature cap of `0.2`, honoring lower configured values. Other synchronous requests default to `0.7`; streaming defaults to `0.7` with `topP: 0.95` and `topK: 40`. Explicit temperature `0` is retained. Google recommends default sampling settings for older Gemini 3 models. [Gemini 3 guide](https://ai.google.dev/gemini-api/docs/generate-content/gemini-3)

## Grounding and failures

Google Search comes from the role's `google_search` feature. Synchronous JSON requests without grounding use `responseMimeType: 'application/json'`. Grounded requests omit that MIME setting because this adapter does not supply a schema; they request JSON through the prompt and existing extraction logic.

Synchronous one-shot `callGemini()` requests use a per-request `X-Goog-FieldMask` header to omit opaque `thoughtSignature` and `responseId` fields from the provider response. The mask retains text, thought flags, finish reasons, safety ratings, grounding metadata, prompt feedback, usage counts and model version. It does not reduce thinking or change role settings. Streaming and conversation history retain their existing signature behavior; this mask must not be reused for multi-turn or tool-call history.

In `callGemini()`, `MAX_TOKENS` remains a failure with `truncated: true`, even when partial text exists. Empty responses remain failures. Thinking tokens share the output cap; a parameter change does not justify accepting an incomplete result. Caller cancellation and provider errors continue through the existing failure paths. The streaming adapter returns the provider stream for its caller to consume.

Cross-provider hedging is controlled by `FALLBACK_ENABLED_ROLES` and `getFallbackConfig()` in the registry. A separate Gemini retry applies to a 503/unavailable result when the caller has not canceled, except for the two Offer Analyzer roles, which do not retry another model or provider. Parameter validation errors do not qualify. Read the source definitions for current retry targets and eligible roles.

## Verification boundaries

Authenticated model listing verifies catalog visibility for the configured key. A small GenerateContent probe checks that particular request shape and observed finish reason; it does not establish grounded research quality, image accuracy, voice support, or production readiness. Test each required capability on the intended model before claiming a migration is verified.

[gemini-model-parameters.test.js](../../../../tests/ai/gemini-model-parameters.test.js) covers mocked request contracts. [gemini-grounded-json.test.js](../../../../tests/ai/gemini-grounded-json.test.js) covers grounded JSON and truncation behavior. These are distinct from live provider checks. `node scripts/check-model-pins.mjs` checks registry pins against provider catalogs.

[gemini-response-field-mask.test.js](../../../../tests/ai/gemini-response-field-mask.test.js) uses the installed SDK with intercepted HTTP to verify the one-shot response mask, preserved failures, and unmasked streaming history without provider calls.

Live voice and Vertex AI use separate transports and parameter contracts. Do not apply this text-model policy to them by model-name substring.

Superseded guidance is preserved in [the October 11 removals record](../../../../docs/architecture/removals/2026-10-11-gemini-parameter-contract.md).
