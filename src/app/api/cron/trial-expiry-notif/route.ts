/**
 * /api/cron/trial-expiry-notif — avisa users 24h antes do trial expirar.
 *
 * Pedro 21/05/2026. Schedule via vercel.json: 0 12 * * * (= 09:00 BRT).
 *
 * Query users free não-grandfathered com:
 *   - trial_ends_at entre NOW e NOW+26h (cobre 24h + margem 2h pra drift)
 *   - trial_expired_notified_at IS NULL (não notificado ainda)
 *   - phone IS NOT NULL (tem canal WhatsApp)
 *   - notify_channel != 'none' (não opt-out de notif)
 *
 * Pra cada: sendText + UPDATE trial_expired_notified_at = NOW (idempotente).
 *
 * Auth: header Authorization: Bearer CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendText } from '@/lib/zapi'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

const WINDOW_MS = 26 * 60 * 60 * 1000 // 26h = 24h + margem

type TrialUser = {
  id: string
  phone: string | null
  display_name: string | null
  notify_channel: string | null
  trial_ends_at: string
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getAdmin()
  const now = new Date()
  const windowEnd = new Date(now.getTime() + WINDOW_MS)

  const result = { eligible: 0, sent: 0, skipped: 0, errors: 0 }

  try {
    // 1. Query users elegíveis pra notif
    const { data, error } = await supabase
      .from('profiles')
      .select('id, phone, display_name, notify_channel, trial_ends_at')
      .eq('tier', 'free')
      .eq('is_grandfathered_free', false)
      .is('trial_expired_notified_at', null)
      .not('trial_ends_at', 'is', null)
      .not('phone', 'is', null)
      .gte('trial_ends_at', now.toISOString())
      .lte('trial_ends_at', windowEnd.toISOString())
      .limit(1000)

    if (error) {
      console.error('[trial-expiry-notif] fetch error:', error.message)
      return NextResponse.json({ error: 'fetch_failed', detail: error.message }, { status: 500 })
    }

    const users = (data || []) as TrialUser[]
    result.eligible = users.length

    for (const u of users) {
      // Pula opt-outs
      if (u.notify_channel === 'none') {
        result.skipped++
        continue
      }

      const endsAt = new Date(u.trial_ends_at)
      const hoursLeft = Math.max(1, Math.round((endsAt.getTime() - now.getTime()) / (60 * 60 * 1000)))
      const firstName = u.display_name?.split(/\s+/)[0] || ''
      const greeting = firstName ? `${firstName}, ` : ''

      const msg =
        `⏰ ${greeting}seu *Trial Boost de 7 dias* acaba em ${hoursLeft}h!\n\n` +
        `Antes que feche, aproveita pra:\n` +
        `📸 Escanear o resto do álbum\n` +
        `🔁 Pedir as trocas que faltam\n` +
        `🎤 Mandar mais áudios pra registrar\n\n` +
        `💛 Quer continuar depois disso? Assine a partir de R$9,90 (pagamento único, sem mensalidade):\n` +
        `${APP_URL}/upgrade`

      try {
        await sendText(u.phone!, msg)
        await supabase
          .from('profiles')
          .update({ trial_expired_notified_at: now.toISOString() })
          .eq('id', u.id)
        result.sent++
        console.log(`[trial-expiry-notif] sent to user ${u.id} (${hoursLeft}h left)`)
      } catch (sendErr) {
        result.errors++
        console.error(`[trial-expiry-notif] send failed for ${u.id}:`, sendErr)
      }
    }

    return NextResponse.json({ ok: true, ...result, ranAt: now.toISOString() })
  } catch (err) {
    console.error('[trial-expiry-notif] unexpected:', err)
    return NextResponse.json({ error: 'unexpected', detail: String(err) }, { status: 500 })
  }
}
