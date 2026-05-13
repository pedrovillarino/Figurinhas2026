-- Pedro 2026-05-13 (caso Isadora): adiciona coluna pra persistir o bairro
-- que o user digita no perfil. Antes o /api/geocode recebia neighborhood
-- pra refinar a busca Nominatim mas descartava a string — user via
-- mensagem "salvo!" e o bairro sumia no próximo carregamento.
--
-- Idempotente. Já rodada manualmente em produção em 2026-05-13.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS neighborhood VARCHAR(100);
