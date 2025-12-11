# Google Cloud APIs Reference

This document lists all enabled Google Cloud APIs available via `GOOGLE_CLOUD_API_KEY` for Vecto Pilot.

## Currently Used APIs

| API | Usage | File |
|-----|-------|------|
| **Geocoding API** | GPS → Address resolution | `server/api/location/location.js` |
| **Routes API** | Drive time/distance calculations | `server/lib/venue/venue-enrichment.js` |
| **Places API (New)** | Venue hours, status, details | `server/lib/venue/venue-enrichment.js` |
| **Weather API** | Current conditions | `server/api/location/location.js` |
| **Air Quality API** | AQI data | `server/api/location/location.js` |
| **Time Zone API** | Venue timezone detection | `server/lib/venue/venue-enrichment.js` |

---

## Available APIs (Not Yet Used)

### High-Value Opportunities

#### Traffic & Navigation
| API | Potential Use Case | Priority |
|-----|-------------------|----------|
| **Directions API** | Turn-by-turn routing, alternate routes | High |
| **Distance Matrix API** | Batch distance calculations (multiple origins/destinations) | High |
| **Roads API** | Snap GPS to roads, speed limits | Medium |
| **Route Optimization API** | Optimal multi-stop routing for drivers | High |
| **Navigation SDK** | In-app navigation (mobile) | Low |

#### Location Intelligence
| API | Potential Use Case | Priority |
|-----|-------------------|----------|
| **Address Validation API** | Verify/correct user addresses | Medium |
| **Geolocation API** | WiFi/cell tower positioning (fallback) | Low |
| **Places Aggregate API** | Area-level venue statistics | Medium |
| **Pollen API** | Allergy alerts for outdoor events | Low |
| **Solar API** | Daylight hours for outdoor venues | Low |

#### Visualization
| API | Potential Use Case | Priority |
|-----|-------------------|----------|
| **Maps JavaScript API** | Interactive venue maps | Medium |
| **Maps Static API** | Static map images in strategy | Low |
| **Maps Embed API** | Embedded maps in UI | Low |
| **Map Tiles API** | Custom map tiles | Low |
| **Street View Static API** | Venue preview images | Medium |
| **Aerial View API** | Aerial venue imagery | Low |
| **Maps Elevation API** | Terrain data for routes | Low |

#### Data & Analytics
| API | Potential Use Case | Priority |
|-----|-------------------|----------|
| **BigQuery API** | Historical demand analysis | Medium |
| **Cloud Logging API** | Centralized log management | Medium |
| **Cloud Monitoring API** | Performance monitoring | Medium |
| **Cloud Trace API** | Request tracing | Low |
| **Analytics Hub API** | Data sharing/marketplace | Low |

#### AI & ML
| API | Potential Use Case | Priority |
|-----|-------------------|----------|
| **Vertex AI API** | Custom ML models for demand prediction | High |
| **Custom Search API** | Enhanced event discovery | Medium |

#### Storage & Database
| API | Potential Use Case | Priority |
|-----|-------------------|----------|
| **Cloud Storage API** | Static asset storage, backups | Low |
| **Cloud Datastore API** | NoSQL caching layer | Low |
| **Cloud SQL** | Managed PostgreSQL (alternative to Replit) | Low |

---

## API Integration Patterns

### Routes API (Current)
```javascript
// server/lib/venue/venue-enrichment.js
const response = await fetch(
  'https://routes.googleapis.com/directions/v2:computeRoutes',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_CLOUD_API_KEY,
      'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters'
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude, longitude } } },
      destination: { location: { latLng: { latitude, longitude } } },
      travelMode: 'DRIVE'
    })
  }
);
```

### Places API (New) (Current)
```javascript
// server/lib/venue/venue-enrichment.js
const response = await fetch(
  `https://places.googleapis.com/v1/places:searchNearby`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_CLOUD_API_KEY,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.regularOpeningHours'
    },
    body: JSON.stringify({
      locationRestriction: {
        circle: { center: { latitude, longitude }, radiusMeters: 500 }
      },
      maxResultCount: 1
    })
  }
);
```

### Distance Matrix API (Potential)
```javascript
// Batch calculate distances from driver to multiple venues
const response = await fetch(
  `https://maps.googleapis.com/maps/api/distancematrix/json?` +
  `origins=${driverLat},${driverLng}` +
  `&destinations=${venues.map(v => `${v.lat},${v.lng}`).join('|')}` +
  `&key=${process.env.GOOGLE_CLOUD_API_KEY}`
);
// Returns distances/durations for ALL venues in one call
```

### Route Optimization API (Potential)
```javascript
// Optimize multi-stop route for maximum earnings
const response = await fetch(
  'https://routeoptimization.googleapis.com/v1/projects/PROJECT_ID:optimizeTours',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: {
        shipments: venues.map(v => ({
          deliveries: [{ arrivalLocation: { latitude: v.lat, longitude: v.lng } }],
          penaltyCost: v.value_per_min * -1 // Higher value = lower penalty
        })),
        vehicles: [{
          startLocation: { latitude: driverLat, longitude: driverLng },
          endLocation: { latitude: driverLat, longitude: driverLng }
        }]
      }
    })
  }
);
```

### Vertex AI API (Potential)
```javascript
// Custom demand prediction model
const response = await fetch(
  `https://us-central1-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/us-central1/endpoints/ENDPOINT_ID:predict`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      instances: [{
        venue_type: 'bar',
        day_of_week: 'friday',
        hour: 22,
        weather: 'clear',
        nearby_events: 2
      }]
    })
  }
);
```

---

## Recommended Enhancements

### Phase 1: Quick Wins
1. **Distance Matrix API** - Replace individual Routes API calls with batch requests
   - Current: N API calls for N venues
   - Improved: 1 API call for N venues
   - Benefit: Faster enrichment, lower costs

2. **Address Validation API** - Validate driver home address
   - Catch typos in user-entered addresses
   - Improve geocoding accuracy

### Phase 2: Enhanced Intelligence
3. **Route Optimization API** - Smart multi-venue routing
   - "Visit these 5 venues in optimal order"
   - Factor in closing times, event schedules

4. **Street View Static API** - Venue preview images
   - Show drivers what staging areas look like
   - Help identify parking spots

### Phase 3: Advanced Features
5. **Vertex AI API** - Demand prediction ML
   - Train on historical rideshare data
   - Predict surge pricing windows

6. **BigQuery API** - Analytics dashboard
   - Store historical strategy performance
   - Track venue earnings over time

---

## Environment Variables

```bash
# Current
GOOGLE_CLOUD_API_KEY=...     # All Google APIs
GOOGLE_MAPS_API_KEY=...      # Legacy (same key, different name)

# For Vertex AI / Route Optimization (requires OAuth)
GOOGLE_CLOUD_PROJECT_ID=...
GOOGLE_CLOUD_SERVICE_ACCOUNT=...  # JSON key file path
```

---

## Cost Considerations

| API | Pricing | Current Usage |
|-----|---------|---------------|
| Routes API | $5/1000 requests | ~5 per strategy |
| Places API (New) | $17/1000 requests | ~5 per strategy |
| Geocoding API | $5/1000 requests | 1 per session |
| Weather API | $4/1000 requests | 1 per session |
| Air Quality API | $5/1000 requests | 1 per session |
| Distance Matrix API | $5/1000 elements | Not used |
| Route Optimization | $10/1000 shipments | Not used |

**Monthly estimate** (1000 strategies/month): ~$150-200

---

## Related Documentation

- [Google Maps Platform](https://developers.google.com/maps/documentation)
- [Places API (New)](https://developers.google.com/maps/documentation/places/web-service/op-overview)
- [Routes API](https://developers.google.com/maps/documentation/routes)
- [Vertex AI](https://cloud.google.com/vertex-ai/docs)
- [Route Optimization](https://cloud.google.com/optimization/docs)
