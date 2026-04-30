ALTER TABLE "briefings" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "news" jsonb;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "weather_current" jsonb;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "weather_forecast" jsonb;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "traffic_conditions" jsonb;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "events" jsonb;