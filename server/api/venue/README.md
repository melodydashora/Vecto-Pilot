> **Last Verified:** 2026-01-06

# Venue API (`server/api/venue/`)

## Purpose

Venue intelligence, events, and closed venue reasoning.

## Files

| File | Route | Purpose |
|------|-------|---------|
| `venue-intelligence.js` | `/api/venues/*` | Venue recommendations |
| `venue-events.js` | `/api/venue/events/*` | Venue-specific events |
| `closed-venue-reasoning.js` | `/api/closed-venue-reasoning` | GPT-5 reasoning |

## Endpoints

### Venue Intelligence
```
GET  /api/venues/:placeId         - Get venue details
POST /api/venues/enrich           - Enrich venue with hours, events
GET  /api/venues/nearby           - Get nearby venues
```

### Venue Events
```
GET  /api/venue/events/:placeId   - Events at specific venue
```

### Closed Venue Reasoning
```
POST /api/closed-venue-reasoning  - Why venue is closed + alternatives
```

## Data Enrichment

Venues are enriched with:
- Business hours (Google Places API)
- Events (Gemini + Google Search)
- Drive time (Google Routes API)
- Address verification

## Connections

- **Uses:** `../../lib/venue/venue-enrichment.js`
- **Uses:** `../../lib/venue/venue-intelligence.js`
- **Uses:** Google Places API, Routes API
- **Called by:** Strategy pipeline, venue cards

## Import Paths

```javascript
// Database
import { db } from '../../db/drizzle.js';
import { rankings, ranking_candidates } from '../../../shared/schema.js';

// Venue lib
import { searchNearbyVenues, getVenueDetails } from '../../lib/venue/venue-intelligence.js';
import { enrichVenue, getBatchDriveTimes } from '../../lib/venue/venue-enrichment.js';

// AI
import { callModel } from '../../lib/ai/adapters/index.js';
```
