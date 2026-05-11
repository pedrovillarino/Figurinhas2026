-- =============================================================
-- Migration 026: Quick Start (modo onboarding pra quem já tem >50% do álbum)
-- =============================================================
-- Pedro 2026-05-11 (feedback Bruno Henrique): user com 930 figurinhas
-- não vai marcar uma por uma. Quick Start é um modo onboarding com 3
-- passos guiados:
--   1. registrar faltantes → marca todo o resto como coladas
--   2. registrar extras (Coca-Cola / PANINI Extras)
--   3. registrar repetidas
--
-- Enquanto o modo está ativo (quick_start_step IS NOT NULL AND != 'done'):
--   - faixa amarela persistente no topo do app
--   - /scan fica bloqueado (user deve completar o wizard)
--   - banner promocional do quick-start não aparece
--
-- Valores válidos:
--   NULL     → não está no modo (default)
--   'missing'    → no passo 1 (registrando faltantes)
--   'extras'     → no passo 2 (registrando extras especiais)
--   'duplicates' → no passo 3 (registrando repetidas)
--   'done'       → completou ou saiu — não mostra mais banner promocional
-- =============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS quick_start_step TEXT NULL;

-- Constraint dos valores válidos. CHECK não bloqueia NULL.
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_quick_start_step_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_quick_start_step_check
  CHECK (quick_start_step IS NULL OR quick_start_step IN ('missing', 'extras', 'duplicates', 'done'));

-- Index parcial pra queries do tipo "quem tá em onboarding ativo?"
-- Útil pra dashboards / debugging. Pequeno impacto em escrita.
CREATE INDEX IF NOT EXISTS profiles_quick_start_step_active_idx
  ON profiles(quick_start_step)
  WHERE quick_start_step IS NOT NULL AND quick_start_step != 'done';

COMMENT ON COLUMN profiles.quick_start_step IS
  'Passo atual do Quick Start (fluxo de onboarding pra quem já tem álbum físico avançado). '
  'NULL = não está no modo. Valores: missing|extras|duplicates|done.';
