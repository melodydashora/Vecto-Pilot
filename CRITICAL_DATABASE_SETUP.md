# CRITICAL: Database Trigger Required for Smart Blocks

## Problem
Smart blocks (venue recommendations) won't appear in the UI without this trigger.

The frontend waits for a `blocks_ready` SSE event that is triggered when venues are inserted into the `rankings` table.

## Solution: Install in BOTH Databases

**This trigger MUST exist in:**
1. Production database (`DATABASE_URL`)
2. Development database (`DEV_DATABASE_URL`)

## Installation

Run this SQL in **BOTH** databases:

```sql
CREATE OR REPLACE FUNCTION notify_blocks_ready() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('blocks_ready', json_build_object(
    'ranking_id', NEW.ranking_id, 
    'snapshot_id', NEW.snapshot_id,
    'created_at', NEW.created_at
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_blocks_ready ON rankings;
CREATE TRIGGER trg_blocks_ready 
  AFTER INSERT ON rankings 
  FOR EACH ROW 
  EXECUTE FUNCTION notify_blocks_ready();
```

## Verification

Check trigger exists:
```sql
SELECT tgname, tgenabled 
FROM pg_trigger 
WHERE tgname = 'trg_blocks_ready';
```

Expected output:
```
   trigger_name   | enabled 
------------------+---------
 trg_blocks_ready | O
```

## Why This Matters

**Without this trigger:**
- Strategy generation completes ✅
- Venue generation completes ✅
- Database has all the data ✅
- **BUT the UI never knows** ❌
- Frontend shows "WAITING_FOR_BLOCKS_READY_EVENT" forever

**With this trigger:**
- Venues inserted → trigger fires → SSE sends `blocks_ready` → Frontend displays blocks

## Installation Commands

```bash
# Production database
psql "$DATABASE_URL" -f server/db/sql/2025-11-03_blocks_ready_notify.sql

# Dev database
psql "$DEV_DATABASE_URL" -f server/db/sql/2025-11-03_blocks_ready_notify.sql
```

## Status (as of Nov 15, 2025)

✅ Trigger installed in production database
✅ Trigger installed in dev database

**Note:** This is NOT part of Drizzle migrations. It must be manually installed in any new database.
