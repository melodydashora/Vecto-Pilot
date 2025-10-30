# 🚀 Quick Test Guide - Event Enrichment & Runtime-Fresh

**Ready to test immediately** - All components integrated and documented

---

## ✅ What's Ready

1. **Runtime-Fresh Validation** - Time windowing, movement detection, freshness gates
2. **Event Enrichment** - Database tables, functions, triggers, auto-refresh
3. **Coach Context API** - Snapshot-wide context endpoint
4. **No-Hardcoded-Location** - CI guard prevents location literals
5. **Automation Scripts** - Seeding, testing, smoke tests

---

## 🎯 30-Second Quick Test

```bash
# 1. Apply migration (one time)
node scripts/postdeploy-sql.mjs

# 2. Check for hardcoded locations
node scripts/check-no-hardcoded-location.mjs

# 3. Done! System is ready.
```

**Expected Output:**
```
✅ Migration completed successfully
✅ All migration components verified
✅ No hardcoded location data detected.
   Scanned 247 files.
```

---

## 📋 Full Test Sequence (5 Minutes)

### Step 1: Apply Migration
```bash
node scripts/postdeploy-sql.mjs
```

**Look for:**
- ✅ Migration completed successfully
- ✅ events_facts table
- ✅ event_badge_missing column
- ✅ 4 functions created
- ✅ 1 trigger created
- ✅ 1 view created

---

### Step 2: Get Test Data
```bash
# Get latest snapshot ID
psql $DATABASE_URL -c "SELECT snapshot_id FROM snapshots ORDER BY created_at DESC LIMIT 1;"

# Get a venue place_id
psql $DATABASE_URL -c "SELECT place_id, name FROM ranking_candidates WHERE place_id IS NOT NULL LIMIT 1;"
```

**Save these values** - you'll need them for next steps.

---

### Step 3: Seed Test Event
```bash
# Replace values with your test data
VENUE_PLACE_ID="<your_place_id>" \
VENUE_NAME="<your_venue_name>" \
EVENT_TITLE="Test Halloween Event" \
EVENT_TYPE="festival" \
START_ISO="2025-10-31T16:00:00-05:00" \
END_ISO="2025-10-31T22:00:00-05:00" \
node scripts/seed-event.mjs
```

**Expected:**
```
✅ Event upserted successfully
   Event ID: abc-123-def-456
   Venue: Your Venue Name
   Title: Test Halloween Event
```

---

### Step 4: Refresh Enrichment
```bash
# Use your snapshot ID
SNAPSHOT_ID="<your_snapshot_id>" \
node scripts/refresh-enrichment.mjs
```

**Expected:**
```
✅ Enrichment refreshed successfully
   Duration: 45ms

📊 Top 5 candidates:
   1. Your Venue Name
      🎃 Halloween Event: Test Halloween Event (4:00 PM-10:00 PM)
   2. Other Venue
      ⚪ No current events
```

---

### Step 5: Test Coach API
```bash
SNAPSHOT_ID="<your_snapshot_id>" \
node scripts/smoke-coach-context.mjs
```

**Expected:**
```
✅ Coach context API responded successfully
📊 Summary: 5 candidates
   - 1 with event data
   - 4 without event data
```

---

### Step 6: CI Guard Check
```bash
node scripts/check-no-hardcoded-location.mjs
```

**Expected:**
```
✅ No hardcoded location data detected.
   Scanned 247 files.
```

---

## 🔍 Verify Integration

### Check Database
```sql
-- See your test event
SELECT event_title, venue_name, start_time, end_time 
FROM events_facts 
ORDER BY created_at DESC LIMIT 1;

-- See enriched candidates
SELECT 
  name,
  venue_events->>'badge' as badge,
  event_badge_missing
FROM ranking_candidates
WHERE snapshot_id = '<your_snapshot_id>'
ORDER BY rank
LIMIT 5;

-- Test coach context view
SELECT COUNT(*) 
FROM v_coach_strategy_context 
WHERE active_snapshot_id = '<your_snapshot_id>';
```

---

### Check API Endpoint
```bash
# Test coach context directly
curl http://localhost:5000/coach/context/<your_snapshot_id> | jq
```

**Expected:**
```json
{
  "snapshot_id": "abc-123",
  "items": [
    {
      "name": "Your Venue",
      "venue_events": {
        "badge": "🎃 Halloween Event",
        "summary": "Test Halloween Event (4:00 PM-10:00 PM)"
      },
      "event_badge_missing": false
    }
  ],
  "count": 5
}
```

---

## 📝 Available Scripts

**All scripts support runtime data only** (NO hardcoded locations)

| Script | Purpose | Required Env Vars |
|--------|---------|-------------------|
| `postdeploy-sql.mjs` | Apply migration | None |
| `check-no-hardcoded-location.mjs` | CI guard | None |
| `seed-event.mjs` | Insert event | `VENUE_PLACE_ID`, `START_ISO`, `END_ISO` |
| `refresh-enrichment.mjs` | Manual refresh | `SNAPSHOT_ID` |
| `smoke-coach-context.mjs` | Test coach API | `SNAPSHOT_ID` |
| `smoke-strategy.mjs` | Test strategy | `SNAPSHOT_ID` |

---

## 🎯 Testing Checklist

Copy this and check off as you complete:

- [ ] Migration applied successfully
- [ ] events_facts table exists
- [ ] v_coach_strategy_context view exists
- [ ] Test event inserted
- [ ] Enrichment refreshed
- [ ] Event badge appears in candidates
- [ ] Coach context API responds
- [ ] No hardcoded locations detected
- [ ] Auto-enrichment triggers after strategy
- [ ] Frontend displays event badges (if UI ready)

---

## 🚨 Common Issues

### Issue: Migration fails with "permission denied"
**Fix:** Use DATABASE_URL environment variable
```bash
export DATABASE_URL="postgresql://user:pass@host/db"
node scripts/postdeploy-sql.mjs
```

### Issue: "function fn_refresh_venue_enrichment does not exist"
**Fix:** Migration not applied yet
```bash
node scripts/postdeploy-sql.mjs
```

### Issue: "No hardcoded location check fails"
**Fix:** You have location literals in code - check the error output for file locations

### Issue: "SNAPSHOT_ID required"
**Fix:** Get latest snapshot ID from database
```bash
psql $DATABASE_URL -c "SELECT snapshot_id FROM snapshots ORDER BY created_at DESC LIMIT 1;"
```

### Issue: Coach context returns empty items array
**Fix:** No candidates exist for that snapshot
```sql
SELECT COUNT(*) FROM ranking_candidates WHERE snapshot_id = '<your_id>';
```

---

## ✅ Success Criteria

**You know it's working when:**

1. ✅ Migration runs without errors
2. ✅ Test event inserts successfully
3. ✅ Enrichment adds badges to candidates
4. ✅ Coach API returns snapshot context
5. ✅ No hardcoded locations in codebase
6. ✅ Auto-enrichment triggers after strategy
7. ✅ Logs show: `[TRIAD] ✅ Event enrichment complete`

---

## 📊 Expected Log Output

**During strategy generation:**
```
[TRIAD 1/3 - Claude Opus] Starting strategy generation for snapshot abc-123
[TRIAD 2/3 - Gemini] Skipping news briefing (not available)
[TRIAD 3/3 - GPT-5] Consolidating Claude strategy
[TRIAD] ✅ Three-stage pipeline complete
[TRIAD] 🎉 Refreshing event enrichment for snapshot abc-123
[TRIAD] ✅ Event enrichment complete
[triad] pipeline.ok id=abc-123 total_ms=2340 tokens=1250
```

---

## 📖 Documentation Reference

- **Full Integration Guide:** `EVENT_ENRICHMENT_INTEGRATION.md`
- **Runtime-Fresh Spec:** `RUNTIME_FRESH_IMPLEMENTATION.md`
- **Field Test Checklist:** `FIELD_TEST_READY.md`
- **Integration Examples:** `INTEGRATION_GUIDE.md`

---

## 🚀 Next Steps

### After Testing:
1. ✅ All tests pass
2. 🔲 Integrate event badges in frontend UI
3. 🔲 Set up periodic cleanup: `SELECT fn_cleanup_expired_events();`
4. 🔲 Add to CI/CD pipeline
5. 🔲 Monitor enrichment in production

### For Production:
- Add `node scripts/check-no-hardcoded-location.mjs` to CI
- Schedule cleanup cron: `*/30 * * * * psql $DATABASE_URL -c "SELECT fn_cleanup_expired_events();"`
- Monitor logs for enrichment failures
- Set up alerts for expired events

---

## ✅ READY TO TEST

**Minimum test (30 seconds):**
```bash
node scripts/postdeploy-sql.mjs && node scripts/check-no-hardcoded-location.mjs
```

**Full test (5 minutes):**
Follow Step 1-6 above

**Everything is integrated and documented.** 🎉
