/**
 * Trial-paywall hibrido — biblioteca de gating.
 *
 * 3 estados de free user:
 *   - free_legacy: cadastrou < cutoff. Mantem limites Free permanente.
 *   - trial_active: cadastrou >= cutoff e trial nao expirou. Limites Colec.
 *   - expired: cadastrou >= cutoff e trial expirou. Lockout em features ativas.
 *
 * Pagantes (tier !== 'free') sempre acima do trial — retornam tier real.
 *
 * Espelha a funcao SQL `effective_tier(uuid)` da migration 030. Mantemos as
 * duas versoes pra que tanto app code (TS) quanto RPCs (SQL) decidam o gating
 * sem round-trip extra.
 *
 * Modelo decidido em docs/trial-7d-analise.md sec 13.
 */
import type { Tier } from './tiers'

/** Estado efetivo pra gating. */
export type EffectiveTier = Tier | 'expired'

/** Estado bruto pra UI mostrar (banner, paywall, etc). */
export type TrialState = 'paid' | 'free_legacy' | 'trial_active' | 'expired'

/** Subset do profile que precisamos pra decidir gating. */
export type TrialProfile = {
  tier: string | null
  is_grandfathered_free: boolean | null
  trial_starts_at: string | null
  trial_ends_at: string | null
}

export const TRIAL_DURATION_DAYS = 7
export const TRIAL_CUTOFF_ISO = '2026-05-22T03:00:00Z' // 22/05/2026 00:00 BRT

/** Tier que o trial entrega (= experiencia que o user testa). */
export const TRIAL_TIER: Tier = 'colecionador'

/**
 * Retorna o tier efetivo pra gating de feature.
 * - pagante → tier real (estreante/colecionador/copa_completa)
 * - free legacy → 'free' (limites antigos)
 * - trial ativo → 'colecionador' (= experiencia do trial)
 * - trial expirado → 'expired' (callsite trata como lockout)
 *
 * NB: 'expired' nao existe no TIER_CONFIG. Quem chama precisa checar antes
 * de indexar (ex: `if (eff === 'expired') return paywall`).
 */
export function getEffectiveTier(p: TrialProfile | null | undefined): EffectiveTier {
  if (!p) return 'free' // sem profile = trata como free safe-default

  // Pagante sempre retorna tier real
  if (p.tier && p.tier !== 'free') return p.tier as Tier

  // Free legacy mantem free permanente
  if (p.is_grandfathered_free) return 'free'

  // Sem trial setado (fallback safe) = free
  if (!p.trial_ends_at) return 'free'

  // Trial ainda dentro da janela = colecionador
  if (Date.now() < new Date(p.trial_ends_at).getTime()) return TRIAL_TIER

  // Trial expirado = lockout
  return 'expired'
}

/** Estado pra UI (4 estados, inclui 'paid' pra pagante). */
export function getTrialState(p: TrialProfile | null | undefined): TrialState {
  if (!p) return 'free_legacy'
  if (p.tier && p.tier !== 'free') return 'paid'
  if (p.is_grandfathered_free) return 'free_legacy'
  if (!p.trial_ends_at) return 'free_legacy' // fallback safe
  if (Date.now() < new Date(p.trial_ends_at).getTime()) return 'trial_active'
  return 'expired'
}

/** Dias restantes no trial (arredondado pra cima). 0 se nao em trial ou expirado. */
export function daysRemainingInTrial(p: TrialProfile | null | undefined): number {
  if (!p?.trial_ends_at) return 0
  const remainingMs = new Date(p.trial_ends_at).getTime() - Date.now()
  if (remainingMs <= 0) return 0
  return Math.ceil(remainingMs / (24 * 60 * 60 * 1000))
}

/** true se o user esta atualmente em trial ativo. */
export function isTrialActive(p: TrialProfile | null | undefined): boolean {
  return getTrialState(p) === 'trial_active'
}

/** true se o user JA esteve em trial e o tempo expirou (sem ter pago). */
export function isTrialExpired(p: TrialProfile | null | undefined): boolean {
  return getTrialState(p) === 'expired'
}

/** true se o tier efetivo bloqueia features ativas (= 'expired'). */
export function isLockedOut(p: TrialProfile | null | undefined): boolean {
  return getEffectiveTier(p) === 'expired'
}
