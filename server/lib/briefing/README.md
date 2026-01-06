> **Last Verified:** 2026-01-06

# Briefing Module (`server/lib/briefing/`)

## Purpose

Real-time briefing service for events, traffic, weather, and news. Provides the data shown in the Briefing tab. Events are now sourced from the `discovered_events` table via multi-model AI discovery.

## Files

| File | Purpose | Key Export |
|------|---------|------------|
| `briefing-service.js` | Main briefing orchestrator | `getOrGenerateBriefing(snapshotId)` |
| `event-schedule-validator.js` | Event verification (DISABLED) | `validateEventSchedules(events)` |
| `index.js` | Module barrel exports | All briefing exports |
| `dump-last-briefing.js` | Debug utility: dump last briefing | CLI script |
| `dump-latest.js` | Debug utility: dump latest briefing | CLI script |
| `dump-traffic-format.js` | Debug utility: traffic format check | CLI script |
| `test-api.js` | API testing utility | Test helpers |

## Event Discovery Integration

Events are now discovered using SerpAPI + GPT-5.2 and stored in the `discovered_events` table:

```javascript
import { syncEventsForLocation } from '../../scripts/sync-events.mjs';

// Called in fetchEventsForBriefing()
const result = await syncEventsForLocation(
  { city, state, lat, lng },
  false  // Normal mode: SerpAPI + GPT-5.2 only
);
// Result: { events: [...], inserted: 12, skipped: 33 }

// Then read back from discovered_events table
const events = await db.select()
  .from(discovered_events)
  .where(and(
    eq(discovered_events.city, city),
    eq(discovered_events.state, state),
    gte(discovered_events.event_date, today),
    lte(discovered_events.event_date, weekFromNow)
  ));
```

See [Event Discovery Architecture](../../../docs/architecture/event-discovery.md) for full documentation.

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

## Cache Strategy (Updated 2026-01-05)

| Data Type | Cache Duration | Refresh Trigger |
|-----------|----------------|-----------------|
| Weather | **No cache** | Fresh on EVERY call (forecast changes) |
| Traffic | **No cache** | Fresh on EVERY call (conditions change rapidly) |
| Events | **From DB table** | Read from `discovered_events` (daily sync) |
| Airport | **No cache** | Fresh on EVERY call (delays change rapidly) |
| News | **No cache** | Fresh on EVERY call (dual-model fetch is fast) |
| School Closures | 24 hours by city | Same city within calendar day |

### Why Most Data Is Not Cached

- **Weather**: Forecasts change throughout the day. Briefing needs fresh hourly predictions.
- **Traffic**: Conditions change rapidly (accidents, congestion). Stale traffic data is dangerous.
- **Events**: Served from `discovered_events` table (instant DB read, no API call).
- **Airport**: Delay status changes rapidly. Stale data could mislead drivers.
- **News**: Dual-model fetch (Gemini + GPT-5.2 in parallel) is fast enough (~2-3s) for per-request refresh. News relevance decays quickly.

**Note:** Current weather conditions are captured in the snapshot during location resolution. The briefing fetches the 4-hour FORECAST separately, which is different data.

### Daily Data (School Closures Only)

Only school_closures are cached (24h by city) because school schedules rarely change intraday.

### City-Level Cache Lookup

School closures are cached by city+state (same for all users in area):

```sql
-- Cache lookup excludes current snapshot and incomplete rows
SELECT * FROM briefings
WHERE city = 'Dallas' AND state = 'TX'
  AND snapshot_id != 'current-snapshot-id'  -- Exclude self
  AND school_closures IS NOT NULL            -- Require closures data
ORDER BY updated_at DESC
LIMIT 1
```

**Note**: Cache query only requires `school_closures` to be non-NULL. News is always fetched fresh.

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
