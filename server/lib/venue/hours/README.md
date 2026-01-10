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
| `parsers/google-weekday-text.js` | Google Places format parser |
| `parsers/hours-text-map.js` | { day: "hours" } format parser |

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

## Migration from Legacy Code

| Old Function | Location | New Pattern |
|--------------|----------|-------------|
| `calculateIsOpen(weekdayTexts, tz)` | venue-enrichment.js | `parseGoogleWeekdayText()` + `getOpenStatus()` |
| `calculateIsOpen(hoursMap, tz)` | venue-utils.js | `parseHoursTextMap()` + `getOpenStatus()` |
| `isOpenNow(hoursFullWeek, tz)` | venue-hours.js | Will be updated to use `getOpenStatus()` |

## Test Coverage Required

- [ ] AM/PM time parsing (12:00 PM = noon, 12:00 AM = midnight)
- [ ] Overnight hours (4:00 PM – 2:00 AM)
- [ ] Split shifts (11:00 AM – 2:00 PM, 5:00 PM – 11:00 PM)
- [ ] "Closed" handling
- [ ] "Open 24 hours" handling
- [ ] Invalid timezone → null result
- [ ] Missing timezone → null result
- [ ] Parse failures → explicit error
