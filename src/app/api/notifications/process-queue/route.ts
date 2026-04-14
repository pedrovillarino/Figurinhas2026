import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendText } from '@/lib/zapi'
import { sendEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const CRON_SECRET = process.env.CRON_SECRET

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * POST /api/notifications/process-queue
 *
 * Processes pending notifications in the queue.
 * Called by Vercel Cron every 2 minutes.
 * Protected by CRON_SECRET header.
 */
export async function POST(req: NextRequest) {
  // Verify cron secret (skip in dev)
  if (CRON_SECRET) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const admin = getAdmin()

  // Fetch up to 20 pending notifications ready for retry
  const { data: pending, error } = await admin
    .from('notification_queue')
    .select('*')
    .eq('status', 'pending')
    .lte('next_retry_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(20)

  if (error || !pending || pending.length === 0) {
    return NextResponse.json({ processed: 0 })
  }

  // Mark as processing
  const ids = pending.map(n => n.id)
  await admin
    .from('notification_queue')
    .update({ status: 'processing' })
    .in('id', ids)

  let sent = 0
  let failed = 0

  for (const notif of pending) {
    let success = false

    try {
      if (notif.channel === 'whatsapp') {
        await sendText(notif.recipient, notif.message)
        success = true
      } else if (notif.channel === 'email') {
        success = await sendEmail(notif.recipient, notif.subject || 'Complete Aí', notif.message)
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)

      if (notif.retry_count + 1 >= notif.max_retries) {
        // Max retries reached - mark as failed
        await admin
          .from('notification_queue')
          .update({
            status: 'failed',
            last_error: errorMsg,
            retry_count: notif.retry_count + 1,
          })
          .eq('id', notif.id)
        failed++
      } else {
        // Schedule retry with exponential backoff: 2min, 8min, 32min
        const backoffMinutes = Math.pow(4, notif.retry_count + 1) * 0.5
        const nextRetry = new Date(Date.now() + backoffMinutes * 60 * 1000)

        await admin
          .from('notification_queue')
          .update({
            status: 'pending',
            last_error: errorMsg,
            retry_count: notif.retry_count + 1,
            next_retry_at: nextRetry.toISOString(),
          })
          .eq('id', notif.id)
        failed++
      }
      continue
    }

    if (success) {
      await admin
        .from('notification_queue')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', notif.id)
      sent++
    } else {
      // sendEmail returned false
      if (notif.retry_count + 1 >= notif.max_retries) {
        await admin
          .from('notification_queue')
          .update({ status: 'failed', retry_count: notif.retry_count + 1, last_error: 'Send returned false' })
          .eq('id', notif.id)
      } else {
        const backoffMinutes = Math.pow(4, notif.retry_count + 1) * 0.5
        const nextRetry = new Date(Date.now() + backoffMinutes * 60 * 1000)
        await admin
          .from('notification_queue')
          .update({
            status: 'pending',
            retry_count: notif.retry_count + 1,
            next_retry_at: nextRetry.toISOString(),
            last_error: 'Send returned false',
          })
          .eq('id', notif.id)
      }
      failed++
    }
  }

  return NextResponse.json({ processed: pending.length, sent, failed })
}
