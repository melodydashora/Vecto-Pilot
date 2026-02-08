> **Last Verified:** 2026-01-06

# Memory Layer

Persistent memory system for AI assistants to maintain context across sessions.

**Last Updated:** 2025-12-27

## Overview

The memory layer uses **4 PostgreSQL tables** to store context for different AI systems:

| Table | Purpose | Used By |
|-------|---------|---------|
| `agent_memory` | Workspace agent context | Agent |
| `assistant_memory` | User preferences, conversations | Assistant, AI Coach |
| `eidolon_memory` | Session/project state | Eidolon framework |
| `cross_thread_memory` | Shared context across threads | All |

## Memory API Endpoints

The MCP server was removed. Memory is now accessed via REST API at `/agent/*`:

| Endpoint | Method | Purpose | TTL |
|----------|--------|---------|-----|
| `/agent/memory/preference` | POST | Store user preferences | 365 days |
| `/agent/memory/session` | POST | Store session state | 7 days |
| `/agent/memory/project` | POST | Store project state | 30 days |
| `/agent/memory/conversation` | POST | Log conversations | 30 days |
| `/agent/memory/conversations` | GET | Retrieve conversations | - |
| `/agent/context` | GET | Full context with memory | - |
| `/agent/context/summary` | GET | Workspace analysis | - |

### Thread Management

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/agent/thread/init` | POST | Initialize a new thread |
| `/agent/thread/:threadId` | GET | Get thread context |
| `/agent/thread/:threadId/message` | POST | Add message to thread |
| `/agent/thread/:threadId/decision` | POST | Track decision |
| `/agent/threads/recent` | GET | Get recent threads |

## Key Naming Conventions

Use prefixed keys for organization:

| Prefix | Purpose | Example |
|--------|---------|---------|
| `decision_` | Architecture decisions | `decision_ai_models` |
| `session_` | Session learnings | `session_2024_12_15` |
| `user_` | User preferences | `user_preferences` |
| `debug_` | Debugging notes | `debug_blocks_fast_fix` |
| `pattern_` | Code patterns | `pattern_error_handling` |

## Tag Conventions

Use consistent tags for searchability:

| Tag | Purpose |
|-----|---------|
| `decision` | Architecture/design decisions |
| `learning` | Things learned during session |
| `bug` | Bug fixes and root causes |
| `preference` | User preferences |
| `pattern` | Code patterns |
| `warning` | Things to avoid |

## Usage Patterns

### Store a Preference (via API)

```javascript
// POST /agent/memory/preference
fetch('/agent/memory/preference', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    key: 'ai_model_preferences',
    value: {
      strategist: 'claude-opus-4-6-20260201',
      briefer: 'gemini-3-pro-preview',
      consolidator: 'gpt-5.2'
    },
    userId: 'system'
  })
});
```

### Store Session State

```javascript
// POST /agent/memory/session
fetch('/agent/memory/session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    key: 'current_task',
    data: {
      task: 'Refactoring co-pilot pages',
      started: '2025-12-27T10:00:00Z',
      files_modified: ['routes.tsx', 'CoPilotLayout.tsx']
    },
    userId: 'system'
  })
});
```

### Log a Conversation

```javascript
// POST /agent/memory/conversation
fetch('/agent/memory/conversation', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    topic: 'React Router refactor',
    summary: 'Discussed breaking co-pilot.tsx into route-based pages',
    userId: 'system'
  })
});
```

### Get Full Context (AI Coach / Agent)

```javascript
// GET /agent/context - Returns everything
const response = await fetch('/agent/context?threadId=xxx');
const { context } = await response.json();

// context includes:
// - recentSnapshots, recentStrategies, recentActions (from DB)
// - agentPreferences, sessionHistory, projectState (from memory)
// - conversationHistory, capabilities, selfHealing status
```

## Internal Usage (Server-Side)

For server-side code, use the memory functions directly:

```javascript
import { memoryPut, memoryGet, memoryQuery } from '../eidolon/memory/pg.js';

// Store
await memoryPut({
  table: 'agent_memory',
  scope: 'decisions',
  key: 'ai_models',
  userId: null,
  content: { strategist: 'claude-opus-4-5' },
  ttlDays: 365
});

// Retrieve
const data = await memoryGet({
  table: 'agent_memory',
  scope: 'decisions',
  key: 'ai_models',
  userId: null
});

// Query scope
const items = await memoryQuery({
  table: 'agent_memory',
  scope: 'decisions',
  userId: null,
  limit: 50
});
```

## Pre-populated Decisions

Key decisions that should always be in memory:

### AI Models
```
Key: decision_ai_models
Content: Use callModel() adapter, never direct API calls.
- Strategist: claude-opus-4-6-20260201
- Briefer: gemini-3-pro-preview
- Consolidator: gpt-5.2 (reasoning_effort: "medium", max_completion_tokens: 32000)
Tags: [decision, ai, models]
```

### Location Rules
```
Key: decision_location
Content: GPS-first, no IP fallback, no default locations. Coordinates from Google APIs or DB only, never from AI.
Tags: [decision, location, gps]
```

### Database Rules
```
Key: decision_database
Content: All data links to snapshot_id. Sort by created_at DESC. Use Drizzle ORM.
Tags: [decision, database]
```

## Table Schemas

All four memory tables share the same structure (defined in `shared/schema.js`):

```sql
-- agent_memory, assistant_memory, eidolon_memory, cross_thread_memory
CREATE TABLE {table_name} (
  id SERIAL PRIMARY KEY,
  scope VARCHAR(255) NOT NULL,
  key VARCHAR(255) NOT NULL,
  user_id UUID,  -- NULL for system-wide entries
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP
);

CREATE INDEX idx_{table}_scope ON {table} (scope);
CREATE INDEX idx_{table}_user ON {table} (user_id);
CREATE INDEX idx_{table}_expires ON {table} (expires_at);
```

## Key Files

| File | Purpose |
|------|---------|
| `shared/schema.js` | Drizzle table definitions (lines 390-452) |
| `server/eidolon/memory/pg.js` | Memory operations (`memoryPut`, `memoryGet`, `memoryQuery`) |
| `server/agent/routes.js` | API endpoints (`/agent/memory/*`) |
| `server/agent/enhanced-context.js` | Context gathering with memory |
| `server/eidolon/memory/compactor.js` | Expired entry cleanup |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      AI Systems                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │  Claude  │  │ AI Coach │  │  Agent   │  │ Eidolon  │        │
│  │  Code    │  │ (client) │  │ (server) │  │ (server) │        │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │
│       │             │             │             │               │
│       ▼             ▼             ▼             ▼               │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                   /agent/* API Endpoints                    │ │
│  │  POST /memory/preference  POST /memory/session              │ │
│  │  POST /memory/project     GET /context                      │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │             server/eidolon/memory/pg.js                     │ │
│  │    memoryPut()  memoryGet()  memoryQuery()  memoryCompact() │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    PostgreSQL                               │ │
│  │  agent_memory | assistant_memory | eidolon_memory | cross_  │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Folder Contents

| File | Purpose |
|------|---------|
| `README.md` | This file - memory layer overview |
| `session-start.md` | Session start ritual |
| `session-end.md` | Session end ritual |
| `sessions/` | Daily session logs |

## See Also

- [sessions/README.md](sessions/README.md) - Session logs documentation
- [server/agent/README.md](../../server/agent/README.md) - Agent server
- [server/eidolon/README.md](../../server/eidolon/README.md) - Eidolon framework
- [CLAUDE.md](../../CLAUDE.md) - Project guidelines
- [docs/architecture/database-schema.md](../architecture/database-schema.md) - Full schema docs
