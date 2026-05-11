/**
 * /liga — página principal da Liga Complete Aí 2026
 *
 * Server-side: busca o estado da Liga do user (opt-in, XP total, próximo marco,
 * Temporada ativa, posição no ranking). Passa pra LigaPageClient renderizar.
 *
 * Pedro 12/05/2026.
 */
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import LigaPageClient from './LigaPageClient'
import {
  TRILHA_FREE_MARCOS,
  TRILHA_COPA_MARCOS,
  LIGA_EVENT_POINTS,
  type Cardapio,
} from '@/lib/liga'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Liga Complete Aí',
  description:
    'Liga Complete Aí 2026 — acumule pontos, conquiste marcos, dispute o pódio das Temporadas e o Campeão Geral.',
}

export const dynamic = 'force-dynamic'

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export default async function LigaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = getAdmin()

  // Profile + opt-in + tier
  const { data: profileData } = await admin
    .from('profiles')
    .select('liga_opt_in_at, tier, display_name')
    .eq('id', user.id)
    .single()
  const profile = profileData as {
    liga_opt_in_at: string | null
    tier: string | null
    display_name: string | null
  } | null

  const optedIn = !!profile?.liga_opt_in_at
  const cardapio: Cardapio = profile?.tier === 'copa_completa' ? 'copa' : 'free'
  const marcos = cardapio === 'copa' ? TRILHA_COPA_MARCOS : TRILHA_FREE_MARCOS

  // Buckets de pontuação
  let xpTotal = 0
  let xpPeriodo = 0
  let temporadaAtual: number | null = null
  let unlocksAtuais: number[] = []
  let positionPeriodo: number | null = null

  if (optedIn) {
    // XP total
    const { data: allEvents } = await admin
      .from('liga_events')
      .select('points, temporada')
      .eq('user_id', user.id)
    xpTotal = ((allEvents || []) as Array<{ points: number; temporada: number | null }>)
      .reduce((sum, e) => sum + (e.points || 0), 0)

    // Temporada ativa?
    const now = new Date().toISOString()
    const { data: temporadas } = await admin
      .from('liga_temporadas')
      .select('numero, starts_at, ends_at, status')
      .order('numero')
    const ativa = ((temporadas || []) as Array<{
      numero: number
      starts_at: string
      ends_at: string
      status: string
    }>).find(
      (t) => t.status !== 'cancelled' && now >= t.starts_at && now <= t.ends_at,
    )
    if (ativa) {
      temporadaAtual = ativa.numero
      // XP da Temporada
      const periodoEvts = ((allEvents || []) as Array<{ points: number; temporada: number | null }>)
        .filter((e) => e.temporada === ativa.numero)
      xpPeriodo = periodoEvts.reduce((sum, e) => sum + (e.points || 0), 0)

      // Posição no ranking da Temporada (estimada — query agregada)
      const { data: ranking } = await admin
        .from('liga_events')
        .select('user_id, points')
        .eq('temporada', ativa.numero)
      const byUser = new Map<string, number>()
      for (const e of (ranking || []) as Array<{ user_id: string; points: number }>) {
        byUser.set(e.user_id, (byUser.get(e.user_id) || 0) + (e.points || 0))
      }
      const sorted = Array.from(byUser.entries()).sort((a, b) => b[1] - a[1])
      const idx = sorted.findIndex(([uid]) => uid === user.id)
      positionPeriodo = idx >= 0 ? idx + 1 : null
    }

    // Unlocks atuais
    const { data: unlocks } = await admin
      .from('liga_unlocks')
      .select('milestone')
      .eq('user_id', user.id)
      .eq('cardapio', cardapio)
    unlocksAtuais = ((unlocks || []) as Array<{ milestone: number }>).map((u) => u.milestone)
  }

  // Próximo marco
  const proximoMarco = marcos.find((m) => xpTotal < m) ?? null
  const faltaProximo = proximoMarco !== null ? proximoMarco - xpTotal : 0

  return (
    <LigaPageClient
      optedIn={optedIn}
      displayName={profile?.display_name || null}
      tier={profile?.tier || 'free'}
      cardapio={cardapio}
      xpTotal={xpTotal}
      xpPeriodo={xpPeriodo}
      temporadaAtual={temporadaAtual}
      positionPeriodo={positionPeriodo}
      marcos={marcos}
      proximoMarco={proximoMarco}
      faltaProximo={faltaProximo}
      unlocks={unlocksAtuais}
      pontosEvento={LIGA_EVENT_POINTS}
    />
  )
}
