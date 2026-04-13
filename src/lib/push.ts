import { createClient } from '@supabase/supabase-js'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:contato@completeai.com.br'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; url?: string; icon?: string }
) {
  try {
    // Dynamic import so it only loads on server
    const webpush = await import('web-push')

    webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

    const admin = getAdmin()
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', userId)

    if (!subs || subs.length === 0) return { sent: 0 }

    const notifPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url || '/trades',
      icon: payload.icon || '/icon-192.png',
    })

    let sent = 0
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          notifPayload
        )
        sent++
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode
        // 410 Gone or 404 = subscription expired, clean up
        if (statusCode === 410 || statusCode === 404) {
          await admin
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', sub.endpoint)
        }
        console.error('Push send error:', err)
      }
    }

    return { sent }
  } catch (err) {
    console.error('Push notification error:', err)
    return { sent: 0 }
  }
}
