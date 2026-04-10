-- =============================================================
-- Migration 002: Trade Matching RPC Functions
-- Run this in Supabase SQL Editor
-- =============================================================

-- Function 1: Get nearby trade matches with match scores
CREATE OR REPLACE FUNCTION get_trade_matches(
  p_user_id UUID,
  p_radius_km DOUBLE PRECISION DEFAULT 50
)
RETURNS TABLE(
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT,
  distance_km DOUBLE PRECISION,
  they_have BIGINT,
  i_have BIGINT,
  match_score BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  my_lat DOUBLE PRECISION;
  my_lng DOUBLE PRECISION;
BEGIN
  -- Get requesting user's location
  SELECT p.location_lat, p.location_lng
  INTO my_lat, my_lng
  FROM profiles p
  WHERE p.id = p_user_id;

  -- If no location, return empty
  IF my_lat IS NULL OR my_lng IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH my_owned_ids AS (
    -- All stickers I own (owned or duplicate)
    SELECT us.sticker_id
    FROM user_stickers us
    WHERE us.user_id = p_user_id
      AND us.status IN ('owned', 'duplicate')
  ),
  my_duplicate_ids AS (
    -- Only my duplicates (available for trade)
    SELECT us.sticker_id
    FROM user_stickers us
    WHERE us.user_id = p_user_id
      AND us.status = 'duplicate'
  ),
  nearby AS (
    -- Find users within radius
    SELECT
      p.id AS uid,
      p.display_name AS dname,
      p.avatar_url AS avatar,
      ROUND(
        (6371 * acos(
          LEAST(1.0, GREATEST(-1.0,
            cos(radians(my_lat)) * cos(radians(p.location_lat))
            * cos(radians(p.location_lng) - radians(my_lng))
            + sin(radians(my_lat)) * sin(radians(p.location_lat))
          ))
        ))::numeric,
        1
      )::DOUBLE PRECISION AS dist
    FROM profiles p
    WHERE p.id != p_user_id
      AND p.location_lat IS NOT NULL
      AND p.location_lng IS NOT NULL
  )
  SELECT
    n.uid,
    n.dname,
    n.avatar,
    n.dist,
    -- they_have: their duplicates that I'm missing
    (
      SELECT COUNT(*)
      FROM user_stickers us
      WHERE us.user_id = n.uid
        AND us.status = 'duplicate'
        AND us.sticker_id NOT IN (SELECT sticker_id FROM my_owned_ids)
    ) AS they_have,
    -- i_have: my duplicates that they're missing
    (
      SELECT COUNT(*)
      FROM my_duplicate_ids md
      WHERE md.sticker_id NOT IN (
        SELECT us2.sticker_id
        FROM user_stickers us2
        WHERE us2.user_id = n.uid
          AND us2.status IN ('owned', 'duplicate')
      )
    ) AS i_have,
    -- match_score = they_have + i_have
    (
      SELECT COUNT(*)
      FROM user_stickers us
      WHERE us.user_id = n.uid
        AND us.status = 'duplicate'
        AND us.sticker_id NOT IN (SELECT sticker_id FROM my_owned_ids)
    )
    +
    (
      SELECT COUNT(*)
      FROM my_duplicate_ids md
      WHERE md.sticker_id NOT IN (
        SELECT us2.sticker_id
        FROM user_stickers us2
        WHERE us2.user_id = n.uid
          AND us2.status IN ('owned', 'duplicate')
      )
    ) AS match_score
  FROM nearby n
  WHERE n.dist <= p_radius_km
  ORDER BY n.dist ASC, match_score DESC
  LIMIT 15;
END;
$$;

-- Function 2: Get detailed sticker lists for a specific trade match
CREATE OR REPLACE FUNCTION get_trade_details(
  p_user_id UUID,
  p_other_id UUID
)
RETURNS TABLE(
  sticker_id INTEGER,
  number VARCHAR(10),
  player_name VARCHAR(100),
  country VARCHAR(50),
  direction TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  -- Stickers they have (duplicate) that I'm missing
  SELECT
    s.id,
    s.number,
    s.player_name,
    s.country,
    'they_have'::TEXT AS direction
  FROM user_stickers us
  JOIN stickers s ON s.id = us.sticker_id
  WHERE us.user_id = p_other_id
    AND us.status = 'duplicate'
    AND us.sticker_id NOT IN (
      SELECT us2.sticker_id
      FROM user_stickers us2
      WHERE us2.user_id = p_user_id
        AND us2.status IN ('owned', 'duplicate')
    )

  UNION ALL

  -- Stickers I have (duplicate) that they're missing
  SELECT
    s.id,
    s.number,
    s.player_name,
    s.country,
    'i_have'::TEXT AS direction
  FROM user_stickers us
  JOIN stickers s ON s.id = us.sticker_id
  WHERE us.user_id = p_user_id
    AND us.status = 'duplicate'
    AND us.sticker_id NOT IN (
      SELECT us2.sticker_id
      FROM user_stickers us2
      WHERE us2.user_id = p_other_id
        AND us2.status IN ('owned', 'duplicate')
    )
  ORDER BY direction, number;
END;
$$;
