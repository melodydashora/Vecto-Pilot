# Memory System

Persistent cross-session memory for AI tools.

## Overview

The memory system allows Claude to:
- Remember decisions from past sessions
- Store learnings from debugging
- Track user preferences
- Maintain project context

## Storage Locations

| System | Table | TTL Support | Purpose |
|--------|-------|-------------|---------|
| MCP Memory | `mcp_memory` | Yes | Claude Desktop memories |
| Eidolon Memory | `eidolon_memory` | Yes | Eidolon SDK state |
| Assistant Memory | `assistant_memory` | Yes | Assistant context |

## MCP Memory Tools

Available via MCP Server:

### memory_store

```javascript
await memory_store({
  key: 'decision_ai_models',
  content: 'GPT-5.2 for consolidation, reasoning_effort: medium',
  tags: ['decision', 'ai', 'models'],
  metadata: { decided_on: '2024-12-15' },
  ttl_hours: 720  // 30 days
});
```

### memory_retrieve

```javascript
const memory = await memory_retrieve({
  key: 'decision_ai_models'
});
// Returns: { key, content, tags, metadata, created_at, updated_at }
```

### memory_search

```javascript
const results = await memory_search({
  tags: ['decision', 'ai'],
  limit: 10
});
// Returns array of matching memories
```

### memory_clear

```javascript
// Clear by key pattern
await memory_clear({ key_pattern: 'session_%' });

// Clear by tags
await memory_clear({ tags: ['temporary'] });

// Clear expired
await memory_clear({ clear_expired: true });
```

### context_get

```javascript
const context = await context_get();
// Returns session context and memory stats
```

## Key Naming Conventions

| Prefix | Purpose | Example |
|--------|---------|---------|
| `decision_` | Architecture decisions | `decision_ai_models` |
| `session_` | Session learnings | `session_2024_12_15` |
| `user_` | User preferences | `user_preferences` |
| `debug_` | Debugging notes | `debug_isopen_fix` |
| `pattern_` | Code patterns | `pattern_error_handling` |
| `doc_update_` | Documentation TODOs | `doc_update_2024_12_15` |

## Tag Conventions

| Tag | Purpose |
|-----|---------|
| `decision` | Architecture decisions |
| `learning` | Session learnings |
| `bug` | Bug fixes and causes |
| `preference` | User preferences |
| `pattern` | Code patterns |
| `warning` | Things to avoid |
| `documentation` | Doc updates needed |
| `todo` | Action items |

## Session Rituals

### Session Start

Load relevant context:

```javascript
// 1. Load key decisions
const decisions = await memory_search({ tags: ['decision'], limit: 20 });

// 2. Load recent learnings
const learnings = await memory_search({ tags: ['learning'], limit: 5 });

// 3. Load user preferences
const prefs = await memory_retrieve({ key: 'user_preferences' });

// 4. Check pending doc updates
const todos = await memory_search({ tags: ['documentation', 'todo'], limit: 10 });
```

### Session End

Store important learnings:

```javascript
// 1. Store session learnings
await memory_store({
  key: `session_${YYYY_MM_DD}_learnings`,
  content: 'Fixed X, discovered Y, user prefers Z',
  tags: ['session', 'learning'],
  ttl_hours: 720  // 30 days
});

// 2. Update changed decisions
await memory_store({
  key: 'decision_xyz',
  content: 'Updated decision...',
  tags: ['decision', 'updated'],
  metadata: { updated_on: '2024-12-15', reason: '...' }
});

// 3. Flag documentation needing updates
await memory_store({
  key: `doc_update_${YYYY_MM_DD}`,
  content: 'Update CLAUDE.md for new API',
  tags: ['documentation', 'todo'],
  ttl_hours: 168  // 1 week
});
```

## Pre-populated Decisions

Key decisions that should always be in memory:

### AI Models
```
Key: decision_ai_models
Content: Use callModel() adapter, never direct API calls.
- Strategist: claude-opus-4-6
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

## Database Schema

```sql
CREATE TABLE mcp_memory (
  key VARCHAR(255) PRIMARY KEY,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP
);

CREATE INDEX idx_mcp_memory_tags ON mcp_memory USING GIN (tags);
```

## Cleanup

Run periodically:

```javascript
await memory_clear({ clear_expired: true });
```

The Eidolon compactor runs hourly to clean up expired entries.

## See Also

- [../memory/README.md](../memory/README.md) - Memory layer documentation
- [../memory/session-start.md](../memory/session-start.md) - Session start ritual
- [../memory/session-end.md](../memory/session-end.md) - Session end ritual
- [mcp.md](mcp.md) - MCP tools reference
- [README.md](README.md) - AI tools index
