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

## When to Use

- **Real-time updates** - WebSocket provides instant bidirectional communication
- **Conversation context** - Thread context maintains state across messages
- **AI-enhanced ops** - LLM integration for intelligent assistance

## See Also

- [server/agent/README.md](../../server/agent/README.md) - Detailed agent documentation
- [eidolon.md](eidolon.md) - Eidolon SDK (enhanced features)
- [README.md](README.md) - AI tools index
