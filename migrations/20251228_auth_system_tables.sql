-- Migration: Authentication System Tables
-- Date: 2025-12-28
-- Purpose: Add driver profiles, vehicles, auth credentials, and verification codes

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. DRIVER PROFILES
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS driver_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,

  -- Personal information
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,

  -- Address
  address_1 TEXT NOT NULL,
  address_2 TEXT,
  city TEXT NOT NULL,
  state_territory TEXT NOT NULL,
  zip_code TEXT,
  country TEXT NOT NULL DEFAULT 'US',

  -- Market selection
  market TEXT NOT NULL,

  -- Rideshare platforms (jsonb array)
  rideshare_platforms JSONB NOT NULL DEFAULT '["uber"]',

  -- Uber service tiers (optional)
  uber_black BOOLEAN DEFAULT FALSE,
  uber_xxl BOOLEAN DEFAULT FALSE,
  uber_comfort BOOLEAN DEFAULT FALSE,
  uber_x BOOLEAN DEFAULT FALSE,
  uber_x_share BOOLEAN DEFAULT FALSE,

  -- Notifications
  marketing_opt_in BOOLEAN DEFAULT FALSE,

  -- Terms & Conditions
  terms_accepted_at TIMESTAMPTZ,
  terms_version TEXT,

  -- Verification status
  email_verified BOOLEAN DEFAULT FALSE,
  phone_verified BOOLEAN DEFAULT FALSE,
  profile_complete BOOLEAN DEFAULT FALSE,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for driver_profiles
CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_profiles_email ON driver_profiles (email);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_phone ON driver_profiles (phone);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_market ON driver_profiles (market);
CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_profiles_user_id ON driver_profiles (user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. DRIVER VEHICLES
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS driver_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_profile_id UUID NOT NULL REFERENCES driver_profiles(id) ON DELETE CASCADE,

  -- Vehicle information
  year INTEGER NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  color TEXT,
  license_plate TEXT,

  -- Capacity
  seatbelts INTEGER NOT NULL DEFAULT 4,

  -- Status
  is_primary BOOLEAN DEFAULT TRUE,
  is_active BOOLEAN DEFAULT TRUE,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for driver_vehicles
CREATE INDEX IF NOT EXISTS idx_driver_vehicles_profile_id ON driver_vehicles (driver_profile_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. AUTH CREDENTIALS
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS auth_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,

  -- Password (bcrypt hashed)
  password_hash TEXT NOT NULL,

  -- Security
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  last_login_ip TEXT,

  -- Password reset
  password_reset_token TEXT,
  password_reset_expires TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for auth_credentials
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_credentials_user_id ON auth_credentials (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_credentials_reset_token ON auth_credentials (password_reset_token);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. VERIFICATION CODES
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,

  -- Code details
  code TEXT NOT NULL,
  code_type TEXT NOT NULL, -- 'email_verify' | 'phone_verify' | 'password_reset_email' | 'password_reset_sms'
  destination TEXT NOT NULL, -- email or phone number

  -- Status
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for verification_codes
CREATE INDEX IF NOT EXISTS idx_verification_codes_code ON verification_codes (code);
CREATE INDEX IF NOT EXISTS idx_verification_codes_destination ON verification_codes (destination);
CREATE INDEX IF NOT EXISTS idx_verification_codes_expires ON verification_codes (expires_at);
CREATE INDEX IF NOT EXISTS idx_verification_codes_user_id ON verification_codes (user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. VEHICLE MAKES CACHE (NHTSA API)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS vehicle_makes_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  make_id INTEGER NOT NULL UNIQUE,
  make_name TEXT NOT NULL,
  is_common BOOLEAN DEFAULT FALSE,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for vehicle_makes_cache
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_makes_cache_make_id ON vehicle_makes_cache (make_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_makes_cache_make_name ON vehicle_makes_cache (make_name);
CREATE INDEX IF NOT EXISTS idx_vehicle_makes_cache_common ON vehicle_makes_cache (is_common);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. VEHICLE MODELS CACHE (NHTSA API)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS vehicle_models_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  make_id INTEGER NOT NULL,
  make_name TEXT NOT NULL,
  model_id INTEGER NOT NULL,
  model_name TEXT NOT NULL,
  model_year INTEGER,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for vehicle_models_cache
CREATE INDEX IF NOT EXISTS idx_vehicle_models_cache_make_year ON vehicle_models_cache (make_id, model_year);
CREATE INDEX IF NOT EXISTS idx_vehicle_models_cache_model_name ON vehicle_models_cache (model_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_models_cache_unique ON vehicle_models_cache (make_id, model_id, COALESCE(model_year, 0));

-- ═══════════════════════════════════════════════════════════════════════════
-- Verify tables created
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  RAISE NOTICE 'Auth system tables created successfully:';
  RAISE NOTICE '  - driver_profiles';
  RAISE NOTICE '  - driver_vehicles';
  RAISE NOTICE '  - auth_credentials';
  RAISE NOTICE '  - verification_codes';
  RAISE NOTICE '  - vehicle_makes_cache';
  RAISE NOTICE '  - vehicle_models_cache';
END $$;
