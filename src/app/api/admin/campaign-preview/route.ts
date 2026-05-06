// Pedro 2026-05-06: preview de campanhas agendadas — Pedro vê amostras com
// dados de AGORA antes do disparo às 18:30 (mesmo código do cron, dados live).
//
// GET /api/admin/campaign-preview?slug=<slug>&limit=3
// Auth: header `x-admin-secret` (mesmo padrão de outros admin endpoints).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  getTop3WithNames,
  getUserPosition,
  getEmbaixadorTargets,
  getEmbaixadorCoupon,
  getZeroFigTargets,
  renderEmbaixadorWhatsApp,
  renderEmbaixadorEmail,
  renderZeroFigEmail,
} from '@/lib/campaign-render'

export const dynamic = 'force-dynamic'

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
  const limit = Math.min(20, parseInt(url.searchParams.get('limit') || '3', 10))

  if (!slug) {
    return NextResponse.json({ error: 'slug required' }, { status: 400 })
  }

  const admin = getAdmin()

  const { data: camp } = await admin
    .from('scheduled_campaigns')
    .select('id, slug, campaign_type, send_at, status')
    .eq('slug', slug)
    .single()

  if (!camp) {
    return NextResponse.json({ error: 'campaign not found' }, { status: 404 })
  }

  const c = camp as {
    id: string
    slug: string
    campaign_type: 'embaixadores_wa' | 'embaixadores_email' | 'zerofig_email'
    send_at: string
    status: string
  }

  const samples: Array<{
    user_id: string
    first_name: string
    recipient_masked: string
    subject?: string
    body: string
  }> = []
  let totalTargets = 0

  if (c.campaign_type === 'embaixadores_wa') {
    const top3 = await getTop3WithNames(admin)
    const targets = await getEmbaixadorTargets(admin, 'wa')
    totalTargets = targets.length
    for (const t of targets.slice(0, limit)) {
      const pos = await getUserPosition(admin, t.user_id)
      const coupon = t.tier === 'free' ? await getEmbaixadorCoupon(admin, t.user_id) : null
      samples.push({
        user_id: t.user_id,
        first_name: t.first_name,
        recipient_masked: maskPhone(t.phone),
        body: renderEmbaixadorWhatsApp(t.first_name, pos, top3, coupon),
      })
    }
  } else if (c.campaign_type === 'embaixadores_email') {
    const top3 = await getTop3WithNames(admin)
    const targets = await getEmbaixadorTargets(admin, 'email')
    totalTargets = targets.length
    for (const t of targets.slice(0, limit)) {
      const pos = await getUserPosition(admin, t.user_id)
      const coupon = t.tier === 'free' ? await getEmbaixadorCoupon(admin, t.user_id) : null
      const { subject, html } = renderEmbaixadorEmail(t.first_name, pos, top3, coupon)
      samples.push({
        user_id: t.user_id,
        first_name: t.first_name,
        recipient_masked: maskEmail(t.email),
        subject,
        body: html,
      })
    }
  } else if (c.campaign_type === 'zerofig_email') {
    const targets = await getZeroFigTargets(admin)
    totalTargets = targets.length
    for (const t of targets.slice(0, limit)) {
      const { subject, html } = renderZeroFigEmail(t.first_name)
      samples.push({
        user_id: t.user_id,
        first_name: t.first_name,
        recipient_masked: maskEmail(t.email),
        subject,
        body: html,
      })
    }
  }

  return NextResponse.json({
    campaign: c,
    total_targets: totalTargets,
    sample_count: samples.length,
    samples,
  })
}
