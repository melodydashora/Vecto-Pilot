# September 29, 2026 — admitted snapshot collection

Provenance: Codex/Astra. P1 requires explicit Continue, fresh providers, preserved precision and historical snapshots. The three portal writers now share one collector. Removed cache reuse, caller-selected session IDs and destructive refresh commentary is preserved below; this is historical source text, not current guidance. Address parsing helpers moved to geocode.js.

```text
// ═══════════════════════════════════════════════════════════════════════════
// POST /api/location/release-snapshot - Null current_snapshot_id immediately
// 2026-02-17: Called by refresh spindle BEFORE fetching GPS.
// Ensures the old snapshot is fully released so the waterfall resets cleanly.
// Matches logout behavior (session_id stays intact, only snapshot is released).
// ═══════════════════════════════════════════════════════════════════════════
/**
 * GET /api/location/resolve
 * Resolves GPS coordinates to formatted address and timezone in a single call
 *
 * Query Parameters:
 *   - lat (number, required): Latitude coordinate
 *   - lng (number, required): Longitude coordinate
 *   - accuracy (number, optional): GPS accuracy radius in meters
 *   - session_id (string, optional): Session identifier for telemetry
 *   - coord_source (string, optional): Source of coordinates (default: "gps")
 *
 * Returns:
 *   - city, state, country: Resolved address components
 *   - formattedAddress: Full street address from Google Geocoding API
 *   - timeZone: IANA timezone identifier
 *   - user_id: UUID of the authenticated user record in users table
 *
 * Side Effects:
 *   - Creates or updates user record (keyed on req.auth.userId) with rich telemetry
 *   - Validates formatted_address is not null before database write
 *   - Throws 502 error if address resolution fails (prevents bad data)
 *
 * Data Quality:
 *   - Captures accuracy_m, session_id, coord_source for density analysis
 *   - Computes local time context (dow, hour, day_part) in user's timezone
 *   - Single source of truth for driver location (replaces legacy methods)
 */
    // 2026-02-01: Validate coordinate ranges
    // 2026-02-01: Warn about suspicious coordinates (might be GPS error)
    // 2026-01-09: P0-2 FIX - NO FALLBACKS - Require Google Maps API key
    // Previous code returned fabricated data with server timezone - this poisons downstream
    // ═══════════════════════════════════════════════════════════════════════════
    // COORDS CACHE: Check if we've resolved these EXACT coordinates before
    // 6-decimal precision (~11cm) - only cache hits for identical locations
    // Each driver gets precise tracking for density analysis and historical data
    // ═══════════════════════════════════════════════════════════════════════════
      // CACHE HIT: Use cached geocode/timezone data, skip API calls
      // 2026-02-01: STRICT VALIDATION - No partial cache entries allowed
      // Rule: Cache MUST have timezone, city, state, AND formatted_address
        // Increment hit count (fire and forget)
      // CACHE MISS: Call Geocode API first, then check markets for timezone fast-path
      // Step 1: Get city/state from Geocode API (always needed)
      // Extract location data from geocode response
      // Use Plus Code filtering to prefer street addresses over Plus Codes
        // 2026-02-01: FAIL HARD if no results even though status is OK
        // 2026-02-01: DEBUG - Log what was extracted to diagnose geocode_incomplete errors
        // 2026-02-01: STRICT VALIDATION - No partial state allowed
        // Rule: coords → formatted_address (MUST) → city, state (MUST)
        // If ANY required field is missing, FAIL HARD immediately
        // 2026-02-01: FAIL HARD - Return error instead of continuing with undefined values
          // Common statuses: ZERO_RESULTS, OVER_QUERY_LIMIT, REQUEST_DENIED, INVALID_REQUEST
      // Step 2: Timezone resolution — ALWAYS GPS coords → Google Timezone API
      // (2026-07-06, Melody). The old "fast path" took the timezone from the
      // markets table by city name; a market's blanket timezone is wrong near
      // zone borders (Indiana splits Central/Eastern by county). The markets
      // table is for market IDENTITY (snapshot linkage below), never for time.
          // 2026-01-06: NO FALLBACKS - Return error instead of server timezone
      // ═══════════════════════════════════════════════════════════════════════════
      // STORE IN CACHE: Save resolved data for future lookups (6-decimal precision)
      // All 5 fields must be present: city, state, country, formatted_address, timezone
      // ═══════════════════════════════════════════════════════════════════════════
    // 2026-02-01: FAIL HARD - city and state are required for downstream operations
    // If geocode failed to extract these, return error instead of undefined values
    // ═══════════════════════════════════════════════════════════════════════════
    // COORDS CACHE VALIDATION: Ensure consistency between cache and resolved values
    // If cache has data, prefer cached values for consistency across requests
    // ═══════════════════════════════════════════════════════════════════════════
          // Use cache value for consistency
      // Update resolvedData with cache-validated values
        // NO FALLBACK - timezone is required for accurate time calculations
        // 2026-07-06: shared/dayparts.js adapter — the old toLocaleString
        // round-trip re-parse was implementation-defined (NaN hour on parse
        // failure silently classified as 'evening').
        // ═══════════════════════════════════════════════════════════════════════════
        // SNAPSHOT REUSE: One snapshot per authenticated session
        //
        // Rules:
        //   - User authenticates + accepts GPS → ONE snapshot created
        //   - GPS drift / re-renders → return SAME snapshot (no duplicates)
        //   - Manual refresh (force=true) → create new snapshot
        //   - 60 min session timeout → sign out, next login creates new
        //
        // The snapshot persists in users.current_snapshot_id until:
        //   - User manually refreshes (force=true)
        //   - User logs out (auth clears)
        //   - Session expires (60 min)
        // ═══════════════════════════════════════════════════════════════════════════
        // 2026-02-17: FIX - On force refresh, release old snapshot FIRST
        // This triggers a clean waterfall: null → new snapshot → new briefing → new strategy
        // Previous behavior was atomic swap (old → new) which skipped the release step
        // If user already has a snapshot and this isn't a forced refresh → check age and maybe reuse
        // 2026-01-14: FIX - Must check snapshot age! Previous code reused 6-day-old snapshots!
          // Query the snapshot to check its age AND city before reusing
          // 2026-01-31: FIX - Also check if city changed (user moved to different city)
          // 2026-09-10 (security finding [12], verified): a pointer at another user's snapshot
          // must not be reused — bind the read to the caller; a foreign pointer falls through
          // to the "not found — creating fresh" branch, which also self-heals it.
            // 2026-01-31: FIX - Check if city changed (case-insensitive comparison)
            // User moving from Frisco to Dallas should get fresh snapshot + briefing
              // City changed - must create new snapshot for fresh briefing data
              // Snapshot is fresh AND same city - reuse it
              // Return existing - no new snapshot needed
              // Snapshot is stale - log and create new
            // Snapshot not found in DB (orphaned reference) - create new
        // ═══════════════════════════════════════════════════════════════════════════
        // CREATE SNAPSHOT: Only if no valid recent snapshot exists
        // ═══════════════════════════════════════════════════════════════════════════
          // Calculate date in user's timezone - NO FALLBACK
          // 2026-05-12 (D-107 FIX): snapshot.market is location-derived, not identity-derived.
          // Drivers are mobile — a Dallas-based driver in NYC must see NYC market data, not DFW.
          // Resolve from GPS-derived (city, state) first; fall back to profile only if coord
          // resolution genuinely fails. driver_profiles.market is preserved as the driver's
          // "first known market" (identity, stable); snapshot.market is per-trip (location, mobile).
          //
          // Was: `select({ market }) from driver_profiles` ran first and "won" if profile had any
          // market, leaking DFW market into NYC/SF/Chicago snapshots. Real-world impact:
          // Melody drove across 6 states in 2 days and saw DFW Rideshare News throughout.
          // See docs/review-queue/PLAN_snapshot-market-gps-derived-2026-05-12.md.
              // PATH 1 (preferred): resolve market from current snapshot's GPS-resolved
              // (city, state). 2026-07-06: this lookup is for market IDENTITY only —
              // the snapshot's timezone always comes from the Google Timezone API above.
                // First-snapshot backfill: if profile.market is still NULL (Google OAuth signup
                // path), persist this as the driver's "first known market". Later snapshots in
                // different markets will NOT overwrite the profile — profile is identity.
                  // 2026-08-11: home_timezone from the GPS→Google-resolved timeZone
                  // (in scope, guarded non-null above), NOT the market's blanket
                  // timezone — gps-only-timezone doctrine. The market row supplies
                  // IDENTITY (market_name) only.
                // Unknown GPS-derived market stays unresolved; a home market would
                // scope live intelligence to the wrong place. The readiness gate reports it.
              // Non-fatal: market is optional enhancement for event/news discovery scope
          // 2026-07-06 (Melody): holiday detection moved to the briefing
          // pipeline (pipelines/holiday.js) — the snapshot stays purely
          // deterministic (GPS → Google APIs), so a model outage can never
          // block snapshot creation/login. The briefing receives the COMPLETE
          // snapshot row per the waterfall rule.
          // Create snapshot with location identity from users table
            // Location coordinates
            // FK to coords_cache for location identity
            // LEGACY: Location identity (kept for backward compat)
            // 2026-02-01: Market from driver_profiles (for market-wide event discovery)
            // Time context (calculated fresh)
            // 2026-02-17: FIX - was storing UTC, must store driver's local time
            // H3 geohash for density analysis
            // Weather/air will be enriched by client or separate call
            // Device info
          // Validate all required fields are present before INSERT (schema has NOT NULL constraints)
          // Publish the session pointer only with a successfully persisted snapshot.
          // Add snapshot_id to response. Holiday is NOT here anymore — the
          // header reads it from the briefing (briefings.holiday section).
          // 2026-01-15: FAIL HARD - Snapshot is NOT optional
          // If snapshot creation fails, the entire request must fail
          // The UI depends on snapshot_id to function - partial responses break downstream
        // 2026-01-15: FAIL HARD - User location save is NOT optional
        // If we can't save the user/location data, the session is broken
    // Always explicitly set JSON content-type to prevent HTML leaks
    // Always set JSON content-type to prevent HTML leaks on error
// POST /api/location/snapshot
// Save a context snapshot for ML/analytics (SnapshotV1 format)
// Supports minimal mode: if only lat/lng provided, resolves city/timezone server-side
  // Import ndjson and getAgentState
  // Check if agent is degraded
    // Minimal mode support for curl/preflight tests
      // Validate coordinate ranges
      // Validate userId is a valid UUID or null/undefined
      // CRITICAL: Call resolver logic directly instead of making internal HTTP request
      // Internal HTTP requests can cause deadlocks when middleware is blocking
        // Get city/timezone from Google Geocoding API directly
        // Get timezone
        // NO FALLBACK - timezone must come from Google API
      // Build minimal SnapshotV1 with resolved data
      // Add time context via the shared/dayparts.js adapter.
      // 2026-07-06: the previous inline `hour12: false` extraction stored
      // hour=24 and day_part 'evening' for the 12:00-12:59 AM hour on Node
      // <=21 (V8 h24 hourCycle); getLocalHour uses hourCycle 'h23' + guards.
        // 2026-02-17: FIX - was storing UTC ISO, must store driver's local time
      // 2026-01-05: Users table no longer stores location data (simplified session architecture)
      // Location must be resolved from GPS via Google APIs - NO FALLBACKS
      // Full V1 callers must resolve the exact six-decimal coordinate first.
      // Client labels cannot substitute for the server's saved Google resolution.
    // Creation time is the server write context. Browser timestamps and supplied
    // weather/air are never accepted as evidence of a fresh provider observation.
    // Calculate H3 geohash at resolution 8 (~0.46 km² hexagons)
    // Fetch airport context (holiday detection moved to the briefing pipeline
    // 2026-07-06 — pipelines/holiday.js runs with the COMPLETE snapshot row)
    // 2026-07-06 (todo #22): deterministic airport selection — airports table
    // (Google-seeded coords) at the ONE canonical radius. Replaces the
    // hardcoded 20-airport list at a divergent 25-mile radius.
      // Airport detection
          // Issue #29 Fix: Preserve basic airport proximity even when FAA API fails
    // Airport context stays lenient — "no nearby airport" is a truthful absence.
    // NOTE: Briefing data is now stored in separate 'briefings' table (generated via blocks-fast pipeline)
    // Transform SnapshotV1 to Postgres schema
    // Helper to safely parse dates, returning null for invalid dates
    // Calculate "today" in the driver's local timezone (not server timezone)
    // This ensures Hawaii, Alaska, etc. get the correct date
    // NO FALLBACK - timezone is required for accurate date calculation
    // Calculate coord_key from coordinates for coords_cache lookup
      // FIX: Use authenticated user_id from session, not client-sent field (was silently undefined)
      // Location coordinates
      // FK to coords_cache for location identity
      // LEGACY: Location data (kept for backward compat)
      // Time context from server creation time and coordinate-resolved timezone
      // Environment is fetched server-side by the owned enrichment route.
      // Even a full V1 body cannot smuggle ready weather/air into the pipeline.
      // 2026-01-14: airport_context dropped - now stored in briefings.airport_conditions
      // 2026-07-06: holiday dropped - now stored in briefings.holiday (pipelines/holiday.js)
    // ═══════════════════════════════════════════════════════════════════════════
    // SELF-CONTAINED VALIDATION: Verify snapshot has complete location identity
    // Users table = source of truth. Snapshot must have ALL resolved fields.
    // ═══════════════════════════════════════════════════════════════════════════
    // GPS coordinates (required)
    // Resolved location identity (from users table)
    // Time context (required for AI models)
    // Save to Replit PostgreSQL using Drizzle ORM
    // Uses DATABASE_URL automatically injected by Replit for both dev and production
    // 2026-01-14: airport_context moved to briefings.airport_conditions
      // Validate all required fields are present before INSERT (schema has NOT NULL constraints)
      // 2026-01-05: Session Architecture - Link snapshot to user's session
      // This updates current_snapshot_id and extends the sliding window TTL
      // 2026-04-14 (Memory #108): Multi-source user_id resolution + FAIL-LOUD fallback.
      // Previously only checked snapshotV1.userId (camelCase) which never matched the
      // client's user_id (snake_case). Now tries all known sources and logs loudly if none resolve.
      // 2026-09-10 (security finding [12], verified): the client-supplied userId/user_id were
      // consulted FIRST, so a body value could move another user's current_snapshot_id (and bump
      // their sliding-window clock). The token is the only identity source.
            // User not found in users table - session may have expired
          // Non-blocking - log but don't fail the snapshot
    // Log travel disruptions for airports with delays (non-blocking)
    // 2026-09-11 (Astra FAA chain finding 2): log a disruption only when one is actually
    // observed — a listed delay, positive minutes, or a real restriction — never for
    // closure_status 'unknown'; unknown minutes stay null instead of becoming 0.
          // 2026-04-05: Global app fix — derive country from snapshot, not hardcoded 'US'
    // Convert dow to day name
    // Format date from local_iso
    // REMOVED: Strategy row creation - strategy-generator-parallel.js creates the SINGLE strategy row
    // The strategy generator will fetch all enriched data from the complete snapshot row
    // This ensures: 1) No race conditions, 2) model_name preserved, 3) Full snapshot context available
    // Call parallel providers directly instead of enqueueing job
    // NOTE: Strategy pipeline is triggered by blocks-fast POST endpoint (not here)
    // This prevents race conditions between two parallel triggers
    // blocks-fast ensures: 1) Briefing completes before consolidation
    //                      2) Proper fail-fast if briefing fails
    //                      3) Single pipeline execution path
// POST /api/location/news-briefing
// Generate local news briefing for rideshare drivers
    // 2026-04-05: Global app fix — accept country from client instead of hardcoding 'United States'
    // Create snapshot-like object for Gemini briefing
      // 2026-01-14: airport_context now in briefings.airport_conditions
    // Generate news briefing using briefing-service
      // 2026-04-05: Global app fix — use client-provided country, not hardcoded 'United States'
// 2026-02-17: getDayPartKey moved to server/lib/location/daypart.js (shared module)
// 2026-02-17: FIX - local_iso must store driver's wall-clock time, NOT UTC
// For `timestamp without timezone` columns, Drizzle serializes Date via .toISOString() (UTC).
// We create a Date whose UTC value matches the local wall-clock time so Postgres stores local time.
// 2026-01-14: validateSnapshotFields moved to shared module (server/util/validate-snapshot.js)
// Import above: import { validateSnapshotFields } from '../../util/validate-snapshot.js';
// 2026-02-17: lookupMarketTimezone extracted to shared module
// import { resolveTimezoneFromMarket } from '../../lib/location/resolveTimezone.js';
// 2026-01-14: validateSnapshotFields moved to shared module (server/util/validate-snapshot.js)
// Import above: import { validateSnapshotFields } from "../../util/validate-snapshot.js";
// 2026-03-17: SECURITY FIX (F-8) — Require authentication for snapshot creation.
// Previously unauthenticated, allowing anyone to create snapshots with arbitrary data.
    // Direct extraction from request body
    // ═══════════════════════════════════════════════════════════════════════════
    // LOCATION RESOLUTION: Get resolved address from coords_cache
    // 2026-01-10: Fixed comment - users table has NO location data (per SAVE-IMPORTANT.md)
    // Location authority is in snapshots table; coords_cache is fallback for resolution
    // NEVER send raw coords to strategists - they can't reverse geocode
    // ═══════════════════════════════════════════════════════════════════════════
    // Bind every location field to this exact resolved coordinate key. Client
    // labels, home market, or an earlier snapshot cannot change its identity.
      // This lookup supplies market identity only; timezone stays GPS-resolved.
    // 2026-07-06: holiday detection moved to the briefing pipeline
    // (pipelines/holiday.js) — it runs with the COMPLETE snapshot row and a
    // model outage degrades the briefing with a recorded reason instead of
    // failing snapshot creation. The snapshot stays purely deterministic.
      // 2026-09-10 (found while verifying VP-007): this authenticated route wrote NULL-owned
      // rows, which the central ownership policy then rejects for everyone (orphans).
      // Location coordinates
      // FK to coords_cache for location identity
      // Resolved address (source of truth from coords_cache)
      // Time context
      // API data
    // 2026-04-28: pre-INSERT snapshot dump demoted to debug (memory 230 — chain
    // + snapshot ID locate the row; this object dump was repeating city/lat/lng
    // info already in the snapshot itself).
    // Validate all required fields are present before INSERT (schema has NOT NULL constraints)
    // Insert to DB
    // 2026-09-10 (VP-007 / Astra P5b): precise lat/lng, the full address and the 6-decimal
    // coord_key no longer go to the normal log — agreement §15.8 (location payloads
    // become purpose clauses, not raw output). The row itself keeps the precision.
    // REMOVED: Placeholder strategy creation - strategy-generator-parallel.js creates the SINGLE strategy row
    // This prevents race conditions and ensures model_name attribution is preserved
    // Generate briefing data BEFORE responding (so data is ready when frontend queries)
      // Pass the validated DB record itself (2026-09-10, VP-013 / Astra P1): the
      // former hand-built `fullSnapshot` literal used `hour || null` / `dow || null`,
      // which turned a stored midnight (hour 0) and Sunday (dow 0) into null on the
      // briefing handoff while the row kept the real value. One representation now —
      // the same object that passed validateSnapshotFields() and was inserted.
// ═══════════════════════════════════════════════════════════════════════════
// POST /api/snapshot/drop
// 2026-05-05: Drop the user's current snapshot (DELETE the row + null the pointer).
// Called by manual refresh and (in a follow-up) by logout. The DELETE cascades to
// briefings, events, traffic, ranking_candidates, etc. via onDelete:'cascade' FKs.
// On success, the next /location/resolve creates a fresh snapshot row → fires
// 'vecto-snapshot-saved' → existing observer triggers the waterfall.
// ═══════════════════════════════════════════════════════════════════════════
      // Already in clean state — pointer null, nothing to drop. Idempotent success.
    // 2026-05-05: rankings.snapshot_id FK lacked onDelete:'cascade', so rankings had to be
    // deleted first. 2026-09-13: migrations/20260913_schema_repair.sql adds the cascade; this
    // explicit delete is KEPT until that migration is confirmed applied to prod (todo #25) —
    // it is harmless once the cascade exists.
    // DELETE the current snapshot; cascade handles all other dependent rows.
    // Scope to user_id as well so a stolen/forged snapshot_id can't delete another user's row.
    // Null the pointer on users so the next resolve sees a clean slate.
```

Additional replaced comments:
```text
// Six decimal places describe representation, not the sensor's measured accuracy.
// Server-only results shared by the header GETs and snapshot enrichment. Entries
// expire after one minute; failures are never cached or replaced by stale values.
```

General geocode logs also stopped emitting skipped Plus Code addresses and selected
place IDs. Source values remain in owned records; log messages describe purpose.
