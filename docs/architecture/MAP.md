# MAP.md — Map and Location Features

> **Canonical reference** for GPS tracking, map rendering, markers/overlays, districts/zones, and how location feeds into strategy and venues.
> Last updated: 2026-04-10

## Supersedes
- `docs/architecture/Location.md` — Location system overview (merged here)
- `docs/architecture/snapshot-flow.md` — Snapshot propagation (see also SNAPSHOT.md)
- `docs/architecture/progress-bar-and-snapshot-flow.md` — Progress bar details (see also STRATEGY.md)

---

## Table of Contents

1. [Mapping Library](#1-mapping-library)
2. [LocationContext and GPS Tracking](#2-locationcontext-and-gps-tracking)
3. [Map Markers and Overlays](#3-map-markers-and-overlays)
4. [District and Zone System](#4-district-and-zone-system)
5. [Market Boundaries and Geofencing](#5-market-boundaries-and-geofencing)
6. [Location → Strategy → Venues Data Flow](#6-location--strategy--venues-data-flow)
7. [Location Sharing](#7-location-sharing)
8. [Current State](#8-current-state)
9. [Known Gaps](#9-known-gaps)
10. [TODO — Hardening Work](#10-todo--hardening-work)

---

## 1. Mapping Library

**Google Maps SDK v3** — loaded dynamically in client.

```javascript
// API key: VITE_GOOGLE_MAPS_API_KEY (Vite env, exposed to client)
// Libraries: maps
// Traffic layer enabled on all maps: new google.maps.TrafficLayer()
```

**No Mapbox integration.** All maps are Google Maps.

### Map Components

| Component | File | Purpose |
|-----------|------|---------|
| `MapTab.tsx` | `client/src/components/MapTab.tsx` (649 lines) | Main strategy map with venues/events |
| `TacticalStagingMap.tsx` | `client/src/components/intel/TacticalStagingMap.tsx` (300+ lines) | Staging zone visualization |
| `ConciergeMap.tsx` | `client/src/components/concierge/ConciergeMap.tsx` | Public concierge venue map |

---

## 2. LocationContext and GPS Tracking

**File:** `client/src/contexts/location-context-clean.tsx`

See `SNAPSHOT.md` for the full LocationContext architecture. Key points for mapping:

### GPS Acquisition

1. Browser `navigator.geolocation.getCurrentPosition()` — 6-decimal precision (~11cm)
2. Fallback: Google Geolocation API (`googleapis.com/geolocation/v1/geolocate`)
3. Final fallback: Home location from `driver_profiles.home_lat/home_lng`
4. Manual timeout: 12 seconds (browser can hang)

### Location State Exposed

```typescript
{
  currentCoords: { latitude, longitude } | null;
  city: string | null;
  state: string | null;
  timeZone: string | null;
  weather: { temp, conditions, description } | null;
  airQuality: { aqi, category } | null;
  isLocationResolved: boolean;  // Gates downstream queries
  lastSnapshotId: string | null;
}
```

---

## 3. Map Markers and Overlays

### Marker Types (MapTab.tsx)

| Marker | Color | Source | Display Criteria |
|--------|-------|--------|-----------------|
| Driver location | Blue | GPS coordinates | Always shown |
| Grade A venues | Red | ranking_candidates | `value_grade === 'A'` |
| Grade B venues | Orange | ranking_candidates | `value_grade === 'B'` |
| Grade C+ venues | Yellow | ranking_candidates | `value_grade === 'C'` |
| Events (today) | Purple | discovered_events | Today only, has lat/lng |
| Bars (open) | Green | venue_catalog | `isOpen === true` |
| Bars (closed, worth staging) | Orange | venue_catalog | `closedGoAnyway === true` |
| Bars (closing soon) | Red | venue_catalog | `closingSoon === true` |

### Event Marker Icons

Category-based: music, sports, festival, theater, comedy, civic

### Info Windows

Clicking any marker opens an info window with:
- Venue name, address, distance, drive time
- Earnings estimate, value grade badge
- Event badge (if event at venue)
- Navigation buttons: Google Maps + Apple Maps

### Traffic Layer

Enabled on all map instances: `new google.maps.TrafficLayer()`. Shows real-time traffic coloring on roads.

---

## 4. District and Zone System

### `zone_intelligence` Table

**File:** `shared/schema.js` (lines 1947–1994)

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | Zone identifier |
| `market_slug` | text | Market (e.g., "dallas-tx") |
| `zone_type` | text | dead_zone / danger_zone / honey_hole / surge_trap / staging_spot / event_zone |
| `zone_name` | text | "Deep Ellum after 2am", "DFW cell phone lot" |
| `lat`, `lng` | double (optional) | Zone center coordinates |
| `radius_miles` | double (default 0.5) | Zone radius |
| `address_hint` | text | "Near the Target on Main St" |
| `time_constraints` | jsonb | `{after_hour: 22, before_hour: 6, days: ['fri','sat']}` |
| `is_time_specific` | boolean | Whether zone is time-dependent |
| `reports_count` | integer | Crowd-sourced driver report count |
| `confidence_score` | integer (1-100) | Increases with more reports |
| `contributing_users` | jsonb | Array of user_ids who reported |

### Zone Types

| Type | Meaning | Color on Map |
|------|---------|-------------|
| `honey_hole` | High-demand area | Green |
| `dead_zone` | No rides, waste of time | Red |
| `danger_zone` | Safety concern | Red (striped) |
| `surge_trap` | Surge appears but dissipates quickly | Yellow |
| `staging_spot` | Good parking/waiting location | Blue |
| `event_zone` | Event-driven temporary demand | Purple |

### How Zones Are Created

1. **AI Coach:** Via `[ZONE_INTEL]` action tags during conversations
2. **Market Intelligence API:** `POST /api/intelligence` with `intel_type: 'zone'`
3. **Cross-driver learning:** Confidence score increments when multiple drivers report same zone

---

## 5. Market Boundaries and Geofencing

### Market Resolution

**Table:** `market_cities`

```
market_name: "Dallas-Fort Worth"
city: "Frisco" | "Dallas" | "Fort Worth" | ...
state: "TX"
region_type: "Core" | "Satellite"
```

**Endpoint:** `GET /api/intelligence/for-location?city=Frisco&state=TX` → resolves to Dallas-Fort Worth market.

### Geofencing

Implicit via market_cities mapping — no explicit radius-based geofencing. The offer analysis endpoint (`/api/hooks/analyze-offer`) uses hard-coded market boundaries for the "Market Exit Warning" (e.g., "Reject rides west of Fort Worth" for DFW market).

---

## 6. Location → Strategy → Venues Data Flow

```
Browser GPS
  └─ LocationContext
      ├─ Weather/AQI (Google APIs)
      ├─ Geocode (Google) → city, state, timezone, formatted_address
      ├─ Snapshot created (server) → snapshot_id
      │
      └─ Snapshot propagates to:
          ├─ CoPilotContext → triggers POST /api/blocks-fast
          │   ├─ Briefing (traffic, events, news, weather, closures, airport)
          │   ├─ Strategy (uses location + briefing as input)
          │   └─ Venues/SmartBlocks (uses strategy + briefing)
          │
          ├─ useBarsQuery → GET /api/venues/nearby (DB query, fast)
          ├─ useBriefingQueries → GET /api/briefing/* endpoints
          └─ Map components → render markers from venue + event data
```

---

## 7. Location Sharing

### Concierge (QR Code)

Passengers scan a QR code → access driver's public concierge page → browser GPS provides passenger's own location for local search. **Driver's location is NOT shared with passengers.**

### No Real-Time Location Sharing

No feature exists to share the driver's real-time location with other users or services.

---

## 8. Current State

| Area | Status |
|------|--------|
| Google Maps rendering | Working — all 3 map components |
| Traffic layer | Working |
| GPS tracking | Working — browser + Google API fallback |
| Venue markers (color-coded) | Working |
| Event markers (today only) | Working |
| Zone intelligence storage | Working — crowd-sourced via Coach |
| Market resolution | Working — city → market mapping |
| Staging areas on map | Working — from ranking_candidates |

---

## 9. Known Gaps

1. **No PostGIS** — Zone queries use bounding box + Haversine, not spatial indexes. Fine for current scale but won't scale to millions of zones.
2. **No zone visualization on main map** — Zones exist in DB but aren't rendered as overlays on the map (only staging spots from current ranking are shown).
3. **No live location tracking** — GPS is fetched once per session, not continuously tracked. Driver must manually refresh to update position.
4. **Market boundaries are city-level** — A driver at the edge of two markets might get the wrong market intelligence.
5. **No geofence alerts** — No notification when driver enters/exits a zone or market boundary.

---

## 10. TODO — Hardening Work

- [ ] **Render zones on map** — Show honey_holes (green), dead_zones (red), danger_zones (red striped) as overlays
- [ ] **Continuous GPS tracking** — Periodically refresh location (every 5 min while app is active)
- [ ] **PostGIS for spatial queries** — Migrate to spatial indexes if zone count grows beyond 10K
- [ ] **Geofence alerts** — Push notification when entering market exit zone or danger zone
- [ ] **Market boundary visualization** — Show market boundaries on map for driver awareness
- [ ] **Heatmap overlay** — Aggregate demand data into visual heatmap layer

---

## Key Files

| File | Purpose |
|------|---------|
| `client/src/components/MapTab.tsx` | Main strategy map (649 lines) |
| `client/src/components/intel/TacticalStagingMap.tsx` | Staging zone map |
| `client/src/contexts/location-context-clean.tsx` | GPS + LocationContext |
| `server/api/intelligence/index.js` | Staging areas endpoint |
| `shared/schema.js` (zone_intelligence) | Zone table schema |
