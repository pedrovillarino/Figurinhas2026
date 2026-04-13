import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Stripe from 'stripe'
import { TRADE_PACK_AMOUNT, TRADE_PACK_CONFIG, type Tier } from '@/lib/tiers'

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

    const { data: profile } = await supabase
      .from('profiles')
      .select('tier, email')
      .eq('id', user.id)
      .single()

    const tier = (profile?.tier || 'free') as Tier
    const packConfig = TRADE_PACK_CONFIG[tier]

    if (!packConfig) {
      return NextResponse.json(
        { error: 'Compra de trocas extras não disponível para seu plano.' },
        { status: 400 }
      )
    }

    const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'boleto'],
      customer_email: profile?.email || user.email,
      line_items: [
        {
          price_data: {
            currency: 'brl',
            unit_amount: packConfig.priceBrl,
            product_data: {
              name: `Complete Aí — +${TRADE_PACK_AMOUNT} Trocas`,
              description: `Pacote extra de ${TRADE_PACK_AMOUNT} créditos de troca`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        user_id: user.id,
        type: 'trade_pack',
        credits: String(TRADE_PACK_AMOUNT),
      },
      success_url: `${origin}/trades?pack_purchased=true`,
      cancel_url: `${origin}/trades`,
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('Trade pack checkout error:', error)
    const message = error instanceof Error ? error.message : 'Erro desconhecido'
    return NextResponse.json(
      { error: `Erro ao criar sessão de pagamento: ${message}` },
      { status: 500 }
    )
  }
}
