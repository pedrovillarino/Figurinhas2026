import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// POST /api/scan/feedback
//
// Body: { rating: 'positive' | 'negative', comment?: string, metadata?: object }
//
// Always responds 204 — never lets analytics noise turn into a UX error.
// If insert fails (DB blip, etc), user still sees their normal scan flow.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return new NextResponse(null, { status: 204 })

    const body = await req.json().catch(() => ({}))
    const rating = body?.rating
    if (rating !== 'positive' && rating !== 'negative') {
      return new NextResponse(null, { status: 204 })
    }

    // Comment: trim + cap. We don't reject — just slice. No reason to surface
    // a "your comment is too long" error to a user trying to help us.
    const rawComment = typeof body?.comment === 'string' ? body.comment.trim() : null
    const comment = rawComment ? rawComment.slice(0, 500) : null

    const metadata = (body?.metadata && typeof body.metadata === 'object') ? body.metadata : {}

    // Best-effort scan count snapshot — useful in admin to see if early-vs-late
    // users have different sentiment.
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const { data: scanRows } = await admin
      .from('scan_usage')
      .select('scan_count')
      .eq('user_id', user.id)
    const scanCountAtFeedback = (scanRows || []).reduce(
      (acc, row) => acc + ((row as { scan_count?: number }).scan_count || 0),
      0,
    )

    await admin.from('scan_feedback').insert({
      user_id: user.id,
      rating,
      comment,
      scan_count_at_feedback: scanCountAtFeedback,
      metadata,
    })

    return new NextResponse(null, { status: 204 })
  } catch (err) {
    console.error('[scan-feedback] failed:', err)
    return new NextResponse(null, { status: 204 })
  }
}
