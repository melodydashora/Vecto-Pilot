# Database Connection & Testing Guide

**Date:** 2025-10-30  
**Status:** ~~Ready for Neon Database Connection~~ **ARCHIVED** - Migrated to Replit PostgreSQL (2025-11-26)

---

## 🔑 ~~Neon~~ **Replit PostgreSQL** Database Connection

> **⚠️ Historical Documentation:** This guide was written for external Neon PostgreSQL. The system now uses Replit's managed PostgreSQL database. Database URLs are automatically provided by Replit Secrets - no manual configuration needed.

### Your Database Status
✅ **Production branch:** `br-young-dust-ahslrdre` (ready)  
✅ **Development branch:** `br-misty-pine-ahjcudc0` (ready)  
✅ **API Key:** Provided (use for Neon API validation)

### Fix DATABASE_URL Secret

**Current Issue:** `channel_binding=require` causes auth failures with Node pg stack

**Solution:** Remove channel binding parameter

**Correct Format:**
```bash
postgresql://neondb_owner:<PASSWORD>@ep-fancy-snow-ah3jjx69-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require
```

**Important:**
- ✅ Keep `?sslmode=require`
- ❌ Remove `&channel_binding=require`
- If password has special chars (`@ : / # ? & %`), URL-encode them

---

## 🧪 Connection Tests

### Test 1: psql Connection
```bash
# Should return current time
psql "$DATABASE_URL" -c "SELECT now();"
```

**Expected Output:**
```
              now              
-------------------------------
 2025-10-30 15:30:00.123456-05
(1 row)
```

### Test 2: Node pg Connection
```bash
node -e "import('pg').then(async m=>{const p=new m.Pool({connectionString:process.env.DATABASE_URL});console.log((await p.query('SELECT 1 as ok')).rows[0]);await p.end();}).catch(e=>{console.error(e.message);process.exit(1);})"
```

**Expected Output:**
```
{ ok: 1 }
```

### Test 3: Application Connection
```bash
node scripts/latest-snapshot.mjs
```

**Expected:** Outputs a snapshot UUID (or error if no snapshots exist)

---

## 🚀 Migration Sequence

### Step 1: Update DATABASE_URL
In Replit Secrets:
1. Open Secrets panel
2. Find `DATABASE_URL`
3. Update value to remove `channel_binding=require`
4. Keep `sslmode=require`

### Step 2: Verify Connection
```bash
# Test basic connectivity
psql "$DATABASE_URL" -c "SELECT now();"
```

### Step 3: Apply Migrations
```bash
# This will:
# - Check DATABASE_URL and SSL mode
# - Test connection
# - Apply all 3 migrations (0003, 0004, 0005)
# - Verify components created
node scripts/postdeploy-sql.mjs
```

**Expected Output:**
```
🔍 Database connection:
   URL present: ✅
   SSL mode: ✅ required

🔌 Testing database connection...
   ✅ Connected to: neondb
   ✅ Server time: 2025-10-30 15:30:00

🔍 Checking required extensions...
   Extensions: none yet (will be created)

⚙️  Executing migrations...

📄 drizzle/0003_event_enrichment.sql
   ✅ Completed in 245ms

📄 drizzle/0004_event_proximity.sql
   ✅ Completed in 189ms

📄 drizzle/0005_staging_nodes.sql
   ✅ Completed in 156ms

✅ All migrations processed

🔍 Verifying migration components...
   ✅ events_facts table
   ✅ event_badge_missing column
   ✅ node_type column (staging)
   ✅ v_coach_strategy_context view
   ✅ fn_upsert_event function
   ✅ fn_refresh_venue_enrichment function
   ✅ fn_haversine_distance function

✅ All migration components verified
```

### Step 4: Verify No Hardcoded Locations
```bash
node scripts/check-no-hardcoded-location.mjs
```

**Expected Output:**
```
✅ No hardcoded location data detected.
   Scanned 247 files.
```

### Step 5: Test Event Seeding (Optional)
```bash
# Get a real venue place_id from database first
psql "$DATABASE_URL" -c "SELECT place_id, name FROM ranking_candidates WHERE place_id IS NOT NULL LIMIT 1;"

# Seed test event
VENUE_PLACE_ID="<your_place_id>" \
VENUE_NAME="<venue_name>" \
COORDINATES_LAT="33.0698" \
COORDINATES_LNG="-96.8347" \
COORDINATES_SOURCE="perplexity" \
LOCATION_QUALITY="approx" \
RADIUS_HINT_M="300" \
IMPACT_HINT="high" \
EVENT_TITLE="Test Halloween Event" \
EVENT_TYPE="festival" \
START_ISO="2025-10-31T19:00:00-05:00" \
END_ISO="2025-10-31T23:00:00-05:00" \
node scripts/seed-event.mjs
```

### Step 6: Test Enrichment
```bash
# Get latest snapshot
SNAPSHOT_ID=$(node scripts/latest-snapshot.mjs)

# Refresh enrichment for that snapshot
SNAPSHOT_ID=$SNAPSHOT_ID node scripts/refresh-enrichment.mjs
```

### Step 7: Test Coach Context API
```bash
# Test coach context endpoint
SNAPSHOT_ID=$(node scripts/latest-snapshot.mjs)
SNAPSHOT_ID=$SNAPSHOT_ID node scripts/smoke-coach-context.mjs
```

---

## 🐛 Troubleshooting

### Error: "password authentication failed"
**Cause:** `channel_binding=require` in DATABASE_URL  
**Fix:** Remove `&channel_binding=require` from connection string

### Error: "no pg_hba.conf entry for host"
**Cause:** Missing `sslmode=require`  
**Fix:** Ensure `?sslmode=require` is in connection string

### Error: "function gen_random_uuid() does not exist"
**Cause:** pgcrypto extension not installed  
**Fix:** Migration 0003 includes `CREATE EXTENSION IF NOT EXISTS pgcrypto;`  
**Verify:** `psql "$DATABASE_URL" -c "SELECT extname FROM pg_extension WHERE extname='pgcrypto';"`

### Error: "relation events_facts does not exist"
**Cause:** Migration not applied  
**Fix:** Run `node scripts/postdeploy-sql.mjs`

### Error: "SNAPSHOT_ID required"
**Cause:** No snapshots in database  
**Fix:** Create a snapshot via the application first, then retry

### Error: "EISDIR: illegal operation on a directory"
**Cause:** Old version of check-no-hardcoded-location script  
**Fix:** Updated script now includes `nodir: true` and skip directory checks

---

## 📊 Verification Queries

### Check Extensions
```sql
SELECT extname, extversion 
FROM pg_extension 
WHERE extname IN ('pgcrypto', 'pg_trgm');
```

### Check Tables
```sql
SELECT tablename 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('events_facts', 'ranking_candidates', 'snapshots', 'strategies');
```

### Check Functions
```sql
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_name LIKE 'fn_%'
ORDER BY routine_name;
```

### Check Views
```sql
SELECT table_name 
FROM information_schema.views 
WHERE table_schema = 'public' 
  AND table_name = 'v_coach_strategy_context';
```

### Check Event Enrichment
```sql
-- See if enrichment is working
SELECT 
  COUNT(*) FILTER (WHERE venue_events IS NOT NULL) as with_events,
  COUNT(*) FILTER (WHERE event_badge_missing = true) as no_events,
  COUNT(*) FILTER (WHERE venue_events IS NULL AND event_badge_missing = false) as not_enriched,
  COUNT(*) as total
FROM ranking_candidates
WHERE snapshot_id = (SELECT snapshot_id FROM snapshots ORDER BY created_at DESC LIMIT 1);
```

### Check Staging Nodes
```sql
-- See staging node classification
SELECT 
  node_type,
  access_status,
  COUNT(*) as count
FROM ranking_candidates
WHERE snapshot_id = (SELECT snapshot_id FROM snapshots ORDER BY created_at DESC LIMIT 1)
GROUP BY node_type, access_status;
```

---

## ✅ Success Checklist

**Connection:**
- [ ] `psql "$DATABASE_URL" -c "select now();"` returns timestamp
- [ ] No "password authentication failed" errors
- [ ] SSL mode verified (shows ✅ required in postdeploy output)

**Migrations:**
- [ ] All 3 migrations completed without errors
- [ ] pgcrypto extension installed
- [ ] events_facts table exists
- [ ] node_type, access_status columns exist
- [ ] fn_haversine_distance function exists
- [ ] v_coach_strategy_context view exists

**Integration:**
- [ ] No hardcoded locations detected
- [ ] Event seeding works
- [ ] Enrichment adds venue_events to candidates
- [ ] Coach context API responds
- [ ] Staging nodes auto-classified

---

## 🔐 Using Your Neon API Key

You provided API key: `napi_d7qm31n9uz88x7zxjrclnw36dw858t0d77eb1ninurt31ywmov6qbxoxjbskj2sr`

**Use this to validate schema externally:**
```bash
# List branches
curl -H "Authorization: Bearer napi_d7qm31n9uz88x7zxjrclnw36dw858t0d77eb1ninurt31ywmov6qbxoxjbskj2sr" \
  https://console.neon.tech/api/v2/projects/<project_id>/branches

# Get connection string for a branch
curl -H "Authorization: Bearer napi_d7qm31n9uz88x7zxjrclnw36dw858t0d77eb1ninurt31ywmov6qbxoxjbskj2sr" \
  https://console.neon.tech/api/v2/projects/<project_id>/branches/<branch_id>/connection_uri
```

**Never commit this key to code** - Store in Replit Secrets as `NEON_API_KEY` if needed.

---

## 🎯 Next Steps After Connection Success

1. **Test Event Proximity:** Seed events with coordinates, verify proximity matching
2. **Test Staging Nodes:** Check that entrances don't show "Closed"
3. **Frontend Integration:** Render event badges and staging indicators
4. **Monitoring:** Set up alerts for enrichment failures
5. **Production:** Deploy with confidence!

**All integration complete - ready for testing!** 🚀
