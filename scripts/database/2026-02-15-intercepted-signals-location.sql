-- 2026-02-15: Add location, market, platform, and response_time_ms to intercepted_signals
-- Purpose: Enable algorithm learning by capturing WHERE offers appear, what platform, and how fast we respond.
-- Driver location uses 3-decimal precision (~110m) — driver is moving, exact GPS unnecessary.

ALTER TABLE intercepted_signals
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS market varchar(100),
  ADD COLUMN IF NOT EXISTS platform varchar(20),
  ADD COLUMN IF NOT EXISTS response_time_ms integer;

-- Market index for algorithm learning queries (e.g., "avg offer price in dallas-tx at 9pm")
CREATE INDEX IF NOT EXISTS idx_intercepted_signals_market
  ON intercepted_signals (market, created_at DESC)
  WHERE market IS NOT NULL;
