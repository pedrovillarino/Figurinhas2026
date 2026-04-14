-- Enable pg_cron for automated maintenance tasks
CREATE EXTENSION IF NOT EXISTS pg_cron;
GRANT USAGE ON SCHEMA cron TO postgres;

-- Job 1: Mark expired trades every hour
-- Trades pending beyond expires_at get marked as 'expired'
SELECT cron.schedule(
  'expire-stale-trades',
  '0 * * * *',
  $$UPDATE trade_requests SET status = 'expired' WHERE status = 'pending' AND expires_at < now()$$
);

-- Job 2: Cleanup old Stripe idempotency events daily at 3am UTC
-- Keeps table small by removing events older than 30 days
SELECT cron.schedule(
  'cleanup-stripe-events',
  '0 3 * * *',
  $$DELETE FROM processed_stripe_events WHERE created_at < now() - interval '30 days'$$
);
