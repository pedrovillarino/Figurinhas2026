import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

export const dynamic = 'force-dynamic'

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
      const tier = session.metadata?.tier || 'premium'

      if (userId) {
        const ok = await upgradeTier(userId, tier, session.customer as string)
        if (!ok) return NextResponse.json({ error: 'DB update failed' }, { status: 500 })
      }
    }
  }

  // Handle Pix (async payment confirmation)
  if (event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as Stripe.Checkout.Session
    const userId = session.metadata?.user_id
    const tier = session.metadata?.tier || 'premium'

    if (userId) {
      await upgradeTier(userId, tier, session.customer as string)
    }
  }

  return NextResponse.json({ received: true })
}
