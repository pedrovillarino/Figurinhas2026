import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { checkRateLimit, getIp, generalLimiter } from '@/lib/ratelimit'
import {
  ensureReferralCode,
  isCampaignActive,
  shouldIssueCouponNow,
  issueReferrerCoupon,
} from '@/lib/referrals'
import { sendText } from '@/lib/zapi'

// ─── /api/campanha/opt-in ──────────────────────────────────────────────────
//
// One-click opt-in for the Embaixadores campaign.
//
// Effects:
//   • Sets profiles.opted_into_campaign_at = NOW()
//   • Generates referral_code if user doesn't have one yet
//   • Re-checks coupon eligibility — a user who indicated 5+ friends BEFORE
//     opting in (within the 3-day lookback) instantly qualifies for the
//     50% off coupon when they finally opt in.
//
// Idempotent: calling twice does NOT reset opted_into_campaign_at — once
// set, it stays. Returns the existing timestamp on subsequent calls.

export async function POST(request: NextRequest) {
  const rlResponse = await checkRateLimit(getIp(request), generalLimiter)
  if (rlResponse) return rlResponse

  try {
    // Auth
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

    // Block opt-in if campaign already over
    if (!isCampaignActive()) {
      return NextResponse.json({ error: 'Campanha encerrada' }, { status: 410 })
    }

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // Read current state
    const { data: profile } = await admin
      .from('profiles')
      .select('opted_into_campaign_at, excluded_from_campaign, phone, notify_channel, email, display_name')
      .eq('id', user.id)
      .single()

    const p = profile as {
      opted_into_campaign_at: string | null
      excluded_from_campaign: boolean | null
      phone: string | null
      notify_channel: string | null
      email: string | null
      display_name: string | null
    } | null

    if (!p) {
      return NextResponse.json({ error: 'Perfil não encontrado' }, { status: 404 })
    }

    if (p.excluded_from_campaign) {
      return NextResponse.json(
        { error: 'Esta conta é da equipe Complete Aí — não participa do ranking' },
        { status: 403 },
      )
    }

    // Idempotent: if already opted in, just return the existing state
    if (p.opted_into_campaign_at) {
      return NextResponse.json({
        success: true,
        already_opted_in: true,
        opted_at: p.opted_into_campaign_at,
      })
    }

    // Set opted_into_campaign_at = NOW()
    const optedAt = new Date().toISOString()
    const { error: updateErr } = await admin
      .from('profiles')
      .update({ opted_into_campaign_at: optedAt })
      .eq('id', user.id)

    if (updateErr) {
      console.error('Opt-in update failed:', updateErr)
      return NextResponse.json({ error: 'Erro ao salvar' }, { status: 500 })
    }

    // Make sure user has a referral code (idempotent)
    const referralCode = await ensureReferralCode(user.id)

    // Re-evaluate coupon eligibility — user may have indicated 5+ friends
    // in the 3-day lookback window before clicking opt-in. shouldIssueCouponNow
    // now sees opted_into_campaign_at and may return true.
    let couponIssued: { code: string; valid_until: string } | null = null
    if (await shouldIssueCouponNow(user.id)) {
      const issued = await issueReferrerCoupon(user.id)
      if (issued) {
        couponIssued = { code: issued.code, valid_until: issued.validUntil }
        // Fire-and-forget WhatsApp notification
        notifyOptInBonus(p, issued.code, issued.validUntil).catch((err) =>
          console.error('Failed to notify opt-in coupon:', err),
        )
      }
    }

    return NextResponse.json({
      success: true,
      opted_at: optedAt,
      referral_code: referralCode,
      coupon_issued: couponIssued,
    })
  } catch (err) {
    console.error('Opt-in error:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

async function notifyOptInBonus(
  profile: { phone: string | null; notify_channel: string | null; display_name: string | null },
  code: string,
  validUntil: string,
) {
  if (!profile.phone || profile.notify_channel !== 'whatsapp') return
  const firstName = profile.display_name?.split(' ')[0] || 'Olá'
  const expiry = new Date(validUntil).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
  const message =
    `🎉 *${firstName}, bem-vindo(a) à campanha!*\n\n` +
    `Você já tinha indicado amigos antes — e por isso ganhou um cupom 50% off:\n\n` +
    `🎫 *${code}*\n⏰ Válido até ${expiry}\n\n` +
    `Use no upgrade do seu plano em completeai.com.br/planos\n\n_Cupom pessoal, não transferível._`
  try {
    await sendText(profile.phone, message)
  } catch {
    // ignore
  }
}
