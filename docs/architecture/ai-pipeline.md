Here is the updated documentation. I have added a new section for the **Gemini Adapter** to reflect the logic found in `server/lib/ai/adapters/gemini-adapter.js`, specifically detailing the SDK migration, thinking model support, and the refined output cleanup logic.

***

## Model Dispatcher (`server/lib/ai/adapters/index.js`)

The dispatcher acts as the model-agnostic entry point (`callModel`) for the AI pipeline, handling role resolution and provider routing.

*   **Role Naming Convention:** Follows `{TABLE}_{FUNCTION}`.
    *   **Categories:** `BRIEFING`, `STRATEGY`, `VENUE`, `COACH`, `UTIL`.
    *   **Examples:** `BRIEFING_TRAFFIC`, `STRATEGY_TACTICAL`, `UTIL_MARKET_PARSER`.
*   **Legacy Support:** Automatically maps legacy role names (e.g., `strategist`) to canonical registry roles.
*   **Provider Support:** Routes requests to OpenAI, Anthropic, Gemini, or Vertex AI based on model configuration.
*   **Fallback & Availability:**
    *   Integrates with `FALLBACK_CONFIG` to handle service interruptions.
    *   Performs availability checks (e.g., `isVertexAIAvailable`) and status monitoring (via `getVertexAIStatus`) to ensure reliable routing.
*   **Feature Flags:** Checks registry flags (e.g., `roleUsesOpenAIWebSearch`, `roleUsesWebSearch`, `roleUsesGoogleSearch`) to invoke specialized adapter functions for web search.
*   **Parameter Handling:**
    *   **Reasoning Models:** Detects `gpt-5`/`o1` to use `reasoning_effort` instead of `temperature`.
    *   **Configuration:** Extracts `thinkingLevel` (for thinking models) and `skipJsonExtraction` (to bypass output parsing) from role configuration.
*   **Security:** Logs only call metadata (role, model, lengths), explicitly excluding message content.

## OpenAI Adapter (`server/lib/ai/adapters/openai-adapter.js`)

Handles direct interactions with the OpenAI API, managing model-specific parameter requirements and specialized capabilities like web search.

*   **Model Family Handling:**
    *   **GPT-5 & o1:** Automatically maps `maxTokens` to `max_completion_tokens` and supports `reasoning_effort`. Explicitly disables `temperature` parameters for these families.
    *   **Legacy (GPT-4):** Uses standard `max_tokens` and `temperature`.
*   **Web Search Capability:**
    *   **Function:** `callOpenAIWithWebSearch` (added 2026-01-05).
    *   **Model:** Uses the dedicated `gpt-5-search-api` model.
    *   **Configuration:** Implements `web_search_options` (context size, user location) rather than standard tool definitions.
    *   **Constraints:** Does not support `reasoning_effort`; returns structured citations alongside content.
*   **Error Handling:** Wraps responses in a standardized `{ ok, output, error }` object.

## Anthropic Adapter (`server/lib/ai/adapters/anthropic-adapter.js`)

Handles interactions with the Anthropic API (Claude), providing standard text generation and specialized tool-use scenarios.

*   **Standard Execution:**
    *   **Lazy Initialization:** Initializes the client on demand using `ANTHROPIC_API_KEY`.
    *   **Flexibility:** Accepts either a simple `user` string or a full `messages` array for chat history context.
*   **Web Search Capability:**
    *   **Function:** `callAnthropicWithWebSearch`.
    *   **Tooling:** Utilizes the `web_search_20250305` tool definition with a usage limit.
    *   **JSON Enforcement:** Implements an **Assistant Prefill** strategy (injecting `[` as the first assistant message) to force the model to output JSON arrays when `jsonMode` is enabled.
    *   **Response Parsing:** Reconstructs the JSON output (prepending the missing bracket) and extracts citations from the response blocks.
    *   **Output:** Returns structured data including `{ ok, output, citations }`.

## Gemini Adapter (`server/lib/ai/adapters/gemini-adapter.js`)

Handles interactions with Google's Gemini models via the `@google/genai` SDK, supporting advanced features like thinking models and integrated search.

*   **SDK Migration:** Updated to use the `@google/genai` SDK for compatibility with Gemini 3 features.
*   **Thinking Models:**
    *   Supports `thinkingLevel` parameter (`low`, `medium`, `high`) specifically for `gemini-3` models.
    *   Automatically disables thinking configuration for non-supported models to prevent API errors.
*   **Google Search:**
    *   Integrates native Google Search via the `googleSearch` tool when `useSearch` is enabled.
*   **Output Processing:**
    *   **Smart Cleanup:** Removes wrapping Markdown code blocks only if they encompass the entire response, preserving embedded code blocks in documentation generation.
    *   **JSON Extraction:** Automatically detects and extracts JSON objects or arrays from mixed text.
    *   **Extraction Guard:** Skips JSON extraction if the output appears to be a Markdown document (starts with `#`) to prevent data loss in documentation generation tasks.
*   **Safety Settings:** Configures all harm categories to `BLOCK_NONE` to ensure uninhibited generation for system tasks.