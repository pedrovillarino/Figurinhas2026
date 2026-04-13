import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { TIER_CONFIG, TIER_ORDER, tierIndex, type Tier } from '@/lib/tiers'
import { checkRateLimit, getIp, stripeLimiter } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-03-25.dahlia',
  })
}

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const TIER_PRODUCTS: Record<string, { name: string; description: string }> = {
  estreante: {
    name: 'Complete Aí — Estreante',
    description: '50 scans IA + 5 trocas + sem anúncios',
  },
  colecionador: {
    name: 'Complete Aí — Colecionador',
    description: '150 scans IA + 15 trocas + packs baratos',
  },
  copa_completa: {
    name: 'Complete Aí — Copa Completa',
    description: '500 scans IA + trocas ilimitadas',
  },
}

const VALID_PAID_TIERS: Tier[] = ['estreante', 'colecionador', 'copa_completa']

export async function POST(req: NextRequest) {
  // Rate limit
  const rlResponse = await checkRateLimit(getIp(req), stripeLimiter)
  if (rlResponse) return rlResponse

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const targetTier = (body.tier || 'estreante') as Tier
    const discountCode = (body.discountCode || '').trim().toUpperCase()

    if (!VALID_PAID_TIERS.includes(targetTier)) {
      return NextResponse.json({ error: 'Plano inválido' }, { status: 400 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('tier, email')
      .eq('id', user.id)
      .single()

    const currentTier = (profile?.tier || 'free') as Tier
    const currentIdx = tierIndex(currentTier)
    const targetIdx = tierIndex(targetTier)

    // Can't downgrade or buy same tier
    if (targetIdx <= currentIdx) {
      return NextResponse.json({ error: 'Você já possui este plano ou superior!' }, { status: 400 })
    }

    const tierConfig = TIER_CONFIG[targetTier]
    const product = TIER_PRODUCTS[targetTier]
    const targetPrice = 'priceBrl' in tierConfig ? tierConfig.priceBrl : 0

    // Deduct what user already paid for current tier
    const currentTierConfig = TIER_CONFIG[currentTier]
    const currentPrice = 'priceBrl' in currentTierConfig ? currentTierConfig.priceBrl : 0
    const originalPrice = Math.max(0, targetPrice - currentPrice)

    const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    // Validate discount code if provided
    let percentOff = 0
    let codeId: string | null = null

    if (discountCode) {
      const admin = getAdmin()

      const { data: discount } = await admin
        .from('discount_codes')
        .select('*')
        .eq('code', discountCode)
        .eq('active', true)
        .single()

      if (!discount) {
        return NextResponse.json({ error: 'Código de desconto inválido' }, { status: 400 })
      }

      if (discount.tier !== targetTier) {
        const tierLabel = TIER_CONFIG[discount.tier as Tier]?.label || discount.tier
        return NextResponse.json(
          { error: `Este código é válido apenas para o plano ${tierLabel}` },
          { status: 400 }
        )
      }

      if (discount.valid_until && new Date(discount.valid_until) < new Date()) {
        return NextResponse.json({ error: 'Código expirado' }, { status: 400 })
      }

      if (discount.max_uses !== null && discount.times_used >= discount.max_uses) {
        return NextResponse.json({ error: 'Código esgotado' }, { status: 400 })
      }

      // Check if user already used this code
      const { data: existing } = await admin
        .from('discount_redemptions')
        .select('id')
        .eq('code_id', discount.id)
        .eq('user_id', user.id)
        .single()

      if (existing) {
        return NextResponse.json({ error: 'Você já usou este código' }, { status: 400 })
      }

      percentOff = discount.percent_off
      codeId = discount.id
    }

    // 100% discount: skip Stripe, upgrade directly
    if (percentOff === 100 && codeId) {
      const admin = getAdmin()

      await admin.from('discount_redemptions').insert({
        code_id: codeId,
        user_id: user.id,
        tier: targetTier,
        percent_off: 100,
      })

      const { data: currentCode } = await admin
        .from('discount_codes')
        .select('times_used')
        .eq('id', codeId)
        .single()

      if (currentCode) {
        await admin
          .from('discount_codes')
          .update({ times_used: currentCode.times_used + 1 })
          .eq('id', codeId)
      }

      await admin
        .from('profiles')
        .update({
          tier: targetTier,
          upgraded_at: new Date().toISOString(),
        })
        .eq('id', user.id)

      return NextResponse.json({
        url: `${origin}/upgrade/success?free_upgrade=true`,
      })
    }

    // Calculate discounted price
    const finalPrice = percentOff > 0
      ? Math.round(originalPrice * (1 - percentOff / 100))
      : originalPrice

    // Create Stripe checkout session
    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      customer_email: profile?.email || user.email,
      line_items: [
        {
          price_data: {
            currency: 'brl',
            unit_amount: finalPrice,
            product_data: {
              name: product.name,
              description: currentPrice > 0
                ? `${product.description} (upgrade do ${TIER_CONFIG[currentTier].label})`
                : percentOff > 0
                  ? `${product.description} (${percentOff}% de desconto!)`
                  : product.description,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        user_id: user.id,
        tier: targetTier,
        discount_code: discountCode || '',
        discount_code_id: codeId || '',
        percent_off: String(percentOff),
      },
      success_url: `${origin}/upgrade/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/album`,
    }

    const session = await getStripe().checkout.sessions.create(sessionConfig)

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('Stripe checkout error:', error)
    return NextResponse.json(
      { error: 'Erro ao criar sessão de pagamento' },
      { status: 500 }
    )
  }
}
