-- OAuth Integrations Migration
-- Created: 2026-02-02
-- Purpose: Add tables for Uber OAuth integration and earnings tracking

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- Uber OAuth Connections
-- =============================================================================
CREATE TABLE IF NOT EXISTS uber_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  uber_driver_id VARCHAR(255),
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ NOT NULL,
  scopes TEXT[] DEFAULT '{}',
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  last_sync_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uber_connections_user_unique UNIQUE (user_id)
);

-- Index for efficient lookups by user
CREATE INDEX IF NOT EXISTS idx_uber_connections_user_id ON uber_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_uber_connections_active ON uber_connections(user_id) WHERE is_active = true;

-- =============================================================================
-- Uber Trips (earnings data from webhooks)
-- =============================================================================
CREATE TABLE IF NOT EXISTS uber_trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  uber_trip_id VARCHAR(255) NOT NULL UNIQUE,
  fare DECIMAL(10,2),
  distance_miles DECIMAL(10,2),
  duration_minutes INTEGER,
  surge_multiplier DECIMAL(4,2) DEFAULT 1.00,
  pickup_time TIMESTAMPTZ,
  dropoff_time TIMESTAMPTZ,
  pickup_location JSONB,  -- { lat, lng, address }
  dropoff_location JSONB, -- { lat, lng, address }
  vehicle_type VARCHAR(50), -- uberX, uberXL, Comfort, etc.
  raw_data JSONB,  -- Full webhook payload for debugging
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for trip queries
CREATE INDEX IF NOT EXISTS idx_uber_trips_user_id ON uber_trips(user_id);
CREATE INDEX IF NOT EXISTS idx_uber_trips_pickup_time ON uber_trips(pickup_time);
CREATE INDEX IF NOT EXISTS idx_uber_trips_user_pickup ON uber_trips(user_id, pickup_time DESC);

-- =============================================================================
-- Uber Payments (payment events from webhooks)
-- =============================================================================
CREATE TABLE IF NOT EXISTS uber_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  uber_payment_id VARCHAR(255) NOT NULL UNIQUE,
  amount DECIMAL(10,2) NOT NULL,
  payment_type VARCHAR(50), -- trip_earning, bonus, tip, adjustment
  event_time TIMESTAMPTZ NOT NULL,
  description TEXT,
  related_trip_id UUID REFERENCES uber_trips(id),
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for payment queries
CREATE INDEX IF NOT EXISTS idx_uber_payments_user_id ON uber_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_uber_payments_event_time ON uber_payments(event_time);
CREATE INDEX IF NOT EXISTS idx_uber_payments_user_time ON uber_payments(user_id, event_time DESC);

-- =============================================================================
-- Generic OAuth State (for CSRF protection during OAuth flow)
-- =============================================================================
CREATE TABLE IF NOT EXISTS oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state VARCHAR(255) NOT NULL UNIQUE,
  provider VARCHAR(50) NOT NULL, -- 'uber', 'lyft', etc.
  user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
  redirect_uri TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for state lookup and cleanup
CREATE INDEX IF NOT EXISTS idx_oauth_states_state ON oauth_states(state);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);

-- =============================================================================
-- Trigger: Update updated_at on uber_connections
-- =============================================================================
CREATE OR REPLACE FUNCTION update_uber_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_uber_connections_updated_at ON uber_connections;
CREATE TRIGGER trigger_uber_connections_updated_at
  BEFORE UPDATE ON uber_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_uber_connections_updated_at();

-- =============================================================================
-- Cleanup job helper: Remove expired OAuth states
-- =============================================================================
-- Run periodically: DELETE FROM oauth_states WHERE expires_at < NOW();
