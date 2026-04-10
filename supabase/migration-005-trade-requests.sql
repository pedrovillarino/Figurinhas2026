-- =============================================================
-- Migration 005: Trade Request Approval Flow
-- Run this in Supabase SQL Editor
-- =============================================================

-- Table to store trade requests (pending approval)
CREATE TABLE trade_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  match_score INTEGER DEFAULT 0,
  they_have INTEGER DEFAULT 0,       -- what target has that requester needs
  i_have INTEGER DEFAULT 0,          -- what requester has that target needs
  distance_km DOUBLE PRECISION,
  message TEXT,                       -- optional message from requester
  token TEXT UNIQUE,                  -- unique token for WhatsApp approve/reject links
  responded_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '72 hours'),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Prevent duplicate pending requests between same users
CREATE UNIQUE INDEX idx_trade_requests_unique_pending
  ON trade_requests (requester_id, target_id)
  WHERE status = 'pending';

-- Index for querying pending requests for a user
CREATE INDEX idx_trade_requests_target ON trade_requests (target_id, status);
CREATE INDEX idx_trade_requests_requester ON trade_requests (requester_id, status);
CREATE INDEX idx_trade_requests_token ON trade_requests (token);
CREATE INDEX idx_trade_requests_expires ON trade_requests (expires_at) WHERE status = 'pending';

-- RLS
ALTER TABLE trade_requests ENABLE ROW LEVEL SECURITY;

-- Users can see requests where they are requester or target
CREATE POLICY "Users see own trade requests"
  ON trade_requests FOR SELECT
  USING (auth.uid() = requester_id OR auth.uid() = target_id);

-- Users can insert requests where they are the requester
CREATE POLICY "Users create own trade requests"
  ON trade_requests FOR INSERT
  WITH CHECK (auth.uid() = requester_id);

-- Users can update requests where they are the target (approve/reject)
CREATE POLICY "Target users respond to trade requests"
  ON trade_requests FOR UPDATE
  USING (auth.uid() = target_id);

-- Function to count pending trade requests for a user
CREATE OR REPLACE FUNCTION get_pending_trade_requests(p_user_id UUID)
RETURNS TABLE(
  id UUID,
  requester_id UUID,
  requester_name TEXT,
  requester_avatar TEXT,
  they_have INTEGER,
  i_have INTEGER,
  match_score INTEGER,
  distance_km DOUBLE PRECISION,
  message TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    tr.id,
    tr.requester_id,
    p.display_name AS requester_name,
    p.avatar_url AS requester_avatar,
    tr.they_have,
    tr.i_have,
    tr.match_score,
    tr.distance_km,
    tr.message,
    tr.created_at
  FROM trade_requests tr
  JOIN profiles p ON p.id = tr.requester_id
  WHERE tr.target_id = p_user_id
    AND tr.status = 'pending'
    AND tr.expires_at > now()
  ORDER BY tr.created_at DESC;
END;
$$;

-- Auto-expire old pending requests (can be called via cron or on-demand)
CREATE OR REPLACE FUNCTION expire_old_trade_requests()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE trade_requests
  SET status = 'expired'
  WHERE status = 'pending'
    AND expires_at < now();
END;
$$;
