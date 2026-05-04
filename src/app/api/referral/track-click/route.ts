import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { trackEvent, FUNNEL_EVENTS } from '@/lib/funnel'

export const dynamic = 'force-dynamic'

/**
 * POST /api/referral/track-click
 *
 * Anonymous endpoint — fires when an unauthenticated visitor lands with
 * `?ref=CODE` in the URL. Resolves the code to the referrer's user_id and
 * fires a REFERRAL_LINK_CLICKED funnel event attributed to the referrer.
 *
 * Pedro 2026-05-04: pediu pra ranking de embaixadores mostrar "envios"
 * e "cliques" do link. Cliques são rastreados aqui (anon-friendly), envios
 * via /api/funnel/track (user-auth).
 *
 * Body: { referral_code: string }
 *
 * Returns 204 always (don't leak whether code is valid via status).
 *
 * Dedup: not enforced server-side. Same visitor reloading the page will
 * fire repeatedly. Acceptable for ranking aggregation; if abuse becomes
 * a problem we can add IP-based dedup window later.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const referralCode = String(body?.referral_code || '').trim().toUpperCase()
    if (!referralCode) return new NextResponse(null, { status: 204 })

    // Resolve code → referrer_id (admin client, anon caller)
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const { data: profile } = await admin
      .from('profiles')
      .select('id, tier')
      .eq('referral_code', referralCode)
      .maybeSingle()

    if (!profile?.id) return new NextResponse(null, { status: 204 })

    // Fire-and-forget; trackEvent itself is non-blocking
    trackEvent(profile.id, FUNNEL_EVENTS.REFERRAL_LINK_CLICKED, {
      tier: (profile as { tier?: string | null })?.tier ?? null,
      metadata: {
        referral_code: referralCode,
        user_agent: req.headers.get('user-agent') || null,
      },
    })
  } catch {
    // never leak details
  }
  return new NextResponse(null, { status: 204 })
}
