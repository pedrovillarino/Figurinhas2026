import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { checkRateLimit, getIp, generalLimiter } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * GET /api/friends — list current user's friends with ranking
 */
export async function GET(req: NextRequest) {
  const rlResponse = await checkRateLimit(getIp(req), generalLimiter)
  if (rlResponse) return rlResponse

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const admin = getAdmin()
    const { data, error } = await admin.rpc('get_friends_ranking', { p_user_id: user.id })

    if (error) {
      console.error('[friends] Error:', error.message)
      return NextResponse.json({ error: 'Erro ao buscar amigos' }, { status: 500 })
    }

    return NextResponse.json({ friends: data || [] })
  } catch (err) {
    console.error('[friends] Unexpected error:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

/**
 * POST /api/friends — add a friend by referral code
 * Body: { referral_code: string }
 */
export async function POST(req: NextRequest) {
  const rlResponse = await checkRateLimit(getIp(req), generalLimiter)
  if (rlResponse) return rlResponse

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { referral_code } = await req.json()
    if (!referral_code || typeof referral_code !== 'string' || referral_code.trim().length < 4 || referral_code.trim().length > 10) {
      return NextResponse.json({ error: 'Código inválido (4-10 caracteres)' }, { status: 400 })
    }

    // Only allow alphanumeric codes
    if (!/^[A-Za-z0-9]+$/.test(referral_code.trim())) {
      return NextResponse.json({ error: 'Código deve conter apenas letras e números' }, { status: 400 })
    }

    const admin = getAdmin()

    // Find friend by referral code
    const { data: friend } = await admin
      .from('profiles')
      .select('id, display_name')
      .ilike('referral_code', referral_code.trim())
      .single()

    if (!friend) {
      return NextResponse.json({ error: 'Código não encontrado' }, { status: 404 })
    }

    if (friend.id === user.id) {
      return NextResponse.json({ error: 'Você não pode adicionar a si mesmo' }, { status: 400 })
    }

    // Add bidirectional friendship
    const { error: err1 } = await admin.from('friends').upsert(
      { user_id: user.id, friend_id: friend.id },
      { onConflict: 'user_id,friend_id' }
    )
    const { error: err2 } = await admin.from('friends').upsert(
      { user_id: friend.id, friend_id: user.id },
      { onConflict: 'user_id,friend_id' }
    )

    if (err1 || err2) {
      console.error('[friends] Insert error:', err1?.message || err2?.message)
      return NextResponse.json({ error: 'Erro ao adicionar amigo' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, friend: { id: friend.id, display_name: friend.display_name } })
  } catch (err) {
    console.error('[friends] Unexpected error:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

/**
 * DELETE /api/friends — remove a friend
 * Body: { friend_id: string }
 */
export async function DELETE(req: NextRequest) {
  const rlResponse = await checkRateLimit(getIp(req), generalLimiter)
  if (rlResponse) return rlResponse

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { friend_id } = await req.json()
    if (!friend_id) return NextResponse.json({ error: 'friend_id obrigatório' }, { status: 400 })

    const admin = getAdmin()

    // Remove both directions
    await admin.from('friends').delete().eq('user_id', user.id).eq('friend_id', friend_id)
    await admin.from('friends').delete().eq('user_id', friend_id).eq('friend_id', user.id)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[friends] Unexpected error:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
