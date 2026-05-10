/**
 * POST /api/album/clear-duplicates
 *
 * Pedro 2026-05-10: zera todas as duplicatas do usuário (cromos com
 * quantity > 1 e status owned/duplicate). Mantém 1 unidade de cada —
 * o álbum em si NÃO se altera, só as quantidades extras.
 *
 * Use case: usuário trocou muitas figurinhas presencialmente e perdeu
 * controle de quais ainda tem. Em vez de re-fotografar tudo (caótico
 * com álbum grande), zera as repetidas e re-fotografa só a pilha que
 * sobrou.
 *
 * Salva snapshot em profiles.last_reversible_action (TTL 10min) pra
 * suportar undo via "desfaz" no WhatsApp ou botão no site.
 *
 * Auth: cookie de sessão.
 * Body: {} (sem parâmetros — opera no usuário autenticado)
 * Returns: { affected: number, totalExtras: number, snapshot: {...} }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, getIp, notifyLimiter } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function POST(req: NextRequest) {
  const rlResponse = await checkRateLimit(getIp(req), notifyLimiter)
  if (rlResponse) return rlResponse

  try {
    const supabaseUser = await createServerClient()
    const { data: { user } } = await supabaseUser.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const admin = getAdmin()

    // 1) Captura snapshot ANTES (pra undo)
    const { data: dupesData, error: dupesErr } = await admin
      .from('user_stickers')
      .select('sticker_id, status, quantity')
      .eq('user_id', user.id)
      .gt('quantity', 1)
      .in('status', ['owned', 'duplicate'])
    if (dupesErr) {
      console.error('[clear-duplicates] query failed:', dupesErr.message)
      return NextResponse.json({ error: 'db_query_failed' }, { status: 500 })
    }
    const dupes = (dupesData || []) as Array<{ sticker_id: number; status: string; quantity: number }>
    if (dupes.length === 0) {
      return NextResponse.json({ ok: true, affected: 0, totalExtras: 0 })
    }

    const stickerIds = dupes.map((d) => d.sticker_id)
    const totalExtras = dupes.reduce((sum, d) => sum + (d.quantity - 1), 0)

    // 2) UPDATE: status='owned', quantity=1 nos cromos com qty > 1
    const { error: updErr, count: affected } = await admin
      .from('user_stickers')
      .update({ status: 'owned', quantity: 1, updated_at: new Date().toISOString() }, { count: 'exact' })
      .eq('user_id', user.id)
      .in('sticker_id', stickerIds)
      .gt('quantity', 1)
    if (updErr) {
      console.error('[clear-duplicates] update failed:', updErr.message)
      return NextResponse.json({ error: 'db_update_failed' }, { status: 500 })
    }

    // 3) Pega numbers pra montar snapshot legível pro undo
    const { data: stickerInfo } = await admin
      .from('stickers')
      .select('id, number')
      .in('id', stickerIds)
    const numberMap = new Map(
      (stickerInfo || []).map((s: { id: number; number: string }) => [s.id, s.number]),
    )

    // 4) Salva snapshot pra undo (10min)
    const undoSnapshot = dupes.map((d) => ({
      sticker_id: d.sticker_id,
      number: numberMap.get(d.sticker_id) || '',
      status_before: d.status,
      quantity_before: d.quantity,
    }))
    await admin
      .from('profiles')
      .update({
        last_reversible_action: {
          type: 'clear_duplicates',
          executed_at: new Date().toISOString(),
          stickers: undoSnapshot,
        },
      })
      .eq('id', user.id)

    return NextResponse.json({
      ok: true,
      affected: affected ?? dupes.length,
      totalExtras,
    })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[clear-duplicates] error:', errMsg)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
