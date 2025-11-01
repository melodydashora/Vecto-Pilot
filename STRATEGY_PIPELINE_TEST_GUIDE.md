# Strategy Pipeline Test Guide

## Overview
The model-agnostic strategy pipeline uses event-driven LISTEN/NOTIFY architecture with three AI providers:
1. **Minstrategy** (Claude) → `strategies.minstrategy`
2. **Briefing** (Gemini) → `strategies.briefing` (JSONB: `{events, holidays, traffic, news}`)
3. **Consolidator** (GPT-5) → `strategies.consolidated_strategy` (triggered automatically via PostgreSQL NOTIFY)

## Prerequisites

### Required Environment Variables
```bash
# AI Provider Keys
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
OPENAI_API_KEY=sk-...

# Model Selection (optional, defaults shown)
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
GEMINI_MODEL=gemini-2.5-pro
OPENAI_MODEL=gpt-5-mini

# Database
DATABASE_URL=postgresql://...
```

### Verify Database Schema
```sql
-- Check that new columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'strategies' 
AND column_name IN ('minstrategy', 'briefing', 'consolidated_strategy');

-- Check trigger exists
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_name = 'strategies_ready_trg';
```

## Testing the Pipeline

### Step 1: Get a Valid Snapshot ID

```bash
# Query for a recent snapshot
psql $DATABASE_URL -c "SELECT snapshot_id, formatted_address, city, state, created_at FROM snapshots ORDER BY created_at DESC LIMIT 5;"

# Or create a new snapshot via the app (refresh location in UI)
# Copy the snapshot_id for testing
```

### Step 2: Test Individual Providers

#### Test Claude (Minstrategy)
```bash
SNAPSHOT_ID="<your-snapshot-id>"

curl -X POST "http://localhost:5000/api/diagnostics/test-claude/${SNAPSHOT_ID}" \
  -H "Content-Type: application/json" | jq .

# Expected response:
# {
#   "ok": true,
#   "snapshot_id": "...",
#   "has_minstrategy": true,
#   "minstrategy_length": 250,
#   "minstrategy": "Consider positioning near the airport..."
# }
```

#### Test Gemini (Briefing)
```bash
curl -X POST "http://localhost:5000/api/diagnostics/test-briefing/${SNAPSHOT_ID}" \
  -H "Content-Type: application/json" | jq .

# Expected response:
# {
#   "ok": true,
#   "snapshot_id": "...",
#   "has_briefing": true,
#   "briefing": {
#     "events": ["Concert at AAC ending at 10pm"],
#     "holidays": [],
#     "traffic": ["I-35 construction northbound"],
#     "news": ["DFW Airport: 15min delays"]
#   }
# }
```

### Step 3: Check Strategy Status

```bash
curl "http://localhost:5000/api/diagnostics/strategy-status/${SNAPSHOT_ID}" | jq .

# Expected response:
# {
#   "snapshot_id": "...",
#   "has_min": true,
#   "has_briefing": true,
#   "has_consolidated": false,  # Will become true after NOTIFY triggers consolidation
#   "user_resolved_address": "123 Main St",
#   "user_resolved_city": "Dallas",
#   "user_resolved_state": "TX",
#   "status": "pending",
#   "briefing": { ... }
# }
```

### Step 4: Trigger Full Pipeline

```bash
# Start fresh strategy row and kick both providers in parallel
curl -X POST "http://localhost:5000/api/strategy/run/${SNAPSHOT_ID}" | jq .

# Expected response (202 Accepted):
# {
#   "status": "pending",
#   "snapshot_id": "...",
#   "kicked": ["minstrategy", "briefing"]
# }
```

### Step 5: Poll Until Consolidated

```bash
# Check status every 2 seconds
while true; do
  curl -s "http://localhost:5000/api/strategy/${SNAPSHOT_ID}" | jq '.status, .waitFor, .timeElapsedMs'
  sleep 2
done

# Watch for status transition: "pending" → "ok"
# waitFor should shrink: ["minstrategy", "briefing", "consolidated"] → []
```

## Monitoring LISTEN/NOTIFY

### Check Consolidation Listener Logs

```bash
# In strategy-generator.js logs, look for:
# [consolidator] 🎧 Starting LISTEN/NOTIFY consolidation listener...
# [consolidator] ✅ LISTEN mode active on: strategy_progress, strategy_ready
# [consolidator] 📬 NOTIFY received for <snapshot-id>
# [consolidator] 🎯 Ready to consolidate <snapshot-id>
# [consolidator] 🚀 Calling GPT-5 for <snapshot-id>...
# [consolidator] ✅ Consolidated <snapshot-id> (543 chars)
```

### Manual NOTIFY Test

```sql
-- Manually trigger a notification (for testing)
SELECT pg_notify('strategy_ready', '{"snapshot_id": "<your-snapshot-id>"}');

-- Check listener received it in logs:
-- [consolidator] 📬 NOTIFY received for <snapshot-id>
```

## Database Verification

### Check Field Population

```sql
SELECT 
  snapshot_id,
  (minstrategy IS NOT NULL AND minstrategy <> '') AS has_min,
  (briefing::text <> '{}'::jsonb::text) AS has_briefing,
  (consolidated_strategy IS NOT NULL AND consolidated_strategy <> '') AS has_consolidated,
  user_resolved_address,
  user_resolved_city,
  user_resolved_state,
  status,
  briefing
FROM strategies
WHERE snapshot_id = '<your-snapshot-id>';
```

### Verify Briefing Structure

```sql
-- Check briefing JSONB has all 4 keys
SELECT 
  snapshot_id,
  briefing->'events' as events,
  briefing->'holidays' as holidays,
  briefing->'traffic' as traffic,
  briefing->'news' as news
FROM strategies
WHERE snapshot_id = '<your-snapshot-id>';
```

## Expected Timeline

For a typical request:
- **T+0s**: POST /api/strategy/run/:snapshotId
- **T+0.1s**: Claude and Gemini calls start in parallel
- **T+2-5s**: Minstrategy completes → DB UPDATE → NOTIFY fires
- **T+3-6s**: Briefing completes → DB UPDATE → NOTIFY fires
- **T+6s**: Consolidator detects both ready, acquires lock
- **T+6-10s**: GPT-5 consolidation call
- **T+10s**: consolidated_strategy written, status → 'ok'

## Troubleshooting

### Consolidation Never Triggers

**Check 1: LISTEN client connected**
```bash
# Look for in strategy-generator.js logs:
# [consolidator] 🎧 Starting LISTEN/NOTIFY consolidation listener...
# [consolidator] ✅ LISTEN mode active on: strategy_progress, strategy_ready
```

**Check 2: Trigger installed**
```sql
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'strategies_ready_trg';
-- Should show: strategies_ready_trg | O (enabled)
```

**Check 3: Both fields populated**
```sql
SELECT 
  snapshot_id,
  minstrategy IS NOT NULL AND minstrategy <> '' AS has_min,
  briefing::text <> '{}'::jsonb::text AS has_briefing
FROM strategies 
WHERE snapshot_id = '<your-snapshot-id>';
-- Both should be true
```

### Empty Briefing

If `briefing = {}`:
- Check Gemini API key is set: `echo $GEMINI_API_KEY`
- Check logs for Gemini errors: `[briefing] ❌ Error`
- Verify JSON parsing didn't fail (check for parse warnings)

### Advisory Lock Conflicts

If you see: `[consolidator] ⏭️ Lock held by another worker`
- This is normal - another consolidation attempt is in progress
- Wait a few seconds for it to complete
- Check for duplicate strategy-generator.js processes: `ps aux | grep strategy-generator`

## Success Criteria

✅ **Pipeline is working correctly when:**

1. POST `/api/strategy/run/:id` returns 202 with `kicked: ["minstrategy", "briefing"]`
2. GET `/api/strategy/:id` shows `waitFor` shrinking over 5-10 seconds
3. Final GET shows:
   - `status: "ok"`
   - `waitFor: []`
   - `min` is a non-empty string
   - `briefing` has 4 keys with arrays
   - `consolidated` is a non-empty string
4. Database row has all three fields populated
5. Consolidator logs show NOTIFY → consolidation → success

## API Reference

### GET /api/strategy/:snapshotId
Returns current strategy status.

**Response:**
```json
{
  "status": "ok|pending",
  "snapshot_id": "uuid",
  "min": "Claude's strategy text",
  "briefing": {
    "events": ["..."],
    "holidays": ["..."],
    "traffic": ["..."],
    "news": ["..."]
  },
  "consolidated": "GPT-5's final strategy",
  "waitFor": [],
  "timeElapsedMs": 8543
}
```

### POST /api/strategy/run/:snapshotId
Kicks off parallel provider execution.

**Response (202):**
```json
{
  "status": "pending",
  "snapshot_id": "uuid",
  "kicked": ["minstrategy", "briefing"]
}
```

### POST /api/diagnostics/test-claude/:snapshotId
Test Claude provider in isolation.

### POST /api/diagnostics/test-briefing/:snapshotId
Test Gemini provider in isolation.

### GET /api/diagnostics/strategy-status/:snapshotId
Get detailed field-level status.
