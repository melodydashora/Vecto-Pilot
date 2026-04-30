ALTER TABLE "snapshots" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" DROP COLUMN "lat";--> statement-breakpoint
ALTER TABLE "snapshots" DROP COLUMN "lng";--> statement-breakpoint
ALTER TABLE "snapshots" DROP COLUMN "accuracy_m";--> statement-breakpoint
ALTER TABLE "snapshots" DROP COLUMN "coord_source";--> statement-breakpoint
ALTER TABLE "snapshots" DROP COLUMN "city";--> statement-breakpoint
ALTER TABLE "snapshots" DROP COLUMN "state";--> statement-breakpoint
ALTER TABLE "snapshots" DROP COLUMN "country";--> statement-breakpoint
ALTER TABLE "snapshots" DROP COLUMN "formatted_address";--> statement-breakpoint
ALTER TABLE "snapshots" DROP COLUMN "timezone";--> statement-breakpoint
ALTER TABLE "snapshots" DROP COLUMN "local_iso";--> statement-breakpoint
ALTER TABLE "snapshots" DROP COLUMN "dow";--> statement-breakpoint
ALTER TABLE "snapshots" DROP COLUMN "hour";--> statement-breakpoint
ALTER TABLE "snapshots" DROP COLUMN "day_part_key";