# Event Discovery System

The Event Discovery System uses multiple AI models to find local events that generate rideshare demand. Events are stored in the `discovered_events` table with deduplication to prevent duplicates across sources.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     EVENT DISCOVERY FLOW                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  User Location (Snapshot)                                           │
│         │                                                           │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              NORMAL MODE (Snapshot Run)                      │   │
│  │              SerpAPI + GPT-5.2 (fast)                       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                           │
│         │  OR                                                       │
│         │                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              DAILY MODE (Discover Button)                    │   │
│  │   SerpAPI + GPT-5.2 + Gemini 3 Pro + Gemini 2.5 Pro         │   │
│  │   + Claude Sonnet + Perplexity Reasoning (comprehensive)     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                           │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              DEDUPLICATION                                   │   │
│  │   MD5(normalize(title + venue + date + city))               │   │
│  │   → event_hash (unique constraint)                          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                           │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              discovered_events TABLE                         │   │
│  │   Stores all events with source model tracking              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                           │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              UI DISPLAY                                      │   │
│  │   BriefingTab → EventsComponent (with navigation)           │   │
│  │   MapTab → Purple event markers with popups                 │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Two Discovery Modes

### Normal Mode (Automatic)
Triggered automatically during snapshot creation. Uses only fast, reliable sources:
- **SerpAPI** - Google Events engine (fastest: ~81 events/sec)
- **GPT-5.2** - Web search with Responses API

```javascript
// Called during briefing generation
const result = await syncEventsForLocation(
  { city, state, lat, lng },
  false  // isDaily=false → Normal mode
);
```

### Daily Mode (On-Demand)
Triggered by user clicking "Discover Events" button. Uses all 6 working models:
- **SerpAPI** - Google Events engine
- **GPT-5.2** - OpenAI Responses API with web_search tool
- **Gemini 3 Pro** - Google Search grounding
- **Gemini 2.5 Pro** - Google Search grounding
- **Claude Sonnet** - Anthropic web_search_20250305 tool
- **Perplexity Reasoning Pro** - Deep web search

```javascript
// Called from Discover Events button
POST /api/briefing/discover-events/:snapshotId?daily=true
```

## Database Schema

### discovered_events Table

```sql
CREATE TABLE discovered_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Event identity
  title TEXT NOT NULL,
  venue_name TEXT,
  address TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  venue_id UUID REFERENCES venue_catalog(venue_id),  -- FK for coordinates

  -- Event timing (2026-01-10: Symmetric naming convention)
  event_start_date TEXT NOT NULL,  -- YYYY-MM-DD format (renamed from event_date)
  event_start_time TEXT,           -- e.g., "7:00 PM" (renamed from event_time)
  event_end_date TEXT,             -- For multi-day events
  event_end_time TEXT,             -- e.g., "10:00 PM"

  -- Categorization
  category TEXT NOT NULL DEFAULT 'other',
  expected_attendance TEXT DEFAULT 'medium',  -- high, medium, low

  -- Note: lat, lng, zip, source_model, source_url, raw_source_data removed 2026-01-10
  -- Geocoding now in venue_catalog, which is source of truth for coordinates

  -- Deduplication
  event_hash TEXT NOT NULL UNIQUE,  -- MD5 hash for dedup

  -- Timestamps
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Flags
  is_verified BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE
);
```

### Categories
- `concert` - Live music, concerts
- `sports` - Professional/college sports, games
- `theater` - Theater, comedy, broadway
- `conference` - Conventions, expos, trade shows
- `festival` - Festivals, fairs, parades
- `nightlife` - Clubs, DJ nights, bar events
- `civic` - Religious, political gatherings
- `academic` - Graduations, college events
- `airport` - Flight-related events
- `other` - Uncategorized events

## API Endpoints

### POST /api/briefing/discover-events/:snapshotId
Trigger on-demand event discovery for a snapshot's location.

**Query Parameters:**
- `daily=true` (default) - Use all 6 models
- `daily=false` - Use only SerpAPI + GPT-5.2

**Response:**
```json
{
  "ok": true,
  "snapshot_id": "uuid",
  "mode": "daily",
  "total_discovered": 45,
  "inserted": 12,
  "skipped": 33,
  "events": [...]
}
```

### GET /api/briefing/events/:snapshotId
Fetch events from discovered_events table for the snapshot's city/state.

**Response:**
```json
{
  "success": true,
  "events": [
    {
      "title": "Taylor Swift - Eras Tour",
      "venue": "AT&T Stadium",
      "address": "1 AT&T Way, Arlington, TX",
      "event_start_date": "2026-01-15",
      "event_start_time": "7:00 PM",
      "event_end_time": "11:00 PM",
      "impact": "high",
      "subtype": "concert"
    }
  ],
  "timestamp": "2024-12-14T..."
}
```

### GET /api/briefing/discovered-events/:snapshotId
Direct read from discovered_events table (raw data).

## UI Components

### EventsComponent
Displays events grouped by category with:
- Event title and venue
- Start/end times
- Impact badge (high/medium/low)
- **Navigation button** - Opens Google Maps directions

### MapTab Event Markers
Purple markers on the map for events with coordinates:
- Click popup shows title, venue, times
- Impact badge with color coding
- "Navigate to Event" button in popup
- Events included in map auto-fit bounds

### BriefingTab Discover Button
"Discover Events" button triggers daily mode discovery:
- Shows loading state during discovery
- Displays results (X found, Y new)
- Uses emerald/teal gradient styling

## Deduplication Logic

Events are deduplicated using an MD5 hash of normalized fields:

```javascript
function generateEventHash(event) {
  const normalize = (str) => (str || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')  // Remove punctuation
    .replace(/\s+/g, ' ')      // Collapse whitespace
    .trim();

  const key = [
    normalize(event.title),
    normalize(event.venue_name || ''),
    event.event_date || '',
    normalize(event.city)
  ].join('|');

  return crypto.createHash('md5').update(key).digest('hex');
}
```

This prevents duplicate events from different sources while allowing:
- Same event at different venues
- Same event on different dates
- Different events at the same venue

## File Reference

| File | Purpose |
|------|---------|
| `server/scripts/sync-events.mjs` | Event discovery sync module with all 6 model implementations |
| `server/lib/briefing/briefing-service.js` | `fetchEventsForBriefing()` uses SerpAPI + GPT-5.2 |
| `server/api/briefing/briefing.js` | API endpoints for events |
| `shared/schema.js` | `discovered_events` table schema |
| `client/src/components/EventsComponent.tsx` | Event display with navigation |
| `client/src/components/MapTab.tsx` | Map with event markers |
| `client/src/components/BriefingTab.tsx` | Discover Events button |

## Environment Variables

```bash
# Required for event discovery
SERP_API_KEY=...           # SerpAPI (or SERPAPI_API_KEY)
OPENAI_API_KEY=...         # GPT-5.2
GEMINI_API_KEY=...         # Gemini 3 Pro & 2.5 Pro
ANTHROPIC_API_KEY=...      # Claude Sonnet
PERPLEXITY_API_KEY=...     # Perplexity Reasoning Pro
```

## Performance Notes

Model performance from testing (events/second):
1. **SerpAPI**: 81.30 events/sec (fastest)
2. **GPT-5.2**: 0.85 events/sec
3. **Gemini 3 Pro**: 0.31 events/sec
4. **Claude**: 0.18 events/sec
5. **Perplexity Reasoning**: 0.12 events/sec

Normal mode (SerpAPI + GPT-5.2) completes in ~2-5 seconds.
Daily mode (all 6 models in parallel) completes in ~15-30 seconds.
