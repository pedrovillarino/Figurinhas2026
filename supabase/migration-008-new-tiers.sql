-- =============================================================
-- Migration 008: Reestruturação de planos
-- free, estreante, colecionador, copa_completa
-- + créditos de troca (trade_credits)
-- =============================================================

-- 1. Migrar tiers existentes para novos nomes
UPDATE profiles SET tier = 'estreante' WHERE tier = 'plus';
UPDATE profiles SET tier = 'colecionador' WHERE tier = 'premium';

-- 2. Atualizar CHECK constraint do tier
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_tier_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_tier_check
  CHECK (tier IN ('free', 'estreante', 'colecionador', 'copa_completa'));

-- 3. Adicionar coluna trade_credits (créditos de troca comprados avulsos)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trade_credits INT NOT NULL DEFAULT 0;

-- 4. Atualizar discount_codes para novos tiers
UPDATE discount_codes SET tier = 'estreante' WHERE tier = 'plus';
UPDATE discount_codes SET tier = 'colecionador' WHERE tier = 'premium';

ALTER TABLE discount_codes DROP CONSTRAINT IF EXISTS discount_codes_tier_check;
ALTER TABLE discount_codes ADD CONSTRAINT discount_codes_tier_check
  CHECK (tier IN ('estreante', 'colecionador', 'copa_completa'));

-- 5. Criar tabela trade_usage para tracking de trocas
CREATE TABLE IF NOT EXISTS trade_usage (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  trade_request_id BIGINT -- referência à trade_request se aplicável
);

CREATE INDEX IF NOT EXISTS idx_trade_usage_user ON trade_usage(user_id);

-- 6. Função para verificar/incrementar uso de trocas
CREATE OR REPLACE FUNCTION increment_trade_usage(
  p_user_id UUID,
  p_tier_limit INT DEFAULT 2
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
  -- Buscar créditos extras de troca
  SELECT COALESCE(trade_credits, 0) INTO v_extra_credits
  FROM profiles WHERE id = p_user_id;

  -- Limite efetivo = limite do tier + créditos comprados
  v_effective_limit := p_tier_limit + v_extra_credits;

  -- Contar total de trocas já feitas
  SELECT COUNT(*) INTO v_total_used
  FROM trade_usage WHERE user_id = p_user_id;

  -- Verificar se atingiu o limite (Infinity = -1 como convenção)
  IF p_tier_limit != -1 AND v_total_used >= v_effective_limit THEN
    v_result := json_build_object(
      'allowed', false,
      'current', v_total_used,
      'limit', v_effective_limit,
      'tier_limit', p_tier_limit,
      'extra_credits', v_extra_credits
    );
    RETURN v_result;
  END IF;

  -- Registrar uso
  INSERT INTO trade_usage (user_id) VALUES (p_user_id);

  v_total_used := v_total_used + 1;

  v_result := json_build_object(
    'allowed', true,
    'current', v_total_used,
    'limit', v_effective_limit,
    'remaining', CASE WHEN p_tier_limit = -1 THEN 999 ELSE v_effective_limit - v_total_used END,
    'tier_limit', p_tier_limit,
    'extra_credits', v_extra_credits
  );

  RETURN v_result;
END;
$$;

-- 7. Função para adicionar créditos de troca
CREATE OR REPLACE FUNCTION add_trade_credits(p_user_id UUID, p_credits INT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_total INT;
BEGIN
  UPDATE profiles
  SET trade_credits = COALESCE(trade_credits, 0) + p_credits
  WHERE id = p_user_id
  RETURNING trade_credits INTO v_new_total;

  RETURN json_build_object(
    'success', true,
    'credits_added', p_credits,
    'total_credits', v_new_total
  );
END;
$$;

-- 8. RLS para trade_usage
ALTER TABLE trade_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own trade usage"
  ON trade_usage FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage trade usage"
  ON trade_usage FOR ALL
  USING (true)
  WITH CHECK (true);
