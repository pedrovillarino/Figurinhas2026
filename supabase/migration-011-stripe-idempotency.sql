-- Idempotency table for Stripe webhook events
-- Prevents duplicate plan activations when Stripe retries webhooks

CREATE TABLE IF NOT EXISTS processed_stripe_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookups by event_id (UNIQUE already creates one, but explicit for clarity)
-- Auto-cleanup: events older than 30 days can be purged
COMMENT ON TABLE processed_stripe_events IS 'Idempotency guard for Stripe webhook replay protection';

-- RLS: only service_role should access this table
ALTER TABLE processed_stripe_events ENABLE ROW LEVEL SECURITY;
-- No policies = only service_role (admin) can read/write
