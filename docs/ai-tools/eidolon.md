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
│   ├── llm.ts                   # Claude API wrapper
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

### LLM Client

Claude API wrapper with token tracking:

```typescript
import { LLMClient } from './core/llm';

const client = new LLMClient({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-opus-4-6-20260201',
  maxTokens: 8192,
  temperature: 0.1
});

const response = await client.chat([
  { role: 'user', content: 'Analyze this code...' }
], systemPrompt);
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

- [server/eidolon/README.md](../../server/eidolon/README.md) - Detailed documentation
- [server/eidolon/core/README.md](../../server/eidolon/core/README.md) - Core components
- [memory.md](memory.md) - Memory system guide
- [README.md](README.md) - AI tools index
