-- Migration 017: QR Code + Album Comparator functions

-- Compare stickers between two users (for the comparator page)
-- Returns only tradeable stickers: viewer's duplicates that target needs, and vice-versa
CREATE OR REPLACE FUNCTION compare_stickers(p_viewer_id uuid, p_target_id uuid)
RETURNS TABLE (
  sticker_id integer,
  number varchar(10),
  player_name varchar(100),
  country varchar(50),
  viewer_status text,
  target_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id AS sticker_id,
    s.number,
    s.player_name,
    s.country,
    v.status AS viewer_status,
    t.status AS target_status
  FROM stickers s
  LEFT JOIN user_stickers v ON v.sticker_id = s.id AND v.user_id = p_viewer_id
  LEFT JOIN user_stickers t ON t.sticker_id = s.id AND t.user_id = p_target_id
  WHERE (
    (v.status = 'duplicate' AND (t.status IS NULL OR t.status = 'missing'))
    OR
    (t.status = 'duplicate' AND (v.status IS NULL OR v.status = 'missing'))
  )
  ORDER BY s.country, s.number;
END;
$$;

-- Public profile stats (no auth required, for unauthenticated visitors)
CREATE OR REPLACE FUNCTION get_public_profile_stats(p_ref_code text)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  owned_count bigint,
  duplicate_count bigint,
  total_stickers bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pr.id AS user_id,
    pr.display_name,
    pr.avatar_url,
    COUNT(*) FILTER (WHERE us.status IN ('owned','duplicate')) AS owned_count,
    COUNT(*) FILTER (WHERE us.status = 'duplicate') AS duplicate_count,
    (SELECT COUNT(*) FROM stickers)::bigint AS total_stickers
  FROM profiles pr
  LEFT JOIN user_stickers us ON us.user_id = pr.id
  WHERE UPPER(pr.referral_code) = UPPER(p_ref_code)
  GROUP BY pr.id, pr.display_name, pr.avatar_url;
END;
$$;
