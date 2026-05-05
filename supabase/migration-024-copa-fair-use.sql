-- =============================================================
-- Migration 024: Copa Completa fair-use (auto-release de lotes)
-- =============================================================
-- Pedro 2026-05-05: marketing fala "scans ilimitados" no Copa Completa,
-- mas backend libera em lotes de 500 com auditoria. Cláusula 4.9 dos
-- Termos cobre. Aqui está o mecanismo:
--
-- 1. Coluna copa_batches_released no profiles (default 0)
-- 2. Tabela copa_scan_batch_audit (1 row por lote liberado)
-- 3. RPC release_copa_scan_batch_if_needed: idempotente, chamada toda vez
--    que getQuotas roda. Se tier=copa_completa e remaining <= threshold,
--    libera +500 e flag suspicious se uso parece abuso (poucos cromos
--    capturados por scan ou muitos lotes).
-- =============================================================

-- 1. Coluna no profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS copa_batches_released INT NOT NULL DEFAULT 0;

-- 2. Tabela de auditoria
CREATE TABLE IF NOT EXISTS copa_scan_batch_audit (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  released_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  batch_number INT NOT NULL,
  scans_used_at_release INT NOT NULL,
  stickers_total_at_release INT NOT NULL,
  capture_rate NUMERIC(5,3),
  suspicious_flag BOOLEAN NOT NULL DEFAULT false,
  admin_alerted_at TIMESTAMPTZ,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_copa_audit_user ON copa_scan_batch_audit(user_id, released_at DESC);
CREATE INDEX IF NOT EXISTS idx_copa_audit_suspicious ON copa_scan_batch_audit(suspicious_flag) WHERE suspicious_flag = true;

-- RLS: só admin (via service_role) lê/escreve
ALTER TABLE copa_scan_batch_audit ENABLE ROW LEVEL SECURITY;
-- Service role bypassa RLS — não precisa policy explícita pra isso

-- 3. RPC: libera lote de 500 se necessário, com heurística de suspeita
CREATE OR REPLACE FUNCTION release_copa_scan_batch_if_needed(
  p_user_id UUID,
  p_threshold INT DEFAULT 25  -- libera quando faltam <=25 scans
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tier TEXT;
  v_scans_used INT;
  v_scan_credits INT;
  v_batches_released INT;
  v_stickers_count INT;
  v_effective_limit INT;
  v_remaining INT;
  v_capture_rate NUMERIC(5,3);
  v_suspicious BOOLEAN := false;
  v_should_alert BOOLEAN := false;
  v_block BOOLEAN := false;
BEGIN
  SELECT tier,
         COALESCE(scan_credits, 0),
         COALESCE(copa_batches_released, 0)
  INTO v_tier, v_scan_credits, v_batches_released
  FROM profiles
  WHERE id = p_user_id;

  IF v_tier IS NULL OR v_tier <> 'copa_completa' THEN
    RETURN json_build_object('released', false, 'reason', 'not_copa_completa');
  END IF;

  -- Total de scans usados
  SELECT COALESCE(SUM(scan_count), 0) INTO v_scans_used
  FROM scan_usage WHERE user_id = p_user_id;

  v_effective_limit := 500 + v_scan_credits;
  v_remaining := v_effective_limit - v_scans_used;

  -- Não atingiu threshold ainda — sai
  IF v_remaining > p_threshold THEN
    RETURN json_build_object(
      'released', false,
      'reason', 'above_threshold',
      'remaining', v_remaining,
      'effective_limit', v_effective_limit
    );
  END IF;

  -- Heurística de suspeita: capture rate (cromos no álbum / scans usados)
  -- Álbum tem ~1072 cromos. Cada scan deveria identificar ao menos 1-3 cromos.
  -- Se capture_rate < 0.3 após >= 1 lote já liberado, sinal de uso atípico.
  SELECT COUNT(*) INTO v_stickers_count
  FROM user_stickers WHERE user_id = p_user_id;

  IF v_scans_used > 0 THEN
    v_capture_rate := v_stickers_count::NUMERIC / v_scans_used::NUMERIC;
  ELSE
    v_capture_rate := NULL;
  END IF;

  -- Marca suspicious se já passou de 1 lote E capture rate baixo
  IF v_batches_released >= 1 AND v_capture_rate IS NOT NULL AND v_capture_rate < 0.3 THEN
    v_suspicious := true;
  END IF;

  -- Pausa liberação automática se MUITOS lotes (>=5 = 2500 scans, mais que 2x o álbum)
  -- E uso suspeito. Aí precisa revisão manual antes de soltar mais.
  IF v_batches_released >= 5 AND v_suspicious THEN
    v_block := true;
  END IF;

  -- Alerta admin a partir do 3º lote (1500 scans = 1.4x álbum)
  IF v_batches_released >= 2 THEN  -- 3º lote = batches_released atualmente 2, vai virar 3
    v_should_alert := true;
  END IF;

  IF v_block THEN
    RETURN json_build_object(
      'released', false,
      'reason', 'paused_for_review',
      'batches_released', v_batches_released,
      'scans_used', v_scans_used,
      'stickers_count', v_stickers_count,
      'capture_rate', v_capture_rate,
      'suspicious', true,
      'should_alert_admin', true
    );
  END IF;

  -- Libera o lote: +500 em scan_credits + incrementa contador
  UPDATE profiles
  SET scan_credits = COALESCE(scan_credits, 0) + 500,
      copa_batches_released = COALESCE(copa_batches_released, 0) + 1
  WHERE id = p_user_id;

  -- Auditoria
  INSERT INTO copa_scan_batch_audit (
    user_id, batch_number, scans_used_at_release,
    stickers_total_at_release, capture_rate, suspicious_flag
  ) VALUES (
    p_user_id, v_batches_released + 1, v_scans_used,
    v_stickers_count, v_capture_rate, v_suspicious
  );

  RETURN json_build_object(
    'released', true,
    'batch_number', v_batches_released + 1,
    'new_credits', v_scan_credits + 500,
    'new_effective_limit', v_effective_limit + 500,
    'scans_used', v_scans_used,
    'stickers_count', v_stickers_count,
    'capture_rate', v_capture_rate,
    'suspicious', v_suspicious,
    'should_alert_admin', v_should_alert
  );
END;
$$;

COMMENT ON FUNCTION release_copa_scan_batch_if_needed IS
  'Pedro 2026-05-05: implementa fair-use Copa Completa. Libera +500 scans automaticamente quando user se aproxima do limite. Auditoria + heurística de suspeita por capture rate. Bloqueia liberação se 5+ lotes E suspicious.';
