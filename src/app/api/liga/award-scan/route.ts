/**
 * POST /api/liga/award-scan
 *
 * Cabeado no save de scan do site (ScanClient e ScanHub). Espelha o que o
 * webhook do WhatsApp já faz após salvar stickers em batch:
 *   - awardScanPointsForToday(userId, savedCount)  → +1 por scan, cap 30/dia
 *   - awardFirstScanIfNew(userId, 'photo')         → +10 lifetime na 1ª foto
 *   - checkAndRegisterUnlocks(userId)              → marca marcos da Trilha
 *
 * Body: { savedCount: number }
 *
 * Fail-open por design — qualquer erro de Liga não bloqueia o fluxo do scan.
 * O client chama fire-and-forget, então erro aqui só vira log.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  awardScanPointsForToday,
  awardFirstScanIfNew,
  checkAndRegisterUnlocks,
} from '@/lib/liga'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({})) as { savedCount?: number }
    const savedCount = Math.max(0, Math.floor(Number(body.savedCount) || 0))
    if (savedCount === 0) {
      return NextResponse.json({ ok: true, skipped: 'zero_count' })
    }

    // Encadeado pra garantir ordem: scan points → first scan → unlocks. Tudo
    // fail-open dentro de cada helper.
    await awardScanPointsForToday(user.id, savedCount)
    await awardFirstScanIfNew(user.id, 'photo')
    const newUnlocks = await checkAndRegisterUnlocks(user.id)

    return NextResponse.json({ ok: true, newUnlocks })
  } catch (err) {
    console.error('[liga/award-scan] error:', err)
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 })
  }
}
