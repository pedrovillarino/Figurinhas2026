import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { checkRateLimit, getIp, notifyLimiter } from '@/lib/ratelimit'
import { createPerfLogger } from '@/lib/perf'
import { backgroundHealthPing } from '@/lib/health-ping'
import { enqueueMatchCandidates } from '@/lib/match-enqueue'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * POST /api/notify-matches
 *
 * Called when a user adds/updates stickers in their collection (web/app).
 * Just enqueues match candidates — actual notification happens via the
 * /api/cron/process-notifications cron (hourly), which aggregates per
 * recipient + applies bilateral check + freq + cooldown + quiet hours.
 *
 * Pedro 2026-05-04: removed the realtime push that was here. Em vez disso,
 * tudo passa pelo cron pra agregar (caso real: user registra 80 figurinhas
 * em sequência → 1 mensagem consolidada em vez de 80).
 *
 * Body: { sticker_ids: number[] }
 * Requires authentication.
 */
export async function POST(req: NextRequest) {
  backgroundHealthPing()

  const rlResponse = await checkRateLimit(getIp(req), notifyLimiter)
  if (rlResponse) return rlResponse

  const perf = createPerfLogger('notify-matches')

  try {
    const supabaseUser = await createServerClient()
    const { data: { user } } = await supabaseUser.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const body = await req.json()
    const sticker_ids: number[] = body.sticker_ids || []
    if (!sticker_ids || sticker_ids.length === 0) {
      return NextResponse.json({ ok: true, notified: 0 })
    }

    perf.mark('auth')
    const enqueued = await enqueueMatchCandidates(user.id, sticker_ids)
    perf.end({ enqueued })

    return NextResponse.json({ ok: true, enqueued })
  } catch (err) {
    perf.end({ error: 'true' })
    console.error('[notify-matches]', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
