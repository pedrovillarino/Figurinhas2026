/**
 * GET /api/cron/liga-close-temporada
 *
 * Pedro 12/05/2026 — Liga Complete Aí.
 *
 * Cron diário 03:00 BRT (06:00 UTC). Pra cada Temporada com status='active'
 * cujo `ends_at` já passou:
 *   1) Calcula ranking final (snapshot is_final=true em liga_rankings)
 *   2) Verifica gate (X participantes com Y pontos mínimos)
 *   3) Marca Temporada como closed + gate_passed
 *   4) Se gate passou, marca a próxima Temporada como 'active' (anuncio)
 *      Senão, mantém futuras como pending — Liga continua só com XP
 *
 * Auth: Bearer CRON_SECRET
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getAdmin()
  const now = new Date().toISOString()

  // Busca Temporadas que terminaram (ends_at < now) mas ainda não fechadas
  const { data: temps } = await admin
    .from('liga_temporadas')
    .select('*')
    .lt('ends_at', now)
    .in('status', ['pending', 'active'])
    .order('numero')
  const toClose = (temps || []) as Array<{
    numero: number
    starts_at: string
    ends_at: string
    status: string
    gate_min_participants: number | null
    gate_min_points: number | null
  }>

  const results: Array<Record<string, unknown>> = []

  for (const t of toClose) {
    // 1) Calcula ranking final agregando liga_events da Temporada
    const { data: events } = await admin
      .from('liga_events')
      .select('user_id, points')
      .eq('temporada', t.numero)
    const byUser = new Map<string, number>()
    for (const e of (events || []) as Array<{ user_id: string; points: number }>) {
      byUser.set(e.user_id, (byUser.get(e.user_id) || 0) + (e.points || 0))
    }
    const sorted = Array.from(byUser.entries()).sort((a, b) => b[1] - a[1])

    // 2) Verifica gate
    const totalParticipants = sorted.length
    let participantsAboveThreshold = 0
    if (t.gate_min_points !== null) {
      participantsAboveThreshold = sorted.filter(([, pts]) => pts >= t.gate_min_points!).length
    }
    const gatePassed = t.gate_min_participants !== null
      ? participantsAboveThreshold >= t.gate_min_participants!
      : true // última Temporada sem gate

    // 3) Snapshot dos rankings (top 100 pra economizar — só interessa o pódio)
    const rankingInserts = sorted.slice(0, 100).map(([userId, pts], idx) => ({
      user_id: userId,
      temporada: t.numero,
      xp_periodo: pts,
      position: idx + 1,
      is_final: true,
    }))
    if (rankingInserts.length > 0) {
      // Limpa snapshots antigos não-finais da Temporada antes
      await admin
        .from('liga_rankings')
        .delete()
        .eq('temporada', t.numero)
        .eq('is_final', true)
      await admin.from('liga_rankings').insert(rankingInserts)
    }

    // 4) Marca Temporada como fechada
    await admin
      .from('liga_temporadas')
      .update({
        status: 'closed',
        gate_passed: gatePassed,
        total_participants: totalParticipants,
        participants_above_threshold: participantsAboveThreshold,
        closed_at: new Date().toISOString(),
      })
      .eq('numero', t.numero)

    // 5) Se gate passou, libera a próxima Temporada (vira 'active')
    if (gatePassed && t.numero < 4) {
      await admin
        .from('liga_temporadas')
        .update({
          status: 'active',
          announced_at: new Date().toISOString(),
        })
        .eq('numero', t.numero + 1)
        .eq('status', 'pending')
    } else if (!gatePassed && t.numero < 4) {
      // Marca próximas como cancelled
      await admin
        .from('liga_temporadas')
        .update({ status: 'cancelled' })
        .gt('numero', t.numero)
        .eq('status', 'pending')
    }

    results.push({
      temporada: t.numero,
      total_participants: totalParticipants,
      participants_above_threshold: participantsAboveThreshold,
      gate_passed: gatePassed,
      next_action: gatePassed
        ? t.numero < 4 ? `next_temporada_${t.numero + 1}_activated` : 'liga_finished'
        : 'liga_continues_xp_only',
    })
  }

  return NextResponse.json({ ok: true, results, processed: toClose.length })
}
