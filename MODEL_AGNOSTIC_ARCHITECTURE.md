# Model-Agnostic Architecture - Vecto Pilot™

**Status:** ✅ 100% Model-Agnostic  
**Last Updated:** November 20, 2025

---

## Overview

Vecto Pilot now has a **fully model-agnostic architecture** where AI models can be swapped via environment variables without any code changes. The system uses a role-based dispatch pattern that routes requests to the appropriate AI provider based on model name prefixes.

---

## Architecture Pattern

### Role-Based Dispatch System

```
User Request → callModel(role, params) → Provider Dispatcher → Specific Adapter → AI Provider
```

**Example Flow:**
```javascript
// In your code
const result = await callModel("briefer", {
  system: "You are a travel researcher...",
  user: "Research conditions in Dallas..."
});

// Behind the scenes:
// 1. callModel() reads STRATEGY_BRIEFER env var → "sonar-pro"
// 2. Sees "sonar-" prefix → Routes to Perplexity adapter
// 3. callPerplexity() makes API request
// 4. Returns standardized { ok: true, output: "...", citations: [...] }
```

---

## Supported Providers

### Provider Auto-Detection

The system automatically detects the provider based on model name prefixes:

| Prefix | Provider | Example Models | Adapter File |
|--------|----------|----------------|--------------|
| `claude-` | Anthropic | `claude-sonnet-4-5-20250514` | `anthropic-adapter.js` |
| `gpt-`, `o1-` | OpenAI | `gpt-5.1-turbo`, `gpt-4o`, `o1-preview` | `openai-adapter.js` |
| `gemini-` | Google | `gemini-2.5-pro`, `gemini-2.0-flash` | `gemini-adapter.js` |
| `sonar-` | Perplexity | `sonar-pro`, `sonar` | `perplexity-adapter.js` |

---

## Waterfall Pipeline Roles

### 1. Strategist
**Purpose:** Generate high-level strategic overview  
**Default Model:** Claude Sonnet 4.5  
**Environment Variables:**
```bash
STRATEGY_STRATEGIST=claude-sonnet-4-5-20250514
STRATEGY_STRATEGIST_MAX_TOKENS=4000
STRATEGY_STRATEGIST_TEMPERATURE=0.2
```

**File:** `server/lib/providers/minstrategy.js`  
**Usage:**
```javascript
const result = await callModel("strategist", {
  system: "You are a rideshare strategy analyst...",
  user: "Analyze positioning opportunities..."
});
```

---

### 2. Briefer
**Purpose:** Comprehensive travel and rideshare intelligence research  
**Default Model:** Perplexity Sonar Pro  
**Environment Variables:**
```bash
STRATEGY_BRIEFER=sonar-pro
STRATEGY_BRIEFER_MAX_TOKENS=4000
STRATEGY_BRIEFER_TEMPERATURE=0.2
```

**File:** `server/lib/providers/briefing.js`  
**Usage:**
```javascript
const result = await callModel("briefer", {
  system: "You are a travel intelligence researcher...",
  user: "Research travel conditions in ${city}..."
});
```

**Output:** Returns `{ ok, output, citations }` with Perplexity citations

---

### 3. Consolidator
**Purpose:** Synthesize all provider outputs into actionable strategy  
**Default Model:** GPT-5.1 Turbo  
**Environment Variables:**
```bash
STRATEGY_CONSOLIDATOR=gpt-5.1-turbo
STRATEGY_CONSOLIDATOR_MAX_TOKENS=2000
STRATEGY_CONSOLIDATOR_TEMPERATURE=0.3
```

**File:** `server/lib/providers/consolidator.js`  
**Usage:**
```javascript
const result = await callModel("consolidator", {
  system: "Synthesize strategic insights...",
  user: "Claude strategy: ... Perplexity briefing: ..."
});
```

---

### 4. Venue Generator
**Purpose:** Generate smart venue recommendations with coordinates  
**Default Model:** GPT-5.1 Turbo  
**Environment Variables:**
```bash
STRATEGY_VENUE_GENERATOR=gpt-5.1-turbo
STRATEGY_VENUE_GENERATOR_MAX_TOKENS=1200
STRATEGY_VENUE_GENERATOR_REASONING_EFFORT=low
```

**File:** `server/lib/venue-generator.js`  
**Usage:**
```javascript
const result = await callModel("venue_generator", {
  system: "Generate venue recommendations with GPS coords...",
  user: "Driver at ${lat}, ${lng}. Strategy: ..."
});
```

---

## Models Dictionary

All models are defined in `server/lib/models-dictionary.js`:

```javascript
export const MODELS_DICTIONARY = {
  strategist: {
    provider: 'anthropic',
    model_id: 'claude-sonnet-4-5-20250514',
    context_window: 200000,
    max_output_tokens: 4000,
    parameters: { temperature: 0.2 },
    env_vars: {
      api_key: 'ANTHROPIC_API_KEY',
      model: 'STRATEGY_STRATEGIST',
      max_tokens: 'STRATEGY_STRATEGIST_MAX_TOKENS'
    }
  },
  briefer: {
    provider: 'perplexity',
    model_id: 'sonar-pro',
    // ... configuration
  },
  // ... other roles
};
```

---

## How to Swap Models

### Example: Switch Strategist from Claude to GPT-5

**Before (Claude):**
```bash
STRATEGY_STRATEGIST=claude-sonnet-4-5-20250514
STRATEGY_STRATEGIST_MAX_TOKENS=4000
STRATEGY_STRATEGIST_TEMPERATURE=0.2
```

**After (GPT-5):**
```bash
STRATEGY_STRATEGIST=gpt-5.1-turbo
STRATEGY_STRATEGIST_MAX_TOKENS=4000
# Note: GPT-5 doesn't support temperature, uses reasoning_effort instead
```

**No code changes required!** The dispatcher automatically:
1. Sees `gpt-5` prefix
2. Routes to `openai-adapter.js`
3. Uses GPT-5's reasoning_effort parameter instead of temperature

---

### Example: Switch Briefer from Perplexity to Claude

**Before (Perplexity):**
```bash
STRATEGY_BRIEFER=sonar-pro
PERPLEXITY_API_KEY=pplx-...
```

**After (Claude):**
```bash
STRATEGY_BRIEFER=claude-sonnet-4-5-20250514
ANTHROPIC_API_KEY=sk-ant-...
```

The system automatically:
- Routes to `anthropic-adapter.js` instead of `perplexity-adapter.js`
- Uses Anthropic API format
- Returns standardized response

---

## Adapter Interface

All adapters must implement this standardized interface:

### Input
```typescript
{
  model: string,      // Model name
  system: string,     // System prompt
  user: string,       // User prompt
  maxTokens: number,  // Max output tokens
  temperature: number // Temperature (if supported)
}
```

### Output
```typescript
{
  ok: boolean,        // Success flag
  output: string,     // Generated text
  citations?: array   // Optional: Source citations (Perplexity)
}
```

---

## Provider-Specific Features

### Perplexity Adapter
**File:** `server/lib/adapters/perplexity-adapter.js`

**Special Features:**
- Real-time web search
- Citation tracking
- Recency filters

**Example Response:**
```javascript
{
  ok: true,
  output: "Global travel conditions affecting Texas...",
  citations: [
    "https://www.tsa.gov/travel/...",
    "https://weather.gov/..."
  ]
}
```

---

### OpenAI Adapter
**File:** `server/lib/adapters/openai-gpt5.js`

**Special Features:**
- Reasoning effort (for GPT-5, o1 models)
- Developer role support
- Reasoning token tracking

**Model Detection:**
```javascript
const isReasoningModel = model.startsWith("gpt-5") || model.startsWith("o1-");
// Uses reasoning_effort for reasoning models, temperature for others
```

---

### Anthropic Adapter
**File:** `server/lib/adapters/anthropic-adapter.js`

**Special Features:**
- Streaming support
- Thinking tokens (extended reasoning)
- Cache control

---

### Gemini Adapter
**File:** `server/lib/adapters/gemini-adapter.js`

**Special Features:**
- Massive 1M token context window
- JSON schema enforcement
- Safety settings

---

## Files Modified (Refactoring Summary)

### Created
1. ✅ `server/lib/adapters/perplexity-adapter.js` - New Perplexity adapter
2. ✅ `server/lib/venue-generator.js` - Renamed from `gpt5-venue-generator.js`

### Modified
1. ✅ `server/lib/adapters/index.js` - Added Perplexity support to dispatcher
2. ✅ `server/lib/models-dictionary.js` - Added 4 waterfall roles (strategist, briefer, consolidator, venue_generator)
3. ✅ `server/lib/providers/briefing.js` - Switched from direct fetch to `callModel("briefer")`
4. ✅ `server/lib/adapters/openai-gpt5.js` - Removed hardcoded "gpt-5" string checks
5. ✅ `server/routes/blocks-fast.js` - Updated import to use `venue-generator.js`
6. ✅ `COMPLETE_SYSTEM_ARCHITECTURE.md` - Updated documentation

### Removed
1. ✅ `server/lib/gpt5-venue-generator.js` - Renamed to `venue-generator.js`

---

## Testing Model Swaps

### Test 1: Swap Strategist to Gemini
```bash
# In your environment
STRATEGY_STRATEGIST=gemini-2.5-pro
STRATEGY_STRATEGIST_MAX_TOKENS=2048
STRATEGY_STRATEGIST_TEMPERATURE=0.2
GOOGLE_GENERATIVE_AI_API_KEY=AIza...
```

**Expected:** System routes to `gemini-adapter.js`, strategist uses Gemini

---

### Test 2: Swap Venue Generator to Claude
```bash
STRATEGY_VENUE_GENERATOR=claude-sonnet-4-5-20250514
STRATEGY_VENUE_GENERATOR_MAX_TOKENS=1200
STRATEGY_VENUE_GENERATOR_TEMPERATURE=0.3
ANTHROPIC_API_KEY=sk-ant-...
```

**Expected:** Venue generation uses Claude instead of GPT-5

---

### Test 3: Swap Briefer to GPT-4o
```bash
STRATEGY_BRIEFER=gpt-4o
STRATEGY_BRIEFER_MAX_TOKENS=4000
STRATEGY_BRIEFER_TEMPERATURE=0.2
OPENAI_API_KEY=sk-...
```

**Expected:** Research uses GPT-4o instead of Perplexity (no citations)

---

## Benefits

### 1. Cost Optimization
Switch to cheaper models for non-critical roles:
```bash
# Use GPT-4o Mini for briefing to save costs
STRATEGY_BRIEFER=gpt-4o-mini
```

### 2. A/B Testing
Run parallel experiments with different models:
```bash
# Production: Claude strategist
STRATEGY_STRATEGIST=claude-sonnet-4-5-20250514

# Experiment: GPT-5 strategist
STRATEGY_STRATEGIST=gpt-5.1-turbo
```

### 3. Provider Fallbacks
If one provider is down, switch instantly:
```bash
# Anthropic down? Switch to GPT-5
STRATEGY_STRATEGIST=gpt-5.1-turbo
```

### 4. Future-Proof
New models work automatically:
```bash
# When Claude Opus 5 releases:
STRATEGY_STRATEGIST=claude-opus-5
# No code changes needed!
```

---

## Common Pitfalls (Avoided)

### ❌ Before (Hard-Coded)
```javascript
// briefing.js - OLD VERSION
const response = await fetch('https://api.perplexity.ai/chat/completions', {
  headers: { 'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}` },
  body: JSON.stringify({ model: 'sonar-pro', ... })
});
```

**Problem:** Locked to Perplexity forever. Can't swap without editing code.

---

### ✅ After (Model-Agnostic)
```javascript
// briefing.js - NEW VERSION
const result = await callModel("briefer", {
  system: systemPrompt,
  user: userPrompt
});
```

**Benefit:** Switch from Perplexity → Claude → GPT-5 via env var only!

---

## Environment Variable Reference

### Required API Keys
```bash
ANTHROPIC_API_KEY=sk-ant-...     # For Claude models
OPENAI_API_KEY=sk-...            # For GPT-5, GPT-4o, o1 models
PERPLEXITY_API_KEY=pplx-...      # For Sonar models
GOOGLE_GENERATIVE_AI_API_KEY=AIza... # For Gemini models
```

### Role Configuration Pattern
```bash
STRATEGY_{ROLE}={model_name}
STRATEGY_{ROLE}_MAX_TOKENS={number}
STRATEGY_{ROLE}_TEMPERATURE={0.0-2.0}
STRATEGY_{ROLE}_REASONING_EFFORT={low|medium|high}  # GPT-5 only
```

### Example Complete Configuration
```bash
# Strategist (Claude)
STRATEGY_STRATEGIST=claude-sonnet-4-5-20250514
STRATEGY_STRATEGIST_MAX_TOKENS=4000
STRATEGY_STRATEGIST_TEMPERATURE=0.2

# Briefer (Perplexity)
STRATEGY_BRIEFER=sonar-pro
STRATEGY_BRIEFER_MAX_TOKENS=4000
STRATEGY_BRIEFER_TEMPERATURE=0.2

# Consolidator (GPT-5)
STRATEGY_CONSOLIDATOR=gpt-5.1-turbo
STRATEGY_CONSOLIDATOR_MAX_TOKENS=2000

# Venue Generator (GPT-5)
STRATEGY_VENUE_GENERATOR=gpt-5.1-turbo
STRATEGY_VENUE_GENERATOR_MAX_TOKENS=1200
STRATEGY_VENUE_GENERATOR_REASONING_EFFORT=low
```

---

## Advanced: Adding New Providers

To add a new AI provider (e.g., Cohere, Mistral):

### Step 1: Create Adapter
```javascript
// server/lib/adapters/cohere-adapter.js
export async function callCohere({ model, system, user, maxTokens, temperature }) {
  // Implementation
  return { ok: true, output: "..." };
}
```

### Step 2: Update Dispatcher
```javascript
// server/lib/adapters/index.js
import { callCohere } from "./cohere-adapter.js";

export async function callModel(role, { system, user }) {
  // ... existing code
  
  if (model.startsWith("command-")) {
    return callCohere({ model, system, user, maxTokens, temperature });
  }
}
```

### Step 3: Add to Dictionary
```javascript
// server/lib/models-dictionary.js
strategist: {
  provider: 'cohere',
  model_id: 'command-r-plus',
  // ... config
}
```

### Step 4: Use It
```bash
STRATEGY_STRATEGIST=command-r-plus
COHERE_API_KEY=...
```

---

## Conclusion

Vecto Pilot is now **100% model-agnostic** with:
- ✅ No hardcoded model names in business logic
- ✅ All providers accessed via unified `callModel()` interface
- ✅ Model swaps via environment variables only
- ✅ Automatic provider detection by model prefix
- ✅ Standardized adapter response format

**Result:** Change AI providers instantly without touching code!

---

**Document Version:** 1.0  
**Last Audit:** November 20, 2025  
**Status:** Production-Ready ✅
