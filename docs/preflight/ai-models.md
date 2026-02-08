# Pre-flight: AI Models

Quick reference for AI model usage. Read before modifying any AI code.

**Last Updated:** 2026-01-14

---

## Current Frontier Models (January 2026)

| Provider | Model ID | Strengths | Cost |
|----------|----------|-----------|------|
| **Anthropic** | `claude-opus-4-6-20260201` | Best reasoning, code quality | $$$$ |
| **Anthropic** | `claude-sonnet-4-5-20250929` | Fast, cost-effective | $$ |
| **Anthropic** | `claude-sonnet-4-20250514` | Stable, agentic coding | $$ |
| **Anthropic** | `claude-haiku-4-5-20251201` | Fastest Claude, cheapest | $ |
| **Google** | `gemini-3-pro-preview` | Best speed (180 tok/s), multimodal, 2M context | $$ |
| **Google** | `gemini-3-flash-preview` | Ultra-fast, cheapest Google | $ |
| **OpenAI** | `gpt-5.2` | Best complex reasoning (AIME 100%) | $$$ |
| **OpenAI** | `gpt-5.2-pro` | Extended reasoning mode | $$$$ |

---

## Role Configuration

**NAMING CONVENTION:** `{TABLE}_{FUNCTION}` - Each role maps to a DB table destination.

### Briefings Table
| Role | Default Model | Purpose | Features |
|------|---------------|---------|----------|
| `BRIEFING_WEATHER` | `gemini-3-pro-preview` | Weather intelligence | google_search |
| `BRIEFING_TRAFFIC` | `gemini-3-pro-preview` | Traffic analysis (TomTom → Driver Advice) | google_search |
| `BRIEFING_NEWS` | `gemini-3-pro-preview` | Local news (7 days) | google_search, thinkingLevel: HIGH |
| `BRIEFING_NEWS_GPT` | `gpt-5.2` | News (parallel) | openai_web_search |
| `BRIEFING_EVENTS_DISCOVERY` | `gemini-3-pro-preview` | Event discovery | google_search, thinkingLevel: HIGH |
| `BRIEFING_EVENTS_VALIDATOR` | `claude-opus-4-6-20260201` | Event verification | web_search |
| `BRIEFING_FALLBACK` | `claude-opus-4-6-20260201` | General fallback | web_search |
| `BRIEFING_SCHOOLS` | `gemini-3-pro-preview` | School calendars | google_search |
| `BRIEFING_AIRPORT` | `gemini-3-pro-preview` | Airport conditions | google_search |

### Strategies Table
| Role | Default Model | Purpose | Features |
|------|---------------|---------|----------|
| `STRATEGY_CORE` | `claude-opus-4-6-20260201` | Core strategy (pure reasoning) | - |
| `STRATEGY_CONTEXT` | `gemini-3-pro-preview` | Real-time context | google_search, thinkingLevel: HIGH |
| `STRATEGY_TACTICAL` | `gpt-5.2` | 1-hour tactics | reasoningEffort: medium |
| `STRATEGY_DAILY` | `gemini-3-pro-preview` | 8-12hr daily strategy | google_search, thinkingLevel: HIGH |

### Venues Table (ranking_candidates)
| Role | Default Model | Purpose | Features |
|------|---------------|---------|----------|
| `VENUE_SCORER` | `gpt-5.2` | Smart Blocks scoring | reasoningEffort: medium |
| `VENUE_FILTER` | `gemini-3-flash-preview` | Fast venue filtering | temperature: 0, no search |
| `VENUE_TRAFFIC` | `gemini-3-pro-preview` | Venue traffic intel | google_search |
| `VENUE_EVENT_VERIFIER` | `gemini-3-pro-preview` | Event verification | - |

### Coach Table
| Role | Default Model | Purpose | Features |
|------|---------------|---------|----------|
| `COACH_CHAT` | `gemini-3-pro-preview` | AI Strategy Coach | google_search |

### Utilities (no DB write)
| Role | Default Model | Purpose |
|------|---------------|---------|
| `UTIL_WEATHER_VALIDATOR` | `gemini-3-pro-preview` | Validate weather data |
| `UTIL_TRAFFIC_VALIDATOR` | `gemini-3-pro-preview` | Validate traffic data |
| `UTIL_MARKET_PARSER` | `gpt-5.2` | Parse market research |

---

## Legacy Role Names

These still work via automatic mapping:

| Legacy Name | Maps To |
|-------------|---------|
| `strategist` | `STRATEGY_CORE` |
| `briefer` | `STRATEGY_CONTEXT` |
| `consolidator` | `STRATEGY_TACTICAL` |
| `event_validator` | `BRIEFING_EVENTS_VALIDATOR` |
| `venue_planner` | `VENUE_SCORER` |
| `venue_filter` | `VENUE_FILTER` |
| `haiku` | `VENUE_FILTER` |
| `coach` | `COACH_CHAT` |

---

## DO: Use the Adapter Pattern

```javascript
import { callModel } from './lib/ai/adapters/index.js';
const result = await callModel('STRATEGY_CORE', { system, user });
// or legacy:
const result = await callModel('strategist', { system, user });
```

## DON'T: Call APIs Directly

```javascript
// WRONG - Never do this
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic();
```

---

## Model-Specific Parameters

### GPT-5.2 Parameters (Critical)

```javascript
// CORRECT
{
  model: "gpt-5.2",
  reasoning_effort: "medium",      // "low" | "medium" | "high"
  max_completion_tokens: 32000
}

// WRONG - causes 400 errors
{ reasoning: { effort: "medium" } }  // Nested format INVALID
{ temperature: 0.7 }                  // Not supported on reasoning models
```

**reasoning_effort values:**
- `low`: Fast, minimal chain-of-thought
- `medium`: Balanced (default for most tasks)
- `high`: Deep reasoning, slower

### Gemini 3 Model IDs (Critical)

```javascript
// WRONG - causes 404 "model not found" error
model: "gemini-3-pro"      // INVALID!
model: "gemini-3-flash"    // INVALID!

// CORRECT - must include -preview suffix
model: "gemini-3-pro-preview"
model: "gemini-3-flash-preview"
```

### Gemini 3 thinkingLevel Parameters

```javascript
// CORRECT for Gemini 3 Pro (only LOW or HIGH)
{ generationConfig: { thinkingConfig: { thinkingLevel: "HIGH" } } }
{ generationConfig: { thinkingConfig: { thinkingLevel: "LOW" } } }

// WRONG - causes error on Gemini 3 Pro
{ generationConfig: { thinkingConfig: { thinkingLevel: "MEDIUM" } } }
// MEDIUM only works on Gemini 3 Flash!

// WRONG - deprecated format
{ thinking_budget: 8000 }
```

**Valid thinkingLevel by model:**
| Model | Valid Levels |
|-------|--------------|
| Gemini 3 Pro | `LOW`, `HIGH` |
| Gemini 3 Flash | `MINIMAL`, `LOW`, `MEDIUM`, `HIGH` |

### Gemini 3 Token Budget (Critical)

> **Thinking consumes tokens from `maxOutputTokens`!**

| thinkingLevel | Min maxOutputTokens | Risk if too low |
|---------------|---------------------|-----------------|
| `LOW` | 2048 | Usually OK |
| `MEDIUM` | 4096 | May truncate |
| `HIGH` | **8192+** | `MAX_TOKENS, parts: 0` error |

```javascript
// WRONG - thinking uses all tokens, 0 left for response
{ thinkingConfig: { thinkingLevel: "HIGH" }, maxOutputTokens: 2048 }

// CORRECT
{ thinkingConfig: { thinkingLevel: "HIGH" }, maxOutputTokens: 8192 }
```

### Claude Extended Thinking

Extended thinking is now available on Claude Opus 4.6, Sonnet 4.5, and Haiku 4.5:

```javascript
// Enable extended thinking
{
  thinking: {
    type: "enabled",
    budget_tokens: 10000  // Reserve for thinking
  },
  max_tokens: 16000  // Total output including thinking
}
```

---

## Environment Overrides

Override any role's model via environment variable:

```bash
# Override specific roles
BRIEFING_WEATHER_MODEL=gemini-3-flash-preview
BRIEFING_TRAFFIC_MODEL=gemini-3-pro-preview  # 2026-01-15: Single Briefer Model default
STRATEGY_CORE_MODEL=claude-sonnet-4-5-20250929
VENUE_FILTER_MODEL=claude-haiku-4-5-20251201

# Global defaults (used by diagnostics)
ANTHROPIC_MODEL=claude-opus-4-6-20260201
OPENAI_MODEL=gpt-5.2
GEMINI_MODEL=gemini-3-pro-preview
```

---

## Check Before Editing

- [ ] Am I using `callModel()` not direct API calls?
- [ ] Are model parameters in the correct format?
- [ ] Is the role name correct? (Use `{TABLE}_{FUNCTION}` format or legacy names)
- [ ] Did I check `server/lib/ai/model-registry.js` for current config?
- [ ] For Gemini: Is thinkingLevel valid for the model? (Pro: LOW/HIGH only)
- [ ] For Gemini: Is maxOutputTokens high enough for thinkingLevel?
- [ ] For GPT-5.2: Using `reasoning_effort` not `temperature`?

---

## Sources

- [Best AI Models January 2026](https://felloai.com/best-ai-of-january-2026/)
- [Claude API Documentation](https://docs.anthropic.com/en/api/models-list)
- [Gemini API Documentation](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/partner-models/claude)
- [OpenAI API Reference](https://platform.openai.com/docs)
