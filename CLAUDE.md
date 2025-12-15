# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Vecto Pilot is an AI-powered rideshare intelligence platform. It uses a multi-model AI pipeline (Claude Opus 4.5, Gemini 3.0 Pro, GPT-5.2) to generate venue recommendations and tactical guidance for drivers.

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
| [docs/architecture/](docs/architecture/README.md) | Architecture docs (13 focused files) |
| [docs/preflight/](docs/preflight/README.md) | **Pre-flight cards (read before edits)** |
| [docs/memory/](docs/memory/README.md) | Memory layer (session rituals) |
| [docs/ai-tools/](docs/ai-tools/README.md) | AI tools documentation |
| [docs/review-queue/](docs/review-queue/README.md) | **Change analyzer findings (check on session start)** |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System overview + folder index |
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
| [client/src/components/](client/src/components/README.md) | UI components |
| [client/src/hooks/](client/src/hooks/README.md) | Custom hooks |
| [client/src/contexts/](client/src/contexts/README.md) | React contexts |
| [client/src/lib/](client/src/lib/README.md) | Core utilities |
| [client/src/utils/](client/src/utils/README.md) | Feature helpers |
| [client/src/types/](client/src/types/README.md) | TypeScript types |
| [client/src/features/](client/src/features/README.md) | Feature modules |
| [client/src/pages/](client/src/pages/README.md) | Page components |

## Available AI Tools

| Tool System | When to Use |
|-------------|-------------|
| [MCP Server](docs/ai-tools/mcp.md) | Claude Desktop integration (39 tools) |
| [Memory System](docs/ai-tools/memory.md) | Persistent cross-session storage |
| [Workspace Agent](docs/ai-tools/agent.md) | WebSocket real-time access |
| [Eidolon SDK](docs/ai-tools/eidolon.md) | Deep analysis & context awareness |
| [Assistant API](docs/ai-tools/assistant.md) | Context enrichment & web search |

**Key Memory Tools:**
```javascript
// Store a decision
await memory_store({ key: 'decision_xyz', content: '...', tags: ['decision'] });

// Search memories
await memory_search({ tags: ['decision'], limit: 10 });

// Get project context
const context = await context_get();
```

See [docs/ai-tools/README.md](docs/ai-tools/README.md) for full documentation.

## Critical Rules

### Model Parameters

**GPT-5.2** - Avoid 400 errors:
```javascript
// CORRECT
{ model: "gpt-5.2", reasoning_effort: "medium", max_completion_tokens: 32000 }
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

### Venue Open/Closed Status

**Server-side** (`venue-enrichment.js`): `isOpen` is calculated using the **venue's timezone** via `Intl.DateTimeFormat` with snapshot timezone and stored in `ranking_candidates.features.isOpen`.

**Client-side** (`BarsTable.tsx`): Trusts server's `isOpen` value. **No client-side recalculation.**

```javascript
// Server: venue-enrichment.js - Calculates with venue timezone
// Uses Intl.DateTimeFormat with snapshot.timezone

// Client: BarsTable.tsx - Trusts server value
const isOpen = bar.isOpen;  // Trust server's timezone-aware calculation
```

**Why no client recalculation?** Browser timezone ≠ venue timezone. Client-side recalculation caused late-night venues to show as "Closed" incorrectly. Server uses the correct venue timezone.

## Pre-flight Checklist

**Before ANY edit**, read the relevant quick-reference card:

| Area | Card | Key Rules |
|------|------|-----------|
| AI/Models | [docs/preflight/ai-models.md](docs/preflight/ai-models.md) | Model parameters, adapter pattern |
| Location/GPS | [docs/preflight/location.md](docs/preflight/location.md) | GPS-first, coordinate sources |
| Database | [docs/preflight/database.md](docs/preflight/database.md) | snapshot_id linking, sorting |
| Code Style | [docs/preflight/code-style.md](docs/preflight/code-style.md) | Conventions, patterns |

### Pre-flight Workflow

```
Before ANY edit:
1. What area does this touch? (AI, database, location, UI)
2. Read the relevant preflight card (docs/preflight/*.md)
3. Grep for existing implementations
4. THEN make the change
```

## Memory Layer

Persistent memory for context across sessions. See [docs/memory/](docs/memory/README.md) for full documentation.

### Session Start

Load context at session start:
```javascript
memory_search({ tags: ["decision"], limit: 20 })  // Architecture decisions
memory_search({ tags: ["learning"], limit: 5 })   // Recent learnings
memory_retrieve({ key: "user_preferences" })       // User preferences

// Also check for pending doc reviews from Change Analyzer
Read({ file_path: "docs/review-queue/pending.md" })
```

### Session End

Store learnings before ending:
```javascript
memory_store({
  key: "session_YYYY_MM_DD_learnings",
  content: "What was learned/fixed/discovered",
  tags: ["session", "learning"],
  ttl_hours: 720
})
```

### Key Memory Prefixes

| Prefix | Purpose |
|--------|---------|
| `decision_` | Architecture decisions |
| `session_` | Session learnings |
| `user_` | User preferences |
| `debug_` | Debugging notes |

## Post-Change Documentation

After completing significant changes, ask yourself:

### Documentation Check
```
1. Does this change any documented behavior?
   → If yes, update the relevant doc in docs/architecture/ or docs/preflight/

2. Should LESSONS_LEARNED.md be updated?
   → If you discovered a non-obvious fix or pattern, add it

3. Are there new constraints to add?
   → If you found something that "must always" or "must never" be done

4. Should this be stored in memory?
   → If it's a decision, learning, or user preference
```

### When to Update Docs

| Change Type | Update |
|-------------|--------|
| New API endpoint | `docs/architecture/api-reference.md` |
| Database change | `docs/architecture/database-schema.md` |
| AI model change | `docs/preflight/ai-models.md` |
| New component | Folder README.md |
| Bug fix with lesson | `LESSONS_LEARNED.md` |
| Architecture decision | `docs/architecture/decisions.md` + memory |

### Memory Storage

```javascript
// Store significant decisions
memory_store({
  key: "decision_feature_name",
  content: "Decision details and reasoning",
  tags: ["decision", "feature_area"],
  metadata: { decided_on: "YYYY-MM-DD", reason: "..." }
})

// Flag docs needing update
memory_store({
  key: "doc_update_YYYY_MM_DD",
  content: "Which doc needs what update",
  tags: ["documentation", "todo"],
  ttl_hours: 168  // 1 week
})
```

## Change Analyzer

Automated sub-agent that runs on server startup to flag documentation that may need updates.

### How It Works

1. **Server starts** → Change Analyzer runs automatically
2. **Git analysis** → Detects modified, added, deleted files
3. **Doc mapping** → Maps changed files to potentially affected docs
4. **Output** → Appends findings to `docs/review-queue/`

### Review Queue Files

| File | Purpose |
|------|---------|
| `docs/review-queue/pending.md` | Current items needing review |
| `docs/review-queue/YYYY-MM-DD.md` | Daily analysis logs |

### Manual Trigger

```javascript
// Via MCP tool
analyze_changes
```

### Session Workflow

**At session start:**
1. Check `docs/review-queue/pending.md` for flagged items
2. Review high-priority items
3. Update docs if needed

**After reviewing:**
```markdown
// Change status in pending.md
### Status: PENDING  →  ### Status: REVIEWED
```

See [docs/review-queue/README.md](docs/review-queue/README.md) for full documentation.

## Environment Variables

### Required
```bash
DATABASE_URL=...           # PostgreSQL
OPENAI_API_KEY=...         # GPT-5.2
GEMINI_API_KEY=...         # Gemini 3.0 Pro
ANTHROPIC_API_KEY=...      # Claude Opus 4.5
GOOGLE_MAPS_API_KEY=...    # Places, Routes, Weather
```

### Model Configuration
```bash
STRATEGY_STRATEGIST=claude-opus-4-5-20251101
STRATEGY_BRIEFER=gemini-3-pro-preview
STRATEGY_CONSOLIDATOR=gpt-5.2
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

## Complete Folder Map

### Server Structure
```
server/
├── api/                    # API routes (domain-organized)
│   ├── auth/               # Authentication endpoints
│   ├── briefing/           # Events, traffic, news, weather
│   ├── chat/               # AI Coach text/voice chat, TTS
│   ├── feedback/           # User feedback, actions logging
│   ├── health/             # Health checks, diagnostics
│   ├── location/           # GPS resolution, snapshots
│   ├── research/           # Vector search, research
│   ├── strategy/           # Strategy generation, blocks, SSE events
│   ├── venue/              # Venue intelligence, events
│   └── utils/              # HTTP helpers, timing
│
├── lib/                    # Business logic
│   ├── ai/                 # AI layer
│   │   ├── adapters/       # Model adapters (anthropic, openai, gemini)
│   │   └── providers/      # AI providers (minstrategy, briefing, etc.)
│   ├── briefing/           # Briefing service
│   ├── external/           # Third-party APIs (Perplexity, FAA)
│   ├── infrastructure/     # Job queue
│   ├── location/           # Geo, holiday detection, snapshot context
│   ├── strategy/           # Strategy pipeline, providers, validation
│   └── venue/              # Venue intelligence, enrichment, places
│
├── config/                 # Configuration files
├── db/                     # Database connection, pool, migrations
├── jobs/                   # Background workers (triad-worker)
├── logger/                 # Logging utilities (ndjson, module logger)
├── middleware/             # Express middleware (auth, validation)
├── util/                   # Utilities (circuit breaker, UUID, ETA)
├── bootstrap/              # Server startup, route mounting
├── agent/                  # Workspace agent (file ops, shell, SQL)
├── eidolon/                # Enhanced SDK (memory, tools, policy)
├── assistant/              # Assistant proxy layer
├── gateway/                # Gateway proxy
├── scripts/                # Server-side scripts
├── types/                  # TypeScript types
└── validation/             # Schema validation
```

### Client Structure
```
client/src/
├── pages/                  # Route pages (co-pilot.tsx is main)
├── components/             # UI components
│   ├── co-pilot/           # Co-pilot specific (tabs, greeting)
│   ├── strategy/           # Strategy display components
│   ├── ui/                 # shadcn/ui primitives (46 components)
│   └── _future/            # Staged components
├── contexts/               # React contexts (location-context-clean.tsx)
├── hooks/                  # Custom hooks
│   ├── useBriefingQueries.ts   # Fetches weather, traffic, news
│   ├── useEnrichmentProgress.ts # Tracks briefing progress
│   ├── useStrategyLoadingMessages.ts # Strategy loading messages
│   ├── useStrategyPolling.ts   # Strategy polling with SSE
│   ├── useStrategy.ts          # Strategy state management
│   ├── useVenueLoadingMessages.ts # Venue loading messages
│   ├── useTTS.ts               # Text-to-speech with OpenAI
│   └── use-toast.ts            # Toast notifications
├── features/               # Feature modules
│   └── strategy/           # Strategy feature
├── lib/                    # Core utilities (daypart, queryClient)
├── types/                  # TypeScript types
├── utils/                  # Feature helpers (co-pilot-helpers.ts)
└── _future/                # Staged future features
    ├── engine/             # Reflection engine (Phase 17)
    └── user-settings/      # User profile types
```

### Root Structure
```
/
├── gateway-server.js       # Main Express server entry
├── strategy-generator.js   # Background strategy worker
├── sdk-embed.js            # SDK router factory
├── shared/schema.js        # Drizzle ORM database schema
├── docs/architecture/      # API reference, database, AI pipeline
├── tests/                  # Test suites (e2e, unit)
└── tools/                  # Development utilities
```

## Key Import Patterns

```javascript
// AI adapters (always use this, never call APIs directly)
import { callModel } from '../../lib/ai/adapters/index.js';

// Database
import { db } from '../../db/drizzle.js';
import { snapshots, strategies } from '../../../shared/schema.js';

// Logging - workflow-aware
import { triadLog, venuesLog, briefingLog } from '../../logger/workflow.js';

// Snapshot context
import { getSnapshotContext } from '../../lib/location/get-snapshot-context.js';

// Strategy providers
import { providers } from '../../lib/strategy/providers.js';
```

## Logging Conventions

### Use Workflow Logger for Pipeline Operations

```javascript
import { triadLog, venuesLog } from '../../logger/workflow.js';

// TRIAD pipeline (strategy generation)
triadLog.phase(1, `Starting for ${snapshotId.slice(0, 8)}`);
triadLog.done(1, `Saved (706 chars)`);

// VENUES pipeline (venue enrichment)
venuesLog.start(`Dallas, TX (${snapshotId.slice(0, 8)})`);
venuesLog.phase(2, `Routes API: calculating distances`);
venuesLog.done(2, `5 venues enriched`, 348);
venuesLog.complete(`5 venues for Dallas, TX`, 78761);
```

### Venue-Specific Logs (Critical for Debugging)

Always include the **venue name** so you can trace which venue is being processed:

```javascript
// GOOD - Can trace "The Mitchell" through the pipeline
console.log(`🏢 [VENUE "The Mitchell"] Calculating route from driver...`);
console.log(`🏢 [VENUE "The Mitchell"] Route: 5.2mi, 12min`);
console.log(`🏢 [VENUE "The Mitchell"] ✅ placeId=YES, status=OPEN, hours=5:00 PM - 2:00 AM`);

// BAD - Generic, can't trace which venue has the issue
console.log(`[Venue Enrichment] ✅ Distance: 5.2 mi`);
```

### No Model Names in Logs

Use **role names** (Strategist, Briefer, Consolidator) not model names (Claude, Gemini, GPT-5.2):

```javascript
// GOOD - Role-based
triadLog.phase(1, `Starting for ${snapshotId}`);  // Shows: [TRIAD 1/4 - Strategist]

// BAD - Model-specific (confusing, changes when models swap)
console.log(`[minstrategy] Starting Claude Opus for snapshot`);
```

### Workflow Phases Reference

| Component | Phases | Labels |
|-----------|--------|--------|
| TRIAD | 4 | Strategist, Briefer, Daily+NOW Strategy, SmartBlocks |
| VENUES | 4 | Tactical Planner, Routes API, Places API, DB Store |
| BRIEFING | 3 | Traffic, Events Discovery, Event Validation |

See `server/logger/README.md` for full documentation.

## Related Files

- `REORGANIZATION_PLAN.md` - Codebase organization status
- `LESSONS_LEARNED.md` - Historical issues (read before changes)
- Can we add the button in the UI to match the fetch daily strategy on briefing tab?