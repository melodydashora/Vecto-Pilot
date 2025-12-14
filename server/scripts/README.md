# Scripts (`server/scripts/`)

## Purpose

Server-side utility scripts for maintenance, operations, and event discovery.

## Scripts

| Script | Purpose |
|--------|---------|
| `sync-events.mjs` | **Event Discovery** - Multi-model AI event search |
| `holiday-override.js` | Manage holiday override configuration |
| `db-doctor.js` | Database health checks and repairs |
| `seed-dfw-venues.js` | Seed DFW area venue data |
| `run-sql-migration.js` | Execute SQL migrations |
| `continuous-monitor.js` | Continuous system monitoring |
| `self-healing-monitor.js` | Self-healing system monitor |
| `test-gemini-search.js` | Test Gemini search functionality |
| `workspace-startup.sh` | Workspace initialization script |

## Event Discovery (`sync-events.mjs`)

Multi-model AI event discovery system. Searches for local events using up to 6 AI models and stores results in `discovered_events` table with deduplication.

### Two Modes

| Mode | Models Used | Use Case |
|------|-------------|----------|
| **Normal** | SerpAPI + GPT-5.2 | Fast, during snapshot runs |
| **Daily** | All 6 models | Comprehensive, on-demand |

### Models (Daily Mode)
1. **SerpAPI** - Google Events engine (fastest: ~81 events/sec)
2. **GPT-5.2** - OpenAI Responses API with web_search
3. **Gemini 3 Pro** - Google Search grounding
4. **Gemini 2.5 Pro** - Google Search grounding
5. **Claude Sonnet** - Anthropic web_search_20250305
6. **Perplexity Reasoning Pro** - Deep web search

### Programmatic Usage

```javascript
import { syncEventsForLocation } from '../scripts/sync-events.mjs';

// Normal mode (SerpAPI + GPT-5.2 only)
const result = await syncEventsForLocation(
  { city: 'Dallas', state: 'TX', lat: 32.7767, lng: -96.7970 },
  false  // isDaily=false
);

// Daily mode (all 6 models)
const result = await syncEventsForLocation(
  { city: 'Dallas', state: 'TX', lat: 32.7767, lng: -96.7970 },
  true   // isDaily=true
);

// Result: { events: [...], inserted: 12, skipped: 33 }
```

### Exports
- `syncEventsForLocation(location, isDaily)` - Main entry point
- `searchWithSerpAPI(city, state)` - SerpAPI search
- `searchWithGPT52(city, state, lat, lng)` - GPT-5.2 search
- `searchWithGemini3Pro(city, state, lat, lng)` - Gemini 3 Pro search
- `searchWithGemini25Pro(city, state, lat, lng)` - Gemini 2.5 Pro search
- `searchWithClaude(city, state, lat, lng)` - Claude search
- `searchWithPerplexityReasoning(city, state, lat, lng)` - Perplexity search
- `generateEventHash(event)` - Deduplication hash
- `storeEvents(db, events)` - Store events in DB

### Environment Variables
```bash
SERP_API_KEY=...        # or SERPAPI_API_KEY
OPENAI_API_KEY=...      # GPT-5.2
GEMINI_API_KEY=...      # Gemini models
ANTHROPIC_API_KEY=...   # Claude
PERPLEXITY_API_KEY=...  # Perplexity
```

See [Event Discovery Architecture](../../docs/architecture/event-discovery.md) for full documentation.

## Usage

```bash
# Holiday override management
node server/scripts/holiday-override.js list
node server/scripts/holiday-override.js add "Happy Holidays" "2024-12-01" "2025-01-02"
node server/scripts/holiday-override.js remove <id>
node server/scripts/holiday-override.js enable
node server/scripts/holiday-override.js disable
node server/scripts/holiday-override.js test

# Database operations
node server/scripts/db-doctor.js
node server/scripts/run-sql-migration.js

# Testing
node server/scripts/test-gemini-search.js
```

## Connections

- **Related:** `../config/holiday-override.json`
- **Related:** `../../shared/schema.js` (discovered_events table)
- **Related:** `../api/briefing/briefing.js` (event discovery endpoints)
- **Used for:** Manual system configuration, database operations, testing, event discovery
