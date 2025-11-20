CREATE TABLE "actions" (
	"action_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"ranking_id" uuid,
	"snapshot_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"block_id" text,
	"dwell_ms" integer,
	"from_rank" integer,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "agent_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_type" text NOT NULL,
	"description" text NOT NULL,
	"file_path" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"entry_type" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'active',
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid,
	"sentiment" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"user_id" uuid,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "block_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"request_body" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "briefings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"global_travel" text,
	"domestic_travel" text,
	"local_traffic" text,
	"weather_impacts" text,
	"events_nearby" text,
	"holidays" text,
	"rideshare_intel" text,
	"citations" jsonb,
	"tactical_traffic" text,
	"tactical_closures" text,
	"tactical_enforcement" text,
	"tactical_sources" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "briefings_snapshot_id_unique" UNIQUE("snapshot_id")
);
--> statement-breakpoint
CREATE TABLE "connection_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event" text NOT NULL,
	"backend_pid" integer,
	"application_name" text,
	"reason" text,
	"deploy_mode" text,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "cross_thread_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"user_id" uuid,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "eidolon_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"user_id" uuid,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "http_idem" (
	"key" text PRIMARY KEY NOT NULL,
	"status" integer NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_venue_suggestions" (
	"suggestion_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suggested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"model_name" text NOT NULL,
	"ranking_id" uuid,
	"venue_name" text NOT NULL,
	"suggested_category" text,
	"llm_reasoning" text,
	"validation_status" text DEFAULT 'pending' NOT NULL,
	"place_id_found" text,
	"venue_id_created" uuid,
	"validated_at" timestamp with time zone,
	"rejection_reason" text,
	"llm_analysis" jsonb
);
--> statement-breakpoint
CREATE TABLE "places_cache" (
	"place_id" text PRIMARY KEY NOT NULL,
	"formatted_hours" jsonb,
	"cached_at" timestamp with time zone NOT NULL,
	"access_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ranking_candidates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ranking_id" uuid NOT NULL,
	"block_id" text NOT NULL,
	"name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"drive_time_min" integer,
	"straight_line_km" double precision,
	"est_earnings_per_ride" double precision,
	"model_score" double precision,
	"rank" integer NOT NULL,
	"exploration_policy" text NOT NULL,
	"epsilon" double precision,
	"was_forced" boolean,
	"propensity" double precision,
	"features" jsonb,
	"h3_r8" text,
	"distance_miles" double precision,
	"drive_minutes" integer,
	"value_per_min" double precision,
	"value_grade" text,
	"not_worth" boolean,
	"rate_per_min_used" double precision,
	"trip_minutes_used" integer,
	"wait_minutes_used" integer,
	"snapshot_id" uuid,
	"place_id" text,
	"estimated_distance_miles" double precision,
	"drive_time_minutes" integer,
	"distance_source" text,
	"pro_tips" text[],
	"closed_reasoning" text,
	"staging_tips" text,
	"staging_name" text,
	"staging_lat" double precision,
	"staging_lng" double precision,
	"business_hours" jsonb,
	"venue_events" jsonb
);
--> statement-breakpoint
CREATE TABLE "rankings" (
	"ranking_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"snapshot_id" uuid,
	"correlation_id" uuid,
	"user_id" uuid,
	"city" text,
	"ui" jsonb,
	"model_name" text NOT NULL,
	"scoring_ms" integer,
	"planner_ms" integer,
	"total_ms" integer,
	"timed_out" boolean DEFAULT false,
	"path_taken" text
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"snapshot_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"user_id" uuid,
	"device_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accuracy_m" double precision,
	"coord_source" text NOT NULL,
	"city" text,
	"state" text,
	"country" text,
	"formatted_address" text,
	"timezone" text,
	"local_iso" timestamp,
	"dow" integer,
	"hour" integer,
	"day_part_key" text,
	"h3_r8" text,
	"weather" jsonb,
	"air" jsonb,
	"airport_context" jsonb,
	"local_news" jsonb,
	"news_briefing" jsonb,
	"device" jsonb,
	"permissions" jsonb,
	"extras" jsonb,
	"last_strategy_day_part" text DEFAULT null,
	"trigger_reason" text DEFAULT null,
	"holiday" text,
	"is_holiday" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid,
	"snapshot_id" uuid NOT NULL,
	"correlation_id" uuid,
	"strategy" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_code" integer,
	"error_message" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"latency_ms" integer,
	"tokens" integer,
	"next_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"model_name" text,
	"model_params" jsonb,
	"prompt_version" text,
	"strategy_for_now" text,
	"lat" double precision,
	"lng" double precision,
	"city" text,
	"state" text,
	"user_address" text,
	"user_id" uuid,
	"events" jsonb DEFAULT '[]'::jsonb,
	"news" jsonb DEFAULT '[]'::jsonb,
	"traffic" jsonb DEFAULT '[]'::jsonb,
	"valid_window_start" timestamp with time zone,
	"valid_window_end" timestamp with time zone,
	"strategy_timestamp" timestamp with time zone,
	"user_resolved_address" text,
	"user_resolved_city" text,
	"user_resolved_state" text,
	"minstrategy" text,
	"consolidated_strategy" text,
	"briefing_news" jsonb,
	"briefing_events" jsonb,
	"briefing_traffic" jsonb,
	CONSTRAINT "strategies_snapshot_id_unique" UNIQUE("snapshot_id")
);
--> statement-breakpoint
CREATE TABLE "strategy_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"snapshot_id" uuid NOT NULL,
	"ranking_id" uuid NOT NULL,
	"sentiment" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "travel_disruptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text DEFAULT 'US' NOT NULL,
	"airport_code" text NOT NULL,
	"airport_name" text,
	"delay_minutes" integer DEFAULT 0,
	"ground_stops" jsonb DEFAULT '[]'::jsonb,
	"ground_delay_programs" jsonb DEFAULT '[]'::jsonb,
	"closure_status" text DEFAULT 'open',
	"delay_reason" text,
	"ai_summary" text,
	"impact_level" text DEFAULT 'none',
	"data_source" text DEFAULT 'FAA' NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"next_update_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "triad_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"kind" text DEFAULT 'triad' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue_catalog" (
	"venue_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"place_id" text,
	"venue_name" varchar(500) NOT NULL,
	"address" varchar(500) NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"category" text NOT NULL,
	"dayparts" text[],
	"staging_notes" jsonb,
	"city" text,
	"metro" text,
	"ai_estimated_hours" text,
	"business_hours" jsonb,
	"discovery_source" text DEFAULT 'seed' NOT NULL,
	"validated_at" timestamp with time zone,
	"suggestion_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_known_status" text DEFAULT 'unknown',
	"status_checked_at" timestamp with time zone,
	"consecutive_closed_checks" integer DEFAULT 0,
	"auto_suppressed" boolean DEFAULT false,
	"suppression_reason" text,
	CONSTRAINT "venue_catalog_place_id_unique" UNIQUE("place_id")
);
--> statement-breakpoint
CREATE TABLE "venue_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid,
	"place_id" text,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"lat" double precision,
	"lng" double precision,
	"source" text NOT NULL,
	"radius_m" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"snapshot_id" uuid NOT NULL,
	"ranking_id" uuid NOT NULL,
	"place_id" text,
	"venue_name" text NOT NULL,
	"sentiment" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue_metrics" (
	"venue_id" uuid PRIMARY KEY NOT NULL,
	"times_recommended" integer DEFAULT 0 NOT NULL,
	"times_chosen" integer DEFAULT 0 NOT NULL,
	"positive_feedback" integer DEFAULT 0 NOT NULL,
	"negative_feedback" integer DEFAULT 0 NOT NULL,
	"reliability_score" double precision DEFAULT 0.5 NOT NULL,
	"last_verified_by_driver" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_ranking_id_rankings_ranking_id_fk" FOREIGN KEY ("ranking_id") REFERENCES "public"."rankings"("ranking_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_snapshot_id_snapshots_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("snapshot_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_feedback" ADD CONSTRAINT "app_feedback_snapshot_id_snapshots_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("snapshot_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefings" ADD CONSTRAINT "briefings_snapshot_id_snapshots_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("snapshot_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_venue_suggestions" ADD CONSTRAINT "llm_venue_suggestions_ranking_id_rankings_ranking_id_fk" FOREIGN KEY ("ranking_id") REFERENCES "public"."rankings"("ranking_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_venue_suggestions" ADD CONSTRAINT "llm_venue_suggestions_venue_id_created_venue_catalog_venue_id_fk" FOREIGN KEY ("venue_id_created") REFERENCES "public"."venue_catalog"("venue_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_candidates" ADD CONSTRAINT "ranking_candidates_ranking_id_rankings_ranking_id_fk" FOREIGN KEY ("ranking_id") REFERENCES "public"."rankings"("ranking_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rankings" ADD CONSTRAINT "rankings_snapshot_id_snapshots_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("snapshot_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_snapshot_id_snapshots_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("snapshot_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_feedback" ADD CONSTRAINT "strategy_feedback_snapshot_id_snapshots_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("snapshot_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_feedback" ADD CONSTRAINT "strategy_feedback_ranking_id_rankings_ranking_id_fk" FOREIGN KEY ("ranking_id") REFERENCES "public"."rankings"("ranking_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triad_jobs" ADD CONSTRAINT "triad_jobs_snapshot_id_snapshots_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("snapshot_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_feedback" ADD CONSTRAINT "venue_feedback_snapshot_id_snapshots_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("snapshot_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_feedback" ADD CONSTRAINT "venue_feedback_ranking_id_rankings_ranking_id_fk" FOREIGN KEY ("ranking_id") REFERENCES "public"."rankings"("ranking_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_metrics" ADD CONSTRAINT "venue_metrics_venue_id_venue_catalog_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venue_catalog"("venue_id") ON DELETE no action ON UPDATE no action;