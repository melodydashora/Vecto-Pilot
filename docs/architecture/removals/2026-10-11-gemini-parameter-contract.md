# Gemini parameter contract comment preservation

October 11, 2026, Codex/Astra. The local parameter test draft replaces broad Flash/Pro assumptions with exact-model thinking and sampling policy. This record preserves comments removed from that draft and the updated README. Model pins are unchanged; no migration or deployment is recorded.

Original source revision: `380bdb619dfdea77be9b357f02e3ef62bc5a8e43`. Historical statements below are not current provider guidance.

October 12 follow-up: the paragraph above records the earlier parameter-only
draft. Offer Analyzer subsequently moved to Gemini 3.8 Flash at Melody's direction;
the [separate migration record](2026-10-12-offer-analyzer-gemini38.md) documents that
change. The adapter README's superseded draft status and general retry wording
are preserved here verbatim:

```text
Reviewed October 11, 2026 against the dispatcher and Gemini request contract. Parameter changes are a local test draft; model pins have not been replaced or deployed.

Use `MODEL_ROLES`, `getRoleConfig()`, and `LEGACY_ROLE_MAP` for the current role inventory. `getRoleConfig(role, { hasImages: true })` selects an explicit vision configuration when defined. Offer Analyzer text and image requests can therefore resolve to different models without changing the feature name.

Cross-provider hedging is controlled by `FALLBACK_ENABLED_ROLES` and `getFallbackConfig()` in the registry. A separate Gemini retry applies to a 503/unavailable result when the caller has not canceled. Parameter validation errors do not qualify. Read the source definitions for current retry targets and eligible roles.
```

## 1 Adapter comments

The October 12 Airport structured-output update superseded this adapter README
paragraph, retained verbatim:

```text
Google Search comes from the role's `google_search` feature. Synchronous JSON requests without grounding use `responseMimeType: 'application/json'`. Grounded requests omit that MIME setting because this adapter does not supply a schema; they request JSON through the prompt and existing extraction logic.
```

The associated Briefing UI now keeps the app available with an inline notice.
The MAIN trace's replaced sentence is retained verbatim:

```text
Verified cards remain visible alongside pending or failure notices, including through View Briefing on the first-failure screen.
```

File: `server/lib/ai/adapters/gemini-adapter.js`, header, thinking validator, and request configuration.

Reason: the prior comments generalized thinking support by model family, described null as disabling thinking, and treated temperature as effective on newer Flash models. Exact model policy now validates explicit levels, and the documentation distinguishes provider defaults from the retained streaming default.

```js
// Updated 2026-02-15: F-002 fix — Enforce MODEL_QUIRKS thinkingLevel validation
```

Verbatim retired-comment capture:

```text
 * 2026-02-15: F-002 fix — Validate and normalize thinkingLevel for Gemini models.
 * Pro models only support LOW and HIGH (MEDIUM causes 400 errors).
 * Flash models support MINIMAL, LOW, MEDIUM, and HIGH.
 * 2026-05-08: Predicate broadened from 'gemini-3' to 'gemini-' so the new
 * server-resolved aliases (gemini-pro-latest, gemini-flash-latest,
 * gemini-flash-lite-latest) also route through validation. Without this fix
 * the new aliases would skip validation entirely and 400 on MEDIUM-against-Pro.
 * 2026-05-29: Added MINIMAL to the Flash level set. gemini-3.5-flash (GA 2026-05-19)
 * exposes thinkingLevel minimal/low/medium/high (default medium) per
 * ai.google.dev/gemini-api/docs/interactions/whats-new-gemini-3.5. The SDK takes the
 * lowercase value via thinkingConfig.thinkingLevel; thinking_budget must NOT also be
 * sent (400) — this adapter never sends it, so HIGH thinking is safe here.
 * Returns the validated level in UPPERCASE for consistency; callers
 * convert to lowercase for the SDK or keep uppercase for REST API.
 * @param {string} model - The Gemini model name (e.g. "gemini-3.5-flash", "gemini-pro-latest")
 * @returns {string|null} Validated thinking level (UPPERCASE) or null if disabled
  // Flash models support all four levels (minimal added for 3.5 Flash)
  // Pro models only support LOW and HIGH — MEDIUM is not valid
  thinkingLevel = null, // Gemini 3.x: "minimal"/"low"/"medium"/"high" on Flash (minimal added for 3.5), "low"/"high" on Pro — validated in validateThinkingLevel(); null = disabled
    // JSON responses are capped at 0.2 for parse stability; a role that configures a
    // LOWER temperature (OFFER_ANALYZER 0.1, model-registry.js) is honored — 2026-08-17,
    // Melody: "temp config to .1". Roles at/above 0.2 keep the previous 0.2 behavior.
    // 2026-02-15: F-002 fix — Validate thinkingLevel before applying.
    // Pro models only support LOW/HIGH; MEDIUM is Flash-only.
  thinkingLevel = "high", // Gemini 3: "low", "high" - null = disabled
  // 2026-02-15: F-002 fix — Validate thinkingLevel before applying (matches callGemini).
  // Pro models only support LOW/HIGH; MEDIUM is Flash-only.
```

## 2 Registry thinking guidance

File: `server/lib/ai/model-registry.js`, the `MODEL_QUIRKS` introduction and Gemini-specific thinking entries.

Reason: documentary quirks duplicated family checks and incorrectly excluded MEDIUM for 3.1 Pro. The generation adapters now consume one exact-model policy. Unrelated provider quirks and the Live API contract are separate.

```js
/**
 * Model-specific quirks and limitations
 * 2026-02-15: Added Pro-specific quirks (F-002). NOTE (2026-08-17): documentary — gemini-adapter.js
 * validateThinkingLevel() uses its own flash/pro string checks and does not read MODEL_QUIRKS.
 *
 * Prefix matching: hasQuirk() checks model.startsWith(prefix) || model.includes(prefix).
 * More specific prefixes (e.g. 'gemini-3-pro') are checked alongside broader ones ('gemini-').
 */

  // 2026-02-15: F-002 — Pro models only support LOW and HIGH thinking levels.
  // MEDIUM is Flash-only (validateThinkingLevel() enforces this independently of this table).
  // 2026-05-08: Added 'gemini-pro' alias prefix to cover gemini-pro-latest (Google's
  // server-resolved alias to current Pro model). Legacy 'gemini-3-pro' / 'gemini-3.1-pro'
  // kept so env overrides pinning to specific versions still pick up the same quirks.
  'gemini-pro': {
    noMediumThinking: true,
    validThinkingLevels: ['LOW', 'HIGH'],
  },
  'gemini-3-pro': {
    noMediumThinking: true,
    validThinkingLevels: ['LOW', 'HIGH'],
  },
  // 2026-02-25: Gemini 3.1 Pro inherits same thinking constraints as 3 Pro
  'gemini-3.1-pro': {
    noMediumThinking: true,
    validThinkingLevels: ['LOW', 'HIGH'],
  },
  // 2026-05-08: Flash and Flash-Lite both support MEDIUM thinking; alias prefix added
  // for gemini-flash-latest / gemini-flash-lite-latest.
  'gemini-flash': {
    validThinkingLevels: ['LOW', 'MEDIUM', 'HIGH'],
  },
  'gemini-3-flash': {
    validThinkingLevels: ['LOW', 'MEDIUM', 'HIGH'],
  },
  // 2026-05-29: gemini-3.5-flash (GA 2026-05-19) adds a MINIMAL thinking level on top of
  // LOW/MEDIUM/HIGH (default MEDIUM). Verified via ai.google.dev/gemini-api/docs.
  'gemini-3.5-flash': {
    validThinkingLevels: ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'],
  },
```

## 3 Adapter README

File: `server/lib/ai/adapters/README.md`.

Reason: the January inventory included removed roles and superseded model assignments, and its fallback diagram contradicted registry pinning. The replacement links to the current registry and documents exact Gemini parameters, defaults, errors, and verification limits. The full prior README is preserved verbatim below.

````markdown
> **Last Verified:** 2026-01-08

# AI Adapters (`server/lib/ai/adapters/`)

## Purpose

Model-agnostic API adapters that normalize calls to different AI providers. **Always use `callModel()` from index.js** - never call provider APIs directly.

## Files

| File | Purpose | Provider |
|------|---------|----------|
| `index.js` | Main dispatcher - routes by role | All |
| `anthropic-adapter.js` | Claude API calls + web search | Anthropic |
| `openai-adapter.js` | GPT-5.2 / o1 calls | OpenAI |
| `gemini-adapter.js` | Gemini 3.0 Pro calls + Google Search | Google (Developer API) |
| `vertex-adapter.js` | Vertex AI Gemini calls (Google Cloud) | Google Cloud |
| `anthropic-sonnet45.js` | Claude Sonnet 4.5 raw calls | Anthropic |

## Usage

```javascript
import { callModel } from './index.js';

// Use {TABLE}_{FUNCTION} role names
const result = await callModel('STRATEGY_CORE', {
  system: 'You are a helpful assistant',
  user: 'Generate a strategy for...'
});

const events = await callModel('BRIEFING_EVENTS_DISCOVERY', {
  system: 'You are an event researcher',
  user: 'Find events in Dallas, TX'
});

// Legacy names still work (auto-mapped to new names)
const legacy = await callModel('strategist', { system, user }); // → STRATEGY_CORE

if (result.ok) {
  console.log(result.output);
} else {
  console.error(result.error);
}
```

## Available Roles

| Role | Purpose | Default Model |
|------|---------|---------------|
| **BRIEFINGS TABLE** |||
| `BRIEFING_TRAFFIC` | Traffic conditions | Gemini 3 Flash |
| `BRIEFING_NEWS` | Local news research | Gemini 3 Pro |
| `BRIEFING_EVENTS_DISCOVERY` | Event discovery | Gemini 3 Pro |
| `BRIEFING_EVENTS_VALIDATOR` | Event verification | Claude Opus 4.5 |
| **STRATEGIES TABLE** |||
| `STRATEGY_CORE` | Core strategic plan | Claude Opus 4.5 |
| `STRATEGY_CONTEXT` | Real-time context | Gemini 3 Pro |
| `STRATEGY_TACTICAL` | 1-hour tactical strategy | GPT-5.2 |
| `STRATEGY_DAILY` | 8-12hr daily strategy | Gemini 3 Pro |
| **VENUES TABLE** |||
| `VENUE_SCORER` | Smart Blocks venue scoring | GPT-5.2 |
| `VENUE_FILTER` | Fast venue filtering | Claude Haiku |
| `VENUE_TRAFFIC` | Venue traffic intel | Gemini 3 Pro |
| `VENUE_EVENT_VERIFIER` | Venue event verification | Gemini 3 Pro |
| **COACH TABLE** |||
| `COACH_CHAT` | AI Coach conversation | Gemini 3 Pro |
| **UTILITIES** |||
| `UTIL_MARKET_PARSER` | Market research parsing | GPT-5.2 |

## Response Format

```typescript
{
  ok: boolean,        // Success/failure
  output: string,     // AI response text
  error?: string,     // Error message if failed
  citations?: array   // Web search citations (if applicable)
}
```

## Provider-Specific Rules

### GPT-5.2 / o1 Models
- NO `temperature` parameter (causes 400 error)
- NO `top_p` parameter
- Use `reasoning_effort` (flat string: "low", "medium", "high")
- Use `max_completion_tokens` instead of `max_tokens`

### Gemini 3.0 Pro
- Use nested `thinkingConfig`, NOT flat `thinking_budget`
- Google Search enabled for roles with `features: ['google_search']`

### Claude Opus
- Supports web search via `web_search_20250305` tool
- Web search enabled for roles with `features: ['web_search']`

### Vertex AI (Google Cloud)
- Enterprise Gemini access via Google Cloud
- Requires Google Cloud project and authentication
- Supports Google Search grounding
- Use model prefix `vertex-` for explicit Vertex AI routing

```javascript
// Using Vertex AI adapter
import { isVertexAIAvailable, getVertexAIStatus } from './index.js';

if (isVertexAIAvailable()) {
  console.log('Vertex AI is configured:', getVertexAIStatus());
}
```

**Environment Variables:**
```bash
VERTEX_AI_ENABLED=true
GOOGLE_CLOUD_PROJECT=my-project-id
GOOGLE_CLOUD_LOCATION=us-central1  # optional, default us-central1
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json  # optional, uses ADC if not set
```

## Fallback Chain

```
Primary Model (from env via model-registry.js)
    ↓ (if fails)
Claude Opus fallback (for FALLBACK_ENABLED_ROLES)
    ↓ (if fails)
Return error
```

Fallback-enabled roles: `STRATEGY_TACTICAL`, `STRATEGY_CONTEXT`, `STRATEGY_DAILY`, `BRIEFING_EVENTS_DISCOVERY`, `BRIEFING_NEWS`

## Model pins (no environment variables)

2026-09-15: model names are pinned per role in `../model-registry.js` (`MODEL_ROLES[role].model`).
There is no `*_MODEL` env key and no override cascade — `getRoleConfig(role)` returns the pin.
Verify pins against the live provider lists with `node scripts/check-model-pins.mjs`
(part of `npm run guard`). API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`)
remain environment variables.

## Legacy Role Mapping

Old role names are automatically mapped to new names:

| Legacy | Maps To |
|--------|---------|
| `strategist` | `STRATEGY_CORE` |
| `briefer` | `STRATEGY_CONTEXT` |
| `consolidator` | `STRATEGY_TACTICAL` |
| `event_validator` | `BRIEFING_EVENTS_VALIDATOR` |
| `venue_planner` | `VENUE_SCORER` |
| `venue_filter` | `VENUE_FILTER` |
| `coach` | `COACH_CHAT` |
````
