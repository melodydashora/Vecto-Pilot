# AI Model Reference - Production Configuration
**Last Updated**: October 8, 2025  
**Research Source**: Perplexity AI via `tools/research/model-discovery.mjs`

---

## 🎯 Verified Production Models

### OpenAI GPT-5 Pro
**Status**: ✅ Production (October 2025)

```env
OPENAI_MODEL=gpt-5-pro
```

**API Details**:
- **Endpoint**: `POST https://api.openai.com/v1/chat/completions`
- **Model ID**: `gpt-5-pro` (flagship reasoning model)
- **Context Window**: 256K tokens (256,000 tokens/request)
- **Headers**:
  - `Authorization: Bearer <API_KEY>`
  - `Content-Type: application/json`

**Supported Parameters** (⚠️ BREAKING CHANGES):
```javascript
{
  "model": "gpt-5-pro",
  "messages": [...],
  "reasoning_effort": "minimal" | "low" | "medium" | "high",  // ✅ USE THIS
  "max_completion_tokens": 32000,
  "stream": true,
  "stop": [...],
  "tools": [...]  // For function calling
}
```

**❌ DEPRECATED PARAMETERS** (GPT-5 does NOT support):
- `temperature` → Use `reasoning_effort` instead
- `top_p` → Use `reasoning_effort` instead
- `frequency_penalty` → Not supported
- `presence_penalty` → Not supported

**Token Usage** (special for GPT-5):
- Input tokens: Standard
- Reasoning tokens: Internal chain-of-thought (counted separately)
- Output tokens: Final response

---

### Anthropic Claude Sonnet 4.5
**Status**: ✅ Verified Working (October 8, 2025)

```env
CLAUDE_MODEL=claude-sonnet-4-5-20250514
ANTHROPIC_API_VERSION=2023-06-01
```

**API Details**:
- **Endpoint**: `POST https://api.anthropic.com/v1/messages`
- **Model ID**: `claude-sonnet-4-5-20250514`
- **Context Window**: 200K tokens (200,000 tokens standard, 1M with beta header)
- **Headers**:
  - `x-api-key: <API_KEY>`
  - `anthropic-version: 2023-06-01` (or `2025-10-01` for latest)
  - `Content-Type: application/json`

**Supported Parameters**:
```javascript
{
  "model": "claude-sonnet-4-5-20250514",
  "messages": [...],
  "max_tokens": 64000,
  "temperature": 0.7,     // ✅ Standard parameter
  "top_p": 0.95,          // ✅ Supported
  "system": "...",        // ✅ System prompt
  "stop_sequences": [...] // ✅ Supported
}
```

**✅ VERIFICATION COMPLETE** (October 8, 2025):
```bash
# Models API confirms availability
curl https://api.anthropic.com/v1/models/claude-sonnet-4-5-20250514
# Response: {"type":"model","id":"claude-sonnet-4-5-20250514","display_name":"Claude Sonnet 4.5"}

# Messages API returns correct model
curl https://api.anthropic.com/v1/messages -d '{"model":"claude-sonnet-4-5-20250514",...}'
# Response: {"model":"claude-sonnet-4-5-20250514",...}
```

**Model Assertion**: Adapter includes validation to prevent silent model swaps  
**Pricing**:
- Input: $8.00 per million tokens
- Output: $24.00 per million tokens

**⚠️ Partner Platform ID Differences** (do NOT use with native Anthropic API):
- **Vertex AI**: `claude-sonnet-4-5@20250514` (different format)
- **AWS Bedrock**: `anthropic.claude-sonnet-4-5-20250514-v1:0` (global prefix)
- **Native Anthropic**: `claude-sonnet-4-5-20250514` ✅ Use this

---

### Google Gemini 2.5 Pro
**Status**: ✅ Production (October 2025)

```env
GEMINI_MODEL=gemini-2.5-pro-latest
```

**API Details**:
- **Endpoint**: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- **Model ID**: `gemini-2.5-pro-latest` (or `gemini-2.5-flash-latest` for speed)
- **Context Window**: 1M tokens (1,000,000 tokens)
- **Headers**:
  - `Authorization: Bearer <API_KEY>`
  - `Content-Type: application/json`

**Supported Parameters**:
```javascript
{
  "model": "gemini-2.5-pro-latest",
  "contents": [...],          // Gemini uses "contents" not "messages"
  "generationConfig": {
    "temperature": 0.7,       // ✅ Standard 0.0-2.0
    "topP": 0.95,             // ✅ Supported
    "maxOutputTokens": 2048,  // ✅ Token limit
    "stopSequences": [...]    // ✅ Supported
  }
}
```

**Model Variants**:
- `gemini-2.5-pro-latest`: General-purpose reasoning
- `gemini-2.5-flash-latest`: High-speed, lower latency
- `gemini-2.5-computer-use-latest`: UI/agent control (preview)

---

## 🔄 Model Deprecations (2024-2025)

### OpenAI Deprecated Models

| Deprecated Model | Sunset Date | Replacement |
|-----------------|-------------|-------------|
| `gpt-4-32k` | 2025-06-06 | `gpt-5-pro` |
| `gpt-4-vision-preview` | 2024-12-06 | `gpt-5-pro` |
| `gpt-4.5-preview` | 2025-07-14 | `gpt-5-pro` |
| `o1-preview` | 2025-07-28 | `o3` |
| `o1-mini` | 2025-10-27 | `o4-mini` |
| `codex` (standalone) | 2024-2025 | `gpt-5-pro` |

### Google Deprecated Models

| Deprecated Model | Replacement |
|-----------------|-------------|
| `gemini-1.5-pro` | `gemini-2.5-pro-latest` |
| `gemini-1.5-flash` | `gemini-2.5-flash-latest` |

### Anthropic
- No official deprecations as of October 2025
- Claude 2.x models being phased out in favor of Claude 3+ family

---

## 📊 Vecto Pilot™ Configuration

### Current Production Stack

**Triad Pipeline** (Single-Path, No Fallbacks):
```env
# Triad Architecture
TRIAD_ENABLED=true
TRIAD_MODE=single_path

# Stage 1: Strategist (Claude Sonnet 4.5)
CLAUDE_MODEL=claude-sonnet-4-5-20250514
CLAUDE_TIMEOUT_MS=12000

# Stage 2: Planner (GPT-5 Pro)
OPENAI_MODEL=gpt-5-pro
GPT5_TIMEOUT_MS=45000
GPT5_REASONING_EFFORT=high

# Stage 3: Validator (Gemini 2.5 Pro)
GEMINI_MODEL=gemini-2.5-pro-latest
GEMINI_TIMEOUT_MS=15000

# Total Budget
LLM_TOTAL_BUDGET_MS=90000
```

**Agent Override (Atlas)** with Fallback Chain:
```env
# Primary: Atlas (Claude Sonnet 4.5)
AGENT_OVERRIDE_PROVIDER=anthropic
AGENT_OVERRIDE_MODEL=claude-sonnet-4-5-20250929

# Fallback Chain: Claude → GPT-5 → Gemini
# (Separate API keys from Triad)
```

### Router V2 (Currently Disabled)

If re-enabling Router V2:
```env
ROUTER_V2_ENABLED=true
PREFERRED_MODEL=google:gemini-2.5-pro-latest
FALLBACK_MODELS=openai:gpt-5-pro,anthropic:claude-sonnet-4-5-20250929

# Router Timing
LLM_PRIMARY_TIMEOUT_MS=1200
LLM_TOTAL_BUDGET_MS=20000
FALLBACK_HEDGE_STAGGER_MS=400
```

---

## 🔧 Implementation Notes

### GPT-5 Pro Migration
**Old (GPT-4)**:
```javascript
{
  model: "gpt-4",
  temperature: 0.7,  // ❌ Not supported in GPT-5
  top_p: 0.95        // ❌ Not supported in GPT-5
}
```

**New (GPT-5)**:
```javascript
{
  model: "gpt-5-pro",
  reasoning_effort: "high",  // ✅ Replaces temperature/top_p
  max_completion_tokens: 32000
}
```

### Anthropic API Version
- Current: `anthropic-version: 2023-06-01`
- Latest: `anthropic-version: 2025-10-01`
- Both work with Sonnet 4.5

### Gemini Content Structure
Gemini uses different JSON structure:
```javascript
// Gemini format:
{
  "contents": [
    { "role": "user", "parts": [{ "text": "..." }] }
  ]
}

// vs OpenAI/Anthropic format:
{
  "messages": [
    { "role": "user", "content": "..." }
  ]
}
```

---

## 🧪 Testing & Verification

### Curl Examples (Using .env Parameters)

#### Test Claude Sonnet 4.5
```bash
# Using exact .env configuration
curl -X POST "https://api.anthropic.com/v1/messages" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-5-20250514",
    "max_tokens": 30000,
    "messages": [
      {
        "role": "user",
        "content": "Respond with only: CLAUDE SONNET 4.5 VERIFIED"
      }
    ]
  }'

# Expected response:
# {"id":"msg_...","model":"claude-sonnet-4-5-20250514",...,"content":[{"text":"CLAUDE SONNET 4.5 VERIFIED"}]}
```

#### Test OpenAI GPT-5
```bash
# Using exact .env configuration (reasoning_effort: medium)
curl -X POST "https://api.openai.com/v1/chat/completions" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5",
    "messages": [
      {
        "role": "user",
        "content": "Respond with only: GPT-5 VERIFIED"
      }
    ],
    "reasoning_effort": "medium",
    "max_completion_tokens": 32000
  }'

# Expected response:
# {"id":"chatcmpl-...","model":"gpt-5",...,"choices":[{"message":{"content":"GPT-5 VERIFIED"}}]}
```

#### Test Google Gemini 2.5 Pro
```bash
# Using exact .env configuration (temperature: 0.2)
curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=$GOOGLEAQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [
      {
        "parts": [
          {
            "text": "Respond with only: GEMINI 2.5 PRO VERIFIED"
          }
        ]
      }
    ],
    "generationConfig": {
      "temperature": 0.2,
      "maxOutputTokens": 2048
    }
  }'

# Expected response:
# {"candidates":[{"content":{"parts":[{"text":"GEMINI 2.5 PRO VERIFIED"}]}}]}
```

### Quick Node.js Tests

**Test Anthropic**:
```bash
node -e "fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','anthropic-version':'2023-06-01','x-api-key':process.env.ANTHROPIC_API_KEY},body:JSON.stringify({model:'claude-sonnet-4-5-20250514',max_tokens:64,messages:[{role:'user',content:'ping'}]})}).then(r=>r.json()).then(console.log)"
```

**Test OpenAI GPT-5**:
```bash
node -e "fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'authorization':'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},body:JSON.stringify({model:'gpt-5',messages:[{role:'user',content:'ping'}],reasoning_effort:'medium',max_completion_tokens:64})}).then(r=>r.json()).then(console.log)"
```

**Test Gemini**:
```bash
curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=$GOOGLEAQ_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"contents":[{"parts":[{"text":"ping"}]}]}'
```

### Automated Research
```bash
# Update this document with latest model info
node tools/research/model-discovery.mjs

# Review generated report
cat tools/research/model-research-$(date +%Y-%m-%d).json
```

---

## 📚 Research Citations

Full research report with citations available at:
- `tools/research/model-research-2025-10-08.json`

Key sources:
- OpenAI Platform Docs: https://platform.openai.com/docs
- Anthropic Docs: https://www.anthropic.com/news/claude-sonnet-4-5
- Google AI Docs: https://ai.google.dev/gemini-api/docs/models
- Research Engine: Perplexity AI (sonar-pro)

---

## 🔄 Update Workflow

1. **Run Research Script**: `node tools/research/model-discovery.mjs`
2. **Review JSON Report**: Check `tools/research/model-research-YYYY-MM-DD.json`
3. **Update This File**: Sync MODEL.md with findings
4. **Update Adapters**: Modify `server/lib/adapters/*.js` files
5. **Update .env**: Set new model IDs and parameters
6. **Test Endpoints**: Verify each model via curl/node tests
7. **Update README**: Ensure README.md references current models

---

*This document is automatically generated from Perplexity AI research. For manual updates, edit this file and document changes in git commit messages.*