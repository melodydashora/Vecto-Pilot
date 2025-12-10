# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Vecto Pilot is an AI-powered rideshare intelligence platform. It uses a multi-model AI pipeline (Claude Opus 4.5, Gemini 3.0 Pro, GPT-5.1) to generate venue recommendations and tactical guidance for drivers.

## Quick Start

```bash
npm run dev              # Development server (port 5000)
npm run typecheck        # TypeScript checking
npm run lint             # ESLint
npm run test             # All tests
npm run lint && npm run typecheck && npm run build  # Pre-PR
```

## Documentation Structure

**Every folder has a README.md** explaining its purpose. Start here:

### Core Documentation
| Document | Purpose |
|----------|---------|
| [docs/README.md](docs/README.md) | Documentation index |
| [docs/architecture/api-reference.md](docs/architecture/api-reference.md) | API endpoints |
| [docs/architecture/database-schema.md](docs/architecture/database-schema.md) | Database tables |
| [docs/architecture/ai-pipeline.md](docs/architecture/ai-pipeline.md) | AI models & flow |
| [docs/architecture/constraints.md](docs/architecture/constraints.md) | Critical rules |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Full system overview |
| [LESSONS_LEARNED.md](LESSONS_LEARNED.md) | Historical issues |

### Server Folders
| Folder | Purpose |
|--------|---------|
| [server/api/](server/api/README.md) | API routes by domain |
| [server/lib/](server/lib/README.md) | Business logic |
| [server/lib/ai/](server/lib/ai/README.md) | AI adapters & providers |
| [server/db/](server/db/README.md) | Database connection |
| [server/config/](server/config/README.md) | Configuration |

### Client Folders
| Folder | Purpose |
|--------|---------|
| [client/src/](client/src/README.md) | Frontend overview |
| [client/src/hooks/](client/src/hooks/README.md) | Custom hooks |
| [client/src/contexts/](client/src/contexts/README.md) | React contexts |

## Critical Rules

### Model Parameters

**GPT-5.1** - Avoid 400 errors:
```javascript
// CORRECT
{ model: "gpt-5.1", reasoning_effort: "medium", max_completion_tokens: 32000 }
// WRONG - causes 400
{ reasoning: { effort: "medium" } }  // Nested format
{ temperature: 0.7 }  // Not supported
```

**Gemini 3 Pro**:
```javascript
// CORRECT
{ generationConfig: { thinkingConfig: { thinkingLevel: "HIGH" } } }
// WRONG
{ thinking_budget: 8000 }
```

### Model Adapter Pattern

Always use the adapter - never call AI APIs directly:
```javascript
import { callModel } from './lib/ai/adapters/index.js';
const result = await callModel('strategist', { system, user });
```

### Before Creating Files

1. **Check folder README first** - documents existing files
2. Search for existing code: `grep -r "functionName" server/`
3. Check LESSONS_LEARNED.md for known issues

### Code Conventions

- Unused variables: prefix with `_`
- TypeScript strict mode in client
- Database: link all data to `snapshot_id`
- Sorting: `created_at DESC` (newest first)

### Location Rules

- GPS-first: no IP fallback, no default locations
- Coordinates from Google APIs or DB, never from AI
- `location-context-clean.tsx` is the single weather source

## Environment Variables

### Required
```bash
DATABASE_URL=...           # PostgreSQL
OPENAI_API_KEY=...         # GPT-5.1
GEMINI_API_KEY=...         # Gemini 3.0 Pro
ANTHROPIC_API_KEY=...      # Claude Opus 4.5
GOOGLE_MAPS_API_KEY=...    # Places, Routes, Weather
```

### Model Configuration
```bash
STRATEGY_STRATEGIST=claude-opus-4-5-20251101
STRATEGY_BRIEFER=gemini-3-pro-preview
STRATEGY_CONSOLIDATOR=gpt-5.1
STRATEGY_EVENT_VALIDATOR=claude-opus-4-5-20251101
```

## Key Files

| File | Purpose |
|------|---------|
| `gateway-server.js` | Main Express server |
| `shared/schema.js` | Drizzle ORM schema |
| `server/lib/ai/adapters/index.js` | Model adapter dispatcher |
| `client/src/pages/co-pilot.tsx` | Main dashboard (1700+ LOC) |
| `client/src/contexts/location-context-clean.tsx` | Location provider |

## AI Pipeline Summary

```
POST /api/blocks-fast → TRIAD Pipeline (~35-50s)
├── Phase 1 (Parallel): Strategist + Briefer + Holiday
├── Phase 2 (Parallel): Daily + Immediate Consolidator
├── Phase 3: Venue Planner + Enrichment
└── Phase 4: Event Validator
```

See [AI Pipeline](docs/architecture/ai-pipeline.md) for details.

## Holiday Override

```bash
node server/scripts/holiday-override.js list    # List overrides
node server/scripts/holiday-override.js test    # Test detection
```

Config: `server/config/holiday-override.json`

## Related Files

- `REORGANIZATION_PLAN.md` - Codebase organization status
- `LESSONS_LEARNED.md` - Historical issues (read before changes)
