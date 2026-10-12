# Offer Analyzer Gemini 3.8 restoration — October 12, 2026

Melody requested returning Offer Analyzer to Gemini 3.8 Flash while retaining GPT
for Coach and the existing venue configuration. The immediate and deep roles now
use the exact `gemini-3.8-flash` pin for text and images. Both use explicit LOW;
3.8 does not support MINIMAL. Existing 1,024/2,048 token caps and 20s/45s caller
deadlines are retained. Coach, venue, and Briefing roles were not changed here.

Authenticated model metadata lookup returned HTTP 200 and generateContent support.
[Google's 3.8 guide](https://ai.google.dev/gemini-api/docs/latest-model) confirms
LOW/MEDIUM/HIGH and removal of sampling controls. The existing Gemini adapter
already implements those parameters and the one-shot response field mask.

The prior temporary text/image provider split is retired. Offer Analyzer receives
one model attempt per phase: its scoped guard prevents the general Gemini 503
retry from switching it to the deprecated 3.5 ID. Other roles retain their retry
policies. Failures still pass through existing fail-hard model handling and
server adjudication; deep evidence cannot replace the spoken immediate decision.

A synthetic text+PNG adapter/role probe completed both actual model requests:
immediate STOP in 2.369s (85 output tokens), deep STOP in 3.085s (349 output tokens).
Both returned valid JSON within their unchanged caps; immediate data passed the
actual shared parser and adjudicator. This is one synthetic sample, not phone
latency certification or real-offer quality evidence. No application DB writes,
private offers, real GPS, or location provider calls occurred. The subsequent
503 guard affects only the failed-primary path, covered with mocked contracts.
Private-free synthetic request/response receipts remain in the ignored project
coordination directory; API keys are not recorded.

## Preserved replaced passages

These are the exact removed lines relative to the task's pre-edit working copy,
which already contained earlier authorized changes. They are historical evidence,
not current runtime instructions.

### server/lib/ai/model-registry.js

```text
  // Melody, 2026-10-09: OCR text uses OpenAI directly tonight. Image-bearing
  // requests retain the existing Gemini configuration so image evidence is kept.
    model: 'gpt-6-luna',
    reasoningEffort: 'none',
    vision: {
      model: 'gemini-3.5-flash-lite',
      temperature: 0.1, // Melody's setting; honored by the Gemini JSON adapter.
      thinkingLevel: 'MINIMAL',
      features: ['vision'],
    },
  // must not rewrite the spoken decision. Preserve the separately reviewed deep
  // role when changing other roles; report the model actually used on retries.
    model: 'gpt-6-luna',
    reasoningEffort: 'none',
    vision: {
      model: 'gemini-3.1-pro-preview',
      temperature: 0.2,
      thinkingLevel: 'LOW', // Preserve the existing Gemini deep-analysis setting.
      features: ['vision'],
    },
  // Offer Analyzer uses OpenAI for text and Gemini for images, with no cross-provider fallback.
```

### server/lib/ai/adapters/index.js

```text
    // A 3.5-flash primary retries on pinned Pro; any other primary (incl. OFFER_ANALYZER's
    // gemini-3.5-flash-lite) retries on 3.5-flash. The caller's remaining deadline
    if (is503 && primaryConfig.provider === 'google' && !params.signal?.aborted) {
```

### server/api/hooks/analyze-offer.js

```text
//   Phase 2 (Async):  Gemini 3.1 Pro deep analysis → rich reasoning saved to DB (fire-and-forget)
    // PHASE 2 — ASYNC: Deep Pro 3.1 analysis for DB enrichment
        // Phase 2 AI call — OFFER_ANALYZER_DEEP (Pro 3.1) for rich reasoning
        console.log(`[HOOKS] 🔬 PHASE 2: Calling OFFER_ANALYZER_DEEP (Pro 3.1, ${PHASE2_TIMEOUT_MS / 1000}s timeout)...`);
          || (phase1Response?.success ? 'gemini-3.5-flash' : 'rules-engine-deterministic');
            aiModelUsed = phase2Response.model || 'gemini-3.1-pro-preview'; // 2026-06-11: the model Phase 2 ACTUALLY ran (a 503 fallback correctly reports flash here)
```

### docs/architecture/OFFER_ANALYZER.md

```text
October 9, 2026, Melody's direction for tonight: both Offer Analyzer roles send
text-only requests directly to OpenAI, using the registry's exact pin and the
existing OCR text and prompts. They do not attempt Google first or retry Google
after an OpenAI failure. Requests containing an image, including mixed text/image
requests, select the registry's explicit vision configuration and stay on the
existing Gemini vision path. A future Google model addition is deferred; it is
not part of this change.

The OpenAI path uses JSON mode, disables SDK retries and completion storage, and rejects
dummy credentials, cancellation, refusal, truncation and incomplete responses.
The hook still validates/adjudicates the returned data; a model outage does not
authorize an invented ride acceptance. Resolved model provenance follows the
successful response. This change does not restore Google geocoding, timezone,
weather or air-quality access, and it does not add a city-based acceptance rule.
The existing Phase 2 timezone/storage requirements continue to apply.
```
