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

    const errors: string[] = []

    async function del(table: string, filter: () => ReturnType<ReturnType<typeof admin.from>['delete']>) {
      const { error } = await filter()
      if (error) {
        console.error(`[DELETE_ACCOUNT] Failed to delete from ${table}:`, error.message)
        errors.push(`${table}: ${error.message}`)
      }
    }

    // Delete in order to respect FK constraints (children first)

    // Trade requests (both as requester and target)
    await del('trade_requests', () =>
      admin.from('trade_requests').delete().or(`requester_id.eq.${userId},target_id.eq.${userId}`)
    )

    // Notification queue
    await del('notification_queue', () =>
      admin.from('notification_queue').delete().eq('user_id', userId)
    )

    // Notifications
    await del('notifications', () =>
      admin.from('notifications').delete().eq('user_id', userId)
    )

    // Discount redemptions
    await del('discount_redemptions', () =>
      admin.from('discount_redemptions').delete().eq('user_id', userId)
    )

    // Referral rewards (as referrer OR as referred)
    await del('referral_rewards (referrer)', () =>
      admin.from('referral_rewards').delete().eq('referrer_id', userId)
    )
    await del('referral_rewards (referred)', () =>
      admin.from('referral_rewards').delete().eq('referred_id', userId)
    )

    // Scan usage
    await del('scan_usage', () =>
      admin.from('scan_usage').delete().eq('user_id', userId)
    )

    // Trade usage
    await del('trade_usage', () =>
      admin.from('trade_usage').delete().eq('user_id', userId)
    )

    // User stickers
    await del('user_stickers', () =>
      admin.from('user_stickers').delete().eq('user_id', userId)
    )

    // Pending scans (WhatsApp)
    await del('pending_scans', () =>
      admin.from('pending_scans').delete().eq('user_id', userId)
    )

    // Push subscriptions
    await del('push_subscriptions', () =>
      admin.from('push_subscriptions').delete().eq('user_id', userId)
    )

    // User reports (as reporter or reported)
    await del('user_reports', () =>
      admin.from('user_reports').delete().or(`reporter_id.eq.${userId},reported_user_id.eq.${userId}`)
    )

    // Clear referred_by references in other profiles
    await del('profiles (referred_by)', () =>
      admin.from('profiles').update({ referred_by: null }).eq('referred_by', userId)
    )

    // Profile (must be after FKs that reference it)
    await del('profiles', () =>
      admin.from('profiles').delete().eq('id', userId)
    )

    // If any critical deletes failed, abort before deleting auth user
    if (errors.length > 0) {
      console.error(`[DELETE_ACCOUNT] ${errors.length} errors during cascade delete for ${userId}:`, errors)
      return NextResponse.json(
        { error: 'Erro ao excluir alguns dados. Entre em contato com contato@completeai.com.br para concluir a exclusão.' },
        { status: 500 }
      )
    }

    // 3. Delete auth user (this is the final step)
    const { error: deleteAuthError } = await admin.auth.admin.deleteUser(userId)
    if (deleteAuthError) {
      console.error('[DELETE_ACCOUNT] Failed to delete auth user:', deleteAuthError)
      return NextResponse.json(
        { error: 'Erro ao excluir conta. Entre em contato com contato@completeai.com.br.' },
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
