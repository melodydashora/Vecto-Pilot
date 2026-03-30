# AI Model Reference

> **Last Updated:** February 26, 2026
> **Single Source of Truth:** `server/lib/ai/model-registry.js`

The **Model Registry** is the centralized configuration hub for all AI model interactions. It owns model selection, parameter tuning, and capability assignment. All AI calls route through `callModel(role)` which reads from this registry.

## Naming Convention

Roles use the `{TABLE}_{FUNCTION}` convention, mapping to their downstream data destination:

*   **BRIEFING_***: Populate the `briefings` table (Weather, Traffic, News, Holiday, Schools, Airport).
*   **STRATEGY_***: Populate the `strategies` table.
*   **VENUE_***: Populate `ranking_candidates` (Smart Blocks).
*   **COACH_***: Populate `coach_conversations`.
*   **CONCIERGE_***: Public-facing event/venue discovery (no auth).
*   **UTIL_***: Utility roles for validation/parsing (no direct DB write).
*   **OFFER_***: Real-time ride offer analysis (Siri Shortcuts).
*   **DOCS_***: Internal agent roles.

## Configuration Structure

Each role in `MODEL_ROLES` defines:

*   **envKey**: Environment variable override for model ID.
*   **default**: Model version (e.g., `gemini-3.1-pro-preview`).
*   **purpose**: Task description and output goals.
*   **maxTokens**: Output token limit.
*   **temperature**: Creativity (0.0-1.0). Not supported on GPT-5.2/o1.
*   **thinkingLevel**: (Optional) Extended reasoning. Consumes output tokens.
    *   **Gemini 3/3.1 Pro**: `LOW` or `HIGH` only (`MEDIUM` is invalid).
    *   **Gemini 3 Flash**: `LOW`, `MEDIUM`, or `HIGH`.
*   **features**: Capabilities array (e.g., `['google_search', 'vision']`).
*   **reasoningEffort**: (GPT-5.2/o1 only) `low`, `medium`, or `high`.

## Current Model Landscape (February 2026)

| Provider | Model | ID | Context | Max Output | Primary Use |
|----------|-------|----|---------|------------|-------------|
| Anthropic | Claude Opus 4.6 | `claude-opus-4-6` | 1M (beta) | 128K | Strategy core, event validation |
| Anthropic | Claude Sonnet 4.6 | `claude-sonnet-4-6` | 1M (beta) | 64K | Fast + intelligent (available) |
| Anthropic | Claude Haiku 4.5 | `claude-haiku-4-5-20251001` | 200K | 8K | Venue classification |
| Google | Gemini 3.1 Pro | `gemini-3.1-pro-preview` | 1M | 65K | Briefings, AI Coach, context |
| Google | Gemini 3 Flash | `gemini-3-flash-preview` | 1M | 65K | Offer analyzer, fallbacks |
| OpenAI | GPT-5.2 | `gpt-5.2` | 400K | 128K | Tactical strategy, venue scoring |
| Perplexity | Sonar Pro | `sonar-pro` | 200K | 8K | Web-grounded research |

### Specialty Models (Available, Not Yet Assigned to Roles)

*   **Gemini 2.5 Flash Native Audio** (`gemini-2.5-flash-native-audio-latest`): Bidirectional audio via `bidiGenerateContent`. For upcoming Realtime Voice Coach. Requires WebSocket adapter.
*   **Gemini 3 Pro Image** (`gemini-3-pro-image-preview`): "Nano Banana Pro". Vision-optimized for screenshot/offer analysis. Standard `generateContent` API.

## Provider Parameter Constraints

> **Critical:** Each provider has different parameter requirements. The adapters handle this automatically, but these constraints matter when configuring roles.

### OpenAI (GPT-5.2 / o1)
*   Use `max_completion_tokens` (NOT `max_tokens`)
*   Use `reasoning_effort` (`low`/`medium`/`high`) instead of `temperature`
*   `temperature` is NOT supported when reasoning is enabled

### Anthropic (Claude 4.6)
*   Use `max_tokens` (this is the CURRENT parameter — NOT deprecated)
*   Adaptive Thinking via `effort` parameter (`low`/`medium`/`high`/`max`)
*   Requires `anthropic-version: 2023-06-01` header

### Google (Gemini 3.x)
*   **SDK:** Uses the new `@google/genai` SDK. *Note: The adapter temporarily hides `GOOGLE_API_KEY` during initialization to prevent conflicts with `GEMINI_API_KEY`.*
*   **Streaming:** Supported via `callGeminiStream()`.
*   Use `thinkingConfig: { thinkingLevel }` (NOT `thinking_budget`)
*   Pro models: `LOW` or `HIGH` only. Flash: `LOW`/`MEDIUM`/`HIGH`
*   Thinking tokens count against output limit — budget `maxTokens` accordingly
*   **Search Grounding:** When `google_search` is enabled, source citations (e.g., `[Source](url)`) are globally suppressed via system directives to prevent JSON corruption and UI clutter.
*   **Multimodal:** Supports image inputs via the `images` array (`[{mimeType, data}]`).