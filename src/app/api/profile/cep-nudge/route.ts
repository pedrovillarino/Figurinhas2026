// POST /api/profile/cep-nudge
// Pedro 2026-05-03: ações do banner de nudge de CEP.
// Body: { action: 'dismiss' | 'snooze' }
//   - 'dismiss': user clicou X — banner some por 14 dias
//   - 'snooze':  user clicou "mais tarde" — banner some por 3 dias
// Quando user efetivamente preenche CEP/GPS, o /api/geocode já marca
// cep_nudge_dismissed_at. Este endpoint é só pra fechar o banner sem dados.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit, getIp, generalLimiter } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const rlResponse = await checkRateLimit(getIp(req), generalLimiter)
  if (rlResponse) return rlResponse

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const action = body?.action

    if (action === 'dismiss') {
      await supabase
        .from('profiles')
        .update({ cep_nudge_dismissed_at: new Date().toISOString() })
        .eq('id', user.id)
      return NextResponse.json({ ok: true })
    }

    if (action === 'snooze') {
      await supabase
        .from('profiles')
        .update({ cep_nudge_snoozed_at: new Date().toISOString() })
        .eq('id', user.id)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'action inválida (use dismiss ou snooze)' }, { status: 400 })
  } catch (err) {
    console.error('[cep-nudge] error:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
