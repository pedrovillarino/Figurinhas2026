// Pedro 2026-05-06: cron de disparo de campanhas agendadas (scheduled_campaigns).
//
// Roda diariamente às 21:30 UTC (18:30 BR). Pra cada job pending com send_at <= now:
//   1) Marca status='running'
//   2) Re-puxa lista alvo + ranking LIVE
//   3) Pra cada destinatário: skipa se já tem campaign_sends, senão renderiza + dispara
//   4) Marca status='completed' + counters
//
// Auth: Bearer ${CRON_SECRET}.
// Idempotência: unique(campaign_id, user_id) em campaign_sends garante zero dup.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendText } from '@/lib/zapi'
import { sendEmail } from '@/lib/email'
import {
  getTop3WithNames,
  getUserPosition,
  getEmbaixadorTargets,
  getZeroFigTargets,
  renderEmbaixadorWhatsApp,
  renderEmbaixadorEmail,
  renderZeroFigEmail,
} from '@/lib/campaign-render'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 min — batch de 200+ msgs com rate-limit

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

// Throttle: 200ms entre msgs (5/seg). Z-API recomenda <= 5 msg/min pra grupos
// novos, mas tráfego 1-pra-1 aguenta mais. Email do Resend aguenta 10/seg.
async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getAdmin()

  // Pega jobs pending cuja janela já chegou
  const { data: campaigns } = await admin
    .from('scheduled_campaigns')
    .select('id, slug, campaign_type, send_at, status')
    .eq('status', 'pending')
    .lte('send_at', new Date().toISOString())

  if (!campaigns || campaigns.length === 0) {
    return NextResponse.json({ ok: true, message: 'no pending campaigns' })
  }

  const results: Array<Record<string, unknown>> = []

  for (const c of campaigns) {
    const camp = c as {
      id: string
      slug: string
      campaign_type: 'embaixadores_wa' | 'embaixadores_email' | 'zerofig_email'
      send_at: string
      status: string
    }

    // Marca running (idempotente: só passa de pending → running)
    const { error: lockErr } = await admin
      .from('scheduled_campaigns')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', camp.id)
      .eq('status', 'pending')

    if (lockErr) {
      results.push({ slug: camp.slug, error: 'lock failed', detail: lockErr.message })
      continue
    }

    try {
      const summary = await processCampaign(admin, camp)
      await admin
        .from('scheduled_campaigns')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          total_targets: summary.total,
          total_sent: summary.sent,
          total_failed: summary.failed,
        })
        .eq('id', camp.id)
      results.push({ slug: camp.slug, ...summary })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await admin
        .from('scheduled_campaigns')
        .update({ status: 'failed', notes: `error: ${msg}` })
        .eq('id', camp.id)
      results.push({ slug: camp.slug, error: msg })
    }
  }

  return NextResponse.json({ ok: true, results })
}

async function processCampaign(
  admin: ReturnType<typeof getAdmin>,
  camp: { id: string; campaign_type: string; slug: string },
): Promise<{ total: number; sent: number; failed: number; skipped: number }> {
  const out = { total: 0, sent: 0, failed: 0, skipped: 0 }

  if (camp.campaign_type === 'embaixadores_wa') {
    const top3 = await getTop3WithNames(admin)
    const targets = await getEmbaixadorTargets(admin, 'wa')
    out.total = targets.length

    for (const t of targets) {
      if (!t.phone) {
        out.skipped++
        continue
      }
      // Idempotência
      const { data: already } = await admin
        .from('campaign_sends')
        .select('id')
        .eq('campaign_id', camp.id)
        .eq('user_id', t.user_id)
        .maybeSingle()
      if (already) {
        out.skipped++
        continue
      }

      const pos = await getUserPosition(admin, t.user_id)
      const body = renderEmbaixadorWhatsApp(t.first_name, pos, top3)

      let ok = false
      let errMsg: string | null = null
      try {
        ok = await sendText(t.phone, body)
      } catch (e) {
        errMsg = e instanceof Error ? e.message : String(e)
      }

      await admin.from('campaign_sends').insert({
        campaign_id: camp.id,
        user_id: t.user_id,
        channel: 'whatsapp',
        recipient: t.phone,
        body_preview: body.slice(0, 500),
        status: ok ? 'sent' : 'failed',
        error_message: errMsg,
      })

      if (ok) out.sent++
      else out.failed++

      await sleep(200) // 5/seg
    }
  } else if (camp.campaign_type === 'embaixadores_email') {
    const top3 = await getTop3WithNames(admin)
    const targets = await getEmbaixadorTargets(admin, 'email')
    out.total = targets.length

    for (const t of targets) {
      if (!t.email) {
        out.skipped++
        continue
      }
      const { data: already } = await admin
        .from('campaign_sends')
        .select('id')
        .eq('campaign_id', camp.id)
        .eq('user_id', t.user_id)
        .maybeSingle()
      if (already) {
        out.skipped++
        continue
      }

      const pos = await getUserPosition(admin, t.user_id)
      const { subject, html } = renderEmbaixadorEmail(t.first_name, pos, top3)

      let ok = false
      let errMsg: string | null = null
      try {
        ok = await sendEmail(t.email, subject, html)
      } catch (e) {
        errMsg = e instanceof Error ? e.message : String(e)
      }

      await admin.from('campaign_sends').insert({
        campaign_id: camp.id,
        user_id: t.user_id,
        channel: 'email',
        recipient: t.email,
        body_preview: `${subject}\n\n${html.slice(0, 400)}`,
        status: ok ? 'sent' : 'failed',
        error_message: errMsg,
      })

      if (ok) out.sent++
      else out.failed++

      await sleep(100) // 10/seg
    }
  } else if (camp.campaign_type === 'zerofig_email') {
    const targets = await getZeroFigTargets(admin)
    out.total = targets.length

    for (const t of targets) {
      const { data: already } = await admin
        .from('campaign_sends')
        .select('id')
        .eq('campaign_id', camp.id)
        .eq('user_id', t.user_id)
        .maybeSingle()
      if (already) {
        out.skipped++
        continue
      }

      const { subject, html } = renderZeroFigEmail(t.first_name)

      let ok = false
      let errMsg: string | null = null
      try {
        ok = await sendEmail(t.email, subject, html)
      } catch (e) {
        errMsg = e instanceof Error ? e.message : String(e)
      }

      await admin.from('campaign_sends').insert({
        campaign_id: camp.id,
        user_id: t.user_id,
        channel: 'email',
        recipient: t.email,
        body_preview: `${subject}\n\n${html.slice(0, 400)}`,
        status: ok ? 'sent' : 'failed',
        error_message: errMsg,
      })

      if (ok) out.sent++
      else out.failed++

      await sleep(100)
    }
  } else {
    throw new Error(`unknown campaign_type: ${camp.campaign_type}`)
  }

  return out
}
