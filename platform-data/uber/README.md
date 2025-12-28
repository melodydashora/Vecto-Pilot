# Uber Platform Data

Uber market and city reference data.

## Files

| File | Purpose |
|------|---------|
| `uber_cities_data.json` | City data in JSON format |
| `uber_cities_data.csv` | City data in CSV format |
| `unitedstates-city.txt` | US cities list |
| `country-uber.txt` | Countries with Uber |
| `areabycountry-uber.txt` | Regions by country |
| `uber_additional_countries_*.txt` | Extended coverage data |

## Data Fields

Typical city record:
```json
{
  "city": "Dallas",
  "state": "Texas",
  "country": "United States",
  "timezone": "America/Chicago",
  "services": ["UberX", "UberXL", "Black"]
}
```

## Usage

```javascript
import cities from './uber_cities_data.json';

// Find city info
const dallas = cities.find(c => c.city === 'Dallas' && c.state === 'Texas');
```

## Updates

Data sourced from Uber's public market listings. Update periodically to capture new markets.

## See Also

- [scripts/import-platform-data.js](../../scripts/import-platform-data.js) - Import script
