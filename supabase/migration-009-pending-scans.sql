-- Pending WhatsApp scans awaiting user confirmation
CREATE TABLE IF NOT EXISTS pending_scans (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone text NOT NULL,
  scan_data jsonb NOT NULL, -- array of {sticker_id, number, player_name, status}
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT now() + interval '1 hour'
);

-- Auto-cleanup: index for fast lookup by phone
CREATE INDEX IF NOT EXISTS idx_pending_scans_phone ON pending_scans(phone);

-- Only keep latest pending scan per user (delete old ones on insert)
CREATE OR REPLACE FUNCTION cleanup_old_pending_scans()
RETURNS trigger AS $$
BEGIN
  DELETE FROM pending_scans
  WHERE user_id = NEW.user_id AND id != NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cleanup_pending_scans ON pending_scans;
CREATE TRIGGER trg_cleanup_pending_scans
  AFTER INSERT ON pending_scans
  FOR EACH ROW EXECUTE FUNCTION cleanup_old_pending_scans();
