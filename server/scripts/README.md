> **Last Verified:** 2026-01-06

# Scripts (`server/scripts/`)

## Purpose

Server-side utility scripts for maintenance, operations, and event discovery.

## Scripts

| Script | Purpose |
|--------|---------|
| `sync-events.mjs` | **Event Discovery** - Multi-model AI event search |
| `seed-markets.js` | **Global Markets** - Seed 140 markets with timezones (69 US + 71 international) |
| `seed-market-cities.js` | Seed market cities table with US city-market mappings |
| `seed-uber-airports.js` | **Uber Airports** - Sync 71 US airports with market data |
| `seed-uber-cities.js` | Seed Uber cities from platform data |
| `seed-countries.js` | Seed countries table with ISO 3166-1 codes |
| `holiday-override.js` | Manage holiday override configuration |
| `db-doctor.js` | Database health checks and repairs |
| `seed-dfw-venues.js` | Seed DFW area venue data |
| `run-sql-migration.js` | Execute SQL migrations |
| `continuous-monitor.js` | Continuous system monitoring |
| `self-healing-monitor.js` | Self-healing system monitor |
| `test-gemini-search.js` | Test Gemini search functionality |
| `parse-market-research.js` | Parse market research documents for intelligence |
| `workspace-startup.sh` | Workspace initialization script |
| `migrate-venues-to-catalog.ARCHIVED.js` | (Archived) Venue migration script |

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

## Global Markets (`seed-markets.js`)

Seeds the `markets` table with 140 global rideshare markets and their pre-stored timezones. This allows the location API to skip Google Timezone API calls for known markets.

### Coverage

| Region | Markets | Notable Cities |
|--------|---------|----------------|
| **US** | 69 | DFW, NYC, LA, Chicago, Miami, Houston, Phoenix, Seattle, Denver, + 60 more |
| **Canada** | 6 | Toronto, Vancouver, Montreal, Calgary, Edmonton, Ottawa |
| **UK** | 5 | London, Manchester, Birmingham, Glasgow, Edinburgh |
| **Australia** | 5 | Sydney, Melbourne, Brisbane, Perth, Adelaide |
| **India** | 6 | Delhi NCR, Mumbai, Bangalore, Chennai, Hyderabad, Pune |
| **Europe** | 15 | Paris, Berlin, Madrid, Barcelona, Milan, Rome, Amsterdam, + more |
| **Asia-Pacific** | 12 | Tokyo, Singapore, Hong Kong, Seoul, Bangkok, Jakarta, + more |
| **Latin America** | 9 | Mexico City, Sao Paulo, Buenos Aires, Bogota, Lima, + more |
| **Middle East/Africa** | 8 | Dubai, Tel Aviv, Cairo, Lagos, Nairobi, Cape Town, + more |

### Usage

```bash
# Seed/update all markets
node server/scripts/seed-markets.js

# Output shows:
# - US markets added/updated
# - International markets added/updated
# - Timezone distribution summary
# - Total city aliases count (3,333)
```

### Benefits

- **API Cost Savings**: Each market hit skips one Google Timezone API call ($0.005/request)
- **Latency Reduction**: ~200-300ms faster for known markets
- **City Alias Matching**: 3,437 suburbs/neighborhoods map to parent market timezone

## Uber Airports (`seed-uber-airports.js`)

Syncs official Uber airport data with our markets table. Sources from `platform-data/uber/Airports/uber-us-airports-with-market.txt`.

### Features

- **71 US airports** mapped to Uber markets
- **Multi-airport markets**: Chicago (ORD+MDW), Dallas (DFW+DAL), Houston (IAH+HOU), NYC (JFK+LGA)
- **Uber market names**: Uses official Uber naming (Queens, Seatac, Kenner, Morrisville, Hebron)
- **City aliases**: Adds suburb names for each market

### Usage

```bash
# Sync Uber airport data
node server/scripts/seed-uber-airports.js

# Output:
# - Updates existing markets with airport codes
# - Adds new markets from Uber data
# - Merges city aliases
```

### Data Source

Data collected from Uber public airport pages: `https://www.uber.com/global/en/r/airports/{airport_code}/`

## Connections

- **Related:** `../config/holiday-override.json`
- **Related:** `../../shared/schema.js` (discovered_events, markets tables)
- **Related:** `../api/briefing/briefing.js` (event discovery endpoints)
- **Related:** `../api/location/location.js` (market timezone lookup)
- **Used for:** Manual system configuration, database operations, testing, event discovery
