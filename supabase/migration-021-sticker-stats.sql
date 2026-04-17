-- Migration 021: Most wanted / rarest sticker stats
-- Three scopes: by team (section), national, and by neighborhood (2.5km radius)

-- Most wanted stickers (most users are missing them) — by section or global
CREATE OR REPLACE FUNCTION get_most_wanted_stickers(
  p_section text DEFAULT NULL,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  sticker_id integer,
  number varchar(10),
  player_name varchar(100),
  country varchar(50),
  section varchar(50),
  owners_count bigint,
  total_users bigint,
  ownership_pct numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH total AS (
    SELECT COUNT(DISTINCT id)::bigint AS cnt FROM profiles
    WHERE id IN (SELECT DISTINCT user_id FROM user_stickers)
  ),
  sticker_ownership AS (
    SELECT
      s.id AS sid,
      s.number,
      s.player_name,
      s.country,
      s.section,
      COUNT(us.user_id) FILTER (WHERE us.status IN ('owned','duplicate')) AS owners
    FROM stickers s
    LEFT JOIN user_stickers us ON us.sticker_id = s.id
    WHERE (p_section IS NULL OR s.section = p_section)
    GROUP BY s.id, s.number, s.player_name, s.country, s.section
  )
  SELECT
    so.sid AS sticker_id,
    so.number,
    so.player_name,
    so.country,
    so.section,
    so.owners AS owners_count,
    t.cnt AS total_users,
    CASE WHEN t.cnt > 0 THEN ROUND((so.owners::numeric / t.cnt) * 100, 1) ELSE 0 END AS ownership_pct
  FROM sticker_ownership so, total t
  ORDER BY so.owners ASC, so.number ASC
  LIMIT p_limit;
END;
$$;

-- Rarest stickers (fewest owners) — same logic but focused on owned stickers
-- (get_most_wanted already returns the least owned, so this is an alias with different semantics)

-- Most wanted stickers in a radius (neighborhood) around a user
CREATE OR REPLACE FUNCTION get_most_wanted_nearby(
  p_user_id uuid,
  p_radius_km numeric DEFAULT 2.5,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  sticker_id integer,
  number varchar(10),
  player_name varchar(100),
  country varchar(50),
  section varchar(50),
  missing_nearby bigint,
  nearby_users bigint,
  missing_pct numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lat double precision;
  v_lng double precision;
BEGIN
  SELECT location_lat, location_lng INTO v_lat, v_lng
  FROM profiles WHERE id = p_user_id;

  IF v_lat IS NULL OR v_lng IS NULL THEN
    RETURN; -- no results if user has no location
  END IF;

  RETURN QUERY
  WITH nearby_users AS (
    SELECT p.id AS uid
    FROM profiles p
    WHERE p.id != p_user_id
      AND p.location_lat IS NOT NULL
      AND p.location_lng IS NOT NULL
      AND (
        6371 * acos(
          LEAST(1.0, cos(radians(v_lat)) * cos(radians(p.location_lat))
          * cos(radians(p.location_lng) - radians(v_lng))
          + sin(radians(v_lat)) * sin(radians(p.location_lat)))
        )
      ) <= p_radius_km
      AND p.id IN (SELECT DISTINCT user_id FROM user_stickers)
  ),
  total_nearby AS (
    SELECT COUNT(*)::bigint AS cnt FROM nearby_users
  ),
  sticker_missing AS (
    SELECT
      s.id AS sid,
      s.number,
      s.player_name,
      s.country,
      s.section,
      COUNT(nu.uid) FILTER (
        WHERE NOT EXISTS (
          SELECT 1 FROM user_stickers us
          WHERE us.user_id = nu.uid AND us.sticker_id = s.id AND us.status IN ('owned','duplicate')
        )
      ) AS missing_count
    FROM stickers s
    CROSS JOIN nearby_users nu
    GROUP BY s.id, s.number, s.player_name, s.country, s.section
  )
  SELECT
    sm.sid AS sticker_id,
    sm.number,
    sm.player_name,
    sm.country,
    sm.section,
    sm.missing_count AS missing_nearby,
    tn.cnt AS nearby_users,
    CASE WHEN tn.cnt > 0 THEN ROUND((sm.missing_count::numeric / tn.cnt) * 100, 1) ELSE 0 END AS missing_pct
  FROM sticker_missing sm, total_nearby tn
  WHERE sm.missing_count > 0
  ORDER BY sm.missing_count DESC, sm.number ASC
  LIMIT p_limit;
END;
$$;
