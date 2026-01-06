> **Last Verified:** 2026-01-06

# Platform Data API

API endpoints for querying rideshare platform coverage data.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/platform/stats` | Overall statistics |
| GET | `/api/platform/markets` | List all markets with city counts |
| GET | `/api/platform/markets/:market` | Cities in a specific market |
| GET | `/api/platform/countries` | List countries with city counts |
| GET | `/api/platform/search?q=` | Search cities by name |
| GET | `/api/platform/city/:city` | Details for a specific city |

## Query Parameters

All endpoints support `platform` parameter (default: `uber`).

### `/api/platform/markets`
- `platform` - Platform name (default: uber)
- `country` - Filter by country

### `/api/platform/search`
- `q` - Search query (required, min 2 chars)
- `platform` - Platform name (default: uber)
- `country` - Filter by country
- `limit` - Max results (default: 20, max: 100)

### `/api/platform/city/:city`
- `platform` - Platform name (default: uber)
- `region` - Filter by state/region
- `country` - Filter by country

## Examples

```bash
# Get all markets
curl /api/platform/markets

# Get cities in Dallas-Fort Worth market
curl /api/platform/markets/Dallas-Fort%20Worth

# Search for cities starting with "Aus"
curl /api/platform/search?q=Aus

# Get statistics
curl /api/platform/stats

# Get all countries
curl /api/platform/countries
```

## Response Format

### Markets List
```json
{
  "platform": "uber",
  "total_markets": 46,
  "markets": [
    { "market": "Los Angeles", "country": "United States", "city_count": 50 },
    ...
  ]
}
```

### City Search
```json
{
  "query": "Dallas",
  "platform": "uber",
  "result_count": 5,
  "cities": [
    {
      "city": "Dallas",
      "region": "Texas",
      "country": "United States",
      "market": "Dallas-Fort Worth",
      "timezone": "America/Chicago"
    }
  ]
}
```

## Data Sources

- Uber cities data: `platform-data/uber/`
- Market definitions: `scripts/populate-market-data.js`

## See Also

- [Database Schema](../../../shared/schema.js) - `platform_data` table
- [Import Script](../../../scripts/import-platform-data.js)
- [Market Population Script](../../../scripts/populate-market-data.js)
