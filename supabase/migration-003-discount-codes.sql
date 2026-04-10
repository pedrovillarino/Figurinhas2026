-- Migration 003: Discount codes for influencer distribution
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS discount_codes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code text UNIQUE NOT NULL,
  percent_off integer NOT NULL CHECK (percent_off BETWEEN 1 AND 100),
  tier text NOT NULL DEFAULT 'premium' CHECK (tier IN ('plus', 'premium')),
  max_uses integer DEFAULT NULL, -- NULL = unlimited
  times_used integer DEFAULT 0,
  valid_until timestamptz DEFAULT NULL, -- NULL = no expiry
  created_by text DEFAULT NULL, -- e.g. "influencer_joao"
  created_at timestamptz DEFAULT now(),
  active boolean DEFAULT true
);

-- Track which users used which codes
CREATE TABLE IF NOT EXISTS discount_redemptions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code_id uuid REFERENCES discount_codes(id),
  user_id uuid REFERENCES auth.users(id),
  redeemed_at timestamptz DEFAULT now(),
  tier text NOT NULL,
  percent_off integer NOT NULL,
  UNIQUE(code_id, user_id) -- each user can only use a code once
);

-- Index for fast code lookup
CREATE INDEX IF NOT EXISTS idx_discount_codes_code ON discount_codes(code);
CREATE INDEX IF NOT EXISTS idx_discount_redemptions_user ON discount_redemptions(user_id);

-- RLS: only service_role can read/write (no client access)
ALTER TABLE discount_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_redemptions ENABLE ROW LEVEL SECURITY;

-- No RLS policies = only service_role key can access these tables
-- This is intentional: discount validation goes through our API route

-- Example: create some codes (uncomment and customize)
-- INSERT INTO discount_codes (code, percent_off, tier, max_uses, created_by) VALUES
--   ('COPA100', 100, 'premium', 50, 'launch_campaign'),
--   ('INFLUENCER50', 50, 'premium', 100, 'influencer_program'),
--   ('AMIGO20', 20, 'premium', NULL, 'referral');
