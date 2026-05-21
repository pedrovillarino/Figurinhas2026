/**
 * POST /api/liga/opt-in
 *
 * Pedro 12/05/2026 — usuário ativa participação na Liga Complete Aí 2026.
 *
 * Fluxo:
 *   1. Marca `profiles.liga_opt_in_at = NOW()` (idempotente: se já tem, retorna ok)
 *   2. Carrega XP retroativo no `liga_xp_total`:
 *      - Signup (10 pts)
 *      - Profile + 1ª figurinha (30 pts)
 *      - 1ª foto + 1º áudio (10 + 10 pts conforme histórico)
 *      - Assinatura conforme tier atual (100/200/300)
 *      - Scans históricos (1 pt cada, cap 30/dia)
 *      - Seleções completadas (20 pts cada)
 *
 *   Importante: eventos retroativos têm `temporada=null` (não contam pra
 *   ranking de período — só pra Trilha Digital). O `awardLigaPoints` usa
 *   `getTemporadaForTimestamp(at)` que retorna null pra datas fora da
 *   janela das 4 Temporadas — perfeito pra retroativo.
 *
 * Auth: cookie de sessão.
 * Body: {} (sem parâmetros)
 * Returns: { opted_in_at, xp_total, retro_events: count }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { awardLigaPoints, LIGA_EVENT_POINTS, type LigaEventType } from '@/lib/liga'
import { getEffectiveTier, type TrialProfile } from '@/lib/trial'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function POST(req: NextRequest) {
  // Auth
  const supabaseUser = await createServerClient()
  const { data: { user } } = await supabaseUser.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  const admin = getAdmin()
  const userId = user.id

  try {
    // 1) Idempotência: se já opt-in, retorna estado atual
    const { data: existing } = await admin
      .from('profiles')
      .select('liga_opt_in_at, tier, audio_uses_count, created_at, is_grandfathered_free, trial_starts_at, trial_ends_at')
      .eq('id', userId)
      .single()
    const profile = existing as {
      liga_opt_in_at: string | null
      tier: string | null
      audio_uses_count: number | null
      created_at: string | null
      is_grandfathered_free: boolean | null
      trial_starts_at: string | null
      trial_ends_at: string | null
    } | null

    if (!profile) {
      return NextResponse.json({ error: 'Profile não encontrado' }, { status: 404 })
    }

    // Trial-paywall (Pedro 21/05): trial expirado não pode dar opt-in nem
    // ganhar pontos. Quem já era opt-in mantém liga_opt_in_at (não tira),
    // mas o gating de eventos pontuáveis (awardLigaPoints em outros lugares)
    // também precisa respeitar — feito caso a caso na Fase 2.
    if (getEffectiveTier(profile as TrialProfile) === 'expired') {
      return NextResponse.json(
        {
          error: '🚫 Seu Trial Boost acabou. A Liga só fica disponível pra quem tem plano ativo. Assine a partir de R$9,90 pra entrar.',
          needsUpgrade: true,
          trialExpired: true,
        },
        { status: 402 },
      )
    }

    if (profile.liga_opt_in_at) {
      // Já opt-in. Retorna estado atual.
      const { data: xpRows } = await admin
        .from('liga_events')
        .select('points')
        .eq('user_id', userId)
      const xpTotal = (xpRows || []).reduce(
        (sum, e) => sum + ((e as { points: number }).points || 0),
        0,
      )
      return NextResponse.json({
        ok: true,
        already_opted_in: true,
        opted_in_at: profile.liga_opt_in_at,
        xp_total: xpTotal,
        retro_events: 0,
      })
    }

    // 2) Marca opt-in
    const optInAt = new Date().toISOString()
    const { error: updateErr } = await admin
      .from('profiles')
      .update({ liga_opt_in_at: optInAt })
      .eq('id', userId)
    if (updateErr) {
      console.error('[liga-opt-in] update failed:', updateErr.message)
      return NextResponse.json({ error: 'opt_in_update_failed' }, { status: 500 })
    }

    // 3) Carrega XP retroativo
    let retroEventsCount = 0

    // 3.1) Signup (sempre 10pts)
    if (profile.created_at) {
      const r = await awardLigaPoints({
        userId,
        eventType: 'SIGNUP',
        eventKey: 'retro:signup',
        at: new Date(profile.created_at),
        metadata: { source: 'opt_in_retro' },
      })
      if (r.awarded) retroEventsCount++
    }

    // 3.2) Profile + 1ª figurinha (se tem pelo menos 1 user_sticker)
    const { data: firstSticker } = await admin
      .from('user_stickers')
      .select('created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (firstSticker) {
      const r = await awardLigaPoints({
        userId,
        eventType: 'PROFILE_PLUS_FIRST_STICKER',
        eventKey: 'retro:profile_first_sticker',
        at: new Date((firstSticker as { created_at: string }).created_at),
        metadata: { source: 'opt_in_retro' },
      })
      if (r.awarded) retroEventsCount++

      // 3.3) 1ª foto (assume foto se tem qualquer scan)
      const r2 = await awardLigaPoints({
        userId,
        eventType: 'FIRST_PHOTO_SCAN',
        eventKey: 'retro:first_photo',
        at: new Date((firstSticker as { created_at: string }).created_at),
        metadata: { source: 'opt_in_retro' },
      })
      if (r2.awarded) retroEventsCount++
    }

    // 3.4) 1º áudio (se audio_uses_count > 0)
    if ((profile.audio_uses_count || 0) > 0) {
      const r = await awardLigaPoints({
        userId,
        eventType: 'FIRST_AUDIO_SCAN',
        eventKey: 'retro:first_audio',
        at: profile.created_at ? new Date(profile.created_at) : new Date(),
        metadata: { source: 'opt_in_retro', audio_count: profile.audio_uses_count },
      })
      if (r.awarded) retroEventsCount++
    }

    // 3.5) Assinatura conforme tier
    const tier = profile.tier || 'free'
    const tierEvent: Record<string, LigaEventType | null> = {
      estreante: 'SUBSCRIBE_ESTREANTE',
      colecionador: 'SUBSCRIBE_COLECIONADOR',
      copa_completa: 'SUBSCRIBE_COPA',
      free: null,
    }
    const subscribeEvent = tierEvent[tier]
    if (subscribeEvent) {
      const r = await awardLigaPoints({
        userId,
        eventType: subscribeEvent,
        eventKey: `retro:subscribe:${tier}`,
        at: profile.created_at ? new Date(profile.created_at) : new Date(),
        metadata: { source: 'opt_in_retro', tier },
      })
      if (r.awarded) retroEventsCount++
    }

    // 3.6) Scans históricos — agrupado por dia (cap 30/dia naturalmente
    // aplicado pelo awardLigaPoints, mas como event_key inclui o dia,
    // cada dia gera 1 evento agrupado com pontos = min(qty, 30))
    const { data: scansByDay } = await admin
      .from('user_stickers')
      .select('created_at')
      .eq('user_id', userId)
    if (scansByDay && scansByDay.length > 0) {
      const dayCounts = new Map<string, number>()
      for (const s of scansByDay as Array<{ created_at: string }>) {
        const day = s.created_at.substring(0, 10)
        dayCounts.set(day, (dayCounts.get(day) || 0) + 1)
      }
      for (const [day, count] of Array.from(dayCounts.entries())) {
        const points = Math.min(count, 30)
        const r = await awardLigaPoints({
          userId,
          eventType: 'SCAN',
          eventKey: `retro:scan:${day}`,
          pointsOverride: points,
          at: new Date(day + 'T12:00:00Z'),
          metadata: { source: 'opt_in_retro', day, count },
        })
        if (r.awarded) retroEventsCount++
      }
    }

    // 3.7) Seleções completas (20pts cada)
    // Conta cromos owned/duplicate por country (só completable)
    const { data: completableStickers } = await admin
      .from('stickers')
      .select('id, country, section, counts_for_completion')
    const completableIds = new Set(
      ((completableStickers || []) as Array<{ id: number; counts_for_completion: boolean }>)
        .filter((s) => s.counts_for_completion !== false)
        .map((s) => s.id),
    )
    const stickerToCountry = new Map(
      ((completableStickers || []) as Array<{ id: number; country: string }>).map((s) => [s.id, s.country]),
    )

    const { data: userOwned } = await admin
      .from('user_stickers')
      .select('sticker_id, status, updated_at')
      .eq('user_id', userId)
      .in('status', ['owned', 'duplicate'])

    const countryCounts = new Map<string, { count: number; latestAt: string }>()
    for (const us of (userOwned || []) as Array<{ sticker_id: number; status: string; updated_at: string }>) {
      if (!completableIds.has(us.sticker_id)) continue
      const country = stickerToCountry.get(us.sticker_id)
      if (!country) continue
      const cur = countryCounts.get(country) || { count: 0, latestAt: us.updated_at }
      cur.count++
      if (us.updated_at > cur.latestAt) cur.latestAt = us.updated_at
      countryCounts.set(country, cur)
    }

    // Cada seleção tem 20 cromos. Se contou 20+, completou.
    for (const [country, info] of Array.from(countryCounts.entries())) {
      if (info.count >= 20) {
        const r = await awardLigaPoints({
          userId,
          eventType: 'SECTION_COMPLETED',
          eventKey: `retro:section:${country}`,
          at: new Date(info.latestAt),
          metadata: { source: 'opt_in_retro', country },
        })
        if (r.awarded) retroEventsCount++
      }
    }

    // 4) Calcula XP total final
    const { data: finalEvents } = await admin
      .from('liga_events')
      .select('points')
      .eq('user_id', userId)
    const xpTotal = (finalEvents || []).reduce(
      (sum, e) => sum + ((e as { points: number }).points || 0),
      0,
    )

    return NextResponse.json({
      ok: true,
      opted_in_at: optInAt,
      xp_total: xpTotal,
      retro_events: retroEventsCount,
      // Tier-aware constants pra UI já saber
      cardapio: tier === 'copa_completa' ? 'copa' : 'free',
      pontos_evento: LIGA_EVENT_POINTS,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[liga-opt-in] error:', msg)
    return NextResponse.json({ error: 'internal_error', detail: msg }, { status: 500 })
  }
}
