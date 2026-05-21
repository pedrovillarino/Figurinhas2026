-- =============================================================
-- Migration 030: Trial-paywall hibrido (Pedro 2026-05-21)
-- =============================================================
-- Modelo decidido em docs/trial-7d-analise.md sec 13:
--
-- 3 estados de user free:
--   1. free_legacy:   cadastrou antes de 22/05/2026 -> mantem 5 scans/dia
--                     (is_grandfathered_free=true)
--   2. trial_active:  cadastrou depois de 22/05 -> 7d com limites Colecionador
--                     (trial_starts_at IS NOT NULL AND trial_ends_at > NOW())
--   3. expired:       trial passou -> lockout em scan/trade/audio/Liga, mas
--                     mantem leitura (album, PDF, ranking, loja)
--                     (trial_ends_at <= NOW())
--
-- Pagantes (tier != 'free') seguem como hoje, sempre acima do trial.
--
-- Cutoff: 22/05/2026 00:00 BRT = 22/05/2026 03:00 UTC.
-- =============================================================

-- Cutoff constante (usar em queries futuras)
-- Pra mudar a data, atualizar tambem o trigger e a lib.

-- ── Schema ────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS trial_starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_expired_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_grandfathered_free BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN profiles.trial_starts_at IS
  'Inicio do trial 7d (Colecionador). NULL pra grandfathered ou pagantes.';
COMMENT ON COLUMN profiles.trial_ends_at IS
  'Fim do trial 7d. Pos esse timestamp, free user nao-grandfathered fica em estado expired (lockout em features ativas).';
COMMENT ON COLUMN profiles.trial_expired_notified_at IS
  'Marca quando o user foi notificado sobre expiracao (cron T-1d). Evita re-notificar.';
COMMENT ON COLUMN profiles.is_grandfathered_free IS
  'true = cadastrou antes de 22/05/2026 e mantem Free 5 scans/dia permanente. false = sujeito ao trial-paywall.';

-- ── Indexes ───────────────────────────────────────────────────

-- Query comum: "users com trial ativo agora" e "trials expirando hoje"
CREATE INDEX IF NOT EXISTS idx_profiles_trial_ends_at ON profiles(trial_ends_at)
  WHERE trial_ends_at IS NOT NULL;

-- Query comum: "users grandfathered" pra distincao no painel
CREATE INDEX IF NOT EXISTS idx_profiles_grandfathered ON profiles(is_grandfathered_free)
  WHERE is_grandfathered_free = true;

-- ── Backfill: users existentes ficam grandfathered ────────────

-- Atomicidade: o UPDATE marca TODOS os profiles free que existem ate o
-- momento da migration como grandfathered. Dali pra frente, novos profiles
-- nao estao no UPDATE — entram em trial via trigger abaixo. Cutoff efetivo
-- = momento de execucao desta migration (Pedro 21/05, aprox 22/05 00:00 BRT).
-- Pagantes (tier != 'free') nao precisam de flag — effectiveTier() retorna o
-- tier real direto.
UPDATE profiles
SET is_grandfathered_free = true
WHERE tier = 'free'
  AND is_grandfathered_free = false;

-- ── Trigger: novos signups ganham trial automatico ────────────

CREATE OR REPLACE FUNCTION set_trial_on_new_profile()
RETURNS TRIGGER AS $$
BEGIN
  -- Skip se:
  --   - ja eh grandfathered (caso raro de re-insert)
  --   - ja tem trial setado (idempotencia)
  --   - tier nao eh free (pagantes nao precisam de trial)
  IF NEW.is_grandfathered_free = false
     AND NEW.trial_starts_at IS NULL
     AND COALESCE(NEW.tier, 'free') = 'free' THEN
    NEW.trial_starts_at := COALESCE(NEW.created_at, NOW());
    NEW.trial_ends_at := NEW.trial_starts_at + INTERVAL '7 days';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_set_trial ON profiles;
CREATE TRIGGER trg_profiles_set_trial
  BEFORE INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION set_trial_on_new_profile();

-- ── Helper SQL: effective_tier para uso em RPCs/triggers ──────

-- Pedro 21/05: lib TS em src/lib/trial.ts replica essa logica pra app code.
-- Mantemos versao SQL pra ser usada em RPCs futuros (ex: ranking que
-- considera tier efetivo).
CREATE OR REPLACE FUNCTION effective_tier(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier TEXT;
  v_is_grandfathered BOOLEAN;
  v_trial_ends_at TIMESTAMPTZ;
BEGIN
  SELECT tier, is_grandfathered_free, trial_ends_at
    INTO v_tier, v_is_grandfathered, v_trial_ends_at
  FROM profiles
  WHERE id = p_user_id;

  -- Pagantes sempre retornam tier real
  IF v_tier IS NOT NULL AND v_tier != 'free' THEN
    RETURN v_tier;
  END IF;

  -- Free legacy mantem free permanente
  IF v_is_grandfathered THEN
    RETURN 'free';
  END IF;

  -- Sem trial setado (fallback safe) = trata como free
  IF v_trial_ends_at IS NULL THEN
    RETURN 'free';
  END IF;

  -- Trial ativo = experiencia Colecionador
  IF NOW() < v_trial_ends_at THEN
    RETURN 'colecionador';
  END IF;

  -- Trial expirado = lockout (callsites precisam tratar)
  RETURN 'expired';
END;
$$;

COMMENT ON FUNCTION effective_tier IS
  'Retorna o tier efetivo de gating: pagante mantem tier real, free legacy = free, trial ativo = colecionador, trial expirado = expired.';
