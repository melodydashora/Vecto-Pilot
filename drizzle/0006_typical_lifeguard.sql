ALTER TABLE "snapshots" ADD COLUMN "local_iso" timestamp;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "dow" integer;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "hour" integer;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "day_part_key" text;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "local_iso";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "dow";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "hour";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "day_part_key";