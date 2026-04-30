# Eidolon Enhanced SDK

Advanced AI orchestration framework with deep thinking, context awareness, and enhanced memory.

## Location

`server/eidolon/` - Framework integration for advanced AI capabilities.

## Purpose

Eidolon provides:
- Context awareness engine for workspace snapshots
- Deep thinking engine for multi-step reasoning
- Enhanced memory with PostgreSQL persistence
- Policy-based access control
- Diagnostic tools

## Structure

```
eidolon/
├── core/              # Core engines
│   ├── llm.ts                   # LLM API wrapper (see Configuration)
│   ├── context-awareness.ts     # Workspace snapshots
│   ├── deep-thinking-engine.ts  # Multi-step reasoning
│   ├── memory-enhanced.ts       # Enhanced memory
│   ├── memory-store.ts          # JSON memory storage
│   ├── code-map.ts              # Codebase mapping
│   └── deployment-tracker.ts    # Deployment state
├── memory/            # PostgreSQL persistence
│   ├── pg.js          # Memory adapter
│   └── compactor.js   # Cleanup job
├── tools/             # Diagnostic tools
│   ├── mcp-diagnostics.js  # MCP server diagnostics
│   └── sql-client.ts       # SQL query client
├── config.ts          # Configuration
├── enhanced-context.js # Context enrichment
├── policy-loader.js   # Policy loading
└── policy-middleware.js # Policy enforcement
```

## Configuration (`server/eidolon/config.ts`)

The `EIDOLON_CONFIG` object defines the core identity, model parameters, and unified capabilities of the Eidolon AI system.

- **Version:** `8.0.0-unified-max`
- **Model:** `gemini-3.1-pro-preview`
- **Context Window:** 1,000,000 tokens
- **Thinking Mode:** `high`
- **Access Level:** Complete IDE Integration with full root access, bypassing the standard assistant entirely.

## Core Components

### Context Awareness Engine

Captures workspace state snapshots:

```typescript
import { ContextAwarenessEngine } from './core/context-awareness';

const engine = new ContextAwarenessEngine(projectRoot);
const snapshot = await engine.captureSnapshot();

// Returns:
{
  timestamp: '2025-12-15T...',
  codeMap: [...],
  activeComponents: ['StrategyPage.tsx', 'BarsTable.tsx'],
  deploymentState: 'prod',
  componentLocations: { 'BarsTable': 'client/src/components/BarsTable.tsx' },
  recentChanges: ['Modified BarsTable.tsx'],
  memoryCheckpoints: ['session_2024_12_14'],
  insights: [...],
  recommendations: [...]
}
```

### Deep Thinking Engine

Multi-step reasoning for complex analysis:

```typescript
import { DeepThinkingEngine } from './core/deep-thinking-engine';

const engine = new DeepThinkingEngine(llmClient);
const result = await engine.analyze(problem, context);

// Returns insights, recommendations, confidence scores
```

### LLM Client & Planning

Gemini 3 Pro wrapper with 1M context window, high thinking mode, and autonomous planning capabilities (Atlas):

```typescript
import { LLMClient, llmPlan } from './core/llm';

// Basic Chat
const client = new LLMClient({
  apiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-3.1-pro-preview',
  maxTokens: 1000000,
  temperature: 0.1,
  thinkingMode: 'high'
});

// Chat with full response (content + usage)
const response = await client.chat([
  { role: 'user', content: 'Analyze this code...' }
], systemPrompt);

console.log(response.content);
console.log(response.usage); // { inputTokens: ..., outputTokens: ... }

// Simple Generation (returns string content directly)
const text = await client.generate('Explain quantum computing');

// Autonomous Planning
// Generates execution plans using unified tools:
// - fs_read, fs_write, fs_create, fs_delete, fs_rename
// - shell_exec, shell_unrestricted
// - sql_query, sql_execute, sql_ddl, sql_dml, sql_schema_introspection
// - http_fetch, websocket_access, api_integration
// - system_diagnostics, process_management
```

## Memory Persistence

PostgreSQL-backed memory storage:

```javascript
import { memoryPut, memoryGet, memoryList, memoryCompact } from './memory/pg.js';

// Store memory
await memoryPut({
  table: 'eidolon_memory',
  scope: 'project',
  key: 'analysis_result',
  userId: 'uuid',
  content: { data: '...' },
  ttlDays: 30
});

// Retrieve
const entry = await memoryGet({ table, scope, key, userId });

// List by scope
const entries = await memoryList({ table, scope, userId });

// Cleanup expired
await memoryCompact({ table });
```

## Diagnostic Tools

### MCP Diagnostics

```javascript
import MCPDiagnostics from './tools/mcp-diagnostics.js';

const diagnostics = new MCPDiagnostics(projectRoot);
await diagnostics.scanMCPConfiguration();
// Checks: .replit-assistant-override.json, mcp-config.json, server-config.json
```

### SQL Client

```typescript
import { SQLClient } from './tools/sql-client';

const client = new SQLClient();
const result = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
```

## When to Use

- **Deep analysis** - Complex multi-step reasoning tasks
- **Context snapshots** - Understanding workspace state
- **Policy enforcement** - Access control for AI operations
- **Memory persistence** - Long-term storage with TTL

## See Also

- [memory.md](memory.md) - Memory system guide
- [README.md](README.md) - AI tools index
