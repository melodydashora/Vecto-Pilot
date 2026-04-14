> **Last Verified:** 2026-02-26

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
| `BRIEFING_WEATHER` | Weather intelligence | Gemini 3 Pro |
| `BRIEFING_TRAFFIC` | Traffic conditions | Gemini 3 Flash |
| `BRIEFING_NEWS` | Local news research | Gemini 3 Pro |
| `BRIEFING_EVENTS_DISCOVERY` | Event discovery | Gemini 3 Pro |
| **STRATEGIES TABLE** |||
| `STRATEGY_CORE` | Core strategic plan | Claude Opus 4.6 |
| `STRATEGY_CONTEXT` | Real-time context | Gemini 3 Pro |
| `STRATEGY_TACTICAL` | 1-hour tactical strategy | Claude Opus 4.6 |
| `STRATEGY_DAILY` | 8-12hr daily strategy | Claude Opus 4.6 |
| **VENUES TABLE** |||
| `VENUE_SCORER` | Smart Blocks venue scoring | GPT-5.2 |
| `VENUE_FILTER` | Fast venue filtering | Claude Haiku |
| `VENUE_TRAFFIC` | Venue traffic intel | Gemini 3 Pro |
| `VENUE_EVENT_VERIFIER` | Venue event verification | Gemini 3 Pro |
| **COACH TABLE** |||
| `COACH_CHAT` | Rideshare Coach conversation | Gemini 3 Pro |
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
- **Citation suppression** (2026-02-26): When `useSearch` is true, the adapter automatically injects a "no citations" directive into the system prompt. This prevents Gemini from embedding markdown citations (`[Source](url)`) in responses, which corrupt JSON parsing. Applied to both `callGemini` and `callGeminiStream`.
- **JSON preamble stripping**: When the response is expected to be JSON, any leading markdown prose (headers, bullet points) is stripped before JSON extraction. The old `isMarkdown` check that skipped extraction entirely has been removed — `skipJsonExtraction: true` is the correct opt-out mechanism.

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

## Environment Variables

```bash
# Role → Model mapping (override defaults via env vars)
# Defaults are in model-registry.js — only set these to OVERRIDE
STRATEGY_CORE_MODEL=claude-opus-4-6
STRATEGY_CONTEXT_MODEL=gemini-3.1-pro-preview
STRATEGY_TACTICAL_MODEL=claude-opus-4-6
STRATEGY_DAILY_MODEL=claude-opus-4-6
BRIEFING_EVENTS_MODEL=gemini-3.1-pro-preview
VENUE_SCORER_MODEL=gpt-5.4
VENUE_FILTER_MODEL=claude-haiku-4-5-20251001
AI_COACH_MODEL=gemini-3.1-pro-preview
```

## Legacy Role Mapping

Old role names are automatically mapped to new names:

| Legacy | Maps To |
|--------|---------|
| `strategist` | `STRATEGY_CORE` |
| `briefer` | `STRATEGY_CONTEXT` |
| `consolidator` | `STRATEGY_TACTICAL` |
| `venue_planner` | `VENUE_SCORER` |
| `venue_filter` | `VENUE_FILTER` |
| `coach` | `COACH_CHAT` |
