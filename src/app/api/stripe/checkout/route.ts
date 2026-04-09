import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Stripe from 'stripe'
import { TIER_CONFIG, type Tier } from '@/lib/tiers'

export const dynamic = 'force-dynamic'

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-03-25.dahlia',
  })
}

const TIER_PRODUCTS: Record<string, { name: string; description: string }> = {
  plus: {
    name: 'Álbum da Copa — Plus',
    description: 'Scanner IA + figurinhas ilimitadas',
  },
  premium: {
    name: 'Álbum da Copa — Premium',
    description: 'Scanner IA + trocas + figurinhas ilimitadas',
  },
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const targetTier = (body.tier || 'premium') as Tier

    if (targetTier !== 'plus' && targetTier !== 'premium') {
      return NextResponse.json({ error: 'Tier inválido' }, { status: 400 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('tier, email')
      .eq('id', user.id)
      .single()

    const currentTier = (profile?.tier || 'free') as Tier

    // Can't downgrade or buy same tier
    if (currentTier === targetTier || currentTier === 'premium') {
      return NextResponse.json({ error: 'Você já possui este plano ou superior!' }, { status: 400 })
    }

    const tierConfig = TIER_CONFIG[targetTier]
    const product = TIER_PRODUCTS[targetTier]
    const priceBrl = 'priceBrl' in tierConfig ? tierConfig.priceBrl : 0

    const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'boleto'],
      customer_email: profile?.email || user.email,
      line_items: [
        {
          price_data: {
            currency: 'brl',
            unit_amount: priceBrl,
            product_data: {
              name: product.name,
              description: product.description,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        user_id: user.id,
        tier: targetTier,
      },
      success_url: `${origin}/upgrade/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/album`,
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('Stripe checkout error:', error)
    return NextResponse.json(
      { error: 'Erro ao criar sessão de pagamento' },
      { status: 500 }
    )
  }
}
