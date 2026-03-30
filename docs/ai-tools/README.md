> **Last Verified:** 2026-01-06

# AI Tools Documentation

Index of all AI-powered tools and capabilities available in Vecto Pilot.

## Quick Reference

| Tool System | Location | Purpose |
|-------------|----------|---------|
| [Workspace Agent](agent.md) | `server/agent/` | WebSocket-based workspace access |
| [Eidolon SDK](eidolon.md) | `server/eidolon/` | Enhanced context and deep thinking |
| [Memory System](memory.md) | `server/eidolon/memory/` | Persistent cross-session memory |
| [Assistant](assistant.md) | `server/assistant/` | Context enrichment and search |

## When to Use What

### For WebSocket Real-time Access
Use **Workspace Agent** - Real-time bidirectional communication.

```javascript
// WebSocket connection
ws.connect('/agent/ws');
```

### For Deep Analysis
Use **Eidolon SDK** - Context awareness, deep thinking, enhanced memory.

```javascript
import { ContextAwarenessEngine } from '../eidolon/core/context-awareness';
const snapshot = await engine.captureSnapshot();
```

### For Persistent Memory
Use **Memory System** - Store learnings, decisions, preferences.

```javascript
await memory_store({
  key: 'decision_ai_models',
  content: 'Use GPT-5.2 for consolidation...',
  tags: ['decision', 'ai']
});
```

## Tool Categories

### File Operations
- `read_file` - Read files with line ranges
- `write_file` - Create/update files
- `edit_file` - Find and replace text
- `list_directory` - Browse directories

### Search Operations
- `grep_search` - Content search with regex
- `glob_find` - Find files by pattern
- `search_symbols` - Find functions/classes

### Database Operations
- `sql_query` - Execute SELECT queries
- `sql_execute` - Execute INSERT/UPDATE/DELETE
- `db_schema` - Get table schema

### Memory Operations
- `memory_store` - Store persistent memories
- `memory_retrieve` - Get by key
- `memory_search` - Search by tags

### Project Intelligence
- `get_guidelines` - **CALL FIRST** - Critical rules
- `get_repo_info` - Project overview
- `code_map` - Map code structure

### AI Analysis
- `ai_analyze` - Analyze code for issues
- `ai_explain` - Explain code structure
- `ai_suggest` - Suggest improvements

## Best Practices

### 1. Always Call get_guidelines First

Before ANY file operation:
```javascript
const guidelines = await get_guidelines();
// Check critical rules before proceeding
```

### 2. Use Memory for Cross-Session Context

```javascript
// Start of session
const decisions = await memory_search({ tags: ['decision'] });

// End of session
await memory_store({
  key: 'session_learnings',
  content: 'What was learned...',
  tags: ['session', 'learning']
});
```

### 3. Search Before Creating

```javascript
// Always check if something exists
const existing = await grep_search({
  pattern: 'functionName',
  file_type: 'js'
});
```

## See Also

- [agent.md](agent.md) - Workspace agent details
- [eidolon.md](eidolon.md) - Eidolon SDK features
- [memory.md](memory.md) - Memory system guide
- [assistant.md](assistant.md) - Assistant API
- [../memory/README.md](../memory/README.md) - Memory layer documentation
