> **Last Verified:** 2026-01-06

# Platform Data

Reference data for rideshare platforms.

## Structure

| Folder | Purpose |
|--------|---------|
| `uber/` | Uber market and city data |
| `Lyft/` | Lyft market data (placeholder for future) |

## Purpose

Static reference data used for:
- Market identification
- City/region lookups
- Platform coverage validation

## Usage

```javascript
import uberCities from '../platform-data/uber/uber_cities_data.json';

const isUberMarket = uberCities.some(c => c.city === userCity);
```

## Notes

- Data is static and updated periodically
- Used for offline lookups (no API call needed)
- May become stale - verify against live APIs for critical decisions
