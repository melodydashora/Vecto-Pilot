# Session: Map Features & SmartBlocks Improvements

**Date:** 2025-12-28
**Focus:** Map bar markers, multi-day events, SmartBlocks filtering

## Summary

Enhanced the map page with bar markers showing open/closing status, added multi-day event support, and improved SmartBlocks filtering to ensure high-value venues always display.

## Changes Made

### 1. Bar Markers on Map

**Files Modified:**
- `client/src/pages/co-pilot/MapPage.tsx` - Added bar data fetching
- `client/src/components/MapTab.tsx` - Added bar markers with color coding

**Features:**
- 🟢 **Green markers** = Open bars
- 🔴 **Red markers** = Closing soon (last call opportunity)
- Only shows **$$+ venues** (`expense_rank >= 2`)
- **No closed bars** displayed (user requested removal)
- Separate data source from strategy blocks (`/api/venues/nearby`)

**Implementation:**
```typescript
// MapPage.tsx - Fetches bars from nearby endpoint
const { data: barsData } = useQuery({
  queryKey: ['map-bars', coords?.latitude, coords?.longitude, timezone],
  queryFn: async () => {
    const params = new URLSearchParams({
      lat: coords.latitude.toString(),
      lng: coords.longitude.toString(),
      radius: '15',  // 15 mile radius
      timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
    });
    return fetch(`/api/venues/nearby?${params}`, { headers: getAuthHeader() });
  }
});

// Filter: $$+ AND open only
const openPremiumBars = uniqueBars.filter(bar =>
  bar.expense_rank >= 2 && bar.is_open
);
```

### 2. Multi-Day Event Support

**Files Modified:**
- `client/src/utils/co-pilot-helpers.ts` - Updated `isEventToday()` function
- `client/src/components/EventsComponent.tsx` - Added `event_end_date` to interface
- `client/src/pages/co-pilot/MapPage.tsx` - Passes `event_end_date` to map

**Features:**
- Events spanning multiple days (e.g., "Dec 1 - Jan 4") now show on map if today falls within range
- Date range check: `event_date <= today <= event_end_date`

**Implementation:**
```typescript
// co-pilot-helpers.ts
export function isEventToday(event: FilterableEvent, timezone?: string): boolean {
  const todayStr = format(now, 'yyyy-MM-dd');

  // Check if today is within date range (for multi-day events)
  if (event.event_end_date) {
    const startDate = event.event_date;
    const endDate = event.event_end_date;
    if (startDate && endDate && todayStr >= startDate && todayStr <= endDate) {
      return true;
    }
  }

  // Single-day event check
  return event.event_date === todayStr;
}
```

### 3. SmartBlocks Filtering Improvements

**Files Modified:**
- `client/src/utils/co-pilot-helpers.ts` - Updated `filterHighValueSpacedBlocks()`

**Features:**
- Shows up to 3 high-value venues (Grade A preferred, Grade B fallback)
- **Two-pass algorithm:**
  1. First pass: Add well-spaced venues (prefer 1+ mile apart)
  2. Second pass: Fill remaining slots (ignore spacing if needed)
- Ensures at least some venues show even if all are clustered

**Implementation:**
```typescript
export function filterHighValueSpacedBlocks<T extends FilterableBlock>(
  blocks: T[],
  minDistanceMiles: number = 1.0,
  maxVenues: number = 3
): T[] {
  // Get Grade A, then Grade B as fallback
  const gradeABlocks = blocks.filter(b => isGradeABlock(b) && hasValidCoords(b));
  const gradeBBlocks = blocks.filter(b => {
    const grade = b.value_grade?.toUpperCase();
    return grade === 'B' && hasValidCoords(b);
  });
  const allHighValue = [...gradeABlocks, ...gradeBBlocks];

  // First pass - add well-spaced venues
  const result: T[] = [];
  for (const block of allHighValue) {
    if (result.length >= maxVenues) break;
    if (isWellSpaced(block, result)) {
      result.push(block);
    }
  }

  // Second pass - fill remaining slots (ignore spacing)
  if (result.length < maxVenues) {
    for (const block of allHighValue) {
      if (result.length >= maxVenues) break;
      if (!alreadyAdded) {
        result.push(block);
      }
    }
  }
  return result;
}
```

## Bug Fixes

### 1. Package Lockfile Corruption
- **Issue:** Build warnings about "invalid or damaged lockfile"
- **Fix:** Regenerated `package-lock.json` with `rm package-lock.json && npm install`
- **Commit:** `afe61ce fix: Regenerate package-lock.json to fix corrupted lockfile`

### 2. Database Migration Error (Pending User Action)
- **Issue:** `idx_events_dedupe` index has mismatched operator classes
- **Error:** `operator class "timestamptz_ops" does not accept data type text`
- **Root Cause:** Index defined in Dev database (not in codebase) has wrong operator class assignments
- **Fix:** User needs to run in Supabase SQL Editor:
```sql
DROP INDEX IF EXISTS idx_events_dedupe;
CREATE UNIQUE INDEX idx_events_dedupe ON events_facts USING btree (
  COALESCE(venue_place_id, ''::text),
  lower(event_title),
  start_time,
  end_time
);
```

## User Decisions

1. **Bar markers:** Show only open bars (green) and closing soon (red) - NO closed bars
2. **Expense filter:** Only $$+ venues (`expense_rank >= 2`)
3. **SmartBlocks:** Show Grade A and B, prefer spacing but don't require it
4. **Database:** User accepts Dev schema overriding Prod (still in Beta)

## Files Changed This Session

| File | Changes |
|------|---------|
| `client/src/pages/co-pilot/MapPage.tsx` | Added bar data fetching, bar filtering |
| `client/src/components/MapTab.tsx` | Bar marker rendering, legend update |
| `client/src/components/EventsComponent.tsx` | Added `event_end_date` interface |
| `client/src/utils/co-pilot-helpers.ts` | Multi-day events, two-pass SmartBlocks |
| `client/src/components/README.md` | Updated MapTab documentation |
| `package-lock.json` | Regenerated to fix corruption |

## Next Session

- Verify bar markers work in production after deploy
- Test multi-day events with holiday lights (Dec 1 - Jan 4)
- Monitor SmartBlocks showing properly with Grade A/B fallback
