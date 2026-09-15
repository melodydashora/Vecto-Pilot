-- 00000_baseline.sql — full schema baseline, generated 2026-09-13 from the DEV database
-- (pg_dump --schema-only --no-owner --no-privileges --exclude-table=schema_migrations), after
-- migrations/20260913_schema_repair.sql. Verified equal to shared/schema.js the same day.
--
-- BASELINE_THROUGH: 20260913_schema_repair.sql
--
-- PURPOSE: 38 of the 54 tables had no CREATE TABLE anywhere in the repo (they came from the
-- dead drizzle-kit era), so no path existed from an empty database to the real schema
-- (docs/architecture/audits/DB_SCHEMA_EVALUATION_2026-09-13.md §1.1). This file is that path.
--
-- HOW THE RUNNER USES IT (server/db/run-migrations.js):
--   * EMPTY database (no public.snapshots): this file is EXECUTED, then every migration up to
--     and including BASELINE_THROUGH is recorded as baselined (not executed). Later files run
--     normally. That is the only situation in which this file ever executes.
--   * EXISTING database (dev, prod): this file is recorded as baselined and NEVER executed.
-- Regenerate only by taking a fresh dump after a migration lands, updating BASELINE_THROUGH,
-- and re-verifying against shared/schema.js — never by hand-editing.
--
-- Session-level SET / \restrict lines from pg_dump were stripped so the runner's shared
-- connection is left untouched (search_path stays 'public').
--
-- PostgreSQL database dump
--


-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10


--
-- Name: app; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA app;


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: current_session_id(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.current_session_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  SELECT NULLIF(current_setting('app.session_id', true), '')::uuid
$$;


--
-- Name: current_user_id(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.current_user_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;


--
-- Name: is_authenticated(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.is_authenticated() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT current_setting('request.jwt.claims', true) IS NOT NULL 
    AND current_setting('request.jwt.claims', true)::jsonb ->> 'sub' IS NOT NULL;
$$;


--
-- Name: FUNCTION is_authenticated(); Type: COMMENT; Schema: app; Owner: -
--

COMMENT ON FUNCTION app.is_authenticated() IS 'Returns true if a valid JWT with sub claim is present.';


--
-- Name: jwt_claims(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.jwt_claims() RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  SELECT current_setting('request.jwt.claims', true)::jsonb;
$$;


--
-- Name: FUNCTION jwt_claims(); Type: COMMENT; Schema: app; Owner: -
--

COMMENT ON FUNCTION app.jwt_claims() IS 'Returns the full JWT claims as JSONB. Returns NULL if no valid JWT.';


--
-- Name: jwt_role(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.jwt_role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'role');
$$;


--
-- Name: FUNCTION jwt_role(); Type: COMMENT; Schema: app; Owner: -
--

COMMENT ON FUNCTION app.jwt_role() IS 'Extract the role from JWT claims. Returns NULL if no valid JWT.';


--
-- Name: jwt_sub(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.jwt_sub() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'sub');
$$;


--
-- Name: FUNCTION jwt_sub(); Type: COMMENT; Schema: app; Owner: -
--

COMMENT ON FUNCTION app.jwt_sub() IS 'Extract the subject (user_id) from JWT claims. Returns NULL if no valid JWT.';


--
-- Name: jwt_tenant(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.jwt_tenant() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id');
$$;


--
-- Name: FUNCTION jwt_tenant(); Type: COMMENT; Schema: app; Owner: -
--

COMMENT ON FUNCTION app.jwt_tenant() IS 'Extract the tenant_id from JWT claims. Returns NULL if no valid JWT or no tenant_id claim.';


--
-- Name: claude_memory_antecedent_check(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claude_memory_antecedent_check() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (NEW.title ILIKE 'Followup:%'
      OR NEW.title ILIKE 'Resolution:%'
      OR NEW.title ILIKE 'Update:%')
     AND NEW.parent_id IS NULL
     AND NEW.content NOT ILIKE 'Antecedent:%'
  THEN
    RAISE NOTICE 'claude_memory: row titled with continuation prefix has neither parent_id nor Antecedent: line in body. See skill threading-claude-memory-followups.';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fn_deactivate_ended_events(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_deactivate_ended_events() RETURNS TABLE(deactivated integer, skipped_no_timezone integer)
    LANGUAGE plpgsql
    AS $_$
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
END $_$;


--
-- Name: FUNCTION fn_deactivate_ended_events(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_deactivate_ended_events() IS 'Deactivates discovered_events whose local (venue-timezone) end has passed. Called hourly by server/jobs/event-cleanup.js.';


--
-- Name: notify_strategy_ready_v2(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_strategy_ready_v2() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (NEW.status IN ('ok', 'pending_blocks') AND NEW.strategy_for_now IS NOT NULL) THEN
    -- TG_OP = 'INSERT' has no OLD row; UPDATE checks the transition explicitly.
    IF (TG_OP = 'INSERT' OR OLD.strategy_for_now IS NULL OR OLD.strategy_for_now = '') THEN
      PERFORM pg_notify('strategy_ready', json_build_object(
        'snapshot_id', NEW.snapshot_id,
        'user_id',     NEW.user_id,
        'status',      NEW.status,
        'type',        'now'
      )::text);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION notify_strategy_ready_v2(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.notify_strategy_ready_v2() IS 'Phase 3 (2026-05-01): Fires strategy_ready SSE only for NOW strategy
(strategy_for_now). The consolidated_strategy column was dropped together
with the deprecated STRATEGY_DAILY role. Supersedes 20260110_fix_strategy_now_notify.sql.';


--
-- Name: touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;




--
-- Name: actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.actions (
    action_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    ranking_id uuid,
    snapshot_id uuid NOT NULL,
    user_id uuid,
    action text NOT NULL,
    block_id text,
    dwell_ms integer,
    from_rank integer,
    raw jsonb,
    formatted_address text,
    city text,
    state text
);


--
-- Name: agent_memory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_memory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope text NOT NULL,
    key text NOT NULL,
    user_id uuid,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone
);


--
-- Name: airports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.airports (
    iata text NOT NULL,
    name text NOT NULL,
    city text,
    country text NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    coord_source text DEFAULT 'google_places'::text NOT NULL,
    is_major boolean DEFAULT true NOT NULL,
    terminals jsonb,
    terminals_provenance text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: app_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_id uuid,
    sentiment text NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    formatted_address text,
    city text,
    state text,
    user_id uuid
);


--
-- Name: COLUMN app_feedback.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.app_feedback.user_id IS 'Authenticated user who submitted the feedback. Added 2026-04-16 — previously app feedback was anonymous despite requiring auth (Pass F finding).';


--
-- Name: app_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_rules (
    id integer NOT NULL,
    rule_key text NOT NULL,
    rule_text text NOT NULL,
    rationale text,
    provenance text DEFAULT 'melody'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    superseded_by integer,
    enforced_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_rules_provenance_check CHECK ((provenance = ANY (ARRAY['melody'::text, 'claude'::text, 'joint'::text]))),
    CONSTRAINT app_rules_status_check CHECK ((status = ANY (ARRAY['active'::text, 'superseded'::text])))
);


--
-- Name: app_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_rules_id_seq OWNED BY public.app_rules.id;


--
-- Name: assistant_memory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_memory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope text NOT NULL,
    key text NOT NULL,
    user_id uuid,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone
);


--
-- Name: auth_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    password_hash text,
    failed_login_attempts integer DEFAULT 0,
    locked_until timestamp with time zone,
    last_login_at timestamp with time zone,
    last_login_ip text,
    password_reset_token text,
    password_reset_expires timestamp with time zone,
    password_changed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: briefings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.briefings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    news jsonb,
    weather_current jsonb,
    weather_forecast jsonb,
    traffic_conditions jsonb,
    events jsonb,
    school_closures jsonb,
    airport_conditions jsonb,
    holiday jsonb,
    status text,
    generated_at timestamp with time zone,
    generation_token uuid
);


--
-- Name: claude_memory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.claude_memory (
    id integer NOT NULL,
    session_id text NOT NULL,
    category text NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    source text DEFAULT 'claude-code'::text,
    priority text DEFAULT 'normal'::text,
    status text DEFAULT 'active'::text,
    tags jsonb DEFAULT '[]'::jsonb,
    related_files jsonb DEFAULT '[]'::jsonb,
    parent_id integer,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: claude_memory_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.claude_memory_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: claude_memory_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.claude_memory_id_seq OWNED BY public.claude_memory.id;


--
-- Name: coach_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coach_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    snapshot_id uuid,
    conversation_id uuid NOT NULL,
    parent_message_id uuid,
    role text NOT NULL,
    content text NOT NULL,
    content_type text DEFAULT 'text'::text,
    topic_tags jsonb DEFAULT '[]'::jsonb,
    extracted_tips jsonb DEFAULT '[]'::jsonb,
    sentiment text,
    location_context jsonb,
    time_context jsonb,
    tokens_in integer,
    tokens_out integer,
    model_used text,
    is_edited boolean DEFAULT false,
    is_regenerated boolean DEFAULT false,
    is_starred boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    market_slug text
);


--
-- Name: coach_memos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coach_memos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    detail text NOT NULL,
    priority text DEFAULT 'medium'::text NOT NULL,
    related_files jsonb,
    status text DEFAULT 'new'::text NOT NULL,
    source text DEFAULT 'coach'::text NOT NULL,
    exported_at timestamp with time zone,
    triggering_user_id uuid,
    triggering_conversation_id uuid,
    triggering_snapshot_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: coach_offer_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coach_offer_decisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    conversation_id uuid,
    snapshot_id uuid,
    offer_intelligence_id uuid,
    platform text,
    ride_tier text,
    fare_amount double precision,
    pickup_miles double precision,
    pickup_minutes integer,
    trip_miles double precision,
    trip_minutes integer,
    pickup_location text,
    dropoff_location text,
    surge_attached double precision,
    dollar_per_mile double precision,
    dollar_per_hour double precision,
    deadhead_risk text,
    ai_recommendation text,
    ai_reasoning text,
    user_decision text,
    user_reasoning text,
    screenshot_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: coach_system_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coach_system_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    note_type text NOT NULL,
    category text NOT NULL,
    priority integer DEFAULT 50,
    title text NOT NULL,
    description text NOT NULL,
    user_quote text,
    triggering_user_id uuid,
    triggering_conversation_id uuid,
    triggering_snapshot_id uuid,
    occurrence_count integer DEFAULT 1,
    affected_users jsonb DEFAULT '[]'::jsonb,
    market_slug text,
    is_market_specific boolean DEFAULT false,
    status text DEFAULT 'new'::text,
    reviewed_at timestamp with time zone,
    reviewed_by text,
    implementation_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: concierge_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.concierge_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_profile_id uuid NOT NULL,
    share_token character varying(12) NOT NULL,
    rating integer NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT concierge_feedback_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: connection_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.connection_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    event text NOT NULL,
    backend_pid integer,
    application_name text,
    reason text,
    deploy_mode text,
    details jsonb
);


--
-- Name: coords_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coords_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    coord_key text NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    formatted_address text NOT NULL,
    city text NOT NULL,
    state text NOT NULL,
    country text NOT NULL,
    timezone text NOT NULL,
    closest_airport text,
    closest_airport_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    hit_count integer DEFAULT 0 NOT NULL
);


--
-- Name: countries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.countries (
    code character varying(2) NOT NULL,
    name text NOT NULL,
    alpha3 character varying(3),
    phone_code text,
    has_platform_data boolean DEFAULT false NOT NULL,
    display_order integer DEFAULT 999 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cross_thread_memory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cross_thread_memory (
    id integer NOT NULL,
    scope text NOT NULL,
    key text NOT NULL,
    user_id uuid,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone
);


--
-- Name: cross_thread_memory_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cross_thread_memory_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cross_thread_memory_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cross_thread_memory_id_seq OWNED BY public.cross_thread_memory.id;


--
-- Name: definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.definitions (
    id integer NOT NULL,
    term text NOT NULL,
    meaning text NOT NULL,
    location text,
    aliases text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: definitions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.definitions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: definitions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.definitions_id_seq OWNED BY public.definitions.id;


--
-- Name: discovered_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discovered_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    venue_name text,
    address text,
    city text NOT NULL,
    state text NOT NULL,
    event_start_date text NOT NULL,
    event_start_time text,
    event_end_date text,
    category text DEFAULT 'other'::text NOT NULL,
    expected_attendance text DEFAULT 'medium'::text,
    event_hash text NOT NULL,
    discovered_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_verified boolean DEFAULT false,
    is_active boolean DEFAULT true,
    event_end_time text NOT NULL,
    deactivation_reason text,
    deactivated_at timestamp with time zone,
    deactivated_by text,
    venue_id uuid,
    schema_version integer DEFAULT 1 NOT NULL
);


--
-- Name: TABLE discovered_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.discovered_events IS 'AI-discovered events from SerpAPI, GPT-5.2, and other sources for rideshare demand prediction';


--
-- Name: COLUMN discovered_events.event_start_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.discovered_events.event_start_date IS 'Event start date in YYYY-MM-DD format (renamed from event_date for symmetry with event_end_date)';


--
-- Name: COLUMN discovered_events.event_start_time; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.discovered_events.event_start_time IS 'Event start time, e.g., "7:00 PM", "All Day" (renamed from event_time for symmetry with event_end_time)';


--
-- Name: COLUMN discovered_events.event_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.discovered_events.event_hash IS 'MD5 hash of normalized(title + venue + date + city) for deduplication';


--
-- Name: COLUMN discovered_events.event_end_time; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.discovered_events.event_end_time IS 'Event end time in format like "10:00 PM"';


--
-- Name: COLUMN discovered_events.deactivation_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.discovered_events.deactivation_reason IS 'Reason for deactivation: event_ended, incorrect_time, no_longer_relevant, cancelled, duplicate, other';


--
-- Name: COLUMN discovered_events.deactivated_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.discovered_events.deactivated_by IS 'Who deactivated: ai_coach or user_id';


--
-- Name: COLUMN discovered_events.schema_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.discovered_events.schema_version IS 'Validation schema version at write time. Rows with current version skip read-time revalidation. See validateEvent.js VALIDATION_SCHEMA_VERSION.';


--
-- Name: discovered_traffic; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discovered_traffic (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_id uuid NOT NULL,
    incident_id text NOT NULL,
    category text NOT NULL,
    severity text NOT NULL,
    description text,
    road text,
    location text,
    is_highway boolean DEFAULT false NOT NULL,
    delay_minutes integer,
    length_miles double precision,
    distance_miles double precision,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    raw_payload jsonb,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE discovered_traffic; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.discovered_traffic IS 'Snapshot-scoped cache of TomTom traffic incidents. Decouples map render path from briefing consolidation. lat/lng NOT NULL is the structural defense against the 2026-04 Phase F regression class (briefing-service silently dropping coords).';


--
-- Name: COLUMN discovered_traffic.snapshot_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.discovered_traffic.snapshot_id IS 'FK to snapshots; ON DELETE CASCADE means traffic rows are pruned with their snapshot.';


--
-- Name: COLUMN discovered_traffic.incident_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.discovered_traffic.incident_id IS 'TomTom-provided stable id, used with snapshot_id for per-snapshot dedup.';


--
-- Name: driver_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.driver_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text NOT NULL,
    phone text,
    address_1 text,
    address_2 text,
    city text,
    state_territory text,
    zip_code text,
    country text DEFAULT 'US'::text NOT NULL,
    market text,
    rideshare_platforms jsonb DEFAULT '["uber"]'::jsonb NOT NULL,
    uber_black boolean DEFAULT false,
    uber_xxl boolean DEFAULT false,
    uber_comfort boolean DEFAULT false,
    uber_x boolean DEFAULT false,
    uber_x_share boolean DEFAULT false,
    marketing_opt_in boolean DEFAULT false NOT NULL,
    terms_accepted_at timestamp with time zone,
    terms_version text,
    email_verified boolean DEFAULT false,
    phone_verified boolean DEFAULT false,
    profile_complete boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    home_lat double precision,
    home_lng double precision,
    home_formatted_address text,
    home_timezone text,
    driver_nickname text,
    elig_economy boolean DEFAULT true,
    elig_xl boolean DEFAULT false,
    elig_xxl boolean DEFAULT false,
    elig_comfort boolean DEFAULT false,
    elig_luxury_sedan boolean DEFAULT false,
    elig_luxury_suv boolean DEFAULT false,
    attr_electric boolean DEFAULT false,
    attr_green boolean DEFAULT false,
    attr_wav boolean DEFAULT false,
    attr_ski boolean DEFAULT false,
    attr_car_seat boolean DEFAULT false,
    pref_pet_friendly boolean DEFAULT false,
    pref_teen boolean DEFAULT false,
    pref_assist boolean DEFAULT false,
    pref_shared boolean DEFAULT false,
    terms_accepted boolean DEFAULT false NOT NULL,
    google_id text,
    concierge_share_token character varying(12),
    fuel_economy_mpg integer,
    earnings_goal_daily numeric(10,2),
    shift_hours_target numeric(4,1),
    max_deadhead_mi integer,
    shortcut_token character varying(43),
    shortcut_token_created_at timestamp with time zone,
    shortcut_device_label text
);


--
-- Name: COLUMN driver_profiles.fuel_economy_mpg; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.driver_profiles.fuel_economy_mpg IS 'Driver vehicle fuel economy in mpg (null = use default 25). Used by strategist prompt for per-mile gas cost math. Ignored when attr_electric = true.';


--
-- Name: COLUMN driver_profiles.earnings_goal_daily; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.driver_profiles.earnings_goal_daily IS 'Driver daily earnings target in local currency (null = goal not set). Used by strategist to compute required $/hr for the shift.';


--
-- Name: COLUMN driver_profiles.shift_hours_target; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.driver_profiles.shift_hours_target IS 'Driver target shift length in hours (null = target not set). Paired with earnings_goal_daily for $/hr pacing.';


--
-- Name: COLUMN driver_profiles.max_deadhead_mi; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.driver_profiles.max_deadhead_mi IS 'Max miles the driver will drive empty for a pickup (null = use default 15). Used by tactical planner for beyond_deadhead flagging.';


--
-- Name: driver_vehicles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.driver_vehicles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_profile_id uuid NOT NULL,
    year integer NOT NULL,
    make text NOT NULL,
    model text NOT NULL,
    color text,
    license_plate text,
    seatbelts integer DEFAULT 4 NOT NULL,
    is_primary boolean DEFAULT true,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: eidolon_memory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eidolon_memory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope text NOT NULL,
    key text NOT NULL,
    user_id uuid,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone
);


--
-- Name: http_idem; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.http_idem (
    key text NOT NULL,
    status integer NOT NULL,
    body jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: intercepted_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intercepted_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id character varying(255) NOT NULL,
    user_id uuid,
    raw_text text NOT NULL,
    parsed_data jsonb,
    decision text NOT NULL,
    decision_reasoning text,
    confidence_score double precision,
    user_override text,
    source character varying(50) DEFAULT 'siri_shortcut'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    latitude double precision,
    longitude double precision,
    market character varying(100),
    platform character varying(20),
    response_time_ms integer
);


--
-- Name: lessons_learned; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lessons_learned (
    id integer NOT NULL,
    lesson text NOT NULL,
    trigger text,
    rule text,
    severity text DEFAULT 'medium'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: lessons_learned_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lessons_learned_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lessons_learned_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lessons_learned_id_seq OWNED BY public.lessons_learned.id;


--
-- Name: market_cities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_cities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    state text NOT NULL,
    state_abbr text,
    city text NOT NULL,
    market_name text NOT NULL,
    region_type text DEFAULT 'Satellite'::text NOT NULL,
    source_ref text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    timezone text,
    market_slug text NOT NULL,
    country_code character varying(2) DEFAULT 'US'::character varying NOT NULL
);


--
-- Name: market_intelligence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_intelligence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market text NOT NULL,
    market_slug text NOT NULL,
    platform text DEFAULT 'both'::text NOT NULL,
    intel_type text NOT NULL,
    intel_subtype text,
    title text NOT NULL,
    summary text,
    content text NOT NULL,
    neighborhoods jsonb,
    boundaries jsonb,
    time_context jsonb,
    tags jsonb DEFAULT '[]'::jsonb,
    priority integer DEFAULT 50,
    source text DEFAULT 'research'::text NOT NULL,
    source_file text,
    source_section text,
    confidence integer DEFAULT 80,
    version integer DEFAULT 1,
    effective_date timestamp with time zone,
    expiry_date timestamp with time zone,
    is_active boolean DEFAULT true,
    is_verified boolean DEFAULT false,
    coach_can_cite boolean DEFAULT true,
    coach_priority integer DEFAULT 50,
    created_by text DEFAULT 'system'::text NOT NULL,
    updated_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: markets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.markets (
    market_slug text NOT NULL,
    market_name text NOT NULL,
    primary_city text NOT NULL,
    state text NOT NULL,
    country_code character varying(2) DEFAULT 'US'::character varying NOT NULL,
    timezone text NOT NULL,
    primary_airport_code text,
    secondary_airports jsonb,
    city_aliases jsonb,
    has_uber boolean DEFAULT true NOT NULL,
    has_lyft boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    state_abbr character varying(5)
);


--
-- Name: news_deactivations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.news_deactivations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    news_hash text NOT NULL,
    news_title text NOT NULL,
    news_source text,
    reason text NOT NULL,
    deactivated_by text DEFAULT 'user'::text NOT NULL,
    scope text DEFAULT 'user'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: oauth_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_states (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    state text NOT NULL,
    provider text NOT NULL,
    user_id uuid NOT NULL,
    redirect_uri text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: offer_intelligence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.offer_intelligence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id character varying(255) NOT NULL,
    user_id uuid,
    price double precision,
    per_mile double precision,
    per_minute double precision,
    hourly_rate double precision,
    surge double precision,
    advantage_pct integer,
    pickup_minutes integer,
    pickup_miles double precision,
    ride_minutes integer,
    ride_miles double precision,
    total_miles double precision,
    total_minutes integer,
    product_type character varying(50),
    platform character varying(20) DEFAULT 'unknown'::character varying NOT NULL,
    pickup_address text,
    dropoff_address text,
    pickup_lat double precision,
    pickup_lng double precision,
    dropoff_lat double precision,
    dropoff_lng double precision,
    geocoded_at timestamp with time zone,
    driver_lat double precision,
    driver_lng double precision,
    coord_key text,
    h3_index text,
    market character varying(100),
    local_date text,
    local_hour integer,
    day_of_week integer,
    day_part text,
    is_weekend boolean,
    timezone text,
    decision text NOT NULL,
    decision_reasoning text,
    confidence_score integer,
    ai_model text,
    response_time_ms integer,
    user_override text,
    offer_session_id uuid,
    offer_sequence_num integer,
    seconds_since_last integer,
    parse_confidence character varying(20),
    source character varying(50) DEFAULT 'siri_shortcut'::character varying NOT NULL,
    input_mode character varying(20) DEFAULT 'text'::character varying NOT NULL,
    raw_text text,
    raw_ai_response text,
    parsed_data_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ruleset_version integer,
    ruleset_hash text
);


--
-- Name: offer_outcomes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.offer_outcomes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    offer_intelligence_id uuid,
    driver_decision text,
    driver_reasoning text,
    actual_pay double precision,
    reimbursements double precision,
    extras double precision,
    other double precision,
    total_earned double precision GENERATED ALWAYS AS ((((COALESCE(actual_pay, (0)::double precision) + COALESCE(reimbursements, (0)::double precision)) + COALESCE(extras, (0)::double precision)) + COALESCE(other, (0)::double precision))) STORED,
    outcome_source text DEFAULT 'web_app'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    CONSTRAINT offer_outcomes_driver_decision_check CHECK ((driver_decision = ANY (ARRAY['Accepted'::text, 'Rejected'::text, 'Cancelled'::text, 'Completed'::text, 'Other'::text]))),
    CONSTRAINT offer_outcomes_revision_check CHECK ((revision >= 1))
);


--
-- Name: offer_rulesets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.offer_rulesets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    config jsonb NOT NULL,
    config_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: COLUMN offer_rulesets.config_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.offer_rulesets.config_hash IS 'sha256 hex of canonicalized config JSON; offer_intelligence.ruleset_hash references it (no FK — offers keep the hash even if rules change)';


--
-- Name: places_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.places_cache (
    coords_key text NOT NULL,
    formatted_hours jsonb,
    cached_at timestamp with time zone NOT NULL,
    access_count integer DEFAULT 0 NOT NULL
);


--
-- Name: TABLE places_cache; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.places_cache IS 'Cache for Google Places API responses to reduce API costs';


--
-- Name: COLUMN places_cache.coords_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.places_cache.coords_key IS 'Coordinate key in format lat_lng with 6 decimal precision (e.g., 33.081234_-96.812345)';


--
-- Name: COLUMN places_cache.formatted_hours; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.places_cache.formatted_hours IS 'Parsed hours data from Google Places API including weekdayDescriptions';


--
-- Name: COLUMN places_cache.cached_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.places_cache.cached_at IS 'When this cache entry was created/updated';


--
-- Name: COLUMN places_cache.access_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.places_cache.access_count IS 'Number of times this cache entry has been accessed';


--
-- Name: platform_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_data (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    country text NOT NULL,
    city text NOT NULL,
    platform text NOT NULL,
    coord_boundary jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    country_code text,
    region text,
    market text,
    timezone text,
    center_lat double precision,
    center_lng double precision,
    is_active boolean DEFAULT true NOT NULL,
    market_anchor text,
    region_type text
);


--
-- Name: ranking_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ranking_candidates (
    id uuid NOT NULL,
    ranking_id uuid NOT NULL,
    block_id text NOT NULL,
    name text NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    drive_time_min integer,
    straight_line_km double precision,
    est_earnings_per_ride double precision,
    model_score double precision,
    rank integer NOT NULL,
    exploration_policy text NOT NULL,
    epsilon double precision,
    was_forced boolean,
    propensity double precision,
    features jsonb,
    h3_r8 text,
    distance_miles double precision,
    drive_minutes integer,
    value_per_min double precision,
    value_grade text,
    not_worth boolean,
    rate_per_min_used double precision,
    trip_minutes_used integer,
    wait_minutes_used integer,
    snapshot_id uuid,
    place_id text,
    estimated_distance_miles double precision,
    drive_time_minutes integer,
    distance_source text,
    pro_tips text[],
    closed_reasoning text,
    staging_tips text,
    staging_name text,
    staging_lat double precision,
    staging_lng double precision,
    business_hours jsonb,
    venue_events jsonb,
    event_badge_missing boolean,
    node_type text,
    access_status text,
    aliases text[],
    district text,
    venue_id uuid,
    beyond_deadhead boolean,
    distance_from_home_mi double precision
);


--
-- Name: COLUMN ranking_candidates.event_badge_missing; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ranking_candidates.event_badge_missing IS 'True when enrichment ran but no overlapping events found (enables neutral UI state)';


--
-- Name: COLUMN ranking_candidates.district; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ranking_candidates.district IS 'District name from LLM output, used for text search fallback and deduplication';


--
-- Name: COLUMN ranking_candidates.beyond_deadhead; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ranking_candidates.beyond_deadhead IS 'True when venue distance from home exceeds driver max_deadhead_mi. Set by tactical planner post-resolver. Null = not computed (home coords missing).';


--
-- Name: COLUMN ranking_candidates.distance_from_home_mi; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ranking_candidates.distance_from_home_mi IS 'Straight-line haversine distance in miles from driver home to venue. Null = home coords missing.';


--
-- Name: rankings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rankings (
    ranking_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    snapshot_id uuid,
    user_id uuid,
    city text,
    ui jsonb,
    model_name text NOT NULL,
    correlation_id uuid,
    scoring_ms integer,
    planner_ms integer,
    total_ms integer,
    timed_out boolean DEFAULT false,
    path_taken text,
    formatted_address text,
    state text
);


--
-- Name: COLUMN rankings.path_taken; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.rankings.path_taken IS 'Tracks execution path: deterministic (Quick Picks) or refined (AI reranked)';


--
-- Name: snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.snapshots (
    snapshot_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    session_id uuid NOT NULL,
    h3_r8 text,
    weather jsonb,
    air jsonb,
    permissions jsonb,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    city text NOT NULL,
    state text NOT NULL,
    country text NOT NULL,
    formatted_address text NOT NULL,
    timezone text NOT NULL,
    local_iso timestamp without time zone NOT NULL,
    dow integer NOT NULL,
    hour integer NOT NULL,
    day_part_key text NOT NULL,
    date text NOT NULL,
    coord_key text,
    user_id uuid,
    market text,
    status text DEFAULT 'pending'::text
);


--
-- Name: strategies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.strategies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    error_message text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    strategy_for_now text,
    user_id uuid,
    phase text DEFAULT 'starting'::text,
    phase_started_at timestamp with time zone,
    venue_cache_metrics jsonb
);


--
-- Name: COLUMN strategies.venue_cache_metrics; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.strategies.venue_cache_metrics IS 'Rolled-up venue-catalog cache stats from tactical-planner''s resolve chain.
Shape: {hits: int, misses: int, hit_rate: float|null}.
NULL when the strategy did not run tactical-planner (e.g., snapshot rejected upstream).
Per-call structured logs (matrixLog CACHE_HIT/CACHE_MISS) carry the granular trail;
this column is the operational top-level monitoring surface.';


--
-- Name: strategy_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.strategy_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    snapshot_id uuid NOT NULL,
    ranking_id uuid NOT NULL,
    sentiment text NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    formatted_address text,
    city text,
    state text
);


--
-- Name: todo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.todo (
    id integer NOT NULL,
    title text NOT NULL,
    detail text,
    status text DEFAULT 'open'::text NOT NULL,
    priority integer DEFAULT 3,
    source_memory_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT todo_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'done'::text, 'wontfix'::text])))
);


--
-- Name: todo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.todo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: todo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.todo_id_seq OWNED BY public.todo.id;


--
-- Name: travel_disruptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.travel_disruptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    country_code text DEFAULT 'US'::text NOT NULL,
    airport_code text NOT NULL,
    airport_name text,
    delay_minutes integer DEFAULT 0,
    ground_stops jsonb DEFAULT '[]'::jsonb,
    ground_delay_programs jsonb DEFAULT '[]'::jsonb,
    closure_status text DEFAULT 'open'::text,
    delay_reason text,
    ai_summary text,
    impact_level text DEFAULT 'none'::text,
    data_source text DEFAULT 'FAA'::text NOT NULL,
    last_updated timestamp with time zone DEFAULT now() NOT NULL,
    next_update_at timestamp with time zone
);


--
-- Name: triad_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.triad_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_id uuid NOT NULL,
    kind text DEFAULT 'triad'::text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    formatted_address text,
    city text,
    state text
);


--
-- Name: user_intel_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_intel_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    snapshot_id uuid,
    note_type text DEFAULT 'insight'::text NOT NULL,
    category text,
    title text,
    content text NOT NULL,
    context text,
    market_slug text,
    neighborhoods jsonb,
    importance integer DEFAULT 50,
    confidence integer DEFAULT 80,
    times_referenced integer DEFAULT 0,
    valid_from timestamp with time zone DEFAULT now(),
    valid_until timestamp with time zone,
    is_active boolean DEFAULT true,
    is_pinned boolean DEFAULT false,
    source_message_id text,
    created_by text DEFAULT 'ai_coach'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    user_id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    current_snapshot_id uuid,
    session_start_at timestamp with time zone DEFAULT now() NOT NULL,
    last_active_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vehicle_makes_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_makes_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    make_id integer NOT NULL,
    make_name text NOT NULL,
    is_common boolean DEFAULT false,
    cached_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vehicle_models_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_models_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    make_id integer NOT NULL,
    make_name text NOT NULL,
    model_id integer NOT NULL,
    model_name text NOT NULL,
    model_year integer,
    cached_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: venue_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venue_catalog (
    venue_id uuid DEFAULT gen_random_uuid() NOT NULL,
    place_id text,
    venue_name character varying(500) NOT NULL,
    address character varying(500) NOT NULL,
    lat double precision,
    lng double precision,
    category text DEFAULT 'venue'::text NOT NULL,
    staging_notes jsonb,
    city text,
    metro text,
    ai_estimated_hours text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    business_hours jsonb,
    discovery_source text DEFAULT 'seed'::text NOT NULL,
    validated_at timestamp with time zone,
    suggestion_metadata jsonb,
    dayparts text[],
    last_known_status text DEFAULT 'unknown'::text,
    status_checked_at timestamp with time zone,
    consecutive_closed_checks integer DEFAULT 0,
    auto_suppressed boolean DEFAULT false,
    suppression_reason text,
    district text,
    district_slug text,
    district_centroid_lat double precision,
    district_centroid_lng double precision,
    state text,
    address_1 text,
    address_2 text,
    zip text,
    country text DEFAULT 'US'::text,
    formatted_address text,
    normalized_name text,
    coord_key text,
    venue_types jsonb DEFAULT '[]'::jsonb,
    market_slug text,
    expense_rank integer,
    hours_full_week jsonb,
    crowd_level text,
    rideshare_potential text,
    hours_source text,
    capacity_estimate integer,
    source text,
    access_count integer DEFAULT 0,
    last_accessed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now(),
    is_bar boolean DEFAULT false NOT NULL,
    is_event_venue boolean DEFAULT false NOT NULL,
    record_status text DEFAULT 'stub'::text NOT NULL,
    timezone text,
    google_rating double precision,
    phone_number text,
    venue_quality_tier text
);


--
-- Name: COLUMN venue_catalog.district; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.venue_catalog.district IS 'Human-readable district/neighborhood name (e.g., "Legacy West", "Deep Ellum")';


--
-- Name: COLUMN venue_catalog.district_slug; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.venue_catalog.district_slug IS 'URL-safe normalized district name for lookups (e.g., "legacy-west")';


--
-- Name: COLUMN venue_catalog.district_centroid_lat; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.venue_catalog.district_centroid_lat IS 'Latitude of district center, calculated from clustered venues';


--
-- Name: COLUMN venue_catalog.district_centroid_lng; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.venue_catalog.district_centroid_lng IS 'Longitude of district center, calculated from clustered venues';


--
-- Name: venue_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venue_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    snapshot_id uuid NOT NULL,
    ranking_id uuid NOT NULL,
    place_id text,
    venue_name text NOT NULL,
    sentiment text NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    formatted_address text,
    city text,
    state text
);


--
-- Name: venue_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venue_metrics (
    venue_id uuid NOT NULL,
    times_recommended integer DEFAULT 0 NOT NULL,
    times_chosen integer DEFAULT 0 NOT NULL,
    positive_feedback integer DEFAULT 0 NOT NULL,
    negative_feedback integer DEFAULT 0 NOT NULL,
    reliability_score double precision DEFAULT 0.5 NOT NULL,
    last_verified_by_driver timestamp with time zone
);


--
-- Name: verification_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verification_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    code text NOT NULL,
    code_type text NOT NULL,
    destination text NOT NULL,
    used_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    attempts integer DEFAULT 0,
    max_attempts integer DEFAULT 3,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: zone_intelligence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zone_intelligence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_slug text NOT NULL,
    zone_type text NOT NULL,
    zone_name text NOT NULL,
    zone_description text,
    lat double precision,
    lng double precision,
    radius_miles double precision DEFAULT 0.5,
    address_hint text,
    time_constraints jsonb DEFAULT '{}'::jsonb,
    is_time_specific boolean DEFAULT false,
    reports_count integer DEFAULT 1,
    confidence_score integer DEFAULT 50,
    contributing_users jsonb DEFAULT '[]'::jsonb,
    source_conversations jsonb DEFAULT '[]'::jsonb,
    last_reason text,
    last_reported_by uuid,
    last_reported_at timestamp with time zone,
    is_active boolean DEFAULT true,
    verified_by_admin boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: app_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_rules ALTER COLUMN id SET DEFAULT nextval('public.app_rules_id_seq'::regclass);


--
-- Name: claude_memory id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claude_memory ALTER COLUMN id SET DEFAULT nextval('public.claude_memory_id_seq'::regclass);


--
-- Name: cross_thread_memory id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cross_thread_memory ALTER COLUMN id SET DEFAULT nextval('public.cross_thread_memory_id_seq'::regclass);


--
-- Name: definitions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.definitions ALTER COLUMN id SET DEFAULT nextval('public.definitions_id_seq'::regclass);


--
-- Name: lessons_learned id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lessons_learned ALTER COLUMN id SET DEFAULT nextval('public.lessons_learned_id_seq'::regclass);


--
-- Name: todo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.todo ALTER COLUMN id SET DEFAULT nextval('public.todo_id_seq'::regclass);


--
-- Name: actions actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_pkey PRIMARY KEY (action_id);


--
-- Name: agent_memory agent_memory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_memory
    ADD CONSTRAINT agent_memory_pkey PRIMARY KEY (id);


--
-- Name: agent_memory agent_memory_scope_key_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_memory
    ADD CONSTRAINT agent_memory_scope_key_user_id_key UNIQUE (scope, key, user_id);


--
-- Name: airports airports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.airports
    ADD CONSTRAINT airports_pkey PRIMARY KEY (iata);


--
-- Name: app_feedback app_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_feedback
    ADD CONSTRAINT app_feedback_pkey PRIMARY KEY (id);


--
-- Name: app_rules app_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_rules
    ADD CONSTRAINT app_rules_pkey PRIMARY KEY (id);


--
-- Name: app_rules app_rules_rule_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_rules
    ADD CONSTRAINT app_rules_rule_key_key UNIQUE (rule_key);


--
-- Name: assistant_memory assistant_memory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_memory
    ADD CONSTRAINT assistant_memory_pkey PRIMARY KEY (id);


--
-- Name: assistant_memory assistant_memory_scope_key_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_memory
    ADD CONSTRAINT assistant_memory_scope_key_user_id_key UNIQUE (scope, key, user_id);


--
-- Name: auth_credentials auth_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_credentials
    ADD CONSTRAINT auth_credentials_pkey PRIMARY KEY (id);


--
-- Name: auth_credentials auth_credentials_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_credentials
    ADD CONSTRAINT auth_credentials_user_id_unique UNIQUE (user_id);


--
-- Name: briefings briefings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.briefings
    ADD CONSTRAINT briefings_pkey PRIMARY KEY (id);


--
-- Name: briefings briefings_snapshot_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.briefings
    ADD CONSTRAINT briefings_snapshot_id_unique UNIQUE (snapshot_id);


--
-- Name: claude_memory claude_memory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claude_memory
    ADD CONSTRAINT claude_memory_pkey PRIMARY KEY (id);


--
-- Name: coach_conversations coach_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_conversations
    ADD CONSTRAINT coach_conversations_pkey PRIMARY KEY (id);


--
-- Name: coach_memos coach_memos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_memos
    ADD CONSTRAINT coach_memos_pkey PRIMARY KEY (id);


--
-- Name: coach_offer_decisions coach_offer_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_offer_decisions
    ADD CONSTRAINT coach_offer_decisions_pkey PRIMARY KEY (id);


--
-- Name: coach_system_notes coach_system_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_system_notes
    ADD CONSTRAINT coach_system_notes_pkey PRIMARY KEY (id);


--
-- Name: concierge_feedback concierge_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concierge_feedback
    ADD CONSTRAINT concierge_feedback_pkey PRIMARY KEY (id);


--
-- Name: connection_audit connection_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connection_audit
    ADD CONSTRAINT connection_audit_pkey PRIMARY KEY (id);


--
-- Name: coords_cache coords_cache_coord_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coords_cache
    ADD CONSTRAINT coords_cache_coord_key_unique UNIQUE (coord_key);


--
-- Name: coords_cache coords_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coords_cache
    ADD CONSTRAINT coords_cache_pkey PRIMARY KEY (id);


--
-- Name: countries countries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.countries
    ADD CONSTRAINT countries_pkey PRIMARY KEY (code);


--
-- Name: cross_thread_memory cross_thread_memory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cross_thread_memory
    ADD CONSTRAINT cross_thread_memory_pkey PRIMARY KEY (id);


--
-- Name: cross_thread_memory cross_thread_memory_scope_key_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cross_thread_memory
    ADD CONSTRAINT cross_thread_memory_scope_key_user_id_key UNIQUE (scope, key, user_id);


--
-- Name: definitions definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.definitions
    ADD CONSTRAINT definitions_pkey PRIMARY KEY (id);


--
-- Name: definitions definitions_term_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.definitions
    ADD CONSTRAINT definitions_term_key UNIQUE (term);


--
-- Name: discovered_events discovered_events_event_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discovered_events
    ADD CONSTRAINT discovered_events_event_hash_unique UNIQUE (event_hash);


--
-- Name: discovered_events discovered_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discovered_events
    ADD CONSTRAINT discovered_events_pkey PRIMARY KEY (id);


--
-- Name: discovered_traffic discovered_traffic_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discovered_traffic
    ADD CONSTRAINT discovered_traffic_pkey PRIMARY KEY (id);


--
-- Name: discovered_traffic discovered_traffic_snapshot_incident_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discovered_traffic
    ADD CONSTRAINT discovered_traffic_snapshot_incident_unique UNIQUE (snapshot_id, incident_id);


--
-- Name: driver_profiles driver_profiles_concierge_share_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_profiles
    ADD CONSTRAINT driver_profiles_concierge_share_token_key UNIQUE (concierge_share_token);


--
-- Name: driver_profiles driver_profiles_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_profiles
    ADD CONSTRAINT driver_profiles_email_unique UNIQUE (email);


--
-- Name: driver_profiles driver_profiles_google_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_profiles
    ADD CONSTRAINT driver_profiles_google_id_key UNIQUE (google_id);


--
-- Name: driver_profiles driver_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_profiles
    ADD CONSTRAINT driver_profiles_pkey PRIMARY KEY (id);


--
-- Name: driver_profiles driver_profiles_shortcut_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_profiles
    ADD CONSTRAINT driver_profiles_shortcut_token_key UNIQUE (shortcut_token);


--
-- Name: driver_profiles driver_profiles_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_profiles
    ADD CONSTRAINT driver_profiles_user_id_unique UNIQUE (user_id);


--
-- Name: driver_vehicles driver_vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_vehicles
    ADD CONSTRAINT driver_vehicles_pkey PRIMARY KEY (id);


--
-- Name: eidolon_memory eidolon_memory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eidolon_memory
    ADD CONSTRAINT eidolon_memory_pkey PRIMARY KEY (id);


--
-- Name: eidolon_memory eidolon_memory_scope_key_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eidolon_memory
    ADD CONSTRAINT eidolon_memory_scope_key_user_id_key UNIQUE (scope, key, user_id);


--
-- Name: http_idem http_idem_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.http_idem
    ADD CONSTRAINT http_idem_pkey PRIMARY KEY (key);


--
-- Name: intercepted_signals intercepted_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intercepted_signals
    ADD CONSTRAINT intercepted_signals_pkey PRIMARY KEY (id);


--
-- Name: lessons_learned lessons_learned_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lessons_learned
    ADD CONSTRAINT lessons_learned_pkey PRIMARY KEY (id);


--
-- Name: market_intelligence market_intelligence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_intelligence
    ADD CONSTRAINT market_intelligence_pkey PRIMARY KEY (id);


--
-- Name: markets markets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.markets
    ADD CONSTRAINT markets_pkey PRIMARY KEY (market_slug);


--
-- Name: news_deactivations news_deactivations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_deactivations
    ADD CONSTRAINT news_deactivations_pkey PRIMARY KEY (id);


--
-- Name: oauth_states oauth_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_pkey PRIMARY KEY (id);


--
-- Name: oauth_states oauth_states_state_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_state_unique UNIQUE (state);


--
-- Name: offer_intelligence offer_intelligence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_intelligence
    ADD CONSTRAINT offer_intelligence_pkey PRIMARY KEY (id);


--
-- Name: offer_outcomes offer_outcomes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_outcomes
    ADD CONSTRAINT offer_outcomes_pkey PRIMARY KEY (id);


--
-- Name: offer_rulesets offer_rulesets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_rulesets
    ADD CONSTRAINT offer_rulesets_pkey PRIMARY KEY (id);


--
-- Name: offer_rulesets offer_rulesets_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_rulesets
    ADD CONSTRAINT offer_rulesets_user_id_key UNIQUE (user_id);


--
-- Name: places_cache places_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.places_cache
    ADD CONSTRAINT places_cache_pkey PRIMARY KEY (coords_key);


--
-- Name: platform_data platform_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_data
    ADD CONSTRAINT platform_data_pkey PRIMARY KEY (id);


--
-- Name: ranking_candidates ranking_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ranking_candidates
    ADD CONSTRAINT ranking_candidates_pkey PRIMARY KEY (id);


--
-- Name: rankings rankings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rankings
    ADD CONSTRAINT rankings_pkey PRIMARY KEY (ranking_id);


--
-- Name: snapshots snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snapshots
    ADD CONSTRAINT snapshots_pkey PRIMARY KEY (snapshot_id);


--
-- Name: strategies strategies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strategies
    ADD CONSTRAINT strategies_pkey PRIMARY KEY (id);


--
-- Name: strategies strategies_snapshot_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strategies
    ADD CONSTRAINT strategies_snapshot_id_unique UNIQUE (snapshot_id);


--
-- Name: strategy_feedback strategy_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strategy_feedback
    ADD CONSTRAINT strategy_feedback_pkey PRIMARY KEY (id);


--
-- Name: strategy_feedback strategy_feedback_user_id_ranking_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strategy_feedback
    ADD CONSTRAINT strategy_feedback_user_id_ranking_id_key UNIQUE (user_id, ranking_id);


--
-- Name: todo todo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.todo
    ADD CONSTRAINT todo_pkey PRIMARY KEY (id);


--
-- Name: travel_disruptions travel_disruptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.travel_disruptions
    ADD CONSTRAINT travel_disruptions_pkey PRIMARY KEY (id);


--
-- Name: triad_jobs triad_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.triad_jobs
    ADD CONSTRAINT triad_jobs_pkey PRIMARY KEY (id);


--
-- Name: triad_jobs triad_jobs_snapshot_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.triad_jobs
    ADD CONSTRAINT triad_jobs_snapshot_id_unique UNIQUE (snapshot_id);


--
-- Name: market_cities us_market_cities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_cities
    ADD CONSTRAINT us_market_cities_pkey PRIMARY KEY (id);


--
-- Name: user_intel_notes user_intel_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_intel_notes
    ADD CONSTRAINT user_intel_notes_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: vehicle_makes_cache vehicle_makes_cache_make_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_makes_cache
    ADD CONSTRAINT vehicle_makes_cache_make_id_unique UNIQUE (make_id);


--
-- Name: vehicle_makes_cache vehicle_makes_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_makes_cache
    ADD CONSTRAINT vehicle_makes_cache_pkey PRIMARY KEY (id);


--
-- Name: vehicle_models_cache vehicle_models_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_models_cache
    ADD CONSTRAINT vehicle_models_cache_pkey PRIMARY KEY (id);


--
-- Name: venue_catalog venue_catalog_coord_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_catalog
    ADD CONSTRAINT venue_catalog_coord_key_unique UNIQUE (coord_key);


--
-- Name: venue_catalog venue_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_catalog
    ADD CONSTRAINT venue_catalog_pkey PRIMARY KEY (venue_id);


--
-- Name: venue_catalog venue_catalog_place_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_catalog
    ADD CONSTRAINT venue_catalog_place_id_unique UNIQUE (place_id);


--
-- Name: venue_feedback venue_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_feedback
    ADD CONSTRAINT venue_feedback_pkey PRIMARY KEY (id);


--
-- Name: venue_feedback venue_feedback_user_id_ranking_id_place_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_feedback
    ADD CONSTRAINT venue_feedback_user_id_ranking_id_place_id_key UNIQUE (user_id, ranking_id, place_id);


--
-- Name: venue_metrics venue_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_metrics
    ADD CONSTRAINT venue_metrics_pkey PRIMARY KEY (venue_id);


--
-- Name: verification_codes verification_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_codes
    ADD CONSTRAINT verification_codes_pkey PRIMARY KEY (id);


--
-- Name: zone_intelligence zone_intelligence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zone_intelligence
    ADD CONSTRAINT zone_intelligence_pkey PRIMARY KEY (id);


--
-- Name: idx_actions_snapshot_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_actions_snapshot_id ON public.actions USING btree (snapshot_id);


--
-- Name: idx_agent_memory_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_memory_expires ON public.agent_memory USING btree (expires_at);


--
-- Name: idx_agent_memory_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_memory_scope ON public.agent_memory USING btree (scope);


--
-- Name: idx_agent_memory_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_memory_user ON public.agent_memory USING btree (user_id);


--
-- Name: idx_airports_lat_lng; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_airports_lat_lng ON public.airports USING btree (lat, lng);


--
-- Name: idx_assistant_memory_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assistant_memory_expires ON public.assistant_memory USING btree (expires_at);


--
-- Name: idx_assistant_memory_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assistant_memory_scope ON public.assistant_memory USING btree (scope);


--
-- Name: idx_assistant_memory_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assistant_memory_user ON public.assistant_memory USING btree (user_id);


--
-- Name: idx_auth_credentials_reset_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_credentials_reset_token ON public.auth_credentials USING btree (password_reset_token);


--
-- Name: idx_claude_memory_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_claude_memory_category ON public.claude_memory USING btree (category);


--
-- Name: idx_claude_memory_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_claude_memory_session ON public.claude_memory USING btree (session_id);


--
-- Name: idx_claude_memory_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_claude_memory_status ON public.claude_memory USING btree (status);


--
-- Name: idx_coach_conversations_conversation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_conversations_conversation_id ON public.coach_conversations USING btree (conversation_id);


--
-- Name: idx_coach_conversations_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_conversations_created_at ON public.coach_conversations USING btree (created_at DESC);


--
-- Name: idx_coach_conversations_market_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_conversations_market_slug ON public.coach_conversations USING btree (market_slug);


--
-- Name: idx_coach_conversations_snapshot_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_conversations_snapshot_id ON public.coach_conversations USING btree (snapshot_id);


--
-- Name: idx_coach_conversations_topic_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_conversations_topic_tags ON public.coach_conversations USING gin (topic_tags);


--
-- Name: idx_coach_conversations_user_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_conversations_user_conv ON public.coach_conversations USING btree (user_id, conversation_id, created_at);


--
-- Name: idx_coach_conversations_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_conversations_user_id ON public.coach_conversations USING btree (user_id);


--
-- Name: idx_coach_memos_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_memos_created_at ON public.coach_memos USING btree (created_at DESC);


--
-- Name: idx_coach_memos_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_memos_status ON public.coach_memos USING btree (status);


--
-- Name: idx_coach_system_notes_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_system_notes_category ON public.coach_system_notes USING btree (category);


--
-- Name: idx_coach_system_notes_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_system_notes_created_at ON public.coach_system_notes USING btree (created_at DESC);


--
-- Name: idx_coach_system_notes_note_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_system_notes_note_type ON public.coach_system_notes USING btree (note_type);


--
-- Name: idx_coach_system_notes_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_system_notes_priority ON public.coach_system_notes USING btree (priority DESC);


--
-- Name: idx_coach_system_notes_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_system_notes_status ON public.coach_system_notes USING btree (status);


--
-- Name: idx_cod_agreement; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cod_agreement ON public.coach_offer_decisions USING btree (ai_recommendation, user_decision) WHERE (user_decision IS NOT NULL);


--
-- Name: idx_cod_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cod_conversation ON public.coach_offer_decisions USING btree (conversation_id) WHERE (conversation_id IS NOT NULL);


--
-- Name: idx_cod_offer_intel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cod_offer_intel ON public.coach_offer_decisions USING btree (offer_intelligence_id) WHERE (offer_intelligence_id IS NOT NULL);


--
-- Name: idx_cod_snapshot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cod_snapshot ON public.coach_offer_decisions USING btree (snapshot_id) WHERE (snapshot_id IS NOT NULL);


--
-- Name: idx_cod_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cod_user_created ON public.coach_offer_decisions USING btree (user_id, created_at DESC);


--
-- Name: idx_concierge_feedback_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_concierge_feedback_created ON public.concierge_feedback USING btree (created_at);


--
-- Name: idx_concierge_feedback_driver; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_concierge_feedback_driver ON public.concierge_feedback USING btree (driver_profile_id);


--
-- Name: idx_connection_audit_event_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_connection_audit_event_time ON public.connection_audit USING btree (event, occurred_at DESC);


--
-- Name: idx_coords_cache_city_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coords_cache_city_state ON public.coords_cache USING btree (city, state);


--
-- Name: idx_cross_thread_memory_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cross_thread_memory_expires ON public.cross_thread_memory USING btree (expires_at);


--
-- Name: idx_cross_thread_memory_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cross_thread_memory_scope ON public.cross_thread_memory USING btree (scope);


--
-- Name: idx_cross_thread_memory_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cross_thread_memory_user ON public.cross_thread_memory USING btree (user_id);


--
-- Name: idx_discovered_events_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_discovered_events_category ON public.discovered_events USING btree (category);


--
-- Name: idx_discovered_events_city; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_discovered_events_city ON public.discovered_events USING btree (city, state);


--
-- Name: idx_discovered_events_discovered_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_discovered_events_discovered_at ON public.discovered_events USING btree (discovered_at DESC);


--
-- Name: idx_discovered_events_start_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_discovered_events_start_date ON public.discovered_events USING btree (event_start_date);


--
-- Name: idx_discovered_events_venue_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_discovered_events_venue_id ON public.discovered_events USING btree (venue_id) WHERE (venue_id IS NOT NULL);


--
-- Name: idx_discovered_traffic_snapshot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_discovered_traffic_snapshot ON public.discovered_traffic USING btree (snapshot_id);


--
-- Name: idx_dp_shortcut_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dp_shortcut_token ON public.driver_profiles USING btree (shortcut_token) WHERE (shortcut_token IS NOT NULL);


--
-- Name: idx_driver_profiles_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_driver_profiles_market ON public.driver_profiles USING btree (market);


--
-- Name: idx_driver_profiles_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_driver_profiles_phone ON public.driver_profiles USING btree (phone);


--
-- Name: idx_driver_vehicles_profile_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_driver_vehicles_profile_id ON public.driver_vehicles USING btree (driver_profile_id);


--
-- Name: idx_eidolon_memory_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eidolon_memory_expires ON public.eidolon_memory USING btree (expires_at);


--
-- Name: idx_eidolon_memory_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eidolon_memory_scope ON public.eidolon_memory USING btree (scope);


--
-- Name: idx_eidolon_memory_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eidolon_memory_user ON public.eidolon_memory USING btree (user_id);


--
-- Name: idx_intercepted_signals_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_intercepted_signals_created ON public.intercepted_signals USING btree (device_id, created_at DESC);


--
-- Name: idx_intercepted_signals_device_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_intercepted_signals_device_id ON public.intercepted_signals USING btree (device_id);


--
-- Name: idx_intercepted_signals_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_intercepted_signals_market ON public.intercepted_signals USING btree (market, created_at DESC) WHERE (market IS NOT NULL);


--
-- Name: idx_intercepted_signals_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_intercepted_signals_user_id ON public.intercepted_signals USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_market_cities_country_city_state; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_market_cities_country_city_state ON public.market_cities USING btree (country_code, state, city);


--
-- Name: idx_market_cities_market_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_cities_market_name ON public.market_cities USING btree (market_name);


--
-- Name: idx_market_cities_region_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_cities_region_type ON public.market_cities USING btree (region_type);


--
-- Name: idx_market_intelligence_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_intelligence_active ON public.market_intelligence USING btree (is_active);


--
-- Name: idx_market_intelligence_coach_cite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_intelligence_coach_cite ON public.market_intelligence USING btree (coach_can_cite, coach_priority);


--
-- Name: idx_market_intelligence_intel_subtype; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_intelligence_intel_subtype ON public.market_intelligence USING btree (intel_subtype);


--
-- Name: idx_market_intelligence_intel_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_intelligence_intel_type ON public.market_intelligence USING btree (intel_type);


--
-- Name: idx_market_intelligence_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_intelligence_market ON public.market_intelligence USING btree (market);


--
-- Name: idx_market_intelligence_market_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_intelligence_market_slug ON public.market_intelligence USING btree (market_slug);


--
-- Name: idx_market_intelligence_market_type_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_intelligence_market_type_active ON public.market_intelligence USING btree (market_slug, intel_type, is_active);


--
-- Name: idx_market_intelligence_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_intelligence_platform ON public.market_intelligence USING btree (platform);


--
-- Name: idx_market_intelligence_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_intelligence_source ON public.market_intelligence USING btree (source);


--
-- Name: idx_market_intelligence_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_intelligence_tags ON public.market_intelligence USING gin (tags);


--
-- Name: idx_news_deactivations_news_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_news_deactivations_news_hash ON public.news_deactivations USING btree (news_hash);


--
-- Name: idx_news_deactivations_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_news_deactivations_unique ON public.news_deactivations USING btree (user_id, news_hash);


--
-- Name: idx_news_deactivations_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_news_deactivations_user_id ON public.news_deactivations USING btree (user_id);


--
-- Name: idx_oauth_states_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oauth_states_expires ON public.oauth_states USING btree (expires_at);


--
-- Name: idx_oi_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oi_created_at ON public.offer_intelligence USING btree (created_at DESC);


--
-- Name: idx_oi_date_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oi_date_platform ON public.offer_intelligence USING btree (local_date, platform, per_mile) WHERE (local_date IS NOT NULL);


--
-- Name: idx_oi_device_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oi_device_created ON public.offer_intelligence USING btree (device_id, created_at DESC);


--
-- Name: idx_oi_driver_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oi_driver_location ON public.offer_intelligence USING btree (driver_lat, driver_lng) WHERE (driver_lat IS NOT NULL);


--
-- Name: idx_oi_h3_decision; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oi_h3_decision ON public.offer_intelligence USING btree (h3_index, decision) WHERE (h3_index IS NOT NULL);


--
-- Name: idx_oi_market_daypart; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oi_market_daypart ON public.offer_intelligence USING btree (market, day_part, platform) WHERE (market IS NOT NULL);


--
-- Name: idx_oi_need_geocode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oi_need_geocode ON public.offer_intelligence USING btree (id) WHERE ((geocoded_at IS NULL) AND (pickup_address IS NOT NULL));


--
-- Name: idx_oi_override; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oi_override ON public.offer_intelligence USING btree (device_id, user_override) WHERE (user_override IS NOT NULL);


--
-- Name: idx_oi_per_mile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oi_per_mile ON public.offer_intelligence USING btree (per_mile DESC) WHERE (per_mile IS NOT NULL);


--
-- Name: idx_oi_session_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oi_session_seq ON public.offer_intelligence USING btree (offer_session_id, offer_sequence_num) WHERE (offer_session_id IS NOT NULL);


--
-- Name: idx_oi_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oi_user_id ON public.offer_intelligence USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_oi_weekend_hour; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oi_weekend_hour ON public.offer_intelligence USING btree (is_weekend, local_hour, platform) WHERE (is_weekend IS NOT NULL);


--
-- Name: idx_outcome_decision; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outcome_decision ON public.offer_outcomes USING btree (driver_decision) WHERE (driver_decision IS NOT NULL);


--
-- Name: idx_outcome_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outcome_user_created ON public.offer_outcomes USING btree (user_id, created_at DESC);


--
-- Name: idx_platform_data_city_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_data_city_region ON public.platform_data USING btree (city, region);


--
-- Name: idx_platform_data_country; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_data_country ON public.platform_data USING btree (country);


--
-- Name: idx_platform_data_country_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_data_country_code ON public.platform_data USING btree (country_code);


--
-- Name: idx_platform_data_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_data_market ON public.platform_data USING btree (market);


--
-- Name: idx_platform_data_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_data_platform ON public.platform_data USING btree (platform);


--
-- Name: idx_platform_data_platform_country; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_data_platform_country ON public.platform_data USING btree (platform, country);


--
-- Name: idx_platform_data_unique_location; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_platform_data_unique_location ON public.platform_data USING btree (platform, country, COALESCE(region, ''::text), city);


--
-- Name: idx_ranking_candidates_ranking_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ranking_candidates_ranking_id ON public.ranking_candidates USING btree (ranking_id);


--
-- Name: idx_ranking_candidates_snapshot_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ranking_candidates_snapshot_id ON public.ranking_candidates USING btree (snapshot_id);


--
-- Name: idx_ranking_candidates_venue_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ranking_candidates_venue_id ON public.ranking_candidates USING btree (venue_id) WHERE (venue_id IS NOT NULL);


--
-- Name: idx_umc_market_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_umc_market_slug ON public.market_cities USING btree (market_slug);


--
-- Name: idx_user_intel_notes_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_intel_notes_active ON public.user_intel_notes USING btree (is_active);


--
-- Name: idx_user_intel_notes_market_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_intel_notes_market_slug ON public.user_intel_notes USING btree (market_slug);


--
-- Name: idx_user_intel_notes_note_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_intel_notes_note_type ON public.user_intel_notes USING btree (note_type);


--
-- Name: idx_user_intel_notes_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_intel_notes_user_active ON public.user_intel_notes USING btree (user_id, is_active, importance);


--
-- Name: idx_user_intel_notes_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_intel_notes_user_id ON public.user_intel_notes USING btree (user_id);


--
-- Name: idx_vehicle_makes_cache_common; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicle_makes_cache_common ON public.vehicle_makes_cache USING btree (is_common);


--
-- Name: idx_vehicle_makes_cache_make_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicle_makes_cache_make_name ON public.vehicle_makes_cache USING btree (make_name);


--
-- Name: idx_vehicle_models_cache_make_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicle_models_cache_make_year ON public.vehicle_models_cache USING btree (make_id, model_year);


--
-- Name: idx_vehicle_models_cache_model_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicle_models_cache_model_name ON public.vehicle_models_cache USING btree (model_name);


--
-- Name: idx_vehicle_models_cache_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_vehicle_models_cache_unique ON public.vehicle_models_cache USING btree (make_id, model_id, COALESCE(model_year, 0));


--
-- Name: idx_venue_catalog_city_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venue_catalog_city_state ON public.venue_catalog USING btree (city, state);


--
-- Name: idx_venue_catalog_expense_rank; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venue_catalog_expense_rank ON public.venue_catalog USING btree (expense_rank) WHERE (expense_rank IS NOT NULL);


--
-- Name: idx_venue_catalog_is_bar; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venue_catalog_is_bar ON public.venue_catalog USING btree (is_bar) WHERE (is_bar = true);


--
-- Name: idx_venue_catalog_is_event_venue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venue_catalog_is_event_venue ON public.venue_catalog USING btree (is_event_venue) WHERE (is_event_venue = true);


--
-- Name: idx_venue_catalog_market_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venue_catalog_market_slug ON public.venue_catalog USING btree (market_slug);


--
-- Name: idx_venue_catalog_normalized_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venue_catalog_normalized_name ON public.venue_catalog USING btree (normalized_name);


--
-- Name: idx_venue_catalog_record_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venue_catalog_record_status ON public.venue_catalog USING btree (record_status);


--
-- Name: idx_venue_catalog_venue_types; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venue_catalog_venue_types ON public.venue_catalog USING gin (venue_types);


--
-- Name: idx_venue_feedback_snapshot_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venue_feedback_snapshot_id ON public.venue_feedback USING btree (snapshot_id);


--
-- Name: idx_verification_codes_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_verification_codes_code ON public.verification_codes USING btree (code);


--
-- Name: idx_verification_codes_destination; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_verification_codes_destination ON public.verification_codes USING btree (destination);


--
-- Name: idx_verification_codes_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_verification_codes_expires ON public.verification_codes USING btree (expires_at);


--
-- Name: idx_verification_codes_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_verification_codes_user_id ON public.verification_codes USING btree (user_id);


--
-- Name: idx_zone_intelligence_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_zone_intelligence_active ON public.zone_intelligence USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_zone_intelligence_confidence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_zone_intelligence_confidence ON public.zone_intelligence USING btree (confidence_score DESC);


--
-- Name: idx_zone_intelligence_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_zone_intelligence_location ON public.zone_intelligence USING btree (lat, lng) WHERE (lat IS NOT NULL);


--
-- Name: idx_zone_intelligence_market_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_zone_intelligence_market_slug ON public.zone_intelligence USING btree (market_slug);


--
-- Name: idx_zone_intelligence_market_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_zone_intelligence_market_type ON public.zone_intelligence USING btree (market_slug, zone_type);


--
-- Name: idx_zone_intelligence_zone_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_zone_intelligence_zone_type ON public.zone_intelligence USING btree (zone_type);


--
-- Name: ix_feedback_place; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_feedback_place ON public.venue_feedback USING btree (place_id);


--
-- Name: ix_feedback_ranking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_feedback_ranking ON public.venue_feedback USING btree (ranking_id);


--
-- Name: uq_outcome_offer; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_outcome_offer ON public.offer_outcomes USING btree (offer_intelligence_id) WHERE (offer_intelligence_id IS NOT NULL);


--
-- Name: claude_memory claude_memory_antecedent_check_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER claude_memory_antecedent_check_trigger BEFORE INSERT ON public.claude_memory FOR EACH ROW EXECUTE FUNCTION public.claude_memory_antecedent_check();


--
-- Name: strategies trg_strategy_ready_v2; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_strategy_ready_v2 AFTER UPDATE ON public.strategies FOR EACH ROW WHEN (((new.status = ANY (ARRAY['ok'::text, 'pending_blocks'::text])) AND (new.strategy_for_now IS NOT NULL))) EXECUTE FUNCTION public.notify_strategy_ready_v2();


--
-- Name: strategies trg_strategy_ready_v2_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_strategy_ready_v2_insert AFTER INSERT ON public.strategies FOR EACH ROW WHEN (((new.status = ANY (ARRAY['ok'::text, 'pending_blocks'::text])) AND (new.strategy_for_now IS NOT NULL))) EXECUTE FUNCTION public.notify_strategy_ready_v2();


--
-- Name: agent_memory trg_touch_agent_memory; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_touch_agent_memory BEFORE UPDATE ON public.agent_memory FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: assistant_memory trg_touch_assistant; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_touch_assistant BEFORE UPDATE ON public.assistant_memory FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: eidolon_memory trg_touch_eidolon; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_touch_eidolon BEFORE UPDATE ON public.eidolon_memory FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: actions actions_ranking_id_rankings_ranking_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_ranking_id_rankings_ranking_id_fk FOREIGN KEY (ranking_id) REFERENCES public.rankings(ranking_id) ON DELETE CASCADE;


--
-- Name: actions actions_snapshot_id_snapshots_snapshot_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_snapshot_id_snapshots_snapshot_id_fk FOREIGN KEY (snapshot_id) REFERENCES public.snapshots(snapshot_id) ON DELETE CASCADE;


--
-- Name: app_feedback app_feedback_snapshot_id_snapshots_snapshot_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_feedback
    ADD CONSTRAINT app_feedback_snapshot_id_snapshots_snapshot_id_fk FOREIGN KEY (snapshot_id) REFERENCES public.snapshots(snapshot_id) ON DELETE CASCADE;


--
-- Name: app_rules app_rules_superseded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_rules
    ADD CONSTRAINT app_rules_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES public.app_rules(id);


--
-- Name: auth_credentials auth_credentials_user_id_users_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_credentials
    ADD CONSTRAINT auth_credentials_user_id_users_user_id_fk FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE RESTRICT;


--
-- Name: briefings briefings_snapshot_id_snapshots_snapshot_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.briefings
    ADD CONSTRAINT briefings_snapshot_id_snapshots_snapshot_id_fk FOREIGN KEY (snapshot_id) REFERENCES public.snapshots(snapshot_id) ON DELETE CASCADE;


--
-- Name: coach_conversations coach_conversations_snapshot_id_snapshots_snapshot_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_conversations
    ADD CONSTRAINT coach_conversations_snapshot_id_snapshots_snapshot_id_fk FOREIGN KEY (snapshot_id) REFERENCES public.snapshots(snapshot_id) ON DELETE SET NULL;


--
-- Name: coach_conversations coach_conversations_user_id_users_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_conversations
    ADD CONSTRAINT coach_conversations_user_id_users_user_id_fk FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE RESTRICT;


--
-- Name: coach_memos coach_memos_triggering_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_memos
    ADD CONSTRAINT coach_memos_triggering_snapshot_id_fkey FOREIGN KEY (triggering_snapshot_id) REFERENCES public.snapshots(snapshot_id) ON DELETE SET NULL;


--
-- Name: coach_memos coach_memos_triggering_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_memos
    ADD CONSTRAINT coach_memos_triggering_user_id_fkey FOREIGN KEY (triggering_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: coach_offer_decisions coach_offer_decisions_offer_intelligence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_offer_decisions
    ADD CONSTRAINT coach_offer_decisions_offer_intelligence_id_fkey FOREIGN KEY (offer_intelligence_id) REFERENCES public.offer_intelligence(id) ON DELETE SET NULL;


--
-- Name: coach_offer_decisions coach_offer_decisions_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_offer_decisions
    ADD CONSTRAINT coach_offer_decisions_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.snapshots(snapshot_id) ON DELETE SET NULL;


--
-- Name: coach_offer_decisions coach_offer_decisions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_offer_decisions
    ADD CONSTRAINT coach_offer_decisions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: coach_system_notes coach_system_notes_triggering_snapshot_id_snapshots_snapshot_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_system_notes
    ADD CONSTRAINT coach_system_notes_triggering_snapshot_id_snapshots_snapshot_id FOREIGN KEY (triggering_snapshot_id) REFERENCES public.snapshots(snapshot_id) ON DELETE SET NULL;


--
-- Name: coach_system_notes coach_system_notes_triggering_user_id_users_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_system_notes
    ADD CONSTRAINT coach_system_notes_triggering_user_id_users_user_id_fk FOREIGN KEY (triggering_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: concierge_feedback concierge_feedback_driver_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concierge_feedback
    ADD CONSTRAINT concierge_feedback_driver_profile_id_fkey FOREIGN KEY (driver_profile_id) REFERENCES public.driver_profiles(id) ON DELETE CASCADE;


--
-- Name: discovered_events discovered_events_venue_id_venue_catalog_venue_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discovered_events
    ADD CONSTRAINT discovered_events_venue_id_venue_catalog_venue_id_fk FOREIGN KEY (venue_id) REFERENCES public.venue_catalog(venue_id) ON DELETE SET NULL;


--
-- Name: discovered_traffic discovered_traffic_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discovered_traffic
    ADD CONSTRAINT discovered_traffic_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.snapshots(snapshot_id) ON DELETE CASCADE;


--
-- Name: driver_profiles driver_profiles_user_id_users_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_profiles
    ADD CONSTRAINT driver_profiles_user_id_users_user_id_fk FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE RESTRICT;


--
-- Name: driver_vehicles driver_vehicles_driver_profile_id_driver_profiles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_vehicles
    ADD CONSTRAINT driver_vehicles_driver_profile_id_driver_profiles_id_fk FOREIGN KEY (driver_profile_id) REFERENCES public.driver_profiles(id) ON DELETE CASCADE;


--
-- Name: market_cities fk_market_cities_market_slug; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_cities
    ADD CONSTRAINT fk_market_cities_market_slug FOREIGN KEY (market_slug) REFERENCES public.markets(market_slug);


--
-- Name: news_deactivations news_deactivations_user_id_users_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_deactivations
    ADD CONSTRAINT news_deactivations_user_id_users_user_id_fk FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE RESTRICT;


--
-- Name: offer_outcomes offer_outcomes_offer_intelligence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_outcomes
    ADD CONSTRAINT offer_outcomes_offer_intelligence_id_fkey FOREIGN KEY (offer_intelligence_id) REFERENCES public.offer_intelligence(id) ON DELETE SET NULL;


--
-- Name: offer_outcomes offer_outcomes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_outcomes
    ADD CONSTRAINT offer_outcomes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE RESTRICT;


--
-- Name: offer_rulesets offer_rulesets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_rulesets
    ADD CONSTRAINT offer_rulesets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE RESTRICT;


--
-- Name: ranking_candidates ranking_candidates_ranking_id_rankings_ranking_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ranking_candidates
    ADD CONSTRAINT ranking_candidates_ranking_id_rankings_ranking_id_fk FOREIGN KEY (ranking_id) REFERENCES public.rankings(ranking_id) ON DELETE CASCADE;


--
-- Name: ranking_candidates ranking_candidates_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ranking_candidates
    ADD CONSTRAINT ranking_candidates_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venue_catalog(venue_id) ON DELETE SET NULL;


--
-- Name: rankings rankings_snapshot_id_snapshots_snapshot_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rankings
    ADD CONSTRAINT rankings_snapshot_id_snapshots_snapshot_id_fk FOREIGN KEY (snapshot_id) REFERENCES public.snapshots(snapshot_id) ON DELETE CASCADE;


--
-- Name: strategies strategies_snapshot_id_snapshots_snapshot_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strategies
    ADD CONSTRAINT strategies_snapshot_id_snapshots_snapshot_id_fk FOREIGN KEY (snapshot_id) REFERENCES public.snapshots(snapshot_id) ON DELETE CASCADE;


--
-- Name: strategy_feedback strategy_feedback_ranking_id_rankings_ranking_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strategy_feedback
    ADD CONSTRAINT strategy_feedback_ranking_id_rankings_ranking_id_fk FOREIGN KEY (ranking_id) REFERENCES public.rankings(ranking_id) ON DELETE CASCADE;


--
-- Name: strategy_feedback strategy_feedback_snapshot_id_snapshots_snapshot_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strategy_feedback
    ADD CONSTRAINT strategy_feedback_snapshot_id_snapshots_snapshot_id_fk FOREIGN KEY (snapshot_id) REFERENCES public.snapshots(snapshot_id) ON DELETE CASCADE;


--
-- Name: triad_jobs triad_jobs_snapshot_id_snapshots_snapshot_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.triad_jobs
    ADD CONSTRAINT triad_jobs_snapshot_id_snapshots_snapshot_id_fk FOREIGN KEY (snapshot_id) REFERENCES public.snapshots(snapshot_id) ON DELETE CASCADE;


--
-- Name: user_intel_notes user_intel_notes_snapshot_id_snapshots_snapshot_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_intel_notes
    ADD CONSTRAINT user_intel_notes_snapshot_id_snapshots_snapshot_id_fk FOREIGN KEY (snapshot_id) REFERENCES public.snapshots(snapshot_id) ON DELETE SET NULL;


--
-- Name: user_intel_notes user_intel_notes_user_id_users_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_intel_notes
    ADD CONSTRAINT user_intel_notes_user_id_users_user_id_fk FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: venue_catalog venue_catalog_market_slug_markets_market_slug_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_catalog
    ADD CONSTRAINT venue_catalog_market_slug_markets_market_slug_fk FOREIGN KEY (market_slug) REFERENCES public.markets(market_slug);


--
-- Name: venue_feedback venue_feedback_ranking_id_rankings_ranking_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_feedback
    ADD CONSTRAINT venue_feedback_ranking_id_rankings_ranking_id_fk FOREIGN KEY (ranking_id) REFERENCES public.rankings(ranking_id) ON DELETE CASCADE;


--
-- Name: venue_feedback venue_feedback_snapshot_id_snapshots_snapshot_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_feedback
    ADD CONSTRAINT venue_feedback_snapshot_id_snapshots_snapshot_id_fk FOREIGN KEY (snapshot_id) REFERENCES public.snapshots(snapshot_id) ON DELETE CASCADE;


--
-- Name: venue_metrics venue_metrics_venue_id_venue_catalog_venue_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_metrics
    ADD CONSTRAINT venue_metrics_venue_id_venue_catalog_venue_id_fk FOREIGN KEY (venue_id) REFERENCES public.venue_catalog(venue_id);


--
-- Name: verification_codes verification_codes_user_id_users_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_codes
    ADD CONSTRAINT verification_codes_user_id_users_user_id_fk FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: zone_intelligence zone_intelligence_last_reported_by_users_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zone_intelligence
    ADD CONSTRAINT zone_intelligence_last_reported_by_users_user_id_fk FOREIGN KEY (last_reported_by) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: agent_memory; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_memory ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_memory p_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_select ON public.agent_memory FOR SELECT USING (((user_id = app.current_user_id()) OR (app.current_user_id() IS NULL)));


--
-- Name: agent_memory p_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_write ON public.agent_memory USING (((user_id = app.current_user_id()) OR (app.current_user_id() IS NULL))) WITH CHECK (((user_id = app.current_user_id()) OR (app.current_user_id() IS NULL)));


--
-- PostgreSQL database dump complete
--


