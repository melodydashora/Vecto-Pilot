CREATE TABLE "block_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"request_body" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
