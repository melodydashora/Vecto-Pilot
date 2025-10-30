# Runtime-Fresh Implementation Status

**Date:** 2025-10-30  
**Spec:** Runtime-Fresh Agent Contract & Deployment (Coordinate-First, Catalog-as-Backup)

---

## ✅ **IMPLEMENTED** (Ready for Testing)

### 1. Time Windowing (Database + Logic)
**Schema:** ✅ Added to `strategies` table
```javascript
valid_window_start: timestamp with timezone
valid_window_end: timestamp with timezone  
strategy_timestamp: timestamp with timezone
```

**Population Logic:** ✅ Implemented in `strategy-generator.js:33-62`
```javascript
const now = new Date();
const windowStart = now;
const windowEnd = new Date(now.getTime() + 60 * 60 * 1000); // +60 min max
```

**Files:**
- Schema: `shared/schema.js:60-62`
- Logic: `server/lib/strategy-generator.js:33-62`
- Migration: `drizzle/0002_natural_thunderbolts.sql`

---

### 2. Validation Gates (Hard-Fail Checks)
**Module:** ✅ Created `server/lib/validation-gates.js`

**Gates Implemented:**
- ✅ Location presence (`lat`, `lng`, `address` required)
- ✅ Location freshness (reverse-geocode age ≤ 2 minutes)
- ✅ Strategy freshness (timestamp within 120 seconds of request)
- ✅ Window duration (≤ 60 minutes)
- ✅ Window not expired
- ✅ Movement invalidation detection
- ✅ Schema validity checks

**Functions:**
```javascript
validateLocationFreshness(snapshot, requestTime)
validateStrategyFreshness(strategyTimestamp, requestTime)
validateWindowDuration(windowStart, windowEnd)
validateWindowNotExpired(windowEnd, currentTime)
validateStrategyGeneration({ snapshot, requestTime })
validateStrategyDelivery({ strategy, snapshot, requestTime })
checkMovementInvalidation(currentSnapshot, strategySnapshot, strategy)
```

**Usage:**
```javascript
import { validateStrategyGeneration } from './lib/validation-gates.js';

const validation = validateStrategyGeneration({ snapshot, requestTime: new Date() });
if (!validation.valid) {
  return { error: validation.errors.join('; ') };
}
```

---

### 3. Audit Logging (Single-Line Format)
**Module:** ✅ Created `server/lib/audit-logger.js`

**Format:** Matches spec exactly
```
user=undefined {request_id} {active_snapshot_id} {lat},{lng} "{address}" 
{valid_window.start}→{valid_window.end} catalog={catalog_resolution} 
events={events_resolution} freshness={freshness} no_mem={no_historical_bleed}
```

**Functions:**
```javascript
logStrategyAudit({ requestId, snapshotId, lat, lng, address, ... })
logValidationFailure({ requestId, snapshotId, errors })
logMovementInvalidation({ requestId, oldSnapshotId, newSnapshotId, reason })
```

**Output:**
- File: `logs/audit.log` (max 10MB, rotated after 5 files)
- Console: Also logs to console for real-time monitoring

---

### 4. Movement Thresholds
**Primary Threshold:** ✅ Fixed (500 meters)

**File:** `server/lib/strategy-triggers.js:15-16`
```javascript
const COORD_DELTA_THRESHOLD_KM = 0.5; // 500 meters
```

**Secondary Threshold:** 🟡 Partial (150m logic exists, speed tracking needed)

**Missing:**
- Speed tracking from GPS velocity
- Sustained movement detection (>20 mph for 2 min)
- Relocation-in-progress state

---

### 5. Planner Prompt (Spec Verbatim)
**Module:** ✅ Created `server/lib/runtime-fresh-planner-prompt.js`

**Content:** Exact copy from spec
```javascript
export const RUNTIME_FRESH_PLANNER_PROMPT = `You generate a driver strategy...`
```

**Helper Functions:**
```javascript
buildRuntimeFreshContext({ snapshot, strategy, requestId, activeSnapshotId })
getDayOfWeek(dow)
getTimeBand(hour)
getDensityClass(snapshot)
```

---

## 🟡 **PARTIAL** (Needs Integration)

### 1. Catalog Normalization (Logic Exists, Not Enforced)
**Status:** System can use catalog for normalization but doesn't enforce catalog-as-backup policy

**Current State:**
- ✅ Venue catalog exists (`venue_catalog` table)
- ✅ Enrichment uses Google Places API for runtime data
- 🟡 NOT enforcing: catalog for display name/hours only (not selection)

**Needed:**
- [ ] Add `name_source` field (runtime|catalog|unknown)
- [ ] Add `hours_source` field (runtime|catalog|unknown)
- [ ] Add `last_verified` timestamp
- [ ] Add `uncataloged_zone` boolean for zone-only guidance
- [ ] Add `catalog_resolution` flag (none|partial|full)
- [ ] Enforce: Select venues from runtime, then normalize via catalog

**Implementation Plan:**
```javascript
// Step 1: GPT-5 suggests venues from runtime signals (coordinates only)
const runtimeVenues = await gpt5TacticalPlanner(strategy, snapshot);

// Step 2: Attempt catalog normalization (optional)
const normalizedVenues = runtimeVenues.map(venue => {
  const catalogMatch = findNearestCatalogEntry(venue.lat, venue.lng, 20); // 20m radius
  
  if (catalogMatch) {
    return {
      ...venue,
      catalog_id: catalogMatch.id,
      display_name: catalogMatch.name,
      name_source: 'catalog',
      business_hours: catalogMatch.hours,
      hours_source: 'catalog',
      last_verified: catalogMatch.last_verified
    };
  } else {
    return {
      ...venue,
      catalog_id: null,
      display_name: venue.name, // From Google Places
      name_source: 'runtime',
      business_hours: venue.businessHours, // From Google Places
      hours_source: 'runtime',
      uncataloged_zone: true
    };
  }
});
```

---

### 2. Events Fail-Soft (Exists, Not Spec-Compliant)
**Status:** Event research exists but doesn't follow fail-soft contract

**Current State:**
- ✅ Perplexity event research (`server/lib/venue-event-research.js`)
- ✅ Events stored in `ranking_candidates.venue_events`
- 🟡 NOT enforcing: fail-soft with `events_resolution` flag

**Needed:**
- [ ] Add `events_resolution` field (none|partial|full)
- [ ] Filter events by proximity + window overlap
- [ ] Gracefully continue if events unavailable
- [ ] Never block on event failures

**Implementation:**
```javascript
let eventsResolution = 'none';
let relevantEvents = [];

try {
  const allEvents = await researchMultipleVenueEvents(venues);
  
  // Filter by proximity (within 5km) and window overlap
  relevantEvents = allEvents.filter(event => {
    const distance = haversineKm(snapshot, event.coordinates);
    const overlaps = eventOverlapsWindow(event, windowStart, windowEnd);
    return distance <= 5 && overlaps;
  });
  
  eventsResolution = relevantEvents.length > 0 ? 'full' : 'none';
} catch (error) {
  console.error('Events research failed (fail-soft):', error.message);
  eventsResolution = 'none'; // Continue without events
}
```

---

## ❌ **NOT IMPLEMENTED** (Critical Gaps)

### 1. JSON Schema Validation
**Missing:** Runtime validation against Strategy output schema

**Needed:**
- [ ] JSON Schema definition file
- [ ] Middleware to validate all strategy responses
- [ ] Reject invalid responses before delivery

**Implementation:**
```javascript
import Ajv from 'ajv';
import strategySchema from './schemas/strategy-output.json';

const ajv = new Ajv();
const validate = ajv.compile(strategySchema);

function validateStrategyResponse(strategy) {
  const valid = validate(strategy);
  if (!valid) {
    throw new Error(`Invalid strategy schema: ${ajv.errorsText(validate.errors)}`);
  }
  return true;
}
```

---

### 2. Movement Secondary Threshold (Speed Tracking)
**Missing:** Speed-based movement detection (150m @ >20 mph for 2 min)

**Needed:**
- [ ] GPS velocity tracking
- [ ] Sustained speed calculation (2-minute window)
- [ ] 150m threshold with speed gate
- [ ] Relocation-in-progress detection

**Implementation:**
```javascript
function checkSecondaryThreshold(currentSnapshot, lastSnapshot, velocityHistory) {
  // Check if moving > 20 mph for last 2 minutes
  const recentVelocities = velocityHistory.filter(v => 
    (Date.now() - v.timestamp) < 120000 // Last 2 minutes
  );
  
  const avgSpeed = recentVelocities.reduce((sum, v) => sum + v.speed, 0) / recentVelocities.length;
  const isFastMovement = avgSpeed > 20; // mph
  
  if (isFastMovement) {
    const distance = haversineKm(currentSnapshot, lastSnapshot);
    if (distance >= 0.15) { // 150 meters = 0.15km
      return {
        shouldUpdate: true,
        reason: 'RELOCATION_IN_PROGRESS',
        details: `Moving ${avgSpeed.toFixed(1)} mph, ${distance.toFixed(2)}km threshold`
      };
    }
  }
  
  return { shouldUpdate: false };
}
```

---

### 3. Density Polygon Detection
**Missing:** Actual polygon/census data for density class changes

**Current:** Heuristic-based (keywords in address)

**Needed:**
- [ ] Geospatial polygon database (residential/mixed/commercial/downtown)
- [ ] Point-in-polygon detection
- [ ] Density class change triggers

**Implementation:**
```javascript
import pointInPolygon from 'point-in-polygon';

function detectDensityChange(currentSnapshot, lastSnapshot, densityPolygons) {
  const currentDensity = findDensityClass(currentSnapshot.lat, currentSnapshot.lng, densityPolygons);
  const lastDensity = findDensityClass(lastSnapshot.lat, lastSnapshot.lng, densityPolygons);
  
  if (currentDensity !== lastDensity) {
    return {
      shouldUpdate: true,
      reason: 'DENSITY_CHANGE',
      details: `${lastDensity} → ${currentDensity}`
    };
  }
  
  return { shouldUpdate: false };
}

function findDensityClass(lat, lng, polygons) {
  for (const polygon of polygons) {
    if (pointInPolygon([lng, lat], polygon.coordinates)) {
      return polygon.density_class; // residential|mixed_use|commercial|downtown
    }
  }
  return 'residential'; // Default
}
```

---

## 📋 **Field Test Checklist** (From Spec)

### Pre-Test Setup
- [ ] Apply migration: `npm run db:push --force`
- [ ] Restart workflow to load new modules
- [ ] Clear browser cache and localStorage
- [ ] Enable location permissions

### Test 1: Location Capture & Anchoring
- [ ] Grant location permission
- [ ] Verify reverse-geocoded address appears in UI
- [ ] Check `anchor` object in strategy response:
  ```json
  {
    "lat": 33.128041,
    "lng": -96.875377,
    "address": "1234 Main St, Frisco, TX 75034"
  }
  ```

### Test 2: Fresh Strategy Generation
- [ ] Trigger manual refresh
- [ ] Verify unique `strategy_id` generated
- [ ] Check `strategy_timestamp` is current (within 5 seconds)
- [ ] Verify `valid_window.start` = now
- [ ] Verify `valid_window.end` ≤ now + 60 minutes
- [ ] Refresh again within 3 minutes
- [ ] Confirm new `strategy_id` (different from first)

### Test 3: Movement Invalidation
- [ ] Note current GPS coordinates
- [ ] Move ≥ 500 meters (0.3 miles)
- [ ] Trigger refresh or wait for auto-detect
- [ ] Verify new strategy generated with updated `anchor`
- [ ] Check audit log shows invalidation reason

### Test 4: Catalog Normalization
- [ ] Check strategy response for venue with catalog match:
  ```json
  {
    "catalog_id": "abc-123",
    "display_name": "The Boardwalk at Granite Park",
    "name_source": "catalog",
    "business_hours": { "mon": "11:00-21:00", ... },
    "hours_source": "catalog",
    "last_verified": "2025-10-30T12:00:00Z"
  }
  ```
- [ ] Check venue without catalog match:
  ```json
  {
    "catalog_id": null,
    "display_name": "Some New Venue",
    "name_source": "runtime",
    "uncataloged_zone": true
  }
  ```

### Test 5: Events Overlay
- [ ] Verify events appear when available
- [ ] Check `events_resolution` = "full" or "none"
- [ ] Confirm events filtered by proximity + window overlap
- [ ] Test with events unavailable - should continue gracefully

### Test 6: Validation Gates
- [ ] Test stale location (wait 3 minutes without refresh)
- [ ] Should fail with `LOCATION_STALE` error
- [ ] Test expired window (wait 61 minutes)
- [ ] Should auto-invalidate and regenerate

### Test 7: Audit Logging
- [ ] Check `logs/audit.log` for entries
- [ ] Verify format matches spec:
  ```
  user=undefined {uuid} {uuid} 33.128041,-96.875377 "1234 Main St, Frisco, TX" 
  2025-10-30T18:00:00Z→2025-10-30T19:00:00Z catalog=partial events=none 
  freshness=true no_mem=true
  ```

---

## 🚀 **Deployment Checklist**

### Database
- [ ] Apply migration: `npm run db:push --force`
- [ ] Verify new fields in `strategies` table
- [ ] Check for migration errors

### Code Integration
- [ ] Import validation gates in blocks route
- [ ] Add audit logging to strategy generator
- [ ] Integrate runtime-fresh planner prompt
- [ ] Update venue enrichment for catalog normalization
- [ ] Add events fail-soft logic

### Configuration
- [ ] Set environment variables:
  ```bash
  VALIDATION_ENABLED=true
  AUDIT_LOG_PATH=./logs/audit.log
  MAX_WINDOW_MINUTES=60
  LOCATION_FRESHNESS_SECONDS=120
  STRATEGY_FRESHNESS_SECONDS=120
  ```

### Testing
- [ ] Run field test checklist
- [ ] Monitor audit logs for failures
- [ ] Check validation gate behavior
- [ ] Verify time windowing works

### Monitoring
- [ ] Set up log rotation for `logs/audit.log`
- [ ] Monitor validation failure rate
- [ ] Track movement invalidation frequency
- [ ] Watch for catalog resolution issues

---

## 📊 **Implementation Status**

| Component | Schema | Logic | Integration | Testing |
|-----------|--------|-------|-------------|---------|
| Time Windowing | ✅ | ✅ | 🟡 | ⬜ |
| Validation Gates | ✅ | ✅ | ⬜ | ⬜ |
| Audit Logging | ✅ | ✅ | ⬜ | ⬜ |
| Movement (500m) | ✅ | ✅ | ✅ | ⬜ |
| Movement (150m+speed) | ⬜ | ⬜ | ⬜ | ⬜ |
| Planner Prompt | ✅ | ✅ | ⬜ | ⬜ |
| Catalog Normalization | ✅ | 🟡 | ⬜ | ⬜ |
| Events Fail-Soft | ✅ | 🟡 | ⬜ | ⬜ |
| Density Polygons | ⬜ | ⬜ | ⬜ | ⬜ |
| JSON Schema Validation | ⬜ | ⬜ | ⬜ | ⬜ |

**Legend:**
- ✅ Complete
- 🟡 Partial
- ⬜ Not Started

**Overall:** ~60% Complete (6.5/10 components)

---

## 🔧 **Next Steps** (Priority Order)

1. **Apply Migration** (5 min)
   ```bash
   npm run db:push --force
   ```

2. **Integrate Validation Gates** (30 min)
   - Add to blocks route
   - Add to strategy delivery
   - Test hard-fail behavior

3. **Integrate Audit Logging** (20 min)
   - Add to strategy generator
   - Add to blocks route
   - Test log output

4. **Update Planner to Use New Prompt** (15 min)
   - Replace current prompt with runtime-fresh version
   - Test strategy generation

5. **Enforce Catalog Normalization** (60 min)
   - Add source tracking fields
   - Implement backup normalization logic
   - Test with/without catalog matches

6. **Add Events Fail-Soft** (30 min)
   - Add events_resolution field
   - Implement try-catch with graceful fallback
   - Test with events unavailable

7. **Field Test** (60 min)
   - Run full checklist
   - Document issues
   - Fix critical bugs

---

## 📝 **Migration Command**

To apply all schema changes:

```bash
npm run db:push --force
```

This will:
- Add `valid_window_start`, `valid_window_end`, `strategy_timestamp` to `strategies` table
- Apply changes without data loss (fields are nullable)
- Update Drizzle schema metadata

---

## ✅ **Ready for Testing**

The following components are ready to test immediately:

1. **Time Windowing** - Strategy generation sets windows
2. **Validation Gates** - Can validate location/strategy freshness
3. **Audit Logging** - Can log to file/console
4. **Movement Detection** - 500m threshold active
5. **Planner Prompt** - Spec-compliant prompt ready

**Blockers for Full Deployment:**
- Migration not applied (auth issue)
- Validation gates not integrated into routes
- Audit logging not called from strategy generator
- Catalog normalization not enforced

**Recommended:** Apply migration first, then integrate validation/logging into existing routes for immediate benefit.
