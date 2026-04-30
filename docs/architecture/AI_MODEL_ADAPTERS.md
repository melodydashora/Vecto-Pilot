# AI_MODEL_ADAPTERS.md — Model Adapter Pattern Documentation

> **Canonical reference** for the adapter system: how models are routed, how adapters work, and how to add new providers.
> Last updated: 2026-04-10

## Supersedes
- `docs/architecture/ai-pipeline.md` — AI dispatcher/router overview (expanded here with full adapter details)

---

## Table of Contents

1. [Architecture](#1-architecture)
2. [Central Dispatcher](#2-central-dispatcher)
3. [Adapter Implementations](#3-adapter-implementations)
4. [Hedged Router and Fallback Chains](#4-hedged-router-and-fallback-chains)
5. [Error Classification](#5-error-classification)
6. [Streaming vs Batch](#6-streaming-vs-batch)
7. [Adding a New Provider](#7-adding-a-new-provider)
8. [Current State](#8-current-state)
9. [Known Gaps](#9-known-gaps)
10. [TODO — Hardening Work](#10-todo--hardening-work)

---

## 1. Architecture

```
callModel('STRATEGY_TACTICAL', { system, user })
  │
  ├─ model-registry.js → { model: 'claude-opus-4-6', maxTokens: 16000, temp: 0.5 }
  │
  ├─ adapters/index.js → Route by provider prefix:
  │   ├─ 'claude-*' → anthropic-adapter.js
  │   ├─ 'gemini-*' → gemini-adapter.js
  │   ├─ 'gpt-*'   → openai-adapter.js
  │   └─ 'vertex-*' → vertex-adapter.js (optional)
  │
  ├─ HedgedRouter (if fallback enabled):
  │   ├─ Primary: claude-opus-4-6 via Anthropic
  │   └─ Fallback: gemini-3.1-flash via Gemini (if primary fails)
  │
  └─ Return { ok, output, provider, latencyMs, citations }
```

---

## 2. Central Dispatcher

**File:** `server/lib/ai/adapters/index.js` (284 lines)

### callModel(role, params)

```javascript
export async function callModel(role, { system, user, messages, images })
  → Promise<{ ok: boolean, output: string, provider: string, latencyMs: number, citations?: [] }>
```

1. Look up role in model-registry → get model config
2. Check for env override (`AGENT_OVERRIDE_MODEL`, `AI_COACH_OVERRIDE_MODEL`)
3. Build adapter configs for primary + fallback (if enabled)
4. Execute via HedgedRouter or direct adapter call
5. Apply timeout (120s default)
6. Return structured result

### callModelStream(role, params)

```javascript
export async function callModelStream(role, { system, messageHistory })
  → Promise<Response>  // Fetch Response with SSE stream body
```

**Constraint:** Streaming only supports Gemini. Roles with `requiresStreaming: true` reject non-Gemini overrides.

---

## 3. Adapter Implementations

### Anthropic Adapter

**File:** `server/lib/ai/adapters/anthropic-adapter.js` (122 lines)
**SDK:** `Anthropic` npm package

**Functions:**
- `callAnthropic({ model, system, user, messages, maxTokens, temperature })` — Standard call
- `callAnthropicWithWebSearch(...)` — With `web_search_20250305` tool (max 5 uses)

**Features:**
- Chat history support (full `messages` array)
- Web search with citation extraction
- JSON mode via assistant prefill (`"["` forces JSON array)

### Gemini Adapter

**File:** `server/lib/ai/adapters/gemini-adapter.js` (348 lines)
**SDK:** `@google/genai` v0.10+

**Functions:**
- `callGemini({ model, system, user, images, maxTokens, temperature, topP, topK, useSearch, thinkingLevel, skipJsonExtraction })` — Standard call
- `callGeminiStream(...)` — SSE streaming (REST API, not SDK)

**Features:**
- **thinkingLevel** validation (Pro: LOW/HIGH only; Flash: LOW/MEDIUM/HIGH)
- **Google Search grounding** (`{ googleSearch: {} }` tool injection)
- **Vision/multimodal** (images as inlineData with mimeType)
- **JSON mode** (auto-detected from prompt, sets `responseMimeType: 'application/json'`)
- **Safety filters OFF** (all categories set to BLOCK_NONE)
- **Citation suppression** (auto-injected directive for search responses)
- **JSON cleanup** (markdown stripping, preamble removal)

**WORKAROUND:** SDK reads `GOOGLE_API_KEY` env var and conflicts with Maps API key. Solution: temporarily delete env var, init SDK, restore.

### OpenAI Adapter

**File:** `server/lib/ai/adapters/openai-adapter.js` (192 lines)
**SDK:** `openai` npm package

**Functions:**
- `callOpenAI({ model, system, user, messages, maxTokens, temperature, reasoningEffort })` — Standard call
- `callOpenAIWithWebSearch(...)` — Uses `gpt-5-search-api` model

**GPT-5 Quirks:**
- Uses `max_completion_tokens` (NOT `max_tokens`)
- `reasoningEffort` parameter (low/medium/high)
- **NO temperature parameter** (400 error)
- Web search model doesn't support `reasoningEffort`

**Mock client** for development: detects a fixed sentinel prefix (see `server/lib/ai/mock-client.js` for the exact string).

### Vertex AI Adapter

**File:** `server/lib/ai/adapters/vertex-adapter.js` (251 lines)
**SDK:** `@google-cloud/vertexai`

**Status:** Available but NOT assigned to any primary roles. Optional activation via `VERTEX_AI_ENABLED=true`.

---

## 4. Hedged Router and Fallback Chains

### HedgedRouter

**File:** `server/lib/ai/router/hedged-router.js` (307 lines)

**Algorithm:**
1. Race primary + fallback providers concurrently (`Promise.any()`)
2. First success wins — abort others via AbortController
3. Circuit breaker: opens after 5 consecutive failures per provider, resets after 60s

### Concurrency Gate

**File:** `server/lib/ai/router/concurrency-gate.js` (158 lines)

Limits concurrent requests per provider to 10. Queue timeout: 30s.

### Fallback-Enabled Roles

```
STRATEGY_TACTICAL, STRATEGY_CONTEXT, STRATEGY_CORE,
VENUE_FILTER, BRIEFING_WEATHER, BRIEFING_TRAFFIC, BRIEFING_SCHOOLS, BRIEFING_AIRPORT
```

### Fallback Chain

| Primary Provider | Fallback Provider |
|-----------------|-------------------|
| Google (Gemini) | OpenAI (GPT-5.4) |
| Anthropic (Claude) | Google (Gemini Flash) |
| OpenAI (GPT) | Google (Gemini Flash) |

**Exception:** `OFFER_ANALYZER` (vision-based) excluded — can't fallback to non-vision models.

---

## 5. Error Classification

**File:** `server/lib/ai/router/error-classifier.js` (135 lines)

| Type | Detection | Retry? | Trips Circuit? |
|------|-----------|--------|----------------|
| ABORTED | AbortError | No | No |
| TIMEOUT | timeout/ETIMEDOUT | Yes | Yes |
| THROTTLED | 429 / rate limit | No | Yes |
| SERVER | 5xx | Yes | Yes |
| CLIENT | 4xx | No | No |
| NETWORK | ECONNREFUSED | Yes | Yes |
| UNKNOWN | Catch-all | Yes | No |

---

## 6. Streaming vs Batch

| Aspect | Batch (callModel) | Streaming (callModelStream) |
|--------|-------------------|---------------------------|
| All adapters | Yes | Gemini only |
| Return type | `{ ok, output, latencyMs }` | `Response` (SSE stream) |
| Fallback | HedgedRouter | No fallback |
| JSON mode | Auto-detected | Not available |
| Use case | Strategy, briefing, venues | Rideshare Coach chat |
| Timeout | 120s | 90s |

---

## 7. Adding a New Provider

### Step 1: Create Adapter

```javascript
// server/lib/ai/adapters/mistral-adapter.js
export async function callMistral({ model, system, user, maxTokens, temperature }) {
  const client = new MistralClient(process.env.MISTRAL_API_KEY);
  const response = await client.chat({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    max_tokens: maxTokens,
    temperature
  });
  return { ok: true, output: response.choices[0].message.content };
}
```

### Step 2: Register in Model Registry

Add model prefix to provider mapping and add role entries.

### Step 3: Wire into Dispatcher

Import adapter in `adapters/index.js`, add to HedgedRouter adapter map.

### Step 4: Add Fallback Config

Update `getFallbackConfig()` with cross-provider fallback for the new provider.

---

## 8. Current State

| Area | Status |
|------|--------|
| 4 adapters (Anthropic, Gemini, OpenAI, Vertex) | Working |
| HedgedRouter with circuit breaker | Working |
| Concurrency gate (10/provider) | Working |
| Error classification | Working |
| Fallback chains (9 roles) | Working |
| Streaming (Gemini only) | Working |
| JSON mode (Gemini) | Working |
| Vision (Gemini) | Working |
| Web search (Anthropic + Gemini + OpenAI) | Working |

---

## 9. Known Gaps

1. **Streaming limited to Gemini** — Coach chat can't fallback to Claude/OpenAI streaming.
2. **No adapter for local models** — Can't route to Ollama/vLLM for cost savings.
3. **Vertex adapter unused** — Available but no roles route through it.
4. **No per-request cost tracking** — Token counts not logged.
5. **Circuit breaker is per-instance** — Doesn't share state across multiple server instances.

---

## 10. TODO — Hardening Work

- [ ] **Add streaming to all adapters** — Support Claude and OpenAI streaming for Coach fallback
- [ ] **Add local model adapter** — Ollama/vLLM for cost-sensitive roles
- [ ] **Remove or use Vertex adapter** — Either route roles or delete dead code
- [ ] **Per-request token logging** — Track input/output tokens for cost monitoring
- [ ] **Shared circuit breaker** — Redis-backed state for multi-instance coordination
- [ ] **Adapter health dashboard** — Real-time view of provider status, latency, error rates

---

## Key Files

| File | Purpose |
|------|---------|
| `server/lib/ai/adapters/index.js` | Central dispatcher (284 lines) |
| `server/lib/ai/adapters/anthropic-adapter.js` | Claude (122 lines) |
| `server/lib/ai/adapters/gemini-adapter.js` | Gemini (348 lines) |
| `server/lib/ai/adapters/openai-adapter.js` | OpenAI (192 lines) |
| `server/lib/ai/adapters/vertex-adapter.js` | Vertex AI (251 lines) |
| `server/lib/ai/router/hedged-router.js` | Fallback router (307 lines) |
| `server/lib/ai/router/error-classifier.js` | Error classification (135 lines) |
| `server/lib/ai/router/concurrency-gate.js` | Rate limiting (158 lines) |
| `server/lib/ai/model-registry.js` | Role → model mapping (763 lines) |
