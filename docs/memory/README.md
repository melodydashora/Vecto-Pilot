# Memory Layer

Persistent memory system for Claude to maintain context across sessions.

## Overview

The memory layer uses the `mcp_memory` table to store key-value pairs with tags and optional TTL. This allows Claude to:
- Remember decisions made in past sessions
- Store learnings from debugging sessions
- Track user preferences
- Maintain project context

## Memory Tools (MCP)

| Tool | Purpose |
|------|---------|
| `memory_store` | Store a memory with key, content, tags, optional TTL |
| `memory_retrieve` | Get a specific memory by key |
| `memory_search` | Search by tags or content keywords |
| `memory_clear` | Clear memories by pattern or tags |
| `context_get` | Get session context and memory stats |

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

### Store a Decision

```javascript
memory_store({
  key: "decision_ai_models",
  content: "GPT-5.2 for consolidation (reasoning_effort flat), Gemini 3 Pro for briefing, Claude Opus 4.5 for strategy. Always use callModel() adapter.",
  tags: ["decision", "ai", "models"],
  metadata: { decided_on: "2024-12-15", reason: "GPT-5.2 400 errors with nested params" }
})
```

### Store a Session Learning

```javascript
memory_store({
  key: "session_2024_12_15_learnings",
  content: "1. BarsTable needs real-time isOpen calculation. 2. Routes API requires 30s future timestamp. 3. User prefers detailed commit messages.",
  tags: ["session", "learning", "december"],
  ttl_hours: 720  // 30 days
})
```

### Retrieve Relevant Context

```javascript
// Get specific decision
memory_retrieve({ key: "decision_ai_models" })

// Search for all AI-related decisions
memory_search({ tags: ["decision", "ai"] })

// Search for recent learnings
memory_search({ tags: ["learning"], limit: 10 })
```

## Session Rituals

### Session Start

At the beginning of a session, load relevant context:

```javascript
// 1. Load key decisions
memory_search({ tags: ["decision"], limit: 20 })

// 2. Load recent session learnings
memory_search({ tags: ["learning"], limit: 5 })

// 3. Load user preferences
memory_retrieve({ key: "user_preferences" })
```

### Session End

Before ending a session, store learnings:

```javascript
// 1. Store session learnings
memory_store({
  key: `session_${date}_learnings`,
  content: "Summary of what was learned/fixed/discovered",
  tags: ["session", "learning"],
  ttl_hours: 720
})

// 2. Update any decisions that changed
memory_store({
  key: "decision_xyz",
  content: "Updated decision...",
  tags: ["decision", "updated"]
})

// 3. Note any documentation that needs updating
memory_store({
  key: `doc_update_${date}`,
  content: "ARCHITECTURE.md needs update for new API endpoint",
  tags: ["documentation", "todo"],
  ttl_hours: 168  // 1 week
})
```

## Pre-populated Decisions

Key decisions that should always be in memory:

### AI Models
```
Key: decision_ai_models
Content: Use callModel() adapter, never direct API calls.
- Strategist: claude-opus-4-5-20251101
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

## Table Schema

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

## See Also

- [mcp-server/README.md](../../mcp-server/README.md) - MCP server documentation
- [CLAUDE.md](../../CLAUDE.md) - Project guidelines
