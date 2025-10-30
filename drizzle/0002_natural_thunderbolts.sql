ALTER TABLE "strategies" ADD COLUMN "valid_window_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "valid_window_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "strategy_timestamp" timestamp with time zone;