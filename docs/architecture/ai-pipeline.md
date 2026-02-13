## Model Dispatcher (`server/lib/ai/adapters/index.js`)

The central entry point for all AI model interactions, implementing a model-agnostic routing layer.

*   **Core Function:** `callModel(role, params)`
    *   **Role Resolution:** Looks up model configuration (provider, model name, parameters) using the `role` key from the registry.
    *   **Feature Flags:** Dynamically enables capabilities like `useWebSearch`, `useSearch` (Google Grounding), `thinkingLevel`, `reasoningEffort`, or `skipJsonExtraction` based on the role definition.
*   **Hedged Router:**
    *   **Reliability:** Uses a static `HedgedRouter` instance initialized with provider-specific adapters to manage timeouts and request lifecycles.
    *   **Fallback Logic:** If `isFallbackEnabled(role)` is true, it automatically configures a secondary provider (defined in `FALLBACK_CONFIG`) to ensure request completion if the primary provider fails.
*   **Supported Providers:**
    *   **OpenAI:** Routes standard and web-search requests (utilizing `gpt-5-search-api`); supports `reasoningEffort` and handles parameter mapping for GPT-5/o1 models (e.g., `max_completion_tokens`, temperature exclusion). Includes a mock client for development/testing when the API key starts with `sk-dummy`.
    *   **Anthropic:** Routes standard and web-search requests (utilizing the `web_search_20250305` tool); extracts citations from response blocks and implements assistant prefill strategies to enforce JSON formatting.
    *   **Google:** Routes to the Gemini adapter (via `@google/genai`); supports `thinkingLevel` (Gemini 3), `useSearch` (Grounding), `skipJsonExtraction`, and streaming. Resolves SDK environment variable conflicts to prioritize `GEMINI_API_KEY`. Implements intelligent output cleaning to preserve embedded code blocks and bypasses JSON extraction for Markdown-formatted responses.
    *   **Vertex:** Routes to the Vertex AI adapter (Google Cloud); supports `thinkingLevel` and `useSearch` (Grounding).