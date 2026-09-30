# AI model preflight — source map

> Reviewed 2026-09-29. Registry and adapter source establish current repository
> behavior; this card does not certify provider availability or list timeless
> provider parameter rules. Historical February configuration tables were retired
> in [the source-reconciliation record](../architecture/removals/2026-09-29-offer-analyzer-doc-reconciliation.md).

## Read the actual role and call path

1. Read `server/lib/ai/model-registry.js`: `MODEL_ROLES`, `getRoleConfig()`, role
   aliases, fallback eligibility/config and model quirks. Current role definitions
   use pinned `model` values, not the old `envKey`/`default` override convention.
   API credential environment variables are a separate concern; never print them.
2. Find the real caller with `rg`. Inspect which fields it supplies and which result
   fields it trusts. Role names generally group domains but are not a universal
   naming formula; `AI_COACH` and voice roles have specialized paths.
3. Read `server/lib/ai/adapters/index.js` and its imported router/provider adapter.
   Follow actual request construction, timeouts, cancellation, retries, output
   extraction and returned model provenance. A `features` label is not proof that
   every adapter enforces a capability.
4. For Coach, also read `server/lib/ai/adapters/coach-responses.js` and the active
   voice route/client. Complete Responses output and a bounded live bootstrap are
   different contracts; not every call uses the nonstreaming `callModel()` path.

## Relevant source boundaries

| Work | Read |
|---|---|
| Analyzer immediate/deep calls | `server/api/hooks/analyze-offer.js`; `server/lib/offers/rules-engine.js`; Phase-1 reconciliation; registry roles `OFFER_ANALYZER` and `OFFER_ANALYZER_DEEP`. |
| Provider requests | `server/lib/ai/adapters/gemini-adapter.js`, `openai-adapter.js`, `anthropic-adapter.js`, plus the actual router imported by `adapters/index.js`. |
| Brain/voice | `server/api/chat/chat.js`, `coach-live.js`; `coach-responses.js`; the current client voice session/delegation path. |
| MAIN boundaries | Provider callers and their prompt builders; distinguish admission receipts from the selected data projection supplied to a model. |

Parameter support depends on the actual pinned model, endpoint, installed SDK and
adapter. Do not copy an old provider-wide table into code or assume a chat model is
valid for a live/realtime endpoint. If a change needs external API facts, verify official
provider documentation for that specific contract. Do not switch model pins, change
architecture or perform a billable provider probe merely to repair documentation.

## Verification and evidence

- Use mocked contract tests for fields, response completion, failure states and model
  provenance. Check that cancellation reaches the SDK request and suppresses retries
  after abort; a stopped client wait does not prove provider work/billing stopped.
- Read relevant role/provider tests before changing defaults or fallback behavior.
  Analyzer cancellation cases live in `tests/ai/offer-cancellation.test.js`; sequential
  routing in `tests/ai/hedged-router-sequential.test.js`; Coach contracts in `tests/coach/`.
- Report commands and observed outcomes separately from source reasoning. Test fixtures
  do not certify real-device latency, live provider availability or deployment.
- Preserve removed policy/rationale in the existing dated removals system; update
  source pointers rather than recreating stale model tables in another document.
