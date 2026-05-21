/**
 * GET /api/me/trial — retorna estado de trial do user logado.
 *
 * Usado por: TrialBanner no /album, PaywallModal pra detectar expiracao,
 * OnboardingModal pra novos cadastros, futuras telas que precisam mostrar
 * "X dias restantes".
 *
 * Response:
 *   { state, effective_tier, trial_ends_at, days_remaining }
 *
 * Modelo decidido em docs/trial-7d-analise.md sec 13.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  getEffectiveTier,
  getTrialState,
  daysRemainingInTrial,
  type TrialProfile,
} from '@/lib/trial'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('tier, is_grandfathered_free, trial_starts_at, trial_ends_at')
    .eq('id', user.id)
    .maybeSingle()

  if (error) {
    console.error('[/api/me/trial] profile fetch failed:', error)
    return NextResponse.json({ error: 'Falha ao buscar perfil' }, { status: 500 })
  }

  const profile = (data || null) as TrialProfile | null

  return NextResponse.json({
    state: getTrialState(profile),
    effective_tier: getEffectiveTier(profile),
    trial_starts_at: profile?.trial_starts_at ?? null,
    trial_ends_at: profile?.trial_ends_at ?? null,
    days_remaining: daysRemainingInTrial(profile),
  })
}
