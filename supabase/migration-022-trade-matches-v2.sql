-- Migration 022: Improved trade matches with composite score
-- Score = 40% match compatibility + 25% rating + 20% proximity + 15% experience
-- Supports pagination (limit/offset) and section filter

-- See get_trade_matches_v2 function (executed directly in Supabase)
-- This file is for reference only — the function was created via execute_sql
