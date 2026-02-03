-- ⚠️ DEPRECATED - DO NOT EDIT
-- This file is kept for historical reference only
-- Current schema source of truth: shared/schema.js (Drizzle ORM)

-- Initial database schema (DEPRECATED)

-- Enable pgcrypto for UUID generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Policies table for user-specific and region-specific rules
CREATE TABLE IF NOT EXISTS policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(128) NOT NULL,
  region VARCHAR(64),
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  rules JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Blocks catalog table for region-specific staging spots
CREATE TABLE IF NOT EXISTS blocks_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region VARCHAR(64) NOT NULL,
  slug VARCHAR(64) NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(region, slug)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_policies_user_region ON policies(user_id, region) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_blocks_region ON blocks_catalog(region);