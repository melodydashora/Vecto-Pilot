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
});

export const actions = pgTable("actions", {
  action_id: uuid("action_id").primaryKey(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
  ranking_id: uuid("ranking_id").references(() => rankings.ranking_id),
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

export const places_cache = pgTable("places_cache", {
  place_id: text("place_id").primaryKey(),
  formatted_hours: jsonb("formatted_hours"),
  cached_at: timestamp("cached_at", { withTimezone: true }).notNull(),
  access_count: integer("access_count").notNull().default(0),
});

export const venue_feedback = pgTable("venue_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  venue_id: uuid("venue_id").notNull().references(() => venue_catalog.venue_id),
  driver_user_id: uuid("driver_user_id").notNull(),
  feedback_type: text("feedback_type").notNull(),
  comment: text("comment"),
  reported_at: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
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

// Type exports removed - use Drizzle's $inferSelect and $inferInsert directly in TypeScript files
