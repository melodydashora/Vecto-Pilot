# Assistant API

AI assistant proxy layer for context enrichment and workspace analysis.

## Location

`server/assistant/` - Mounted at `/assistant` path.

## Purpose

Provides HTTP endpoints for:
- Enhanced project context gathering
- Internet search capabilities
- Deep workspace analysis

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/assistant/context` | GET | Get enhanced project context |
| `/assistant/search` | POST | Perform internet search |
| `/assistant/analyze` | GET | Deep workspace analysis |

## Files

| File | Purpose |
|------|---------|
| `routes.js` | API endpoints |
| `enhanced-context.js` | Context gathering and analysis |
| `policy-loader.js` | Policy configuration |
| `policy-middleware.js` | Policy enforcement |
| `thread-context.js` | Thread context management |

## Usage

### Get Enhanced Context

```javascript
// GET /assistant/context?threadId=uuid&includeThreadContext=true
const response = await fetch('/assistant/context?threadId=abc123');
const context = await response.json();
```

Returns:
```javascript
{
  currentTime: '2025-12-15T...',
  environment: 'production',
  workspace: '/home/runner/workspace',

  // Database context
  recentSnapshots: [...],
  recentStrategies: [...],
  recentActions: [...],

  // Memory context
  assistantPreferences: {},
  sessionHistory: {},
  projectState: {},
  conversationHistory: [],

  // Thread awareness
  threadContext: { ... },

  // Repository structure
  repositoryStructure: { ... },
  configFiles: { ... },
  rootFiles: [...]
}
```

### Internet Search

```javascript
// POST /assistant/search
const response = await fetch('/assistant/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'React best practices 2025',
    userId: 'uuid'
  })
});
const results = await response.json();
```

### Deep Workspace Analysis

```javascript
// GET /assistant/analyze
const response = await fetch('/assistant/analyze');
const analysis = await response.json();
```

## Functions (enhanced-context.js)

```javascript
import {
  getEnhancedProjectContext,
  performInternetSearch,
  analyzeWorkspaceDeep
} from './enhanced-context.js';

// Get full project context
const context = await getEnhancedProjectContext({
  threadId: 'uuid',
  includeThreadContext: true
});

// Search the web
const results = await performInternetSearch(query, userId);

// Analyze workspace
const analysis = await analyzeWorkspaceDeep();
```

## When to Use

- **Project context** - Need database state + memory + repo structure
- **Web search** - Find external information
- **Workspace analysis** - Deep analysis of codebase state

## Connections

- Uses `../eidolon/memory/pg.js` for memory persistence
- Uses `../db/drizzle.js` for database access
- Related to `../agent/` for real-time access
- Related to `../eidolon/` for enhanced context

## See Also

- [server/assistant/README.md](../../server/assistant/README.md) - Detailed documentation
- [agent.md](agent.md) - WebSocket agent
- [eidolon.md](eidolon.md) - Eidolon SDK
- [README.md](README.md) - AI tools index
