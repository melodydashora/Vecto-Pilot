-- Proof receipts allow one browser to recover a committed login whose reply was
-- lost, or cancel before a delayed authentication can establish a session.
CREATE TABLE IF NOT EXISTS auth_login_attempts (
  proof_hash text PRIMARY KEY,
  attempt_id uuid NOT NULL DEFAULT gen_random_uuid(),
  method text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  user_id uuid REFERENCES users(user_id) ON DELETE RESTRICT,
  session_id uuid,
  is_new_user boolean NOT NULL DEFAULT false,
  password_revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT auth_login_attempts_method_check CHECK (method IN ('password', 'google', 'cancel')),
  CONSTRAINT auth_login_attempts_status_check CHECK (status IN ('processing', 'completed', 'failed', 'cancelled')),
  CONSTRAINT auth_login_attempts_proof_hash_check CHECK (proof_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT auth_login_attempts_completed_owner_check CHECK (status <> 'completed' OR (user_id IS NOT NULL AND session_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_login_attempts_attempt_id_key ON auth_login_attempts(attempt_id);
CREATE INDEX IF NOT EXISTS auth_login_attempts_expires_at_idx ON auth_login_attempts(expires_at);
