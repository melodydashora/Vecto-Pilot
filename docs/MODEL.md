# AI Model Reference - Production Configuration
**Last Updated**: October 26, 2025  
**Research Source**: Perplexity AI via `tools/research/model-discovery.mjs`

---

## 🎯 Verified Production Models

### OpenAI GPT-5
**Status**: ✅ Production (October 2025)

```env
OPENAI_MODEL=gpt-5
OPENAI_REASONING_EFFORT=high
OPENAI_MAX_COMPLETION_TOKENS=32000
```

**API Details**:
- **Endpoint**: `POST https://api.openai.com/v1/chat/completions`
- **Model ID**: `gpt-5` (flagship reasoning model)
- **Context Window**: 200K tokens (272K input / 128K output)
- **Headers**:
  - `Authorization: Bearer <API_KEY>`
  - `Content-Type: application/json`

**Supported Parameters** (⚠️ BREAKING CHANGES from GPT-4):
```javascript
{
  "model": "gpt-5",
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

**Reasoning Effort Values**:
- `minimal`: Fastest, no extended thinking
- `low`: Light reasoning
- `medium`: Balanced (default)
- `high`: Deep analysis, slower but more thorough

**Token Usage** (special for GPT-5):
- Input tokens: Standard
- Reasoning tokens: Internal chain-of-thought (counted separately, not billed)
- Output tokens: Final response

**Pricing**: $1.25 input / $10 output per million tokens

---

### Anthropic Claude Sonnet 4.5
**Status**: ✅ Production (October 26, 2025)

```env
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
ANTHROPIC_VERSION=2023-06-01
ANTHROPIC_TIMEOUT_MS=60000
```

**API Details**:
- **Endpoint**: `POST https://api.anthropic.com/v1/messages`
- **Model ID**: `claude-sonnet-4-5-20250929`
- **Context Window**: 1,000,000 tokens (1M standard)
- **Headers**:
  - `x-api-key: <API_KEY>`
  - `anthropic-version: 2023-06-01` (or `2025-10-01` for latest)
  - `Content-Type: application/json`

**Supported Parameters**:
```javascript
{
  "model": "claude-sonnet-4-5-20250929",
  "messages": [...],
  "max_tokens": 64000,
  "temperature": 0.7,     // ✅ Standard parameter (0.0-1.0)
  "top_p": 0.95,          // ✅ Supported
  "system": "...",        // ✅ System prompt
  "stop_sequences": [...], // ✅ Supported
  "tools": [...]          // ✅ Function calling
}
```

**Pricing**:
- Input: $15.00 per million tokens
- Output: $75.00 per million tokens

**⚠️ Partner Platform ID Differences** (do NOT use with native Anthropic API):
- **Vertex AI**: `claude-sonnet-4-5@20250929` (different format)
- **AWS Bedrock**: `anthropic.claude-sonnet-4-5-20250929-v1:0` (global prefix)
- **Native Anthropic**: `claude-sonnet-4-5-20250929` ✅ Use this

---

### Google Gemini 2.5 Pro
**Status**: ✅ Production (October 2025)

```env
GEMINI_MODEL=gemini-2.5-pro
GEMINI_API_KEY=<your_key>
```

**API Details**:
- **Endpoint**: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- **Model ID**: `gemini-2.5-pro`
- **Context Window**: 1M tokens (1,000,000 tokens)
- **Headers**:
  - Query param: `?key=<API_KEY>`
  - `Content-Type: application/json`

**Supported Parameters**:
```javascript
{
  "model": "gemini-2.5-pro",
  "contents": [...],          // Gemini uses "contents" not "messages"
  "generationConfig": {
    "temperature": 0.7,       // ✅ Standard 0.0-2.0
    "topP": 0.95,             // ✅ Supported (note: camelCase)
    "maxOutputTokens": 8000,  // ✅ Token limit
    "stopSequences": [...],   // ✅ Supported
    "responseMimeType": "application/json"  // ✅ Force JSON output
  },
  "safetySettings": [...]     // Content filtering
}
```

**Model Variants**:
- `gemini-2.5-pro`: General-purpose reasoning (recommended)
- `gemini-2.5-flash`: High-speed, lower latency
- `gemini-2.0-flash-exp`: Experimental, fastest

---

## 🔄 Model Deprecations (2024-2025)

### OpenAI Deprecated Models

| Deprecated Model | Sunset Date | Replacement |
|-----------------|-------------|-------------|
| `gpt-4-32k` | 2025-06-06 | `gpt-5` |
| `gpt-4o` | 2025-10-10 | `gpt-5` |
| `gpt-4-vision-preview` | 2024-12-06 | `gpt-5` |
| `gpt-4.5-preview` | 2025-07-14 | `gpt-5` |
| `o1-preview` | 2025-07-28 | `o3` |
| `o3-mini` | 2025-07-18 | `o4-mini` |

### Google Deprecated Models

| Deprecated Model | Replacement |
|-----------------|-------------|
| `gemini-1.5-pro` | `gemini-2.5-pro` |
| `gemini-1.5-flash` | `gemini-2.5-flash` |

### Anthropic
- No official deprecations as of October 2025
- Claude 3.x models still supported but 4.x family recommended

---

## 📊 Vecto Pilot™ Configuration

### Environment Variable First Approach

**ALL model names MUST be read from environment variables**. No hardcoded model names in code.

```env
# ===============================
# Core Model Config
# ===============================

# OpenAI GPT-5
OPENAI_MODEL=gpt-5
OPENAI_API_KEY=<your_key>
OPENAI_REASONING_EFFORT=high
OPENAI_MAX_COMPLETION_TOKENS=32000
GPT5_TIMEOUT_MS=120000

# Anthropic Claude
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
ANTHROPIC_API_KEY=<your_key>
ANTHROPIC_VERSION=2023-06-01
ANTHROPIC_TIMEOUT_MS=60000

# Google Gemini
GEMINI_MODEL=gemini-2.5-pro
GEMINI_API_KEY=<your_key>

# ===============================
# Triad Architecture (3-stage LLM pipeline)
# ===============================

TRIAD_ENABLED=true
TRIAD_MODE=single_path
TRIAD_FAIL_ON_INVALID=true

# Stage assignments
TRIAD_STRATEGIST_PROVIDER=openai
TRIAD_PLANNER_PROVIDER=openai
TRIAD_VALIDATOR_PROVIDER=google

# Budgets
LLM_TOTAL_BUDGET_MS=180000
PLANNER_DEADLINE_MS=45000
VALIDATOR_DEADLINE_MS=60000
```

**Code Pattern** (ALWAYS use env variables):
```javascript
// ✅ CORRECT - Use environment variable
const model = process.env.OPENAI_MODEL || "gpt-5";

// ❌ WRONG - Never hardcode
const model = "gpt-5";
```

---

## 🔧 Implementation Notes

### GPT-5 Migration from GPT-4

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
  model: process.env.OPENAI_MODEL || "gpt-5",
  reasoning_effort: process.env.OPENAI_REASONING_EFFORT || "high",
  max_completion_tokens: parseInt(process.env.OPENAI_MAX_COMPLETION_TOKENS || '32000')
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

### Quick Test Commands

**Test Claude Sonnet 4.5**:
```bash
curl -X POST "https://api.anthropic.com/v1/messages" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Respond with: VERIFIED"}]
  }'
```

**Test OpenAI GPT-5**:
```bash
curl -X POST "https://api.openai.com/v1/chat/completions" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5",
    "messages": [{"role": "user", "content": "Respond with: VERIFIED"}],
    "reasoning_effort": "medium",
    "max_completion_tokens": 100
  }'
```

**Test Google Gemini 2.5 Pro**:
```bash
curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=$GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"parts": [{"text": "Respond with: VERIFIED"}]}],
    "generationConfig": {"maxOutputTokens": 100}
  }'
```

### Automated Research

```bash
# Update model research data
node tools/research/model-discovery.mjs

# Review generated report
cat tools/research/model-research-2025-10-26.json
```

---

## 📚 Research Citations

Full research report with citations available at:
- `tools/research/model-research-2025-10-26.json`

Key sources:
- OpenAI Platform Docs: https://platform.openai.com/docs
- Anthropic Docs: https://www.anthropic.com/news/claude-sonnet-4-5
- Google AI Docs: https://ai.google.dev/gemini-api/docs/models
- Research Engine: Perplexity AI (sonar-pro)

**Citations** (October 26, 2025):
- 42 total citations across 4 providers
- GPT-5 parameter changes confirmed
- Claude Sonnet 4.5 1M context verified
- Gemini 2.5 Pro pricing and features confirmed

---

## 🔄 Update Workflow

1. **Run Research Script**: `node tools/research/model-discovery.mjs`
2. **Review JSON Report**: Check `tools/research/model-research-YYYY-MM-DD.json`
3. **Update This File**: Sync MODEL.md with findings
4. **Update Adapters**: Modify `server/lib/adapters/*.js` files to use env vars
5. **Update .env**: Set new model IDs and parameters
6. **Test Endpoints**: Verify each model via curl/node tests
7. **Update README**: Ensure README.md references current models

---

## ⚠️ Critical Action Items (from Oct 26 research)

### HIGH Priority

1. **GPT-5 Parameter Update** ✅ COMPLETE
   - GPT-5 uses `reasoning_effort` instead of `temperature`
   - Updated all adapters to remove unsupported parameters
   - Using env variables: `OPENAI_REASONING_EFFORT`

2. **Model Deprecation Review** ✅ COMPLETE
   - GPT-4o deprecated October 10, 2025 → using GPT-5
   - All deprecated models replaced in codebase

### MEDIUM Priority

3. **Claude 4.5 Verification** ✅ VERIFIED
   - Model ID: `claude-sonnet-4-5-20250929` confirmed working
   - 1M context window confirmed
   - Adapter using env variable: `ANTHROPIC_MODEL`

---

*This document is generated from Perplexity AI research. All model names use environment variables. No hardcoded model names in codebase.*
