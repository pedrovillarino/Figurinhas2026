import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendText } from '@/lib/zapi'
import { sendEmail } from '@/lib/email'
import { logNotificationSent } from '@/lib/notification-queue'
import { isCampaignActive, REFERRAL_CONSTANTS } from '@/lib/referrals'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ─── Embaixadores cron — runs daily at 11h BRT (14h UTC) ───────────────────
//
// Two responsibilities, one endpoint to stay within Vercel cron limits:
//
//   1) PROGRESS DIGEST (Wed + Sun at 11h BRT)
//      Sends each active ambassador their CUMULATIVE campaign progress:
//      "You've signed up X friends, Y paid, you have Z points,
//       you're at position #N. Top 3 wins ..."
//      Note: ranking is cumulative for the whole campaign, NOT weekly.
//
//   2) COUPON EXPIRY REMINDER (every day at 11h BRT)
//      Finds active coupons that expire in 11-13h window, sends
//      "Cupom expira em ~12h" reminder.
//
// Auth: Bearer ${CRON_SECRET}, same as whatsapp-health pattern.
// Idempotency: Both operations are idempotent — we mark digests sent via
// `notification_queue` (already exists) so re-runs same day skip dupes.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isCampaignActive()) {
    return NextResponse.json({ ok: true, skipped: 'campaign-ended' })
  }

  const result = {
    digest: { sent: 0, skipped: 0, errors: 0 },
    coupons: { sent: 0, skipped: 0, errors: 0 },
  }

  // ── Progress digest (Wed=3 / Sun=0 in São Paulo TZ) ──
  // Single-cycle campaign — midweek + weekend cadence to remind ambassadors
  // of their cumulative progress and how to climb the ranking.
  const nowSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const dayOfWeek = nowSP.getDay() // 0=Sun, 1=Mon, ..., 3=Wed
  const isDigestDay = dayOfWeek === 0 || dayOfWeek === 3

  if (isDigestDay) {
    const digestResult = await sendProgressDigest()
    result.digest = digestResult
  }

  // ── Coupon expiry reminders (every day) ──
  const couponResult = await sendCouponExpiryReminders()
  result.coupons = couponResult

  return NextResponse.json({ ok: true, ...result })
}

// ─── Cumulative-progress digest sender ──────────────────────────────────────
async function sendProgressDigest() {
  const out = { sent: 0, skipped: 0, errors: 0 }
  const admin = getAdmin()

  // Find all ambassadors with at least 1 referral THIS WEEK
  const { data: ranking } = await admin.rpc('get_embaixadores_weekly_ranking', {
    p_user_id: null,
    p_limit: 1000,
  })

  if (!ranking || ranking.length === 0) {
    return out
  }

  // Idempotency window: don't double-send within 12h
  const sinceIso = new Date(Date.now() - 12 * 3600 * 1000).toISOString()
  const todayKey = new Date().toISOString().slice(0, 10)

  for (const row of ranking) {
    const r = row as {
      user_id: string
      rank: number
      confirmed_count: number
      paid_upgrade_count: number
      total_points: number
    }

    // Check if we already sent today
    const { data: alreadySent } = await admin
      .from('notification_queue')
      .select('id')
      .eq('user_id', r.user_id)
      .eq('subject', `embaixadores-digest-${todayKey}`)
      .gte('created_at', sinceIso)
      .maybeSingle()

    if (alreadySent) {
      out.skipped++
      continue
    }

    // Get contact info
    const { data: profile } = await admin
      .from('profiles')
      .select('display_name, phone, notify_channel, email, excluded_from_campaign')
      .eq('id', r.user_id)
      .single()

    const p = profile as {
      display_name: string | null
      phone: string | null
      notify_channel: string | null
      email: string | null
      excluded_from_campaign: boolean | null
    } | null

    if (!p || p.excluded_from_campaign) {
      out.skipped++
      continue
    }

    const firstName = p.display_name?.split(' ')[0] || 'Embaixador'
    const message = buildDigestMessage(firstName, r)

    let sent = false
    if (p.notify_channel === 'whatsapp' && p.phone) {
      try {
        sent = await sendText(p.phone, message)
      } catch {
        sent = false
      }
    }

    if (!sent && p.email) {
      try {
        sent = await sendEmail(
          p.email,
          'Seu progresso na campanha Embaixadores',
          buildDigestEmailHtml(firstName, r),
        )
      } catch {
        sent = false
      }
    }

    // Always log to notification_queue for idempotency tracking
    await admin.from('notification_queue').insert({
      user_id: r.user_id,
      channel: p.notify_channel || 'whatsapp',
      recipient: p.phone || p.email || '',
      subject: `embaixadores-digest-${todayKey}`,
      message,
      status: sent ? 'sent' : 'failed',
      sent_at: sent ? new Date().toISOString() : null,
    })

    // Pedro 2026-05-03: log pra admin (taxa de volta 24h)
    if (sent) {
      await logNotificationSent({
        userId: r.user_id,
        type: 'embaixadores_digest',
        channel: (p.notify_channel === 'email' || !p.phone) ? 'email' : 'whatsapp',
        recipient: p.phone || p.email || '',
        messagePreview: message,
      })
    }

    if (sent) out.sent++
    else out.errors++
  }

  return out
}

function buildDigestMessage(firstName: string, row: {
  rank: number; confirmed_count: number; paid_upgrade_count: number; total_points: number
}): string {
  return (
    `📊 *${firstName}, seu progresso na campanha*\n\n` +
    `👥 Cadastros confirmados: *${row.confirmed_count}*\n` +
    `💎 Viraram pagantes: *${row.paid_upgrade_count}* _(valem 5 pts cada)_\n` +
    `⭐ Pontos totais: *${row.total_points}*\n` +
    `🏆 Posição no ranking: *#${row.rank}*\n\n` +
    `${
      row.rank <= 3
        ? `🎉 Você está no Top 3! Continue assim pra garantir o prêmio.`
        : `Top 3 ganha pacotes em casa. Faltam só ${Math.max(1, row.rank - 3)} ponto(s) pra subir!`
    }\n\n` +
    `Veja sua área: ${APP_URL}/campanha`
  )
}

function buildDigestEmailHtml(firstName: string, row: {
  rank: number; confirmed_count: number; paid_upgrade_count: number; total_points: number
}): string {
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h1 style="color:#0A1628;font-size:20px;margin:0 0 16px">📊 Seu progresso na campanha, ${firstName}</h1>
      <div style="background:#f8fafc;border-radius:12px;padding:20px">
        <p style="margin:0 0 8px;color:#374151">👥 Cadastros confirmados: <strong>${row.confirmed_count}</strong></p>
        <p style="margin:0 0 8px;color:#374151">💎 Viraram pagantes: <strong>${row.paid_upgrade_count}</strong> <small style="color:#6B7280">(5 pts cada)</small></p>
        <p style="margin:0 0 8px;color:#374151">⭐ Pontos totais: <strong>${row.total_points}</strong></p>
        <p style="margin:0 0 8px;color:#374151">🏆 Posição: <strong>#${row.rank}</strong></p>
      </div>
      <div style="text-align:center;margin-top:20px">
        <a href="${APP_URL}/campanha" style="background:#00C896;color:white;padding:12px 32px;border-radius:10px;font-weight:bold;text-decoration:none">Ver minha área</a>
      </div>
    </div>`
}

// ─── Coupon expiry reminder ─────────────────────────────────────────────────
async function sendCouponExpiryReminders() {
  const out = { sent: 0, skipped: 0, errors: 0 }
  const admin = getAdmin()

  // Cupons que expiram em 11-13h (janela ampla pra cobrir cron diário)
  const now = Date.now()
  const minExpiry = new Date(now + 11 * 3600 * 1000).toISOString()
  const maxExpiry = new Date(now + 13 * 3600 * 1000).toISOString()

  const { data: coupons } = await admin
    .from('discount_codes')
    .select('code, valid_until, restricted_to_user_id, times_used, max_uses')
    .eq('created_by', 'referral_program')
    .eq('active', true)
    .gte('valid_until', minExpiry)
    .lte('valid_until', maxExpiry)

  if (!coupons || coupons.length === 0) {
    return out
  }

  // Dedupe by code (3 rows per code, one per tier)
  const seen = new Set<string>()
  for (const c of coupons) {
    const cou = c as {
      code: string
      valid_until: string
      restricted_to_user_id: string | null
      times_used: number
      max_uses: number | null
    }
    if (seen.has(cou.code)) continue
    seen.add(cou.code)

    if (!cou.restricted_to_user_id) continue
    if (cou.max_uses !== null && cou.times_used >= cou.max_uses) {
      out.skipped++
      continue
    }

    // Idempotency: check if reminder already sent for this code
    const { data: alreadySent } = await admin
      .from('notification_queue')
      .select('id')
      .eq('user_id', cou.restricted_to_user_id)
      .eq('subject', `coupon-expiry-${cou.code}`)
      .maybeSingle()

    if (alreadySent) {
      out.skipped++
      continue
    }

    const { data: profile } = await admin
      .from('profiles')
      .select('display_name, phone, notify_channel, email')
      .eq('id', cou.restricted_to_user_id)
      .single()

    const p = profile as {
      display_name: string | null
      phone: string | null
      notify_channel: string | null
      email: string | null
    } | null
    if (!p) continue

    const firstName = p.display_name?.split(' ')[0] || 'Olá'
    const message =
      `⏰ *${firstName}, seu cupom expira em 12h!*\n\n` +
      `🎫 *${cou.code}* — ${REFERRAL_CONSTANTS.COUPON_PERCENT_OFF}% off\n\n` +
      `Use agora antes que perca: ${APP_URL}/upgrade`

    let sent = false
    if (p.notify_channel === 'whatsapp' && p.phone) {
      try {
        sent = await sendText(p.phone, message)
      } catch {
        sent = false
      }
    }
    if (!sent && p.email) {
      try {
        sent = await sendEmail(
          p.email,
          `Seu cupom ${cou.code} expira em 12h`,
          `<div style="font-family:sans-serif;padding:24px;max-width:400px;margin:0 auto">
             <h2 style="color:#FFB800">⏰ Seu cupom expira em 12 horas</h2>
             <p>Cupom <strong style="font-family:monospace">${cou.code}</strong> — ${REFERRAL_CONSTANTS.COUPON_PERCENT_OFF}% off</p>
             <a href="${APP_URL}/upgrade" style="display:inline-block;background:#FFB800;color:white;padding:12px 32px;border-radius:10px;font-weight:bold;text-decoration:none">Usar cupom</a>
           </div>`,
        )
      } catch {
        sent = false
      }
    }

    await admin.from('notification_queue').insert({
      user_id: cou.restricted_to_user_id,
      channel: p.notify_channel || 'whatsapp',
      recipient: p.phone || p.email || '',
      subject: `coupon-expiry-${cou.code}`,
      message,
      status: sent ? 'sent' : 'failed',
      sent_at: sent ? new Date().toISOString() : null,
    })

    if (sent) {
      // Pedro 2026-05-03: log pra admin
      await logNotificationSent({
        userId: cou.restricted_to_user_id,
        type: 'coupon_expiry_warning',
        channel: (p.notify_channel === 'email' || !p.phone) ? 'email' : 'whatsapp',
        recipient: p.phone || p.email || '',
        messagePreview: message,
      })
      out.sent++
    } else {
      out.errors++
    }
  }

  return out
}
