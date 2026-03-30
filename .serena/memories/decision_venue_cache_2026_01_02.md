# Decision: Venue Cache System

**Date:** January 2, 2026
**Status:** Implemented
**Tags:** architecture, database, events, venues, deduplication

## Context

Events discovered by multiple LLMs (GPT-5.2, Gemini, Claude, Perplexity, SerpAPI) had:
- Inconsistent coordinates (same venue with different lat/lng)
- Duplicate events ("AT&T Stadium" vs "at&t stadium")
- Repeated geocoding on every discovery run
- No way to link events to SmartBlocks venues

## Decision

Created a `venue_cache` table for centralized venue management with:
1. **Normalized names** for fuzzy matching
2. **Full precision coordinates** (15+ decimals)
3. **Foreign key linking** from `discovered_events.venue_id`

## Key Components

### Database Schema (`shared/schema.js`)
- `venue_cache` table with normalized_name, full lat/lng, place_id, hours, venue_type
- `discovered_events.venue_id` FK to venue_cache

### Utility Module (`server/lib/venue/venue-cache.js`)
- `normalizeVenueName()` - "AT&T Stadium" → "att stadium"
- `lookupVenue()` / `lookupVenueFuzzy()` - Find by name/coords/place_id
- `findOrCreateVenue()` - Lookup-first pattern for event discovery
- `getEventsForVenue()` - For SmartBlocks "event tonight" flag

### Integration (`server/scripts/sync-events.mjs`)
- `processEventsWithVenueCache()` runs after geocoding, before storing
- Events stored with venue_id linking them to cached venues

## Benefits

| Aspect | Before | After |
|--------|--------|-------|
| Coordinates | 4-decimal (~11m) | 15+ decimal (sub-meter) |
| Matching | Hash-based exact | Normalized fuzzy |
| Geocoding | Every discovery run | Once per venue |
| Event→Venue | None | FK relationship |

## Future Use: SmartBlocks "Event Tonight" Flag

With venue_id linking events to venues, SmartBlocks can:
1. Look up venue in venue_cache by place_id or normalized name
2. Join to discovered_events via venue_id
3. Check for events active today
4. Display "🎫 Event: [Name]" badge

## Files Modified

- `shared/schema.js` - venue_cache table, venue_id FK
- `server/lib/venue/venue-cache.js` - NEW utility module
- `server/lib/venue/index.js` - barrel exports
- `server/scripts/sync-events.mjs` - processEventsWithVenueCache integration
- `docs/architecture/database-schema.md` - documentation
- `LESSONS_LEARNED.md` - section 26
