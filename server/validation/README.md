# Validation (`server/validation/`)

## Purpose

Zod validation schemas for API request validation. Provides type-safe input validation with detailed error messages.

## Files

| File | Purpose | Key Exports |
|------|---------|-------------|
| `schemas.js` | Zod schemas for API requests | `snapshotMinimalSchema`, `locationResolveSchema`, `strategyRequestSchema`, etc. |

## Available Schemas

| Schema | Purpose |
|--------|---------|
| `snapshotMinimalSchema` | Snapshot creation (supports both flat and nested coord formats) |
| `locationResolveSchema` | Location resolve request |
| `strategyRequestSchema` | Strategy generation request |
| `newsBriefingSchema` | News briefing request |

## Usage

```javascript
import { validateBody } from '../../middleware/validate.js';
import { snapshotMinimalSchema, strategyRequestSchema } from '../../validation/schemas.js';

// Validate POST body
router.post('/snapshot', validateBody(snapshotMinimalSchema), handler);
router.post('/strategy', validateBody(strategyRequestSchema), handler);
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
import { snapshotMinimalSchema, strategyRequestSchema } from '../../validation/schemas.js';

// From server/lib/*/
import { snapshotMinimalSchema } from '../validation/schemas.js';
```

## Connections

- **Used by:** `server/api/location/`, `server/api/strategy/`
- **Depends on:** Zod library (`z`)
- **Related:** `../middleware/validate.js` (validateBody middleware)
