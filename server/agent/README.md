> **Last Verified:** 2026-01-06

# Agent (`server/agent/`)

## Purpose

AI agent infrastructure for enhanced context and WebSocket communication.

## Files

| File | Purpose |
|------|---------|
| `embed.js` | Mount agent routes and WebSocket |
| `routes.js` | Agent API endpoints (context, memory, thread mgmt) |
| `enhanced-context.js` | Context enrichment for AI |
| `context-awareness.js` | Contextual data gathering |
| `config-manager.js` | Agent configuration file management |
| `agent-override-llm.js` | LLM override for agent |
| `thread-context.js` | Thread context management |
| `index.ts` | TypeScript entry point |

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/agent/context` | GET | Get enhanced project context |
| `/agent/health` | GET | Agent health check |
| `/agent/capabilities` | GET | Agent capabilities list |
| `/agent/memory/preference` | POST | Store user preference |
| `/agent/memory/session` | POST | Store session state |
| `/agent/memory/project` | POST | Store project state |
| `/agent/memory/conversation` | POST | Log conversation |
| `/agent/memory/conversations` | GET | Get conversation history |
| `/agent/thread/init` | POST | Initialize new thread |
| `/agent/thread/:id` | GET | Get thread context |
| `/agent/thread/:id/message` | POST | Add message to thread |

## Mounting

Agent is mounted in `server/bootstrap/routes.js` via `embed.js`:

```javascript
const { mountAgent } = await import('./server/agent/embed.js');
mountAgent({
  app,
  basePath: '/agent',
  wsPath: '/agent/ws',
  server,
});
```

**2026-01-06 Fix:** `embed.js` now imports and mounts `routes.js`. Previously, the routes were orphaned and `/agent/context` returned 404 (useMemory hook failed).

## Connections

- **Mounted by:** `../bootstrap/routes.js`
- **Uses:** AI adapters from `../lib/ai/`
- **WebSocket:** `/agent/ws` for real-time communication
- **Client hook:** `useMemory` in `client/src/hooks/useMemory.ts`
