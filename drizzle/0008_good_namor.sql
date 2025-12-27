CREATE TABLE "nearby_venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid,
	"name" text NOT NULL,
	"venue_type" text NOT NULL,
	"address" text,
	"lat" double precision,
	"lng" double precision,
	"expense_level" text,
	"expense_rank" integer,
	"is_open" boolean DEFAULT true,
	"hours_today" text,
	"closing_soon" boolean DEFAULT false,
	"minutes_until_close" integer,
	"crowd_level" text,
	"rideshare_potential" text,
	"city" text,
	"state" text,
	"search_sources" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traffic_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"city" text,
	"state" text,
	"traffic_density" integer,
	"density_level" text,
	"congestion_areas" jsonb,
	"high_demand_zones" jsonb,
	"driver_advice" text,
	"sources" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "nearby_venues" ADD CONSTRAINT "nearby_venues_snapshot_id_snapshots_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("snapshot_id") ON DELETE cascade ON UPDATE no action;