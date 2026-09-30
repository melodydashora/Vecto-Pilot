-- 2026-09-13: Schema repair (Melody-directed, session 0163XeP4v1wMgDHGUZLdNnSb).
-- Findings and verification: docs/architecture/audits/DB_SCHEMA_EVALUATION_2026-09-13.md
--
-- IDEMPOTENT and FAIL-LOUD. Safe to re-run. Every destructive step is guarded and
-- RAISES instead of silently skipping when the guard fails:
--   * a table is dropped only if it holds zero rows
--   * discovered_events.zip/lat/lng are dropped only if every value is NULL
-- Run through server/db/run-migrations.js (boot) or psql -f. Applying to PROD is a
-- manual step (lessons_learned #23, todo #25): check the guards' preconditions there first.

-- ─── 1. Dead tables ─────────────────────────────────────────────────────────
-- Verified 2026-09-13: zero rows in dev, no reader/writer in server/, client/src, scripts/,
-- tests/, no DB views/triggers/FKs depending on them. Drizzle definitions removed the same day.
-- (uber_connections: Uber OAuth integration removed entirely — no Uber API relationship exists.)
DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'block_jobs', 'llm_venue_suggestions', 'eidolon_snapshots', 'venue_events', 'traffic_zones',
    'agent_changes', 'market_intel', 'driver_goals', 'driver_tasks', 'safe_zones',
    'staging_saturation', 'uber_connections'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
      IF n > 0 THEN
        RAISE EXCEPTION 'schema_repair: refusing to drop %.% — it holds % row(s) here (dev had 0). Inspect before dropping in this environment.', 'public', t, n;
      END IF;
      EXECUTE format('DROP TABLE %I', t);
      RAISE NOTICE 'schema_repair: dropped empty table %', t;
    END IF;
  END LOOP;
END $$;

-- ─── 2. Legacy events_facts functions ──────────────────────────────────────
-- From migrations/manual/0008_event_ttl_automation.sql (legacy drizzle-kit era). They
-- reference events_facts, a table that never existed on this schema, so every call failed.
DROP FUNCTION IF EXISTS fn_cleanup_expired_events();
DROP FUNCTION IF EXISTS fn_backfill_event_expiry();
DROP FUNCTION IF EXISTS fn_upsert_event(text, text, text, timestamp with time zone, timestamp with time zone, text, text, text, text, jsonb);
DROP FUNCTION IF EXISTS fn_validate_event_before_insert() CASCADE;
DROP FUNCTION IF EXISTS fn_refresh_venue_enrichment() CASCADE;
DROP FUNCTION IF EXISTS fn_trigger_enrichment_on_event() CASCADE;
DROP FUNCTION IF EXISTS fn_compute_event_badge(timestamp with time zone, timestamp with time zone);
-- Any remaining overloads (signatures unknown) — drop by name.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('fn_cleanup_expired_events','fn_backfill_event_expiry','fn_upsert_event',
                        'fn_validate_event_before_insert','fn_refresh_venue_enrichment',
                        'fn_trigger_enrichment_on_event','fn_compute_event_badge')
  LOOP
    EXECUTE format('DROP FUNCTION %s CASCADE', r.sig);
  END LOOP;
END $$;

-- ─── 3. discovered_events.zip / lat / lng ───────────────────────────────────
-- migrations/20260110_drop_discovered_events_unused_cols.sql was recorded as applied but
-- never executed (baselined). Coordinates come ONLY from venue_catalog.
DO $$
DECLARE n bigint := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'discovered_events' AND column_name IN ('zip','lat','lng')) THEN
    EXECUTE $q$SELECT count(*) FROM discovered_events
               WHERE (to_jsonb(discovered_events.*) ->> 'zip') IS NOT NULL
                  OR (to_jsonb(discovered_events.*) ->> 'lat') IS NOT NULL
                  OR (to_jsonb(discovered_events.*) ->> 'lng') IS NOT NULL$q$ INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'schema_repair: discovered_events has % row(s) with zip/lat/lng populated — refusing to drop the columns', n;
    END IF;
  END IF;
END $$;
ALTER TABLE discovered_events
  DROP COLUMN IF EXISTS zip,
  DROP COLUMN IF EXISTS lat,
  DROP COLUMN IF EXISTS lng;

-- ─── 4. snapshots.user_id self-heal ─────────────────────────────────────────
-- 20251228_drop_snapshot_user_device.sql drops this column and nothing re-adds it, so a
-- fresh DB built from migrations/ would lack a column requireSnapshotOwnership depends on.
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS user_id uuid;

-- ─── 5. rankings.snapshot_id ON DELETE CASCADE ──────────────────────────────
-- The only snapshot FK without a delete rule; server/api/location/snapshot.js worked
-- around it since 2026-05-05 by pre-deleting rankings.
ALTER TABLE rankings DROP CONSTRAINT IF EXISTS rankings_snapshot_id_snapshots_snapshot_id_fk;
ALTER TABLE rankings
  ADD CONSTRAINT rankings_snapshot_id_snapshots_snapshot_id_fk
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id) ON DELETE CASCADE;

-- ─── 6. venue_catalog.market_slug → markets (documented since 2026-01, never created) ──
-- Verified 0 dangling values on 2026-09-13 (533 NULLs are allowed).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venue_catalog_market_slug_markets_market_slug_fk') THEN
    ALTER TABLE venue_catalog
      ADD CONSTRAINT venue_catalog_market_slug_markets_market_slug_fk
      FOREIGN KEY (market_slug) REFERENCES markets(market_slug);
  END IF;
END $$;

-- ─── 7. Exact duplicate index ───────────────────────────────────────────────
-- idx_market_cities_market_slug duplicates idx_umc_market_slug (the declared one).
DROP INDEX IF EXISTS idx_market_cities_market_slug;

-- ─── 8. Indexes declared in shared/schema.js that never existed ─────────────
-- schema.js had declared these as raw sql`` templates, which Drizzle ignores; 2026-09-13
-- converted them to index()/uniqueIndex() so drizzle-kit and this file agree.

CREATE INDEX IF NOT EXISTS idx_actions_snapshot_id ON actions (snapshot_id);
CREATE INDEX IF NOT EXISTS idx_assistant_memory_expires ON assistant_memory (expires_at);
CREATE INDEX IF NOT EXISTS idx_assistant_memory_scope ON assistant_memory (scope);
CREATE INDEX IF NOT EXISTS idx_assistant_memory_user ON assistant_memory (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_credentials_reset_token ON auth_credentials (password_reset_token);
CREATE INDEX IF NOT EXISTS idx_coach_conversations_conversation_id ON coach_conversations (conversation_id);
CREATE INDEX IF NOT EXISTS idx_coach_conversations_created_at ON coach_conversations (created_at desc);
CREATE INDEX IF NOT EXISTS idx_coach_conversations_market_slug ON coach_conversations (market_slug);
CREATE INDEX IF NOT EXISTS idx_coach_conversations_snapshot_id ON coach_conversations (snapshot_id);
CREATE INDEX IF NOT EXISTS idx_coach_conversations_topic_tags ON coach_conversations using gin (topic_tags);
CREATE INDEX IF NOT EXISTS idx_coach_conversations_user_conv ON coach_conversations (user_id, conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_coach_conversations_user_id ON coach_conversations (user_id);
CREATE INDEX IF NOT EXISTS idx_coach_system_notes_category ON coach_system_notes (category);
CREATE INDEX IF NOT EXISTS idx_coach_system_notes_created_at ON coach_system_notes (created_at desc);
CREATE INDEX IF NOT EXISTS idx_coach_system_notes_note_type ON coach_system_notes (note_type);
CREATE INDEX IF NOT EXISTS idx_coach_system_notes_priority ON coach_system_notes (priority desc);
CREATE INDEX IF NOT EXISTS idx_coach_system_notes_status ON coach_system_notes (status);
CREATE INDEX IF NOT EXISTS idx_connection_audit_event_time ON connection_audit (event, occurred_at desc);
CREATE INDEX IF NOT EXISTS idx_coords_cache_city_state ON coords_cache (city, state);
CREATE INDEX IF NOT EXISTS idx_cross_thread_memory_expires ON cross_thread_memory (expires_at);
CREATE INDEX IF NOT EXISTS idx_cross_thread_memory_scope ON cross_thread_memory (scope);
CREATE INDEX IF NOT EXISTS idx_cross_thread_memory_user ON cross_thread_memory (user_id);
CREATE INDEX IF NOT EXISTS idx_discovered_events_category ON discovered_events (category);
CREATE INDEX IF NOT EXISTS idx_discovered_events_city ON discovered_events (city, state);
CREATE INDEX IF NOT EXISTS idx_discovered_events_discovered_at ON discovered_events (discovered_at desc);
CREATE INDEX IF NOT EXISTS idx_discovered_events_start_date ON discovered_events (event_start_date);
CREATE INDEX IF NOT EXISTS idx_discovered_events_venue_id ON discovered_events (venue_id) where venue_id is not null;
CREATE INDEX IF NOT EXISTS idx_driver_profiles_market ON driver_profiles (market);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_phone ON driver_profiles (phone);
CREATE INDEX IF NOT EXISTS idx_driver_vehicles_profile_id ON driver_vehicles (driver_profile_id);
CREATE INDEX IF NOT EXISTS idx_eidolon_memory_expires ON eidolon_memory (expires_at);
CREATE INDEX IF NOT EXISTS idx_eidolon_memory_scope ON eidolon_memory (scope);
CREATE INDEX IF NOT EXISTS idx_eidolon_memory_user ON eidolon_memory (user_id);
CREATE INDEX IF NOT EXISTS idx_intercepted_signals_created ON intercepted_signals (device_id, created_at desc);
CREATE INDEX IF NOT EXISTS idx_intercepted_signals_device_id ON intercepted_signals (device_id);
CREATE INDEX IF NOT EXISTS idx_intercepted_signals_user_id ON intercepted_signals (user_id) where user_id is not null;
CREATE INDEX IF NOT EXISTS idx_market_intelligence_active ON market_intelligence (is_active);
CREATE INDEX IF NOT EXISTS idx_market_intelligence_coach_cite ON market_intelligence (coach_can_cite, coach_priority);
CREATE INDEX IF NOT EXISTS idx_market_intelligence_intel_subtype ON market_intelligence (intel_subtype);
CREATE INDEX IF NOT EXISTS idx_market_intelligence_intel_type ON market_intelligence (intel_type);
CREATE INDEX IF NOT EXISTS idx_market_intelligence_market ON market_intelligence (market);
CREATE INDEX IF NOT EXISTS idx_market_intelligence_market_slug ON market_intelligence (market_slug);
CREATE INDEX IF NOT EXISTS idx_market_intelligence_market_type_active ON market_intelligence (market_slug, intel_type, is_active);
CREATE INDEX IF NOT EXISTS idx_market_intelligence_platform ON market_intelligence (platform);
CREATE INDEX IF NOT EXISTS idx_market_intelligence_source ON market_intelligence (source);
CREATE INDEX IF NOT EXISTS idx_market_intelligence_tags ON market_intelligence using gin (tags);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states (expires_at);
CREATE INDEX IF NOT EXISTS idx_platform_data_city_region ON platform_data (city, region);
CREATE INDEX IF NOT EXISTS idx_platform_data_country ON platform_data (country);
CREATE INDEX IF NOT EXISTS idx_platform_data_country_code ON platform_data (country_code);
CREATE INDEX IF NOT EXISTS idx_platform_data_market ON platform_data (market);
CREATE INDEX IF NOT EXISTS idx_platform_data_platform ON platform_data (platform);
CREATE INDEX IF NOT EXISTS idx_platform_data_platform_country ON platform_data (platform, country);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_data_unique_location ON platform_data (platform, country, COALESCE(region, ''), city);
CREATE INDEX IF NOT EXISTS idx_ranking_candidates_ranking_id ON ranking_candidates (ranking_id);
CREATE INDEX IF NOT EXISTS idx_ranking_candidates_snapshot_id ON ranking_candidates (snapshot_id);
CREATE INDEX IF NOT EXISTS idx_user_intel_notes_active ON user_intel_notes (is_active);
CREATE INDEX IF NOT EXISTS idx_user_intel_notes_market_slug ON user_intel_notes (market_slug);
CREATE INDEX IF NOT EXISTS idx_user_intel_notes_note_type ON user_intel_notes (note_type);
CREATE INDEX IF NOT EXISTS idx_user_intel_notes_user_active ON user_intel_notes (user_id, is_active, importance);
CREATE INDEX IF NOT EXISTS idx_user_intel_notes_user_id ON user_intel_notes (user_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_makes_cache_common ON vehicle_makes_cache (is_common);
CREATE INDEX IF NOT EXISTS idx_vehicle_makes_cache_make_name ON vehicle_makes_cache (make_name);
CREATE INDEX IF NOT EXISTS idx_vehicle_models_cache_make_year ON vehicle_models_cache (make_id, model_year);
CREATE INDEX IF NOT EXISTS idx_vehicle_models_cache_model_name ON vehicle_models_cache (model_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_models_cache_unique ON vehicle_models_cache (make_id, model_id, COALESCE(model_year, 0));
CREATE INDEX IF NOT EXISTS idx_venue_catalog_city_state ON venue_catalog (city, state);
CREATE INDEX IF NOT EXISTS idx_venue_catalog_expense_rank ON venue_catalog (expense_rank) where expense_rank is not null;
CREATE INDEX IF NOT EXISTS idx_venue_catalog_is_bar ON venue_catalog (is_bar) where is_bar = true;
CREATE INDEX IF NOT EXISTS idx_venue_catalog_is_event_venue ON venue_catalog (is_event_venue) where is_event_venue = true;
CREATE INDEX IF NOT EXISTS idx_venue_catalog_market_slug ON venue_catalog (market_slug);
CREATE INDEX IF NOT EXISTS idx_venue_catalog_normalized_name ON venue_catalog (normalized_name);
CREATE INDEX IF NOT EXISTS idx_venue_catalog_record_status ON venue_catalog (record_status);
CREATE INDEX IF NOT EXISTS idx_venue_catalog_venue_types ON venue_catalog using gin (venue_types);
CREATE INDEX IF NOT EXISTS idx_venue_feedback_snapshot_id ON venue_feedback (snapshot_id);
CREATE INDEX IF NOT EXISTS idx_verification_codes_code ON verification_codes (code);
CREATE INDEX IF NOT EXISTS idx_verification_codes_destination ON verification_codes (destination);
CREATE INDEX IF NOT EXISTS idx_verification_codes_expires ON verification_codes (expires_at);
CREATE INDEX IF NOT EXISTS idx_verification_codes_user_id ON verification_codes (user_id);
CREATE INDEX IF NOT EXISTS idx_zone_intelligence_active ON zone_intelligence (is_active) where is_active = true;
CREATE INDEX IF NOT EXISTS idx_zone_intelligence_confidence ON zone_intelligence (confidence_score desc);
CREATE INDEX IF NOT EXISTS idx_zone_intelligence_location ON zone_intelligence (lat, lng) where lat is not null;
CREATE INDEX IF NOT EXISTS idx_zone_intelligence_market_slug ON zone_intelligence (market_slug);
CREATE INDEX IF NOT EXISTS idx_zone_intelligence_market_type ON zone_intelligence (market_slug, zone_type);
CREATE INDEX IF NOT EXISTS idx_zone_intelligence_zone_type ON zone_intelligence (zone_type);
CREATE INDEX IF NOT EXISTS ix_feedback_place ON venue_feedback (place_id);
CREATE INDEX IF NOT EXISTS ix_feedback_ranking ON venue_feedback (ranking_id);

-- ─── 9. Unique constraints declared in shared/schema.js that never existed ──
-- Verified 2026-09-13: no duplicate rows on any of these keys.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venue_feedback_user_id_ranking_id_place_id_key') THEN
    ALTER TABLE venue_feedback ADD CONSTRAINT venue_feedback_user_id_ranking_id_place_id_key UNIQUE (user_id, ranking_id, place_id);
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'strategy_feedback_user_id_ranking_id_key') THEN
    ALTER TABLE strategy_feedback ADD CONSTRAINT strategy_feedback_user_id_ranking_id_key UNIQUE (user_id, ranking_id);
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assistant_memory_scope_key_user_id_key') THEN
    ALTER TABLE assistant_memory ADD CONSTRAINT assistant_memory_scope_key_user_id_key UNIQUE (scope, key, user_id);
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eidolon_memory_scope_key_user_id_key') THEN
    ALTER TABLE eidolon_memory ADD CONSTRAINT eidolon_memory_scope_key_user_id_key UNIQUE (scope, key, user_id);
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cross_thread_memory_scope_key_user_id_key') THEN
    ALTER TABLE cross_thread_memory ADD CONSTRAINT cross_thread_memory_scope_key_user_id_key UNIQUE (scope, key, user_id);
  END IF;
END $$;

-- ─── 10. Event day-end deactivation (replaces the events_facts cleanup) ─────
-- Melody (todo #35): events should deactivate once their day is over. Uses the
-- VENUE's IANA timezone (venue_catalog.timezone via discovered_events.venue_id) —
-- never a hardcoded or UTC-derived day boundary. Rows whose timezone cannot be
-- resolved are left untouched and counted in skipped_no_timezone (fail loud in the
-- caller's log, never guess). An end time earlier than the start time on a single-day
-- event is treated as after midnight (e.g. 21:00–02:00).
CREATE OR REPLACE FUNCTION fn_deactivate_ended_events()
RETURNS TABLE(deactivated integer, skipped_no_timezone integer)
LANGUAGE plpgsql AS $fn$
DECLARE
  v_deact integer := 0;
  v_skip  integer := 0;
BEGIN
  WITH candidates AS (
    SELECT e.id,
           v.timezone,
           COALESCE(NULLIF(e.event_end_date, ''), e.event_start_date) AS end_date,
           e.event_start_date AS start_date,
           e.event_start_time AS start_time,
           e.event_end_time   AS end_time
    FROM discovered_events e
    LEFT JOIN venue_catalog v ON v.venue_id = e.venue_id
    WHERE e.is_active = true
  ), ended AS (
    SELECT id FROM candidates
    WHERE timezone IS NOT NULL
      AND end_date ~ '^\d{4}-\d{2}-\d{2}$'
      AND (
        CASE
          WHEN end_time ~ '^\d{1,2}:\d{2}$' THEN
            CASE
              WHEN start_time ~ '^\d{1,2}:\d{2}$'
                   AND end_date = start_date
                   AND end_time::time < start_time::time
                THEN (end_date::date + 1) + end_time::time
              ELSE end_date::date + end_time::time
            END
          ELSE (end_date::date + 1)::timestamp        -- unparsable end time → end of that local day
        END
      ) AT TIME ZONE timezone <= now()
  )
  UPDATE discovered_events d
     SET is_active = false,
         deactivation_reason = 'event_ended',
         deactivated_by = 'system',
         deactivated_at = now(),
         updated_at = now()
    FROM ended
   WHERE d.id = ended.id;
  GET DIAGNOSTICS v_deact = ROW_COUNT;

  SELECT count(*) INTO v_skip
    FROM discovered_events e
    LEFT JOIN venue_catalog v ON v.venue_id = e.venue_id
   WHERE e.is_active = true AND v.timezone IS NULL;

  RETURN QUERY SELECT v_deact, v_skip;
END $fn$;
COMMENT ON FUNCTION fn_deactivate_ended_events() IS
  'Deactivates discovered_events whose local (venue-timezone) end has passed. Called hourly by server/jobs/event-cleanup.js.';
