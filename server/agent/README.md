# Agent (`server/agent/`)

## Purpose

AI agent infrastructure for enhanced context and WebSocket communication.

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
| `index.ts` | TypeScript entry point |

## Mounting

Agent is mounted in `server/bootstrap/routes.js`:

```javascript
const { mountAgent } = await import('./server/agent/embed.js');
mountAgent({
  app,
  basePath: '/agent',
  wsPath: '/agent/ws',
  server,
});
```

## Connections

- **Mounted by:** `../bootstrap/routes.js`
- **Uses:** AI adapters from `../lib/ai/`
- **WebSocket:** `/agent/ws` for real-time communication
