import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { trackEvent, trackEventOnce, FUNNEL_EVENTS, type FunnelEventName } from '@/lib/funnel'

export const dynamic = 'force-dynamic'

// Client-allowed events: only events that NEED to fire from the browser
// (UI views, clicks). Server-side events stay server-side — clients can't
// fake "payment_completed" by hitting this endpoint.
const CLIENT_ALLOWED_EVENTS = new Set<FunnelEventName>([
  FUNNEL_EVENTS.SIGNUP_COMPLETED,
  FUNNEL_EVENTS.PAYWALL_VIEWED,
  FUNNEL_EVENTS.UPGRADE_CLICKED,
  FUNNEL_EVENTS.REFERRAL_LINK_SHARED,
])

const ONCE_EVENTS = new Set<FunnelEventName>([
  FUNNEL_EVENTS.SIGNUP_COMPLETED,
])

/**
 * POST /api/funnel/track
 *
 * Lightweight client beacon for view/click events. Validates the user is
 * authed (via cookie) and the event is in our client whitelist. Returns 204
 * always (don't leak info to clients via status codes).
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return new NextResponse(null, { status: 204 })

    const body = await req.json().catch(() => ({}))
    const event = body?.event as FunnelEventName
    const metadata = (body?.metadata && typeof body.metadata === 'object') ? body.metadata : {}

    if (!event || !CLIENT_ALLOWED_EVENTS.has(event)) {
      return new NextResponse(null, { status: 204 })
    }

    if (ONCE_EVENTS.has(event)) {
      await trackEventOnce(user.id, event, { metadata })
    } else {
      trackEvent(user.id, event, { metadata })
    }

    return new NextResponse(null, { status: 204 })
  } catch {
    return new NextResponse(null, { status: 204 })
  }
}
