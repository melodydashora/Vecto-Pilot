> **Last Verified:** 2026-01-10

# Validation (`server/validation/`)

## Purpose

Zod validation schemas for API requests and responses. Provides type-safe validation with detailed error messages, and transformers for consistent data casing between layers.

## Files

| File | Purpose | Key Exports |
|------|---------|-------------|
| `schemas.js` | Zod schemas for API requests | `snapshotMinimalSchema`, `locationResolveSchema`, `strategyRequestSchema`, etc. |
| `response-schemas.js` | Zod schemas for API responses | `VenueSchema`, `SmartBlockSchema`, `StrategyPollingResponseSchema`, etc. |
| `transformers.js` | DB→API data transformation | `toApiVenue`, `toApiVenueData`, `toApiBlock`, etc. |

## Casing Convention

| Layer | Convention | Example |
|-------|------------|---------|
| Database (PostgreSQL) | snake_case | `snapshot_id`, `is_open`, `hours_today` |
| Server internal | snake_case | Matches DB for simplicity |
| API responses | camelCase | `snapshotId`, `isOpen`, `hoursToday` |
| Client (TypeScript) | camelCase | Matches API responses |

## Available Schemas

### Request Schemas (`schemas.js`)

| Schema | Purpose |
|--------|---------|
| `snapshotMinimalSchema` | Snapshot creation (supports both flat and nested coord formats) |
| `locationResolveSchema` | Location resolve request |
| `strategyRequestSchema` | Strategy generation request |
| `newsBriefingSchema` | News briefing request |

### Response Schemas (`response-schemas.js`)

| Schema | Purpose |
|--------|---------|
| `VenueSchema` | Single venue in venues/nearby response |
| `VenueDataSchema` | Full venue discovery data |
| `VenuesNearbyResponseSchema` | Complete /api/venues/nearby response |
| `SmartBlockSchema` | Single SmartBlock recommendation |
| `BlocksFastGetSuccessSchema` | /api/blocks-fast GET success response |
| `BlocksFastPostSuccessSchema` | /api/blocks-fast POST success response |
| `StrategyPollingResponseSchema` | /api/blocks/strategy/:id responses |

### ⚠️ "Consolidated" Field Naming (2026-01-10)

Two different objects use similar field names with **different semantics**:

| Object | Field | Purpose |
|--------|-------|---------|
| `briefing` (GET response) | `consolidatedStrategy` | Briefing tab 6-12hr shift strategy (manual push) |
| `strategy` (POST response) | `consolidated` | AI pipeline consolidated output |

**Do not confuse these!** The `briefing` object uses the full `consolidatedStrategy` name, while the `strategy` object uses the short `consolidated` name. This is intentional.

## Transformers (`transformers.js`)

Convert database records to API responses with consistent camelCase:

```javascript
import { toApiVenueData, toApiBlock } from '../../validation/transformers.js';

// In API route
const venueData = await discoverNearbyVenues(params);
res.json({
  success: true,
  data: toApiVenueData(venueData)  // Converts snake_case → camelCase
});
```

### Snake/Camel Tolerance (2026-01-10)

The `toApiBlock()` transformer now handles mixed casing from different data sources:

```javascript
// These all produce isOpen correctly:
toApiBlock({ is_open: true });                    // snake_case root
toApiBlock({ isOpen: false });                    // camelCase root
toApiBlock({ features: { is_open: true } });      // nested snake
toApiBlock({ features: { isOpen: false } });      // nested camel
```

**Fields with casing tolerance:**

| Field | Checks (in order) |
|-------|-------------------|
| `isOpen` | `isOpen`, `is_open`, `features.isOpen`, `features.is_open` |
| `streetViewUrl` | `streetViewUrl`, `street_view_url`, `features.streetViewUrl`, `features.street_view_url` |

**Why this matters:** Database stores `is_open` (snake_case), but some code paths use `isOpen` (camelCase). The transformer normalizes all variants to ensure API consumers always receive `isOpen`.

### Available Transformers

| Function | Input | Output |
|----------|-------|--------|
| `toApiVenue(dbVenue)` | DB venue record | API venue (camelCase) |
| `toApiVenueData(venueData)` | discoverNearbyVenues result | API venue data |
| `toApiBlock(dbBlock)` | ranking_candidates row | API SmartBlock |
| `toApiBlocksResponse(data)` | blocks-fast internal | API blocks response |
| `toApiStrategyPolling(data)` | content-blocks internal | API polling response |
| `transformKeysToCamel(obj)` | Any object | Recursively camelCase keys |
| `transformKeysToSnake(obj)` | Any object | Recursively snake_case keys |

## Usage Examples

### Request Validation

```javascript
import { validateBody } from '../../middleware/validate.js';
import { snapshotMinimalSchema, strategyRequestSchema } from '../../validation/schemas.js';

// Validate POST body
router.post('/snapshot', validateBody(snapshotMinimalSchema), handler);
router.post('/strategy', validateBody(strategyRequestSchema), handler);
```

### Response Transformation

```javascript
import { toApiVenueData } from '../../validation/transformers.js';
import { VenuesNearbyResponseSchema, validateResponse } from '../../validation/response-schemas.js';

router.get('/nearby', async (req, res) => {
  const venueData = await discoverNearbyVenues(params);
  const apiData = toApiVenueData(venueData);

  // Optional: validate response matches schema (useful in development)
  const validation = validateResponse(VenuesNearbyResponseSchema, { success: true, data: apiData });
  if (!validation.ok) {
    console.warn('Response validation failed:', validation.error);
  }

  res.json({ success: true, data: apiData });
});
```

## Snapshot Schema

Supports two input formats (normalized to flat lat/lng):

```javascript
// Format 1: Minimal (for curl tests)
{ lat: 37.77, lng: -122.41 }

// Format 2: Full SnapshotV1 (from frontend)
{ coord: { lat: 37.77, lng: -122.41 }, resolved: {...}, time_context: {...} }
```

Both are normalized to include top-level `lat`/`lng` for backward compatibility.

## Import Paths

```javascript
// From server/api/*/
import { snapshotMinimalSchema } from '../../validation/schemas.js';
import { toApiVenueData } from '../../validation/transformers.js';
import { VenueSchema, validateResponse } from '../../validation/response-schemas.js';

// From server/lib/*/
import { snapshotMinimalSchema } from '../validation/schemas.js';
```

## Connections

- **Used by:** `server/api/venue/`, `server/api/strategy/`, `server/api/location/`
- **Depends on:** Zod library (`z`)
- **Related:** `../middleware/validate.js` (validateBody middleware)
- **Client types:** `client/src/types/co-pilot.ts` (should match response schemas)
