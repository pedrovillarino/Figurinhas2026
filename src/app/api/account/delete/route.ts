import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export const maxDuration = 30

export async function POST() {
  try {
    // 1. Authenticate the user via session cookie
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (c) => { try { c.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} },
        },
      }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const userId = user.id

    // 2. Use service_role to cascade delete all user data
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    // Delete in order to respect FK constraints
    // Trade requests (both as requester and responder)
    await admin.from('trade_requests').delete().or(`requester_id.eq.${userId},responder_id.eq.${userId}`)

    // Notifications
    await admin.from('notifications').delete().eq('user_id', userId)

    // Referral rewards (as referrer)
    await admin.from('referral_rewards').delete().eq('referrer_id', userId)

    // Scan usage
    await admin.from('scan_usage').delete().eq('user_id', userId)

    // Trade usage
    await admin.from('trade_usage').delete().eq('user_id', userId)

    // User stickers
    await admin.from('user_stickers').delete().eq('user_id', userId)

    // Pending scans (WhatsApp)
    await admin.from('pending_scans').delete().eq('user_id', userId)

    // Push subscriptions
    await admin.from('push_subscriptions').delete().eq('user_id', userId)

    // Profile (must be after FKs that reference it)
    await admin.from('profiles').delete().eq('id', userId)

    // 3. Delete auth user (this is the final step)
    const { error: deleteAuthError } = await admin.auth.admin.deleteUser(userId)
    if (deleteAuthError) {
      console.error('[DELETE_ACCOUNT] Failed to delete auth user:', deleteAuthError)
      return NextResponse.json(
        { error: 'Erro ao excluir conta. Tente novamente ou entre em contato conosco.' },
        { status: 500 }
      )
    }

    console.log(`[DELETE_ACCOUNT] User ${userId} deleted successfully`)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE_ACCOUNT] Unexpected error:', err)
    return NextResponse.json(
      { error: 'Erro interno. Tente novamente.' },
      { status: 500 }
    )
  }
}
