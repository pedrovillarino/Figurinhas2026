import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Enqueue a notification for retry if the direct send fails.
 * Call this AFTER a send attempt fails.
 */
export async function enqueueNotification(params: {
  userId: string
  channel: 'whatsapp' | 'email'
  recipient: string
  message: string
  subject?: string
}) {
  try {
    const admin = getAdmin()
    await admin.from('notification_queue').insert({
      user_id: params.userId,
      channel: params.channel,
      recipient: params.recipient,
      subject: params.subject,
      message: params.message,
      status: 'pending',
      next_retry_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(), // retry in 2 min
    })
  } catch (err) {
    console.error('Failed to enqueue notification:', err)
  }
}

/**
 * Pedro 2026-05-03: log de notificação enviada com sucesso, pro admin
 * ver histórico + calcular taxa de volta-ao-app 24h depois.
 *
 * Tipos canônicos (pra agrupar bem no admin):
 *  - 'match_digest'           — cron de matches diário
 *  - 'embaixadores_milestone' — cron de embaixadores
 *  - 'courtesy'               — service recovery manual/auto
 *  - 'trade_request'          — alguém pediu troca
 *  - 'trade_approved'         — sua troca foi aprovada
 *
 * Best-effort: nunca lança. Se falhar, log e segue.
 */
export async function logNotificationSent(params: {
  userId: string
  type: string
  channel: 'whatsapp' | 'email'
  recipient: string
  messagePreview?: string
}) {
  try {
    const admin = getAdmin()
    await admin.from('notifications_sent').insert({
      user_id: params.userId,
      type: params.type,
      channel: params.channel,
      recipient: params.recipient,
      message_preview: params.messagePreview?.slice(0, 200) ?? null,
    })
  } catch (err) {
    console.error('Failed to log notification:', err)
  }
}
