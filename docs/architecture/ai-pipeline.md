### `callModel`

*Updated: 2026-02-25*

The central dispatcher for all AI model interactions. It abstracts the underlying provider (OpenAI, Anthropic, Google, Vertex) based on the requested **role**. It leverages a **Hedged Router** to ensure reliability and performance, supporting fallback providers and concurrent requests.

```javascript
export async function callModel(role, params)
```

**Parameters:**

- `role` (string): The specific role key defined in `model-registry.js`. Follows the `{TABLE}_{FUNCTION}` convention.
  - **`BRIEFING_*`**: Roles that populate the `briefings` table (e.g., `'BRIEFING_WEATHER'`, `'BRIEFING_TRAFFIC'`, `'BRIEFING_HOLIDAY'`).
  - **`STRATEGY_*`**: Roles that populate the `strategies` table.
  - **`VENUE_*`**: Roles that populate `ranking_candidates` (Smart Blocks).
  - **`COACH_*`**: Roles that populate `coach_conversations`.
  - **`UTIL_*`**: Utility roles for validation/parsing (no direct DB write).
  The role configuration dictates the model selection, **reasoning effort (`thinkingLevel`)**, token limits, and enabled tools (e.g., Google Search).
- `params` (Object): The input parameters for the model.
  - `system` (string): The system instruction/prompt.
  - `user` (string): The user query/prompt.
  - `messages` (Array): Optional conversation history.
  - `images` (Array): Optional multimodal inputs (for supported providers).

**Returns:** `Promise<{ok: boolean, output: string, citations?: array}>`

**Features:**

- **Hedged Routing:** Uses `HedgedRouter` to manage primary and fallback provider calls. If the primary provider is slow or fails, a fallback provider is triggered to ensure a timely response.
- **Cross-Provider Redundancy:** Fallback configurations are dynamically selected to ensure they belong to a different provider family than the primary (e.g., if Primary is Google, Fallback will be OpenAI or Anthropic) to prevent single-point-of-failure scenarios.
- **Provider Abstraction:** Automatically routes to the correct adapter (`openai`, `anthropic`, `google`, `vertex`) based on the role configuration. It handles provider-specific nuances, such as:
  - **Thinking Levels:** Validates and normalizes reasoning efforts (e.g., auto-correcting `MEDIUM` to `HIGH` for Gemini 3 Pro, which only supports `LOW`/`HIGH`).
  - **Multimodal Inputs:** Formats image data correctly for vision-capable models.