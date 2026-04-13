import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function POST(request: Request) {
  try {
    // 1. Auth — get current user
    const cookieStore = cookies()
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {}
          },
        },
      }
    )

    const { data: { user } } = await supabaseAuth.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    // 2. Parse body
    const body = await request.json()
    const { referral_code } = body as { referral_code: string }

    if (!referral_code || typeof referral_code !== 'string') {
      return NextResponse.json({ error: 'Código de indicação inválido' }, { status: 400 })
    }

    const code = referral_code.trim().toUpperCase()

    // 3. Service role client for DB operations
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // 4. Find referrer by code
    const { data: referrer } = await supabaseAdmin
      .from('profiles')
      .select('id, referral_code')
      .eq('referral_code', code)
      .single()

    if (!referrer) {
      return NextResponse.json({ error: 'Código de indicação não encontrado' }, { status: 404 })
    }

    // Can't refer yourself
    if (referrer.id === user.id) {
      return NextResponse.json({ error: 'Você não pode usar seu próprio código' }, { status: 400 })
    }

    // 5. Check if user already has a referrer
    const { data: currentProfile } = await supabaseAdmin
      .from('profiles')
      .select('referred_by')
      .eq('id', user.id)
      .single()

    if (currentProfile?.referred_by) {
      return NextResponse.json({ error: 'Você já foi indicado por alguém' }, { status: 409 })
    }

    // 6. Check if a signup reward already exists for this pair
    const { data: existingReward } = await supabaseAdmin
      .from('referral_rewards')
      .select('id')
      .eq('referrer_id', referrer.id)
      .eq('referred_id', user.id)
      .eq('reward_type', 'signup')
      .maybeSingle()

    if (existingReward) {
      return NextResponse.json({ error: 'Indicação já registrada' }, { status: 409 })
    }

    // 7. Set referred_by on user's profile
    await supabaseAdmin
      .from('profiles')
      .update({ referred_by: referrer.id })
      .eq('id', user.id)

    // 8. Grant +1 trade credit to referrer
    await supabaseAdmin.rpc('add_trade_credits', {
      p_user_id: referrer.id,
      p_credits: 1,
    })

    // 9. Insert referral_rewards record
    await supabaseAdmin.from('referral_rewards').insert({
      referrer_id: referrer.id,
      referred_id: user.id,
      reward_type: 'signup',
      trade_credits: 1,
      scan_credits: 0,
    })

    return NextResponse.json({ success: true, message: 'Indicação aplicada com sucesso!' })
  } catch (err) {
    console.error('Referral apply error:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
