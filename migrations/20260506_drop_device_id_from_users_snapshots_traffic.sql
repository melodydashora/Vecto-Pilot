-- 2026-05-06: Drop device_id from waterfall e2e tables (users, snapshots, discovered_traffic).
-- Driven by:
--   1. Cross-user /resolve corruption bug — auth-keyed lookup is now the only identity path
--      (claude_memory row 318).
--   2. Auth replaces device_id as identity primitive throughout the waterfall e2e
--      (Melody's directive 2026-05-06).
-- Siri Shortcut tables (offer_intelligence, intercepted_signals) keep device_id — Siri cannot
-- send JWT tokens, so device_id remains the auth primitive only on those endpoints.
-- Plan: docs/review-queue/PLAN_remove-device-id-cross-user-fix-2026-05-06.md

BEGIN;

-- discovered_traffic: device_id was per-snapshot duplication; snapshot_id (FK with ON DELETE
-- CASCADE) is sufficient identity.
DROP INDEX IF EXISTS idx_discovered_traffic_device;
ALTER TABLE discovered_traffic DROP COLUMN IF EXISTS device_id;

-- snapshots: per-event device tracking was load-bearing only because users-table identity
-- was unreliable.
ALTER TABLE snapshots DROP COLUMN IF EXISTS device_id;

-- users: the column whose non-uniqueness enabled the cross-user lookup bug.
ALTER TABLE users DROP COLUMN IF EXISTS device_id;

COMMIT;
