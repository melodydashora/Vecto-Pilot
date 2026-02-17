### `callModel`

*Updated: 2026-02-13*

The central dispatcher for all AI model interactions. It abstracts the underlying provider (OpenAI, Anthropic, Google, Vertex) based on the requested **role**. It leverages a **Hedged Router** to ensure reliability and performance, supporting fallback providers and concurrent requests.

```javascript
export async function callModel(role, params)
```

**Parameters:**

- `role` (string): The specific role key defined in `model-registry.js`. Follows the `{TABLE}_{FUNCTION}` convention (e.g., `'BRIEFING_WEATHER'`, `'BRIEFING_TRAFFIC'`, `'BRIEFING_HOLIDAY'`).
- `params` (Object): The input parameters for the model.
  - `system` (string): The system instruction/prompt.
  - `user` (string): The user query/prompt.
  - `messages` (Array): Optional conversation history.
  - `images` (Array): Optional multimodal inputs (for supported providers).

**Returns:** `Promise<{ok: boolean, output: string, citations?: array}>`

**Features:**

- **Hedged Routing:** Uses `HedgedRouter` to manage primary and fallback provider calls. If the primary provider is slow or fails, a fallback provider (if configured) is triggered to ensure a timely response.
- **Provider Abstraction:** Automatically routes to the correct adapter (`openai`, `anthropic`, `google`, `vertex`) based on