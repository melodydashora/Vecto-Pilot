> **Last Verified:** 2026-01-06

# Eidolon Core (`server/eidolon/core/`)

## Purpose

Core components for the Eidolon Enhanced SDK - LLM integration, context awareness, deep thinking, and memory management.

## Files

| File | Purpose |
|------|---------|
| `llm.ts` | Claude API client wrapper for Eidolon |
| `context-awareness.ts` | Workspace context capture and tracking |
| `deep-thinking-engine.ts` | Deep analysis and multi-step reasoning |
| `memory-enhanced.ts` | Enhanced memory with persistence |
| `memory-store.ts` | JSON-based memory storage utilities |
| `code-map.ts` | Codebase structure mapping |
| `deployment-tracker.ts` | Tracks deployment state across environments |

## Key Components

### LLMClient (llm.ts)

Claude API wrapper with token tracking:

```typescript
import { LLMClient } from './llm';

const client = new LLMClient({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-opus-4-5-20251101',
  maxTokens: 8192,
  temperature: 0.1
});

const response = await client.chat([
  { role: 'user', content: 'Analyze this code...' }
], systemPrompt);
```

### ContextAwarenessEngine (context-awareness.ts)

Captures workspace state snapshots:

```typescript
import { ContextAwarenessEngine } from './context-awareness';

const engine = new ContextAwarenessEngine(projectRoot);
const snapshot = await engine.captureSnapshot();
// Returns: codeMap, activeComponents, deploymentState, recentChanges
```

### DeepThinkingEngine (deep-thinking-engine.ts)

Multi-step reasoning for complex analysis:

```typescript
import { DeepThinkingEngine } from './deep-thinking-engine';

const engine = new DeepThinkingEngine(llmClient);
const result = await engine.analyze(problem, context);
// Returns: insights, recommendations, confidence scores
```

## Type Definitions

### ContextSnapshot

```typescript
interface ContextSnapshot {
  timestamp: string;
  codeMap: any[];
  activeComponents: string[];
  deploymentState: 'dev' | 'staging' | 'prod';
  componentLocations: Record<string, string>;
  recentChanges: string[];
  memoryCheckpoints: string[];
  deepAnalysis?: any;
  insights?: any[];
  recommendations?: any[];
}
```

### ComponentMap

```typescript
interface ComponentMap {
  name: string;
  path: string;
  type: 'page' | 'component' | 'hook' | 'util' | 'service';
  dependencies: string[];
  lastModified: string;
  prodStatus: 'deployed' | 'pending' | 'modified';
}
```

## Connections

- **Uses:** `../../lib/anthropic-extended.js` for Claude API
- **Used by:** `../enhanced-context.js` for context enrichment
- **Data from:** `../memory/pg.js` for persistent storage
