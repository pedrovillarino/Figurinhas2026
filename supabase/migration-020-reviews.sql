-- Migration 020: Trade review/rating system

CREATE TABLE trade_reviews (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trade_request_id uuid NOT NULL REFERENCES trade_requests(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reviewed_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text CHECK (char_length(comment) <= 500),
  created_at timestamptz DEFAULT now(),

  -- Each user can only review each trade once
  UNIQUE(trade_request_id, reviewer_id)
);

CREATE INDEX idx_trade_reviews_reviewed ON trade_reviews(reviewed_id);
CREATE INDEX idx_trade_reviews_trade ON trade_reviews(trade_request_id);

-- RLS
ALTER TABLE trade_reviews ENABLE ROW LEVEL SECURITY;

-- Anyone can read reviews (public reputation)
CREATE POLICY "Reviews are publicly readable"
  ON trade_reviews FOR SELECT
  USING (true);

-- Users can only create reviews for their own completed trades
CREATE POLICY "Users create reviews for own trades"
  ON trade_reviews FOR INSERT
  WITH CHECK (
    auth.uid() = reviewer_id
    AND EXISTS (
      SELECT 1 FROM trade_requests tr
      WHERE tr.id = trade_request_id
        AND tr.status = 'approved'
        AND (tr.requester_id = auth.uid() OR tr.target_id = auth.uid())
    )
  );

-- Function to get average rating
CREATE OR REPLACE FUNCTION get_user_rating(p_user_id uuid)
RETURNS TABLE (
  avg_rating numeric,
  review_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ROUND(AVG(rating)::numeric, 1) AS avg_rating,
    COUNT(*) AS review_count
  FROM trade_reviews
  WHERE reviewed_id = p_user_id;
$$;

-- Check if user can review a trade
CREATE OR REPLACE FUNCTION can_review_trade(p_user_id uuid, p_trade_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM trade_requests tr
    WHERE tr.id = p_trade_request_id
      AND tr.status = 'approved'
      AND (tr.requester_id = p_user_id OR tr.target_id = p_user_id)
      AND NOT EXISTS (
        SELECT 1 FROM trade_reviews rv
        WHERE rv.trade_request_id = p_trade_request_id
          AND rv.reviewer_id = p_user_id
      )
  );
$$;
