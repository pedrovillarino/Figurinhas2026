import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/scan/[id] — body { confirmed_count: number, rejected_sticker_ids: number[] }
 *
 * Records the user's confirmation step on a previously-scored scan_results
 * row. Called from ScanHub when the user clicks "Salvar X figurinhas" so we
 * can compute Gemini accuracy = confirmed / detected over time.
 *
 * Tracking failures are non-blocking on the client (caller uses
 * .catch(() => {})), so this just returns 200 best-effort.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10)
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

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
              cookieStore.set(name, value, options),
            )
          } catch {}
        },
      },
    },
  )
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const confirmed = Number.isFinite(body.confirmed_count) && body.confirmed_count >= 0
    ? Math.round(body.confirmed_count)
    : 0
  const rejected: number[] = Array.isArray(body.rejected_sticker_ids)
    ? body.rejected_sticker_ids
        .filter((x: unknown) => Number.isInteger(x) && (x as number) > 0)
        .slice(0, 200) // sanity cap
    : []

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // Only update rows the caller actually owns — defense in depth even though
  // service-role client wouldn't normally be challenged.
  const { error } = await admin
    .from('scan_results')
    .update({
      user_confirmed_count: confirmed,
      rejected_sticker_ids: rejected.length > 0 ? rejected : null,
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    console.error('[scan PATCH] update error:', error.message)
    return NextResponse.json({ ok: false }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
