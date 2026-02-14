# OpenAI Adapter

**File:** `server/lib/ai/adapters/openai-adapter.js`

The OpenAI adapter provides a unified interface for interacting with OpenAI's Chat Completions API, handling model-specific nuances for GPT-4, GPT-5, and o1 model families.

## Configuration

The adapter initializes the OpenAI client using `process.env.OPENAI_API_KEY`.

### Mock Client
For development and testing, if the API key starts with `sk-dummy`, a mock client is returned. This mock client returns static responses (e.g., for ride-sharing pricing) to avoid incurring API costs during local development.

## Core Functions

### `callOpenAI`

The primary entry point for text generation. It abstracts differences in parameter requirements between model generations.

```javascript
export async function callOpenAI({ 
  model, 
  system, 
  user, 
  messages, 
  maxTokens, 
  temperature, 
  reasoningEffort 
})
```

#### Model Compatibility Handling

The adapter dynamically adjusts API parameters based on the `model` string:

| Feature | GPT-4 / Legacy | GPT-5 Family (`gpt-5*`) | o1 Family (`o1-*`) |
| :--- | :--- | :--- | :--- |
| **Token Limit** | `max_tokens` | `max_completion_tokens` | `max_completion_tokens` |
| **Temperature** | Supported | **Ignored** (Not supported) | **Ignored** (Not supported) |
| **Reasoning Effort** | Not Supported | Supported | Supported |

*Note: The adapter automatically suppresses `temperature` for GPT-5 and o1 models to prevent API errors.*

### `callOpenAIWithWebSearch`

*Added: 2026-01-05*

A specialized function for performing web searches using OpenAI's dedicated search models.

- **Target Model:** Always uses `gpt-5-search-api`.
- **Use Case:** Used by the `BRIEFING_NEWS_GPT` role for parallel news fetching.
- **Output:** Returns standard output plus citations if available.

```javascript
export async function callOpenAIWithWebSearch({ 
  system, 
  user, 
  maxTokens, 
  reasoningEffort 
})
```

## Usage Example

```javascript
import { callOpenAI } from "../adapters/openai-adapter.js";

const response = await callOpenAI({
  model: "gpt-5.2-preview",
  system: "You are a helpful assistant.",
  user: "Explain quantum computing.",
  maxTokens: 1000,
  reasoningEffort: "high" // Supported by GPT-5
});
```