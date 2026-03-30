-- Vecto Pilot - Create all 19 tables from shared/schema.js
-- Generated from Drizzle schema for emergency recovery

-- Table 1: snapshots
CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  user_id UUID,
  device_id UUID NOT NULL,
  session_id UUID NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  accuracy_m DOUBLE PRECISION,
  coord_source TEXT NOT NULL,
  city TEXT,
  state TEXT,
  country TEXT,
  formatted_address TEXT,
  timezone TEXT,
  local_iso TIMESTAMP,
  dow INTEGER,
  hour INTEGER,
  day_part_key TEXT,
  h3_r8 TEXT,
  weather JSONB,
  air JSONB,
  airport_context JSONB,
  local_news JSONB,
  device JSONB,
  permissions JSONB,
  extras JSONB,
  last_strategy_day_part TEXT DEFAULT NULL,
  trigger_reason TEXT DEFAULT NULL
);

-- Table 2: strategies
CREATE TABLE IF NOT EXISTS strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL UNIQUE REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
  correlation_id UUID,
  strategy TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_code INTEGER,
  error_message TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  latency_ms INTEGER,
  tokens INTEGER,
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  model_name TEXT,
  model_params JSONB,
  prompt_version TEXT,
  strategy_for_now TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  city TEXT
);

-- Table 3: rankings
CREATE TABLE IF NOT EXISTS rankings (
  ranking_id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  snapshot_id UUID REFERENCES snapshots(snapshot_id),
  correlation_id UUID,
  user_id UUID,
  city TEXT,
  ui JSONB,
  model_name TEXT NOT NULL,
  scoring_ms INTEGER,
  planner_ms INTEGER,
  total_ms INTEGER,
  timed_out BOOLEAN DEFAULT FALSE,
  path_taken TEXT
);

-- Table 4: ranking_candidates
CREATE TABLE IF NOT EXISTS ranking_candidates (
  id UUID PRIMARY KEY,
  ranking_id UUID NOT NULL REFERENCES rankings(ranking_id) ON DELETE CASCADE,
  block_id TEXT NOT NULL,
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  drive_time_min INTEGER,
  straight_line_km DOUBLE PRECISION,
  est_earnings_per_ride DOUBLE PRECISION,
  model_score DOUBLE PRECISION,
  rank INTEGER NOT NULL,
  exploration_policy TEXT NOT NULL,
  epsilon DOUBLE PRECISION,
  was_forced BOOLEAN,
  propensity DOUBLE PRECISION,
  features JSONB,
  h3_r8 TEXT,
  distance_miles DOUBLE PRECISION,
  drive_minutes INTEGER,
  value_per_min DOUBLE PRECISION,
  value_grade TEXT,
  not_worth BOOLEAN,
  rate_per_min_used DOUBLE PRECISION,
  trip_minutes_used INTEGER,
  wait_minutes_used INTEGER,
  snapshot_id UUID,
  place_id TEXT,
  estimated_distance_miles DOUBLE PRECISION,
  drive_time_minutes INTEGER,
  distance_source TEXT,
  pro_tips TEXT[],
  closed_reasoning TEXT,
  staging_tips TEXT,
  venue_events JSONB
);

-- Indexes for ranking_candidates
CREATE INDEX IF NOT EXISTS idx_ranking_candidates_ranking_id ON ranking_candidates(ranking_id);
CREATE INDEX IF NOT EXISTS idx_ranking_candidates_snapshot_id ON ranking_candidates(snapshot_id);

-- Table 5: actions
CREATE TABLE IF NOT EXISTS actions (
  action_id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  ranking_id UUID REFERENCES rankings(ranking_id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
  user_id UUID,
  action TEXT NOT NULL,
  block_id TEXT,
  dwell_ms INTEGER,
  from_rank INTEGER,
  raw JSONB
);

-- Index for actions
CREATE INDEX IF NOT EXISTS idx_actions_snapshot_id ON actions(snapshot_id);

-- Table 6: venue_catalog
CREATE TABLE IF NOT EXISTS venue_catalog (
  venue_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id TEXT UNIQUE,
  venue_name VARCHAR(500) NOT NULL,
  address VARCHAR(500) NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  category TEXT NOT NULL,
  dayparts TEXT[],
  staging_notes JSONB,
  city TEXT,
  metro TEXT,
  ai_estimated_hours TEXT,
  business_hours JSONB,
  discovery_source TEXT NOT NULL DEFAULT 'seed',
  validated_at TIMESTAMPTZ,
  suggestion_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_known_status TEXT DEFAULT 'unknown',
  status_checked_at TIMESTAMPTZ,
  consecutive_closed_checks INTEGER DEFAULT 0,
  auto_suppressed BOOLEAN DEFAULT FALSE,
  suppression_reason TEXT
);

-- Table 7: venue_metrics
CREATE TABLE IF NOT EXISTS venue_metrics (
  venue_id UUID PRIMARY KEY REFERENCES venue_catalog(venue_id),
  times_recommended INTEGER NOT NULL DEFAULT 0,
  times_chosen INTEGER NOT NULL DEFAULT 0,
  positive_feedback INTEGER NOT NULL DEFAULT 0,
  negative_feedback INTEGER NOT NULL DEFAULT 0,
  reliability_score DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  last_verified_by_driver TIMESTAMPTZ
);

-- Table 8: triad_jobs
CREATE TABLE IF NOT EXISTS triad_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'triad',
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(snapshot_id, kind)
);

-- Table 9: http_idem
CREATE TABLE IF NOT EXISTS http_idem (
  key TEXT PRIMARY KEY,
  status INTEGER NOT NULL,
  body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table 10: places_cache
-- 2026-01-10: D-013 Fix - Renamed place_id → coords_key for semantic accuracy
-- Column stores coordinate keys (lat_lng format), not Google Place IDs
CREATE TABLE IF NOT EXISTS places_cache (
  coords_key TEXT PRIMARY KEY,
  formatted_hours JSONB,
  cached_at TIMESTAMPTZ NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0
);

-- Table 11: venue_feedback
CREATE TABLE IF NOT EXISTS venue_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  snapshot_id UUID NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
  ranking_id UUID NOT NULL REFERENCES rankings(ranking_id) ON DELETE CASCADE,
  place_id TEXT,
  venue_name TEXT NOT NULL,
  sentiment TEXT NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, ranking_id, place_id)
);

-- Indexes for venue_feedback
CREATE INDEX IF NOT EXISTS ix_feedback_ranking ON venue_feedback(ranking_id);
CREATE INDEX IF NOT EXISTS ix_feedback_place ON venue_feedback(place_id);
CREATE INDEX IF NOT EXISTS idx_venue_feedback_snapshot_id ON venue_feedback(snapshot_id);

-- Table 12: strategy_feedback
CREATE TABLE IF NOT EXISTS strategy_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  snapshot_id UUID NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
  ranking_id UUID NOT NULL REFERENCES rankings(ranking_id) ON DELETE CASCADE,
  sentiment TEXT NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, ranking_id)
);

-- Table 13: app_feedback
CREATE TABLE IF NOT EXISTS app_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
  sentiment TEXT NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table 14: travel_disruptions
CREATE TABLE IF NOT EXISTS travel_disruptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code TEXT NOT NULL DEFAULT 'US',
  airport_code TEXT NOT NULL,
  airport_name TEXT,
  delay_minutes INTEGER DEFAULT 0,
  ground_stops JSONB DEFAULT '[]'::jsonb,
  ground_delay_programs JSONB DEFAULT '[]'::jsonb,
  closure_status TEXT DEFAULT 'open',
  delay_reason TEXT,
  ai_summary TEXT,
  impact_level TEXT DEFAULT 'none',
  data_source TEXT NOT NULL DEFAULT 'FAA',
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_update_at TIMESTAMPTZ
);

-- Table 15: llm_venue_suggestions
CREATE TABLE IF NOT EXISTS llm_venue_suggestions (
  suggestion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suggested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  model_name TEXT NOT NULL,
  ranking_id UUID REFERENCES rankings(ranking_id),
  venue_name TEXT NOT NULL,
  suggested_category TEXT,
  llm_reasoning TEXT,
  validation_status TEXT NOT NULL DEFAULT 'pending',
  place_id_found TEXT,
  venue_id_created UUID REFERENCES venue_catalog(venue_id),
  validated_at TIMESTAMPTZ,
  rejection_reason TEXT,
  llm_analysis JSONB
);

-- Table 16: agent_memory
CREATE TABLE IF NOT EXISTS agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- Indexes for agent_memory
CREATE INDEX IF NOT EXISTS idx_agent_memory_session ON agent_memory(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_type ON agent_memory(entry_type);

-- Success message
SELECT 'All 19 tables created successfully!' as result;
