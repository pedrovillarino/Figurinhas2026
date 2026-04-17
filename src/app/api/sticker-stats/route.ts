import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, getIp, generalLimiter } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * GET /api/sticker-stats
 *
 * Returns most wanted stickers. Query params:
 * - section: filter by section/country (optional)
 * - scope: 'national' | 'neighborhood' (default: national)
 * - limit: max results (default: 10, max: 20)
 */
export async function GET(req: NextRequest) {
  const rlResponse = await checkRateLimit(getIp(req), generalLimiter)
  if (rlResponse) return rlResponse

  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const rawSection = searchParams.get('section') || null
    const scope = searchParams.get('scope') || 'national'
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '10', 10), 1), 20)

    // Sanitize section: only allow alphanumeric, spaces, and basic punctuation (max 60 chars)
    const section = rawSection
      ? rawSection.replace(/[<>"'&;]/g, '').trim().slice(0, 60) || null
      : null

    const admin = getAdmin()

    if (scope === 'neighborhood') {
      const { data, error } = await admin.rpc('get_most_wanted_nearby', {
        p_user_id: user.id,
        p_radius_km: 2.5,
        p_limit: limit,
      })

      if (error) {
        console.error('[sticker-stats] neighborhood error:', error.message)
        return NextResponse.json({ error: 'Erro ao buscar dados' }, { status: 500 })
      }

      return NextResponse.json({ stickers: data || [] })
    }

    // National or by section
    const { data, error } = await admin.rpc('get_most_wanted_stickers', {
      p_section: section,
      p_limit: limit,
    })

    if (error) {
      console.error('[sticker-stats] national error:', error.message)
      return NextResponse.json({ error: 'Erro ao buscar dados' }, { status: 500 })
    }

    return NextResponse.json({ stickers: data || [] })
  } catch (err) {
    console.error('[sticker-stats] unexpected error:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
