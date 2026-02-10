CREATE TABLE "auth_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"password_hash" text NOT NULL,
	"failed_login_attempts" integer DEFAULT 0,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"last_login_ip" text,
	"password_reset_token" text,
	"password_reset_expires" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_credentials_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "coach_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"snapshot_id" uuid,
	"market_slug" text,
	"conversation_id" uuid NOT NULL,
	"parent_message_id" uuid,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"content_type" text DEFAULT 'text',
	"topic_tags" jsonb DEFAULT '[]',
	"extracted_tips" jsonb DEFAULT '[]',
	"sentiment" text,
	"location_context" jsonb,
	"time_context" jsonb,
	"tokens_in" integer,
	"tokens_out" integer,
	"model_used" text,
	"is_edited" boolean DEFAULT false,
	"is_regenerated" boolean DEFAULT false,
	"is_starred" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_system_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_type" text NOT NULL,
	"category" text NOT NULL,
	"priority" integer DEFAULT 50,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"user_quote" text,
	"triggering_user_id" uuid,
	"triggering_conversation_id" uuid,
	"triggering_snapshot_id" uuid,
	"occurrence_count" integer DEFAULT 1,
	"affected_users" jsonb DEFAULT '[]',
	"market_slug" text,
	"is_market_specific" boolean DEFAULT false,
	"status" text DEFAULT 'new',
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"implementation_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"code" varchar(2) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"alpha3" varchar(3),
	"phone_code" text,
	"has_platform_data" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 999 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovered_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"venue_name" text,
	"address" text,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"zip" text,
	"lat" double precision,
	"lng" double precision,
	"venue_id" uuid,
	"event_start_date" text NOT NULL,
	"event_start_time" text,
	"event_end_date" text,
	"event_end_time" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"expected_attendance" text DEFAULT 'medium',
	"event_hash" text NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_verified" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"deactivation_reason" text,
	"deactivated_at" timestamp with time zone,
	"deactivated_by" text,
	CONSTRAINT "discovered_events_event_hash_unique" UNIQUE("event_hash")
);
--> statement-breakpoint
CREATE TABLE "driver_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_type" text NOT NULL,
	"target_amount" double precision,
	"target_unit" text DEFAULT 'dollars',
	"deadline" timestamp with time zone,
	"min_hourly_rate" double precision,
	"urgency" text DEFAULT 'normal',
	"is_active" boolean DEFAULT true,
	"progress_amount" double precision DEFAULT 0,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"driver_nickname" text,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"address_1" text NOT NULL,
	"address_2" text,
	"city" text NOT NULL,
	"state_territory" text NOT NULL,
	"zip_code" text,
	"country" text DEFAULT 'US' NOT NULL,
	"home_lat" double precision,
	"home_lng" double precision,
	"home_formatted_address" text,
	"home_timezone" text,
	"market" text NOT NULL,
	"rideshare_platforms" jsonb DEFAULT '["uber"]' NOT NULL,
	"elig_economy" boolean DEFAULT true,
	"elig_xl" boolean DEFAULT false,
	"elig_xxl" boolean DEFAULT false,
	"elig_comfort" boolean DEFAULT false,
	"elig_luxury_sedan" boolean DEFAULT false,
	"elig_luxury_suv" boolean DEFAULT false,
	"attr_electric" boolean DEFAULT false,
	"attr_green" boolean DEFAULT false,
	"attr_wav" boolean DEFAULT false,
	"attr_ski" boolean DEFAULT false,
	"attr_car_seat" boolean DEFAULT false,
	"pref_pet_friendly" boolean DEFAULT false,
	"pref_teen" boolean DEFAULT false,
	"pref_assist" boolean DEFAULT false,
	"pref_shared" boolean DEFAULT false,
	"uber_black" boolean DEFAULT false,
	"uber_xxl" boolean DEFAULT false,
	"uber_comfort" boolean DEFAULT false,
	"uber_x" boolean DEFAULT false,
	"uber_x_share" boolean DEFAULT false,
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"terms_accepted" boolean DEFAULT false NOT NULL,
	"terms_accepted_at" timestamp with time zone,
	"terms_version" text,
	"email_verified" boolean DEFAULT false,
	"phone_verified" boolean DEFAULT false,
	"profile_complete" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "driver_profiles_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "driver_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_at" timestamp with time zone,
	"duration_minutes" integer,
	"location" text,
	"place_id" text,
	"lat" double precision,
	"lng" double precision,
	"is_hard_stop" boolean DEFAULT false,
	"priority" integer DEFAULT 50,
	"is_complete" boolean DEFAULT false,
	"completed_at" timestamp with time zone,
	"recurrence" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_profile_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"color" text,
	"license_plate" text,
	"seatbelts" integer DEFAULT 4 NOT NULL,
	"is_primary" boolean DEFAULT true,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intercepted_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" varchar(255) NOT NULL,
	"user_id" uuid,
	"raw_text" text NOT NULL,
	"parsed_data" jsonb,
	"decision" text NOT NULL,
	"decision_reasoning" text,
	"confidence_score" double precision,
	"user_override" text,
	"source" varchar(50) DEFAULT 'siri_shortcut' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_intel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_name" text NOT NULL,
	"intel_type" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"insight_data" jsonb,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"day_of_week" text,
	"time_of_day" text,
	"source" text DEFAULT 'ai_coach' NOT NULL,
	"source_model" text,
	"contributed_by" uuid,
	"priority" integer DEFAULT 5 NOT NULL,
	"confidence_score" double precision,
	"is_active" boolean DEFAULT true NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_intelligence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market" text NOT NULL,
	"market_slug" text NOT NULL,
	"platform" text DEFAULT 'both' NOT NULL,
	"intel_type" text NOT NULL,
	"intel_subtype" text,
	"title" text NOT NULL,
	"summary" text,
	"content" text NOT NULL,
	"neighborhoods" jsonb,
	"boundaries" jsonb,
	"time_context" jsonb,
	"tags" jsonb DEFAULT '[]',
	"priority" integer DEFAULT 50,
	"source" text DEFAULT 'research' NOT NULL,
	"source_file" text,
	"source_section" text,
	"confidence" integer DEFAULT 80,
	"version" integer DEFAULT 1,
	"effective_date" timestamp with time zone,
	"expiry_date" timestamp with time zone,
	"is_active" boolean DEFAULT true,
	"is_verified" boolean DEFAULT false,
	"coach_can_cite" boolean DEFAULT true,
	"coach_priority" integer DEFAULT 50,
	"created_by" text DEFAULT 'system' NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"market_slug" text PRIMARY KEY NOT NULL,
	"market_name" text NOT NULL,
	"primary_city" text NOT NULL,
	"state" text NOT NULL,
	"country_code" varchar(2) DEFAULT 'US' NOT NULL,
	"timezone" text NOT NULL,
	"primary_airport_code" text,
	"secondary_airports" jsonb,
	"city_aliases" jsonb,
	"has_uber" boolean DEFAULT true NOT NULL,
	"has_lyft" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_deactivations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"news_hash" text NOT NULL,
	"news_title" text NOT NULL,
	"news_source" text,
	"reason" text NOT NULL,
	"deactivated_by" text DEFAULT 'user' NOT NULL,
	"scope" text DEFAULT 'user',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" text NOT NULL,
	"provider" text NOT NULL,
	"user_id" uuid NOT NULL,
	"redirect_uri" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_states_state_unique" UNIQUE("state")
);
--> statement-breakpoint
CREATE TABLE "platform_data" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"country" text NOT NULL,
	"country_code" text,
	"region" text,
	"city" text NOT NULL,
	"market" text,
	"market_anchor" text,
	"region_type" text,
	"timezone" text,
	"coord_boundary" jsonb,
	"center_lat" double precision,
	"center_lng" double precision,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safe_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"zone_name" text NOT NULL,
	"zone_type" text NOT NULL,
	"geometry" text,
	"center_lat" double precision,
	"center_lng" double precision,
	"radius_miles" double precision,
	"neighborhoods" text,
	"risk_level" integer,
	"risk_notes" text,
	"is_active" boolean DEFAULT true,
	"applies_at_night" boolean DEFAULT true,
	"applies_at_day" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staging_saturation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"h3_cell" text NOT NULL,
	"venue_name" text,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"suggestion_count" integer DEFAULT 0 NOT NULL,
	"active_drivers" integer DEFAULT 0,
	"market_slug" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uber_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text,
	"token_expires_at" timestamp with time zone,
	"scopes" text[],
	"is_active" boolean DEFAULT true,
	"connected_at" timestamp with time zone DEFAULT now(),
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "uber_connections_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "us_market_cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" text NOT NULL,
	"state_abbr" text,
	"city" text NOT NULL,
	"market_name" text NOT NULL,
	"region_type" text DEFAULT 'Satellite' NOT NULL,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_intel_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"snapshot_id" uuid,
	"note_type" text DEFAULT 'insight' NOT NULL,
	"category" text,
	"title" text,
	"content" text NOT NULL,
	"context" text,
	"market_slug" text,
	"neighborhoods" jsonb,
	"importance" integer DEFAULT 50,
	"confidence" integer DEFAULT 80,
	"times_referenced" integer DEFAULT 0,
	"valid_from" timestamp with time zone DEFAULT now(),
	"valid_until" timestamp with time zone,
	"is_active" boolean DEFAULT true,
	"is_pinned" boolean DEFAULT false,
	"source_message_id" text,
	"created_by" text DEFAULT 'ai_coach' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_makes_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"make_id" integer NOT NULL,
	"make_name" text NOT NULL,
	"is_common" boolean DEFAULT false,
	"cached_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_makes_cache_make_id_unique" UNIQUE("make_id")
);
--> statement-breakpoint
CREATE TABLE "vehicle_models_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"make_id" integer NOT NULL,
	"make_name" text NOT NULL,
	"model_id" integer NOT NULL,
	"model_name" text NOT NULL,
	"model_year" integer,
	"cached_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"code" text NOT NULL,
	"code_type" text NOT NULL,
	"destination" text NOT NULL,
	"used_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0,
	"max_attempts" integer DEFAULT 3,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zone_intelligence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_slug" text NOT NULL,
	"zone_type" text NOT NULL,
	"zone_name" text NOT NULL,
	"zone_description" text,
	"lat" double precision,
	"lng" double precision,
	"radius_miles" double precision DEFAULT 0.5,
	"address_hint" text,
	"time_constraints" jsonb DEFAULT '{}',
	"is_time_specific" boolean DEFAULT false,
	"reports_count" integer DEFAULT 1,
	"confidence_score" integer DEFAULT 50,
	"contributing_users" jsonb DEFAULT '[]',
	"source_conversations" jsonb DEFAULT '[]',
	"last_reason" text,
	"last_reported_by" uuid,
	"last_reported_at" timestamp with time zone,
	"is_active" boolean DEFAULT true,
	"verified_by_admin" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nearby_venues" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "nearby_venues" CASCADE;--> statement-breakpoint
ALTER TABLE "coords_cache" ALTER COLUMN "city" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "coords_cache" ALTER COLUMN "state" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "coords_cache" ALTER COLUMN "country" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "coords_cache" ALTER COLUMN "timezone" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ALTER COLUMN "date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ALTER COLUMN "lat" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ALTER COLUMN "lng" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ALTER COLUMN "city" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ALTER COLUMN "state" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ALTER COLUMN "country" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ALTER COLUMN "formatted_address" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ALTER COLUMN "timezone" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ALTER COLUMN "local_iso" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ALTER COLUMN "dow" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ALTER COLUMN "hour" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ALTER COLUMN "day_part_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_memory" ADD COLUMN "scope" text NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_memory" ADD COLUMN "key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_memory" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_memory" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "airport_conditions" jsonb;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "holiday" text;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "places_cache" ADD COLUMN "coords_key" text PRIMARY KEY NOT NULL;--> statement-breakpoint
ALTER TABLE "ranking_candidates" ADD COLUMN "district" text;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "coord_key" text;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "market" text;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "phase" text DEFAULT 'starting';--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "phase_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "current_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "session_start_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_active_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "district" text;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "district_slug" text;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "district_centroid_lat" double precision;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "district_centroid_lng" double precision;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "address_1" text;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "address_2" text;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "zip" text;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "country" text DEFAULT 'US';--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "formatted_address" text;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "normalized_name" text;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "coord_key" text;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "venue_types" jsonb DEFAULT '[]';--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "market_slug" text;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "expense_rank" integer;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "hours_full_week" jsonb;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "crowd_level" text;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "rideshare_potential" text;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "hours_source" text;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "capacity_estimate" integer;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "source_model" text;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "access_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "last_accessed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "updated_at" timestamp with time zone DEFAULT NOW();--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "is_bar" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "is_event_venue" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD COLUMN "record_status" text DEFAULT 'stub' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_credentials" ADD CONSTRAINT "auth_credentials_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_conversations" ADD CONSTRAINT "coach_conversations_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_conversations" ADD CONSTRAINT "coach_conversations_snapshot_id_snapshots_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("snapshot_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_system_notes" ADD CONSTRAINT "coach_system_notes_triggering_user_id_users_user_id_fk" FOREIGN KEY ("triggering_user_id") REFERENCES "public"."users"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_system_notes" ADD CONSTRAINT "coach_system_notes_triggering_snapshot_id_snapshots_snapshot_id_fk" FOREIGN KEY ("triggering_snapshot_id") REFERENCES "public"."snapshots"("snapshot_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovered_events" ADD CONSTRAINT "discovered_events_venue_id_venue_catalog_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venue_catalog"("venue_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_goals" ADD CONSTRAINT "driver_goals_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_tasks" ADD CONSTRAINT "driver_tasks_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_vehicles" ADD CONSTRAINT "driver_vehicles_driver_profile_id_driver_profiles_id_fk" FOREIGN KEY ("driver_profile_id") REFERENCES "public"."driver_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_deactivations" ADD CONSTRAINT "news_deactivations_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safe_zones" ADD CONSTRAINT "safe_zones_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uber_connections" ADD CONSTRAINT "uber_connections_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_intel_notes" ADD CONSTRAINT "user_intel_notes_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_intel_notes" ADD CONSTRAINT "user_intel_notes_snapshot_id_snapshots_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("snapshot_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_codes" ADD CONSTRAINT "verification_codes_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_intelligence" ADD CONSTRAINT "zone_intelligence_last_reported_by_users_user_id_fk" FOREIGN KEY ("last_reported_by") REFERENCES "public"."users"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory" DROP COLUMN "session_id";--> statement-breakpoint
ALTER TABLE "agent_memory" DROP COLUMN "entry_type";--> statement-breakpoint
ALTER TABLE "agent_memory" DROP COLUMN "title";--> statement-breakpoint
ALTER TABLE "agent_memory" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "agent_memory" DROP COLUMN "metadata";--> statement-breakpoint
ALTER TABLE "places_cache" DROP COLUMN "place_id";--> statement-breakpoint
ALTER TABLE "snapshots" DROP COLUMN "airport_context";--> statement-breakpoint
ALTER TABLE "snapshots" DROP COLUMN "device";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "strategy_id";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "correlation_id";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "strategy";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "trigger_reason";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "error_code";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "attempt";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "latency_ms";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "tokens";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "next_retry_at";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "model_name";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "model_params";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "prompt_version";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "lat";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "lng";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "city";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "state";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "user_address";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "events";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "news";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "traffic";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "valid_window_start";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "valid_window_end";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "strategy_timestamp";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "user_resolved_address";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "user_resolved_city";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "user_resolved_state";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "minstrategy";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "holiday";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "briefing_news";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "briefing_events";--> statement-breakpoint
ALTER TABLE "strategies" DROP COLUMN "briefing_traffic";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "lat";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "lng";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "accuracy_m";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "coord_source";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "new_lat";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "new_lng";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "new_accuracy_m";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "formatted_address";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "city";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "state";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "country";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "timezone";--> statement-breakpoint
ALTER TABLE "venue_catalog" ADD CONSTRAINT "venue_catalog_coord_key_unique" UNIQUE("coord_key");