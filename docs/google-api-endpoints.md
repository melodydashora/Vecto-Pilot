# Google API Endpoints - New APIs

## Verified Working APIs

### 1. Places API (new)
**Endpoint:** `https://places.googleapis.com/v1/places/{place_id}`

**Purpose:** Retrieve place details, business hours, and location data using the new Google Places API

**Method:** GET

**Headers:**
```json
{
  "Content-Type": "application/json",
  "X-Goog-Api-Key": "<GOOGLE_MAPS_API_KEY>",
  "X-Goog-FieldMask": "displayName,formattedAddress,location,currentOpeningHours,regularOpeningHours,businessStatus"
}
```

**Test Coordinates:** DFW Airport (32.8968, -97.0380)

**Verified Response:**
- Returns displayName, formattedAddress, location coordinates
- Includes currentOpeningHours with periods, openNow status
- Provides businessStatus field

**Implementation:** `server/lib/places-hours.js`

---

### 2. Routes API (new)
**Endpoint:** `https://routes.googleapis.com/directions/v2:computeRoutes`

**Purpose:** Calculate traffic-aware driving routes with real-time duration estimates using the new Google Routes API

**Method:** POST

**Headers:**
```json
{
  "Content-Type": "application/json",
  "X-Goog-Api-Key": "<GOOGLE_MAPS_API_KEY>",
  "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.staticDuration"
}
```

**Request Body:**
```json
{
  "origin": {
    "location": {
      "latLng": {
        "latitude": 32.8968,
        "longitude": -97.0380
      }
    }
  },
  "destination": {
    "location": {
      "latLng": {
        "latitude": 32.7767,
        "longitude": -96.7970
      }
    }
  },
  "travelMode": "DRIVE",
  "routingPreference": "TRAFFIC_AWARE",
  "departureTime": "<ISO8601_TIMESTAMP>"
}
```

**Test Coordinates:**
- Origin: DFW Airport (32.8968, -97.0380)
- Destination: Downtown Dallas (32.7767, -96.7970)

**Verified Response:**
```json
{
  "routes": [
    {
      "distanceMeters": 35050,
      "duration": "1744s"
    }
  ]
}
```

**Implementation:** `server/lib/routes-api.js`

---

### 3. Route Matrix API (new)
**Endpoint:** `https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix`

**Purpose:** Calculate distances and durations for multiple origin-destination pairs in a single request

**Method:** POST

**Headers:**
```json
{
  "Content-Type": "application/json",
  "X-Goog-Api-Key": "<GOOGLE_MAPS_API_KEY>",
  "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,status"
}
```

**Implementation:** `server/lib/routes-api.js`

---

## Enrichment Pipeline Flow

**GPT-5 Venue Generation →**
1. GPT-5 outputs venue coordinates + staging coordinates (lat/lng pairs)
2. **Reverse geocoding** (legacy Geocoding API) - Get place_id from coordinates
3. **Places API (new)** - Get business hours, display name, formatted address
4. **Routes API (new)** - Get traffic-aware drive time and distance

All API calls verified working on 2025-10-31.
