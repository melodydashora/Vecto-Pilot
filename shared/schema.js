import { pgTable, uuid, timestamp, jsonb, text, integer, boolean, doublePrecision, varchar, serial } from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";

// Users table: SESSION TRACKING ONLY (Ephemeral)
// 2026-01-05: Simplified per SAVE-IMPORTANT.md architecture
//
// Three Tables, Three Purposes:
//   - driver_profiles: Identity (who you are) - FOREVER
//   - users: Session (who's online now) - TEMPORARY (60 min TTL)
//   - snapshots: Activity (what you did when) - FOREVER
//
// Session Rules:
//   - Created on login, deleted on logout or 60 min inactivity
//   - Sliding window: last_active_at updates on every request
//   - Highlander Rule: One device per user (login on new device kills old session)
//   - Lazy Cleanup: Expired sessions deleted on next requireAuth check
//
// NO LOCATION DATA - all location goes to snapshots table
export const users = pgTable("users", {
  user_id: uuid("user_id").primaryKey().defaultRandom(), // Links to driver_profiles
  device_id: text("device_id").notNull(),                // Device making request
  session_id: uuid("session_id"),                        // Current session UUID
  current_snapshot_id: uuid("current_snapshot_id"),      // Their ONE active snapshot
  // Session timing (sliding window)
  session_start_at: timestamp("session_start_at", { withTimezone: true }).notNull().defaultNow(), // When session began
  last_active_at: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),     // Last activity (60 min TTL from here)
  // Timestamps
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const snapshots = pgTable("snapshots", {
  snapshot_id: uuid("snapshot_id").primaryKey(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
  date: text("date").notNull(), // Today's date in YYYY-MM-DD format (e.g., "2025-12-05")
  device_id: text("device_id").notNull(),
  session_id: uuid("session_id").notNull(),
  // User ID for ownership verification (links to users table)
  // Required for requireSnapshotOwnership middleware to verify authenticated users
  user_id: uuid("user_id"),
  // Location coordinates (stored at snapshot creation)
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  // FK to coords_cache - resolves location identity (city, state, country, formatted_address, timezone)
  coord_key: text("coord_key"), // Format: "lat6d_lng6d" e.g., "33.128400_-96.868800" - 6 decimal precision
  // LEGACY: Location identity (kept for backward compat, will be removed in Phase 7)
  city: text("city").notNull(),
  state: text("state").notNull(),
  country: text("country").notNull(),
  formatted_address: text("formatted_address").notNull(),
  timezone: text("timezone").notNull(),
  // 2026-02-01: Market from driver_profiles.market - captured at snapshot creation
  // Used for market-wide event discovery (e.g., "Dallas-Fort Worth" instead of just "Frisco")
  market: text("market"),
  // Time context (authoritative for this snapshot)
  local_iso: timestamp("local_iso", { withTimezone: false }).notNull(),
  dow: integer("dow").notNull(), // 0=Sunday, 1=Monday, etc.
  hour: integer("hour").notNull(),
  day_part_key: text("day_part_key").notNull(), // 'morning', 'afternoon', 'evening', etc.
  // H3 geohash for density analysis
  h3_r8: text("h3_r8"),
  // API-enriched contextual data only
  weather: jsonb("weather"),
  air: jsonb("air"),
  // 2026-01-14: airport_context dropped - airport data now lives in briefings.airport_conditions
  // NOTE: local_news, news_briefing, extras, trigger_reason, device removed Dec 2025
  // - briefing data is now in separate 'briefings' table
  // - trigger_reason moved to strategies table
  permissions: jsonb("permissions"),
  // Holiday detection at snapshot creation (via Gemini 3.0 Pro + Google Search)
  holiday: text("holiday").notNull().default('none'), // Holiday name (e.g., "Thanksgiving", "Christmas") or 'none'
  is_holiday: boolean("is_holiday").notNull().default(false), // Boolean flag: true if today is a holiday
});

// 2026-01-14: LEAN STRATEGIES TABLE
// This table stores ONLY the AI's strategic output linked to a snapshot.
// All location/time context lives in snapshots table.
// All briefing data lives in briefings table.
// Dropped columns (see migration 20260114_lean_strategies_table.sql):
//   strategy_id, correlation_id, strategy (legacy), error_code, attempt,
//   latency_ms, tokens, next_retry_at, model_name, trigger_reason,
//   valid_window_start, valid_window_end, strategy_timestamp
export const strategies = pgTable("strategies", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshot_id: uuid("snapshot_id").notNull().unique().references(() => snapshots.snapshot_id, { onDelete: 'cascade' }),
  user_id: uuid("user_id"),

  // State machine: pending → running → ok | pending_blocks → ok | failed
  status: text("status").notNull().default("pending"), // pending|running|ok|pending_blocks|failed
  phase: text("phase").default("starting"), // starting|resolving|analyzing|immediate|venues|routing|places|verifying|complete
  phase_started_at: timestamp("phase_started_at", { withTimezone: true }), // When current phase started (for progress calculation)

  // Error tracking
  error_message: text("error_message"),

  // Strategy outputs - THE PRODUCT
  strategy_for_now: text('strategy_for_now'), // Immediate 1-hour tactical strategy (GPT-5.2)
  consolidated_strategy: text("consolidated_strategy"), // Daily 8-12hr strategy (on-demand via Briefing tab)

  // Timestamps
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Briefing data from Perplexity Sonar Pro + Gemini 3.0 Pro with Google Search
// Contains ONLY briefing data (events, traffic, news, weather, closures, airport)
// All location/time context comes from snapshot via snapshot_id FK
export const briefings = pgTable("briefings", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshot_id: uuid("snapshot_id").notNull().unique().references(() => snapshots.snapshot_id, { onDelete: 'cascade' }),

  // === BRIEFING DATA (from Perplexity + Gemini + Google APIs) ===
  news: jsonb("news"), // Rideshare-relevant news
  weather_current: jsonb("weather_current"), // Current conditions from Google Weather API
  weather_forecast: jsonb("weather_forecast"), // Hourly forecast (next 3-6 hours) from Google Weather API
  traffic_conditions: jsonb("traffic_conditions"), // Traffic: incidents, construction, closures, demand zones
  events: jsonb("events"), // Local events: concerts, sports, festivals, nightlife, comedy
  school_closures: jsonb("school_closures"), // School district & college closures/reopenings
  airport_conditions: jsonb("airport_conditions"), // Airport: delays, arrivals, busy periods, recommendations

  // === METADATA ===
  holiday: text("holiday"), // Holiday name if applicable (from snapshot context)
  status: text("status"), // Briefing status: pending, complete, error
  generated_at: timestamp("generated_at", { withTimezone: true }), // When briefing was fully generated

  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rankings = pgTable("rankings", {
  ranking_id: uuid("ranking_id").primaryKey(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  snapshot_id: uuid("snapshot_id").references(() => snapshots.snapshot_id),
  correlation_id: uuid("correlation_id"),
  user_id: uuid("user_id"),
  // Resolved precise location from snapshot
  formatted_address: text("formatted_address"),
  city: text("city"),
  state: text("state"),
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
  // District tagging from LLM output (for text search fallback and deduplication)
  district: text("district"), // District/neighborhood from GPT-5.2: "Legacy West", "Deep Ellum"
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
  // Resolved precise location from snapshot
  formatted_address: text("formatted_address"),
  city: text("city"),
  state: text("state"),
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
  // District tagging for improved Places API matching (Issue: coord imprecision)
  // When GPT-5.2 coords are off, we fall back to text search: "venue_name district city"
  district: text("district"), // Human-readable: "Legacy West", "Deep Ellum"
  district_slug: text("district_slug"), // Normalized: "legacy-west", "deep-ellum"
  district_centroid_lat: doublePrecision("district_centroid_lat"), // Cluster center lat
  district_centroid_lng: doublePrecision("district_centroid_lng"), // Cluster center lng
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

  // ══════════════════════════════════════════════════════════════════════════
  // VENUE CONSOLIDATION (2026-01-05)
  // Columns added to consolidate venue_cache + nearby_venues into venue_catalog
  // ══════════════════════════════════════════════════════════════════════════

  // Granular Address Fields (for Google Places API New integration)
  state: text("state"),                  // State abbreviation (e.g., "TX")
  address_1: text("address_1"),          // Street number + route (e.g., "123 Main St")
  address_2: text("address_2"),          // Suite, floor, unit (optional)
  zip: text("zip"),                      // Postal code
  // 2026-01-10: D-029 - Fixed default from 'USA' to 'US' (ISO 3166-1 alpha-2)
  country: text("country").default('US'), // Country code (ISO alpha-2)
  formatted_address: text("formatted_address"), // Full Google-formatted address

  // Lookup & Deduplication
  normalized_name: text("normalized_name"),  // Lowercase alphanumeric for fuzzy matching
  coord_key: text("coord_key").unique(),     // "33.123456_-96.123456" (6 decimal precision)

  // Multi-Role Tagging (replaces single venue_type from venue_cache)
  venue_types: jsonb("venue_types").default(sql`'[]'`), // ['bar', 'event_host', 'restaurant', 'stadium']

  // Market Linkage
  market_slug: text("market_slug"),  // References markets(market_slug) - FK added via ALTER
  // 2026-02-17: IANA timezone for venue (from market lookup at creation time)
  // Used for isOpen calculation without requiring snapshot context
  timezone: text("timezone"),

  // Bar Marker Fields (FROM nearby_venues - CRITICAL for Map Features)
  expense_rank: integer("expense_rank"),     // 1-4 for $/$$/$$$/$$$$ filtering
  hours_full_week: jsonb("hours_full_week"), // {monday: "4:00 PM - 2:00 AM", ...} for is_open calc
  crowd_level: text("crowd_level"),          // 'low' | 'medium' | 'high'
  rideshare_potential: text("rideshare_potential"), // 'low' | 'medium' | 'high'

  // Cache Metadata (FROM venue_cache)
  hours_source: text("hours_source"),        // 'google_places', 'manual', 'inferred'
  capacity_estimate: integer("capacity_estimate"), // Venue capacity for surge prediction
  source: text("source"),                    // 'google_places', 'serpapi', 'llm', 'manual'
  source_model: text("source_model"),        // Which AI model discovered this venue
  access_count: integer("access_count").default(0), // Cache hit tracking
  last_accessed_at: timestamp("last_accessed_at", { withTimezone: true }), // Last cache access
  updated_at: timestamp("updated_at", { withTimezone: true }).default(sql`NOW()`), // Update tracking

  // ══════════════════════════════════════════════════════════════════════════
  // PROGRESSIVE ENRICHMENT (2026-01-14)
  // Boolean flags for efficient filtering and record_status for tracking data completeness
  // ══════════════════════════════════════════════════════════════════════════
  is_bar: boolean("is_bar").default(false).notNull(),           // Faster than venue_types JSONB
  is_event_venue: boolean("is_event_venue").default(false).notNull(), // Discovered via events
  // record_status: 'stub' (geocode only), 'enriched' (has details), 'verified' (trusted source)
  record_status: text("record_status").default('stub').notNull(),
}, (table) => ({
  // Indexes for efficient lookups
  idxCoordKey: sql`create unique index if not exists idx_venue_catalog_coord_key on ${table} (coord_key) where coord_key is not null`,
  idxNormalizedName: sql`create index if not exists idx_venue_catalog_normalized_name on ${table} (normalized_name)`,
  idxCityState: sql`create index if not exists idx_venue_catalog_city_state on ${table} (city, state)`,
  idxMarketSlug: sql`create index if not exists idx_venue_catalog_market_slug on ${table} (market_slug)`,
  idxVenueTypes: sql`create index if not exists idx_venue_catalog_venue_types on ${table} using gin (venue_types)`,
  idxExpenseRank: sql`create index if not exists idx_venue_catalog_expense_rank on ${table} (expense_rank) where expense_rank is not null`,
  // 2026-01-14: Progressive Enrichment indexes
  idxIsBar: sql`create index if not exists idx_venue_catalog_is_bar on ${table} (is_bar) where is_bar = true`,
  idxIsEventVenue: sql`create index if not exists idx_venue_catalog_is_event_venue on ${table} (is_event_venue) where is_event_venue = true`,
  idxRecordStatus: sql`create index if not exists idx_venue_catalog_record_status on ${table} (record_status)`,
}));

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
  // Resolved precise location from snapshot
  formatted_address: text("formatted_address"),
  city: text("city"),
  state: text("state"),
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

// 2026-01-10: D-013 Fix - Renamed place_id → coords_key for semantic accuracy
// Column stores coordinate keys (lat_lng format like "33.123456_-96.123456"), not Google Place IDs
export const places_cache = pgTable("places_cache", {
  coords_key: text("coords_key").primaryKey(),
  formatted_hours: jsonb("formatted_hours"),
  cached_at: timestamp("cached_at", { withTimezone: true }).notNull(),
  access_count: integer("access_count").notNull().default(0),
});

// venue_cache table DELETED 2026-01-05 - Consolidated into venue_catalog
// See: /home/runner/.claude/plans/noble-purring-yeti.md

// Per-venue thumbs up/down feedback (tied to rankings)
export const venue_feedback = pgTable("venue_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id"),
  snapshot_id: uuid("snapshot_id").notNull().references(() => snapshots.snapshot_id, { onDelete: 'cascade' }),
  ranking_id: uuid("ranking_id").notNull().references(() => rankings.ranking_id, { onDelete: 'cascade' }),
  place_id: text("place_id"),
  venue_name: text("venue_name").notNull(),
  // Resolved precise location from snapshot
  formatted_address: text("formatted_address"),
  city: text("city"),
  state: text("state"),
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
  // Resolved precise location from snapshot
  formatted_address: text("formatted_address"),
  city: text("city"),
  state: text("state"),
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
  // Resolved precise location from snapshot
  formatted_address: text("formatted_address"),
  city: text("city"),
  state: text("state"),
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
  scope: text("scope").notNull(),
  key: text("key").notNull(),
  user_id: uuid("user_id"),
  content: text("content").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  expires_at: timestamp("expires_at", { withTimezone: true }),
}, (table) => ({
  uniqueScopeKey: sql`unique(scope, key, user_id)`,
  idxScope: sql`create index if not exists idx_agent_memory_scope on ${table} (scope)`,
  idxUser: sql`create index if not exists idx_agent_memory_user on ${table} (user_id)`,
  idxExpires: sql`create index if not exists idx_agent_memory_expires on ${table} (expires_at)`,
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
  id: serial("id").primaryKey(),
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

// Eidolon snapshot storage for project/session state persistence
export const eidolon_snapshots = pgTable("eidolon_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshot_id: uuid("snapshot_id"),
  user_id: uuid("user_id"),
  session_id: text("session_id"),
  scope: text("scope").notNull(),
  state: jsonb("state").notNull(),
  metadata: jsonb("metadata"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  expires_at: timestamp("expires_at", { withTimezone: true }),
}, (table) => ({
  idxSnapshot: sql`create index if not exists idx_eidolon_snapshots_snapshot_id on ${table} (snapshot_id)`,
  idxScope: sql`create index if not exists idx_eidolon_snapshots_scope on ${table} (scope)`,
  idxUser: sql`create index if not exists idx_eidolon_snapshots_user on ${table} (user_id)`,
  idxSession: sql`create index if not exists idx_eidolon_snapshots_session on ${table} (session_id)`,
  idxExpires: sql`create index if not exists idx_eidolon_snapshots_expires on ${table} (expires_at)`,
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

// Discovered events from AI model searches (SerpAPI, GPT-5.2, etc.)
// Populated daily by event sync script, used for rideshare demand prediction
export const discovered_events = pgTable("discovered_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Event identity
  title: text("title").notNull(),
  venue_name: text("venue_name"),
  address: text("address"),
  city: text("city").notNull(),
  state: text("state").notNull(),
  zip: text("zip"),
  // Geocoding (lat/lng) happens in venue_catalog, which is source of truth for coordinates
  // But we store raw coords here for events that don't match a venue yet
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  // Reference to venue_catalog (enables venue → events queries for SmartBlocks)
  // Updated 2026-01-05: FK changed from venue_cache.id to venue_catalog.venue_id
  venue_id: uuid("venue_id").references(() => venue_catalog.venue_id, { onDelete: 'set null' }),
  // Event timing (2026-01-10: Renamed for symmetric naming convention)
  event_start_date: text("event_start_date").notNull(), // YYYY-MM-DD format
  event_start_time: text("event_start_time"), // e.g., "7:00 PM", "All Day"
  event_end_date: text("event_end_date"), // For multi-day events (defaults to event_start_date in normalizeEvent)
  event_end_time: text("event_end_time").notNull(), // e.g., "10:00 PM"
  // Categorization
  category: text("category").notNull().default('other'), // concert, sports, theater, conference, festival, nightlife, civic, academic, airport, other
  expected_attendance: text("expected_attendance").default('medium'), // high, medium, low
  // 2026-01-10: Removed source_model - not needed, all events come from Gemini discovery
  // Deduplication
  event_hash: text("event_hash").notNull().unique(), // MD5 of normalized(title + venue + date + city)
  // Timestamps
  discovered_at: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // Flags
  is_verified: boolean("is_verified").default(false), // Human verified
  is_active: boolean("is_active").default(true), // False if event was cancelled or deactivated
  // Deactivation tracking (populated when AI Coach or user marks event inactive)
  deactivation_reason: text("deactivation_reason"), // 'event_ended' | 'incorrect_time' | 'no_longer_relevant' | 'cancelled' | 'duplicate' | 'other'
  deactivated_at: timestamp("deactivated_at", { withTimezone: true }),
  deactivated_by: text("deactivated_by"), // 'ai_coach' | user_id
}, (table) => ({
  idxCity: sql`create index if not exists idx_discovered_events_city on ${table} (city, state)`,
  // 2026-01-10: Fixed D-020 - column renamed from event_date to event_start_date
  idxDate: sql`create index if not exists idx_discovered_events_start_date on ${table} (event_start_date)`,
  idxCategory: sql`create index if not exists idx_discovered_events_category on ${table} (category)`,
  idxHash: sql`create unique index if not exists idx_discovered_events_hash on ${table} (event_hash)`,
  idxDiscoveredAt: sql`create index if not exists idx_discovered_events_discovered_at on ${table} (discovered_at desc)`,
  // Index for venue → events join (SmartBlocks "event tonight" flag)
  idxVenueId: sql`create index if not exists idx_discovered_events_venue_id on ${table} (venue_id) where venue_id is not null`,
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

// nearby_venues table DELETED 2026-01-05 - Consolidated into venue_catalog
// See: /home/runner/.claude/plans/noble-purring-yeti.md

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

// Coords cache: Global lookup table for geocode/timezone data by coordinate hash
// Uses 6-decimal precision for coord_key (~11cm) - EXACT location matching only
// This ensures each driver's precise position is tracked for:
//   - Density analysis (directing drivers to different areas)
//   - Historical patterns per location
//   - Multi-driver coordination
// All resolved fields are NOT NULL - incomplete resolutions are not cached
export const coords_cache = pgTable("coords_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Cache key: 6 decimal places (~11cm precision) for EXACT matching
  coord_key: text("coord_key").notNull().unique(), // Format: "lat6d_lng6d" e.g., "33.128400_-96.868800"
  // Full precision storage: 6 decimals (~11cm precision)
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  // Resolved location data (from Google Geocoding API) - all required
  formatted_address: text("formatted_address").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  country: text("country").notNull(),
  // Timezone (from Google Timezone API) - required
  timezone: text("timezone").notNull(),
  // Optional: closest airport for airport context
  closest_airport: text("closest_airport"),
  closest_airport_code: text("closest_airport_code"),
  // Metadata
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  hit_count: integer("hit_count").notNull().default(0), // Track cache utilization
}, (table) => ({
  idxCoordKey: sql`create unique index if not exists idx_coords_cache_coord_key on ${table} (coord_key)`,
  idxCityState: sql`create index if not exists idx_coords_cache_city_state on ${table} (city, state)`,
}));

// Platform data: Rideshare platform coverage by city/market
// Stores which rideshare platforms (Uber, Lyft, etc.) operate in each city
// coord_boundary stores polygon coordinates for service area boundaries
export const platform_data = pgTable("platform_data", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Platform identification
  platform: text("platform").notNull(), // 'uber', 'lyft', etc.
  // Location hierarchy
  country: text("country").notNull(),
  country_code: text("country_code"), // ISO 2-letter code (e.g., 'US', 'CA', 'GB')
  region: text("region"), // State/province/region (nullable - not all entries have this)
  city: text("city").notNull(),
  market: text("market"), // Market name (e.g., 'Dallas-Fort Worth' may cover multiple cities)
  market_anchor: text("market_anchor"), // Core market city that controls this location (e.g., 'Dallas-Fort Worth')
  region_type: text("region_type"), // 'Core', 'Satellite', or 'Rural' - based on market gravity model
  // Timezone (IANA format, e.g., 'America/Chicago')
  timezone: text("timezone"),
  // Service area boundary (GeoJSON polygon or null if not yet available)
  coord_boundary: jsonb("coord_boundary"),
  // Center point for the city/market (optional - can be populated later via geocoding)
  center_lat: doublePrecision("center_lat"),
  center_lng: doublePrecision("center_lng"),
  // Service status
  is_active: boolean("is_active").notNull().default(true), // Whether service is currently active
  // Metadata
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxPlatform: sql`create index if not exists idx_platform_data_platform on ${table} (platform)`,
  idxCountry: sql`create index if not exists idx_platform_data_country on ${table} (country)`,
  idxCountryCode: sql`create index if not exists idx_platform_data_country_code on ${table} (country_code)`,
  idxCityRegion: sql`create index if not exists idx_platform_data_city_region on ${table} (city, region)`,
  idxMarket: sql`create index if not exists idx_platform_data_market on ${table} (market)`,
  // Composite index for common queries (platform + location)
  idxPlatformCountry: sql`create index if not exists idx_platform_data_platform_country on ${table} (platform, country)`,
  // Unique constraint: one entry per platform + country + region + city
  uniquePlatformLocation: sql`create unique index if not exists idx_platform_data_unique_location on ${table} (platform, country, COALESCE(region, ''), city)`,
}));

// ═══════════════════════════════════════════════════════════════════════════
// COUNTRIES REFERENCE TABLE (ISO 3166-1)
// ═══════════════════════════════════════════════════════════════════════════

// Countries table: Standard reference data for country dropdowns
// Uses ISO 3166-1 alpha-2 codes as primary key
export const countries = pgTable("countries", {
  // ISO 3166-1 alpha-2 code (e.g., 'US', 'CA', 'GB')
  code: varchar("code", { length: 2 }).primaryKey(),
  // Official country name
  name: text("name").notNull(),
  // ISO 3166-1 alpha-3 code (e.g., 'USA', 'CAN', 'GBR')
  alpha3: varchar("alpha3", { length: 3 }),
  // Phone calling code (e.g., '+1', '+44')
  phone_code: text("phone_code"),
  // Whether this country has rideshare platform coverage in our data
  has_platform_data: boolean("has_platform_data").notNull().default(false),
  // Display order (lower = higher priority, US = 0)
  display_order: integer("display_order").notNull().default(999),
  // Active flag for filtering
  is_active: boolean("is_active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════════
// MARKETS REFERENCE TABLE
// Pre-resolved market data to skip Google API calls for known markets
// ═══════════════════════════════════════════════════════════════════════════

export const markets = pgTable("markets", {
  // Market identifier (slug format for URL-safety)
  market_slug: text("market_slug").primaryKey(), // e.g., 'dfw', 'los-angeles', 'chicago'

  // Display name (Uber canonical name, e.g., "Dallas-Fort Worth", "Los Angeles")
  market_name: text("market_name").notNull(),

  // Location identity (for matching resolved coords to market)
  primary_city: text("primary_city").notNull(), // e.g., 'Dallas', 'Los Angeles', 'Chicago'
  state: text("state").notNull(), // e.g., 'Texas', 'California', 'Illinois'
  state_abbr: varchar("state_abbr", { length: 5 }), // e.g., 'TX', 'CA', 'IL' — normalized abbreviation
  country_code: varchar("country_code", { length: 2 }).notNull().default('US'),

  // Pre-resolved timezone (eliminates Google Timezone API calls for known markets)
  timezone: text("timezone").notNull(), // IANA format: 'America/Chicago', 'America/Los_Angeles'

  // Airport codes (primary + secondary) - to be populated later
  primary_airport_code: text("primary_airport_code"), // e.g., 'DFW', 'LAX', 'ORD'
  secondary_airports: jsonb("secondary_airports"), // e.g., ['DAL', 'AFW'] or ['SNA', 'BUR', 'ONT']

  // Alternative city names that should match to this market
  // e.g., DFW includes: Frisco, Plano, McKinney, Richardson, Irving, Arlington
  city_aliases: jsonb("city_aliases").$type(), // Array of city names

  // Platform coverage flags
  has_uber: boolean("has_uber").notNull().default(true),
  has_lyft: boolean("has_lyft").notNull().default(true),

  // Status
  is_active: boolean("is_active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════════
// MARKET CITIES (City → Market Lookup Table)
// 2026-02-17: Renamed from us_market_cities → market_cities with FK to markets
// Enables efficient: "User is in Frisco, TX → Show Dallas market intel"
// ═══════════════════════════════════════════════════════════════════════════

// Market Cities: Maps every city to its rideshare market anchor
// FK to markets table via market_slug — one source of truth for market definitions
// Source: Official Uber market listings + GPT analysis (Jan 2026)
export const market_cities = pgTable("market_cities", {
  id: uuid("id").primaryKey().defaultRandom(),

  // FK to markets table — the source of truth for market definitions
  // 2026-02-17: Added during market consolidation (replaces brittle text matching)
  market_slug: text("market_slug").notNull(), // e.g., 'dfw', 'los-angeles-ca'

  // Location identity
  state: text("state").notNull(),           // Full state name: "Texas", "California"
  state_abbr: text("state_abbr"),           // Abbreviation: "TX", "CA" (computed on insert)
  city: text("city").notNull(),             // City name: "Frisco", "Plano", "Dallas"
  country_code: varchar("country_code", { length: 2 }).notNull().default('US'),

  // Market mapping (display name, denormalized from markets.market_name)
  market_name: text("market_name").notNull(), // Uber market name: "Dallas-Fort Worth", "Houston"

  // Region classification (based on market gravity model)
  region_type: text("region_type").notNull().default('Satellite'), // 'Core' | 'Satellite' | 'Rural'
  // Core: The anchor city that defines the market (Dallas in Dallas market)
  // Satellite: Suburbs and smaller cities within the metro (Frisco, Plano, Irving)
  // Rural: Distant towns loosely connected to the market

  // Data provenance
  source_ref: text("source_ref"),           // 'uber.com', 'ridester.com', 'gpt-analysis'

  // IANA timezone denormalized from markets table for fast city→timezone lookups
  // 2026-02-17: Populated via FK join from markets.timezone (100% coverage)
  timezone: text("timezone"),

  // Metadata
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // Fast city lookup: WHERE country_code = 'US' AND state = 'TX' AND city = 'Frisco'
  idxCountryCityState: sql`create unique index if not exists idx_market_cities_country_city_state on ${table} (country_code, state, city)`,
  // Market grouping: Find all cities in a market via FK
  idxMarketSlug: sql`create index if not exists idx_umc_market_slug on ${table} (market_slug)`,
  // Market name lookup (display purposes)
  idxMarketName: sql`create index if not exists idx_market_cities_market_name on ${table} (market_name)`,
  // Region filtering
  idxRegionType: sql`create index if not exists idx_market_cities_region_type on ${table} (region_type)`,
}));

// Backward compatibility alias (deprecated — use market_cities directly)
// 2026-02-17: Alias for code that still imports us_market_cities during transition
export const us_market_cities = market_cities;

// ═══════════════════════════════════════════════════════════════════════════
// MARKET INTEL (Market-Level Intelligence & Insights)
// Stores rideshare intel at the market level for efficient access
// ═══════════════════════════════════════════════════════════════════════════

// Market Intel: Intelligence data linked to markets (not individual cities)
// When user is in Frisco → lookup Dallas market → show Dallas market intel
export const market_intel = pgTable("market_intel", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Market linkage
  market_name: text("market_name").notNull(), // e.g., "Dallas", "Houston", "Austin"

  // Intel categorization
  intel_type: text("intel_type").notNull(), // 'surge_pattern', 'traffic_pattern', 'event_intel', 'airport_tips', 'driver_tip', 'market_trend'

  // Intel content
  title: text("title").notNull(),           // Brief headline: "DFW Late-Night Surge Pattern"
  content: text("content").notNull(),       // Full intel text
  insight_data: jsonb("insight_data"),      // Structured data (charts, zones, timing)

  // Validity window
  valid_from: timestamp("valid_from", { withTimezone: true }), // When this intel becomes valid
  valid_until: timestamp("valid_until", { withTimezone: true }), // When this intel expires (null = evergreen)

  // Applicability
  day_of_week: text("day_of_week"),         // 'monday', 'saturday', 'weekend', 'weekday', null (all)
  time_of_day: text("time_of_day"),         // 'morning', 'evening', 'late_night', null (all)

  // Source tracking
  source: text("source").notNull().default('ai_coach'), // 'ai_coach', 'driver_contribution', 'platform_data', 'analysis'
  source_model: text("source_model"),       // AI model if applicable: 'gpt-5.2', 'claude-opus'
  contributed_by: uuid("contributed_by"),   // user_id if driver-contributed

  // Priority/Ranking
  priority: integer("priority").notNull().default(5), // 1-10 (1 = highest priority)
  confidence_score: doublePrecision("confidence_score"), // 0.0-1.0 AI confidence

  // Status
  is_active: boolean("is_active").notNull().default(true),
  view_count: integer("view_count").notNull().default(0),

  // Timestamps
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // Fast market lookup
  idxMarketName: sql`create index if not exists idx_market_intel_market_name on ${table} (market_name)`,
  // Filter by intel type
  idxIntelType: sql`create index if not exists idx_market_intel_intel_type on ${table} (intel_type)`,
  // Active intel only
  idxActive: sql`create index if not exists idx_market_intel_active on ${table} (is_active) where is_active = true`,
  // Time-based queries (find currently valid intel)
  idxValidWindow: sql`create index if not exists idx_market_intel_valid_window on ${table} (valid_from, valid_until)`,
  // Day/time filtering
  idxDayTime: sql`create index if not exists idx_market_intel_day_time on ${table} (day_of_week, time_of_day)`,
}));

// ═══════════════════════════════════════════════════════════════════════════
// AUTHENTICATION & DRIVER PROFILES
// ═══════════════════════════════════════════════════════════════════════════

// Driver profiles: Extended user information for registered drivers
// Links to users table via user_id for authenticated users
// 2026-01-05: Changed onDelete from 'cascade' to 'restrict' to prevent data loss
// When users table row is deleted, driver_profile MUST be preserved
// The users table is ephemeral (session tracking), but driver_profiles is permanent identity
export const driver_profiles = pgTable("driver_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull().unique().references(() => users.user_id, { onDelete: 'restrict' }),

  // Personal information
  first_name: text("first_name").notNull(),
  last_name: text("last_name").notNull(),
  driver_nickname: text("driver_nickname"), // Custom greeting name (defaults to first_name if null)
  email: text("email").notNull().unique(),
  // 2026-02-13: Made nullable for Google OAuth sign-up (user completes profile later)
  phone: text("phone"),

  // 2026-02-13: Google OAuth subject ID (permanent, unique per Google account)
  google_id: text("google_id").unique(),

  // 2026-02-13: Concierge share token for public QR code link
  concierge_share_token: varchar("concierge_share_token", { length: 12 }).unique(),

  // Address - nullable for Google OAuth sign-up (user completes profile later)
  // 2026-02-13: Made nullable to support OAuth-only registration
  address_1: text("address_1"),
  address_2: text("address_2"),
  city: text("city"),
  state_territory: text("state_territory"),
  zip_code: text("zip_code"),
  country: text("country").notNull().default('US'),

  // Geocoded home coordinates (from address via Google Geocoding API)
  home_lat: doublePrecision("home_lat"),
  home_lng: doublePrecision("home_lng"),
  home_formatted_address: text("home_formatted_address"), // Canonical address from Google
  home_timezone: text("home_timezone"), // IANA timezone for driver's home

  // Market selection (rideshare market area)
  // 2026-02-13: Made nullable for Google OAuth sign-up (user selects market later)
  market: text("market"),

  // Rideshare platforms used (jsonb array: ['uber', 'lyft', 'ridehail', 'private'])
  rideshare_platforms: jsonb("rideshare_platforms").notNull().default(sql`'["uber"]'`),

  // ═══════════════════════════════════════════════════════════════════════════
  // DRIVER ELIGIBILITY - Platform-agnostic taxonomy
  // ═══════════════════════════════════════════════════════════════════════════

  // Vehicle Class (base tier - what kind of vehicle do you drive?)
  elig_economy: boolean("elig_economy").default(true),        // Standard 4-seat sedan (UberX, Lyft Standard)
  elig_xl: boolean("elig_xl").default(false),                 // 6+ seat SUV/minivan (UberXL, Lyft XL)
  elig_xxl: boolean("elig_xxl").default(false),               // 6+ seat + extra cargo (Suburban, Expedition MAX)
  elig_comfort: boolean("elig_comfort").default(false),       // Newer vehicle, extra legroom (Uber Comfort)
  elig_luxury_sedan: boolean("elig_luxury_sedan").default(false), // Premium sedan, black on black (Uber Black)
  elig_luxury_suv: boolean("elig_luxury_suv").default(false), // Premium SUV, 6+ seats (Uber Black SUV)

  // Vehicle Attributes (hardware features of your vehicle)
  attr_electric: boolean("attr_electric").default(false),     // Fully electric vehicle (EV)
  attr_green: boolean("attr_green").default(false),           // Hybrid or low-emission vehicle
  attr_wav: boolean("attr_wav").default(false),               // Wheelchair accessible (ramp/lift)
  attr_ski: boolean("attr_ski").default(false),               // Ski rack / winter ready
  attr_car_seat: boolean("attr_car_seat").default(false),     // Child safety seat available

  // Service Preferences (rides you're willing to take - unchecked = avoid)
  pref_pet_friendly: boolean("pref_pet_friendly").default(false), // Accept passengers with pets
  pref_teen: boolean("pref_teen").default(false),             // Unaccompanied minors (13-17)
  pref_assist: boolean("pref_assist").default(false),         // Door-to-door assistance for seniors
  pref_shared: boolean("pref_shared").default(false),         // Carpool/shared rides

  // Legacy columns (kept for backward compatibility - will migrate to new fields)
  uber_black: boolean("uber_black").default(false),
  uber_xxl: boolean("uber_xxl").default(false),
  uber_comfort: boolean("uber_comfort").default(false),
  uber_x: boolean("uber_x").default(false),
  uber_x_share: boolean("uber_x_share").default(false),

  // Notifications
  marketing_opt_in: boolean("marketing_opt_in").notNull().default(false),

  // Terms & Conditions
  terms_accepted: boolean("terms_accepted").notNull().default(false), // Must be true to complete registration
  terms_accepted_at: timestamp("terms_accepted_at", { withTimezone: true }),
  terms_version: text("terms_version"),

  // Verification status
  email_verified: boolean("email_verified").default(false),
  phone_verified: boolean("phone_verified").default(false),
  profile_complete: boolean("profile_complete").default(false),

  // Timestamps
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxEmail: sql`create unique index if not exists idx_driver_profiles_email on ${table} (email)`,
  idxPhone: sql`create index if not exists idx_driver_profiles_phone on ${table} (phone)`,
  idxMarket: sql`create index if not exists idx_driver_profiles_market on ${table} (market)`,
  idxUserId: sql`create unique index if not exists idx_driver_profiles_user_id on ${table} (user_id)`,
}));

// Driver vehicles: Vehicle information for each driver
export const driver_vehicles = pgTable("driver_vehicles", {
  id: uuid("id").primaryKey().defaultRandom(),
  driver_profile_id: uuid("driver_profile_id").notNull().references(() => driver_profiles.id, { onDelete: 'cascade' }),

  // Vehicle information
  year: integer("year").notNull(),
  make: text("make").notNull(),
  model: text("model").notNull(),
  color: text("color"),
  license_plate: text("license_plate"),

  // Capacity
  seatbelts: integer("seatbelts").notNull().default(4),

  // Status
  is_primary: boolean("is_primary").default(true),
  is_active: boolean("is_active").default(true),

  // Timestamps
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxDriverProfileId: sql`create index if not exists idx_driver_vehicles_profile_id on ${table} (driver_profile_id)`,
}));

// Auth credentials: Password and security information for authenticated users
// 2026-01-05: Changed onDelete from 'cascade' to 'restrict' to prevent credential loss
// Login credentials are permanent and MUST NOT be deleted when session/user row changes
export const auth_credentials = pgTable("auth_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull().unique().references(() => users.user_id, { onDelete: 'restrict' }),

  // Password (bcrypt hashed) - nullable for OAuth-only users (Google, Apple)
  // 2026-02-13: Made nullable to support Google OAuth sign-up (no password needed)
  password_hash: text("password_hash"),

  // Security
  failed_login_attempts: integer("failed_login_attempts").default(0),
  locked_until: timestamp("locked_until", { withTimezone: true }),
  last_login_at: timestamp("last_login_at", { withTimezone: true }),
  last_login_ip: text("last_login_ip"),

  // Password reset
  password_reset_token: text("password_reset_token"),
  password_reset_expires: timestamp("password_reset_expires", { withTimezone: true }),
  password_changed_at: timestamp("password_changed_at", { withTimezone: true }),

  // Timestamps
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxUserId: sql`create unique index if not exists idx_auth_credentials_user_id on ${table} (user_id)`,
  idxResetToken: sql`create index if not exists idx_auth_credentials_reset_token on ${table} (password_reset_token)`,
}));

// Verification codes: Email and SMS verification codes
// 2026-01-05: Changed onDelete from 'cascade' to 'set null' - codes are temporary
// but shouldn't cascade delete; they'll expire naturally via expires_at
export const verification_codes = pgTable("verification_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").references(() => users.user_id, { onDelete: 'set null' }),

  // Code details
  code: text("code").notNull(),
  code_type: text("code_type").notNull(), // 'email_verify' | 'phone_verify' | 'password_reset_email' | 'password_reset_sms'
  destination: text("destination").notNull(), // email or phone number

  // Status
  used_at: timestamp("used_at", { withTimezone: true }),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").default(0),
  max_attempts: integer("max_attempts").default(3),

  // Timestamps
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxCode: sql`create index if not exists idx_verification_codes_code on ${table} (code)`,
  idxDestination: sql`create index if not exists idx_verification_codes_destination on ${table} (destination)`,
  idxExpires: sql`create index if not exists idx_verification_codes_expires on ${table} (expires_at)`,
  idxUserId: sql`create index if not exists idx_verification_codes_user_id on ${table} (user_id)`,
}));

// Vehicle makes cache: NHTSA API cache for vehicle makes
export const vehicle_makes_cache = pgTable("vehicle_makes_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  make_id: integer("make_id").notNull().unique(),
  make_name: text("make_name").notNull(),
  is_common: boolean("is_common").default(false), // Flag top 40 for faster dropdown loads
  cached_at: timestamp("cached_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxMakeId: sql`create unique index if not exists idx_vehicle_makes_cache_make_id on ${table} (make_id)`,
  idxMakeName: sql`create index if not exists idx_vehicle_makes_cache_make_name on ${table} (make_name)`,
  idxCommon: sql`create index if not exists idx_vehicle_makes_cache_common on ${table} (is_common)`,
}));

// Vehicle models cache: NHTSA API cache for vehicle models by make and year
export const vehicle_models_cache = pgTable("vehicle_models_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  make_id: integer("make_id").notNull(),
  make_name: text("make_name").notNull(),
  model_id: integer("model_id").notNull(),
  model_name: text("model_name").notNull(),
  model_year: integer("model_year"),
  cached_at: timestamp("cached_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxMakeYear: sql`create index if not exists idx_vehicle_models_cache_make_year on ${table} (make_id, model_year)`,
  idxModelName: sql`create index if not exists idx_vehicle_models_cache_model_name on ${table} (model_name)`,
  // Unique constraint for make + model + year combination
  uniqueMakeModelYear: sql`create unique index if not exists idx_vehicle_models_cache_unique on ${table} (make_id, model_id, COALESCE(model_year, 0))`,
}));

// ═══════════════════════════════════════════════════════════════════════════
// MARKET INTELLIGENCE
// Research-derived and AI Coach-contributed insights by market
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Market Intelligence Table
 *
 * Stores structured intelligence data derived from research documents and AI analysis.
 * Supports multiple intelligence types per market with versioning and attribution.
 *
 * Intelligence Types:
 * - regulatory: Legal/regulatory context (Prop 22, TLC rules, etc.)
 * - strategy: Operational doctrine and optimization tactics
 * - zone: Geographic areas (honey_hole, danger_zone, dead_zone, safe_corridor)
 * - timing: Time-based patterns (rush hours, seasonality, surge patterns)
 * - airport: Airport-specific strategies and queue info
 * - safety: Safety advisories and risk areas
 * - algorithm: Platform algorithm mechanics (Advantage Mode, etc.)
 * - vehicle: Vehicle type recommendations (XL, Comfort, etc.)
 * - general: General tips and advice
 *
 * Zone Sub-types (when intel_type = 'zone'):
 * - honey_hole: High-demand, profitable areas
 * - danger_zone: Safety risk areas (crime, carjacking)
 * - dead_zone: Low demand, unprofitable areas
 * - safe_corridor: Recommended safe operating areas
 * - caution_zone: Areas requiring situational awareness
 */
export const market_intelligence = pgTable("market_intelligence", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Market identification (matches platform_data.market format)
  market: text("market").notNull(), // e.g., 'Los Angeles', 'New York City', 'Chicago'
  market_slug: text("market_slug").notNull(), // e.g., 'los-angeles', 'new-york-city', 'chicago'

  // Platform scope
  platform: text("platform").notNull().default('both'), // 'uber', 'lyft', 'both'

  // Intelligence classification
  intel_type: text("intel_type").notNull(), // 'regulatory', 'strategy', 'zone', 'timing', 'airport', 'safety', 'algorithm', 'vehicle', 'general'
  intel_subtype: text("intel_subtype"), // For zones: 'honey_hole', 'danger_zone', 'dead_zone', 'safe_corridor', 'caution_zone'

  // Content
  title: text("title").notNull(), // Short descriptive title
  summary: text("summary"), // Brief 1-2 sentence summary
  content: text("content").notNull(), // Full intelligence content (markdown supported)

  // Geographic context (for zone-type intelligence)
  neighborhoods: jsonb("neighborhoods"), // Array of neighborhood names
  boundaries: jsonb("boundaries"), // Geographic boundaries (lat/lng polygon or description)

  // Temporal context (for timing-type intelligence)
  time_context: jsonb("time_context"), // { days: ['mon','tue'...], hours: [8,9,10...], seasonal: 'high_season' }

  // Categorization
  tags: jsonb("tags").default(sql`'[]'`), // Array of searchable tags
  priority: integer("priority").default(50), // 1-100, higher = more important

  // Attribution and quality
  source: text("source").notNull().default('research'), // 'research', 'ai_coach', 'driver_report', 'official'
  source_file: text("source_file"), // Original file path (e.g., 'platform-data/uber/research-findings/gemini-findings.txt')
  source_section: text("source_section"), // Section reference in source (e.g., '3. Market Analysis: Los Angeles')
  confidence: integer("confidence").default(80), // 1-100, how reliable is this info

  // Versioning
  version: integer("version").default(1),
  effective_date: timestamp("effective_date", { withTimezone: true }), // When this intel became valid
  expiry_date: timestamp("expiry_date", { withTimezone: true }), // When this intel may be outdated

  // Status
  is_active: boolean("is_active").default(true),
  is_verified: boolean("is_verified").default(false), // Has been human-verified

  // AI Coach integration
  coach_can_cite: boolean("coach_can_cite").default(true), // AI Coach can reference this
  coach_priority: integer("coach_priority").default(50), // Priority for AI Coach retrieval

  // Audit
  created_by: text("created_by").notNull().default('system'), // 'system', 'ai_coach', user_id
  updated_by: text("updated_by"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxMarket: sql`create index if not exists idx_market_intelligence_market on ${table} (market)`,
  idxMarketSlug: sql`create index if not exists idx_market_intelligence_market_slug on ${table} (market_slug)`,
  idxPlatform: sql`create index if not exists idx_market_intelligence_platform on ${table} (platform)`,
  idxIntelType: sql`create index if not exists idx_market_intelligence_intel_type on ${table} (intel_type)`,
  idxIntelSubtype: sql`create index if not exists idx_market_intelligence_intel_subtype on ${table} (intel_subtype)`,
  idxActive: sql`create index if not exists idx_market_intelligence_active on ${table} (is_active)`,
  idxSource: sql`create index if not exists idx_market_intelligence_source on ${table} (source)`,
  idxCoachCite: sql`create index if not exists idx_market_intelligence_coach_cite on ${table} (coach_can_cite, coach_priority)`,
  // Composite for common queries
  idxMarketTypeActive: sql`create index if not exists idx_market_intelligence_market_type_active on ${table} (market_slug, intel_type, is_active)`,
  // GIN index for tags search
  idxTags: sql`create index if not exists idx_market_intelligence_tags on ${table} using gin (tags)`,
}));

// ═══════════════════════════════════════════════════════════════════════════
// USER INTEL NOTES: Coach-generated notes from user interactions
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Stores notes generated by the AI Coach during user interactions.
 * These notes capture insights, preferences, and learned patterns that help
 * the coach provide more personalized advice over time.
 *
 * Note Types:
 * - preference: User driving preferences (times, areas, vehicle type)
 * - insight: Learned insights about user's market/strategy
 * - tip: Personalized tips discovered during conversation
 * - feedback: User feedback on coach advice effectiveness
 * - pattern: Detected patterns in user behavior/questions
 * - market_update: Market-specific updates relevant to user
 */
// 2026-01-05: Changed onDelete from 'cascade' to 'set null' - preserve coach's learnings
export const user_intel_notes = pgTable("user_intel_notes", {
  id: uuid("id").primaryKey().defaultRandom(),

  // User identification
  user_id: uuid("user_id").references(() => users.user_id, { onDelete: 'set null' }),
  snapshot_id: uuid("snapshot_id").references(() => snapshots.snapshot_id, { onDelete: 'set null' }),

  // Note classification
  note_type: text("note_type").notNull().default('insight'), // 'preference', 'insight', 'tip', 'feedback', 'pattern', 'market_update'
  category: text("category"), // Optional grouping: 'timing', 'location', 'strategy', 'vehicle', 'earnings', 'safety'

  // Content
  title: text("title"), // Short title for the note
  content: text("content").notNull(), // The actual note content
  context: text("context"), // What prompted this note (conversation excerpt)

  // Market context (optional - for market-specific notes)
  market_slug: text("market_slug"), // Link to market if applicable
  neighborhoods: jsonb("neighborhoods"), // Specific neighborhoods mentioned

  // Relevance scoring
  importance: integer("importance").default(50), // 1-100, how important for future advice
  confidence: integer("confidence").default(80), // 1-100, how confident coach is in this note
  times_referenced: integer("times_referenced").default(0), // How often this note has been used

  // Temporal validity
  valid_from: timestamp("valid_from", { withTimezone: true }).defaultNow(),
  valid_until: timestamp("valid_until", { withTimezone: true }), // NULL = indefinitely valid

  // Status
  is_active: boolean("is_active").default(true),
  is_pinned: boolean("is_pinned").default(false), // User/coach can pin important notes

  // Source tracking
  source_message_id: text("source_message_id"), // Chat message ID that generated this
  created_by: text("created_by").notNull().default('ai_coach'), // 'ai_coach', 'user', 'system'

  // Timestamps
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxUserId: sql`create index if not exists idx_user_intel_notes_user_id on ${table} (user_id)`,
  idxNoteType: sql`create index if not exists idx_user_intel_notes_note_type on ${table} (note_type)`,
  idxMarketSlug: sql`create index if not exists idx_user_intel_notes_market_slug on ${table} (market_slug)`,
  idxActive: sql`create index if not exists idx_user_intel_notes_active on ${table} (is_active)`,
  idxUserActive: sql`create index if not exists idx_user_intel_notes_user_active on ${table} (user_id, is_active, importance)`,
}));

// ═══════════════════════════════════════════════════════════════════════════
// AI COACH TABLES: Conversation history and system observations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Coach Conversations Table
 *
 * Stores complete AI Coach conversation history for user-level memory.
 * Enables full thread continuity across sessions, app updates, and tab switches.
 *
 * Features:
 * - Links to user_id for persistent cross-session memory
 * - Optional snapshot_id for context at time of conversation
 * - Stores both user messages and coach responses
 * - Thread grouping via conversation_id
 * - Supports message editing/regeneration tracking
 */
// 2026-01-05: Changed onDelete from 'cascade' to 'restrict' - preserve conversation history
export const coach_conversations = pgTable("coach_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),

  // User identification (required for user-level memory)
  user_id: uuid("user_id").notNull().references(() => users.user_id, { onDelete: 'restrict' }),

  // Context at time of conversation (optional - some messages may be context-free)
  snapshot_id: uuid("snapshot_id").references(() => snapshots.snapshot_id, { onDelete: 'set null' }),

  // Market context - ties conversation to a specific market for cross-driver learning
  market_slug: text("market_slug"), // e.g., "dallas-tx", "los-angeles-ca" - derived from snapshot

  // Conversation threading (groups messages in a single conversation)
  conversation_id: uuid("conversation_id").notNull(), // Groups related messages together
  parent_message_id: uuid("parent_message_id"), // For reply threading (optional)

  // Message content
  role: text("role").notNull(), // 'user' | 'assistant' | 'system'
  content: text("content").notNull(), // The actual message content
  content_type: text("content_type").default('text'), // 'text' | 'image' | 'file'

  // Metadata for learning
  topic_tags: jsonb("topic_tags").default(sql`'[]'`), // AI-classified topics: ['staging', 'surge', 'earnings']
  extracted_tips: jsonb("extracted_tips").default(sql`'[]'`), // Tips extracted from this exchange
  sentiment: text("sentiment"), // 'positive' | 'negative' | 'neutral' - user satisfaction

  // Context preserved for replay
  location_context: jsonb("location_context"), // { city, state, lat, lng } at time of message
  time_context: jsonb("time_context"), // { dow, hour, day_part, timezone } at time of message

  // Token usage (for cost tracking)
  tokens_in: integer("tokens_in"),
  tokens_out: integer("tokens_out"),
  model_used: text("model_used"), // 'claude-opus-4.5', 'gpt-5.2', etc.

  // Status
  is_edited: boolean("is_edited").default(false), // Was this message edited?
  is_regenerated: boolean("is_regenerated").default(false), // Was the response regenerated?
  is_starred: boolean("is_starred").default(false), // User starred for reference

  // Timestamps
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxUserId: sql`create index if not exists idx_coach_conversations_user_id on ${table} (user_id)`,
  idxConversationId: sql`create index if not exists idx_coach_conversations_conversation_id on ${table} (conversation_id)`,
  idxSnapshotId: sql`create index if not exists idx_coach_conversations_snapshot_id on ${table} (snapshot_id)`,
  idxCreatedAt: sql`create index if not exists idx_coach_conversations_created_at on ${table} (created_at desc)`,
  idxUserConversation: sql`create index if not exists idx_coach_conversations_user_conv on ${table} (user_id, conversation_id, created_at)`,
  // GIN index for topic_tags search
  idxTopicTags: sql`create index if not exists idx_coach_conversations_topic_tags on ${table} using gin (topic_tags)`,
  // Market-based queries for cross-driver learning
  idxMarketSlug: sql`create index if not exists idx_coach_conversations_market_slug on ${table} (market_slug)`,
}));

/**
 * Coach System Notes Table
 *
 * AI Coach observations about potential system enhancements, feature requests,
 * and patterns observed during user interactions.
 *
 * Purpose:
 * - Capture "aha moments" from user interactions (e.g., "user wanted screenshot analysis")
 * - Log feature suggestions derived from real usage patterns
 * - Track pain points and common frustrations
 * - Document workarounds that could become features
 */
export const coach_system_notes = pgTable("coach_system_notes", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Note classification
  note_type: text("note_type").notNull(), // 'feature_request' | 'pain_point' | 'workaround' | 'aha_moment' | 'bug_report' | 'integration_idea'
  category: text("category").notNull(), // 'ui' | 'strategy' | 'briefing' | 'venues' | 'coach' | 'map' | 'earnings' | 'general'
  priority: integer("priority").default(50), // 1-100, higher = more urgent/valuable

  // Content
  title: text("title").notNull(), // Short descriptive title
  description: text("description").notNull(), // Full description of the observation
  user_quote: text("user_quote"), // Direct quote from user that triggered this note

  // Context
  triggering_user_id: uuid("triggering_user_id").references(() => users.user_id, { onDelete: 'set null' }),
  triggering_conversation_id: uuid("triggering_conversation_id"), // Link to conversation that triggered this
  triggering_snapshot_id: uuid("triggering_snapshot_id").references(() => snapshots.snapshot_id, { onDelete: 'set null' }),

  // Usage patterns
  occurrence_count: integer("occurrence_count").default(1), // How many users/times this has come up
  affected_users: jsonb("affected_users").default(sql`'[]'`), // Array of user_ids who mentioned this

  // Market/location context (some notes are market-specific)
  market_slug: text("market_slug"),
  is_market_specific: boolean("is_market_specific").default(false),

  // Status tracking
  status: text("status").default('new'), // 'new' | 'reviewed' | 'planned' | 'implemented' | 'wont_fix'
  reviewed_at: timestamp("reviewed_at", { withTimezone: true }),
  reviewed_by: text("reviewed_by"),
  implementation_notes: text("implementation_notes"),

  // Timestamps
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxNoteType: sql`create index if not exists idx_coach_system_notes_note_type on ${table} (note_type)`,
  idxCategory: sql`create index if not exists idx_coach_system_notes_category on ${table} (category)`,
  idxStatus: sql`create index if not exists idx_coach_system_notes_status on ${table} (status)`,
  idxPriority: sql`create index if not exists idx_coach_system_notes_priority on ${table} (priority desc)`,
  idxCreatedAt: sql`create index if not exists idx_coach_system_notes_created_at on ${table} (created_at desc)`,
}));

// ═══════════════════════════════════════════════════════════════════════════
// OMNI-PRESENCE / SIRI INTERCEPTOR (2026-01-08)
// Level 4 Architecture: Headless client integration for external data ingestion.
// Allows iOS Shortcuts, Android automations, etc. to push data without auth.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Intercepted Signals Table (Level 4: Omni-Presence)
 *
 * Stores ride offers intercepted from external sources (iOS Siri Shortcut, etc.)
 * for AI-powered ACCEPT/REJECT decisions.
 *
 * CRITICAL: user_id is intentionally NOT a Foreign Key reference!
 * This is a "headless" ingestion table - Siri Shortcuts run without authenticated
 * user sessions. We rely on device_id for tracking instead.
 *
 * Data Flow:
 *   iOS Shortcut → "Vecto Analyze" → OCR extracts text → POST /api/hooks/analyze-offer
 *   → Parse price/miles/time + driver location → AI decision (Flash for speed)
 *   → INSERT intercepted_signals → pg NOTIFY offer_analyzed → SSE to web app
 *   → HTTP response to Siri → iOS "Show Notification" displays ACCEPT/REJECT
 *
 * Security: Endpoint uses device_id identification, not JWT auth.
 * Location: 6-decimal precision (~11cm) per codebase standard. Market slug uses 1-decimal buckets.
 *
 * 2026-02-15: Added location, market, platform, response_time_ms for algorithm learning.
 */
export const intercepted_signals = pgTable("intercepted_signals", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Device identification (PRIMARY identifier for headless clients)
  device_id: varchar("device_id", { length: 255 }).notNull(),

  // User association (OPTIONAL - NO FK constraint!)
  // Nullable because Siri Shortcuts run without authenticated sessions.
  // Can be linked later if user logs in on same device.
  user_id: uuid("user_id"), // Intentionally NO .references() - headless ingestion

  // 2026-02-16: Driver location at time of offer (6-decimal precision ~11cm, codebase standard)
  // Previously 3-decimal (~110m), upgraded for better algorithm learning.
  // Critical for algorithm learning: where do offers appear, what prices per location?
  latitude: doublePrecision("latitude"),     // nullable — Siri may not provide location
  longitude: doublePrecision("longitude"),   // nullable — same
  market: varchar("market", { length: 100 }), // e.g. "dallas-tx", derived from coords

  // Raw input from OCR
  raw_text: text("raw_text").notNull(),

  // Parsed offer data
  // Schema: { price, miles, time_minutes, pickup, dropoff, platform, surge, per_mile, per_minute }
  parsed_data: jsonb("parsed_data"),

  // 2026-02-15: Platform detection (extracted by AI from OCR text)
  platform: varchar("platform", { length: 20 }), // 'uber' | 'lyft' | 'unknown'

  // AI decision
  decision: text("decision").notNull(), // 'ACCEPT' | 'REJECT'
  decision_reasoning: text("decision_reasoning"), // AI explanation
  confidence_score: doublePrecision("confidence_score"), // 0.0 - 1.0

  // 2026-02-15: Response time tracking — how fast did we analyze?
  // Critical for UX: regular Uber offers give ~9 seconds; Trip Radar offers give only ~5 seconds.
  response_time_ms: integer("response_time_ms"), // AI analysis + DB write time

  // User override (if driver disagreed with AI)
  user_override: text("user_override"), // null | 'ACCEPT' | 'REJECT'

  // Source tracking
  source: varchar("source", { length: 50 }).notNull().default('siri_shortcut'), // 'siri_shortcut' | 'android_automation' | 'manual'

  // Timestamps
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxDeviceId: sql`create index if not exists idx_intercepted_signals_device_id on ${table} (device_id)`,
  idxUserId: sql`create index if not exists idx_intercepted_signals_user_id on ${table} (user_id) where user_id is not null`,
  idxCreatedAt: sql`create index if not exists idx_intercepted_signals_created on ${table} (device_id, created_at desc)`,
  // 2026-02-15: Market index for algorithm learning queries (e.g., "avg price in dallas-tx at 9pm")
  idxMarket: sql`create index if not exists idx_intercepted_signals_market on ${table} (market, created_at desc) where market is not null`,
}));

// ═══════════════════════════════════════════════════════════════════════════
// OFFER INTELLIGENCE (2026-02-17)
// Analyst-grade structured storage replacing intercepted_signals JSONB blob.
// Every metric promoted to an indexed column for SQL analytics and Excel export.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Offer Intelligence Table
 *
 * Structured, indexed storage for every ride offer intercepted from
 * Uber/Lyft via iOS Siri Shortcuts (OCR text or screenshot vision).
 *
 * WHY THIS EXISTS:
 * intercepted_signals stores parsed offer data in a JSONB blob (parsed_data),
 * making SQL analytics impossible. This table promotes every metric to a
 * proper indexed column for:
 *   - Daypart analysis: "What are average $/mile during early_evening?"
 *   - Geographic clustering: "Where do the best offers appear?" (H3 hex grid)
 *   - Platform comparison: "Does Uber or Lyft pay more per mile here?"
 *   - Sequence analysis: "Do rejected offers lead to better ones?"
 *   - Excel export: Every column is a real SQL type, not JSON to unpack
 *
 * Data Flow:
 *   Siri Shortcut → POST /api/hooks/analyze-offer
 *   → parse-offer-text.js (regex pre-parser, <1ms)
 *   → AI (Gemini Flash via OFFER_ANALYZER role, ~1-3s)
 *   → INSERT offer_intelligence (structured columns)
 *   → pg NOTIFY offer_analyzed → SSE to web app
 *
 * Auth: device_id based (Siri Shortcuts cannot send JWT tokens).
 * GPS: 6-decimal precision (~11cm) per codebase standard.
 * H3: Resolution 8 (~0.7km² hexagons) for density clustering.
 * Daypart: Uses getDayPartKey(hour) from server/lib/location/daypart.js.
 *
 * 2026-02-17: Created to replace intercepted_signals JSONB blob with structured columns.
 */
export const offer_intelligence = pgTable("offer_intelligence", {
  id: uuid("id").primaryKey().defaultRandom(),

  // ═══════════════════════════════════════════════════════════════════
  // DEVICE & USER IDENTIFICATION
  // ═══════════════════════════════════════════════════════════════════

  // PRIMARY identifier — Siri Shortcuts run without authenticated sessions
  device_id: varchar("device_id", { length: 255 }).notNull(),

  // OPTIONAL user link — NO FK constraint (headless ingestion)
  user_id: uuid("user_id"), // Intentionally NO .references() — headless ingestion

  // ═══════════════════════════════════════════════════════════════════
  // OFFER METRICS (structured numeric columns — the whole point)
  // All values from parse-offer-text.js regex extraction or AI parsing
  // ═══════════════════════════════════════════════════════════════════

  price: doublePrecision("price"),                     // Ride price in dollars (e.g., 9.43)
  per_mile: doublePrecision("per_mile"),               // $/mile = price / total_miles (THE key metric)
  per_minute: doublePrecision("per_minute"),           // $/minute = price / total_minutes
  hourly_rate: doublePrecision("hourly_rate"),         // Platform estimated $/active hr (e.g., 23.58)
  surge: doublePrecision("surge"),                     // Surge/priority amount in dollars
  advantage_pct: integer("advantage_pct"),             // Uber Pro advantage percentage (e.g., 5)

  pickup_minutes: integer("pickup_minutes"),           // Minutes to reach passenger
  pickup_miles: doublePrecision("pickup_miles"),       // Miles to reach passenger
  ride_minutes: integer("ride_minutes"),               // Minutes of actual trip
  ride_miles: doublePrecision("ride_miles"),           // Miles of actual trip
  total_miles: doublePrecision("total_miles"),         // pickup_miles + ride_miles
  total_minutes: integer("total_minutes"),             // pickup_minutes + ride_minutes

  product_type: varchar("product_type", { length: 50 }), // "UberX", "UberX Priority", "Lyft XL", etc.
  platform: varchar("platform", { length: 20 }).notNull().default('unknown'), // 'uber' | 'lyft' | 'unknown'

  // ═══════════════════════════════════════════════════════════════════
  // ADDRESSES (pickup and dropoff — for area analysis)
  // Extracted by AI from OCR text (street/intersection level)
  // ═══════════════════════════════════════════════════════════════════

  pickup_address: text("pickup_address"),
  dropoff_address: text("dropoff_address"),

  // Geocoded coordinates (populated async by background geocoder — future)
  pickup_lat: doublePrecision("pickup_lat"),
  pickup_lng: doublePrecision("pickup_lng"),
  dropoff_lat: doublePrecision("dropoff_lat"),
  dropoff_lng: doublePrecision("dropoff_lng"),
  geocoded_at: timestamp("geocoded_at", { withTimezone: true }),

  // ═══════════════════════════════════════════════════════════════════
  // DRIVER LOCATION at time of offer (6-decimal GPS, ~11cm precision)
  // Critical for "where do offers appear" analysis
  // ═══════════════════════════════════════════════════════════════════

  driver_lat: doublePrecision("driver_lat"),
  driver_lng: doublePrecision("driver_lng"),
  coord_key: text("coord_key"),                        // "33.081234_-96.812345" from coordsKey()
  h3_index: text("h3_index"),                          // H3 resolution 8 hex cell (~0.7km²)

  // ═══════════════════════════════════════════════════════════════════
  // GEOGRAPHIC & MARKET CONTEXT
  // ═══════════════════════════════════════════════════════════════════

  market: varchar("market", { length: 100 }),          // Coarse bucket: "33.1_-96.8" (1-decimal GPS)

  // ═══════════════════════════════════════════════════════════════════
  // TEMPORAL COLUMNS for daypart/time-of-day analysis
  // Enables: "best offers by daypart", "weekend vs weekday pricing"
  // ═══════════════════════════════════════════════════════════════════

  local_date: text("local_date"),                      // YYYY-MM-DD in driver's local timezone
  local_hour: integer("local_hour"),                   // 0-23 in driver's local timezone
  day_of_week: integer("day_of_week"),                 // 0=Sunday, 6=Saturday (matches snapshots.dow)
  day_part: text("day_part"),                          // getDayPartKey(hour): overnight|morning|etc.
  is_weekend: boolean("is_weekend"),                   // true for Saturday (6) and Sunday (0)
  timezone: text("timezone"),                          // IANA timezone (e.g., "America/Chicago")

  // ═══════════════════════════════════════════════════════════════════
  // AI ANALYSIS — decision, reasoning, model metadata
  // ═══════════════════════════════════════════════════════════════════

  decision: text("decision").notNull(),                // 'ACCEPT' | 'REJECT' | 'UNKNOWN'
  decision_reasoning: text("decision_reasoning"),
  confidence_score: integer("confidence_score"),       // 0-100
  ai_model: text("ai_model"),                         // e.g., "gemini-3-flash"
  response_time_ms: integer("response_time_ms"),

  // ═══════════════════════════════════════════════════════════════════
  // DRIVER FEEDBACK — human override of AI decision
  // ═══════════════════════════════════════════════════════════════════

  user_override: text("user_override"),                // null | 'ACCEPT' | 'REJECT'

  // ═══════════════════════════════════════════════════════════════════
  // SEQUENCE TRACKING — for accept/reject pattern analysis
  // "Do rejections lead to better subsequent offers?"
  // ═══════════════════════════════════════════════════════════════════

  offer_session_id: uuid("offer_session_id"),          // Groups offers into 30-min driving sessions
  offer_sequence_num: integer("offer_sequence_num"),   // 1, 2, 3... within a session
  seconds_since_last: integer("seconds_since_last"),   // Seconds since previous offer on this device

  // ═══════════════════════════════════════════════════════════════════
  // PARSE QUALITY & DATA PROVENANCE
  // ═══════════════════════════════════════════════════════════════════

  parse_confidence: varchar("parse_confidence", { length: 20 }), // 'full' | 'partial' | 'minimal'
  source: varchar("source", { length: 50 }).notNull().default('siri_shortcut'),
  input_mode: varchar("input_mode", { length: 20 }).notNull().default('text'), // 'text' | 'vision'

  // ═══════════════════════════════════════════════════════════════════
  // RAW DATA PRESERVATION (debugging, reprocessing, audit trail)
  // ═══════════════════════════════════════════════════════════════════

  raw_text: text("raw_text"),
  raw_ai_response: text("raw_ai_response"),            // Full AI JSON output
  parsed_data_json: jsonb("parsed_data_json"),         // Legacy JSONB fallback

  // ═══════════════════════════════════════════════════════════════════
  // TIMESTAMPS
  // ═══════════════════════════════════════════════════════════════════

  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // ═══════════════════════════════════════════════════════════════════
  // INDEXES — optimized for analyst query patterns
  // ═══════════════════════════════════════════════════════════════════

  // Device offer history
  idxDeviceCreated: sql`create index if not exists idx_oi_device_created on ${table} (device_id, created_at desc)`,

  // Avg $/mile by daypart + market + platform
  idxMarketDaypart: sql`create index if not exists idx_oi_market_daypart on ${table} (market, day_part, platform) where market is not null`,

  // Best offer areas (H3 geographic clustering)
  idxH3Decision: sql`create index if not exists idx_oi_h3_decision on ${table} (h3_index, decision) where h3_index is not null`,

  // Daily pricing floor by platform
  idxDatePlatform: sql`create index if not exists idx_oi_date_platform on ${table} (local_date, platform, per_mile) where local_date is not null`,

  // Weekend vs weekday pricing patterns
  idxWeekendHour: sql`create index if not exists idx_oi_weekend_hour on ${table} (is_weekend, local_hour, platform) where is_weekend is not null`,

  // Sequence analysis within sessions
  idxSessionSeq: sql`create index if not exists idx_oi_session_seq on ${table} (offer_session_id, offer_sequence_num) where offer_session_id is not null`,

  // Spatial lookup by driver location
  idxDriverLocation: sql`create index if not exists idx_oi_driver_location on ${table} (driver_lat, driver_lng) where driver_lat is not null`,

  // Override rate (driver disagreement)
  idxOverride: sql`create index if not exists idx_oi_override on ${table} (device_id, user_override) where user_override is not null`,

  // User linkage
  idxUserId: sql`create index if not exists idx_oi_user_id on ${table} (user_id) where user_id is not null`,

  // Best offers ranking
  idxPerMile: sql`create index if not exists idx_oi_per_mile on ${table} (per_mile desc) where per_mile is not null`,

  // General time-series queries
  idxCreatedAt: sql`create index if not exists idx_oi_created_at on ${table} (created_at desc)`,

  // Geocoding backfill job — find rows needing geocoding
  idxNeedGeocode: sql`create index if not exists idx_oi_need_geocode on ${table} (id) where geocoded_at is null and pickup_address is not null`,
}));

// ═══════════════════════════════════════════════════════════════════════════
// DISPATCH PRIMITIVES (2026-01-06)
// Schema additions for "Where do I go to make $500 today and still get home?"
// These tables enable goal-aware, safety-bounded dispatch recommendations.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Driver Goals Table (P2-A)
 *
 * Tracks earning goals, trip targets, and time constraints.
 * Enables queries like "I want to make $500 by 6pm".
 */
export const driver_goals = pgTable("driver_goals", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Owner
  user_id: uuid("user_id").notNull().references(() => users.user_id, { onDelete: 'cascade' }),

  // Goal definition
  goal_type: text("goal_type").notNull(), // 'earnings' | 'trips' | 'hours' | 'custom'
  target_amount: doublePrecision("target_amount"), // e.g., 500 for $500, or 10 for 10 trips
  target_unit: text("target_unit").default('dollars'), // 'dollars' | 'trips' | 'hours'

  // Time constraints
  deadline: timestamp("deadline", { withTimezone: true }), // When goal must be achieved by
  min_hourly_rate: doublePrecision("min_hourly_rate"), // e.g., 35.00 for $35/hr minimum

  // Priority
  urgency: text("urgency").default('normal'), // 'low' | 'normal' | 'high' | 'critical'

  // Status
  is_active: boolean("is_active").default(true),
  progress_amount: doublePrecision("progress_amount").default(0), // Current progress
  completed_at: timestamp("completed_at", { withTimezone: true }),

  // Timestamps
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxUserId: sql`create index if not exists idx_driver_goals_user_id on ${table} (user_id)`,
  idxActive: sql`create index if not exists idx_driver_goals_active on ${table} (user_id, is_active) where is_active = true`,
}));

/**
 * Driver Tasks Table (P2-B)
 *
 * Hard stops and time constraints (car wash, pickup kids, appointments).
 * Enables "return-home plan" that respects non-driving obligations.
 */
export const driver_tasks = pgTable("driver_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Owner
  user_id: uuid("user_id").notNull().references(() => users.user_id, { onDelete: 'cascade' }),

  // Task definition
  title: text("title").notNull(), // e.g., "Car wash appointment"
  description: text("description"),

  // Time constraints
  due_at: timestamp("due_at", { withTimezone: true }), // When task must be done by
  duration_minutes: integer("duration_minutes"), // How long task takes

  // Location (optional - some tasks are location-bound)
  location: text("location"), // Address or place description
  place_id: text("place_id"), // Google Place ID if available
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),

  // Priority
  is_hard_stop: boolean("is_hard_stop").default(false), // Must stop driving for this
  priority: integer("priority").default(50), // 1-100

  // Status
  is_complete: boolean("is_complete").default(false),
  completed_at: timestamp("completed_at", { withTimezone: true }),

  // Recurrence (optional)
  recurrence: text("recurrence"), // 'daily' | 'weekly' | 'weekdays' | null

  // Timestamps
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxUserId: sql`create index if not exists idx_driver_tasks_user_id on ${table} (user_id)`,
  idxDueAt: sql`create index if not exists idx_driver_tasks_due_at on ${table} (user_id, due_at) where is_complete = false`,
  idxHardStop: sql`create index if not exists idx_driver_tasks_hard_stop on ${table} (user_id, due_at) where is_hard_stop = true and is_complete = false`,
}));

/**
 * Safe Zones Table (P2-C)
 *
 * Geofence definitions for safety boundaries.
 * Enables "stay inside safe boundary unless goal demands otherwise".
 */
export const safe_zones = pgTable("safe_zones", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Owner
  user_id: uuid("user_id").notNull().references(() => users.user_id, { onDelete: 'cascade' }),

  // Zone identity
  zone_name: text("zone_name").notNull(), // e.g., "Home area", "Downtown avoid"
  zone_type: text("zone_type").notNull(), // 'safe' | 'avoid' | 'prefer'

  // Geometry (one of these should be set)
  geometry: text("geometry"), // GeoJSON polygon
  center_lat: doublePrecision("center_lat"),
  center_lng: doublePrecision("center_lng"),
  radius_miles: doublePrecision("radius_miles"), // Circular zone radius
  neighborhoods: text("neighborhoods"), // Comma-separated neighborhood names (alternative to geometry)

  // Risk assessment
  risk_level: integer("risk_level"), // 1-5 (1=safest, 5=most risky)
  risk_notes: text("risk_notes"), // Why this zone has certain risk level

  // Usage flags
  is_active: boolean("is_active").default(true),
  applies_at_night: boolean("applies_at_night").default(true), // Apply after 9pm
  applies_at_day: boolean("applies_at_day").default(true),

  // Timestamps
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxUserId: sql`create index if not exists idx_safe_zones_user_id on ${table} (user_id)`,
  idxActive: sql`create index if not exists idx_safe_zones_active on ${table} (user_id, is_active) where is_active = true`,
  idxType: sql`create index if not exists idx_safe_zones_type on ${table} (user_id, zone_type)`,
}));

/**
 * Staging Saturation Tracker (P2-D)
 *
 * Tracks staging location suggestions to prevent overcrowding.
 * When many drivers ask for recommendations, we diversify suggestions
 * to avoid sending everyone to the same hotspot.
 *
 * Uses H3 cells (resolution 8 = ~0.5km) for location grouping.
 */
export const staging_saturation = pgTable("staging_saturation", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Location identification
  h3_cell: text("h3_cell").notNull(), // H3 index at resolution 8
  venue_name: text("venue_name"), // Optional: specific venue name

  // Time window (suggestions aggregated per hour)
  window_start: timestamp("window_start", { withTimezone: true }).notNull(),
  window_end: timestamp("window_end", { withTimezone: true }).notNull(),

  // Saturation metrics
  suggestion_count: integer("suggestion_count").notNull().default(0), // How many times suggested
  active_drivers: integer("active_drivers").default(0), // Estimated drivers currently heading there

  // Market context
  market_slug: text("market_slug"),

  // Timestamps
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxH3Window: sql`create unique index if not exists idx_staging_saturation_h3_window on ${table} (h3_cell, window_start)`,
  idxMarketWindow: sql`create index if not exists idx_staging_saturation_market on ${table} (market_slug, window_start)`,
  idxSuggestionCount: sql`create index if not exists idx_staging_saturation_count on ${table} (suggestion_count desc)`,
}));

/**
 * News Deactivations Table
 *
 * Tracks deactivated news items from briefings.news (JSONB).
 * Allows AI Coach or users to mark news stories as inactive with reasoning.
 *
 * Reasons are free-form - we'll learn common patterns as users interact.
 * Examples discovered so far:
 * - "Article is from a year ago"
 * - "Already resolved"
 * - User preference
 *
 * Why separate table vs modifying briefings.news?
 * - briefings.news is per-snapshot, but deactivations are per-user
 * - A user deactivating an old carjacking story affects only their view
 * - Other users may still want to see the same story
 */
// 2026-01-05: Changed onDelete from 'cascade' to 'restrict' - preserve user preferences
export const news_deactivations = pgTable("news_deactivations", {
  id: uuid("id").primaryKey().defaultRandom(),

  // User who deactivated this news item
  user_id: uuid("user_id").notNull().references(() => users.user_id, { onDelete: 'restrict' }),

  // News item identification (matches items in briefings.news JSONB)
  news_hash: text("news_hash").notNull(), // MD5 of normalized(title + source + date)
  news_title: text("news_title").notNull(), // Original title for reference
  news_source: text("news_source"), // Source URL or name

  // Deactivation details - free-form, we'll learn patterns as we go
  reason: text("reason").notNull(), // Free-form reason from user or AI Coach

  // Who initiated the deactivation
  deactivated_by: text("deactivated_by").notNull().default('user'), // 'user' | 'ai_coach'

  // Scope
  scope: text("scope").default('user'), // 'user' (just this user) | 'snapshot' (just this context)

  // Timestamps
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxUserId: sql`create index if not exists idx_news_deactivations_user_id on ${table} (user_id)`,
  idxNewsHash: sql`create index if not exists idx_news_deactivations_news_hash on ${table} (news_hash)`,
  // Unique constraint: one deactivation per user per news item
  uniqueUserNews: sql`create unique index if not exists idx_news_deactivations_unique on ${table} (user_id, news_hash)`,
}));

/**
 * Zone Intelligence Table
 *
 * Crowd-sourced, market-specific zone intelligence gathered from driver conversations.
 * Unlike market_intelligence (research-backed), this is real-world intel from actual drivers.
 *
 * Zone Types:
 * - dead_zone: Areas with little to no ride demand
 * - danger_zone: Areas drivers report as unsafe/sketchy
 * - honey_hole: Consistently profitable spots
 * - surge_trap: Areas with fake/unprofitable surge
 * - staging_spot: Good waiting/staging locations
 * - event_zone: Temporary high-demand areas (concerts, games)
 *
 * Cross-Driver Learning:
 * - As multiple drivers report similar zones, confidence increases
 * - Market-specific (zone in Dallas doesn't affect LA)
 * - Time-aware (dead zones may only apply at certain hours)
 */
export const zone_intelligence = pgTable("zone_intelligence", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Market context (required)
  market_slug: text("market_slug").notNull(), // e.g., "dallas-tx", "los-angeles-ca"

  // Zone identification
  zone_type: text("zone_type").notNull(), // 'dead_zone' | 'danger_zone' | 'honey_hole' | 'surge_trap' | 'staging_spot' | 'event_zone'
  zone_name: text("zone_name").notNull(), // Human-readable: "Deep Ellum after 2am", "DFW Airport cell phone lot"
  zone_description: text("zone_description"), // Detailed description of the zone

  // Location (optional - AI may describe without exact coordinates)
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  radius_miles: doublePrecision("radius_miles").default(0.5), // Approximate zone radius
  address_hint: text("address_hint"), // "Near the Target on Main St" - human-readable location

  // Time constraints (when does this apply?)
  time_constraints: jsonb("time_constraints").default(sql`'{}'`), // { after_hour: 22, before_hour: 6, days: ['fri', 'sat'] }
  is_time_specific: boolean("is_time_specific").default(false), // True if zone quality depends on time

  // Crowd-sourced validation
  reports_count: integer("reports_count").default(1), // How many drivers reported this
  confidence_score: integer("confidence_score").default(50), // 1-100, increases with more reports
  contributing_users: jsonb("contributing_users").default(sql`'[]'`), // Array of user_ids who contributed
  source_conversations: jsonb("source_conversations").default(sql`'[]'`), // conversation_ids where learned

  // Latest report details
  last_reason: text("last_reason"), // Most recent reason given
  last_reported_by: uuid("last_reported_by").references(() => users.user_id, { onDelete: 'set null' }),
  last_reported_at: timestamp("last_reported_at", { withTimezone: true }),

  // Status
  is_active: boolean("is_active").default(true), // Soft delete / deactivation
  verified_by_admin: boolean("verified_by_admin").default(false), // Manual verification

  // Timestamps
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxMarketSlug: sql`create index if not exists idx_zone_intelligence_market_slug on ${table} (market_slug)`,
  idxZoneType: sql`create index if not exists idx_zone_intelligence_zone_type on ${table} (zone_type)`,
  idxConfidence: sql`create index if not exists idx_zone_intelligence_confidence on ${table} (confidence_score desc)`,
  idxActive: sql`create index if not exists idx_zone_intelligence_active on ${table} (is_active) where is_active = true`,
  idxMarketType: sql`create index if not exists idx_zone_intelligence_market_type on ${table} (market_slug, zone_type)`,
  // Spatial index would be ideal here but requires PostGIS - using lat/lng for now
  idxLocation: sql`create index if not exists idx_zone_intelligence_location on ${table} (lat, lng) where lat is not null`,
}));

// ═══════════════════════════════════════════════════════════════════════════
// DRIZZLE RELATIONS: Enable eager loading via `with: { coords: true }`
// ═══════════════════════════════════════════════════════════════════════════

// 2026-01-05: usersRelations removed - users table no longer has location data
// All location is now in snapshots table per SAVE-IMPORTANT.md architecture

// Snapshots → coords_cache relation (for location identity lookup)
export const snapshotsRelations = relations(snapshots, ({ one }) => ({
  coords: one(coords_cache, {
    fields: [snapshots.coord_key],
    references: [coords_cache.coord_key],
  }),
}));

// coords_cache → users/snapshots reverse relations (for density analysis)
export const coordsCacheRelations = relations(coords_cache, ({ many }) => ({
  users: many(users),
  snapshots: many(snapshots),
}));

// Type exports removed - use Drizzle's $inferSelect and $inferInsert directly in TypeScript files

// ═══════════════════════════════════════════════════════════════════════════
// OAUTH & INTEGRATIONS (2026-02-08)
// ═══════════════════════════════════════════════════════════════════════════

export const oauth_states = pgTable("oauth_states", {
  id: uuid("id").primaryKey().defaultRandom(),
  state: text("state").notNull().unique(),
  provider: text("provider").notNull(), // 'uber', 'lyft'
  user_id: uuid("user_id").notNull(), // Intentionally no FK to users to allow soft failures
  redirect_uri: text("redirect_uri"),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxState: sql`create index if not exists idx_oauth_states_state on ${table} (state)`,
  idxExpires: sql`create index if not exists idx_oauth_states_expires on ${table} (expires_at)`,
}));

export const uber_connections = pgTable("uber_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull().unique().references(() => users.user_id, { onDelete: 'cascade' }),
  
  // Tokens (Encrypted at rest)
  access_token_encrypted: text("access_token_encrypted").notNull(),
  refresh_token_encrypted: text("refresh_token_encrypted"),
  token_expires_at: timestamp("token_expires_at", { withTimezone: true }),
  
  // Permissions
  scopes: text("scopes").array(), // ['profile', 'history', 'places']
  
  // Status
  is_active: boolean("is_active").default(true),
  connected_at: timestamp("connected_at", { withTimezone: true }).defaultNow(),
  last_sync_at: timestamp("last_sync_at", { withTimezone: true }),
  
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
  idxUserId: sql`create index if not exists idx_uber_connections_user_id on ${table} (user_id)`,
}));

// ============================================================================
// CONCIERGE FEEDBACK — Passenger ratings from QR code scans
// ============================================================================
// 2026-02-13: Direct passenger feedback that rideshare platforms never share.
// No auth required (passengers are anonymous). Linked to driver via share_token.
// Rate limited on the API side to prevent spam.
export const concierge_feedback = pgTable("concierge_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  driver_profile_id: uuid("driver_profile_id").notNull().references(() => driver_profiles.id, { onDelete: 'cascade' }),
  share_token: varchar("share_token", { length: 12 }).notNull(),
  rating: integer("rating").notNull(), // 1-5 stars
  comment: text("comment"), // Optional free text from passenger
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxDriverProfile: sql`create index if not exists idx_concierge_feedback_driver on ${table} (driver_profile_id)`,
  idxCreatedAt: sql`create index if not exists idx_concierge_feedback_created on ${table} (created_at)`,
}));