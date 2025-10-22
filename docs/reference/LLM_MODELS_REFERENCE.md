# LLM Models Reference - Latest Working Configurations
**Last Updated**: October 3, 2025  
**Tested With**: Vecto Pilot production prompt (Frisco, TX rideshare recommendations)

---

## 🎯 Current Production Models

All models tested successfully with full production prompt (location context, weather, business hours, staging areas).

| Provider | Model Name | Response Time | Status | Pricing |
|----------|-----------|---------------|--------|---------|
| **Google** | `gemini-2.5-pro` | **22.4s** ⚡ | ✅ FASTEST | TBD |
| **OpenAI** | `gpt-5` | 27.7s | ✅ Works | $1.25/$10 per M tokens |
| **Anthropic** | `claude-sonnet-4-5-20250929` | 38.8s | ✅ Works | $3/$15 per M tokens |

**Recommendation**: Use **Gemini 2.5 Pro** as primary (fastest), GPT-5 as backup.

---

## 📋 Model Configurations

### 🥇 **GOOGLE Gemini 2.5 Pro** (PRIMARY)

**Released**: June 2025  
**Model ID**: `gemini-2.5-pro`  
**Context**: 1M tokens (2M coming soon)  
**Features**: Adaptive thinking, best price-performance  
**Response Time**: 22.4s on production prompt

**API Endpoint**:
```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=YOUR_KEY
```

**Request Format**:
```json
{
  "contents": [{
    "parts": [{"text": "SYSTEM_PROMPT\n\nUSER_PROMPT"}]
  }],
  "generationConfig": {
    "maxOutputTokens": 2048
  }
}
```

**Response Path**: `data.candidates[0].content.parts[0].text`

**Code (Node.js)**:
```javascript
const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: systemPrompt + '\n\n' + userPrompt }]
      }],
      generationConfig: { maxOutputTokens: 2048 }
    })
  }
);
const data = await response.json();
const text = data.candidates[0].content.parts[0].text;
```

---

### 🥈 **OPENAI GPT-5** (BACKUP)

**Released**: August 7, 2025  
**Model ID**: `gpt-5`  
**Context**: 272K input / 128K output tokens  
**Features**: Built-in reasoning, multimodal input, coding optimized  
**Response Time**: 27.7s on production prompt  
**Pricing**: $1.25 input / $10 output per M tokens

**API Endpoint**:
```
POST https://api.openai.com/v1/chat/completions
```

**Request Format**:
```json
{
  "model": "gpt-5",
  "max_completion_tokens": 2048,
  "messages": [
    {"role": "system", "content": "SYSTEM_PROMPT"},
    {"role": "user", "content": "USER_PROMPT"}
  ]
}
```

**Optional Parameters**:
- `reasoning_effort`: `"minimal"` | `"low"` | `"medium"` | `"high"` (default: medium)
- Use `"minimal"` for faster responses without deep reasoning

**⚠️ IMPORTANT - Parameters NOT Supported by GPT-5**:
GPT-5 does **NOT** accept these parameters (will cause 400 errors):
- ❌ `temperature`
- ❌ `top_p`
- ❌ `frequency_penalty`
- ❌ `presence_penalty`

Use `reasoning_effort` instead to control output behavior.

**Response Path**: `data.choices[0].message.content`

**Code (Node.js)**:
```javascript
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const response = await client.chat.completions.create({
  model: 'gpt-5',
  max_completion_tokens: 2048,
  reasoning_effort: 'minimal',  // For speed (minimal, low, medium, high)
  // DO NOT include: temperature, top_p, frequency_penalty, presence_penalty
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ]
});

const text = response.choices[0].message.content;
```

---

### 🥉 **ANTHROPIC Claude Sonnet 4.5** (FALLBACK)

**Released**: September 29, 2025  
**Model ID**: `claude-sonnet-4-5-20250929` or `claude-sonnet-4-5`  
**Context**: 200K (1M with beta header)  
**Features**: Best for coding, agents, computer use  
**Response Time**: 38.8s on production prompt (SLOWEST)  
**Pricing**: $3 input / $15 output per M tokens

**API Endpoint**:
```
POST https://api.anthropic.com/v1/messages
```

**Request Format**:
```json
{
  "model": "claude-sonnet-4-5-20250929",
  "max_tokens": 2048,
  "system": "SYSTEM_PROMPT",
  "messages": [
    {"role": "user", "content": "USER_PROMPT"}
  ]
}
```

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
  model: 'claude-sonnet-4-5-20250929',
  max_tokens: 2048,
  system: systemPrompt,
  messages: [{ role: 'user', content: userPrompt }]
});

const text = response.content[0].text;
```

---

## 🔧 Recommended Router Configuration

Based on test results:

```env
# Primary (fastest)
PREFERRED_MODEL=google:gemini-2.5-pro

# Fallbacks (in order)
FALLBACK_MODELS=openai:gpt-5,anthropic:claude-sonnet-4-5-20250929

# Timeouts (based on actual response times + 50% buffer)
LLM_PRIMARY_TIMEOUT_MS=1200      # Hedge after 1.2s
LLM_TOTAL_BUDGET_MS=60000        # 60s total (enough for Claude's 39s)

# Faster option if willing to skip Claude:
# LLM_TOTAL_BUDGET_MS=45000      # 45s (covers Gemini + GPT-5 with margin)
```

---

## 🚨 Model Deprecation Watch

**Update this file when models deprecate or new versions release.**

### Deprecated Models to Avoid
- ❌ `gpt-4o` - Superseded by GPT-5 (Aug 2025)
- ❌ `gemini-1.5-pro` - Superseded by Gemini 2.5 Pro (June 2025)
- ❌ `claude-3-5-sonnet` - Superseded by Claude Sonnet 4.5 (Sept 2025)

### Alternative Models (Cost/Speed Tradeoffs)

**For Speed** (if willing to sacrifice quality):
- `gemini-2.5-flash` - Faster, cheaper than Pro
- `gpt-5-mini` - Faster, cheaper than full GPT-5
- `claude-3-5-haiku-20241022` - Fastest Anthropic model

**For Intelligence** (if willing to wait longer):
- `claude-opus-4-1-20250805` - Best for complex multi-hour tasks ($15/$75 per M tokens)

---

## 📊 Production Test Results

**Prompt Size**: ~1,200 tokens (system + user)  
**Expected Output**: JSON with 5-8 location recommendations  
**Location**: Frisco, TX (6068 Midnight Moon Dr)  
**Time**: Friday afternoon, October 3, 2025

**Quality Assessment**: All three models returned excellent, properly formatted JSON with specific addresses, parking tips, and strategic insights. Gemini was fastest, Claude was most detailed.

---

## 🔍 Quick Reference URLs

- **OpenAI GPT-5 Docs**: https://platform.openai.com/docs/models/gpt-5
- **Anthropic Claude Docs**: https://docs.claude.com/en/docs/about-claude/models/overview
- **Google Gemini Docs**: https://ai.google.dev/gemini-api/docs/models

---

## 📝 Update Protocol

When updating this file:
1. Test new models with production prompt (use `scripts/test-providers-direct.mjs`)
2. Record actual response times
3. Update model IDs and configurations
4. Mark deprecated models
5. Update recommended router config
6. Commit with date in message

**Last Test Command**:
```bash
node scripts/test-providers-direct.mjs
```
