-- =============================================================
-- Migration 007: Scan credits system (total limit per account)
-- Substitui o limite diário por limite total baseado no tier
-- =============================================================

-- Adicionar coluna scan_credits no profiles (créditos extras comprados)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS scan_credits INT NOT NULL DEFAULT 0;

-- Recriar a tabela scan_usage para tracking total (não mais diário)
-- Manter a tabela existente mas adaptar a função

-- Reescrever a função para usar limite total baseado no tier + créditos extras
CREATE OR REPLACE FUNCTION increment_scan_usage(
  p_user_id UUID,
  p_daily_limit INT DEFAULT 200  -- fallback, o route.ts passa o valor correto do tier
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_used INT;
  v_extra_credits INT;
  v_effective_limit INT;
  v_result JSON;
BEGIN
  -- Buscar créditos extras do usuário
  SELECT COALESCE(scan_credits, 0) INTO v_extra_credits
  FROM profiles WHERE id = p_user_id;

  -- Limite efetivo = limite do tier + créditos comprados
  v_effective_limit := p_daily_limit + v_extra_credits;

  -- Contar total de scans já feitos (todas as datas)
  SELECT COALESCE(SUM(scan_count), 0) INTO v_total_used
  FROM scan_usage WHERE user_id = p_user_id;

  -- Verificar se já atingiu o limite
  IF v_total_used >= v_effective_limit THEN
    v_result := json_build_object(
      'allowed', false,
      'current', v_total_used,
      'limit', v_effective_limit,
      'tier_limit', p_daily_limit,
      'extra_credits', v_extra_credits
    );
    RETURN v_result;
  END IF;

  -- Incrementar uso (upsert por dia pra manter histórico)
  INSERT INTO scan_usage (user_id, scan_date, scan_count, last_scan_at)
  VALUES (p_user_id, CURRENT_DATE, 1, now())
  ON CONFLICT (user_id, scan_date)
  DO UPDATE SET
    scan_count = scan_usage.scan_count + 1,
    last_scan_at = now();

  v_total_used := v_total_used + 1;

  v_result := json_build_object(
    'allowed', true,
    'current', v_total_used,
    'limit', v_effective_limit,
    'remaining', v_effective_limit - v_total_used,
    'tier_limit', p_daily_limit,
    'extra_credits', v_extra_credits
  );

  RETURN v_result;
END;
$$;

-- Função para adicionar créditos extras (chamada após compra de pack)
CREATE OR REPLACE FUNCTION add_scan_credits(p_user_id UUID, p_credits INT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_total INT;
BEGIN
  UPDATE profiles
  SET scan_credits = COALESCE(scan_credits, 0) + p_credits
  WHERE id = p_user_id
  RETURNING scan_credits INTO v_new_total;

  RETURN json_build_object(
    'success', true,
    'credits_added', p_credits,
    'total_credits', v_new_total
  );
END;
$$;
