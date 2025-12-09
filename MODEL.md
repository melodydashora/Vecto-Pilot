# AI Model Reference Guide

> **Last Updated:** December 9, 2025
> **Research Source:** Google Gemini 3.0 Pro Preview with Grounding (48 citations)

---

## Production Models (December 2025)

### OpenAI

| Model ID | Context | Input $/1M | Output $/1M | Use Case |
|----------|---------|------------|-------------|----------|
| `gpt-5.1` | 400k | $1.25 | $10.00 | **Flagship.** Complex coding, agentic workflows |
| `gpt-5-mini` | 400k | $0.25 | $2.00 | Cost-effective standard tasks |
| `gpt-5-nano` | 400k | $0.05 | $0.40 | Fastest. Summarization, classification |
| `o3` | 200k | $2.00 | $12.00 | **Reasoning.** STEM, math. Succeeded o1 |
| `o4-mini` | 200k | $1.10 | $4.40 | Fast reasoning, cost-efficient |
| `o1-pro` | 200k | $150.00 | $600.00 | High-compute deep research |

**Endpoint:** `https://api.openai.com/v1/chat/completions`
**Auth:** `Authorization: Bearer {API_KEY}`

---

### Anthropic (Claude)

| Model ID | Context | Input $/1M | Output $/1M | Use Case |
|----------|---------|------------|-------------|----------|
| `claude-opus-4-5-20251101` | 200k | $5.00 | $25.00 | **New Flagship.** Max intelligence, long-horizon agents |
| `claude-sonnet-4-5` | 200k | $3.00 | $15.00 | Balanced high-intelligence & speed |
| `claude-3-7-sonnet-20250219` | 200k | $3.00 | $15.00 | **Hybrid Reasoning.** Extended thinking mode |
| `claude-haiku-4-5` | 200k | $1.00 | $5.00 | Sub-agent tasks, fast execution |

**Endpoint:** `https://api.anthropic.com/v1/messages`
**Auth:** `x-api-key: {API_KEY}`
**Header:** `anthropic-version: 2023-06-01`

> **Note:** Claude 3.5 Opus was **never released**. Anthropic skipped from 3.5 Sonnet/Haiku to 3.7 and 4.x families.

---

### Google (Gemini)

| Model ID | Context | Input $/1M | Output $/1M | Use Case |
|----------|---------|------------|-------------|----------|
| `gemini-3-pro-preview` | 1M | $2.00 / $4.00* | $12.00 / $18.00* | **Next-Gen.** Agentic, multimodal reasoning |
| `gemini-2.5-pro` | 2M | $1.25 | $10.00 | Stable production flagship |
| `gemini-2.5-flash` | 1M | $0.30 | $2.50 | High-speed, low-latency |
| `gemini-2.5-flash-lite` | 1M | $0.10 | $0.40 | Ultra low-cost, high throughput |

*\* Higher pricing for prompts >200k tokens*

**Endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent`
**Auth:** `x-goog-api-key: {API_KEY}`

---

## Critical Parameter Constraints

### GPT-5.1 / o-series (OpenAI)

```javascript
// CORRECT - Use reasoning.effort and max_completion_tokens
{
  model: "gpt-5.1",
  reasoning: { effort: "medium" },  // low | medium | high
  max_completion_tokens: 32000
}

// WRONG - These cause 400 errors on reasoning models
{
  temperature: 0.7,    // NOT supported on o1/o3 (fixed at 1.0)
  max_tokens: 1000     // Use max_completion_tokens instead
}
```

---

### Gemini 3.0 Pro (Google)

```javascript
// CORRECT - Use thinking_level for Gemini 3
{
  generationConfig: {
    thinking_level: "high"  // "low" | "high"
  }
}

// WRONG - thinking_budget causes 400 on Gemini 3 (only works on 2.5)
{
  generationConfig: {
    thinking_budget: 8000  // DO NOT USE with Gemini 3
  }
}
```

**Function Calling (CRITICAL):** Gemini 3.0 requires `thought_signature` to be passed back in multi-turn tool use. Omission causes 400 errors.

---

### Claude 3.7+ (Anthropic)

```javascript
// Standard header (unchanged)
headers: {
  "anthropic-version": "2023-06-01"
}

// Beta features require additional header
headers: {
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "output-128k-2025-02-19"  // For extended thinking
}
```

---

## Claude Opus 4.5 - Complete API Reference

### Basic cURL Request

```bash
curl https://api.anthropic.com/v1/messages \
  --header "x-api-key: $ANTHROPIC_API_KEY" \
  --header "anthropic-version: 2023-06-01" \
  --header "content-type: application/json" \
  --data '{
    "model": "claude-opus-4-5-20251101",
    "max_tokens": 8192,
    "messages": [
      {"role": "user", "content": "Hello, Claude"}
    ]
  }'
```

### All Request Parameters

```json
{
  "model": "claude-opus-4-5-20251101",
  "max_tokens": 8192,
  "messages": [
    {
      "role": "user",
      "content": "Your prompt here"
    }
  ],
  "system": "Optional system prompt",
  "temperature": 1.0,
  "top_p": 1.0,
  "top_k": 0,
  "stop_sequences": ["STOP", "END"],
  "stream": false,
  "metadata": {
    "user_id": "optional-uuid-for-abuse-detection"
  },
  "service_tier": "auto",
  "tools": [],
  "tool_choice": {"type": "auto"},
  "thinking": {
    "type": "enabled",
    "budget_tokens": 10000
  }
}
```

### Parameter Reference

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `model` | string | Yes | Model ID (`claude-opus-4-5-20251101`) |
| `max_tokens` | integer | Yes | Maximum output tokens to generate |
| `messages` | array | Yes | Conversation history with `role` and `content` |
| `system` | string/array | No | System prompt for context/instructions |
| `temperature` | float | No | Randomness (0.0-1.0, default 1.0) |
| `top_p` | float | No | Nucleus sampling (0.0-1.0) |
| `top_k` | integer | No | Top-k sampling (only sample from top k tokens) |
| `stop_sequences` | array | No | Custom stop strings |
| `stream` | boolean | No | Enable SSE streaming |
| `metadata.user_id` | string | No | UUID for abuse detection |
| `service_tier` | string | No | `"auto"`, `"priority"`, or `"standard"` |
| `tools` | array | No | Tool definitions |
| `tool_choice` | object | No | How model should use tools |
| `thinking` | object | No | Extended thinking configuration |

### Required Headers

```bash
--header "x-api-key: $ANTHROPIC_API_KEY"
--header "anthropic-version: 2023-06-01"
--header "content-type: application/json"
```

### Optional Beta Headers

```bash
--header "anthropic-beta: interleaved-thinking-2025-05-14"
--header "anthropic-beta: code-execution-2025-08-25"
--header "anthropic-beta: fine-grained-tool-streaming-2025-05-14"
```

---

### Available Tools

#### 1. Custom/Client Tools (You implement)

```json
{
  "tools": [
    {
      "name": "get_weather",
      "description": "Get the current weather in a given location",
      "input_schema": {
        "type": "object",
        "properties": {
          "location": {
            "type": "string",
            "description": "The city and state, e.g. San Francisco, CA"
          }
        },
        "required": ["location"]
      },
      "strict": true
    }
  ]
}
```

#### 2. Web Search Tool (Server-side, Anthropic executes)

```json
{
  "tools": [
    {
      "type": "web_search_20250305",
      "name": "web_search",
      "max_uses": 5,
      "allowed_domains": ["example.com", "docs.example.com"],
      "blocked_domains": ["untrusted.com"],
      "user_location": {
        "type": "approximate",
        "city": "San Francisco",
        "region": "California",
        "country": "US",
        "timezone": "America/Los_Angeles"
      }
    }
  ]
}
```

#### 3. Web Fetch Tool (Server-side)

```json
{
  "tools": [
    {
      "type": "web_fetch_20250305",
      "name": "web_fetch"
    }
  ]
}
```

#### 4. Code Execution Tool (Server-side sandbox)

```json
{
  "tools": [
    {
      "type": "code_execution_20250825",
      "name": "code_execution"
    }
  ]
}
```

Requires beta header: `anthropic-beta: code-execution-2025-08-25`

#### 5. Text Editor Tool (Client-side)

```json
{
  "tools": [
    {
      "type": "text_editor_20250124",
      "name": "str_replace_editor"
    }
  ]
}
```

#### 6. Bash Tool (Client-side)

```json
{
  "tools": [
    {
      "type": "bash_20250124",
      "name": "bash"
    }
  ]
}
```

#### 7. Computer Use Tool (Client-side)

```json
{
  "tools": [
    {
      "type": "computer_20250124",
      "name": "computer",
      "display_width_px": 1920,
      "display_height_px": 1080,
      "display_number": 1
    }
  ]
}
```

---

### Tool Choice Options

```json
// Auto (default) - Claude decides
{"tool_choice": {"type": "auto"}}

// Force any tool
{"tool_choice": {"type": "any"}}

// Force specific tool
{"tool_choice": {"type": "tool", "name": "get_weather"}}

// No tools
{"tool_choice": {"type": "none"}}

// Disable parallel tool use
{"tool_choice": {"type": "auto", "disable_parallel_tool_use": true}}
```

---

### Extended Thinking

```json
{
  "model": "claude-opus-4-5-20251101",
  "max_tokens": 16000,
  "thinking": {
    "type": "enabled",
    "budget_tokens": 10000
  },
  "messages": [...]
}
```

---

### Python SDK Examples

```python
import anthropic

client = anthropic.Anthropic()

# Basic message
message = client.messages.create(
    model="claude-opus-4-5-20251101",
    max_tokens=8192,
    system="You are a helpful assistant.",
    messages=[
        {"role": "user", "content": "Hello, Claude"}
    ]
)
print(message.content[0].text)

# With custom tools
message = client.messages.create(
    model="claude-opus-4-5-20251101",
    max_tokens=1024,
    tools=[
        {
            "name": "get_weather",
            "description": "Get current weather for a location",
            "input_schema": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "City and state, e.g. San Francisco, CA"
                    }
                },
                "required": ["location"]
            }
        }
    ],
    messages=[
        {"role": "user", "content": "What's the weather in Tokyo?"}
    ]
)

# With web search (server tool)
message = client.messages.create(
    model="claude-opus-4-5-20251101",
    max_tokens=4096,
    tools=[
        {
            "type": "web_search_20250305",
            "name": "web_search",
            "max_uses": 5
        }
    ],
    messages=[
        {"role": "user", "content": "What are the latest AI developments?"}
    ]
)

# With extended thinking
message = client.messages.create(
    model="claude-opus-4-5-20251101",
    max_tokens=16000,
    thinking={
        "type": "enabled",
        "budget_tokens": 10000
    },
    messages=[
        {"role": "user", "content": "Solve this complex math problem..."}
    ]
)

# With code execution (beta)
message = client.beta.messages.create(
    model="claude-opus-4-5-20251101",
    betas=["code-execution-2025-08-25"],
    max_tokens=4096,
    tools=[
        {
            "type": "code_execution_20250825",
            "name": "code_execution"
        }
    ],
    messages=[
        {"role": "user", "content": "Calculate the mean of [1,2,3,4,5]"}
    ]
)
```

### TypeScript SDK Examples

```typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

// Basic message
const message = await anthropic.messages.create({
  model: 'claude-opus-4-5-20251101',
  max_tokens: 8192,
  system: 'You are a helpful assistant.',
  messages: [
    { role: 'user', content: 'Hello, Claude' }
  ]
});
console.log(message.content[0].text);

// With tools
const toolMessage = await anthropic.messages.create({
  model: 'claude-opus-4-5-20251101',
  max_tokens: 1024,
  tools: [
    {
      name: 'get_weather',
      description: 'Get current weather for a location',
      input_schema: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'City and state, e.g. San Francisco, CA'
          }
        },
        required: ['location']
      }
    }
  ],
  messages: [
    { role: 'user', content: "What's the weather in Tokyo?" }
  ]
});

// With web search
const searchMessage = await anthropic.messages.create({
  model: 'claude-opus-4-5-20251101',
  max_tokens: 4096,
  tools: [
    {
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 5
    }
  ],
  messages: [
    { role: 'user', content: 'Latest TypeScript features?' }
  ]
});

// Streaming
const stream = await anthropic.messages.stream({
  model: 'claude-opus-4-5-20251101',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Tell me a story' }]
});

for await (const event of stream) {
  if (event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta') {
    process.stdout.write(event.delta.text);
  }
}
```

---

### Complete cURL with All Tools

```bash
curl https://api.anthropic.com/v1/messages \
  --header "x-api-key: $ANTHROPIC_API_KEY" \
  --header "anthropic-version: 2023-06-01" \
  --header "anthropic-beta: code-execution-2025-08-25" \
  --header "content-type: application/json" \
  --data '{
    "model": "claude-opus-4-5-20251101",
    "max_tokens": 8192,
    "system": "You are a helpful coding assistant.",
    "temperature": 0.7,
    "messages": [
      {
        "role": "user",
        "content": "Search for the latest Python best practices and write a sample script"
      }
    ],
    "tools": [
      {
        "type": "web_search_20250305",
        "name": "web_search",
        "max_uses": 3
      },
      {
        "type": "code_execution_20250825",
        "name": "code_execution"
      },
      {
        "name": "save_file",
        "description": "Save content to a file",
        "input_schema": {
          "type": "object",
          "properties": {
            "filename": {"type": "string"},
            "content": {"type": "string"}
          },
          "required": ["filename", "content"]
        }
      }
    ],
    "tool_choice": {"type": "auto"}
  }'
```

---

### Response Structure

```json
{
  "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
  "type": "message",
  "role": "assistant",
  "model": "claude-opus-4-5-20251101",
  "content": [
    {
      "type": "text",
      "text": "Hello! How can I help you today?"
    }
  ],
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 25,
    "output_tokens": 150,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "server_tool_use": {
      "web_search_requests": 0
    }
  }
}
```

---

## Deprecated Models (Late 2025)

| Model | Provider | Shutdown Date | Replacement |
|-------|----------|---------------|-------------|
| `gpt-4.5-preview` | OpenAI | July 14, 2025 | `gpt-5.1` |
| `claude-2.1` / `claude-2.0` | Anthropic | July 21, 2025 | `claude-sonnet-4` |
| `claude-3-sonnet-20240229` | Anthropic | July 21, 2025 | `claude-sonnet-4` |
| `o1-preview` | OpenAI | July 28, 2025 | `o3` |
| `gemini-1.5-pro-preview-*` | Google | Sept 24, 2025 | `gemini-2.5-pro` |
| `claude-3-5-sonnet-*` | Anthropic | Oct 22, 2025 | `claude-sonnet-4` |
| `o1-mini` | OpenAI | Oct 27, 2025 | `o4-mini` |
| `gemini-1.0-pro-001` | Google | April 9, 2025 | `gemini-2.5-flash` |
| `embedding-001` | Google | Oct 2025 | `text-embedding-005` |

---

## Vecto Pilot Model Assignments

| Role | Model ID | Provider |
|------|----------|----------|
| **Strategist** | `claude-sonnet-4-5` | Anthropic |
| **Briefer** | `gemini-3-pro-preview` | Google (with Google Search grounding) |
| **Holiday Checker** | `gemini-3-pro-preview` | Google (with Google Search grounding) |
| **Consolidator** | `gpt-5.1` | OpenAI |
| **Immediate Strategy** | `gpt-5.1` | OpenAI |
| **Venue Planner** | `gpt-5.1` | OpenAI |
| **Validator** | `gemini-2.5-pro` | Google |

---

## News & Events APIs

### Gemini 3.0 with Google Search Grounding

**Best for:** Real-time local events, news, traffic, weather

```javascript
{
  "contents": [{
    "parts": [{
      "text": "Find 5 events happening TODAY within 50 miles of [City, State]."
    }]
  }],
  "tools": [{
    "google_search": {}
  }],
  "generationConfig": {
    "response_mime_type": "application/json",
    "response_schema": {
      "type": "OBJECT",
      "properties": {
        "events": {
          "type": "ARRAY",
          "items": {
            "type": "OBJECT",
            "properties": {
              "title": {"type": "STRING"},
              "venue": {"type": "STRING"},
              "time": {"type": "STRING"},
              "distance_miles": {"type": "NUMBER"}
            }
          }
        }
      }
    },
    "thinking_level": "high"
  }
}
```

---

### SerpAPI (Google Events Engine)

**Endpoint:** `https://serpapi.com/search`
**Engine:** `google_events`

| Parameter | Value | Notes |
|-----------|-------|-------|
| `engine` | `google_events` | Required for events |
| `q` | `Events in [City]` | Keyword query |
| `htichips` | `date:today` | Filter for today |
| `location` | `Austin, Texas` | Canonical location string |

---

### Ticketmaster Discovery API

**Endpoint:** `https://app.ticketmaster.com/discovery/v2/events.json`

| Parameter | Value | Notes |
|-----------|-------|-------|
| `geoPoint` | `[geohash]` | Preferred over `latlong` (deprecated) |
| `radius` | `50` | Distance value |
| `unit` | `miles` | Required with radius |
| `startDateTime` | `2025-12-09T00:00:00Z` | ISO 8601 UTC |
| `endDateTime` | `2025-12-09T23:59:59Z` | ISO 8601 UTC |

---

## API Quick Reference

| Provider | Base URL | Auth Header |
|----------|----------|-------------|
| **OpenAI** | `https://api.openai.com/v1/` | `Authorization: Bearer {API_KEY}` |
| **Anthropic** | `https://api.anthropic.com/v1/` | `x-api-key: {API_KEY}` |
| **Google** | `https://generativelanguage.googleapis.com/v1beta/` | `x-goog-api-key: {API_KEY}` |
| **SerpAPI** | `https://serpapi.com/search` | `api_key={API_KEY}` (query param) |
| **Ticketmaster** | `https://app.ticketmaster.com/discovery/v2/` | `apikey={API_KEY}` (query param) |

---

## Action Items

| Priority | Issue | Detail |
|----------|-------|--------|
| **CRITICAL** | Gemini 3.0 Reasoning | Requires `thinking_level` and strict `thought_signature` passing in function calls |
| **HIGH** | OpenAI o1 Parameter Shift | Use `max_completion_tokens` instead of `max_tokens` |
| **MEDIUM** | Legacy Model Cleanup | Remove references to Gemini 1.0 Pro or older PaLM models |

---

## Update Workflow

1. **Run Research:** `node tools/research/model-discovery.mjs`
2. **Review Output:** Check `tools/research/model-research-YYYY-MM-DD.json`
3. **Update MODEL.md:** Incorporate new findings
4. **Update Adapters:** Sync `server/lib/adapters/` with parameter changes
5. **Test APIs:** Verify endpoints work with new parameters

---

*Research sourced from 48 citations via Google Gemini 3.0 Grounding API*
