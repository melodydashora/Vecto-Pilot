# Agent Embedding & Security (`server/agent/embed.js`)

This module manages the integration of the agent into the Express application, handling route mounting, WebSocket initialization, and enforcing security policies.

## Security Middleware

### `checkAgentAllowlist`
Restricts access to agent routes based on the client's IP address.
- **Configuration**: `AGENT_ALLOWED_IPS` (Default: `127.0.0.1,::1,localhost`).
- **Production Safety**: Explicitly blocks wildcard (`*`) allowlists in production to prevent accidental security bypass.
- **Development Behavior**: In development mode, local connections (`localhost`, `127.0.0.1`, `::1`) are always allowed regardless of configuration.
- **Exceptions**: Routes starting with `/memory/` (e.g., conversation history, preferences) are **exempt** from IP restrictions. These endpoints rely on `requireAuth` for security, allowing browser-based clients to access them without 403 errors.

### `requireAgentAdmin`
Enforces strict access control for sensitive administrative operations.
- **Configuration**: `AGENT_ADMIN_USERS` (Comma-separated User IDs).
- **Production Behavior**: If no admins are configured, all admin routes are blocked (Fail-Secure).
- **Development Behavior**: If no admins are configured, allows any authenticated user for testing purposes.
- **Enforcement**: Verifies that `req.auth.userId` is present in the configured admin list.

## Server Integration

### `mountAgent({ app, basePath, wsPath, server })`
Initializes the agent subsystem within the Express app.
- **Enable Switch**: Controlled by `AGENT_ENABLED=true`. If disabled, mounts a stub that returns `503 Service Unavailable` for all agent routes.
- **Middleware Stack**: Applies `checkAgentAllowlist` → `requireAuth` → `agentRoutes`.