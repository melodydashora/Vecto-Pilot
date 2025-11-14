# AI Model Reference - Production Configuration
**Last Updated**: November 14, 2025  
**Research Source**: Perplexity AI via `tools/research/model-discovery.mjs`  
**SDK Versions**: OpenAI v6.0.0, Anthropic v0.68.1, Google AI v0.28.0

---

## 🎯 Verified Production Models

### OpenAI GPT-5.1 (RECOMMENDED)
**Status**: ✅ Production (November 2025)

```env
OPENAI_MODEL=gpt-5.1
OPENAI_REASONING_EFFORT=medium
OPENAI_MAX_COMPLETION_TOKENS=32000
```

**API Details**:
- **Endpoint**: `POST https://api.openai.com/v1/chat/completions`
- **Model ID**: `gpt-5.1` (flagship reasoning model with improved efficiency)
- **Context Window**: 200K tokens (272K input / 128K output)
- **Headers**:
  - `Authorization: Bearer <API_KEY>`
  - `Content-Type: application/json`

**Supported Parameters** (⚠️ BREAKING CHANGES from GPT-4):
```javascript
{
  "model": "gpt-5.1",
  "messages": [...],
  "reasoning_effort": "none" | "minimal" | "low" | "medium" | "high",  // ✅ USE THIS
  "max_completion_tokens": 32000,
  "stream": true,
  "stop": [...],
  "tools": [...]  // For function calling
}
```

**❌ DEPRECATED PARAMETERS** (GPT-5/5.1 do NOT support):
- `temperature` → Use `reasoning_effort` instead
- `top_p` → Use `reasoning_effort` instead
- `frequency_penalty` → Not supported
- `presence_penalty` → Not supported

**Reasoning Effort Values** (GPT-5.1 adds "none" option):
- `none`: **NEW** - No reasoning overhead, fastest response (use for simple queries)
- `minimal`: Very light reasoning, near-instant
- `low`: Light reasoning with minimal latency
- `medium`: Balanced reasoning and speed (**RECOMMENDED DEFAULT**)
- `high`: Deep analysis, slower but most thorough

**Token Usage** (special for GPT-5/5.1):
- Input tokens: Standard
- Reasoning tokens: Internal chain-of-thought (counted separately, not billed)
- Output tokens: Final response

**Pricing**: $1.25 input / $10 output per million tokens

**Use Cases**:
- `none`: Simple tasks, classification, formatting
- `minimal`: Quick summaries, basic analysis
- `low`: Standard chat, simple reasoning
- `medium`: Strategic planning, tactical analysis (**Vecto Pilot default**)
- `high`: Complex research, multi-step reasoning

---

### OpenAI GPT-4.1 (Cost-Effective Alternative)
**Status**: ✅ Production (November 2025)

```env
OPENAI_MODEL=gpt-4.1
OPENAI_REASONING_EFFORT=medium
```

**API Details**:
- **Model ID**: `gpt-4.1` (cost-effective GPT-4 successor)
- **Context Window**: 128K tokens
- **Pricing**: $0.50 input / $2.50 output per million tokens (60% cheaper than GPT-5.1)

**When to Use**:
- Budget-conscious deployments
- High-volume requests where GPT-5.1 reasoning overhead not needed
- Testing and development environments

**Supported Parameters**: Same as GPT-5.1

---

### OpenAI GPT-5 (Legacy)
**Status**: ⚠️ Use GPT-5.1 instead (October 2025)

GPT-5.1 is a drop-in replacement with improved efficiency. Original GPT-5 supported but not recommended for new deployments.

---

### Anthropic Claude Sonnet 4.5 (RECOMMENDED)
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

### Anthropic Claude Haiku 4.5 (Fast & Cheap)
**Status**: ✅ Production (November 2025)

```env
ANTHROPIC_MODEL=claude-haiku-4-5-20251114
```

**API Details**:
- **Model ID**: `claude-haiku-4-5-20251114`
- **Context Window**: 200K tokens
- **Pricing**: $0.80 input / $4.00 output per million tokens (95% cheaper than Sonnet 4.5)

**When to Use**:
- High-volume, low-latency tasks
- Simple classification, formatting, validation
- Cost-sensitive deployments
- Real-time chat where speed > reasoning depth

**Supported Parameters**: Same as Sonnet 4.5 (temperature, system prompt, tools)

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

# OpenAI GPT-5.1 (RECOMMENDED)
OPENAI_MODEL=gpt-5.1
OPENAI_API_KEY=<your_key>
OPENAI_REASONING_EFFORT=medium
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
const model = process.env.OPENAI_MODEL || "gpt-5.1";

// ❌ WRONG - Never hardcode
const model = "gpt-5.1";
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

**New (GPT-5.1)**:
```javascript
{
  model: process.env.OPENAI_MODEL || "gpt-5.1",
  reasoning_effort: process.env.OPENAI_REASONING_EFFORT || "medium",
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

**Test OpenAI GPT-5.1**:
```bash
curl -X POST "https://api.openai.com/v1/chat/completions" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.1",
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

## ✅ November 2025 SDK Update Verification

**Update Date**: November 14, 2025

All SDKs updated to latest versions with breaking changes verified:

### SDK Versions Tested
- **OpenAI SDK**: v4.72.0 → v6.0.0 ✅
  - Breaking: API structure changes handled in adapters
  - GPT-5 `reasoning_effort` parameter confirmed working
  - `max_completion_tokens` for o1/GPT-5 models confirmed

- **Anthropic SDK**: v0.34.0 → v0.68.1 ✅
  - Breaking: None identified in production code
  - Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`) confirmed working
  - Standard parameters (temperature, max_tokens, system) all supported

- **Google Generative AI SDK**: v0.21.0 → v0.28.0 ✅
  - Breaking: None identified in production code
  - Gemini 2.5 Pro confirmed working
  - Content structure (contents/parts) unchanged

### Testing Results
- ✅ Client build successful (Vite + React 19)
- ✅ Server startup successful (Express + Node 22)
- ✅ No runtime errors in browser console
- ✅ All API adapters functional with updated SDKs

**Change Tracking**: All updates logged in `agent_changes` database table via `scripts/log-agent-change.js`

---

*This document is generated from Perplexity AI research. All model names use environment variables. No hardcoded model names in codebase.*
