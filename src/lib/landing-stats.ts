/**
 * Landing-page stats (Pedro 2026-05-11).
 *
 * Lê snapshot diário de `public_stats` (atualizada por pg_cron 5am UTC
 * via função `refresh_public_stats()`, ver migration 026).
 *
 * Por que snapshot e não real-time:
 *   • Volume cresce várias unidades/minuto — refresh ao vivo deixa
 *     número instável e cheira a inflado.
 *   • Cache diário trava a magnitude + dá texto "atualizado em DD/MM"
 *     que aumenta credibilidade (CONAR/CDC friendly).
 *   • Se uma query agregadora quebrar amanhã, número exibido permanece
 *     do dia anterior (degradação graciosa).
 *
 * Floor logic: cada métrica tem um piso mínimo. Abaixo dele, a função
 * `getLandingStats()` devolve `null` no campo correspondente e o
 * componente esconde o card. Evita exibir "13 trocas" e dar a impressão
 * de ninguém usa.
 */
import { createClient } from '@supabase/supabase-js'

// ─── Prêmios já entregues / a entregar ───────────────────────────────
//
// Pedro 2026-05-11: por hora vazio. Quando começarmos a entregar
// prêmios de verdade (embaixadores, campanhas Instagram etc), basta
// adicionar entradas aqui — o card "X prêmios já entregues" aparece
// automaticamente na home quando o array tiver itens.

export type Prize = {
  date: string // ISO YYYY-MM-DD
  type: 'porta-figurinhas' | 'album' | 'embaixador-premio'
  campaign: string
  /** Curta, vai aparecer numa lista pública em /numeros. */
  note?: string
}

export const PRIZES_AWARDED: Prize[] = []

export const PRIZES_COUNT = PRIZES_AWARDED.length

// ─── Floors: pisos abaixo dos quais escondemos o card ────────────────
const FLOORS = {
  registered_total: 5_000,
  ai_scanned: 1_000,
  stickers_traded: 200,
  cities: 30,
  distance_median_km_max: 30, // ACIMA disso esconde (longe demais não vende)
  users: 1_000,
}

// ─── Tipos ──────────────────────────────────────────────────────────
export type LandingStats = {
  registeredTotal: number | null
  aiScanned: number | null
  stickersTraded: number | null
  cities: number | null
  distanceMedianKm: number | null
  prizes: number
  updatedAt: string | null // ISO
}

// ─── Service-role client (lê public_stats sem RLS) ──────────────────
function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/**
 * Carrega snapshot. Nunca lança — em erro devolve tudo `null` (LP
 * esconde a seção inteira). Métricas individuais que ficarem abaixo
 * do floor também viram `null`.
 */
export async function getLandingStats(): Promise<LandingStats> {
  const fallback: LandingStats = {
    registeredTotal: null,
    aiScanned: null,
    stickersTraded: null,
    cities: null,
    distanceMedianKm: null,
    prizes: PRIZES_COUNT,
    updatedAt: null,
  }

  try {
    const { data, error } = await admin()
      .from('public_stats')
      .select('key, value_int, updated_at')

    if (error || !data) {
      console.error('[landing-stats] read error:', error?.message)
      return fallback
    }

    const map = new Map<string, { value: number | null; updatedAt: string }>()
    for (const row of data as { key: string; value_int: number | null; updated_at: string }[]) {
      map.set(row.key, { value: row.value_int, updatedAt: row.updated_at })
    }

    const pick = (key: string): number | null => map.get(key)?.value ?? null
    const updatedAt =
      Array.from(map.values())
        .map((r) => r.updatedAt)
        .sort()
        .pop() || null

    const registeredTotal = pick('registered_total')
    const aiScanned = pick('ai_scanned')
    const stickersTraded = pick('stickers_traded')
    const cities = pick('cities')
    const distanceMedianKm = pick('distance_median_km')

    return {
      registeredTotal:
        registeredTotal != null && registeredTotal >= FLOORS.registered_total
          ? registeredTotal
          : null,
      aiScanned:
        aiScanned != null && aiScanned >= FLOORS.ai_scanned ? aiScanned : null,
      stickersTraded:
        stickersTraded != null && stickersTraded >= FLOORS.stickers_traded
          ? stickersTraded
          : null,
      cities: cities != null && cities >= FLOORS.cities ? cities : null,
      distanceMedianKm:
        distanceMedianKm != null && distanceMedianKm <= FLOORS.distance_median_km_max
          ? distanceMedianKm
          : null,
      prizes: PRIZES_COUNT,
      updatedAt,
    }
  } catch (err) {
    console.error('[landing-stats] unexpected error:', err)
    return fallback
  }
}

// ─── Formatação BR (server-side) ─────────────────────────────────────

/** "67.000" — número arredondado pra baixo na centena/milhar mais próxima. */
export function formatBigNumber(n: number): string {
  if (n >= 10_000) {
    // Arredonda pra baixo na centena de mil → "67.000", "120.000"
    const rounded = Math.floor(n / 1_000) * 1_000
    return rounded.toLocaleString('pt-BR')
  }
  if (n >= 1_000) {
    // Arredonda pra baixo na centena → "3.800", "1.000"
    const rounded = Math.floor(n / 100) * 100
    return rounded.toLocaleString('pt-BR')
  }
  return n.toLocaleString('pt-BR')
}

/** "+67 mil" — versão curta pra hero/card grande. */
export function formatShortNumber(n: number): string {
  if (n >= 1_000_000) return `+${Math.floor(n / 1_000_000)} mi`
  if (n >= 1_000) return `+${Math.floor(n / 1_000)} mil`
  return n.toLocaleString('pt-BR')
}

/** "11/05" — data curta BR (sem ano). */
export function formatShortDate(iso: string): string {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}`
}
