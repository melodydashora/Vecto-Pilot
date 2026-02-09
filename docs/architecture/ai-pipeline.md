Based on the code changes in `server/lib/ai/adapters/openai-adapter.js`, I have updated the **AI Pipeline Architecture** documentation.

**Changes:**
1.  **Added OpenAI Adapter Section:** Created a new section to document the specific handling of different model families (GPT-4 vs. GPT-5/o1).
2.  **Documented GPT-5/o1 Behaviors:** Explicitly noted the switch to `max_completion_tokens`, the support for `reasoning_effort`, and the exclusion of `temperature` for these newer models.
3.  **Added Web Search Capabilities:** Documented the new `callOpenAIWithWebSearch` function, the use of the `gpt-5-search-api` model, and its specific configuration (web search options vs. tools).

Here is the updated documentation:


# AI Pipeline Architecture

## Overview

Vecto Pilot uses a multi-model AI pipeline called TRIAD (Three-model Intelligence and Decision) to balance cost, speed, and reasoning depth across various workflow stages.

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