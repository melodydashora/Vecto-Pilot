ALTER TABLE "strategies" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "user_address" text;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "events" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "news" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "traffic" jsonb DEFAULT '[]'::jsonb;