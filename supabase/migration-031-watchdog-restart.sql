-- migration-031-watchdog-restart.sql
-- Pedro 2026-06-04: postmortem do incident "bot parou de responder" (inbound
-- silencioso 2/jun 23:55 → 4/jun). O watchdog de /api/whatsapp/health passa a
-- ter um segundo nível de recovery (restart da instância Z-API) quando o
-- silêncio persiste. Precisa de um campo pra cooldown do restart (caro:
-- reconecta a sessão), separado do cooldown de alerta.

-- Coluna nova (nullable, aditiva — zero risco).
ALTER TABLE public.watchdog_state
  ADD COLUMN IF NOT EXISTS last_restart_at timestamptz;

-- Garante que a linha do watchdog de webhook exista (o recovery faz UPDATE
-- atômico nela; sem a linha, o claim de cooldown nunca casa).
INSERT INTO public.watchdog_state (id)
VALUES ('webhook_recovery')
ON CONFLICT (id) DO NOTHING;
