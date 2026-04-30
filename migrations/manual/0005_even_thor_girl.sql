ALTER TABLE "snapshots" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "formatted_address" text;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "timezone" text;