# Server Library (`server/lib/`)

## Purpose

Core business logic organized by domain. Each subfolder is self-contained with its own README explaining its files and connections.

## Structure

```
lib/
├── ai/              # AI model adapters and providers
├── briefing/        # Real-time briefing service
├── change-analyzer/ # Documentation maintenance system
├── external/        # Third-party API integrations
├── infrastructure/  # Logging, job queues
├── location/        # Location services (geocoding, holidays)
├── notifications/   # Alert and notification system
├── strategy/        # Strategy generation pipeline
├── subagents/       # Specialized AI subagents
├── venue/           # Venue intelligence and enrichment
├── ability-routes.js # Ability route definitions
├── auth.js          # Bearer token authentication
├── capabilities.js  # AI capability definitions
├── index.js         # Module exports
└── jwt.ts           # JWT token utilities
```

## Domain Overview

| Folder | Purpose | Key Export |
|--------|---------|------------|
| `ai/` | Model dispatching, adapters, providers | `callModel(role, {system, user})` |
| `briefing/` | Events, traffic, weather, news | `getOrGenerateBriefing()` |
| `change-analyzer/` | Documentation maintenance | `findAffectedDocs()` |
| `external/` | FAA, TTS, semantic search | `fetchFAAStatus()`, `synthesizeSpeech()` |
| `infrastructure/` | Cross-cutting concerns | `enqueue()`, logging |
| `location/` | Geocoding, holidays, validation | `detectHoliday()`, `validateConditions()` |
| `notifications/` | Email alerts, notifications | `sendAlert()` |
| `strategy/` | Strategy waterfall orchestration | `generateStrategyParallel()` |
| `subagents/` | Specialized AI subagents | `verifyEvent()` |
| `venue/` | Venue discovery and enrichment | `generateEnhancedSmartBlocks()` |

## Data Flow

```
Request → Routes → lib modules → External APIs/Database → Response

Strategy Pipeline:
┌─────────────────────────────────────────────────────────────┐
│  POST /api/blocks-fast                                       │
│    ↓                                                         │
│  strategy/strategy-generator-parallel.js                     │
│    ├── ai/providers/minstrategy.js (Claude Opus)            │
│    ├── ai/providers/briefing.js (Gemini + Google Search)    │
│    └── ai/providers/consolidator.js (Gemini/GPT-5.2)        │
│    ↓                                                         │
│  venue/enhanced-smart-blocks.js                              │
│    ├── venue/venue-intelligence.js (Google Places)          │
│    └── venue/venue-enrichment.js (Google Routes)            │
│    ↓                                                         │
│  Response: Smart Blocks with rankings                        │
└─────────────────────────────────────────────────────────────┘
```

## Import Patterns

Always import from the module's index or main file:

```javascript
// AI - use callModel for all AI calls
import { callModel } from './ai/adapters/index.js';

// Strategy
import { generateStrategyParallel } from './strategy/strategy-generator-parallel.js';

// Venue
import { generateEnhancedSmartBlocks } from './venue/enhanced-smart-blocks.js';

// Briefing
import { getOrGenerateBriefing } from './briefing/briefing-service.js';

// Location
import { detectHoliday } from './location/holiday-detector.js';
```

## Root Files

| File | Purpose |
|------|---------|
| `ability-routes.js` | Ability route definitions for AI capabilities |
| `auth.js` | Bearer token extraction from Authorization header |
| `capabilities.js` | AI capability definitions and registry |
| `index.js` | Barrel exports for lib modules |
| `jwt.ts` | JWT token verification, phantom user detection |
| `anthropic-extended.d.ts` | TypeScript definitions for Anthropic extended features |

## Connections

- **Imported by:** `server/api/*/` (all API endpoints use `../../lib/`)
- **Imports from:** `server/db/` (database via `../db/`), `shared/schema.js` (ORM schema via `../../shared/`)
- **External APIs:** Anthropic, OpenAI, Google (Gemini, Places, Routes, Weather)

## Import Path from API Routes

From `server/api/*/` files, use `../../lib/` to reach this folder:
```javascript
import { callModel } from '../../lib/ai/adapters/index.js';
import { generateEnhancedSmartBlocks } from '../../lib/venue/enhanced-smart-blocks.js';
```
