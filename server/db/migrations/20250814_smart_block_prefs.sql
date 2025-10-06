CREATE TABLE IF NOT EXISTS smart_block_prefs (
  user_id TEXT PRIMARY KEY,
  tether_sig TEXT NOT NULL,
  thresholds JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sbp_sig ON smart_block_prefs (tether_sig);