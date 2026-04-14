/**
 * Opportunistic Health Ping
 *
 * Calls /api/whatsapp/health in the background whenever any API route runs,
 * but at most once every 5 minutes. This keeps WhatsApp alive and monitors
 * the system without needing external cron services.
 *
 * Usage: import { backgroundHealthPing } from '@/lib/health-ping'
 *        backgroundHealthPing() // fire-and-forget, no await
 */

let lastPingAt = 0
const PING_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://completeai.com.br').trim()
const CRON_SECRET = process.env.CRON_SECRET

export function backgroundHealthPing() {
  const now = Date.now()
  if (now - lastPingAt < PING_INTERVAL_MS) return // too soon, skip
  lastPingAt = now

  // Fire-and-forget — don't await, don't block the caller
  fetch(`${APP_URL}/api/whatsapp/health`, {
    method: 'GET',
    headers: CRON_SECRET ? { Authorization: `Bearer ${CRON_SECRET}` } : {},
  }).catch(() => {
    // Silently ignore — this is best-effort
  })
}
