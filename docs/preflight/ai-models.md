# Model Registry

**File:** `server/lib/ai/model-registry.js`

The **Model Registry** serves as the centralized configuration hub for all AI model interactions within the application. It acts as the single source of truth for model selection, parameter tuning, and capability assignment (e.g., Google Search, Thinking levels).

## Naming Convention

Roles are defined using the `{TABLE}_{FUNCTION}` convention, mapping directly to their downstream data consumption:

*   **BRIEFING_***: Roles that populate the `briefings` table.
*   **STRATEGY_***: Roles that populate the `strategies` table.
*   **VENUE_***: Roles that populate `ranking_candidates` (Smart Blocks).
*   **COACH_***: Roles that populate `coach_conversations`.
*   **UTIL_***: Utility roles for validation or parsing (no direct DB write).

## Configuration Structure

Each role in `MODEL_ROLES` defines the following properties:

*   **provider**: The AI provider backend (e.g., `'google'`, `'openai'`, `'anthropic'`, `'vertex'`).
*   **envKey**: Environment variable for overriding the default model ID.
*   **default**: The specific model version (e.g., `gemini-3-pro-preview`).
*   **purpose**: Description of the role's specific task and output goals.
*   **maxTokens**: Maximum output token limit (e.g., 4096, 8192).
*   **temperature**: Creativity setting (0.0 - 1.0).
*   **thinkingLevel**: (Optional) Enables extended reasoning capabilities (e.g., `'HIGH'`).
*   **features**: (Optional) Array of enabled capabilities (e.g., `['google_search']`).

## Reliability & Fallback

The registry supports high-availability execution through integration with the **Hedged Router**:

*   **Cross-Provider Fallback**: The registry defines fallback configurations (`FALLBACK_CONFIG`) to ensure redundancy. If a primary provider fails, the system automatically falls back to a model from a **different** provider family (e.g., switching from Google to OpenAI) to avoid single-provider outages.
*   **Router Integration**: Helper functions like `getFallbackConfig` and `isFallbackEnabled` expose these redundancy settings to the execution adapters.