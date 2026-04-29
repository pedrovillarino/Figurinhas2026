import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { TIER_CONFIG } from '@/lib/tiers'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-03-25.dahlia',
  })
}

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function upgradeTier(userId: string, tier: string, customerId: string | null) {
  const supabase = getAdminClient()
  const { error } = await supabase
    .from('profiles')
    .update({
      tier,
      stripe_customer_id: customerId,
      upgraded_at: new Date().toISOString(),
    })
    .eq('id', userId)

  if (error) {
    console.error('Error updating tier:', error)
    return false
  }
  console.log(`User ${userId} upgraded to ${tier}`)
  return true
}

async function addScanCredits(userId: string, credits: number) {
  const supabase = getAdminClient()
  const { data, error } = await supabase.rpc('add_scan_credits', {
    p_user_id: userId,
    p_credits: credits,
  })

  if (error) {
    console.error('Error adding scan credits:', error)
    return false
  }
  console.log(`User ${userId} added ${credits} scan credits:`, data)
  return true
}

async function addTradeCredits(userId: string, credits: number) {
  const supabase = getAdminClient()
  const { data, error } = await supabase.rpc('add_trade_credits', {
    p_user_id: userId,
    p_credits: credits,
  })

  if (error) {
    console.error('Error adding trade credits:', error)
    return false
  }
  console.log(`User ${userId} added ${credits} trade credits:`, data)
  return true
}

async function grantReferralUpgradeReward(userId: string, amountPaid: number, tier?: string) {
  // ── Embaixadores campaign (2026-04-29) ──
  // When a paid tier is purchased:
  //   1. SELF: stamp profiles.self_upgrade_at so the user gets +5 in their
  //      OWN ranking position (only counted by the RPC if they opted in).
  //   2. REFERRER (if any): update existing 'confirmed' reward to
  //      'paid_upgrade', bump points 1 → 5, notify via WhatsApp.
  // Both gated on amount_paid > 0 so 100% off coupons don't count.
  if (amountPaid <= 0) {
    console.log(`Referral upgrade skipped: amount_paid=${amountPaid} (zero-cost upgrade)`)
    return
  }

  const supabase = getAdminClient()

  // ── 1. SELF — stamp self_upgrade_at if not already set ──
  // Idempotent: only the FIRST paid upgrade counts. Subsequent upgrades
  // (e.g. Estreante → Colecionador) don't add more points.
  const { data: profile } = await supabase
    .from('profiles')
    .select('self_upgrade_at')
    .eq('id', userId)
    .single()
  const profileSelfUpgradedAt = (profile as { self_upgrade_at: string | null } | null)?.self_upgrade_at
  if (!profileSelfUpgradedAt) {
    await supabase
      .from('profiles')
      .update({ self_upgrade_at: new Date().toISOString() })
      .eq('id', userId)
    console.log(`Self-upgrade stamped for user ${userId} (tier: ${tier})`)
  }

  // ── 2. REFERRER (if user was referred) ──
  // Find the existing signup reward for this user
  const { data: existing } = await supabase
    .from('referral_rewards')
    .select('id, referrer_id, status')
    .eq('referred_id', userId)
    .eq('reward_type', 'signup')
    .maybeSingle()

  if (!existing) {
    // User wasn't referred (or signup reward never created) — nothing to do
    return
  }

  const reward = existing as { id: number; referrer_id: string; status: string }
  if (reward.status === 'paid_upgrade') {
    return // Already rewarded for upgrade
  }

  // Check if the referrer is excluded from the campaign (owner/team) — they
  // still get the row updated to paid_upgrade (audit trail) but with 0 points.
  const { data: referrerProfile } = await supabase
    .from('profiles')
    .select('excluded_from_campaign')
    .eq('id', reward.referrer_id)
    .maybeSingle()
  const referrerExcluded = !!(referrerProfile as { excluded_from_campaign?: boolean } | null)?.excluded_from_campaign

  // Update reward to paid_upgrade with 5 points (replaces the +1 from confirmation)
  await supabase
    .from('referral_rewards')
    .update({
      status: 'paid_upgrade',
      points: referrerExcluded ? 0 : 5,
      upgraded_at: new Date().toISOString(),
    })
    .eq('id', reward.id)

  if (referrerExcluded) {
    console.log(`Referrer ${reward.referrer_id} is excluded from campaign — no points awarded`)
    return
  }

  console.log(`Referral upgrade: referrer ${reward.referrer_id} earned 5 ranking points from ${userId} (tier: ${tier})`)

  // Notify referrer via WhatsApp (fire-and-forget)
  notifyReferrerOfUpgrade(reward.referrer_id, userId, tier).catch((err) =>
    console.error('Failed to notify referrer of upgrade:', err),
  )
}

async function notifyReferrerOfUpgrade(referrerId: string, friendId: string, tier?: string) {
  const supabase = getAdminClient()
  const [{ data: referrer }, { data: friend }] = await Promise.all([
    supabase.from('profiles').select('phone, notify_channel, display_name').eq('id', referrerId).single(),
    supabase.from('profiles').select('display_name').eq('id', friendId).single(),
  ])

  const r = referrer as { phone: string | null; notify_channel: string | null; display_name: string | null } | null
  const f = friend as { display_name: string | null } | null
  if (!r) return

  const friendName = f?.display_name?.split(' ')[0] || 'Seu amigo'
  // Friendly plan label — fall back gracefully if tier is missing
  const planLabel =
    tier && tier in TIER_CONFIG
      ? TIER_CONFIG[tier as keyof typeof TIER_CONFIG].label
      : 'pagante'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br'
  const message =
    `🚀 *${friendName} se tornou ${planLabel}!*\n\n` +
    `Ele te rendeu *5 pontos* no ranking da campanha Embaixadores.\n\n` +
    `Veja como está: ${appUrl}/campanha`

  if (r.notify_channel === 'whatsapp' && r.phone) {
    try {
      const { sendText } = await import('@/lib/zapi')
      await sendText(r.phone, message)
    } catch (err) {
      console.error('Upgrade notification WhatsApp send failed:', err)
    }
  }
}

async function recordDiscountRedemption(metadata: Record<string, string>, userId: string) {
  const codeId = metadata.discount_code_id
  const percentOff = parseInt(metadata.percent_off || '0', 10)
  const tier = metadata.tier || 'estreante'

  if (!codeId || percentOff === 0) return

  const supabase = getAdminClient()

  // Record redemption (ignore if already exists)
  await supabase.from('discount_redemptions').insert({
    code_id: codeId,
    user_id: userId,
    tier,
    percent_off: percentOff,
  })

  // Increment usage counter
  const { data: code } = await supabase
    .from('discount_codes')
    .select('times_used')
    .eq('id', codeId)
    .single()

  if (code) {
    await supabase
      .from('discount_codes')
      .update({ times_used: code.times_used + 1 })
      .eq('id', codeId)
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'No signature' }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = getStripe().webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // ── Idempotency: skip already-processed events ──
  const supabaseAdmin = getAdminClient()
  const { data: existingEvent } = await supabaseAdmin
    .from('processed_stripe_events')
    .select('id')
    .eq('event_id', event.id)
    .maybeSingle()

  if (existingEvent) {
    console.log(`Stripe event ${event.id} already processed, skipping`)
    return NextResponse.json({ received: true, duplicate: true })
  }

  // Mark event as processing (ignore insert conflict = another instance got it first)
  const { error: insertError } = await supabaseAdmin
    .from('processed_stripe_events')
    .insert({ event_id: event.id, event_type: event.type })

  if (insertError?.code === '23505') {
    // Unique constraint violation — another instance processed it
    console.log(`Stripe event ${event.id} claimed by another instance`)
    return NextResponse.json({ received: true, duplicate: true })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session

    if (session.payment_status === 'paid') {
      const userId = session.metadata?.user_id
      const type = session.metadata?.type

      if (userId && type === 'scan_pack') {
        // Scan pack purchase — add credits
        const credits = parseInt(session.metadata?.credits || '10', 10) // safe fallback: smallest pack
        const ok = await addScanCredits(userId, credits)
        if (!ok) return NextResponse.json({ error: 'Credits update failed' }, { status: 500 })
      } else if (userId && type === 'trade_pack') {
        // Trade pack purchase — add trade credits
        const credits = parseInt(session.metadata?.credits || '2', 10) // safe fallback: smallest pack
        const ok = await addTradeCredits(userId, credits)
        if (!ok) return NextResponse.json({ error: 'Trade credits update failed' }, { status: 500 })
      } else if (userId) {
        // Tier upgrade
        const tier = session.metadata?.tier || 'estreante'
        const ok = await upgradeTier(userId, tier, session.customer as string)
        if (!ok) return NextResponse.json({ error: 'DB update failed' }, { status: 500 })
        if (session.metadata) {
          await recordDiscountRedemption(session.metadata as Record<string, string>, userId)
        }
        // Grant referral upgrade reward if applicable. amount_total is in cents
        // and EXCLUDES discount — so a 100% off coupon results in amount_total=0
        // and the referrer correctly does NOT earn the +5 points.
        await grantReferralUpgradeReward(userId, session.amount_total || 0, tier)
      }
    }
  }

  // Handle Boleto/Pix (async payment confirmation)
  if (event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as Stripe.Checkout.Session
    const userId = session.metadata?.user_id
    const type = session.metadata?.type

    if (userId && type === 'scan_pack') {
      const credits = parseInt(session.metadata?.credits || '10', 10) // safe fallback: smallest pack
      await addScanCredits(userId, credits)
    } else if (userId && type === 'trade_pack') {
      const credits = parseInt(session.metadata?.credits || '2', 10) // safe fallback: smallest pack
      await addTradeCredits(userId, credits)
    } else if (userId) {
      const tier = session.metadata?.tier || 'estreante'
      await upgradeTier(userId, tier, session.customer as string)
      if (session.metadata) {
        await recordDiscountRedemption(session.metadata as Record<string, string>, userId)
      }
      // Grant referral upgrade reward if applicable (async payment path —
      // amount_total reflects net amount paid, so 100% off won't trigger reward)
      await grantReferralUpgradeReward(userId, session.amount_total || 0, tier)
    }
  }

  return NextResponse.json({ received: true })
}
