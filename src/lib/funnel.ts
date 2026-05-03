// Server-side funnel event tracking.
//
// Drives the conversion analysis on /admin. Always fire-and-forget — never
// block the request that triggered the event. If we lose a few events to
// transient DB errors that's acceptable; what's NOT acceptable is making
// scan/upgrade/etc slower because of analytics.
//
// Why server-side instead of GA/Mixpanel client-side:
//   • No ad-blocker drift (~30% of users block client analytics)
//   • No cookie consent dance for purely operational metrics
//   • One source of truth (our DB) — avoids reconciliation pain
//
// Volume planning: ~50 events × 5k MAU = 250k rows/month. Bigserial PK
// gives us ~9 quintillion before overflow. We're fine.
import { createClient } from '@supabase/supabase-js'

// Funnel events — keep this list closed (no free-form strings) so the admin
// dashboard stays in sync with reality.
export const FUNNEL_EVENTS = {
  // Acquisition
  SIGNUP_COMPLETED: 'signup_completed',
  // Activation
  FIRST_SCAN: 'first_scan',
  SCAN_USED: 'scan_used',
  FIRST_AUDIO: 'first_audio',
  AUDIO_USED: 'audio_used',
  FIRST_TRADE: 'first_trade',
  TRADE_USED: 'trade_used',
  // Paywall encounter
  SCAN_LIMIT_HIT: 'scan_limit_hit',
  AUDIO_LIMIT_HIT: 'audio_limit_hit',
  TRADE_LIMIT_HIT: 'trade_limit_hit',
  PAYWALL_VIEWED: 'paywall_viewed',
  // Conversion intent
  UPGRADE_CLICKED: 'upgrade_clicked',
  CHECKOUT_STARTED: 'checkout_started',
  // Conversion
  PAYMENT_COMPLETED: 'payment_completed',
  PAYMENT_FAILED: 'payment_failed',
  // Engagement signals (not strict funnel, but useful for cohort)
  REFERRAL_LINK_SHARED: 'referral_link_shared',
  CAMPAIGN_OPTED_IN: 'campaign_opted_in',
} as const

export type FunnelEventName = typeof FUNNEL_EVENTS[keyof typeof FUNNEL_EVENTS]

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/**
 * Fire-and-forget event recording. Never throws, never blocks.
 *
 * @param userId  The user this event belongs to. NULL = anonymous (rare).
 * @param event   One of the FUNNEL_EVENTS constants.
 * @param opts    Optional metadata (e.g. {tier: 'estreante'}, {sticker_id: 42}).
 */
export function trackEvent(
  userId: string | null,
  event: FunnelEventName,
  opts?: { tier?: string | null; metadata?: Record<string, unknown> },
): void {
  // Resolve and write in the background — caller doesn't await.
  ;(async () => {
    try {
      const admin = getAdmin()

      // If tier wasn't provided, look it up so we always have a snapshot.
      // This is a single indexed lookup (PK), <5ms.
      let tier = opts?.tier
      if (tier === undefined && userId) {
        const { data } = await admin
          .from('profiles')
          .select('tier')
          .eq('id', userId)
          .maybeSingle()
        tier = (data as { tier?: string } | null)?.tier ?? null
      }

      await admin.from('funnel_events').insert({
        user_id: userId,
        event_name: event,
        user_tier: tier ?? null,
        metadata: opts?.metadata ?? {},
      })
    } catch (err) {
      // Never let analytics break the request that triggered it
      console.error(`[funnel] failed to track ${event}:`, err)
    }
  })()
}

/**
 * Fires an event ONLY if the user has never fired this event before.
 * Useful for "first_scan", "first_trade" etc — first-time-only signals.
 *
 * Race-safe via SQL existence check; cost = 2 round trips instead of 1.
 */
export async function trackEventOnce(
  userId: string,
  event: FunnelEventName,
  opts?: { tier?: string | null; metadata?: Record<string, unknown> },
): Promise<void> {
  try {
    const admin = getAdmin()
    const { count } = await admin
      .from('funnel_events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('event_name', event)
      .limit(1)

    if ((count ?? 0) > 0) return // Already fired before

    let tier = opts?.tier
    if (tier === undefined) {
      const { data } = await admin
        .from('profiles')
        .select('tier')
        .eq('id', userId)
        .maybeSingle()
      tier = (data as { tier?: string } | null)?.tier ?? null
    }

    await admin.from('funnel_events').insert({
      user_id: userId,
      event_name: event,
      user_tier: tier ?? null,
      metadata: opts?.metadata ?? {},
    })
  } catch (err) {
    console.error(`[funnel] failed to track-once ${event}:`, err)
  }
}
