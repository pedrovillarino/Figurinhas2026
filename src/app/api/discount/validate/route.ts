import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 30

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  try {
    // Verify user is authenticated
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const code = (body.code || '').trim().toUpperCase()
    const tier = body.tier || 'premium'

    if (!code) {
      return NextResponse.json({ error: 'Código não informado' }, { status: 400 })
    }

    const admin = getAdminClient()

    // Look up the code
    const { data: discount, error: lookupError } = await admin
      .from('discount_codes')
      .select('*')
      .eq('code', code)
      .eq('active', true)
      .single()

    if (lookupError || !discount) {
      return NextResponse.json({ error: 'Código inválido' }, { status: 404 })
    }

    // Check tier compatibility
    if (discount.tier !== tier) {
      return NextResponse.json(
        { error: `Este código é válido apenas para o plano ${discount.tier === 'plus' ? 'Plus' : 'Premium'}` },
        { status: 400 }
      )
    }

    // Check expiry
    if (discount.valid_until && new Date(discount.valid_until) < new Date()) {
      return NextResponse.json({ error: 'Código expirado' }, { status: 410 })
    }

    // Check max uses
    if (discount.max_uses !== null && discount.times_used >= discount.max_uses) {
      return NextResponse.json({ error: 'Código esgotado' }, { status: 410 })
    }

    // Check if user already used this code
    const { data: existing } = await admin
      .from('discount_redemptions')
      .select('id')
      .eq('code_id', discount.id)
      .eq('user_id', user.id)
      .single()

    if (existing) {
      return NextResponse.json({ error: 'Você já usou este código' }, { status: 409 })
    }

    return NextResponse.json({
      valid: true,
      percent_off: discount.percent_off,
      tier: discount.tier,
      code_id: discount.id,
    })
  } catch (error) {
    console.error('Discount validation error:', error)
    return NextResponse.json({ error: 'Erro ao validar código' }, { status: 500 })
  }
}
