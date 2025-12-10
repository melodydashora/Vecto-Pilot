# AI Adapters (`server/lib/ai/adapters/`)

## Purpose

Model-agnostic API adapters that normalize calls to different AI providers. **Always use `callModel()` from index.js** - never call provider APIs directly.

## Files

| File | Purpose | Provider |
|------|---------|----------|
| `index.js` | Main dispatcher - routes by role | All |
| `anthropic-adapter.js` | Claude API calls + web search | Anthropic |
| `openai-adapter.js` | GPT-5.1 / o1 calls | OpenAI |
| `gemini-adapter.js` | Gemini 3.0 Pro calls + Google Search | Google |
| `gemini-2.5-pro.js` | Gemini 2.5 Pro specific calls | Google |
| `anthropic-sonnet45.js` | Claude Sonnet 4.5 raw calls | Anthropic |

## Usage

```javascript
import { callModel } from './index.js';

// Call by role - adapter handles everything
const result = await callModel('strategist', {
  system: 'You are a helpful assistant',
  user: 'Generate a strategy for...'
});

if (result.ok) {
  console.log(result.output);
} else {
  console.error(result.error);
}
```

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

### GPT-5.1 / o1 Models
- NO `temperature` parameter (causes 400 error)
- NO `top_p` parameter
- Use `reasoning_effort` (flat string: "low", "medium", "high")
- Use `max_completion_tokens` instead of `max_tokens`

### Gemini 3.0 Pro
- Use nested `thinkingConfig`, NOT flat `thinking_budget`
- Google Search enabled for `briefer` and `consolidator` roles

### Claude Opus
- Supports web search via `web_search_20250305` tool
- Web search enabled for `event_validator` role

## Fallback Chain

```
Primary Model (from env)
    ↓ (if fails)
Claude Opus fallback (for consolidator, briefer roles)
    ↓ (if fails)
Return error
```

## Environment Variables

```bash
# Role → Model mapping
STRATEGY_STRATEGIST=claude-opus-4-5-20251101
STRATEGY_BRIEFER=gemini-3-pro-preview
STRATEGY_CONSOLIDATOR=gpt-5.1
STRATEGY_EVENT_VALIDATOR=claude-opus-4-5-20251101

# Per-role parameters (optional)
STRATEGY_STRATEGIST_MAX_TOKENS=8000
STRATEGY_STRATEGIST_TEMPERATURE=0.7
STRATEGY_CONSOLIDATOR_REASONING_EFFORT=medium
```
