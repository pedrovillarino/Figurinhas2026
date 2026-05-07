// Pedro 2026-05-06: tracking de efetividade pós-disparo de campanha.
//
// Pra cada user que recebeu uma campanha, computa atribuição:
//   - Visitou o site após o envio?
//   - Indicou amigo (referral confirmed/paid_upgrade)?
//   - Fez upgrade próprio?
//   - Registrou figurinhas (relevante pra zerofig)?
//
// Usa send_at (quando o cron enviou) como cutoff. Se um user já tinha feito
// upgrade ANTES do disparo, não conta.
//
// GET /api/admin/campaign-attribution?slug=<slug>
// Auth: header `x-admin-secret`.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

function maskEmail(e: string | null): string {
  if (!e) return ''
  const [user, domain] = e.split('@')
  if (!domain) return '****'
  return `${user.slice(0, 2)}***@${domain}`
}
function maskPhone(p: string | null): string {
  if (!p) return ''
  return p.slice(0, 4) + '****' + p.slice(-4)
}

export async function GET(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET
  if (adminSecret && req.headers.get('x-admin-secret') !== adminSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const slug = url.searchParams.get('slug')
  if (!slug) {
    return NextResponse.json({ error: 'slug required' }, { status: 400 })
  }

  const admin = getAdmin()

  // 1. Pega campanha
  const { data: campData } = await admin
    .from('scheduled_campaigns')
    .select('id, slug, campaign_type, send_at, status, completed_at, total_sent, total_failed')
    .eq('slug', slug)
    .single()

  if (!campData) {
    return NextResponse.json({ error: 'campaign not found' }, { status: 404 })
  }
  const camp = campData as {
    id: string
    slug: string
    campaign_type: string
    send_at: string
    status: string
    completed_at: string | null
    total_sent: number | null
    total_failed: number | null
  }

  // 2. Pega todos os envios bem-sucedidos
  const { data: sendsData } = await admin
    .from('campaign_sends')
    .select('user_id, channel, recipient, sent_at, status')
    .eq('campaign_id', camp.id)
    .eq('status', 'sent')

  const sends = (sendsData || []) as Array<{
    user_id: string
    channel: string
    recipient: string
    sent_at: string
    status: string
  }>

  if (sends.length === 0) {
    return NextResponse.json({
      campaign: camp,
      summary: { total_sent: 0 },
      per_user: [],
      message: 'no successful sends yet',
    })
  }

  const userIds = sends.map((s) => s.user_id)
  const minSendAt = sends.reduce((min, s) => (s.sent_at < min ? s.sent_at : min), sends[0].sent_at)

  // 3. Pega profiles (last_active, self_upgrade, tier, display_name)
  const { data: profsData } = await admin
    .from('profiles')
    .select('id, display_name, last_active, self_upgrade_at, tier, upgraded_at')
    .in('id', userIds)

  const profs = (profsData || []) as Array<{
    id: string
    display_name: string | null
    last_active: string | null
    self_upgrade_at: string | null
    tier: string | null
    upgraded_at: string | null
  }>
  const profMap = new Map(profs.map((p) => [p.id, p]))

  // 4. Referrals confirmados/paid após send (por user)
  const { data: refsData } = await admin
    .from('referral_rewards')
    .select('referrer_id, status, confirmed_at')
    .in('referrer_id', userIds)
    .in('status', ['confirmed', 'paid_upgrade'])
    .gte('confirmed_at', minSendAt)

  const refs = (refsData || []) as Array<{ referrer_id: string; status: string; confirmed_at: string }>
  const refMap = new Map<string, { confirmed: number; paid: number }>()
  for (const r of refs) {
    const cur = refMap.get(r.referrer_id) || { confirmed: 0, paid: 0 }
    if (r.status === 'paid_upgrade') cur.paid++
    else cur.confirmed++
    refMap.set(r.referrer_id, cur)
  }

  // 5. Stickers registrados após send (relevante pra zerofig)
  const isZerofigCampaign = camp.campaign_type === 'zerofig_email'
  const stickerMap = new Map<string, number>()
  if (isZerofigCampaign) {
    const { data: stickData } = await admin
      .from('user_stickers')
      .select('user_id, quantity, updated_at')
      .in('user_id', userIds)
      .gt('quantity', 0)
      .gte('updated_at', minSendAt)

    const stickRows = (stickData || []) as Array<{ user_id: string; quantity: number }>
    for (const s of stickRows) {
      stickerMap.set(s.user_id, (stickerMap.get(s.user_id) || 0) + s.quantity)
    }
  }

  // 6. Funnel events (visited site after send) — store_click, scan, etc.
  const { data: eventsData } = await admin
    .from('funnel_events')
    .select('user_id, event_name, created_at')
    .in('user_id', userIds)
    .gte('created_at', minSendAt)
    .order('created_at', { ascending: true })

  const events = (eventsData || []) as Array<{ user_id: string; event_name: string; created_at: string }>
  const eventCountMap = new Map<string, number>()
  for (const e of events) {
    eventCountMap.set(e.user_id, (eventCountMap.get(e.user_id) || 0) + 1)
  }

  // 7. Cupons usados (somente embaixadores)
  let couponUsedMap = new Map<string, string>() // user_id → code usado
  if (camp.campaign_type !== 'zerofig_email') {
    const { data: redempData } = await admin
      .from('discount_redemptions')
      .select('user_id, code_id')
      .in('user_id', userIds)

    const redemps = (redempData || []) as Array<{ user_id: string; code_id: string }>
    if (redemps.length > 0) {
      const codeIds = redemps.map((r) => r.code_id)
      const { data: codesData } = await admin
        .from('discount_codes')
        .select('id, code')
        .in('id', codeIds)
        .eq('created_by', 'campaign_embaixadores_20260506')
      const codes = (codesData || []) as Array<{ id: string; code: string }>
      const codeMap = new Map(codes.map((c) => [c.id, c.code]))
      for (const r of redemps) {
        const code = codeMap.get(r.code_id)
        if (code) couponUsedMap.set(r.user_id, code)
      }
    }
  }

  // 8. Per-user breakdown
  const perUser = sends.map((s) => {
    const p = profMap.get(s.user_id)
    const sendAt = new Date(s.sent_at).getTime()
    // Pedro 2026-05-07: visited_after baseado em events count (funnel_events)
    // em vez de profile.last_active. last_active só é atualizado em rotas
    // específicas (/upgrade/success, /trades, /profile) — não em pageview
    // genérico. funnel_events captura ad_click, signup, scan_used, etc. =
    // proxy melhor de "voltou ao app".
    const eventsCount = eventCountMap.get(s.user_id) || 0
    const visitedAfter = eventsCount > 0
    const upgradedAfter = p?.upgraded_at
      ? new Date(p.upgraded_at).getTime() > sendAt
      : false
    const refStats = refMap.get(s.user_id) || { confirmed: 0, paid: 0 }
    const stickerCount = stickerMap.get(s.user_id) || 0
    const couponUsed = couponUsedMap.get(s.user_id) || null

    return {
      user_id: s.user_id,
      first_name: p?.display_name?.split(' ')[0] || '?',
      recipient_masked: s.channel === 'whatsapp' ? maskPhone(s.recipient) : maskEmail(s.recipient),
      channel: s.channel,
      sent_at: s.sent_at,
      tier: p?.tier || 'free',
      visited_after: visitedAfter,
      events_count: eventsCount,
      friends_confirmed_after: refStats.confirmed,
      friends_paid_after: refStats.paid,
      upgraded_after: upgradedAfter,
      coupon_used: couponUsed,
      ...(isZerofigCampaign ? { stickers_registered_after: stickerCount } : {}),
    }
  })

  // 9. Summary
  const summary = {
    total_sent: sends.length,
    visited_site: perUser.filter((u) => u.visited_after).length,
    friends_confirmed_total: perUser.reduce((s, u) => s + u.friends_confirmed_after, 0),
    friends_paid_total: perUser.reduce((s, u) => s + u.friends_paid_after, 0),
    upgraded: perUser.filter((u) => u.upgraded_after).length,
    coupon_used: perUser.filter((u) => u.coupon_used).length,
    ...(isZerofigCampaign
      ? {
          users_who_registered_stickers: perUser.filter(
            (u) => 'stickers_registered_after' in u && (u as { stickers_registered_after: number }).stickers_registered_after > 0,
          ).length,
          total_stickers_registered: perUser.reduce(
            (s, u) =>
              s + ('stickers_registered_after' in u ? (u as { stickers_registered_after: number }).stickers_registered_after : 0),
            0,
          ),
        }
      : {}),
  }

  return NextResponse.json({
    campaign: camp,
    summary,
    per_user: perUser,
  })
}
