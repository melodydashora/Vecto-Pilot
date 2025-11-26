ALTER TABLE "snapshots" DROP CONSTRAINT "snapshots_user_id_users_user_id_fk";
--> statement-breakpoint
ALTER TABLE "snapshots" ALTER COLUMN "user_id" DROP NOT NULL;