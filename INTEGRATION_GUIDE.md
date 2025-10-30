# Runtime-Fresh Integration Guide

**Status:** Modules created, ready for integration into routes  
**Date:** 2025-10-30

---

## Quick Start (5 Minutes)

### 1. Restart the Application
```bash
# Migration already applied (fields exist in schema)
# Just restart to load new modules
npm run dev
```

### 2. Verify Modules Loaded
All three modules are ready to import:
- ✅ `server/lib/validation-gates.js`
- ✅ `server/lib/audit-logger.js`
- ✅ `server/lib/runtime-fresh-planner-prompt.js`

---

## Integration Steps

### Step 1: Add Validation to Strategy Delivery

**File:** `server/routes/blocks.js` (or wherever `/api/chat` is defined)

**Before:**
```javascript
app.get('/api/chat', async (req, res) => {
  const snapshot = await getCurrentSnapshot();
  const strategy = await getStrategy(snapshot.snapshot_id);
  
  res.json({ strategy });
});
```

**After:**
```javascript
import { validateStrategyDelivery } from './lib/validation-gates.js';
import { logStrategyAudit, logValidationFailure } from './lib/audit-logger.js';

app.get('/api/chat', async (req, res) => {
  const requestId = crypto.randomUUID();
  const snapshot = await getCurrentSnapshot();
  const strategy = await getStrategy(snapshot.snapshot_id);
  
  // VALIDATION GATE
  const validation = validateStrategyDelivery({
    strategy,
    snapshot,
    requestTime: new Date()
  });
  
  if (!validation.valid) {
    logValidationFailure({
      requestId,
      snapshotId: snapshot.snapshot_id,
      errors: validation.errors
    });
    
    return res.status(400).json({
      error: 'VALIDATION_FAILED',
      message: validation.errors.join('; '),
      correlationId: requestId
    });
  }
  
  // AUDIT LOG
  logStrategyAudit({
    requestId,
    snapshotId: snapshot.snapshot_id,
    lat: snapshot.lat,
    lng: snapshot.lng,
    address: snapshot.formatted_address,
    validWindowStart: strategy.valid_window_start,
    validWindowEnd: strategy.valid_window_end,
    catalogResolution: 'partial', // Update based on actual catalog usage
    eventsResolution: 'none', // Update when events implemented
    freshness: true,
    noHistoricalBleed: true
  });
  
  res.json({ strategy });
});
```

---

### Step 2: Add Movement Detection to Location Updates

**File:** `server/routes/snapshots.js` (or wherever location updates happen)

**Before:**
```javascript
app.post('/api/snapshot', async (req, res) => {
  const { lat, lng } = req.body;
  
  const newSnapshot = await createSnapshot(lat, lng);
  const strategy = await generateStrategyForSnapshot(newSnapshot.snapshot_id);
  
  res.json({ snapshot: newSnapshot, strategy });
});
```

**After:**
```javascript
import { checkMovementInvalidation } from './lib/validation-gates.js';
import { logMovementInvalidation } from './lib/audit-logger.js';

app.post('/api/snapshot', async (req, res) => {
  const requestId = crypto.randomUUID();
  const { lat, lng } = req.body;
  
  // Get previous snapshot and strategy
  const previousSnapshot = await getCurrentSnapshot();
  const previousStrategy = previousSnapshot ? await getStrategy(previousSnapshot.snapshot_id) : null;
  
  // Create new snapshot
  const newSnapshot = await createSnapshot(lat, lng);
  
  // Check if movement requires strategy regeneration
  if (previousSnapshot && previousStrategy) {
    const movementCheck = checkMovementInvalidation(
      newSnapshot,
      previousSnapshot,
      previousStrategy
    );
    
    if (movementCheck.needsRegeneration) {
      logMovementInvalidation({
        requestId,
        oldSnapshotId: previousSnapshot.snapshot_id,
        newSnapshotId: newSnapshot.snapshot_id,
        reason: movementCheck.reason
      });
      
      // Generate fresh strategy
      const strategy = await generateStrategyForSnapshot(newSnapshot.snapshot_id);
      return res.json({ 
        snapshot: newSnapshot, 
        strategy,
        regenerated: true,
        reason: movementCheck.reason
      });
    }
  }
  
  // No regeneration needed
  res.json({ 
    snapshot: newSnapshot, 
    strategy: previousStrategy,
    regenerated: false
  });
});
```

---

### Step 3: Update Strategy Generator to Log Audits

**File:** `server/lib/strategy-generator.js`

**Add at line 283 (after successful strategy generation):**

```javascript
import { logStrategyAudit } from './audit-logger.js';

// ... existing code ...

if (result.ok) {
  const strategyText = result.text.trim();
  
  await db.update(strategies)
    .set({
      status: 'ok',
      strategy: strategyText,
      latency_ms: result.ms,
      tokens: result.tokens,
      attempt: result.attempt,
      updated_at: new Date()
    })
    .where(eq(strategies.snapshot_id, snapshot_id));
  
  // LOG AUDIT (NEW)
  const [savedStrategy] = await db.select()
    .from(strategies)
    .where(eq(strategies.snapshot_id, snapshot_id))
    .limit(1);
  
  logStrategyAudit({
    requestId: savedStrategy.correlation_id || 'no-correlation-id',
    snapshotId: snapshot_id,
    lat: snap.lat,
    lng: snap.lng,
    address: snap.formatted_address,
    validWindowStart: savedStrategy.valid_window_start,
    validWindowEnd: savedStrategy.valid_window_end,
    catalogResolution: 'unknown', // Update when catalog normalization implemented
    eventsResolution: 'none', // Update when events implemented
    freshness: true,
    noHistoricalBleed: true,
    reasonCodes: ['MANUAL_REFRESH'] // Or actual trigger reason
  });
  
  console.log(`[TRIAD] ✅ Three-stage pipeline complete (Claude → Gemini → GPT-5)`);
  // ... rest of existing code ...
}
```

---

## Testing

### Test 1: Validation Gates
```bash
# Terminal 1: Watch audit logs
tail -f logs/audit.log

# Terminal 2: Test stale location
curl http://localhost:5000/api/chat
# Should fail with LOCATION_STALE after 2 minutes without refresh
```

### Test 2: Movement Detection
```bash
# Create snapshot at location A
curl -X POST http://localhost:5000/api/snapshot \
  -H "Content-Type: application/json" \
  -d '{"lat": 33.128041, "lng": -96.875377}'

# Create snapshot at location B (>500m away)
curl -X POST http://localhost:5000/api/snapshot \
  -H "Content-Type: application/json" \
  -d '{"lat": 33.133041, "lng": -96.875377}'

# Check audit log - should show MOVEMENT_THRESHOLD invalidation
```

### Test 3: Audit Logging
```bash
# Check log format matches spec
cat logs/audit.log

# Expected format:
# user=undefined {uuid} {uuid} 33.128041,-96.875377 "1234 Main St, Frisco, TX" 
# 2025-10-30T18:00:00Z→2025-10-30T19:00:00Z catalog=partial events=none 
# freshness=true no_mem=true
```

---

## Configuration

### Environment Variables (Optional)

Add to `.env`:
```bash
# Validation Gates
VALIDATION_ENABLED=true
LOCATION_FRESHNESS_SECONDS=120
STRATEGY_FRESHNESS_SECONDS=120
MAX_WINDOW_MINUTES=60

# Audit Logging
AUDIT_LOG_PATH=./logs/audit.log
AUDIT_LOG_MAX_SIZE=10485760  # 10MB
AUDIT_LOG_MAX_FILES=5

# Movement Detection
PRIMARY_MOVEMENT_THRESHOLD_M=500
SECONDARY_MOVEMENT_THRESHOLD_M=150
SECONDARY_SPEED_THRESHOLD_MPH=20
SECONDARY_DURATION_SECONDS=120
```

---

## Monitoring

### Log Rotation
Winston automatically rotates logs at 10MB with 5 file retention.

### Health Check
Add validation status to `/api/health`:

```javascript
app.get('/api/health', async (req, res) => {
  const snapshot = await getCurrentSnapshot();
  
  const locationValidation = validateLocationFreshness(snapshot);
  const strategyValidation = snapshot 
    ? await validateStrategyForSnapshot(snapshot.snapshot_id)
    : { valid: false };
  
  res.json({
    status: 'ok',
    validation: {
      location: locationValidation.valid,
      strategy: strategyValidation.valid
    },
    timestamp: new Date().toISOString()
  });
});
```

---

## Troubleshooting

### Issue: Validation always fails
**Cause:** Time windowing fields not populated  
**Fix:** Ensure migration applied and strategy generator sets fields

### Issue: Audit log not writing
**Cause:** Log directory doesn't exist  
**Fix:** 
```bash
mkdir -p logs
chmod 755 logs
```

### Issue: Movement detection too sensitive
**Cause:** Threshold too low  
**Fix:** Adjust `COORD_DELTA_THRESHOLD_KM` in `strategy-triggers.js`

---

## Next Steps

1. ✅ Apply migration (already done)
2. ✅ Restart application to load modules
3. 🔲 Integrate validation into routes (30 min)
4. 🔲 Test all three modules (15 min)
5. 🔲 Monitor audit logs in production (ongoing)
6. 🔲 Implement catalog normalization (60 min)
7. 🔲 Implement events fail-soft (30 min)

---

## Quick Reference

### Import Paths
```javascript
// Validation
import { 
  validateLocationFreshness,
  validateStrategyFreshness,
  validateWindowDuration,
  validateStrategyGeneration,
  validateStrategyDelivery,
  checkMovementInvalidation
} from './lib/validation-gates.js';

// Audit Logging
import {
  logStrategyAudit,
  logValidationFailure,
  logMovementInvalidation
} from './lib/audit-logger.js';

// Planner Prompt
import {
  RUNTIME_FRESH_PLANNER_PROMPT,
  buildRuntimeFreshContext
} from './lib/runtime-fresh-planner-prompt.js';
```

### Example Response with Validation
```json
{
  "strategy": {
    "id": "abc-123",
    "strategy": "Today is Thursday, 10/30/2025 at 6:00 PM...",
    "strategy_timestamp": "2025-10-30T18:00:00Z",
    "valid_window_start": "2025-10-30T18:00:00Z",
    "valid_window_end": "2025-10-30T19:00:00Z",
    "lat": 33.128041,
    "lng": -96.875377
  },
  "validation": {
    "location_fresh": true,
    "strategy_fresh": true,
    "window_valid": true,
    "window_expired": false
  },
  "audit": {
    "logged": true,
    "request_id": "xyz-789"
  }
}
```
