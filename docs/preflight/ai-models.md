# Pre-flight: AI Models

Quick reference for AI model usage. Read before modifying any AI code.

## Current Models

| Role | Model | Use For |
|------|-------|---------|
| Strategist | `claude-opus-4-5-20251101` | Long-term strategy |
| Briefer | `gemini-3-pro-preview` | Events, traffic, news |
| Consolidator | `gpt-5.2` | Immediate tactics |
| Event Validator | `claude-opus-4-5-20251101` | Event verification |

## DO: Use the Adapter Pattern

```javascript
import { callModel } from './lib/ai/adapters/index.js';
const result = await callModel('strategist', { system, user });
```

## DON'T: Call APIs Directly

```javascript
// WRONG - Never do this
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic();
```

## GPT-5.2 Parameters (Critical)

```javascript
// CORRECT
{ model: "gpt-5.2", reasoning_effort: "medium", max_completion_tokens: 32000 }

// WRONG - causes 400 errors
{ reasoning: { effort: "medium" } }  // Nested format
{ temperature: 0.7 }                  // Not supported
```

## Gemini 3 Model IDs (Critical)

```javascript
// WRONG - causes 404 "model not found" error
model: "gemini-3-pro"     // INVALID!
model: "gemini-3-flash"   // INVALID!

// CORRECT - must include -preview suffix
model: "gemini-3-pro-preview"
model: "gemini-3-flash-preview"
```

## Gemini 3 thinkingLevel Parameters

```javascript
// CORRECT - Gemini 3 Pro only supports LOW or HIGH (not MEDIUM!)
{ generationConfig: { thinkingConfig: { thinkingLevel: "HIGH" } } }
{ generationConfig: { thinkingConfig: { thinkingLevel: "LOW" } } }

// WRONG - causes "thinking level not supported" error
{ generationConfig: { thinkingConfig: { thinkingLevel: "MEDIUM" } } }  // MEDIUM only for Flash!
{ thinking_budget: 8000 }  // Deprecated flat format
```

**Valid thinkingLevel values:**
- **Gemini 3 Pro**: `LOW`, `HIGH` only
- **Gemini 3 Flash**: `MINIMAL`, `LOW`, `MEDIUM`, `HIGH`

## Gemini 3 Token Budget (Critical)

> **Thinking consumes tokens from `maxOutputTokens`!**

| thinkingLevel | Min maxOutputTokens | Error if too low |
|---------------|---------------------|------------------|
| `LOW` | 2048 | Usually OK |
| `MEDIUM` | 4096 | May truncate |
| `HIGH` | **8192+** | `MAX_TOKENS, parts: 0` |

```javascript
// WRONG - thinking uses all tokens, 0 left for response
{ thinkingConfig: { thinkingLevel: "HIGH" }, maxOutputTokens: 2048 }

// CORRECT
{ thinkingConfig: { thinkingLevel: "HIGH" }, maxOutputTokens: 8192 }
```

## Check Before Editing

- [ ] Am I using `callModel()` not direct API calls?
- [ ] Are model parameters in the correct format?
- [ ] Is the role name correct? (strategist, briefer, consolidator)
- [ ] Did I check `server/lib/ai/models-dictionary.js` for current config?
