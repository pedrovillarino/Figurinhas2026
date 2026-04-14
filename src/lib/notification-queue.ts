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
