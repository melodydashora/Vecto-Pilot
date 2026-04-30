CREATE TABLE "coords_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coord_key" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"formatted_address" text NOT NULL,
	"city" text,
	"state" text,
	"country" text,
	"timezone" text,
	"closest_airport" text,
	"closest_airport_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "coords_cache_coord_key_unique" UNIQUE("coord_key")
);
--> statement-breakpoint
ALTER TABLE "snapshots" ALTER COLUMN "device_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "snapshots" ALTER COLUMN "holiday" SET DEFAULT 'none';--> statement-breakpoint
ALTER TABLE "snapshots" ALTER COLUMN "holiday" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ALTER COLUMN "is_holiday" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "device_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "formatted_address" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "app_feedback" ADD COLUMN "formatted_address" text;--> statement-breakpoint
ALTER TABLE "app_feedback" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "app_feedback" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "rankings" ADD COLUMN "formatted_address" text;--> statement-breakpoint
ALTER TABLE "rankings" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "date" text;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "trigger_reason" text;--> statement-breakpoint
ALTER TABLE "strategy_feedback" ADD COLUMN "formatted_address" text;--> statement-breakpoint
ALTER TABLE "strategy_feedback" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "strategy_feedback" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "triad_jobs" ADD COLUMN "formatted_address" text;--> statement-breakpoint
ALTER TABLE "triad_jobs" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "triad_jobs" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "venue_feedback" ADD COLUMN "formatted_address" text;--> statement-breakpoint
ALTER TABLE "venue_feedback" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "venue_feedback" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "briefings" DROP COLUMN "lat";--> statement-breakpoint
ALTER TABLE "briefings" DROP COLUMN "lng";--> statement-breakpoint
ALTER TABLE "briefings" DROP COLUMN "city";--> statement-breakpoint
ALTER TABLE "briefings" DROP COLUMN "state";--> statement-breakpoint
ALTER TABLE "briefings" DROP COLUMN "global_travel";--> statement-breakpoint
ALTER TABLE "briefings" DROP COLUMN "domestic_travel";--> statement-breakpoint
ALTER TABLE "briefings" DROP COLUMN "local_traffic";--> statement-breakpoint
ALTER TABLE "briefings" DROP COLUMN "weather_impacts";--> statement-breakpoint
ALTER TABLE "briefings" DROP COLUMN "events_nearby";--> statement-breakpoint
ALTER TABLE "briefings" DROP COLUMN "holidays";--> statement-breakpoint
ALTER TABLE "briefings" DROP COLUMN "rideshare_intel";--> statement-breakpoint
ALTER TABLE "briefings" DROP COLUMN "citations";--> statement-breakpoint
ALTER TABLE "briefings" DROP COLUMN "tactical_traffic";--> statement-breakpoint
ALTER TABLE "briefings" DROP COLUMN "tactical_closures";--> statement-breakpoint
ALTER TABLE "briefings" DROP COLUMN "tactical_enforcement";--> statement-breakpoint
ALTER TABLE "briefings" DROP COLUMN "tactical_sources";--> statement-breakpoint
ALTER TABLE "snapshots" DROP COLUMN "local_news";--> statement-breakpoint
ALTER TABLE "snapshots" DROP COLUMN "news_briefing";--> statement-breakpoint
ALTER TABLE "snapshots" DROP COLUMN "extras";--> statement-breakpoint
ALTER TABLE "snapshots" DROP COLUMN "last_strategy_day_part";--> statement-breakpoint
ALTER TABLE "snapshots" DROP COLUMN "trigger_reason";