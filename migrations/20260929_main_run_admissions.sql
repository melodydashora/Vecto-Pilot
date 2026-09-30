-- P1: explicit Continue intent and canonical settings receipt. Additive only;
-- historical snapshots/strategies are not admitted retroactively or deleted.
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_main_run_id uuid;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS settings_revision integer NOT NULL DEFAULT 1;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS selected_services jsonb;

CREATE TABLE IF NOT EXISTS main_run_admissions (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  session_id uuid NOT NULL,
  request_id uuid NOT NULL,
  settings_revision integer NOT NULL CHECK (settings_revision >= 1),
  rules_version integer NOT NULL CHECK (rules_version >= 1),
  rules_hash text NOT NULL,
  configuration jsonb NOT NULL,
  snapshot_id uuid UNIQUE REFERENCES snapshots(snapshot_id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'awaiting_snapshot',
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT main_run_admissions_intent_unique UNIQUE(user_id, session_id, request_id),
  CONSTRAINT main_run_admissions_status_check CHECK (status IN ('awaiting_snapshot', 'running', 'complete', 'failed'))
);
CREATE INDEX IF NOT EXISTS main_run_admissions_user_created_idx ON main_run_admissions(user_id, created_at);
