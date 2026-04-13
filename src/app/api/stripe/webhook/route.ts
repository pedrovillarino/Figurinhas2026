import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

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

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session

    if (session.payment_status === 'paid') {
      const userId = session.metadata?.user_id
      const type = session.metadata?.type

      if (userId && type === 'scan_pack') {
        // Scan pack purchase — add credits
        const credits = parseInt(session.metadata?.credits || '100', 10)
        const ok = await addScanCredits(userId, credits)
        if (!ok) return NextResponse.json({ error: 'Credits update failed' }, { status: 500 })
      } else if (userId && type === 'trade_pack') {
        // Trade pack purchase — add trade credits
        const credits = parseInt(session.metadata?.credits || '10', 10)
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
      }
    }
  }

  // Handle Boleto/Pix (async payment confirmation)
  if (event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as Stripe.Checkout.Session
    const userId = session.metadata?.user_id
    const type = session.metadata?.type

    if (userId && type === 'scan_pack') {
      const credits = parseInt(session.metadata?.credits || '100', 10)
      await addScanCredits(userId, credits)
    } else if (userId && type === 'trade_pack') {
      const credits = parseInt(session.metadata?.credits || '10', 10)
      await addTradeCredits(userId, credits)
    } else if (userId) {
      const tier = session.metadata?.tier || 'estreante'
      await upgradeTier(userId, tier, session.customer as string)
      if (session.metadata) {
        await recordDiscountRedemption(session.metadata as Record<string, string>, userId)
      }
    }
  }

  return NextResponse.json({ received: true })
}
