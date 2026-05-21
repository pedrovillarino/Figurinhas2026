-- =============================================================
-- Migration 029: Habilita RLS nas 4 tabelas liga_*
-- =============================================================
-- Pedro 2026-05-21: fix do alerta critico do Supabase advisor.
-- As tabelas da Liga foram criadas no MVP (commit 12e96b5, 11/05) sem
-- ENABLE RLS — anon e authenticated conseguiam ler/escrever direto via
-- PostgREST.
--
-- Decisao: ENABLE sem policy = bloqueia anon E authenticated.
-- service_role bypassa RLS sempre, entao todos os callsites continuam
-- funcionando:
--   - src/lib/liga.ts (awardLigaPoints, checkAndRegisterUnlocks, etc)
--   - src/app/api/liga/opt-in/route.ts
--   - src/app/api/cron/liga-close-temporada/route.ts
--   - src/app/(protected)/liga/page.tsx (server component)
-- Todos usam getAdmin() com SUPABASE_SERVICE_ROLE_KEY.
--
-- Verificado em 21/05 via pg_policies: ZERO policies pre-existentes.
-- Aplicado em prod via Supabase MCP (apply_migration 'enable_rls_liga_tables').
-- Estado no momento do fix:
--   liga_events:     123 rows
--   liga_unlocks:      7 rows
--   liga_rankings:     0 rows
--   liga_temporadas:   4 rows
-- =============================================================

ALTER TABLE public.liga_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.liga_unlocks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.liga_rankings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.liga_temporadas ENABLE ROW LEVEL SECURITY;
