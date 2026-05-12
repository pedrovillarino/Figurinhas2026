/**
 * POST /api/trade-confirm
 *
 * Pedro 12/05/2026 — confirmação dupla de troca presencial.
 *
 * Fluxo:
 *  1. User1 pede troca → status='pending'
 *  2. User2 aceita → status='approved'
 *  3. Encontro presencial acontece
 *  4. Ambos clicam "Concluí a troca" → marca confirmed_by_*_at correspondente
 *  5. Quando AMBAS as colunas viram NOT NULL → dispara hooks Liga:
 *     - Requester ganha TRADE_REQUESTED (10)
 *     - Target ganha TRADE_ACCEPTED (20)
 *
 * Idempotente: clicar 2× só registra 1×.
 *
 * Auth: cookie de sessão.
 * Body: { trade_request_id: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, getIp, generalLimiter } from '@/lib/ratelimit'
import { awardLigaPoints } from '@/lib/liga'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  const rl = await checkRateLimit(getIp(req), generalLimiter)
  if (rl) return rl

  try {
    const supabaseUser = await createServerClient()
    const { data: { user } } = await supabaseUser.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const body = await req.json()
    const tradeId = body.trade_request_id as string | undefined
    if (!tradeId || !UUID_RE.test(tradeId)) {
      return NextResponse.json({ error: 'trade_request_id inválido' }, { status: 400 })
    }

    const admin = getAdmin()

    // Busca a troca
    const { data: trade } = await admin
      .from('trade_requests')
      .select('id, requester_id, target_id, status, confirmed_by_requester_at, confirmed_by_target_at, responded_at')
      .eq('id', tradeId)
      .maybeSingle()

    if (!trade) {
      return NextResponse.json({ error: 'Troca não encontrada' }, { status: 404 })
    }

    const t = trade as {
      id: string
      requester_id: string
      target_id: string
      status: string
      confirmed_by_requester_at: string | null
      confirmed_by_target_at: string | null
      responded_at: string | null
    }

    // Só permite confirmar trocas approved (aceitas)
    if (t.status !== 'approved') {
      return NextResponse.json(
        { error: 'Troca não está no status approved', status: t.status },
        { status: 409 },
      )
    }

    // Determina o lado do user
    const isRequester = t.requester_id === user.id
    const isTarget = t.target_id === user.id
    if (!isRequester && !isTarget) {
      return NextResponse.json({ error: 'Você não participa dessa troca' }, { status: 403 })
    }

    // TTL 7 dias após responded_at
    if (t.responded_at) {
      const respondedAt = new Date(t.responded_at)
      const ttlEnd = new Date(respondedAt.getTime() + 7 * 24 * 3600 * 1000)
      if (new Date() > ttlEnd) {
        return NextResponse.json(
          { error: 'Janela de confirmação (7 dias) já expirou' },
          { status: 410 },
        )
      }
    }

    const now = new Date().toISOString()
    const column = isRequester ? 'confirmed_by_requester_at' : 'confirmed_by_target_at'
    const alreadyConfirmed = isRequester ? t.confirmed_by_requester_at : t.confirmed_by_target_at

    // Idempotência: se já confirmou, retorna estado atual
    if (alreadyConfirmed) {
      const bothConfirmed = !!(t.confirmed_by_requester_at && t.confirmed_by_target_at)
      return NextResponse.json({
        ok: true,
        already_confirmed: true,
        confirmed_at: alreadyConfirmed,
        both_confirmed: bothConfirmed,
        awaiting_other_side: !bothConfirmed,
      })
    }

    // Marca o lado do user
    const { error: updErr } = await admin
      .from('trade_requests')
      .update({ [column]: now })
      .eq('id', tradeId)
      .is(column, null)
    if (updErr) {
      console.error('[trade-confirm] update failed:', updErr.message)
      return NextResponse.json({ error: 'db_update_failed' }, { status: 500 })
    }

    // Re-busca pra ver se AGORA ambos confirmaram
    const { data: updated } = await admin
      .from('trade_requests')
      .select('confirmed_by_requester_at, confirmed_by_target_at')
      .eq('id', tradeId)
      .single()
    const u = updated as {
      confirmed_by_requester_at: string | null
      confirmed_by_target_at: string | null
    }
    const bothConfirmed = !!(u.confirmed_by_requester_at && u.confirmed_by_target_at)

    // Se AGORA ambos confirmaram → dispara hooks Liga
    let ligaPoints = { requester_awarded: false, target_awarded: false }
    if (bothConfirmed) {
      // Requester ganha TRADE_REQUESTED
      const rReq = await awardLigaPoints({
        userId: t.requester_id,
        eventType: 'TRADE_REQUESTED',
        eventKey: `trade_requested:${t.id}`,
        metadata: { trade_id: t.id, role: 'requester' },
      })
      ligaPoints.requester_awarded = rReq.awarded

      // Target ganha TRADE_ACCEPTED
      const rTar = await awardLigaPoints({
        userId: t.target_id,
        eventType: 'TRADE_ACCEPTED',
        eventKey: `trade_accepted:${t.id}`,
        metadata: { trade_id: t.id, role: 'target' },
      })
      ligaPoints.target_awarded = rTar.awarded
    }

    return NextResponse.json({
      ok: true,
      confirmed_at: now,
      both_confirmed: bothConfirmed,
      awaiting_other_side: !bothConfirmed,
      liga_points_distributed: bothConfirmed ? ligaPoints : null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[trade-confirm] error:', msg)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
