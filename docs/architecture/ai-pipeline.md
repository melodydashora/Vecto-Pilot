### `callGemini`

The primary entry point for text generation. It handles parameter normalization, safety settings, and specific configurations for Gemini 3 models.

```javascript
export async function callGemini({
  model,
  system,
  user,
  images = [], // Optional multimodal images [{mimeType, data}]
  maxTokens,
  temperature,
  topP,
  topK,
  useSearch = false,
  thinkingLevel = null, // Gemini 3: "low", "medium" (Flash only), "high" - null = disabled
  skipJsonExtraction = false
})
```

#### Thinking Level Validation (F-002)

*Updated: 2026-02-15*

For Gemini 3 models, the adapter validates and normalizes the `thinkingLevel` parameter before sending it to the API. This ensures compatibility across different model variants which support different levels.

| Model Variant | Supported Levels | Behavior on Invalid Level |
| :--- | :--- | :--- |
| **Gemini 3 Flash** | `LOW`, `MEDIUM`, `HIGH` | Defaults to `LOW` if invalid. |
| **Gemini 3 Pro** | `LOW`, `HIGH` | **MEDIUM** is not supported. Auto-corrects to `HIGH`. |

*The adapter converts the validated level to lowercase for the SDK configuration.*

#### Features

- **Multimodal Support:** Accepts an array of images (`{ mimeType, data }`) to support vision capabilities (e.g., analyzing images passed via Siri shortcuts).
- **JSON Optimization:** Automatically lowers temperature to `0.2` if the prompt context implies JSON output.
- **Google Search:** Enables the `googleSearch` tool if `useSearch` is set to `true`.
- **Safety Settings:** Configured to `BLOCK_NONE` for all categories to ensure uninhibited system operation.
- **API Key Conflict Resolution:** Temporarily suppresses `GOOGLE_API_KEY` from the environment during client initialization to prioritize `GEMINI_API_KEY`, resolving SDK precedence issues.