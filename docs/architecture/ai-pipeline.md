# AI Pipeline Architecture

## Overview

Vecto Pilot uses a multi-model AI pipeline called TRIAD (Three-model Intelligence and Decision) to balance cost, speed, and reasoning depth across various workflow stages.

## Model Dispatcher (`server/lib/ai/adapters/index.js`)

The dispatcher acts as the model-agnostic entry point (`callModel`) for the AI pipeline, handling role resolution and provider routing.

*   **Role Naming Convention:** Follows `{TABLE}_{FUNCTION}` (e.g., `BRIEFING_TRAFFIC`, `STRATEGY_TACTICAL`).
*   **Legacy Support:** Automatically maps legacy role names (e.g., `strategist`) to canonical registry roles.
*   **Provider Support:** Routes requests to OpenAI, Anthropic, Gemini, or Vertex AI based on model configuration.
*   **Feature Flags:** Checks registry flags (e.g., `roleUsesOpenAIWebSearch`, `roleUsesWebSearch`) to invoke specialized adapter functions for web search.
*   **Parameter Handling:**
    *   Detects reasoning models (`gpt-5`, `o1`) to use `reasoning_effort` instead of `temperature`.
*   **Security:** Logs only call metadata (role, model, lengths), explicitly excluding message content.

## Provider Adapters

The system uses specialized adapters to normalize interactions across different AI providers while leveraging their unique capabilities.

### OpenAI Adapter (`server/lib/ai/adapters/openai-adapter.js`)

The OpenAI adapter manages interactions with GPT-4, GPT-5, and o1 model families, automatically adjusting request parameters to match model requirements.

#### Model Family Handling

*   **GPT-5 (e.g., `gpt-5.2`) and o1 Models:**
    *   **Token Limit:** Uses `max_completion_tokens` instead of the standard `max_tokens`.
    *   **Reasoning:** Supports the `reasoning_effort` parameter (defaulting to model defaults if not specified).
    *   **Temperature:** Automatically excludes the `temperature` parameter, as these reasoning models do not support custom temperature settings.
*   **Legacy Models (e.g., GPT-4):**
    *   Uses standard `max_tokens` and `temperature` configurations.

#### Web Search Integration (New 2026-01)

The adapter includes specialized support for OpenAI's native web search capabilities, primarily used by the `BRIEFING_NEWS_GPT` role.

*   **Function:** `callOpenAIWithWebSearch`
*   **Model:** Uses the dedicated `gpt-5-search-api` model.
*   **Configuration:**
    *   Unlike standard tool calls, this uses `web_search_options` to configure context size (set to "medium") and approximate user location (US).
    *   **Note:** The search model does *not* support the `reasoning_effort` parameter.
*   **Output:** Returns generated content alongside structured URL citations.

### Anthropic Adapter (`server/lib/ai/adapters/anthropic-adapter.js`)

The Anthropic adapter handles interactions with Claude models, offering standard generation and specific handling for web search tools and JSON enforcement.

#### Standard Generation
*   **Function:** `callAnthropic`
*   **Input:** Supports both simple user strings and full message arrays (for chat history).
*   **Output:** Returns a normalized `{ ok, output }` object.

#### Web Search Integration
The adapter implements Anthropic's specific tool-use protocol for web searching.

*   **Function:** `callAnthropicWithWebSearch`
*   **Tool Definition:** Uses the `web_search_20250305` tool type with a maximum of 5 uses per request.
*   **JSON Mode Strategy:**
    *   Uses **Assistant Prefill** to enforce JSON formatting. If `jsonMode` is enabled (default), the adapter injects a prefilled assistant message starting with `[` to force the model to continue the sequence as a JSON array.
    *   The adapter automatically reconstructs the valid JSON string in the output by prepending the bracket.
*   **Output:** Parses response blocks to separate text content from citations.