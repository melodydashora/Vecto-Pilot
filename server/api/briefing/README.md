# Briefing API (`server/api/briefing/`)

## Purpose

Real-time intelligence: events, traffic, news, weather summaries.

## Files

| File | Route | Purpose |
|------|-------|---------|
| `briefing.js` | `/api/briefing/*` | Briefing data endpoints |
| `events.js` | `/events` | SSE stream for real-time updates |

## Endpoints

```
GET  /api/briefing/current            - Latest briefing for user
POST /api/briefing/generate           - Generate new briefing
GET  /api/briefing/events/:snapshotId - Events for snapshot
GET  /api/briefing/traffic/:snapshotId - Traffic for snapshot
GET  /api/briefing/news/:snapshotId   - News for snapshot
GET  /events                          - SSE stream
```

## Data Flow

1. Client requests `/api/briefing/current`
2. Server checks for cached briefing (4hr events cache, 24hr news)
3. If stale, calls Gemini 3.0 Pro + Google Search
4. Returns events, traffic, news, weather summary

## Connections

- **Uses:** `../../lib/briefing/briefing-service.js`
- **Called by:** Client BriefingTab, background refresh

## Import Paths

```javascript
// Database
import { db } from '../../db/drizzle.js';
import { briefings, snapshots } from '../../../shared/schema.js';

// Briefing lib
import { getOrGenerateBriefing } from '../../lib/briefing/briefing-service.js';
import { validateEventSchedules } from '../../lib/briefing/event-schedule-validator.js';

// Middleware
import { requireAuth } from '../../middleware/auth.js';
import { expensiveLimiter } from '../../middleware/rate-limit.js';
```
