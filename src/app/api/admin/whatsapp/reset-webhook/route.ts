import { NextRequest, NextResponse } from 'next/server'
import { setReceiveWebhook, restartInstance, getInstanceStatus } from '@/lib/zapi'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Admin: força o recovery do INBOUND do WhatsApp na mão, independente do
// watchdog automático (/api/whatsapp/health). Recovery de 1 clique pro caso
// em que a Z-API para de entregar mensagens recebidas (envio segue OK).
//
// Criado no postmortem do incident 2026-06-02 — ver
// docs/postmortem-2026-06-02-whatsapp-inbound-silent.md.
//
// Auth: header `x-admin-secret` = ADMIN_SECRET.
//
// POST /api/admin/whatsapp/reset-webhook
// Body (opcional): { "restart": true }  → também reinicia a instância Z-API
export async function POST(req: NextRequest) {
  const provided = req.headers.get('x-admin-secret')
  const expected = process.env.ADMIN_SECRET
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const statusBefore = await getInstanceStatus()

  // 1. Re-aponta o webhook de mensagens recebidas (PUT update-webhook-received,
  //    URL hardcoded em setReceiveWebhook — nunca aliasa outro tipo de webhook).
  const webhookReset = await setReceiveWebhook()

  // 2. Restart opcional (reconecta a sessão sem QR).
  let restarted: boolean | undefined
  if (body.restart === true) {
    restarted = await restartInstance()
  }

  console.log('[admin/reset-webhook]', JSON.stringify({ webhookReset, restarted, statusBefore }))

  return NextResponse.json({
    ok: webhookReset,
    webhook_reset: webhookReset,
    restarted,
    status_before: statusBefore,
  })
}
