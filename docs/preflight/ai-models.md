# Pre-flight: AI Models

Quick reference for AI model usage. Read before modifying any AI code.

**Last Updated:** 2026-02-15

---

## Current Frontier Models (January 2026)

| Provider | Model ID | Strengths | Cost |
|----------|----------|-----------|------|
| **Anthropic** | `claude-opus-4-6` | Best reasoning, code quality | $$$$ |
| **Anthropic** | `claude-sonnet-4-5-20250929` | Fast, cost-effective | $$ |
| **Anthropic** | `claude-sonnet-4-20250514` | Stable, agentic coding | $$ |
| **Anthropic** | `claude-haiku-4-5-20251001` | Fastest Claude, cheapest | $ |
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
| `BRIEFING_EVENTS_VALIDATOR` | `claude-opus-4-6` | Event verification | web_search |
| `BRIEFING_FALLBACK` | `claude-opus-4-6` | General fallback | web_search |
| `BRIEFING_SCHOOLS` | `gemini-3-pro-preview` | School calendars | google_search |
| `BRIEFING_AIRPORT` | `gemini-3-pro-preview` | Airport conditions | google_search |

### Strategies Table
| Role | Default Model | Purpose | Features |
|------|---------------|---------|----------|
| `STRATEGY_CORE` | `claude-opus-4-6` | Core strategy (pure reasoning) | - |
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

The adapter enforces validation on `thinkingLevel` to prevent API errors.

```javascript
// CORRECT for Gemini 3 Pro (only LOW or HIGH)
{ thinkingLevel: "HIGH" }
{ thinkingLevel: "LOW" }

// WARNING - Not supported on Gemini 3 Pro
{ thinkingLevel: "MEDIUM" }
// MEDIUM only works on Gemini 3 Flash!
// Adapter auto-corrects Pro/MEDIUM to HIGH (with warning).

// WRONG - deprecated format
{ thinking_budget: 8000 }
```

**Valid thinkingLevel by model:**
| Model | Valid Levels | Behavior on Invalid |
|-------|--------------|---------------------|
| Gemini 3 Pro | `LOW`, `HIGH` | Auto-corrects to `HIGH` |
| Gemini 3 Flash | `LOW`, `MEDIUM`, `HIGH` | Defaults to `LOW` |

### Gemini 3 Token Budget (Critical)

> **Thinking consumes tokens from `maxTokens`.**