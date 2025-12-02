ALTER TABLE "nearby_venues" ALTER COLUMN "lat" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "nearby_venues" ALTER COLUMN "lng" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "school_closures" jsonb;--> statement-breakpoint
ALTER TABLE "nearby_venues" ADD COLUMN "distance_miles" double precision;--> statement-breakpoint
ALTER TABLE "nearby_venues" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "nearby_venues" ADD COLUMN "hours_full_week" jsonb;--> statement-breakpoint
ALTER TABLE "nearby_venues" ADD COLUMN "opens_in_minutes" integer;--> statement-breakpoint
ALTER TABLE "nearby_venues" ADD COLUMN "opens_in_future" boolean;--> statement-breakpoint
ALTER TABLE "nearby_venues" ADD COLUMN "was_filtered" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "nearby_venues" ADD COLUMN "day_of_week" integer;--> statement-breakpoint
ALTER TABLE "nearby_venues" ADD COLUMN "is_holiday" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "nearby_venues" ADD COLUMN "holiday_name" text;--> statement-breakpoint
ALTER TABLE "nearby_venues" ADD COLUMN "user_corrections" jsonb DEFAULT '[]';--> statement-breakpoint
ALTER TABLE "nearby_venues" ADD COLUMN "correction_count" integer DEFAULT 0;