-- Migration 018: Regional & National Ranking

-- Add city/state to profiles for regional grouping
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS state text;

CREATE INDEX IF NOT EXISTS idx_profiles_city ON profiles(city) WHERE city IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_state ON profiles(state) WHERE state IS NOT NULL;

-- Function to get a user's ranking (avoids materialized view complexity for launch)
CREATE OR REPLACE FUNCTION get_user_ranking(p_user_id uuid)
RETURNS TABLE (
  owned_count bigint,
  national_rank bigint,
  national_total bigint,
  city text,
  city_rank bigint,
  city_total bigint,
  state text,
  state_rank bigint,
  state_total bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_city text;
  v_state text;
  v_owned bigint;
BEGIN
  -- Get user's city/state
  SELECT p.city, p.state INTO v_city, v_state FROM profiles p WHERE p.id = p_user_id;

  -- Count user's owned stickers
  SELECT COUNT(*) INTO v_owned
  FROM user_stickers WHERE user_id = p_user_id AND status IN ('owned', 'duplicate');

  RETURN QUERY
  WITH user_counts AS (
    SELECT
      us.user_id,
      p.city AS u_city,
      p.state AS u_state,
      COUNT(*) AS cnt
    FROM user_stickers us
    JOIN profiles p ON p.id = us.user_id
    WHERE us.status IN ('owned', 'duplicate')
    GROUP BY us.user_id, p.city, p.state
  )
  SELECT
    v_owned AS owned_count,
    -- National rank
    (SELECT COUNT(*) + 1 FROM user_counts WHERE cnt > v_owned)::bigint AS national_rank,
    (SELECT COUNT(*) FROM user_counts)::bigint AS national_total,
    -- City
    v_city AS city,
    CASE WHEN v_city IS NOT NULL THEN
      (SELECT COUNT(*) + 1 FROM user_counts WHERE cnt > v_owned AND u_city = v_city)::bigint
    ELSE NULL END AS city_rank,
    CASE WHEN v_city IS NOT NULL THEN
      (SELECT COUNT(*) FROM user_counts WHERE u_city = v_city)::bigint
    ELSE NULL END AS city_total,
    -- State
    v_state AS state,
    CASE WHEN v_state IS NOT NULL THEN
      (SELECT COUNT(*) + 1 FROM user_counts WHERE cnt > v_owned AND u_state = v_state)::bigint
    ELSE NULL END AS state_rank,
    CASE WHEN v_state IS NOT NULL THEN
      (SELECT COUNT(*) FROM user_counts WHERE u_state = v_state)::bigint
    ELSE NULL END AS state_total;
END;
$$;
