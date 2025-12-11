# Briefing Module (`server/lib/briefing/`)

## Purpose

Real-time briefing service for events, traffic, weather, and news. Provides the data shown in the Briefing tab.

## Files

| File | Purpose | Key Export |
|------|---------|------------|
| `briefing-service.js` | Main briefing orchestrator | `getOrGenerateBriefing(snapshotId)` |
| `event-schedule-validator.js` | Event verification (DISABLED) | `validateEventSchedules(events)` |

## Usage

```javascript
import { getOrGenerateBriefing, generateAndStoreBriefing } from './briefing-service.js';

// Get or generate full briefing (with caching)
const briefing = await getOrGenerateBriefing(snapshotId, snapshot);

// Generate fresh briefing (pass full snapshot row)
const result = await generateAndStoreBriefing({ snapshotId, snapshot });
```

## CRITICAL: Pass Full Snapshot Row

**Always pass the full snapshot object** to avoid redundant DB fetches:

```javascript
// CORRECT - Pass full snapshot row
await generateAndStoreBriefing({ snapshotId, snapshot: fullSnapshotRow });

// WRONG - Forces DB fetch
await generateAndStoreBriefing({ snapshotId });
```

The snapshot MUST have `formatted_address` - LLMs cannot reverse geocode.

## Deduplication Strategy

Uses database state (NULL fields) as triggers to prevent duplicate API calls:

| State | traffic | events | news | closures | Meaning |
|-------|---------|--------|------|----------|---------|
| **Placeholder** | NULL | NULL | NULL | NULL | Generation in progress |
| **Partial** | ✓ | ✓ | NULL | NULL | Traffic/events done, daily data pending |
| **Ready** | ✓ | ✓ | ✓ | ✓ | ALL fields populated, data ready |

**CRITICAL**: ALL four fields must be populated for deduplication to apply. Partial briefings (with any NULL field) will be regenerated.

### Flow

1. **generateAndStoreBriefing** checks if briefing with data < 60s exists → returns cached
2. If no row exists → INSERT placeholder with NULL fields
3. If row exists but stale → UPDATE to clear traffic/events = NULL
4. Fetch fresh traffic + events from Gemini
5. UPDATE with populated data

### getOrGenerateBriefing Behavior

- If ANY of the 4 fields are NULL and < 2 min old → returns null (generation in progress)
- If ANY of the 4 fields are NULL and > 2 min old → regenerates (stale/incomplete)
- If ALL 4 fields populated → returns data

Fields checked: `traffic_conditions`, `events`, `news`, `school_closures`

## Briefing Structure

```javascript
{
  events: [
    { name: "Concert at Arena", time: "7:00 PM", venue: "..." }
  ],
  traffic: {
    summary: "Light traffic on I-35",
    congestionLevel: "low",
    incidents: []
  },
  weather: {
    tempF: 72,
    conditions: "Clear",
    forecast: [...]
  },
  news: [
    { headline: "Airport expansion...", source: "..." }
  ],
  school_closures: [...]
}
```

## Cache Strategy

| Data Type | Cache Duration | Refresh Trigger |
|-----------|----------------|-----------------|
| Traffic | **No cache** | Fresh on EVERY call (conditions change rapidly) |
| Events | **No cache** | Fresh on EVERY call (AI coach may need to verify) |
| News | 24 hours by city | Same city within calendar day |
| School Closures | 24 hours by city | Same city within calendar day |
| Weather | From snapshot | Pre-captured at location resolution |

### Why Traffic & Events Are Not Cached

- **Traffic**: Conditions change rapidly (accidents, congestion). Stale traffic data is dangerous.
- **Events**: AI coach may need to double-check events. New events can be discovered throughout the day.

### Daily Data (News, School Closures)

Only news and school_closures are cached (24h by city) because they don't change frequently.

### City-Level Cache Lookup

News and school_closures are cached by city+state (same for all users in area):

```sql
-- Cache lookup excludes current snapshot and incomplete rows
SELECT * FROM briefings
WHERE city = 'Dallas' AND state = 'TX'
  AND snapshot_id != 'current-snapshot-id'  -- Exclude self
  AND news IS NOT NULL                       -- Exclude placeholders
  AND school_closures IS NOT NULL            -- Require complete data
ORDER BY updated_at DESC
LIMIT 1
```

**Note**: Cache query requires BOTH `news` AND `school_closures` to be non-NULL to prevent returning incomplete cached data.

## Event Validation (DISABLED)

Event validation with Claude Opus is **disabled** to prevent events being incorrectly filtered out. Claude is now used only as a **fallback** when Gemini fails.

```javascript
// Event validation disabled - Gemini handles event discovery directly
// Claude Opus is used as a FALLBACK model when Gemini API fails
```

If re-enabled, events are kept even when validation fails (marked as "unvalidated").

## Connections

- **Imports from:** `../ai/adapters/` (callModel), `../../db/`
- **Exported to:** `../../api/briefing/briefing.js`, `../../api/strategy/blocks-fast.js`

## Traffic Fallback

When Gemini returns empty traffic data, uses fallback:

```javascript
{
  summary: "Traffic conditions unavailable - using default",
  congestionLevel: "medium",
  isFallback: true,
  incidents: [],
  majorRoutes: []
}
```

## Import Paths

```javascript
// From server/api/*/
import { getOrGenerateBriefing } from '../../lib/briefing/briefing-service.js';

// From server/lib/*/
import { getOrGenerateBriefing } from '../briefing/briefing-service.js';
```
