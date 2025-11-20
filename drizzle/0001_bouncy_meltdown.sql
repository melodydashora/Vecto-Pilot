ALTER TABLE "ranking_candidates" ADD COLUMN "event_badge_missing" boolean;--> statement-breakpoint
ALTER TABLE "ranking_candidates" ADD COLUMN "node_type" text;--> statement-breakpoint
ALTER TABLE "ranking_candidates" ADD COLUMN "access_status" text;--> statement-breakpoint
ALTER TABLE "ranking_candidates" ADD COLUMN "aliases" text[];--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "holiday" text;