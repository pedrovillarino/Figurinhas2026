-- Performance indexes for scale

-- Composite covering index on user_stickers (most queried table)
CREATE INDEX IF NOT EXISTS idx_user_stickers_composite
ON user_stickers (user_id, sticker_id, status, quantity);

-- Trade requests: fast lookup by target + status (pending requests banner)
CREATE INDEX IF NOT EXISTS idx_trade_requests_target_status
ON trade_requests (target_id, status);

-- Referral FK indexes (were missing)
CREATE INDEX IF NOT EXISTS idx_profiles_referred_by
ON profiles (referred_by) WHERE referred_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_referral_rewards_referred
ON referral_rewards (referred_id);

-- Scan usage: date + user composite for daily lookups
CREATE INDEX IF NOT EXISTS idx_scan_usage_date_user
ON scan_usage (scan_date, user_id);

-- Stripe events auto-cleanup (call periodically via cron/pg_cron)
CREATE OR REPLACE FUNCTION cleanup_old_stripe_events()
RETURNS void AS $$
BEGIN
  DELETE FROM processed_stripe_events
  WHERE created_at < now() - interval '30 days';
END;
$$ LANGUAGE plpgsql;
