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
*   **Subscriber Leak Fixes (2026-02-18):**
    *   **Heartbeat:** Sends a comment (`: heartbeat`) every 30s to detect dead sockets (e.g., mobile sleep) that fail to send TCP close packets.
    *   **Race Condition Handling:** Includes a post-subscribe cleanup check. If a connection closes while `subscribeToChannel` is awaiting, the resulting unsubscribe function is immediately invoked to prevent leaks.

### Parallel Strategy Generator

**File:** `server/lib/strategy/strategy-generator-parallel.js`

This module orchestrates the parallel multi-model strategy generation pipeline. It coordinates role-based AI agents to produce strategic advice, local intelligence, and consolidated plans.

**Key Functions:**
*   `callClaudeCore`: Invokes the "STRATEGY_CORE" model (Claude) to generate a high-level strategic plan based on location, time, and weather conditions.
*   `callGeminiFeeds`: Invokes the "STRATEGY_CONTEXT" model (Gemini) to fetch real-time events, news, and traffic data.
*   `consolidateWithGPT5Thinking`: Invokes the "STRATEGY_TACTICAL" role to merge the core plan and briefing data into a final actionable strategy.

**Architecture & Implementation:**
*   **Parallel Orchestration:** Executes model calls in parallel (controlled by `MULTI_STRATEGY_ENABLED`) to reduce total latency.
*   **Status Management (2026-01-10):** Updated to use `STRATEGY_STATUS` from `status-constants.js` (S-004 FIX) for canonical state management across the pipeline.
*   **Robust Parsing:** Implements fallback mechanisms for parsing AI responses, capable of extracting JSON from markdown blocks or handling malformed outputs.
*   **Debugging:** Includes `dumpLastStrategyRow` for inspecting the most recent strategy generation state.