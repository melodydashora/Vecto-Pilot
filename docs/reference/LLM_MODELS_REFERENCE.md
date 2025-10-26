# LLM Models Reference - Latest Working Configurations
**Last Updated**: October 26, 2025  
**Research Date**: October 26, 2025 (automated via `tools/research/model-discovery.mjs`)

---

## 🎯 Current Production Models

All configurations use **environment variables** - NO hardcoded model names.

| Provider | Model Name | Context | Status | Pricing (Input/Output per M tokens) |
|----------|-----------|---------|--------|-------------------------------------|
| **OpenAI** | `gpt-5` | 200K | ✅ PRIMARY | $1.25 / $10 |
| **Anthropic** | `claude-sonnet-4-5-20250929` | 1M | ✅ BACKUP | $15 / $75 |
| **Google** | `gemini-2.5-pro` | 1M | ✅ VALIDATOR | TBD |

---

## 📋 Model Configurations

### 🥇 **OPENAI GPT-5** (PRIMARY)

**Released**: August 7, 2025  
**Model ID**: `gpt-5`  
**Context**: 200K tokens (272K input / 128K output max)  
**Features**: Deep reasoning mode, multimodal, built-in chain-of-thought

**Environment Variables**:
```env
OPENAI_MODEL=gpt-5
OPENAI_API_KEY=<your_key>
OPENAI_REASONING_EFFORT=high
OPENAI_MAX_COMPLETION_TOKENS=32000
```

**API Endpoint**:
```
POST https://api.openai.com/v1/chat/completions
```

**Request Format**:
```json
{
  "model": "gpt-5",
  "messages": [
    {"role": "system", "content": "SYSTEM_PROMPT"},
    {"role": "user", "content": "USER_PROMPT"}
  ],
  "reasoning_effort": "high",
  "max_completion_tokens": 32000
}
```

**⚠️ CRITICAL - Parameters NOT Supported by GPT-5**:
GPT-5 does **NOT** accept these parameters (will cause errors):
- ❌ `temperature` → Use `reasoning_effort` instead
- ❌ `top_p` → Use `reasoning_effort` instead
- ❌ `frequency_penalty` → Not supported
- ❌ `presence_penalty` → Not supported

**Reasoning Effort Levels**:
- `minimal`: Fastest, skip extended thinking
- `low`: Light reasoning
- `medium`: Balanced (default)
- `high`: Deep analysis (recommended for strategic planning)

**Response Path**: `data.choices[0].message.content`

**Code (Node.js)**:
```javascript
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const response = await client.chat.completions.create({
  model: process.env.OPENAI_MODEL || 'gpt-5',
  max_completion_tokens: parseInt(process.env.OPENAI_MAX_COMPLETION_TOKENS || '32000'),
  reasoning_effort: process.env.OPENAI_REASONING_EFFORT || 'high',
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ]
});

const text = response.choices[0].message.content;
```

---

### 🥈 **ANTHROPIC Claude Sonnet 4.5** (BACKUP)

**Released**: September 29, 2025  
**Model ID**: `claude-sonnet-4-5-20250929`  
**Context**: 1,000,000 tokens (1M standard)  
**Features**: Best for coding, agentic tasks, computer use, extended context

**Environment Variables**:
```env
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
ANTHROPIC_API_KEY=<your_key>
ANTHROPIC_VERSION=2023-06-01
ANTHROPIC_TIMEOUT_MS=60000
```

**API Endpoint**:
```
POST https://api.anthropic.com/v1/messages
```

**Request Format**:
```json
{
  "model": "claude-sonnet-4-5-20250929",
  "max_tokens": 64000,
  "system": "SYSTEM_PROMPT",
  "messages": [
    {"role": "user", "content": "USER_PROMPT"}
  ]
}
```

**Supported Parameters**:
- ✅ `temperature`: 0.0-1.0 (standard)
- ✅ `top_p`: 0.0-1.0
- ✅ `system`: System prompt
- ✅ `stop_sequences`: Array of strings
- ✅ `tools`: Function calling

**Response Path**: `data.content[0].text`

**Required Headers**:
```
x-api-key: YOUR_ANTHROPIC_KEY
anthropic-version: 2023-06-01
Content-Type: application/json
```

**Code (Node.js)**:
```javascript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const response = await client.messages.create({
  model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929',
  max_tokens: 64000,
  system: systemPrompt,
  messages: [{ role: 'user', content: userPrompt }]
});

const text = response.content[0].text;
```

---

### 🥉 **GOOGLE Gemini 2.5 Pro** (VALIDATOR)

**Released**: June 2025  
**Model ID**: `gemini-2.5-pro`  
**Context**: 1M tokens (1,000,000 tokens)  
**Features**: JSON mode, large context, multimodal, fast

**Environment Variables**:
```env
GEMINI_MODEL=gemini-2.5-pro
GEMINI_API_KEY=<your_key>
```

**API Endpoint**:
```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=YOUR_KEY
```

**Request Format**:
```json
{
  "contents": [{
    "parts": [{"text": "PROMPT"}]
  }],
  "generationConfig": {
    "temperature": 0.0,
    "maxOutputTokens": 4096,
    "responseMimeType": "application/json"
  }
}
```

**Supported Parameters**:
- ✅ `temperature`: 0.0-2.0 (note: wider range than others)
- ✅ `topP`: 0.0-1.0 (camelCase!)
- ✅ `maxOutputTokens`: Token limit (camelCase!)
- ✅ `stopSequences`: Array of strings (camelCase!)
- ✅ `responseMimeType`: Force JSON with `"application/json"`

**Response Path**: `data.candidates[0].content.parts[0].text`

**Code (Node.js)**:
```javascript
const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-2.5-pro'}:generateContent?key=${process.env.GEMINI_API_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: { 
        temperature: 0.0,
        maxOutputTokens: 4096,
        responseMimeType: "application/json"
      }
    })
  }
);

const data = await response.json();
const text = data.candidates[0].content.parts[0].text;
```

---

## 🔧 Vecto Pilot™ Router Configuration

**Environment-based configuration** (no hardcoded models):

```env
# ===============================
# Triad Pipeline (3-stage LLM)
# ===============================

# Stage 1: Strategist
TRIAD_STRATEGIST_PROVIDER=openai
OPENAI_MODEL=gpt-5
OPENAI_REASONING_EFFORT=high

# Stage 2: Planner  
TRIAD_PLANNER_PROVIDER=openai
PLANNER_DEADLINE_MS=45000

# Stage 3: Validator
TRIAD_VALIDATOR_PROVIDER=google
GEMINI_MODEL=gemini-2.5-pro
VALIDATOR_DEADLINE_MS=60000

# Budget
LLM_TOTAL_BUDGET_MS=180000
```

**Adapter Pattern** (always use env variables):
```javascript
// ✅ CORRECT
export async function callGPT5({ 
  model = process.env.OPENAI_MODEL || "gpt-5",
  reasoning_effort = process.env.OPENAI_REASONING_EFFORT || "high"
}) {
  // ...
}

// ❌ WRONG - Never hardcode
export async function callGPT5({ 
  model = "gpt-5"  // DON'T DO THIS
}) {
  // ...
}
```

---

## 🚨 Model Deprecation Watch

### Recently Deprecated (2025)

| Deprecated Model | Sunset Date | Replacement |
|-----------------|-------------|-------------|
| `gpt-4o` | Oct 10, 2025 | `gpt-5` |
| `gpt-4.5-preview` | Jul 14, 2025 | `gpt-5` |
| `o1-preview` | Jul 28, 2025 | `o3` |
| `o3-mini` | Jul 18, 2025 | `o4-mini` |
| `gemini-1.5-pro` | June 2025 | `gemini-2.5-pro` |

### Alternative Models (Cost/Speed Tradeoffs)

**For Speed** (sacrifice some quality):
- `gemini-2.5-flash` - Faster than Pro
- `gemini-2.0-flash-exp` - Experimental, fastest
- `gpt-5-mini` - Cheaper, faster (if available)

**For Maximum Intelligence** (higher cost/latency):
- `claude-opus-4-1-20250805` - Most capable Anthropic model ($15/$75 per M tokens)

---

## 📊 Parameter Compatibility Matrix

| Parameter | GPT-5 | Claude Sonnet 4.5 | Gemini 2.5 Pro |
|-----------|-------|-------------------|----------------|
| `temperature` | ❌ | ✅ 0.0-1.0 | ✅ 0.0-2.0 |
| `top_p` | ❌ | ✅ | ✅ (as `topP`) |
| `reasoning_effort` | ✅ | ❌ | ❌ |
| `max_tokens` | ✅ (as `max_completion_tokens`) | ✅ | ✅ (as `maxOutputTokens`) |
| `system` prompt | ✅ (in messages) | ✅ (separate field) | ✅ (as `systemInstruction`) |
| `tools` | ✅ | ✅ | ✅ |
| `json_mode` | ✅ (`response_format`) | ❌ | ✅ (`responseMimeType`) |

---

## 🔍 Quick Reference URLs

- **OpenAI GPT-5 Docs**: https://platform.openai.com/docs/models/gpt-5
- **Anthropic Claude Docs**: https://docs.anthropic.com/en/docs/about-claude/models
- **Google Gemini Docs**: https://ai.google.dev/gemini-api/docs/models/gemini-v2

---

## 📝 Update Protocol

When updating this file:
1. Run research script: `node tools/research/model-discovery.mjs`
2. Review JSON output: `tools/research/model-research-YYYY-MM-DD.json`
3. Test new models with curl commands
4. Update model IDs and configurations
5. Mark deprecated models
6. Update env variable examples
7. Verify all adapters use env variables
8. Commit with date in message

**Last Research Run**: October 26, 2025  
**Research Tool**: Perplexity AI (sonar-pro model)  
**Total Citations**: 42 sources across 4 providers

---

## ⚠️ Critical Reminders

1. **NO HARDCODED MODEL NAMES** - Always use `process.env.MODEL_NAME`
2. **GPT-5 Breaking Change** - No `temperature`/`top_p`, use `reasoning_effort`
3. **Gemini Uses camelCase** - `maxOutputTokens`, `topP`, `stopSequences`
4. **Claude 1M Context** - Use for large document processing
5. **Model IDs Change** - Use env variables to update without code changes

---

*Auto-generated from research data. All model configurations use environment variables for flexibility.*
