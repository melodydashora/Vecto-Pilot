# Venue Intelligence

`server/lib/venue/venue-intelligence.js`

Real-time venue intelligence using Google Places API for bar discovery. Provides upscale bars/lounges sorted by expense, filtered by operating hours, and enriched with AI analysis.

> **Architecture Note:** Uses a **Cache First** pattern (via `venue-cache.js`) and relies on `venue_catalog` (Schema).
> **AI Adapter:** Traffic analysis uses the unified `callModel` adapter.

## Dependencies

- **Database**: `drizzle-orm`, `venue_catalog` schema.
- **AI**: `callModel` from `../ai/adapters/index.js`.
- **Cache**: `venue-cache.js` (Cache First pattern).
- **Utils**: `venue-utils.js`, `district-detection.js`.
- **Hours**: `hours/index.js` (Canonical hours parsing).

## Core Functions

### `getPriceDisplay(priceLevel)`

Converts Google Places API price levels to application display format.

**Parameters**
- `priceLevel` (String): Google price constant (e.g., `PRICE_LEVEL_VERY_EXPENSIVE`).

**Returns**
- `Object`: `{ level: String, rank: Number }`
  - Example: `{ level: '$$$$', rank: 4 }`
  - Default: `{ level: '$$', rank: 2 }`

### `calculateOpenStatus(place, timezone)`

Calculates the current operating status of a venue based on its hours and timezone.

**Parameters**
- `place` (Object): Venue object from Google Places (must contain `regularOpeningHours` or `currentOpeningHours`).
- `timezone` (String): IANA timezone string for the venue.

**Returns**
- `Object`: Status object containing:
  - `is_open` (Boolean): True if currently open.
  - `hours_today` (String): Human-readable hours for the current day.
  - `closing_soon` (Boolean): Indicator if closing within threshold.
  - `minutes_until_close` (Number): Minutes remaining until close.
  - `opens_in_minutes` (Number): Minutes until opening (if closed).
  - `weekday_descriptions` (Array): List of formatted weekly hours strings.

**Logic:**
1.  **Canonical Parsing**: Uses `parseGoogleWeekdayText` and `getOpenStatus` from the `hours` module as the source of truth.
2.  **Discrepancy Logging**: Compares calculated status with Google's `openNow` flag. Discrepancies are logged but `openNow` is **never** used as the source of truth.
3.  **Timezone Dependency**: Requires valid timezone to resolve "today" correctly.

## AI Integration

### Traffic/Vibe Analysis
*(Internal usage via `callModel`)*

The module uses `callModel('VENUE_TRAFFIC')` to analyze venue metadata and determine current vibe or traffic levels. Direct dependencies on specific providers (e.g., Gemini) have been abstracted away.

---

# Holiday Detector

`server/lib/location/holiday-detector.js`

Fast holiday detection using the `BRIEFING_HOLIDAY` role with Google Search. Supports manual holiday overrides and uses an L1 cache to reduce API costs.

> **Architecture Note:** Uses an in-memory L1 cache with a 24-hour TTL to reduce redundant API calls.
> **AI Adapter:** Holiday detection uses the unified `callModel` adapter (hedged router + fallback).

## Dependencies

- **AI**: `callModel` from `../ai/adapters/index.js`.
- **Config**: `server/config/holiday-override.json` (Holiday overrides).

## Core Functions

### `getHolidayCacheKey(date, city, country, timezone)`

Generates a cache key for holiday detection results.

**Parameters**
- `date` (Date): The date to check.
- `city` (String): City name.
- `country` (String): Country code.
- `timezone` (String): IANA timezone (e.g., `'America/Chicago'`).

**Returns**
- `String`: Formatted cache key (e.g., `YYYY-MM-DD|city|country`).

**Logic:**
1. **Timezone-Aware**: Uses timezone-aware local date formatting to prevent UTC date mismatch issues (e.g., late night local time mapping to the next day in UTC).

### `getHolidayOverride(date)`

Checks if there is an active holiday override for the current date.

**Parameters**
- `date` (Date): The date to check.

**Returns**
- `Object | null`: Override object containing:
  - `holiday` (String): Name of the holiday.
  - `is_holiday` (Boolean): Always true if active.
  - `superseded_by_actual` (Boolean): True if actual holidays should override this manual entry.

**Logic:**
1. Reads from `holiday-override.json`.
2. Filters active overrides matching the given date.
3. Sorts by `priority` (highest first) and returns the top match.

## Cache Management

### L1 Cache System
- **`getFromHolidayCache(key)`**: Retrieves unexpired results from the in-memory `holidayCache`.
- **`setHolidayCache(key, result)`**: Stores results with a 24-hour TTL.
- **`cleanupHolidayCache()`**: Runs periodically (every hour) to garbage collect expired cache entries and prevent memory leaks.

## AI Integration

### Holiday Detection
*(Internal usage via `callModel`)*

The module uses `callModel` with the `BRIEFING_HOLIDAY` role to detect holidays via Google Search. Direct dependencies on specific providers (e.g., Gemini) have been abstracted away.