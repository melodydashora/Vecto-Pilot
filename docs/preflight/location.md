# Snapshot Time Context

`server/lib/location/getSnapshotTimeContext.js`

Canonical timezone and date utility for the ETL pipeline.

> **Invariant:** This is the **ONLY** place where "today's date" and timezone should be resolved.  
> **No Fallbacks:** Missing timezone is a bug that should surface immediately.

## Error Handling

The module defines custom errors to ensure data integrity issues are not silently ignored.

### `MissingTimezoneError`
Thrown when a snapshot is missing required timezone data.

### `MissingLocationError`
Thrown when a snapshot is missing required location data (`city` or `state`).

## API

### `getSnapshotTimeContext(snapshot)`

Get time context from snapshot with strict validation. This is the primary function for resolving "today's date" for pipeline operations.

**Parameters**
- `snapshot` (Object): Snapshot row from database.

**Returns**
- `Object`: Time context object.
  - `timeZone` (String): Validated timezone (from `snapshot.timezone`).
  - `localISODate` (String): Current date in snapshot's timezone (YYYY-MM-DD).
  - `dayOfWeek` (Number): 0=Sunday, 6=Saturday.
  - `hour` (Number): Current hour.
  - `dayPart` (String): Time of day key (e.g., 'night').
  - `isWeekend` (Boolean): True if Saturday or Sunday.
  - `city`, `state`, `country` (String): Location details.
  - `lat`, `lng` (Number): Coordinates.
  - `isHoliday`, `holiday` (Boolean/Object): Holiday status.
  - `snapshotId` (String): Reference ID.

**Throws**
- `MissingTimezoneError`: If `snapshot.timezone` is missing.
- `MissingLocationError`: If `snapshot.city` or `snapshot.state` is missing.

### `getEventDateRange(snapshot, daysAhead = 7)`

Get date range for event queries (today to N days out). Uses `getSnapshotTimeContext` internally.

**Parameters**
- `snapshot` (Object): Snapshot row.
- `daysAhead` (Number): Number of days to look ahead. Default `7`.

**Returns**
- `Object`: `{ startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' }`

### `formatLocalTime(snapshot)`

Format a human-readable local time string from snapshot.

**Parameters**
- `snapshot` (Object): Snapshot row.

**Returns**
- `String`: Formatted local time (e.g., "Friday, January 10, 2026, 3:30 PM").

**Implementation Note:**
This function handles `snapshot.local_iso` as "fake UTC" (wall-clock time stored as a timestamp without timezone offset). It uses `timeZone: 'UTC'` during formatting to prevent double-conversion errors.