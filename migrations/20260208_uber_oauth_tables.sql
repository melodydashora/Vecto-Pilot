CREATE TABLE IF NOT EXISTS "oauth_states" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "state" text NOT NULL UNIQUE,
  "provider" text NOT NULL,
  "user_id" uuid NOT NULL,
  "redirect_uri" text,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_oauth_states_state" ON "oauth_states" ("state");
CREATE INDEX IF NOT EXISTS "idx_oauth_states_expires" ON "oauth_states" ("expires_at");

CREATE TABLE IF NOT EXISTS "uber_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL UNIQUE REFERENCES "users"("user_id") ON DELETE CASCADE,
  "access_token_encrypted" text NOT NULL,
  "refresh_token_encrypted" text,
  "token_expires_at" timestamp with time zone,
  "scopes" text[],
  "is_active" boolean DEFAULT true,
  "connected_at" timestamp with time zone DEFAULT now(),
  "last_sync_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_uber_connections_user_id" ON "uber_connections" ("user_id");
