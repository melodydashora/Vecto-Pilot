# Server Library (`server/lib/`)

## Purpose

Core business logic organized by domain. Each subfolder is self-contained with its own README explaining its files and connections.

## Structure

```
lib/
├── ai/              # AI model adapters and providers
├── strategy/        # Strategy generation pipeline
├── venue/           # Venue intelligence and enrichment
├── location/        # Location services (geocoding, holidays)
├── briefing/        # Real-time briefing service
├── external/        # Third-party API integrations
├── infrastructure/  # Logging, job queues
├── auth.js          # Bearer token authentication
└── jwt.ts           # JWT token utilities
```

## Domain Overview

| Folder | Purpose | Key Export |
|--------|---------|------------|
| `ai/` | Model dispatching, adapters, providers | `callModel(role, {system, user})` |
| `strategy/` | Strategy waterfall orchestration | `generateStrategyParallel()` |
| `venue/` | Venue discovery and enrichment | `generateEnhancedSmartBlocks()` |
| `location/` | Geocoding, holidays, validation | `detectHoliday()`, `validateConditions()` |
| `briefing/` | Events, traffic, weather, news | `getOrGenerateBriefing()` |
| `external/` | FAA, TTS, semantic search | `fetchFAAStatus()`, `synthesizeSpeech()` |
| `infrastructure/` | Cross-cutting concerns | `enqueue()`, logging |

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
│    └── ai/providers/consolidator.js (Gemini/GPT-5.1)        │
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
| `auth.js` | Bearer token extraction from Authorization header |
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
