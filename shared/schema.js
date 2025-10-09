import { pgTable, uuid, timestamp, jsonb, text, integer, boolean, doublePrecision } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const snapshots = pgTable("snapshots", {
  snapshot_id: uuid("snapshot_id").primaryKey(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
  user_id: uuid("user_id"),
  device_id: uuid("device_id").notNull(),
  session_id: uuid("session_id").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  accuracy_m: doublePrecision("accuracy_m"),
  coord_source: text("coord_source").notNull(),
  city: text("city"),
  state: text("state"),
  country: text("country"),
  formatted_address: text("formatted_address"),
  timezone: text("timezone"),
  local_iso: timestamp("local_iso", { withTimezone: false }),
  dow: integer("dow"), // 0=Sunday, 1=Monday, etc. - Models infer weekend from this
  hour: integer("hour"),
  day_part_key: text("day_part_key"),
  h3_r8: text("h3_r8"),
  weather: jsonb("weather"),
  air: jsonb("air"),
  airport_context: jsonb("airport_context"),
  device: jsonb("device"),
  permissions: jsonb("permissions"),
  extras: jsonb("extras"),
  last_strategy_day_part: text("last_strategy_day_part").default(null),
  trigger_reason: text("trigger_reason").default(null),
});

export const strategies = pgTable("strategies", {
  id: uuid("id").primaryKey().defaultRandom(),
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
});

export const rankings = pgTable("rankings", {
  ranking_id: uuid("ranking_id").primaryKey(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
  snapshot_id: uuid("snapshot_id").references(() => snapshots.snapshot_id),
  correlation_id: uuid("correlation_id"),
  user_id: uuid("user_id"),
  city: text("city"),
  ui: jsonb("ui"),
  model_name: text("model_name").notNull(),
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
});

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
});

export const venue_catalog = pgTable("venue_catalog", {
  venue_id: uuid("venue_id").primaryKey().defaultRandom(),
  place_id: text("place_id").unique(),
  name: text("name").notNull(),
  address: text("address").notNull(),
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

export const triad_jobs = pgTable("triad_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshot_id: uuid("snapshot_id").notNull().references(() => snapshots.snapshot_id, { onDelete: 'cascade' }),
  kind: text("kind").notNull().default('triad'),
  status: text("status").notNull().default('queued'), // queued|running|ok|error
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqueSnapshotKind: sql`unique(snapshot_id, kind)`
}));

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
});

export const assistant_memory = pgTable("assistant_memory", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: text("scope").notNull(),
  key: text("key").notNull(),
  user_id: text("user_id"),
  content: jsonb("content").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  expires_at: timestamp("expires_at", { withTimezone: true }),
});

export const eidolon_memory = pgTable("eidolon_memory", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: text("scope").notNull(),
  key: text("key").notNull(),
  user_id: text("user_id"),
  content: jsonb("content").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  expires_at: timestamp("expires_at", { withTimezone: true }),
});

export const user_profiles = pgTable("user_profiles", {
  user_id: uuid("user_id").primaryKey(),
  full_name: text("full_name"),
  email: text("email"),
  phone: text("phone"),
  preferred_city: text("preferred_city"),
  preferred_state: text("preferred_state"),
  rideshare_platform: text("rideshare_platform"),
  target_hourly_rate: doublePrecision("target_hourly_rate"),
  avg_trip_minutes: integer("avg_trip_minutes").default(15),
  avg_wait_minutes: integer("avg_wait_minutes").default(5),
  driver_experience_level: text("driver_experience_level").default('intermediate'),
  preferences: jsonb("preferences"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const user_preferences = pgTable("user_preferences", {
  user_id: uuid("user_id").primaryKey(),
  
  // Driver Info
  driver_first_name: text("driver_first_name"),
  driver_last_name: text("driver_last_name"),
  driver_preferred_name: text("driver_preferred_name"),
  driver_home_address: text("driver_home_address"),
  driver_city: text("driver_city"),
  driver_state: text("driver_state"),
  driver_assigned_region: text("driver_assigned_region"),
  
  // Car Details
  car_year: integer("car_year"),
  car_make: text("car_make"),
  car_model: text("car_model"),
  seatbelt_count: integer("seatbelt_count"),
  
  // Services (checkboxes - 0/1)
  service_uber: boolean("service_uber").default(false),
  service_lyft: boolean("service_lyft").default(false),
  service_private: boolean("service_private").default(false),
  service_ridehail: boolean("service_ridehail").default(false),
  service_other: boolean("service_other").default(false),
  service_other_explanation: text("service_other_explanation"),
  
  // Ride Tiers (checkboxes - 0/1)
  tier_1_all_rides: boolean("tier_1_all_rides").default(false),
  tier_2_comfort: boolean("tier_2_comfort").default(false),
  tier_3_7passenger: boolean("tier_3_7passenger").default(false),
  tier_4_7pass_comfort: boolean("tier_4_7pass_comfort").default(false),
  tier_5_7pass_xxl: boolean("tier_5_7pass_xxl").default(false),
  planet_friendly: boolean("planet_friendly").default(false),
  tier_other: boolean("tier_other").default(false),
  tier_other_explanation: text("tier_other_explanation"),
  
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Type exports removed - use Drizzle's $inferSelect and $inferInsert directly in TypeScript files
