# Offer Analyzer OpenAI text routing — comment preservation

October 9, 2026, Codex/Astra. Melody initially confirmed continuation of the
text-only Offer Analyzer backup, then directed OpenAI to be primary for tonight
and deferred a Google model addition until tomorrow. The existing vision path
stays unchanged. These comments were replaced because they described the prior
eligibility rule or generalized older model behavior. They are historical source
text, not current provider documentation.

From `server/lib/ai/adapters/index.js`, on the successful response model field:

```js
// 2026-06-11: expose the RESOLVED model id so callers log the truth, not a hardcoded literal
```

That intent remains. The former expression returned the primary model even when
a different provider succeeded; it now prefers the returned model and then the
winning provider's configured model.

From `server/lib/ai/model-registry.js`, above the fallback-enabled role list:

```js
// 2026-02-26: OFFER_ANALYZER removed — vision mode can't be hedged to non-vision fallback.
// OpenAI adapter doesn't pass images → GPT-5.2 responds first with empty data, discarding
// Gemini's actual vision analysis. Gemini-only is correct for image-based offer analysis.
```

The registry now selects by the actual presence of images. Text-only requests
use OpenAI directly; image-bearing requests retain their Gemini configuration.
The initially tested backup was not published before Melody's correction.

Additional registry comments replaced or moved when the default became OpenAI:

```js
// Temperature 0.1 is Melody's setting; the JSON adapter honors lower values.
// near-deterministic; honored by gemini-adapter (min with the JSON cap)
// documentary — no adapter reads this; vision works via images[] inlineData
// Pro only supports LOW/HIGH; LOW gives reasoning boost without full latency
// Melody, 2026-10-09: bounded, text-only OpenAI backup for tonight's OCR offers.
// Offer Analyzer defines its text-only backup on the role; image requests stay on Gemini.
```

The Gemini temperature/thinking values remain on the explicit vision config.
The final two comments describe the unpublished backup stage, superseded by
Melody's instruction to use OpenAI directly for tonight's text requests.

From `server/lib/ai/adapters/openai-adapter.js`:

```js
// o1 models and gpt-5 family use max_completion_tokens, other models use max_tokens
// GPT-5 family model behavior:
// - GPT-5.2: reasoning_effort only, NO temperature support
// - GPT-5.2: reasoning_effort only, NO temperature support (only default=1 allowed)
// - o1 models: reasoning_effort only, NO temperature support
// Add reasoning_effort for models that support it
// GPT-5 family and o1 models do NOT support custom temperature
// Only add temperature for older GPT-4 models
// On gpt-5 family, reasoning tokens count against max_completion_tokens — a
```

The adapter now recognizes the selected backup's model family and preserves the
existing omission of custom temperature for reasoning-model requests. Parameter
acceptance was tested with actual provider requests; the comments describe the
implemented request construction rather than a universal provider policy.
