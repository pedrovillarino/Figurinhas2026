-- Public landing-page stats: snapshot diário dos números mostrados em /
--
-- Pedro 2026-05-11: pra evitar mostrar valores que pulam a cada refresh
-- (figurinhas registradas crescem várias por minuto), guardamos o snapshot
-- num único registro chave→valor, atualizado 1×/dia pelo pg_cron.
--
-- Trade-offs:
--   • Diário (não real-time): credibilidade ("atualizado em DD/MM") +
--     proteção contra regressão (se algum dado limpar, número exibido
--     fica do dia anterior até cron rodar de novo).
--   • Chave-valor (não colunas): adiciona métrica nova sem migration.
--   • Persistir histórico fica pra outra hora (yagni).
--
-- Cron: 5am UTC = 2am BRT (fora de horário de uso, baixo custo).

CREATE TABLE IF NOT EXISTS public_stats (
  key         TEXT PRIMARY KEY,
  value_int   BIGINT,
  value_text  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: leitura pública (LP anônima precisa ler), escrita só service-role.
ALTER TABLE public_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_stats_select_all ON public_stats;
CREATE POLICY public_stats_select_all ON public_stats
  FOR SELECT USING (true);

-- Sem policy de INSERT/UPDATE: só service-role escreve (bypass RLS).

-- ─── Função agregadora ───────────────────────────────────────────────
-- Recalcula todas as chaves de uma vez. Idempotente (UPSERT).
-- Chamada pelo pg_cron e pela migration final.
--
-- Os valores numéricos formatáveis (ex: "6,9 km") são pré-formatados em
-- value_text pra evitar fazer formatação client-side em locale BR.
CREATE OR REPLACE FUNCTION refresh_public_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_registered_total       BIGINT;
  v_ai_scanned             BIGINT;
  v_stickers_traded        BIGINT;
  v_trades_approved        BIGINT;
  v_distance_median        NUMERIC;
  v_cities                 BIGINT;
  v_users                  BIGINT;
BEGIN
  -- 1. Figurinhas registradas no app (sem excluded users)
  SELECT COALESCE(SUM(us.quantity), 0)
  INTO v_registered_total
  FROM user_stickers us
  LEFT JOIN profiles p ON p.id = us.user_id
  WHERE us.quantity > 0
    AND COALESCE(p.excluded_from_campaign, false) = false;

  -- 2. Figurinhas escaneadas com IA (foto, confirmadas pelo user, sem excluded)
  SELECT COALESCE(SUM(sr.matched_count), 0)
  INTO v_ai_scanned
  FROM scan_results sr
  LEFT JOIN profiles p ON p.id = sr.user_id
  WHERE sr.user_confirmed_count > 0
    AND COALESCE(p.excluded_from_campaign, false) = false;

  -- 3. Figurinhas trocadas (soma they_have + i_have nas aprovadas)
  --    Trade nunca envolve excluded (Pedro nao usa o app pra trocar),
  --    mas filtramos por segurança.
  SELECT
    COALESCE(SUM(tr.they_have + tr.i_have), 0),
    COUNT(*)
  INTO v_stickers_traded, v_trades_approved
  FROM trade_requests tr
  LEFT JOIN profiles pr ON pr.id = tr.requester_id
  LEFT JOIN profiles pt ON pt.id = tr.target_id
  WHERE tr.status = 'approved'
    AND COALESCE(pr.excluded_from_campaign, false) = false
    AND COALESCE(pt.excluded_from_campaign, false) = false;

  -- 4. Distância mediana até trocador (só trocas aprovadas — desfecho real)
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY distance_km)
  INTO v_distance_median
  FROM trade_requests
  WHERE status = 'approved' AND distance_km IS NOT NULL;

  -- 5. Cidades distintas (city|state, case-insensitive, alinhado com admin)
  SELECT COUNT(DISTINCT lower(trim(city)) || '|' || COALESCE(lower(trim(state)), ''))
  INTO v_cities
  FROM profiles
  WHERE city IS NOT NULL
    AND length(trim(city)) > 1
    AND COALESCE(excluded_from_campaign, false) = false;

  -- 6. Usuários cadastrados (não exibido até bater floor, mas guardamos)
  SELECT COUNT(*)
  INTO v_users
  FROM profiles
  WHERE COALESCE(excluded_from_campaign, false) = false;

  -- ─── UPSERT ───
  INSERT INTO public_stats (key, value_int, value_text, updated_at) VALUES
    ('registered_total',  v_registered_total, NULL, now()),
    ('ai_scanned',        v_ai_scanned,       NULL, now()),
    ('stickers_traded',   v_stickers_traded,  NULL, now()),
    ('trades_approved',   v_trades_approved,  NULL, now()),
    ('cities',            v_cities,           NULL, now()),
    ('users',             v_users,            NULL, now()),
    ('distance_median_km',
      CASE WHEN v_distance_median IS NULL THEN NULL ELSE ROUND(v_distance_median)::BIGINT END,
      CASE WHEN v_distance_median IS NULL THEN NULL
           ELSE REPLACE(ROUND(v_distance_median, 1)::TEXT, '.', ',')
      END,
      now())
  ON CONFLICT (key) DO UPDATE
    SET value_int  = EXCLUDED.value_int,
        value_text = EXCLUDED.value_text,
        updated_at = EXCLUDED.updated_at;
END;
$$;

-- Permite que o cron (que roda como postgres) chame; e service-role no app.
GRANT EXECUTE ON FUNCTION refresh_public_stats() TO postgres, service_role;

-- ─── Cron diário ────────────────────────────────────────────────────
-- 5am UTC = 2am BRT. Baixo tráfego, atualização aparece antes das 6am BRT.
-- Idempotente: remove agendamento prévio (se existir) antes de criar.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-public-stats') THEN
    PERFORM cron.unschedule('refresh-public-stats');
  END IF;
END
$cron$;

SELECT cron.schedule(
  'refresh-public-stats',
  '0 5 * * *',
  $$SELECT refresh_public_stats()$$
);

-- ─── Primeira execução: popula imediatamente ────────────────────────
SELECT refresh_public_stats();
