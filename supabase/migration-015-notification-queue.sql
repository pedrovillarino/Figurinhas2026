-- Notification retry queue for failed WhatsApp/email sends
CREATE TABLE IF NOT EXISTS notification_queue (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'email', 'push')),
  recipient text NOT NULL, -- phone number or email address
  subject text, -- for email only
  message text NOT NULL, -- message body or HTML
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 3,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

-- Index for the retry processor to find pending notifications efficiently
CREATE INDEX IF NOT EXISTS idx_notification_queue_pending
ON notification_queue (next_retry_at) WHERE status = 'pending';

-- Index for cleanup
CREATE INDEX IF NOT EXISTS idx_notification_queue_created
ON notification_queue (created_at);

-- Auto-cleanup: remove sent notifications older than 7 days, failed older than 30 days
SELECT cron.schedule(
  'cleanup-notification-queue',
  '0 4 * * *',
  $$DELETE FROM notification_queue WHERE
    (status = 'sent' AND created_at < now() - interval '7 days') OR
    (status = 'failed' AND created_at < now() - interval '30 days')$$
);

-- Process pending retries every 5 minutes
-- (The actual processing is done via API route, this just marks stale "processing" back to "pending")
SELECT cron.schedule(
  'unstick-notification-queue',
  '*/5 * * * *',
  $$UPDATE notification_queue SET status = 'pending' WHERE status = 'processing' AND next_retry_at < now() - interval '5 minutes'$$
);
