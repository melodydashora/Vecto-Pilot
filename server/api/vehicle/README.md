# Vehicle API

NHTSA vPIC API proxy with database caching for vehicle makes and models.

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/vehicle/makes` | Get all vehicle makes |
| GET | `/api/vehicle/models?make=X&year=Y` | Get models for a make/year |
| GET | `/api/vehicle/years` | Get available vehicle years (2005-present) |

## Caching

All data from NHTSA is cached in PostgreSQL for 24 hours to reduce API calls:

- `vehicle_makes_cache` - All vehicle makes
- `vehicle_models_cache` - Models by make and year

Common rideshare makes (Toyota, Honda, etc.) are flagged as `is_common` and returned first.

## NHTSA vPIC API

This proxy uses the free NHTSA vPIC API (no registration required):
- Base URL: `https://vpic.nhtsa.dot.gov/api`
- Endpoints:
  - `/vehicles/GetAllMakes` - All makes
  - `/vehicles/GetModelsForMakeYear/make/{make}/modelyear/{year}` - Models by make/year

## Response Formats

### GET /api/vehicle/makes
```json
{
  "makes": [
    { "id": 474, "name": "Toyota", "isCommon": true },
    { "id": 441, "name": "Honda", "isCommon": true }
  ],
  "cached": true,
  "cachedAt": "2024-12-28T10:00:00Z"
}
```

### GET /api/vehicle/models?make=Toyota&year=2023
```json
{
  "models": [
    { "id": 1234, "name": "Camry" },
    { "id": 1235, "name": "Corolla" }
  ],
  "make": "Toyota",
  "year": 2023,
  "cached": false,
  "totalCount": 25
}
```

### GET /api/vehicle/years
```json
{
  "years": [2026, 2025, 2024, ..., 2005]
}
```

## Database Tables

See `shared/schema.js`:
- `vehicle_makes_cache`
- `vehicle_models_cache`

## Related Files

- `server/bootstrap/routes.js` - Route mounting
- `client/src/pages/auth/SignUpPage.tsx` - Vehicle selection UI
