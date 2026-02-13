### Planner Strategy (GPT-5)

**File:** `server/lib/strategy/planner-gpt5.js`

The Planner module generates tactical execution plans (`STRATEGY_TACTICAL` role) based on strategist guidance. It outputs concise, non-hedged tactics tailored to the current clock and venue list.

**Key Configuration:**
*   **Adapter:** `callModel` (Hedged Router + Fallback)
*   **Model:** `gpt-5.2` (via Registry)
*   **Reasoning Effort:** `medium`
*   **Timeout:** 3500ms (default, configurable via `PLANNER_DEADLINE_MS`)

**Implementation Details:**
The module constructs a prompt with strict constraints (≤120 words strategy, ≤4 bullets per venue) to ensure rapid consumption by the driver. It parses the JSON response to extract a "strategy_for_now" summary and per-venue "pro_tips".

*Updated 2026-02-13: Migrated to `callModel` adapter.*