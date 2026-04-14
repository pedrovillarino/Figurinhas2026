-- Enable PostGIS extension for spatial queries
CREATE EXTENSION IF NOT EXISTS postgis SCHEMA extensions;

-- Add geography column to profiles for efficient spatial indexing
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS location_geo geography(Point, 4326);

-- Populate from existing lat/lng
UPDATE profiles
SET location_geo = ST_SetSRID(ST_MakePoint(location_lng, location_lat), 4326)::geography
WHERE location_lat IS NOT NULL AND location_lng IS NOT NULL AND location_geo IS NULL;

-- GiST index for fast radius searches (replaces bounding box + haversine)
CREATE INDEX IF NOT EXISTS idx_profiles_location_geo
ON profiles USING GIST (location_geo);

-- Auto-sync geography column when lat/lng change
CREATE OR REPLACE FUNCTION sync_location_geo()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.location_lat IS NOT NULL AND NEW.location_lng IS NOT NULL THEN
    NEW.location_geo := ST_SetSRID(ST_MakePoint(NEW.location_lng, NEW.location_lat), 4326)::geography;
  ELSE
    NEW.location_geo := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_location_geo ON profiles;
CREATE TRIGGER trg_sync_location_geo
BEFORE INSERT OR UPDATE OF location_lat, location_lng ON profiles
FOR EACH ROW EXECUTE FUNCTION sync_location_geo();

-- RPC for efficient nearby profile search using PostGIS ST_DWithin
CREATE OR REPLACE FUNCTION find_nearby_profiles(
  p_user_id uuid,
  p_radius_km double precision DEFAULT 100
)
RETURNS TABLE (
  id uuid,
  phone text,
  email text,
  display_name text,
  location_lat double precision,
  location_lng double precision,
  distance_km double precision,
  notify_channel text,
  notify_min_threshold integer,
  notify_priority_stickers integer[],
  notify_radius_km double precision,
  notify_configured boolean,
  last_match_notified_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.phone,
    p.email,
    p.display_name,
    p.location_lat,
    p.location_lng,
    ST_Distance(p.location_geo, me.location_geo) / 1000.0 AS distance_km,
    p.notify_channel,
    p.notify_min_threshold,
    p.notify_priority_stickers,
    p.notify_radius_km,
    p.notify_configured,
    p.last_match_notified_at
  FROM profiles p
  CROSS JOIN (SELECT location_geo FROM profiles WHERE profiles.id = p_user_id) me
  WHERE p.id != p_user_id
    AND p.location_geo IS NOT NULL
    AND me.location_geo IS NOT NULL
    AND ST_DWithin(p.location_geo, me.location_geo, p_radius_km * 1000)
  ORDER BY ST_Distance(p.location_geo, me.location_geo)
  LIMIT 200;
END;
$$ LANGUAGE plpgsql STABLE;
