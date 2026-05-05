import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Stripe from 'stripe'
import { AUDIO_PACK_AMOUNTS, AUDIO_PACK_AMOUNT, AUDIO_PACK_CONFIG, type Tier } from '@/lib/tiers'

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
    const packConfig = AUDIO_PACK_CONFIG[tier]

    if (!packConfig) {
      // Colecionador e Copa Completa já têm áudio ilimitado
      return NextResponse.json(
        { error: 'Seu plano já tem áudio ilimitado.' },
        { status: 400 }
      )
    }

    const packAmount = AUDIO_PACK_AMOUNTS[tier] || AUDIO_PACK_AMOUNT
    const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      customer_email: profile?.email || user.email,
      line_items: [
        {
          price_data: {
            currency: 'brl',
            unit_amount: packConfig.priceBrl,
            product_data: {
              name: `Complete Aí — +${packAmount} Áudios`,
              description: `Pacote extra de ${packAmount} áudios pelo WhatsApp`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        user_id: user.id,
        type: 'audio_pack',
        credits: String(packAmount),
      },
      success_url: `${origin}/profile?audio_pack_purchased=true`,
      cancel_url: `${origin}/profile`,
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('Audio pack checkout error:', error)
    return NextResponse.json(
      { error: 'Erro ao criar sessão de pagamento' },
      { status: 500 }
    )
  }
}
