import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, getIp, generalLimiter } from '@/lib/ratelimit'

export const maxDuration = 30

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  const rlResponse = await checkRateLimit(getIp(req), generalLimiter)
  if (rlResponse) return rlResponse

  try {
    // Verify user is authenticated
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const code = (body.code || '').trim().toUpperCase()
    const tier = body.tier || 'estreante'

    if (!code) {
      return NextResponse.json({ error: 'Código não informado' }, { status: 400 })
    }

    const admin = getAdminClient()

    // Look up the code for the selected tier
    const { data: discount, error: lookupError } = await admin
      .from('discount_codes')
      .select('id, code, tier, percent_off, valid_until, max_uses, times_used, active')
      .eq('code', code)
      .eq('tier', tier)
      .eq('active', true)
      .single()

    if (lookupError || !discount) {
      // Try without tier filter to give better error message
      const { data: anyCode } = await admin
        .from('discount_codes')
        .select('tier')
        .eq('code', code)
        .eq('active', true)
        .limit(1)

      if (anyCode && anyCode.length > 0) {
        return NextResponse.json({ error: 'Este código não é válido para o plano selecionado' }, { status: 400 })
      }
      return NextResponse.json({ error: 'Código inválido' }, { status: 404 })
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
