> **Last Verified:** 2026-01-06

# Assistant (`server/assistant/`)

## Purpose

AI assistant proxy layer providing enhanced context, internet search, and workspace analysis for AI integrations.

## Files

| File | Purpose |
|------|---------|
| `routes.js` | Assistant API endpoints (context, search, analyze) |
| `enhanced-context.js` | Project context gathering and workspace analysis |
| `policy-loader.js` | Policy configuration loading |
| `policy-middleware.js` | Policy enforcement middleware |
| `thread-context.js` | Thread context management |

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/assistant/context` | GET | Get enhanced project context |
| `/assistant/search` | POST | Perform internet search |
| `/assistant/analyze` | GET | Deep workspace analysis |

## Key Functions (enhanced-context.js)

```javascript
import { getEnhancedProjectContext, performInternetSearch, analyzeWorkspaceDeep } from './enhanced-context.js';

// Get project context with database state, memory, and repo structure
const context = await getEnhancedProjectContext({
  threadId: 'uuid',
  includeThreadContext: true
});

// Perform internet search
const results = await performInternetSearch(query, userId);

// Analyze workspace deeply
const analysis = await analyzeWorkspaceDeep();
```

## Context Structure

```javascript
{
  currentTime: '2025-12-15T...',
  environment: 'production',
  workspace: '/path/to/workspace',

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
  threadContext: null,

  // Repository structure
  repositoryStructure: {},
  configFiles: {},
  rootFiles: []
}
```

## Connections

- **Uses:** `../eidolon/memory/pg.js` for memory persistence
- **Uses:** `../db/drizzle.js` for database access
- **Related:** `../lib/ai/` for main AI functionality
- **Related:** `../agent/` for agent infrastructure
- **Related:** `../eidolon/` for enhanced context
