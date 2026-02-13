# AI Context (`server/lib/ai/context/`)

## Purpose

This directory contains the shared logic for enhanced context gathering and memory management used by different AI identities (Agent, Assistant, Eidolon).

## Files

| File | Purpose |
|------|---------|
| `enhanced-context-base.js` | Consolidated base implementation for context gathering |

## Usage

The `enhanced-context-base.js` module exports generic functions that can be configured with a specific identity and memory table.

```javascript
import { getEnhancedProjectContextBase } from './enhanced-context-base.js';

// Create identity-specific wrapper
export async function getAgentContext(options) {
  return getEnhancedProjectContextBase('agent', 'agent_memory', options);
}
```

## Functions

### `getEnhancedProjectContextBase(identity, memoryTable, options)`
Gathers comprehensive project context including:
- Database state (recent snapshots, strategies, actions)
- Memory (preferences, session history, project state)
- Repository structure
- Configuration files

### `performInternetSearchBase(query, userId, identity, memoryTable, systemPrompt)`
Performs an internet search using Claude's web capabilities and stores the result in memory.

### `analyzeWorkspaceDeepBase(identity)`
Performs deep analysis of workspace statistics (database counts, memory entries).

### `storeIdentityMemory(identity, memoryTable, title, content, metadata, ttlDays)`
Stores a memory entry for a specific identity.

### `getIdentityMemory(identity, memoryTable, userId, limit)`
Retrieves memory entries for a specific identity.

### `storeCrossThreadMemory` / `getCrossThreadMemory`
Shared functions for cross-thread memory persistence (re-exported from base).
