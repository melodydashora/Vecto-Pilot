# AI Coach Data Access Layer (DAL)

**File:** `server/lib/ai/coach-dal.js`

The `CoachDAL` class serves as the central data access point for the AI Coach, providing read/write access to the full application schema. It ensures all data retrieval is scoped to a specific user and snapshot for temporal consistency.

## Schema Imports

The DAL imports the following schema definitions from `shared/schema.js` to build context:

*   **Core:** `snapshots`, `strategies`, `users`, `actions`
*   **Feedback:** `venue_feedback`, `strategy_feedback`
*   **Intelligence:** `market_intelligence`, `user_intel_notes`, `zone_intelligence`
*   **Offer Analytics:** `offer_intelligence` (Replaced `intercepted_signals` on 2026-02-17 for structured offer analytics)
*   **Context:** `briefings`, `venue_catalog`, `venue_metrics`, `discovered_events`
*   **System:** `coach_conversations`, `coach_system_notes`, `news_deactivations`
*   **Platform:** `platform_data`, `driver_profiles`, `driver_vehicles`

## Core Methods

### `resolveStrategyToSnapshot(strategyId)`

Resolves a UI-facing `strategy_id` to the internal `snapshot_id` and `user_id`.

*   **Query:** Selects from `strategies` table using `id`.
*   **Changes:**
    *   *2026-01-14:* Updated to query `id` column (primary key) as the legacy `strategy_id` column was dropped.
*   **Returns:** Object `{ snapshot_id, user_id, session_id, strategy_id }` or `null`.

### `getHeaderSnapshot(snapshotId)`

Retrieves the "header" context for a session, establishing the ground truth for time, location, and environmental conditions.

*   **Source:** `snapshots` table (Authoritative).
*   **Fields:**
    *   **Time:** `dow`, `hour`, `day_part_key`, `timezone`.
    *   **Location:** `lat`, `lng`, `city`, `state`, `formatted_address`.
    *   **Conditions:** `weather`, `air`.
*   **Changes:**
    *   *2026-01-14:* `airport_context` removed (data now located in `briefings.airport_conditions`).
    *   *2026-01-10:* Clarified that location data is pulled from `snapshots`, not `users`, to ensure historical accuracy.
*   **Note:** `timezone` is strictly required for accurate Coach context; no fallback is provided if missing.