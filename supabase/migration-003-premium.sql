-- =============================================================
-- Migration 003: Freemium Tiers (free / plus / premium)
-- Run this in Supabase SQL Editor
-- =============================================================

-- Add tier and payment columns to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'free' CHECK (tier IN ('free', 'plus', 'premium'));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS upgraded_at TIMESTAMPTZ;
