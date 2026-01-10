# Venue Hours Module

**Created:** 2026-01-10 (D-014)

The canonical source of truth for venue open/closed status evaluation.

## Architecture

```
Input Formats          Parsers                    Evaluator
─────────────────     ─────────────────────     ──────────────────
Google weekday_text   parseGoogleWeekdayText()
        │                     │
        └──────────┬──────────┘
                   ▼
           NormalizedSchedule  ──────►  getOpenStatus(schedule, tz)
                   ▲                            │
        ┌──────────┴──────────┐                 ▼
        │                     │           OpenStatus
Hours text map       parseHoursTextMap()   { is_open, closes_at, ... }
{ mon: "4PM-2AM" }
```

## Quick Start

```javascript
import { parseGoogleWeekdayText, getOpenStatus } from './hours/index.js';

// Parse Google Places weekday_text
const parseResult = parseGoogleWeekdayText([
  "Monday: 4:00 PM – 2:00 AM",
  "Tuesday: 4:00 PM – 2:00 AM",
  "Wednesday: Closed"
]);

if (parseResult.ok) {
  const status = getOpenStatus(parseResult.schedule, "America/Chicago");
  console.log(status.is_open);        // true/false/null
  console.log(status.closes_at);      // "02:00"
  console.log(status.closing_soon);   // true if within 60 min
  console.log(status.reason);         // "Open until 2:00 AM"
}
```

## Files

| File | Purpose |
|------|---------|
| `index.js` | Barrel export for all module functions |
| `normalized-types.js` | Type definitions and helper functions |
| `evaluator.js` | Canonical `getOpenStatus()` function |
| `parsers/google-weekday-text.js` | Google Places `weekday_text` array parser |
| `parsers/hours-text-map.js` | `{ day: "hours" }` format parser |
| `parsers/structured-hours.js` | `hours_full_week` JSON format parser (for venue-hours.js) |

## NormalizedSchedule Format

```javascript
{
  sunday: { is_closed: true, is_24h: false, intervals: [] },
  monday: {
    is_closed: false,
    is_24h: false,
    intervals: [
      { open_minute: 960, close_minute: 120, closes_next_day: true }
    ]
  },
  // ... etc for all days
}
```

## Key Rules

1. **Timezone is REQUIRED** - No fallbacks. If timezone is missing, `is_open = null`.
2. **No guessing** - Parse failures return explicit errors, not defaults.
3. **No direct openNow** - Never trust Google's `openNow` directly. Always parse and evaluate.
4. **Overnight handling** - `closes_next_day: true` when closing time < opening time.

## Overnight Hours Fix (2026-01-10)

**CRITICAL BUG FIXED:** The previous logic incorrectly handled day rollover for overnight venues.

### The Bug

At Friday 12:47 AM, a venue with hours "Friday: 11:00 AM - 2:00 AM (Saturday)" was incorrectly marked as "OPEN" because:
- Old logic: `currentMinutes >= open_minute || currentMinutes < close_minute`
- Check: `47 >= 660` (FALSE) OR `47 < 120` (TRUE) → **OPEN** (wrong!)

The bug "teleported" 12:47 AM Friday into Friday's shift, but Friday's shift hasn't started yet at 12:47 AM!

### The Fix

The evaluator now explicitly checks **two separate windows**:

1. **YESTERDAY'S SPILLOVER**: Did Thursday's overnight shift (11 AM - 2 AM) extend into Friday morning?
2. **TODAY'S MAIN SHIFT**: Are we past Friday's opening time (11 AM)?

```javascript
// Check 1: Yesterday's spillover
if (yesterdayInterval.closes_next_day && currentMinutes < yesterdayInterval.close_minute) {
  // We're in yesterday's overnight spillover - OPEN
}

// Check 2: Today's main shift (only AFTER opening time)
if (currentMinutes >= todayInterval.open_minute) {
  // We're in today's main shift - OPEN
}
```

### Test Cases

| Scenario | Expected | Notes |
|----------|----------|-------|
| Fri 12:47 AM, Thu 11 AM - 2 AM | OPEN | In Thursday's spillover |
| Fri 12:47 AM, Fri 11 AM - 2 AM | CLOSED | Friday hasn't opened yet |
| Fri 11:30 PM, Fri 11 AM - 2 AM | OPEN | In Friday's main shift |
| Sat 1:00 AM, Fri 11 AM - 2 AM | OPEN | In Friday's spillover into Saturday |

## Migration from Legacy Code

| Old Function | Location | New Pattern | Status |
|--------------|----------|-------------|--------|
| `calculateIsOpen(weekdayTexts, tz)` | venue-enrichment.js | `parseGoogleWeekdayText()` + `getOpenStatus()` | ✅ Done |
| `calculateIsOpen(hoursMap, tz)` | venue-utils.js | `parseHoursTextMap()` + `getOpenStatus()` | ✅ Done |
| `isOpenNow(hoursFullWeek, tz)` | venue-hours.js | `parseStructuredHoursFullWeek()` + `getOpenStatus()` | ✅ Done |

## Test Coverage Required

- [ ] AM/PM time parsing (12:00 PM = noon, 12:00 AM = midnight)
- [ ] Overnight hours (4:00 PM – 2:00 AM)
- [ ] Split shifts (11:00 AM – 2:00 PM, 5:00 PM – 11:00 PM)
- [ ] "Closed" handling
- [ ] "Open 24 hours" handling
- [ ] Invalid timezone → null result
- [ ] Missing timezone → null result
- [ ] Parse failures → explicit error
