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
  // Pedro 2026-05-05: milestones de progresso (10 em 10%) — ad some por 24h
  // após dismiss em GRUPO (dismiss em qualquer um esconde toda a série).
  album_progress_10: { label: 'Álbum 10%', description: 'User cruzou 10% — começou de verdade.' },
  album_progress_20: { label: 'Álbum 20%', description: 'User cruzou 20% — engajado.' },
  album_progress_30: { label: 'Álbum 30%', description: 'User cruzou 30% — colecionando.' },
  album_progress_40: { label: 'Álbum 40%', description: 'User cruzou 40% — quase metade.' },
  album_progress_50: { label: 'Álbum 50%', description: 'User cruzou metade do álbum.' },
  album_progress_60: { label: 'Álbum 60%', description: 'User cruzou 60% — mais da metade.' },
  album_progress_70: { label: 'Álbum 70%', description: 'User cruzou 70% — caçando últimas.' },
  album_progress_80: { label: 'Álbum 80%', description: 'User cruzou 80% — sprint final.' },
  album_progress_90: { label: 'Álbum 90%', description: 'User cruzou 90% — falta pouco!' },
  album_progress_100: { label: 'Álbum 100%', description: 'User completou o álbum — venda colecionável/capa dura.' },
  trades_notification: {
    label: 'Trocas com pedidos',
    description: 'User tem pedidos de troca pendentes na /trades.',
  },
  scan_success: {
    label: 'Scan bem-sucedido',
    description: 'User acabou de salvar figurinhas via scan — momento positivo.',
  },
  // Desativados (Pedro 2026-05-05) — mantidos no DB pra histórico, sem wire-up:
  scan_no_results: {
    label: 'Scan sem resultado (DESATIVADO)',
    description: 'Removido — UX ruim (reforço negativo após scan falho).',
  },
  trades_empty: {
    label: 'Trocas vazias (DESATIVADO)',
    description: 'Removido — reforço negativo.',
  },
  album_footer: {
    label: 'Footer do álbum (DESATIVADO)',
    description: 'Removido — substituído pelos milestones.',
  },
}

/** Pedro 2026-05-05: helper pra escolher placement de milestone baseado em pct.
 * Retorna null se progresso < 10%. Senão retorna 'album_progress_X' onde X é
 * o múltiplo de 10 mais próximo abaixo (e <= 100). */
export function pickAlbumMilestonePlacement(progressPct: number): string | null {
  if (!Number.isFinite(progressPct) || progressPct < 10) return null
  const bucket = Math.min(100, Math.floor(progressPct / 10) * 10)
  return `album_progress_${bucket}`
}
