-- Migration 016: Enable RLS on tables that were missing it
-- Tables: pending_scans, referral_rewards, notification_queue
-- These are only accessed via service_role key (server-side),
-- but RLS provides defense-in-depth if anon key is ever leaked.

-- ─── pending_scans ───
ALTER TABLE pending_scans ENABLE ROW LEVEL SECURITY;

-- Users can only see their own pending scans
CREATE POLICY "Users can view own pending scans"
  ON pending_scans FOR SELECT
  USING (auth.uid() = user_id);

-- Only service role can insert/update/delete (from webhook)
-- No anon policies for write = blocked by default with RLS on

-- ─── referral_rewards ───
ALTER TABLE referral_rewards ENABLE ROW LEVEL SECURITY;

-- Users can view rewards where they are the referrer
CREATE POLICY "Users can view own referral rewards"
  ON referral_rewards FOR SELECT
  USING (auth.uid() = referrer_id);

-- Only service role can insert (from auth callback / stripe webhook)

-- ─── notification_queue ───
ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;

-- Users can view their own notifications
CREATE POLICY "Users can view own notifications"
  ON notification_queue FOR SELECT
  USING (auth.uid() = user_id);

-- Only service role can insert/update/delete (from cron / API)
