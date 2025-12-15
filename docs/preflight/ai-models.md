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

## Gemini 3 Pro Parameters

```javascript
// CORRECT
{ generationConfig: { thinkingConfig: { thinkingLevel: "HIGH" } } }

// WRONG
{ thinking_budget: 8000 }
```

## Check Before Editing

- [ ] Am I using `callModel()` not direct API calls?
- [ ] Are model parameters in the correct format?
- [ ] Is the role name correct? (strategist, briefer, consolidator)
- [ ] Did I check `server/lib/ai/models-dictionary.js` for current config?
