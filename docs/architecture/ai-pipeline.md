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

---

### `CoachDAL`

*Updated: 2026-02-17*

The `CoachDAL` class provides full schema read access for the AI Coach. It acts as the data access layer, scoping reads by user and snapshot to ensure temporal consistency. It now includes access to `offer_intelligence` for structured offer analytics (replacing the deprecated `intercepted_signals`).

**Access Pattern:** `strategy_id` → `snapshot_id` → `user_id` + `session_id` → ALL tables

#### `resolveStrategyToSnapshot`

Resolves a UI-visible `strategy_id` to the internal `snapshot_id` and `user_id`.

```javascript
async resolveStrategyToSnapshot(strategyId)
```

**Returns:** `Promise<Object|null>`
- Returns `{ snapshot_id, user_id, session_id, strategy_id }`.
- **Note:** Uses the internal `id` column as `strategy_id` for backwards compatibility.

#### `getHeaderSnapshot`

Retrieves the header snapshot context, including timezone, day-of-week, and location data.

```javascript
async getHeaderSnapshot(snapshotId)
```

**Features:**
- **Authoritative Time/Location:** Pulls `dow`, `hour`, `timezone`, and location (`lat`, `lng`, `city`, `state`) directly from the `snapshots` table. This ensures the coach context matches the historical snapshot data rather than the user's current state.
- **User Context:** Fetches current user data from the `users` table to supplement snapshot data where necessary.
- **Timezone Safety:** Enforces timezone presence; missing timezones in snapshots will trigger a warning as they are critical for accurate coach context.