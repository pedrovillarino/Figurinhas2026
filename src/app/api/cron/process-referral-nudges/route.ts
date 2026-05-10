import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendText } from '@/lib/zapi'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br').trim()
// Pedro 2026-05-08: silêncio de 40s desde a última confirmação = fim do bloco.
// Cron a cada 1min checa, então latência total é ~40-100s entre o user
// dizer "sim" pelo último registro e receber o nudge.
const QUIET_WINDOW_SEC = 40
// Cooldown total entre 2 nudges pra mesmo user (independente de quantos
// blocos ele faça nesse período).
const COOLDOWN_HOURS = 72
const BATCH_LIMIT = 50

/**
 * GET/POST /api/cron/process-referral-nudges
 *
 * Pedro 2026-05-08: debounce server-side do nudge de indicação no WhatsApp.
 * Em vez de anexar ao reply de CADA confirmação (= spam quando user faz
 * vários blocos), o webhook só marca `pending_referral_nudge_at = now()`
 * a cada confirmação elegível. Este cron envia mensagem separada APENAS
 * quando a coluna ficou estagnada por QUIET_WINDOW_MIN min (= bloco de
 * registros terminou).
 *
 * Sem auth — cron interno (pg_cron via pg_net) ou Vercel cron (com auth).
 * Idempotente: marca referral_nudge_shown_at + limpa pending_referral_nudge_at.
 */
async function processNudges() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const quietCutoff = new Date(Date.now() - QUIET_WINDOW_SEC * 1000).toISOString()
  const cooldownCutoff = new Date(Date.now() - COOLDOWN_HOURS * 3600 * 1000).toISOString()

  const { data: candidates, error } = await sb
    .from('profiles')
    .select('id, phone, referral_code, display_name, tier')
    .not('pending_referral_nudge_at', 'is', null)
    .lt('pending_referral_nudge_at', quietCutoff)
    .eq('tier', 'free')
    .not('phone', 'is', null)
    .not('referral_code', 'is', null)
    .or(`referral_nudge_shown_at.is.null,referral_nudge_shown_at.lt.${cooldownCutoff}`)
    .limit(BATCH_LIMIT)

  if (error) {
    console.error('[process-referral-nudges] query error:', error.message)
    return { ok: false, error: error.message }
  }

  if (!candidates || candidates.length === 0) {
    return { ok: true, processed: 0 }
  }

  let sent = 0
  let failed = 0

  for (const c of candidates as Array<{
    id: string
    phone: string
    referral_code: string
    display_name: string | null
  }>) {
    const refUrl = `${APP_URL}/register?ref=${c.referral_code}`
    const firstName = c.display_name?.split(' ')[0] || ''
    const greeting = firstName ? `Oi *${firstName}*!` : 'Oi!'
    const msg =
      `💡 ${greeting} Aproveitando que você acabou de registrar suas figurinhas:\n\n` +
      `Indica um amigo da sua cidade pra completar o álbum junto e *você ganha +2 scans grátis* ` +
      `a cada cadastro confirmado.\n\n` +
      `Faça a comunidade da sua cidade e bairro crescer e *complete seu álbum ainda mais rápido*. ` +
      `Mande para seus amigos e nos seus grupos de WhatsApp!\n\n` +
      `Seu link: ${refUrl} ⚽`

    let ok = false
    try {
      ok = await sendText(c.phone, msg)
    } catch (e) {
      console.error(`[process-referral-nudges] sendText failed for ${c.phone}:`, e)
    }

    // Update profile regardless of send success — se falhou, não fica
    // num loop tentando de novo. Próxima oportunidade é após nova
    // confirmação que re-seta pending_referral_nudge_at.
    const updates: Record<string, string | null> = {
      pending_referral_nudge_at: null,
    }
    if (ok) {
      updates.referral_nudge_shown_at = new Date().toISOString()
      sent++
    } else {
      failed++
    }
    await sb.from('profiles').update(updates).eq('id', c.id)
  }

  console.log(`[process-referral-nudges] sent=${sent} failed=${failed} candidates=${candidates.length}`)
  return { ok: true, processed: candidates.length, sent, failed }
}

export async function GET() {
  const result = await processNudges()
  return NextResponse.json(result)
}

export async function POST() {
  const result = await processNudges()
  return NextResponse.json(result)
}
