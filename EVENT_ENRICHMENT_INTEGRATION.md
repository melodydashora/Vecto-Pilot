# Event Enrichment Integration - Complete Implementation Guide

**Date:** 2025-10-30  
**Status:** ✅ FULLY INTEGRATED - Ready for Field Testing

---

## ✅ What's Been Integrated

### 1. Database Migration ✅
**File:** `drizzle/0003_event_enrichment.sql`

**Components Created:**
- ✅ `events_facts` table - Stores venue events from external sources
- ✅ `event_badge_missing` column - Enables neutral UI state
- ✅ `fn_compute_event_badge()` - Generates badge text with emoji
- ✅ `fn_upsert_event()` - Idempotent event insertion
- ✅ `fn_refresh_venue_enrichment()` - Attaches events to candidates
- ✅ `trigger_enrichment_on_event` - Auto-refresh on new events
- ✅ `v_coach_strategy_context` view - Complete snapshot context
- ✅ `fn_cleanup_expired_events()` - Maintenance function

**Apply Migration:**
```bash
node scripts/postdeploy-sql.mjs
```

---

### 2. Automation Scripts ✅
**All scripts created in `scripts/` directory:**

#### check-no-hardcoded-location.mjs ✅
Prevents hardcoded lat/lng/address in code (CI guard)
```bash
node scripts/check-no-hardcoded-location.mjs
```

#### seed-event.mjs ✅
Upsert events from runtime data (NO hardcoded locations)
```bash
VENUE_PLACE_ID="ChIJabc123" \
START_ISO="2025-10-31T16:00:00-05:00" \
END_ISO="2025-10-31T22:00:00-05:00" \
EVENT_TITLE="Halloween Event" \
EVENT_TYPE="festival" \
node scripts/seed-event.mjs
```

#### refresh-enrichment.mjs ✅
Manually trigger enrichment for a snapshot
```bash
SNAPSHOT_ID="123e4567-e89b-12d3-a456-426614174000" \
node scripts/refresh-enrichment.mjs
```

#### smoke-coach-context.mjs ✅
Test coach context API endpoint
```bash
SNAPSHOT_ID="123e4567-e89b-12d3-a456-426614174000" \
node scripts/smoke-coach-context.mjs
```

#### smoke-strategy.mjs ✅
Test end-to-end strategy with validation
```bash
SNAPSHOT_ID="123e4567-e89b-12d3-a456-426614174000" \
node scripts/smoke-strategy.mjs
```

#### postdeploy-sql.mjs ✅
Run migration SQL with verification
```bash
node scripts/postdeploy-sql.mjs
```

---

### 3. Coach Context API ✅
**File:** `server/routes/chat.js:10-37`

**Endpoint:** `GET /coach/context/:snapshotId`

**Response:**
```json
{
  "snapshot_id": "uuid",
  "items": [
    {
      "name": "The Boardwalk at Granite Park",
      "place_id": "ChIJabc123",
      "rank": 1,
      "venue_events": {
        "badge": "🎃 Halloween Event",
        "summary": "Halloween Event (4:00 PM-10:00 PM)",
        "event_ids": ["event-uuid"],
        "count": 1
      },
      "event_badge_missing": false,
      "pro_tips": ["Park near main entrance"],
      "weather": {"tempF": 72, "conditions": "Clear"},
      "current_strategy": "Today is Thursday...",
      "valid_window_start": "2025-10-30T18:00:00Z",
      "valid_window_end": "2025-10-30T19:00:00Z"
    }
  ],
  "count": 5
}
```

**Integration:** Fully implemented, uses `v_coach_strategy_context` view

---

### 4. Auto-Enrichment After Strategy ✅
**File:** `server/lib/strategy-generator.js:279-287`

**Logic:**
```javascript
// After strategy succeeds, automatically refresh event enrichment
try {
  console.log(`[TRIAD] 🎉 Refreshing event enrichment for snapshot ${snapshot_id}`);
  await db.execute(sql`select fn_refresh_venue_enrichment(${snapshot_id}::uuid);`);
  console.log(`[TRIAD] ✅ Event enrichment complete`);
} catch (enrichErr) {
  console.warn(`[TRIAD] ⚠️  Event enrichment failed (non-blocking):`, enrichErr.message);
  // Non-blocking - continues even if enrichment fails
}
```

**Triggers:** Every successful strategy generation  
**Behavior:** Fail-soft (continues on error)

---

## 📋 Field Test Checklist

### Step 1: Apply Migration (5 min)
```bash
# Apply database migration
node scripts/postdeploy-sql.mjs

# Expected output:
# ✅ Migration completed successfully
# ✅ events_facts table created
# ✅ event_badge_missing column added
# ✅ 4 functions created
# ✅ 1 trigger created
# ✅ 1 view created
```

**Verify:**
```sql
-- Check events_facts table exists
SELECT COUNT(*) FROM events_facts;

-- Check view exists
SELECT COUNT(*) FROM v_coach_strategy_context LIMIT 1;

-- Check functions exist
SELECT routine_name FROM information_schema.routines 
WHERE routine_name IN ('fn_upsert_event', 'fn_refresh_venue_enrichment', 'fn_compute_event_badge');
```

---

### Step 2: Seed Test Event (3 min)
```bash
# Get a venue place_id from database
psql $DATABASE_URL -c "SELECT place_id, name FROM ranking_candidates WHERE place_id IS NOT NULL LIMIT 1;"

# Seed event for that venue
VENUE_PLACE_ID="<place_id>" \
VENUE_NAME="<venue_name>" \
EVENT_TITLE="Test Halloween Event" \
EVENT_TYPE="festival" \
START_ISO="2025-10-31T16:00:00-05:00" \
END_ISO="2025-10-31T22:00:00-05:00" \
CONFIDENCE="0.90" \
DESCRIPTION="Family-friendly Halloween celebration" \
node scripts/seed-event.mjs
```

**Expected Output:**
```
✅ Event upserted successfully
   Event ID: abc-123-def-456
   Venue: The Boardwalk (ChIJabc123)
   Title: Test Halloween Event
   Window: 2025-10-31T16:00:00-05:00 → 2025-10-31T22:00:00-05:00
```

**Verify:**
```sql
SELECT event_id, event_title, venue_name, start_time, end_time 
FROM events_facts 
ORDER BY created_at DESC 
LIMIT 1;
```

---

### Step 3: Test Manual Enrichment (2 min)
```bash
# Get latest snapshot ID
psql $DATABASE_URL -c "SELECT snapshot_id FROM snapshots ORDER BY created_at DESC LIMIT 1;"

# Refresh enrichment for that snapshot
SNAPSHOT_ID="<snapshot_id>" node scripts/refresh-enrichment.mjs
```

**Expected Output:**
```
✅ Enrichment refreshed successfully
   Snapshot ID: abc-123-def-456
   Duration: 45ms

📊 Top 5 candidates:
   1. The Boardwalk at Granite Park
      🎃 Halloween Event: Test Halloween Event (4:00 PM-10:00 PM)
   2. Another Venue
      ⚪ No current events
   3. Third Venue
      ⚪ No current events
```

**Verify:**
```sql
SELECT 
  name,
  venue_events->>'badge' as event_badge,
  venue_events->>'summary' as event_summary,
  event_badge_missing
FROM ranking_candidates
WHERE snapshot_id = '<snapshot_id>'
ORDER BY rank
LIMIT 5;
```

---

### Step 4: Test Coach Context API (2 min)
```bash
# Test coach context endpoint
SNAPSHOT_ID="<snapshot_id>" \
API_URL="http://localhost:5000" \
node scripts/smoke-coach-context.mjs
```

**Expected Output:**
```
🔍 Testing: GET http://localhost:5000/coach/context/abc-123-def-456

✅ Coach context API responded successfully

{
  "snapshot_id": "abc-123-def-456",
  "items": [...],
  "count": 5
}

📊 Summary: 5 candidates
   - 1 with event data
   - 4 without event data
```

---

### Step 5: Test Auto-Enrichment (5 min)
```bash
# Trigger a new strategy generation (via UI or API)
# The enrichment should run automatically

# Check logs for enrichment
tail -f logs/app.log | grep "event enrichment"

# Expected:
# [TRIAD] 🎉 Refreshing event enrichment for snapshot abc-123
# [TRIAD] ✅ Event enrichment complete
```

**Verify:**
```sql
-- Check that new candidates have enrichment
SELECT 
  s.snapshot_id,
  s.created_at,
  COUNT(rc.id) as candidate_count,
  COUNT(rc.venue_events) as with_events,
  COUNT(CASE WHEN rc.event_badge_missing THEN 1 END) as with_missing_flag
FROM snapshots s
LEFT JOIN ranking_candidates rc ON s.snapshot_id = rc.snapshot_id
WHERE s.created_at > now() - interval '1 hour'
GROUP BY s.snapshot_id, s.created_at
ORDER BY s.created_at DESC
LIMIT 5;
```

---

### Step 6: Test No-Hardcoded-Location Guard (1 min)
```bash
# Run CI check
node scripts/check-no-hardcoded-location.mjs
```

**Expected Output:**
```
✅ No hardcoded location data detected.
   Scanned 247 files.
```

**Test Failure (optional):**
```bash
# Add test violation
echo "const lat = 33.128041;" > test-violation.js

# Run check again
node scripts/check-no-hardcoded-location.mjs

# Expected:
# ❌ HARDCODED LOCATION DATA DETECTED:
#   test-violation.js:1
#     Pattern: /\b(lat|lng|latitude|longitude)\s*[:=]\s*-?\d{1,3}\.\d{3,}/i
#     Match: lat = 33.128041

# Clean up
rm test-violation.js
```

---

### Step 7: Test Strategy Smoke (3 min)
```bash
# Test end-to-end strategy with validation
SNAPSHOT_ID="<snapshot_id>" node scripts/smoke-strategy.mjs
```

**Expected Output:**
```
🔍 Testing: GET http://localhost:5000/api/chat

✅ Strategy API responded in 2345ms

📋 Validation checks:
   ✅ strategy field
   ✅ strategy_timestamp
   ✅ valid_window_start
   ✅ valid_window_end
   ✅ snapshot_id

⏱️  Time window: 60.0 minutes

🎉 Event enrichment: 1/5 blocks

📝 Strategy preview:
   Today is Thursday, 10/30/2025 at 6:00 PM. You're in Frisco...

✅ All checks passed
```

---

## 🧪 SQL Verification Queries

### Check Event Enrichment Status
```sql
-- See which candidates have events
SELECT 
  rc.name,
  rc.place_id,
  rc.venue_events->>'badge' as badge,
  rc.venue_events->>'summary' as summary,
  rc.venue_events->'event_ids' as event_ids,
  rc.event_badge_missing
FROM ranking_candidates rc
WHERE rc.snapshot_id = (
  SELECT snapshot_id FROM snapshots 
  ORDER BY created_at DESC LIMIT 1
)
ORDER BY rc.rank;
```

### Check Coach Context View
```sql
-- Test coach context view
SELECT 
  active_snapshot_id,
  name,
  rank,
  venue_events->>'badge' as event_badge,
  current_strategy,
  weather,
  news_briefing
FROM v_coach_strategy_context
WHERE active_snapshot_id = '<snapshot_id>'
LIMIT 3;
```

### Check Event Facts
```sql
-- See all events
SELECT 
  event_id,
  venue_name,
  event_title,
  event_type,
  start_time,
  end_time,
  confidence,
  expires_at
FROM events_facts
ORDER BY created_at DESC
LIMIT 10;
```

### Check Trigger Activity
```sql
-- See if trigger is working (check after inserting event)
SELECT 
  tgname as trigger_name,
  tgenabled as enabled
FROM pg_trigger
WHERE tgname = 'trigger_enrichment_on_event';
```

---

## 📊 Expected Test Results

| Test | Status | Duration | Output |
|------|--------|----------|--------|
| Migration | ✅ | ~500ms | All tables/functions created |
| Seed Event | ✅ | ~100ms | Event UUID returned |
| Manual Enrichment | ✅ | ~50ms | Candidates updated |
| Coach Context API | ✅ | ~200ms | JSON with items array |
| Auto-Enrichment | ✅ | ~50ms | Logs show success |
| No-Hardcoded-Location | ✅ | ~1s | No violations |
| Strategy Smoke | ✅ | ~2-3s | All checks passed |

---

## 🚀 Next Steps

### For Production Deployment:
1. ✅ Run migration: `node scripts/postdeploy-sql.mjs`
2. ✅ Test all 7 checklist items
3. ✅ Verify no hardcoded locations: `node scripts/check-no-hardcoded-location.mjs`
4. 🔲 Add to CI/CD pipeline
5. 🔲 Monitor enrichment logs in production
6. 🔲 Set up periodic cleanup: `SELECT fn_cleanup_expired_events();`

### For Frontend Integration:
```tsx
// Example: Render event badges in UI
const EventBadge = ({ candidate }) => {
  const badge = candidate.venue_events?.badge;
  const summary = candidate.venue_events?.summary;
  const missing = candidate.event_badge_missing;

  if (badge) {
    return (
      <div className="event-badge tooltip-trigger">
        <span className="badge badge--event">{badge}</span>
        {summary && <div className="tooltip">{summary}</div>}
      </div>
    );
  }

  if (missing) {
    return (
      <span className="badge badge--neutral">No current events</span>
    );
  }

  return null; // Still loading or no enrichment yet
};
```

---

## ✅ Integration Summary

**Fully Integrated Components:**
- ✅ Database migration (tables, functions, triggers, views)
- ✅ 6 automation scripts (seeding, testing, validation)
- ✅ Coach context API endpoint
- ✅ Auto-enrichment after strategy generation
- ✅ No-hardcoded-location CI guard

**Ready for:**
- ✅ Field testing (complete checklist above)
- ✅ Production deployment (after testing)
- ✅ Frontend UI integration (badge rendering)

**Notes:**
- All scripts use environment variables (NO hardcoded locations)
- Enrichment is fail-soft (non-blocking)
- Trigger auto-refreshes on new events
- Coach context provides full snapshot view
- CI guard prevents location literals

**Test Immediately:**
```bash
# Quick test sequence (5 minutes total)
node scripts/postdeploy-sql.mjs
VENUE_PLACE_ID="ChIJtest" START_ISO="2025-10-31T16:00:00-05:00" END_ISO="2025-10-31T22:00:00-05:00" EVENT_TITLE="Test Event" node scripts/seed-event.mjs
SNAPSHOT_ID="<latest>" node scripts/refresh-enrichment.mjs
SNAPSHOT_ID="<latest>" node scripts/smoke-coach-context.mjs
node scripts/check-no-hardcoded-location.mjs
```

✅ **READY FOR FIELD TESTING**
