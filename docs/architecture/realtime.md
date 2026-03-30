# Real-Time Architecture

**Last Updated:** 2026-02-10

This document details the real-time communication infrastructure of Vecto Co-Pilot, specifically Server-Sent Events (SSE) and WebSockets.

## 1. Server-Sent Events (SSE)

**Primary Mechanism for UI Updates.**
Used for "One-Way" notifications from Server to Client (e.g., "Strategy Ready", "Phase Changed").

### Architecture
- **Endpoints:**
    - `GET /events/strategy`: Notifies when `strategies` table is updated.
    - `GET /events/briefing`: Notifies when `briefings` data is ready.
    - `GET /events/blocks`: Notifies when `rankings` are generated.
    - `GET /events/phase`: Streams granular pipeline progress (e.g., "Analyzing Traffic... 45%").
- **Mechanism:**
    - **Database Triggers:** PostgreSQL `NOTIFY` channels trigger the Node.js server.
    - **Broadcaster:** `server/api/strategy/strategy-events.js` subscribes to DB channels and pushes events to connected SSE clients.
- **Client Handling:**
    - `client/utils/co-pilot-helpers.ts` manages EventSource connections.
    - `client/contexts/co-pilot-context.tsx` listens to events and triggers `refetchQueries` (React Query) for smooth UI updates.

### Lifecycle
1.  **Connect:** Client opens `EventSource`. Server keeps connection open (`Content-Type: text/event-stream`).
2.  **Idle:** Connection sends keep-alive comments every 15s (if configured) to prevent timeout.
3.  **Event:** DB Update -> PG Notify -> Node.js Listener -> SSE Push -> Client Event Listener -> Refetch Data.
4.  **Disconnect:** Client closes connection on unmount or page hide. Server cleans up listener.

## 2. WebSockets (Agent Service)

**Secondary Mechanism for Bi-Directional Ops.**
Used by the Agent Service (`server/agent`) for interactive sessions (e.g., shell access, file watch).

### Architecture
- **Service:** `server/agent/index.ts` runs a dedicated WebSocket server on `AGENT_PORT` (43717).
- **Route:** `/ws` (or `/agent/ws` via Gateway proxy).
- **Security:** Handshake requires `Authorization: Bearer {AGENT_TOKEN}`.

### Lifecycle
1.  **Upgrade:** HTTP Upgrade request -> `ws` library handles handshake.
2.  **Session:** Persistent connection for streaming stdin/stdout.
3.  **Keep-Alive:** Server sends PING every 15s. Client must PONG.
4.  **Termination:** Connection closed on error or explicit disconnect.

## 3. Scale Considerations

- **SSE:** Stateless (mostly). Requires "Sticky Sessions" if using in-memory broadcasters, BUT Vecto uses **PostgreSQL LISTEN/NOTIFY** as the pub/sub bus. This allows **stateless scaling**—any server instance can receive the DB notification and push to its connected clients.
- **WebSockets:** Stateful. Agent Service is currently a singleton (Mono-mode). Scaling requires a Redis Backplane for pub/sub across instances.
