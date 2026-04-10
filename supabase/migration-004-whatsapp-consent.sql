-- =============================================================
-- Migration 004: WhatsApp consent and phone requirement
-- Run this in Supabase SQL Editor
-- =============================================================

-- Add whatsapp_consent column to profiles (default true = authorized)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS whatsapp_consent BOOLEAN DEFAULT true;

-- Update get_trade_matches to only return users who consented to share their WhatsApp
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
  SELECT p.location_lat, p.location_lng
  INTO my_lat, my_lng
  FROM profiles p
  WHERE p.id = p_user_id;

  IF my_lat IS NULL OR my_lng IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH my_owned_ids AS (
    SELECT us.sticker_id
    FROM user_stickers us
    WHERE us.user_id = p_user_id
      AND us.status IN ('owned', 'duplicate')
  ),
  my_duplicate_ids AS (
    SELECT us.sticker_id
    FROM user_stickers us
    WHERE us.user_id = p_user_id
      AND us.status = 'duplicate'
  ),
  nearby AS (
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
      AND p.whatsapp_consent = true  -- only show users who consented
  )
  SELECT
    n.uid,
    n.dname,
    n.avatar,
    n.dist,
    (
      SELECT COUNT(*)
      FROM user_stickers us
      WHERE us.user_id = n.uid
        AND us.status = 'duplicate'
        AND us.sticker_id NOT IN (SELECT sticker_id FROM my_owned_ids)
    ) AS they_have,
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
    (
      SELECT COUNT(*) FROM user_stickers us WHERE us.user_id = n.uid AND us.status = 'duplicate'
        AND us.sticker_id NOT IN (SELECT sticker_id FROM my_owned_ids)
    ) +
    (
      SELECT COUNT(*) FROM my_duplicate_ids md WHERE md.sticker_id NOT IN (
        SELECT us2.sticker_id FROM user_stickers us2
        WHERE us2.user_id = n.uid AND us2.status IN ('owned', 'duplicate')
      )
    ) AS match_score
  FROM nearby n
  WHERE n.dist <= p_radius_km
  ORDER BY match_score DESC, n.dist ASC;
END;
$$;
