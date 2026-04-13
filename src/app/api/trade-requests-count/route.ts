import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { checkRateLimit, getIp, generalLimiter } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const rlResponse = await checkRateLimit(getIp(req), generalLimiter)
  if (rlResponse) return rlResponse

  try {
    const cookieStore = cookies()
    const supabase = createServerClient(
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

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ count: 0 })

    const { count } = await supabase
      .from('trade_requests')
      .select('id', { count: 'exact', head: true })
      .eq('target_id', user.id)
      .eq('status', 'pending')

    return NextResponse.json({ count: count || 0 })
  } catch {
    return NextResponse.json({ count: 0 })
  }
}
