# Venue Intelligence

`server/lib/venue/venue-intelligence.js`

Real-time venue intelligence using Google Places API for bar discovery. Provides upscale bars/lounges sorted by expense, filtered by operating hours, and enriched with AI analysis.

> **Architecture Note:** Uses a **Cache First** pattern (via `venue-cache.js`) and relies on `venue_catalog` (Schema).
> **AI Adapter:** Traffic analysis uses the unified `callModel` adapter.

## Dependencies

- **Database**: `drizzle-orm`, `venue_catalog` schema.
- **AI**: `callModel` from `../ai/adapters/index.js`.
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

**Logic:**
1.  **Canonical Parsing**: Uses `parseGoogleWeekdayText` and `getOpenStatus` from the `hours` module as the source of truth.
2.  **Discrepancy Logging**: Compares calculated status with Google's `openNow` flag. Discrepancies are logged but `openNow` is **never** used as the source of truth.
3.  **Timezone Dependency**: Requires valid timezone to resolve "today" correctly.

## AI Integration

### Traffic/Vibe Analysis
*(Internal usage via `callModel`)*

The module uses `callModel('VENUE_TRAFFIC')` to analyze venue metadata and determine current vibe or traffic levels. Direct dependencies on specific providers (e.g., Gemini) have been abstracted away.