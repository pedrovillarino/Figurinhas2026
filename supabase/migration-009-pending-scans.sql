-- Pending WhatsApp scans awaiting user confirmation
CREATE TABLE IF NOT EXISTS pending_scans (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone text NOT NULL,
  scan_data jsonb NOT NULL, -- array of {sticker_id, number, player_name}
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT now() + interval '1 hour'
);

-- Index for fast lookup by phone/user
CREATE INDEX IF NOT EXISTS idx_pending_scans_phone ON pending_scans(phone);
CREATE INDEX IF NOT EXISTS idx_pending_scans_user ON pending_scans(user_id);
