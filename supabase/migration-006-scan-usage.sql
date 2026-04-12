-- =============================================================
-- Migration 006: Scan usage tracking (rate limiting)
-- Controla uso do scan por usuário para proteger custos da API
-- =============================================================

-- Tabela de uso de scans por dia
CREATE TABLE IF NOT EXISTS scan_usage (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scan_date DATE NOT NULL DEFAULT CURRENT_DATE,
  scan_count INT NOT NULL DEFAULT 1,
  last_scan_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, scan_date)
);

-- Index para busca rápida
CREATE INDEX IF NOT EXISTS idx_scan_usage_user_date ON scan_usage(user_id, scan_date);

-- RLS
ALTER TABLE scan_usage ENABLE ROW LEVEL SECURITY;

-- Usuário só vê seu próprio uso
CREATE POLICY "Users can view own scan usage"
  ON scan_usage FOR SELECT
  USING (auth.uid() = user_id);

-- Insert/update via service role (API route) — sem policy de INSERT para anon
-- O route.ts usa service_role key, então bypassa RLS

-- Função para incrementar e checar limite (atomic)
CREATE OR REPLACE FUNCTION increment_scan_usage(p_user_id UUID, p_daily_limit INT DEFAULT 20)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
  v_result JSON;
BEGIN
  -- Upsert: incrementa ou cria registro do dia
  INSERT INTO scan_usage (user_id, scan_date, scan_count, last_scan_at)
  VALUES (p_user_id, CURRENT_DATE, 1, now())
  ON CONFLICT (user_id, scan_date)
  DO UPDATE SET
    scan_count = scan_usage.scan_count + 1,
    last_scan_at = now()
  RETURNING scan_count INTO v_count;

  -- Checa se passou do limite
  IF v_count > p_daily_limit THEN
    -- Reverte o incremento
    UPDATE scan_usage
    SET scan_count = scan_count - 1
    WHERE user_id = p_user_id AND scan_date = CURRENT_DATE;

    v_result := json_build_object(
      'allowed', false,
      'current', v_count - 1,
      'limit', p_daily_limit,
      'resets_at', (CURRENT_DATE + INTERVAL '1 day')::TEXT
    );
  ELSE
    v_result := json_build_object(
      'allowed', true,
      'current', v_count,
      'limit', p_daily_limit,
      'remaining', p_daily_limit - v_count
    );
  END IF;

  RETURN v_result;
END;
$$;

-- Limpeza automática de registros antigos (>30 dias)
-- Pode rodar via cron do Supabase ou pg_cron
CREATE OR REPLACE FUNCTION cleanup_old_scan_usage()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM scan_usage WHERE scan_date < CURRENT_DATE - INTERVAL '30 days';
END;
$$;
