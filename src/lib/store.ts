/**
 * Store/Loja afiliados ML + Ads contextuais — Pedro 2026-05-05.
 *
 * Tabelas: store_products + ad_placements (migration 025).
 *
 * Acesso:
 * - Anônimo via RLS pode ler só products active=true e placements
 *   active=true com product_id não-nulo. Sem auth = OK pra /loja pública.
 * - Admin (service role) faz tudo via getStoreAdmin().
 */
import { createClient } from '@supabase/supabase-js'

export type StoreCategory =
  | 'album'
  | 'pacotes'
  | 'acessorios'
  | 'camisas'
  | 'bolas'
  | 'mascotes'
  | 'outros'

export type StoreProduct = {
  id: number
  title: string
  description: string | null
  image_url: string | null
  price_display: string | null
  affiliate_url: string
  category: StoreCategory
  featured: boolean
  sort_order: number
  active: boolean
  created_at: string
  updated_at: string
}

export type AdPlacement = {
  placement_id: string
  product_id: number | null
  copy_override: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export type AdWithProduct = AdPlacement & {
  product: StoreProduct | null
}

/** Service role client — escreve em qualquer tabela, bypassa RLS. */
export function getStoreAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/** Lista produtos ativos (default ordenados: featured first, then sort_order). */
export async function getStoreProducts(opts?: {
  category?: StoreCategory
}): Promise<StoreProduct[]> {
  const admin = getStoreAdmin()
  let query = admin
    .from('store_products')
    .select('*')
    .eq('active', true)
    .order('featured', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })

  if (opts?.category) query = query.eq('category', opts.category)

  const { data, error } = await query
  if (error) {
    console.error('[store] getStoreProducts error:', error.message)
    return []
  }
  return (data || []) as StoreProduct[]
}

/** Admin: lista TODOS os produtos (incluindo inativos). */
export async function getAdminStoreProducts(): Promise<StoreProduct[]> {
  const admin = getStoreAdmin()
  const { data, error } = await admin
    .from('store_products')
    .select('*')
    .order('active', { ascending: false })
    .order('featured', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[store] getAdminStoreProducts error:', error.message)
    return []
  }
  return (data || []) as StoreProduct[]
}

/**
 * Pra um placement_id específico, retorna o produto associado (se ativo).
 * Usado pelo componente FreeUserAd. Retorna null se placement não existe,
 * está inativo, ou não tem produto associado.
 */
export async function getAdForPlacement(placementId: string): Promise<AdWithProduct | null> {
  const admin = getStoreAdmin()
  const { data: placement, error } = await admin
    .from('ad_placements')
    .select('*, product:store_products(*)')
    .eq('placement_id', placementId)
    .eq('active', true)
    .maybeSingle()

  if (error || !placement) return null
  const ad = placement as AdPlacement & { product: StoreProduct | null }
  if (!ad.product || !ad.product.active) return null
  return ad as AdWithProduct
}

/** Admin: lista TODOS os placements com produto associado (se houver). */
export async function getAdminAdPlacements(): Promise<AdWithProduct[]> {
  const admin = getStoreAdmin()
  const { data, error } = await admin
    .from('ad_placements')
    .select('*, product:store_products(*)')
    .order('placement_id', { ascending: true })

  if (error) {
    console.error('[store] getAdminAdPlacements error:', error.message)
    return []
  }
  return (data || []) as AdWithProduct[]
}

/** Categorias com label legível em PT-BR (admin + UI). */
export const CATEGORY_LABELS: Record<StoreCategory, string> = {
  album: 'Álbum',
  pacotes: 'Pacotes',
  acessorios: 'Acessórios',
  camisas: 'Camisas',
  bolas: 'Bolas',
  mascotes: 'Mascotes',
  outros: 'Outros',
}

export const CATEGORY_ORDER: StoreCategory[] = [
  'album',
  'pacotes',
  'acessorios',
  'camisas',
  'bolas',
  'mascotes',
  'outros',
]

/** Placement metadata pra admin UI (descrição do que aparece em cada spot). */
export const PLACEMENT_LABELS: Record<string, { label: string; description: string }> = {
  album_empty: {
    label: 'Álbum vazio',
    description: 'User acaba de criar conta e ainda tem 0 figurinhas no álbum.',
  },
  scan_no_results: {
    label: 'Scan sem resultado',
    description: 'Foto enviada não retornou nenhuma figurinha.',
  },
  album_progress_50: {
    label: 'Progresso 50%+',
    description: 'User passou de 50% do álbum — momento de "tá pertinho!".',
  },
  trades_empty: {
    label: 'Trocas vazias',
    description: 'Página de trocas sem nenhum match disponível.',
  },
  album_footer: {
    label: 'Footer do álbum',
    description: 'Aparece sempre embaixo da página /album (rotativo).',
  },
}
