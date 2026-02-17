Based on the code changes in `server/lib/location/getSnapshotTimeContext.js`, I will update the **Holiday Detector** section of the documentation. The code explicitly enforces strict validation for `city` and `state` (throwing `MissingLocationError` if absent), so I will clarify the "Location Context" requirement to specifically mention "City, State".

Here is the updated documentation:


## Model Parameters

### Claude Opus 4.6 (Agent Identity)

**Configuration:**
- **Model:** `claude-opus-4-6`
- **Context Window:** 200,000 tokens
- **Max Output:** 16,000 tokens
- **Thinking:** Enabled (Budget: 10,000 tokens)
- **Temperature:** 0.7
- **Mode:** Single Path

**Required Headers:**
- `anthropic-version`: `2023-06-01`
- `anthropic-beta`: `interleaved-thinking-2025-05-14`, `code-execution-2025-08-25`, `fine-grained-tool-streaming-2025-05-14`

**Tools:**
- Web Search & Fetch (2025-03-05)
- Code Execution (2025-08-25)
- Text Editor & Bash (2025-01-24)
- Computer Use (2025-01-24)

### Triad Configuration

**Planner (GPT-5):**
- **Reasoning Effort:** High
- **Max Completion:** 32,000 tokens
- **Timeout:** 120,000 ms

**Research (Gemini):**
- **Model:** `gemini-3-pro-preview`

### Holiday Detector

**Configuration:**
- **Model:** `callModel` Adapter (Hedged Router + Fallback)
- **Role:** `BRIEFING_HOLIDAY`
- **Tools:** Google Search
- **Overrides:** `holiday-override.json`

**Caching:**
- **Type:** L1 In-memory (24h TTL)
- **Key Strategy:** Strict Timezone-aware local date (YYYY-MM-DD) & Location Context (City, State) - No Fallbacks