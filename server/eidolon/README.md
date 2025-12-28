# Eidolon (`server/eidolon/`)

## Purpose

Eidolon framework integration for AI agent orchestration and enhanced context management.

## Structure

```
eidolon/
├── core/           # Core Eidolon components
├── memory/         # Memory management (PostgreSQL, compaction)
├── tools/          # Eidolon tools (SQL client)
├── config.ts       # Eidolon configuration
├── index.ts        # Entry point
├── enhanced-context.js  # Context enrichment
├── policy-loader.js     # Policy loading utilities
└── policy-middleware.js # Policy enforcement middleware
```

## Files

| File | Purpose |
|------|---------|
| `config.ts` | Eidolon configuration |
| `index.ts` | Entry point |
| `enhanced-context.js` | Context enrichment for AI |
| `policy-loader.js` | Load policy configuration |
| `policy-middleware.js` | Policy enforcement middleware |

## Subfolders

### core/
| File | Purpose |
|------|---------|
| `llm.ts` | LLM integration |
| `context-awareness.ts` | Context awareness engine |
| `deep-thinking-engine.ts` | Deep thinking capabilities |
| `memory-enhanced.ts` | Enhanced memory management |
| `memory-store.ts` | Memory storage |
| `code-map.ts` | Code mapping utilities |
| `deployment-tracker.ts` | Deployment tracking |

### memory/
| File | Purpose |
|------|---------|
| `pg.js` | PostgreSQL memory storage |
| `compactor.js` | Memory compaction utilities |

### tools/
| File | Purpose |
|------|---------|
| `sql-client.ts` | SQL client for database operations |

## Connections

- **Related:** `../agent/` for base agent infrastructure
- **Tests:** `../../tests/eidolon/`
