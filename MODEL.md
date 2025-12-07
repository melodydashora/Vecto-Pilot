
# AI Model Reference - Production Configuration
**Last Updated**: December 7, 2025  
**Research Source**: Google Gemini 3.0 Pro Preview via `tools/research/model-discovery.mjs`

---

## 🎯 Verified Production Models

### OpenAI GPT-5.1
**Status**: ✅ Production (Latest Flagship)

```env
OPENAI_MODEL=gpt-5.1
```

**API Details**:
- **Endpoint**: `POST https://api.openai.com/v1/chat/completions`
- **Recommended**: Use new Responses API at `/v1/responses` for chain-of-thought persistence
- **Model ID**: `gpt-5.1` (replaces GPT-4o)
- **Context Window**: 400K tokens
- **Headers**:
  - `Authorization: Bearer <API_KEY>`
  - `Content-Type: application/json`

**Supported Parameters** (⚠️ BREAKING CHANGES):
```javascript
{
  "model": "gpt-5.1",
  "messages": [...],
  "reasoning": { "effort": "low" | "medium" | "high" },  // ✅ NEW: Configurable reasoning
  "max_completion_tokens": 32000,
  "stream": true,
  "stop": [...],
  "tools": [...]
}
```

**Pricing**:
- Input: $1.25 per 1M tokens
- Output: $10.00 per 1M tokens

**Additional Models**:
- **`gpt-5.1-mini`**: Cost-efficient variant ($0.25 input / $2.00 output per 1M)
- **`o1`**: High-reasoning model ($15.00 input / $60.00 output per 1M, 200K context)

**❌ DEPRECATED PARAMETERS** (GPT-5 does NOT support):
- `temperature` → Use `reasoning.effort` instead
- `top_p` → Use `reasoning.effort` instead  
- `frequency_penalty` → Not supported
- `presence_penalty` → Not supported
- `max_tokens` → Use `max_completion_tokens` instead

---

### Anthropic Claude 4.5 Sonnet
**Status**: ✅ Verified Working (Current Flagship)

```env
CLAUDE_MODEL=claude-sonnet-4-5-20250929
ANTHROPIC_API_VERSION=2023-06-01
```

**API Details**:
- **Endpoint**: `POST https://api.anthropic.com/v1/messages`
- **Model ID**: `claude-sonnet-4-5-20250929`
- **Context Window**: 200K tokens
- **Headers**:
  - `x-api-key: <API_KEY>`
  - `anthropic-version: 2023-06-01`
  - `Content-Type: application/json`

**Supported Parameters**:
```javascript
{
  "model": "claude-sonnet-4-5-20250929",
  "messages": [...],
  "max_tokens": 64000,
  "temperature": 0.7,
  "top_p": 0.95,
  "system": "...",
  "stop_sequences": [...]
}
```

**Pricing**:
- Input: $3.00 per 1M tokens
- Output: $15.00 per 1M tokens

**Additional Models**:
- **`claude-opus-4-5-20251101`**: Premium intelligence ($5.00 / $25.00 per 1M)
- **`claude-haiku-4-5-20251001`**: Fast throughput ($1.00 / $5.00 per 1M)
- **`claude-3-7-sonnet-20250219`**: Legacy verified ($3.00 / $15.00 per 1M)

**New Features**:
- Extended Thinking mode (requires `thinking` block in request)
- Native Computer Use capability
- Prompt Caching (contexts >1024 tokens)

---

### Google Gemini 3.0 Pro Preview
**Status**: ✅ Frontier Preview (Latest)

```env
GEMINI_MODEL=gemini-3-pro-preview
```

**API Details**:
- **Endpoint**: `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent`
- **Model ID**: `gemini-3-pro-preview` or `gemini-3-pro-preview-11-2025`
- **Context Window**: 1M+ tokens (2M+ for some contexts)
- **Headers**:
  - `Authorization: Bearer <API_KEY>`
  - `Content-Type: application/json`

**Supported Parameters** (⚠️ BREAKING CHANGES):
```javascript
{
  "model": "gemini-3-pro-preview",
  "contents": [...],
  "generationConfig": {
    "thinking_level": "low" | "high",        // ✅ NEW: Replaces thinking_budget
    "temperature": 0.7,
    "topP": 0.95,
    "maxOutputTokens": 2048,
    "stopSequences": [],
    "responseMimeType": "application/json"   // ✅ For structured outputs
  },
  "tools": [{ "googleSearch": {} }]          // ✅ Native web search
}
```

**Pricing**:
- Input: $2.00 per 1M tokens (<200K context)
- Output: $12.00 per 1M tokens (<200K context)
- Input: $4.00 per 1M tokens (>200K context)
- Output: $18.00 per 1M tokens (>200K context)

**Additional Models**:
- **`gemini-2.5-pro`**: Stable production ($1.25 / $10.00 per 1M, 2M context)
- **`gemini-2.5-flash`**: Performance workhorse ($0.30 / $2.50 per 1M, 1M context)
- **`gemini-2.5-flash-lite`**: Cost-efficient ($0.10 / $0.40 per 1M, 1M context)
- **`gemini-2.0-flash`**: GA production (extremely fast/cheap)

**❌ DEPRECATED PARAMETERS**:
- `thinking_budget` → Use `thinking_level` instead (causes 400 error if both used)

**⚠️ CRITICAL CONSTRAINT**:
- Must return and pass `thought_signature` in multi-turn function calls or get 400 Error

---

## 📰 News & Events Discovery APIs

### Perplexity AI - Real-Time Local Events
**Status**: ✅ Best for Local Event Discovery

```env
PERPLEXITY_API_KEY=<your_key>
PERPLEXITY_MODEL=sonar-pro
```

**API Details**:
- **Endpoint**: `POST https://api.perplexity.ai/chat/completions`
- **Best For**: Games, concerts, comedy, live music, festivals within 50 miles TODAY
- **Context Window**: 128K tokens (unlimited web search)

**Optimal Parameters for Local Events**:
```javascript
{
  "model": "sonar-pro",
  "messages": [
    {
      "role": "user",
      "content": "Find local events within 50 miles of LAT,LNG happening TODAY. Focus: concerts, games, comedy, live music."
    }
  ],
  "search_recency_filter": "day",      // ✅ TODAY only (alternatives: week, month)
  "return_related_questions": false,
  "stream": false,
  "temperature": 0.2,                   // ✅ Low temp for factual results
  "max_tokens": 2000
}
```

**Pricing**:
- Input/Output: $1.00 per 1M tokens

---

### Google Search via Gemini API
**Status**: ✅ Complex Queries with Reasoning

**Best For**: Queries requiring reasoning (e.g., "kid-friendly jazz not in a bar") with custom JSON schema

**Configuration**:
```javascript
{
  "model": "gemini-3-pro-preview",
  "tools": [{ "google_search": {} }],
  "generationConfig": {
    "thinking_level": "high",              // ✅ Improves location filtering
    "response_mime_type": "application/json",
    "response_schema": {
      "type": "ARRAY",
      "items": {
        "type": "OBJECT",
        "properties": {
          "event_name": {"type": "STRING"},
          "venue": {"type": "STRING"},
          "start_time": {"type": "STRING"},
          "ticket_link": {"type": "STRING"}
        }
      }
    }
  }
}
```

**Note**: Gemini 3.0's `thinking_level: "high"` enables multi-step reasoning for better search planning

---

### SerpAPI - Google Search Events Engine
**Status**: ✅ Alternative for Local Events

```env
SERP_API_KEY=<your_key>
```

**API Details**:
- **Endpoint**: `https://serpapi.com/search.json`
- **Best For**: Google Events listings (faster than news)
- **Query Cost**: 0.1 credit per successful search

**Optimal Parameters for Local Events**:
```javascript
{
  "engine": "google_events",           // ✅ Use events engine, not news
  "q": "concerts games comedy live music",
  "location": "Austin, TX",            // ✅ Explicit location (city name only)
  "htichips": "date:today",            // ✅ Filter for TODAY
  "api_key": SERP_API_KEY
}
```

**Alt: Google News with Web Search**:
```javascript
{
  "engine": "google",
  "q": "concerts games performances events Austin TX",
  "tbm": "nws",                        // ✅ News results
  "tbs": "qdr:d",                      // ✅ Last 24 hours
  "api_key": SERP_API_KEY
}
```

---

### Ticketmaster Discovery API
**Status**: ✅ Official Ticketed Events

```env
TICKETMASTER_API_KEY=<your_key>
```

**API Details**:
- **Endpoint**: `https://app.ticketmaster.com/discovery/v2/events.json`
- **Best For**: Official concerts, sports, major ticketed events
- **Limitation**: Misses small local/free events

**Optimal Parameters**:
```javascript
{
  "apikey": TICKETMASTER_API_KEY,
  "latlong": "30.2672,-97.7431",       // ✅ Lat,Lng format
  "radius": 50,
  "unit": "miles",
  "startDateTime": "2023-10-27T14:00:00Z",  // ✅ ISO 8601 range required
  "endDateTime": "2023-10-28T03:00:00Z"
}
```

**Note**: No "today" keyword - must provide explicit ISO 8601 date/time range

---

## 🔄 Breaking Changes Summary

### Google Gemini 3.0
| **REMOVE** ❌ | **USE INSTEAD** ✅ | **CRITICAL CONSTRAINT** ⚠️ |
|--------------|-------------------|---------------------------|
| `thinking_budget` | `thinking_level` | Must return `thought_signature` in function calls |

### OpenAI o1 / GPT-5.1
| **REMOVE** ❌ | **USE INSTEAD** ✅ | **CRITICAL CONSTRAINT** ⚠️ |
|--------------|-------------------|---------------------------|
| `max_tokens` | `max_completion_tokens` | `temperature` fixed at 1.0 for o1 |
| `temperature` (o1) | Fixed at 1.0 | Other values cause 400 Error |
| `top_p`, `frequency_penalty`, `presence_penalty` | Not supported | Remove from payloads |

### Anthropic Claude 3.7+
| **CHANGE** | **DETAILS** |
|-----------|-------------|
| Response format | Multipart: `thinking` block + `text` block |
| Request | Add `thinking` block with `budget_tokens` |

---

## 🗑️ Deprecated Models (Confirmed Shutdowns)

### OpenAI
- ❌ `gpt-4.5-preview` - Shutdown July 14, 2025
- ❌ `gpt-4o-audio-preview` (2024-10-01) - Shutdown Sept 10, 2025
- ⚠️ `gpt-3.5-turbo-instruct` - Scheduled shutdown Sept 28, 2026

### Google
- ❌ `gemini-1.5-pro` / `gemini-1.5-flash` - Shutdown Sept 29, 2025
- ❌ `gemini-1.5-pro-preview-0409` - Shutdown Sept 24, 2025
- ❌ `gemini-1.0-pro` - Shutdown April 2025
- ❌ `gemini-2.5-pro-preview-05-06` - Shutdown Dec 2, 2025

### Anthropic
- ❌ `claude-2.1` / `claude-2.0` - Shutdown July 21, 2025
- ❌ `claude-3-sonnet-20240229` - Shutdown July 21, 2025
- ❌ `claude-3-5-sonnet-20240620` / `20241022` - Shutdown Oct 28, 2025

---

## 🧪 Testing & Verification

### Test Gemini 3.0 with Structured Output
```bash
curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=$GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{
      "parts": [{"text": "Find 3 concerts in Austin, TX today"}]
    }],
    "tools": [{"googleSearch": {}}],
    "generationConfig": {
      "thinking_level": "high",
      "responseMimeType": "application/json"
    }
  }' | jq .
```

### Test OpenAI GPT-5.1
```bash
curl -X POST "https://api.openai.com/v1/chat/completions" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.1",
    "messages": [{"role": "user", "content": "Explain quantum computing"}],
    "reasoning": {"effort": "medium"},
    "max_completion_tokens": 1000
  }' | jq .
```

### Test Claude 4.5 Sonnet
```bash
curl -X POST "https://api.anthropic.com/v1/messages" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }' | jq .
```

---

## 📚 Research Sources

Full research report available at:
- `tools/research/model-research-2025-12-07.json`

Key sources:
- OpenAI: https://platform.openai.com/docs
- Anthropic: https://www.anthropic.com/docs
- Google AI: https://ai.google.dev/gemini-api
- Perplexity: https://docs.perplexity.ai
- SerpAPI: https://serpapi.com/docs
- Ticketmaster: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/

---

## 🔄 Update Workflow

1. **Run Research**: `node tools/research/model-discovery.mjs`
2. **Generate MODEL.md**: `node tools/research/generate-model-md.mjs`
3. **Review Output**: Check `MODEL.md` and `tools/research/model-research-YYYY-MM-DD.json`
4. **Update Code**: Sync adapters in `server/lib/adapters/` with new parameters
5. **Test APIs**: Use curl examples above
6. **Commit Changes**: Git commit with research findings

---

*Auto-generated from Google Gemini 3.0 research. Update frequency: Monthly recommended.*
