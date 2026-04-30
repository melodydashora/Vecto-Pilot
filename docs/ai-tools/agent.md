# Workspace Agent

WebSocket-based agent for real-time workspace access and AI-enhanced operations.

## Location

`server/agent/` - Mounted at `/agent` path in main server.

## Purpose

Provides WebSocket-based bidirectional communication for:
- Real-time file operations
- Context-aware AI assistance
- Thread context management
- Enhanced LLM integration

## Mounting

```javascript
// In server/bootstrap/routes.js
const { mountAgent } = await import('./server/agent/embed.js');
mountAgent({
  app,
  basePath: '/agent',
  wsPath: '/agent/ws',
  server,
});
```

## Files

| File | Purpose |
|------|---------|
| `embed.js` | Mount agent routes and WebSocket |
| `routes.js` | Agent API endpoints |
| `enhanced-context.js` | Context enrichment for AI |
| `context-awareness.js` | Contextual data gathering |
| `config-manager.js` | Agent configuration |
| `agent-override-llm.js` | LLM override for agent |
| `thread-context.js` | Thread context management |

## WebSocket Connection

```javascript
// Client connection
const ws = new WebSocket('wss://your-domain/agent/ws');

ws.on('message', (data) => {
  const message = JSON.parse(data);
  // Handle response
});

ws.send(JSON.stringify({
  type: 'read_file',
  path: 'src/index.js'
}));
```

## Supported Operations

### File Operations
- Read files
- Write files
- List directories
- Search content

### Context Operations
- Get project context
- Get thread context
- Update context

### AI Operations
- Enhanced LLM calls with context
- Context-aware suggestions

## Thread Context

The agent maintains thread context for conversation continuity:

```javascript
import { getThreadContext, updateThreadContext } from './thread-context.js';

// Get context for a thread
const context = await getThreadContext(threadId);

// Update thread context
await updateThreadContext(threadId, {
  lastFile: 'src/index.js',
  lastAction: 'read'
});
```

## Agent Embedding & Security (`server/agent/embed.js`)

This module manages the integration of the agent into the Express application, handling route mounting, WebSocket initialization, and enforcing security policies.

### Security Middleware

#### `checkAgentAllowlist`
Restricts access to agent routes based on the client's IP address.
- **Configuration**: `AGENT_ALLOWED_IPS` (Default: `127.0.0.1,::1,localhost`).
- **Production Safety**: Explicitly blocks wildcard (`*`) allowlists in production to prevent accidental security bypass.
- **Development Behavior**: In development mode, local connections (`localhost`, `127.0.0.1`, `::1`) are always allowed regardless of configuration.
- **Exceptions**: Routes starting with `/memory/` (e.g., conversation history, preferences) are **exempt** from IP restrictions. These endpoints rely on `requireAuth` for security, allowing browser-based clients to access them without 403 errors.

#### `requireAgentAdmin`
Enforces strict access control for sensitive administrative operations.
- **Configuration**: `AGENT_ADMIN_USERS` (Comma-separated User IDs).
- **Production Behavior**: If no admins are configured, all admin routes are blocked (Fail-Secure).
- **Development Behavior**: If no admins are configured, allows any authenticated user for testing purposes.
- **Enforcement**: Verifies that `req.auth.userId` is present in the configured admin list.

### Server Integration

#### `mountAgent({ app, basePath, wsPath, server })`
Initializes the agent subsystem within the Express app.
- **Enable Switch**: Controlled by `AGENT_ENABLED=true`. If disabled, mounts a stub that returns `503 Service Unavailable` for all agent routes.
- **Middleware Stack**: Applies `checkAgentAllowlist` → `requireAuth` → `agentRoutes`.

## When to Use

- **Real-time updates** - WebSocket provides instant bidirectional communication
- **Conversation context** - Thread context maintains state across messages
- **AI-enhanced ops** - LLM integration for intelligent assistance

## See Also

- [eidolon.md](eidolon.md) - Eidolon SDK (enhanced features)
- [README.md](README.md) - AI tools index
