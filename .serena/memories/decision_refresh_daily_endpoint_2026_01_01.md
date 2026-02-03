# Decision: Refresh Daily Endpoint

**Date:** January 1, 2026
**Status:** Implemented
**Tags:** api, briefing, events, news

## Context

The Briefing tab had separate mechanisms for:
- Event discovery (`POST /api/briefing/discover-events/:snapshotId`)
- News refresh (no manual trigger existed)

Users wanted a single "Refresh Daily Data" button to update both.

## Decision

Created `POST /api/briefing/refresh-daily/:snapshotId` that:
1. Refreshes events AND news in parallel
2. Uses user's local date from snapshot timezone
3. Supports `?daily=true` for comprehensive 6-model search

## Implementation

### Endpoint (`server/api/briefing/briefing.js`)
```javascript
router.post('/refresh-daily/:snapshotId', async (req, res) => {
  const userTimezone = snapshot.timezone || 'America/Chicago';
  const userLocalDate = snapshot.local_iso
    ? new Date(snapshot.local_iso).toISOString().split('T')[0]
    : new Date().toLocaleDateString('en-CA', { timeZone: userTimezone });

  const [eventsResult, newsResult] = await Promise.all([
    syncEventsForLocation(location, isDaily, { userLocalDate, todayOnly: true }),
    fetchRideshareNews({ snapshot })
  ]);
  
  // Update briefings table with news, return combined result
});
```

### LLM-Level Filtering
For Briefing tab, events are filtered at the LLM prompt level:
- `todayOnly: true` option passed to all search functions
- Prompt requires ONLY events on user's local date
- Prompt requires BOTH event_time AND event_end_time (no TBD)

### UI Changes (`client/src/components/BriefingTab.tsx`)
- Renamed "Discover Events" → "Refresh Daily Data"
- Single button triggers combined events + news refresh
- Shows results for both in success message

## Key Insight: User's Local Date

Server time ≠ user's time. A user at 11:45 PM on Jan 1st (America/Chicago) 
would have server time of Jan 2nd (UTC). We extract user's local date from:
1. `snapshot.local_iso` if available
2. Otherwise compute from `snapshot.timezone`

## Files Modified

- `server/api/briefing/briefing.js` - New endpoint
- `server/scripts/sync-events.mjs` - `todayOnly` mode in buildEventPrompt
- `client/src/components/BriefingTab.tsx` - UI updates
- `server/api/briefing/README.md` - Documentation
