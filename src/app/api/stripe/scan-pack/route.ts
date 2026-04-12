import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Stripe from 'stripe'
import { SCAN_PACK_PRICE_BRL, SCAN_PACK_AMOUNT } from '@/lib/tiers'

export const dynamic = 'force-dynamic'

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-03-25.dahlia',
  })
}

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    // Only paid users can buy packs (free users should upgrade first)
    const { data: profile } = await supabase
      .from('profiles')
      .select('tier, email')
      .eq('id', user.id)
      .single()

    if (!profile || profile.tier === 'free') {
      return NextResponse.json(
        { error: 'Faça upgrade para Plus ou Premium antes de comprar pacotes extras.' },
        { status: 400 }
      )
    }

    const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'boleto'],
      customer_email: profile.email || user.email,
      line_items: [
        {
          price_data: {
            currency: 'brl',
            unit_amount: SCAN_PACK_PRICE_BRL,
            product_data: {
              name: `Complete Aí — +${SCAN_PACK_AMOUNT} Scans`,
              description: `Pacote extra de ${SCAN_PACK_AMOUNT} scans para seu álbum`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        user_id: user.id,
        type: 'scan_pack',
        credits: String(SCAN_PACK_AMOUNT),
      },
      success_url: `${origin}/scan?pack_purchased=true`,
      cancel_url: `${origin}/scan`,
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('Scan pack checkout error:', error)
    return NextResponse.json(
      { error: 'Erro ao criar sessão de pagamento' },
      { status: 500 }
    )
  }
}
