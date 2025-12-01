import { pgTable, uuid, timestamp, jsonb, text, integer, boolean, doublePrecision, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Users table: stores user location data ONLY (GPS coords + what they resolve to)
// Authority on: where the user is right now (lat/lng + precise address from geocoding)
// Snapshots table: everything else (weather, time context, enrichments)
export const users = pgTable("users", {
  user_id: uuid("user_id").primaryKey().defaultRandom(),
  device_id: uuid("device_id").notNull(),
  session_id: uuid("session_id"),
  // Coordinates (lat/lng pair) - the core GPS data
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  accuracy_m: doublePrecision("accuracy_m"),
  coord_source: text("coord_source").notNull().default('gps'), // 'gps' | 'manual_city_search' | 'api'
  // Updated coordinates (current position when user moves/refreshes)
  new_lat: doublePrecision("new_lat"),
  new_lng: doublePrecision("new_lng"),
  new_accuracy_m: doublePrecision("new_accuracy_m"),
  // Resolved from coords (what the GPS coordinates resolve to via geocoding)
  formatted_address: text("formatted_address"), // Full street address
  city: text("city"),
  state: text("state"),
  country: text("country"),
  timezone: text("timezone"), // Needed for location-based time calculations
  // Timestamps
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const snapshots = pgTable("snapshots", {
  snapshot_id: uuid("snapshot_id").primaryKey(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
  // User tracking (NOT a FK - snapshots are self-contained)
  user_id: uuid("user_id"),
  device_id: uuid("device_id").notNull(),
  session_id: uuid("session_id").notNull(),
  // Location data (stored at snapshot creation - authoritative source)
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  city: text("city"),
  state: text("state"),
  country: text("country"),
  formatted_address: text("formatted_address"),
  timezone: text("timezone"),
  // Time context (authoritative for this snapshot)
  local_iso: timestamp("local_iso", { withTimezone: false }),
  dow: integer("dow"), // 0=Sunday, 1=Monday, etc.
  hour: integer("hour"),
  day_part_key: text("day_part_key"), // 'morning', 'afternoon', 'evening', etc.
  // H3 geohash for density analysis
  h3_r8: text("h3_r8"),
  // API-enriched contextual data only
  weather: jsonb("weather"),
  air: jsonb("air"),
  airport_context: jsonb("airport_context"),
  local_news: jsonb("local_news"), // Perplexity daily local news affecting rideshare (events, road closures, traffic)
  news_briefing: jsonb("news_briefing"), // Gemini-generated 60-minute briefing (airports, traffic, events, policy, takeaways)
  device: jsonb("device"),
  permissions: jsonb("permissions"),
  extras: jsonb("extras"),
  last_strategy_day_part: text("last_strategy_day_part").default(null),
  trigger_reason: text("trigger_reason").default(null),
  // Holiday information from Perplexity briefing
  holiday: text("holiday"), // Holiday name if today is a holiday (e.g., "Thanksgiving", "Christmas"), null otherwise
  is_holiday: boolean("is_holiday").default(false), // Boolean flag: true if today is a holiday
});

export const strategies = pgTable("strategies", {
  id: uuid("id").primaryKey().defaultRandom(),
  strategy_id: uuid("strategy_id"),
  snapshot_id: uuid("snapshot_id").notNull().unique().references(() => snapshots.snapshot_id, { onDelete: 'cascade' }),
  correlation_id: uuid("correlation_id"),
  strategy: text("strategy"),
  status: text("status").notNull().default("pending"), // pending|ok|failed
  error_code: integer("error_code"),
  error_message: text("error_message"),
  attempt: integer("attempt").notNull().default(1),
  latency_ms: integer("latency_ms"),
  tokens: integer("tokens"),
  next_retry_at: timestamp("next_retry_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // Model version tracking for A/B testing and rollback capability (Issue #34)
  model_name: text("model_name"), // e.g., 'claude-sonnet-4-5-20250929'
  model_params: jsonb("model_params"), // { temperature, max_tokens, etc. }
  prompt_version: text("prompt_version"), // Track prompt template iterations
  strategy_for_now: text('strategy_for_now'), // Unlimited text length
  // Location context where strategy was created (from snapshot)
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  city: text("city"),
  state: text("state"),
  user_address: text("user_address"),
  user_id: uuid("user_id"),
  // Multi-model orchestration outputs (parallel Claude + Gemini → GPT-5 consolidation)
  events: jsonb("events").default([]), // Gemini events feed
  news: jsonb("news").default([]), // Gemini news feed
  traffic: jsonb("traffic").default([]), // Gemini traffic feed
  // Time windowing (freshness-first spec compliance)
  valid_window_start: timestamp("valid_window_start", { withTimezone: true }), // When strategy becomes valid
  valid_window_end: timestamp("valid_window_end", { withTimezone: true }), // When strategy expires (≤ 60 min from start)
  strategy_timestamp: timestamp("strategy_timestamp", { withTimezone: true }), // Generation timestamp
  // User-resolved location (copied from snapshot at creation time)
  user_resolved_address: text("user_resolved_address"),
  user_resolved_city: text("user_resolved_city"),
  user_resolved_state: text("user_resolved_state"),
  // Model-agnostic provider outputs (generic columns for parallel multi-model pipeline)
  minstrategy: text("minstrategy"), // Strategic overview from strategist provider (Claude)
  consolidated_strategy: text("consolidated_strategy"), // Actionable summary for Co-Pilot from consolidator (GPT-5)
  // Holiday detection (written early by holiday-checker for instant UI feedback)
  holiday: text("holiday"), // Holiday name if today is a holiday (e.g., "Thanksgiving", "Christmas")
  // DEPRECATED COLUMNS (Perplexity now writes to briefings table instead)
  briefing_news: jsonb("briefing_news"), 
  briefing_events: jsonb("briefing_events"),
  briefing_traffic: jsonb("briefing_traffic")
});

// Perplexity comprehensive travel briefing + GPT-5 tactical 30-min intelligence
export const briefings = pgTable("briefings", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshot_id: uuid("snapshot_id").notNull().unique().references(() => snapshots.snapshot_id, { onDelete: 'cascade' }),
  // Location context for this briefing
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  city: text("city"),
  state: text("state"),
  // NEW: Structured briefing data from external APIs
  news: jsonb("news"), // Rideshare-relevant news from SerpAPI + Gemini filtering
  weather_current: jsonb("weather_current"), // Current conditions from Google Weather API
  weather_forecast: jsonb("weather_forecast"), // Hourly forecast (next 3-6 hours) from Google Weather API
  traffic_conditions: jsonb("traffic_conditions"), // Traffic data from Google Routes API
  events: jsonb("events"), // Local events affecting rideshare drivers
  // Perplexity comprehensive research (background context)
  global_travel: text("global_travel"), // Global conditions affecting this region
  domestic_travel: text("domestic_travel"), // National/domestic travel conditions
  local_traffic: text("local_traffic"), // Local traffic, construction, incidents
  weather_impacts: text("weather_impacts"), // Weather affecting travel
  events_nearby: text("events_nearby"), // Events within 50 miles
  holidays: text("holidays"), // If today is a holiday
  rideshare_intel: text("rideshare_intel"), // Rideshare-specific intelligence
  citations: jsonb("citations"), // Perplexity source URLs
  // GPT-5 tactical 30-minute intelligence (next 30 min only)
  tactical_traffic: text("tactical_traffic"), // Traffic/incidents for next 30 minutes
  tactical_closures: text("tactical_closures"), // Closures/construction for next 30 minutes
  tactical_enforcement: text("tactical_enforcement"), // Enforcement activity for next 30 minutes
  tactical_sources: text("tactical_sources"), // Sources checked by GPT-5
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rankings = pgTable("rankings", {
  ranking_id: uuid("ranking_id").primaryKey(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  snapshot_id: uuid("snapshot_id").references(() => snapshots.snapshot_id),
  correlation_id: uuid("correlation_id"),
  user_id: uuid("user_id"),
  city: text("city"),
  ui: jsonb("ui"),
  model_name: text("model_name").notNull(),
  scoring_ms: integer("scoring_ms"),
  planner_ms: integer("planner_ms"),
  total_ms: integer("total_ms"),
  timed_out: boolean("timed_out").default(false),
  path_taken: text("path_taken"),
});

export const ranking_candidates = pgTable("ranking_candidates", {
  id: uuid("id").primaryKey(),
  ranking_id: uuid("ranking_id").notNull().references(() => rankings.ranking_id, { onDelete: 'cascade' }),
  block_id: text("block_id").notNull(),
  name: text("name").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  drive_time_min: integer("drive_time_min"),
  straight_line_km: doublePrecision("straight_line_km"),
  est_earnings_per_ride: doublePrecision("est_earnings_per_ride"),
  model_score: doublePrecision("model_score"),
  rank: integer("rank").notNull(),
  exploration_policy: text("exploration_policy").notNull(),
  epsilon: doublePrecision("epsilon"),
  was_forced: boolean("was_forced"),
  propensity: doublePrecision("propensity"),
  features: jsonb("features"),
  h3_r8: text("h3_r8"),
  // Value per minute fields
  distance_miles: doublePrecision("distance_miles"),
  drive_minutes: integer("drive_minutes"),
  value_per_min: doublePrecision("value_per_min"),
  value_grade: text("value_grade"),
  not_worth: boolean("not_worth"),
  rate_per_min_used: doublePrecision("rate_per_min_used"),
  trip_minutes_used: integer("trip_minutes_used"),
  wait_minutes_used: integer("wait_minutes_used"),
  snapshot_id: uuid("snapshot_id"),
  place_id: text("place_id"),
  // Additional workflow trace fields
  estimated_distance_miles: doublePrecision("estimated_distance_miles"),
  drive_time_minutes: integer("drive_time_minutes"),
  distance_source: text("distance_source"),
  // GPT-5 Planner outputs (tactical recommendations)
  pro_tips: text("pro_tips").array(), // Array of tactical tips from planner
  closed_reasoning: text("closed_reasoning"), // Why recommend if closed (strategic timing)
  staging_tips: text("staging_tips"), // Where to park/stage for this venue
  // GPT-5 Staging area coordinates
  staging_name: text("staging_name"), // Name of staging location for verification
  staging_lat: doublePrecision("staging_lat"), // Staging area latitude
  staging_lng: doublePrecision("staging_lng"), // Staging area longitude
  // Google Places enrichment
  business_hours: jsonb("business_hours"), // Business hours from Google Places API
  // Perplexity event research (populated after planner completes)
  venue_events: jsonb("venue_events"), // Today's events at this venue (concerts, games, festivals)
  // Event and venue metadata (used for event proximity scoring and filtering)
  event_badge_missing: boolean("event_badge_missing"), // True if venue should have event badge but it's missing
  node_type: text("node_type"), // Type of venue node: 'venue', 'staging', etc.
  access_status: text("access_status"), // Venue access status: 'public', 'restricted', 'private'
  aliases: text("aliases").array(), // Alternative place IDs for this venue (variations)
}, (table) => ({
  // Foreign key indexes for performance optimization (Issue #28)
  idxRankingId: sql`create index if not exists idx_ranking_candidates_ranking_id on ${table} (ranking_id)`,
  idxSnapshotId: sql`create index if not exists idx_ranking_candidates_snapshot_id on ${table} (snapshot_id)`,
}));

export const actions = pgTable("actions", {
  action_id: uuid("action_id").primaryKey(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
  ranking_id: uuid("ranking_id").references(() => rankings.ranking_id, { onDelete: 'cascade' }),
  snapshot_id: uuid("snapshot_id").notNull().references(() => snapshots.snapshot_id, { onDelete: 'cascade' }),
  user_id: uuid("user_id"),
  action: text("action").notNull(),
  block_id: text("block_id"),
  dwell_ms: integer("dwell_ms"),
  from_rank: integer("from_rank"),
  raw: jsonb("raw"),
}, (table) => ({
  // Foreign key index for performance (Issue #28)
  idxSnapshotId: sql`create index if not exists idx_actions_snapshot_id on ${table} (snapshot_id)`,
}));

export const venue_catalog = pgTable("venue_catalog", {
  venue_id: uuid("venue_id").primaryKey().defaultRandom(),
  place_id: text("place_id").unique(),
  venue_name: varchar('venue_name', { length: 500 }).notNull(), // Max 500 chars
  address: varchar('address', { length: 500 }).notNull(), // Max 500 chars (full address)
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  category: text("category").notNull(),
  dayparts: text("dayparts").array(),
  staging_notes: jsonb("staging_notes"),
  city: text("city"),
  metro: text("metro"),
  ai_estimated_hours: text("ai_estimated_hours"),
  business_hours: jsonb("business_hours"),
  discovery_source: text("discovery_source").notNull().default('seed'),
  validated_at: timestamp("validated_at", { withTimezone: true }),
  suggestion_metadata: jsonb("suggestion_metadata"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Business status tracking to prevent recommending closed venues (Issue #32)
  last_known_status: text("last_known_status").default('unknown'), // 'open' | 'closed' | 'temporarily_closed' | 'permanently_closed' | 'unknown'
  status_checked_at: timestamp("status_checked_at", { withTimezone: true }),
  consecutive_closed_checks: integer("consecutive_closed_checks").default(0),
  auto_suppressed: boolean("auto_suppressed").default(false),
  suppression_reason: text("suppression_reason"),
});

export const venue_metrics = pgTable("venue_metrics", {
  venue_id: uuid("venue_id").primaryKey().references(() => venue_catalog.venue_id),
  times_recommended: integer("times_recommended").notNull().default(0),
  times_chosen: integer("times_chosen").notNull().default(0),
  positive_feedback: integer("positive_feedback").notNull().default(0),
  negative_feedback: integer("negative_feedback").notNull().default(0),
  reliability_score: doublePrecision("reliability_score").notNull().default(0.5),
  last_verified_by_driver: timestamp("last_verified_by_driver", { withTimezone: true }),
});

export const block_jobs = pgTable("block_jobs", {
  id: uuid("id").primaryKey(),
  status: text("status").notNull(), // 'pending' | 'running' | 'succeeded' | 'failed'
  request_body: jsonb("request_body").notNull(),
  result: jsonb("result"),
  error: text("error"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const triad_jobs = pgTable("triad_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshot_id: uuid("snapshot_id").notNull().unique().references(() => snapshots.snapshot_id, { onDelete: 'cascade' }),
  kind: text("kind").notNull().default('triad'),
  status: text("status").notNull().default('queued'), // queued|running|ok|error
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const http_idem = pgTable("http_idem", {
  key: text("key").primaryKey(),
  status: integer("status").notNull(),
  body: jsonb("body").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const places_cache = pgTable("places_cache", {
  place_id: text("place_id").primaryKey(),
  formatted_hours: jsonb("formatted_hours"),
  cached_at: timestamp("cached_at", { withTimezone: true }).notNull(),
  access_count: integer("access_count").notNull().default(0),
});

// Per-venue thumbs up/down feedback (tied to rankings)
export const venue_feedback = pgTable("venue_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id"),
  snapshot_id: uuid("snapshot_id").notNull().references(() => snapshots.snapshot_id, { onDelete: 'cascade' }),
  ranking_id: uuid("ranking_id").notNull().references(() => rankings.ranking_id, { onDelete: 'cascade' }),
  place_id: text("place_id"),
  venue_name: text("venue_name").notNull(),
  sentiment: text("sentiment").notNull(), // 'up' or 'down'
  comment: text("comment"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // One vote per user per venue per ranking (allows updates)
  uniqueUserRankPlace: sql`unique(user_id, ranking_id, place_id)`,
  idxRanking: sql`create index if not exists ix_feedback_ranking on ${table} (ranking_id)`,
  idxPlace: sql`create index if not exists ix_feedback_place on ${table} (place_id)`,
  // Foreign key index for performance (Issue #28)
  idxSnapshotId: sql`create index if not exists idx_venue_feedback_snapshot_id on ${table} (snapshot_id)`,
}));

// Strategy-level feedback (separate scope)
export const strategy_feedback = pgTable("strategy_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id"),
  snapshot_id: uuid("snapshot_id").notNull().references(() => snapshots.snapshot_id, { onDelete: 'cascade' }),
  ranking_id: uuid("ranking_id").notNull().references(() => rankings.ranking_id, { onDelete: 'cascade' }),
  sentiment: text("sentiment").notNull(), // 'up' or 'down'
  comment: text("comment"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // One vote per user per ranking for strategy
  uniqueUserRank: sql`unique(user_id, ranking_id)`,
}));

// General app feedback (simplified - just snapshot context)
export const app_feedback = pgTable("app_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshot_id: uuid("snapshot_id").references(() => snapshots.snapshot_id, { onDelete: 'cascade' }),
  sentiment: text("sentiment").notNull(), // 'up' or 'down'
  comment: text("comment"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const travel_disruptions = pgTable("travel_disruptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  country_code: text("country_code").notNull().default('US'),
  airport_code: text("airport_code").notNull(),
  airport_name: text("airport_name"),

  delay_minutes: integer("delay_minutes").default(0),
  ground_stops: jsonb("ground_stops").default([]),
  ground_delay_programs: jsonb("ground_delay_programs").default([]),
  closure_status: text("closure_status").default('open'),
  delay_reason: text("delay_reason"),

  ai_summary: text("ai_summary"),
  impact_level: text("impact_level").default('none'),

  data_source: text("data_source").notNull().default('FAA'),
  last_updated: timestamp("last_updated", { withTimezone: true }).notNull().defaultNow(),
  next_update_at: timestamp("next_update_at", { withTimezone: true }),
});

export const llm_venue_suggestions = pgTable("llm_venue_suggestions", {
  suggestion_id: uuid("suggestion_id").primaryKey().defaultRandom(),
  suggested_at: timestamp("suggested_at", { withTimezone: true }).notNull().defaultNow(),
  model_name: text("model_name").notNull(),
  ranking_id: uuid("ranking_id").references(() => rankings.ranking_id),
  venue_name: text("venue_name").notNull(),
  suggested_category: text("suggested_category"),
  llm_reasoning: text("llm_reasoning"),
  validation_status: text("validation_status").notNull().default('pending'),
  place_id_found: text("place_id_found"),
  venue_id_created: uuid("venue_id_created").references(() => venue_catalog.venue_id),
  validated_at: timestamp("validated_at", { withTimezone: true }),
  rejection_reason: text("rejection_reason"),
  // Full LLM analysis payload (detailed breakdown, rationale, etc.)
  // JSONB allows unlimited nested object size
  llm_analysis: jsonb('llm_analysis'),
});

export const agent_memory = pgTable("agent_memory", {
  id: uuid("id").primaryKey().defaultRandom(),
  session_id: text("session_id").notNull(),
  entry_type: text("entry_type").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  status: text("status").default('active'),
  metadata: jsonb("metadata"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expires_at: timestamp("expires_at", { withTimezone: true }),
}, (table) => ({
  idxSession: sql`create index if not exists idx_agent_memory_session on ${table} (session_id)`,
  idxType: sql`create index if not exists idx_agent_memory_type on ${table} (entry_type)`,
}));

// Enhanced memory tables for thread-aware context tracking
export const assistant_memory = pgTable("assistant_memory", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: text("scope").notNull(),
  key: text("key").notNull(),
  user_id: uuid("user_id"),
  content: text("content").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  expires_at: timestamp("expires_at", { withTimezone: true }),
}, (table) => ({
  uniqueScopeKey: sql`unique(scope, key, user_id)`,
  idxScope: sql`create index if not exists idx_assistant_memory_scope on ${table} (scope)`,
  idxUser: sql`create index if not exists idx_assistant_memory_user on ${table} (user_id)`,
  idxExpires: sql`create index if not exists idx_assistant_memory_expires on ${table} (expires_at)`,
}));

export const eidolon_memory = pgTable("eidolon_memory", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: text("scope").notNull(),
  key: text("key").notNull(),
  user_id: uuid("user_id"),
  content: text("content").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  expires_at: timestamp("expires_at", { withTimezone: true }),
}, (table) => ({
  uniqueScopeKey: sql`unique(scope, key, user_id)`,
  idxScope: sql`create index if not exists idx_eidolon_memory_scope on ${table} (scope)`,
  idxUser: sql`create index if not exists idx_eidolon_memory_user on ${table} (user_id)`,
  idxExpires: sql`create index if not exists idx_eidolon_memory_expires on ${table} (expires_at)`,
}));

export const cross_thread_memory = pgTable("cross_thread_memory", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: text("scope").notNull(),
  key: text("key").notNull(),
  user_id: uuid("user_id"),
  content: text("content").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  expires_at: timestamp("expires_at", { withTimezone: true }),
}, (table) => ({
  uniqueScopeKey: sql`unique(scope, key, user_id)`,
  idxScope: sql`create index if not exists idx_cross_thread_memory_scope on ${table} (scope)`,
  idxUser: sql`create index if not exists idx_cross_thread_memory_user on ${table} (user_id)`,
  idxExpires: sql`create index if not exists idx_cross_thread_memory_expires on ${table} (expires_at)`,
}));

export const venue_events = pgTable("venue_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  venue_id: uuid("venue_id"),
  place_id: text("place_id"),
  title: text("title").notNull(),
  starts_at: timestamp("starts_at", { withTimezone: true }),
  ends_at: timestamp("ends_at", { withTimezone: true }),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  source: text("source").notNull(),
  radius_m: integer("radius_m"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxVenueId: sql`create index if not exists idx_venue_events_venue_id on ${table} (venue_id)`,
  idxCoords: sql`create index if not exists idx_venue_events_coords on ${table} (lat, lng)`,
  idxStartsAt: sql`create index if not exists idx_venue_events_starts_at on ${table} (starts_at)`,
}));

// Traffic zones for real-time traffic intelligence
export const traffic_zones = pgTable("traffic_zones", {
  id: uuid("id").primaryKey().defaultRandom(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  city: text("city"),
  state: text("state"),
  traffic_density: integer("traffic_density"), // 1-10 scale
  density_level: text("density_level"), // 'low' | 'medium' | 'high'
  congestion_areas: jsonb("congestion_areas"), // Array of congestion hotspots
  high_demand_zones: jsonb("high_demand_zones"), // Array of high-demand areas
  driver_advice: text("driver_advice"),
  sources: jsonb("sources"), // Gemini search sources
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expires_at: timestamp("expires_at", { withTimezone: true }), // Traffic data expires after ~15 min
}, (table) => ({
  idxCoords: sql`create index if not exists idx_traffic_zones_coords on ${table} (lat, lng)`,
  idxCity: sql`create index if not exists idx_traffic_zones_city on ${table} (city)`,
}));

// Nearby venues discovered via Gemini web search (bars/restaurants)
// ML training data: enriched with opening/closing times and user corrections
export const nearby_venues = pgTable("nearby_venues", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshot_id: uuid("snapshot_id").references(() => snapshots.snapshot_id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  venue_type: text("venue_type").notNull(), // 'bar' | 'restaurant' | 'bar_restaurant'
  address: text("address"),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  distance_miles: doublePrecision("distance_miles"),
  expense_level: text("expense_level"), // '$' | '$$' | '$$$' | '$$$$'
  expense_rank: integer("expense_rank"), // 1-4 (4 = most expensive)
  phone: text("phone"),
  is_open: boolean("is_open").default(true),
  hours_today: text("hours_today"),
  hours_full_week: jsonb("hours_full_week"), // Mon-Sun schedule for learning
  closing_soon: boolean("closing_soon").default(false), // True if closing within 1 hour
  minutes_until_close: integer("minutes_until_close"),
  opens_in_minutes: integer("opens_in_minutes"), // Null if open or >15 mins away
  opens_in_future: boolean("opens_in_future"), // True if venue opens within 15 mins
  was_filtered: boolean("was_filtered").default(false), // True if closed 30-45+ mins ago
  crowd_level: text("crowd_level"), // 'low' | 'medium' | 'high'
  rideshare_potential: text("rideshare_potential"), // 'low' | 'medium' | 'high'
  city: text("city"),
  state: text("state"),
  // ML training data
  day_of_week: integer("day_of_week"), // 0=Sunday, 1=Monday, etc
  is_holiday: boolean("is_holiday").default(false),
  holiday_name: text("holiday_name"),
  search_sources: jsonb("search_sources"), // Gemini grounding sources
  // User corrections for ML feedback
  user_corrections: jsonb("user_corrections").default(sql`'[]'`), // [{user_id, field, old_value, new_value, corrected_at}]
  correction_count: integer("correction_count").default(0),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxSnapshotId: sql`create index if not exists idx_nearby_venues_snapshot_id on ${table} (snapshot_id)`,
  idxExpenseRank: sql`create index if not exists idx_nearby_venues_expense_rank on ${table} (expense_rank)`,
  idxClosingSoon: sql`create index if not exists idx_nearby_venues_closing_soon on ${table} (closing_soon)`,
  idxCoords: sql`create index if not exists idx_nearby_venues_coords on ${table} (lat, lng)`,
  idxCityState: sql`create index if not exists idx_nearby_venues_city_state on ${table} (city, state)`,
  idxOpen: sql`create index if not exists idx_nearby_venues_is_open on ${table} (is_open)`,
}));

export const agent_changes = pgTable("agent_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  change_type: text("change_type").notNull(),
  description: text("description").notNull(),
  file_path: text("file_path"),
  details: jsonb("details"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxCreatedAt: sql`create index if not exists idx_agent_changes_created_at on ${table} (created_at desc)`,
  idxChangeType: sql`create index if not exists idx_agent_changes_type on ${table} (change_type)`,
}));

export const connection_audit = pgTable("connection_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  occurred_at: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  event: text("event").notNull(),
  backend_pid: integer("backend_pid"),
  application_name: text("application_name"),
  reason: text("reason"),
  deploy_mode: text("deploy_mode"),
  details: jsonb("details"),
}, (table) => ({
  idxEventTime: sql`create index if not exists idx_connection_audit_event_time on ${table} (event, occurred_at desc)`,
}));

// Type exports removed - use Drizzle's $inferSelect and $inferInsert directly in TypeScript files