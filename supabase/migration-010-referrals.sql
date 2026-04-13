-- Migration 010: Referral / Member-Get-Member system
-- Add referral code and referred_by to profiles

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referral_code text UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES auth.users(id);

-- Generate referral codes for existing users (6 char alphanumeric)
UPDATE profiles SET referral_code = upper(substr(md5(id::text || random()::text), 1, 6))
WHERE referral_code IS NULL;

-- Referral tracking table
CREATE TABLE IF NOT EXISTS referral_rewards (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  referrer_id uuid NOT NULL REFERENCES auth.users(id),
  referred_id uuid NOT NULL REFERENCES auth.users(id),
  reward_type text NOT NULL, -- 'signup' or 'upgrade'
  trade_credits int NOT NULL DEFAULT 0,
  scan_credits int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer ON referral_rewards(referrer_id);
