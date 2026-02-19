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