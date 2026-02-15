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

### Strategy Events API

**File:** `server/api/strategy/strategy-events.js`

This module centralizes all Server-Sent Events (SSE) endpoints. It handles real-time notifications via PostgreSQL `LISTEN/NOTIFY` for persistent data and `EventEmitter` for high-frequency ephemeral updates.

**Endpoints:**
*   `GET /events/strategy`: Subscribes to `strategy_ready` (DB).
*   `GET /events/briefing`: Subscribes to `briefing_ready` (DB).
*   `GET /events/blocks`: Subscribes to `blocks_ready` (DB).
*   `GET /events/phase`: Subscribes to phase updates via `phaseEmitter` (Memory).

**Architecture & Implementation:**
*   **Shared Dispatcher:** Uses `subscribeToChannel` to maintain a single notification handler on the DB client for strategy, briefing, and blocks. This prevents duplicate log spam and processing regardless of the number of active connections.
*   **Phase Events (2026-01-09):** The `/events/phase` endpoint is consolidated here but uses `phaseEmitter` (extracted to a dedicated module) instead of DB notifications. This eliminates legacy SSE router dependencies and handles high-frequency ephemeral updates efficiently.
*   **Race Condition Fix (2026-01-08):** Connection cleanup (`req.on('close')`) is registered *before* the database subscription. This prevents orphaned subscribers if the connection is terminated (e.g., by bot detectors) immediately after subscription.