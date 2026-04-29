import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { checkRateLimit, getIp, generalLimiter } from '@/lib/ratelimit'
import {
  REFERRAL_CONSTANTS,
  issueReferrerCoupon,
  shouldIssueCouponNow,
} from '@/lib/referrals'
import { sendText } from '@/lib/zapi'
import {
  isDisposableEmail,
  checkReferralIpRateLimit,
  isHoneypotTriggered,
  logSignupAttempt,
} from '@/lib/anti-fraud'

// ─── New referral apply (Embaixadores campaign — 2026-04-29) ────────────────
//
// Reward model:
//   INDICATED user (the caller) gets:        +1 trade credit, immediately
//   REFERRER (whose code was used) gets:     +1 scan credit per confirmed friend
//                                            +50% off coupon (48h, single-use,
//                                            non-transferable) every 5 friends
//                                            +5 ranking points if friend later
//                                            upgrades to a paid tier
//
// This endpoint runs at SIGNUP TIME only — the upgrade reward is granted from
// the Stripe webhook (see grantReferralUpgradeReward).
//
// Anti-fraud (S1 — relaxed):
//   • IP rate limit (5 successful signups / 24h) — handled in /api/auth signup
//   • phone UNIQUE — DB constraint
//   • email UNIQUE via auth.users — Supabase Auth
//   • signup_attempts log captures IP + fingerprint for forensic review
//   Tighter enforcement (fingerprint blocklist, datacenter IP block) lands in S2.

export async function POST(request: NextRequest) {
  const rlResponse = await checkRateLimit(getIp(request), generalLimiter)
  if (rlResponse) return rlResponse

  try {
    // 1. Auth — get current user
    const cookieStore = cookies()
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options),
              )
            } catch {}
          },
        },
      },
    )

    const { data: { user } } = await supabaseAuth.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    // 2. Parse body
    const body = await request.json().catch(() => ({}))
    const referralCode = (body.referral_code || '').trim().toUpperCase()
    const fingerprint: string | null = typeof body.fingerprint === 'string' ? body.fingerprint : null
    const clientIp = getIp(request)

    if (!referralCode) {
      return NextResponse.json({ error: 'Código de indicação inválido' }, { status: 400 })
    }

    // ── Anti-fraud layer 1: honeypot ──
    // Bots auto-fill every field including hidden `website`. Real users never
    // see it. We log and silently reject — no error message that bots could
    // train against.
    if (isHoneypotTriggered(body)) {
      await logSignupAttempt({ ip: clientIp, fingerprint, email: user.email || null, succeeded: false })
      return NextResponse.json({ success: true, message: 'Indicação aplicada' })
    }

    // ── Anti-fraud layer 2: disposable email blocklist ──
    if (isDisposableEmail(user.email)) {
      await logSignupAttempt({ ip: clientIp, fingerprint, email: user.email || null, succeeded: false })
      return NextResponse.json(
        { error: 'Use um email permanente (não-temporário) pra participar' },
        { status: 400 },
      )
    }

    // ── Anti-fraud layer 3: IP rate limit (5 referral activations / 24h) ──
    const ipLimit = await checkReferralIpRateLimit(clientIp)
    if (!ipLimit.allowed) {
      await logSignupAttempt({ ip: clientIp, fingerprint, email: user.email || null, succeeded: false })
      return NextResponse.json(
        { error: `Limite de ${ipLimit.limit} cadastros por rede em ${ipLimit.windowHours}h. Tente mais tarde.` },
        { status: 429 },
      )
    }

    // 3. Service role client
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // 4. Find referrer by code (also pull excluded flag — owner/team can't win)
    const { data: referrer } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, phone, notify_channel, email, excluded_from_campaign')
      .eq('referral_code', referralCode)
      .single()

    if (!referrer) {
      return NextResponse.json({ error: 'Código de indicação não encontrado' }, { status: 404 })
    }

    if (referrer.id === user.id) {
      return NextResponse.json({ error: 'Você não pode usar seu próprio código' }, { status: 400 })
    }

    const referrerExcluded = !!(referrer as { excluded_from_campaign?: boolean }).excluded_from_campaign

    // 5. Already referred? (UNIQUE constraint on referred_id catches this too,
    //    but we want a friendly error not a 500)
    const { data: currentProfile } = await supabaseAdmin
      .from('profiles')
      .select('referred_by')
      .eq('id', user.id)
      .single()

    if (currentProfile?.referred_by) {
      return NextResponse.json({ error: 'Você já foi indicado por alguém' }, { status: 409 })
    }

    // 6. Set referred_by + grant +1 trade credit to the INDICATED user
    await supabaseAdmin
      .from('profiles')
      .update({ referred_by: referrer.id })
      .eq('id', user.id)

    await supabaseAdmin.rpc('add_trade_credits', {
      p_user_id: user.id,    // ← indicated user gets the trade credit
      p_credits: 1,
    })

    // 7. Grant +1 scan credit to the REFERRER — UNLESS they are excluded
    //    (owner/team). Excluded referrers get neither credits nor ranking
    //    points nor coupons. The INDICATED user still gets their +1 trade.
    if (!referrerExcluded) {
      await supabaseAdmin.rpc('add_scan_credits', {
        p_user_id: referrer.id,
        p_credits: 1,
      })
    }

    // 8. Insert reward record (status='confirmed' — S1 relaxed, no email gate)
    //    Excluded referrers get points=0 so the row exists for audit but
    //    contributes nothing to the ranking sum.
    await supabaseAdmin.from('referral_rewards').insert({
      referrer_id: referrer.id,
      referred_id: user.id,
      reward_type: 'signup',
      status: 'confirmed',
      points: referrerExcluded ? 0 : REFERRAL_CONSTANTS.POINTS_CONFIRMED,
      trade_credits: 1,        // granted to the INDICATED user (audit trail)
      scan_credits: referrerExcluded ? 0 : 1,
      confirmed_at: new Date().toISOString(),
      signup_ip: getIp(request),
      signup_fingerprint: fingerprint,
    })

    // 9. Coupon at 5/10/15/... confirmed friends — only for non-excluded
    let couponIssued: { code: string; validUntil: string } | null = null
    if (!referrerExcluded && await shouldIssueCouponNow(referrer.id)) {
      const issued = await issueReferrerCoupon(referrer.id)
      if (issued) {
        couponIssued = { code: issued.code, validUntil: issued.validUntil }
        // Fire-and-forget WhatsApp notification
        notifyReferrerOfCoupon(referrer, issued.code, issued.validUntil).catch((err) =>
          console.error('Failed to notify referrer of coupon:', err),
        )
      }
    }

    // Forensic log: success
    await logSignupAttempt({ ip: clientIp, fingerprint, email: user.email || null, succeeded: true })

    return NextResponse.json({
      success: true,
      message: 'Indicação aplicada! Você ganhou +1 troca extra 🎁',
      coupon_issued: couponIssued,
    })
  } catch (err) {
    console.error('Referral apply error:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// ─── WhatsApp notification when referrer earns a coupon ─────────────────────
async function notifyReferrerOfCoupon(
  referrer: { id: string; phone: string | null; notify_channel: string | null; email: string | null; display_name: string | null },
  code: string,
  validUntil: string,
) {
  const expiry = new Date(validUntil).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })

  const message =
    `🎉 *Você ganhou um cupom 50% off!*\n\n` +
    `Por indicar ${REFERRAL_CONSTANTS.FRIENDS_FOR_COUPON} amigos, ganhou:\n` +
    `🎫 Código: *${code}*\n` +
    `⏰ Válido até: ${expiry}\n\n` +
    `Use no upgrade do seu plano em completeai.com.br/planos\n\n` +
    `_Cupom pessoal, não transferível._`

  if (referrer.notify_channel === 'whatsapp' && referrer.phone) {
    try {
      await sendText(referrer.phone, message)
      return
    } catch (err) {
      console.error('WhatsApp coupon notif failed, falling back to email:', err)
    }
  }
  // Email fallback handled by /api/referral/notify cron — for now just log
  console.log(`[fallback-needed] coupon ${code} for user ${referrer.id} (${referrer.email})`)
}
