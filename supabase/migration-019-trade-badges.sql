-- Migration 019: Trade badges — completed trades count

CREATE OR REPLACE FUNCTION get_completed_trades_count(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(COUNT(*)::integer, 0)
  FROM trade_requests
  WHERE (requester_id = p_user_id OR target_id = p_user_id)
    AND status = 'approved';
$$;
