-- 2026-04-25: POC public event sign-up flow
-- See docs/plans/PLAN_event-signup-page-2026-04-25.md
-- Two new tables: hosted_events (Melody-curated paid sessions) and event_signups (attendee roster).
-- Distinct from discovered_events (system-discovered via PredictHQ/Ticketmaster) per Rule 11.
-- Idempotent.

CREATE TABLE IF NOT EXISTS "hosted_events" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug"             text NOT NULL UNIQUE,
  "title"            text NOT NULL,
  "description"      text,
  "event_date"       date NOT NULL,
  "start_time"       time,
  "end_time"         time,
  "location_name"    text,
  "location_address" text,
  "max_attendees"    integer NOT NULL DEFAULT 6,
  "price_tiers"      jsonb NOT NULL DEFAULT '[{"min_count":1,"price_cents":12000}]'::jsonb,
  "status"           text NOT NULL DEFAULT 'draft',
  "itinerary_md"     text,
  "itinerary_generated_at" timestamptz,
  "created_by"       uuid,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  "hosted_events" IS 'Operator-curated paid driver-mentor events. Distinct from discovered_events.';
COMMENT ON COLUMN "hosted_events"."price_tiers" IS 'JSONB array of {min_count, price_cents} sorted ascending. computePrice() picks the largest tier whose min_count <= confirmed_count.';
COMMENT ON COLUMN "hosted_events"."status" IS 'draft | published | closed | cancelled';

CREATE INDEX IF NOT EXISTS "idx_hosted_events_published_date"
  ON "hosted_events" ("status", "event_date")
  WHERE "status" = 'published';

CREATE TABLE IF NOT EXISTS "event_signups" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id"              uuid NOT NULL REFERENCES "hosted_events"("id") ON DELETE CASCADE,
  "full_name"             text NOT NULL,
  "email"                 text NOT NULL,
  "phone"                 text,
  "pickup_address"        text,
  "notes"                 text,
  "status"                text NOT NULL DEFAULT 'confirmed',
  "price_cents_at_signup" integer,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "event_signups_event_email_unique" UNIQUE ("event_id", "email")
);

COMMENT ON TABLE  "event_signups" IS 'Per-attendee row for hosted_events sign-up.';
COMMENT ON COLUMN "event_signups"."status" IS 'confirmed | waitlist | cancelled';
COMMENT ON COLUMN "event_signups"."price_cents_at_signup" IS 'Captured at signup time so the attendee knows the exact $ they committed to even if the displayed tiered price changes later.';

CREATE INDEX IF NOT EXISTS "idx_event_signups_event_status_created"
  ON "event_signups" ("event_id", "status", "created_at");
