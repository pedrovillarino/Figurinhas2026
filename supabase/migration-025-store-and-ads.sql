-- =============================================================
-- Migration 025: Loja afiliados ML + Ads contextuais pra free users
-- =============================================================
-- Pedro 2026-05-05: dois objetivos casados:
-- 1. /loja standalone com produtos ML Afiliados (curados)
-- 2. Sugestões contextuais pra free users (hasAds=true) com link
--    "Sem anúncios? Upgrade →" pra direcionar pra /upgrade.
--
-- Ambas dependem da mesma tabela store_products. ad_placements
-- mapeia "spot na UI" → "produto a mostrar".
-- =============================================================

-- ── store_products ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS store_products (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  -- preço fica como string pq varia no ML (ex: "R$ 12,90", "A partir de R$ 9,90")
  price_display TEXT,
  -- URL de afiliado já com tracking embutido — Pedro cola depois do cadastro ML
  affiliate_url TEXT NOT NULL,
  -- categorias: 'album' | 'pacotes' | 'acessorios' | 'camisas' | 'bolas' | 'mascotes' | 'outros'
  category TEXT NOT NULL DEFAULT 'outros',
  -- featured aparece em destaque no topo da /loja
  featured BOOLEAN NOT NULL DEFAULT false,
  -- sort_order: menor = aparece primeiro dentro da categoria
  sort_order INT NOT NULL DEFAULT 0,
  -- active=false esconde da /loja sem deletar (admin pode "pausar")
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_products_active_featured ON store_products(active, featured, sort_order)
  WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_store_products_category ON store_products(category, sort_order)
  WHERE active = true;

-- Trigger pra updated_at
CREATE OR REPLACE FUNCTION update_store_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_store_products_updated_at ON store_products;
CREATE TRIGGER trg_store_products_updated_at
  BEFORE UPDATE ON store_products
  FOR EACH ROW
  EXECUTE FUNCTION update_store_products_updated_at();

-- RLS: anônimo lê só ativos; admin (service role) faz tudo
ALTER TABLE store_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_products_public_read"
  ON store_products
  FOR SELECT
  USING (active = true);

-- Service role bypassa RLS (admin via service_role key)

-- ── ad_placements ─────────────────────────────────────────────
-- Mapeia spot da UI → produto a mostrar. Cada placement_id pode ter
-- 1 produto designado (ou null = não renderiza ad nesse spot).
CREATE TABLE IF NOT EXISTS ad_placements (
  -- placement_id é a chave semântica (ex: 'album_empty', 'scan_no_results')
  placement_id TEXT PRIMARY KEY,
  -- produto que vai aparecer nesse spot
  product_id BIGINT REFERENCES store_products(id) ON DELETE SET NULL,
  -- copy override opcional (substitui o title do produto se preenchido)
  copy_override TEXT,
  -- active=false esconde o ad sem deletar (rotação ou pausa)
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION update_ad_placements_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ad_placements_updated_at ON ad_placements;
CREATE TRIGGER trg_ad_placements_updated_at
  BEFORE UPDATE ON ad_placements
  FOR EACH ROW
  EXECUTE FUNCTION update_ad_placements_updated_at();

-- RLS: anônimo lê só ativos com produto válido; admin tudo via service role
ALTER TABLE ad_placements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ad_placements_public_read"
  ON ad_placements
  FOR SELECT
  USING (active = true AND product_id IS NOT NULL);

-- ── Seeds dos placements (sem produto associado ainda) ─────────
-- Pedro pluga produtos depois pelo admin. Por ora os 5 spots existem
-- mas product_id=null → componente <FreeUserAd> renderiza null.
INSERT INTO ad_placements (placement_id, copy_override, active) VALUES
  ('album_empty',          null, true),
  ('scan_no_results',      null, true),
  ('album_progress_50',    null, true),
  ('trades_empty',         null, true),
  ('album_footer',         null, true)
ON CONFLICT (placement_id) DO NOTHING;

COMMENT ON TABLE store_products IS
  'Pedro 2026-05-05: catálogo curado de produtos ML Afiliados pra /loja e ads contextuais.';

COMMENT ON TABLE ad_placements IS
  'Pedro 2026-05-05: mapeia spot da UI → produto a exibir pra free users (TIER_CONFIG.hasAds=true).';
