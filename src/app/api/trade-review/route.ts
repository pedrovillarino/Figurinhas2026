import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { checkRateLimit, getIp, generalLimiter } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * POST /api/trade-review
 *
 * Submit a review for a completed (approved) trade.
 *
 * Body: { trade_request_id: string, rating: number, comment?: string }
 */
export async function POST(req: NextRequest) {
  // Rate limit
  const rlResponse = await checkRateLimit(getIp(req), generalLimiter)
  if (rlResponse) return rlResponse

  try {
    // 1. Auth
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

    // 2. Parse and validate body
    const body = await req.json()
    const { trade_request_id, rating, comment } = body

    if (!trade_request_id || typeof trade_request_id !== 'string' || !UUID_RE.test(trade_request_id)) {
      return NextResponse.json({ error: 'trade_request_id inválido.' }, { status: 400 })
    }

    if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'rating deve ser um inteiro entre 1 e 5.' }, { status: 400 })
    }

    if (comment !== undefined && comment !== null) {
      if (typeof comment !== 'string' || comment.length > 500) {
        return NextResponse.json({ error: 'comment deve ter no máximo 500 caracteres.' }, { status: 400 })
      }
    }

    const admin = getAdmin()

    // 3. Verify trade exists, is approved, and user is a participant
    const { data: trade, error: tradeError } = await admin
      .from('trade_requests')
      .select('id, requester_id, target_id, status')
      .eq('id', trade_request_id)
      .single()

    if (tradeError || !trade) {
      return NextResponse.json({ error: 'Troca não encontrada.' }, { status: 404 })
    }

    if (trade.status !== 'approved') {
      return NextResponse.json({ error: 'Só é possível avaliar trocas aprovadas.' }, { status: 400 })
    }

    const isRequester = trade.requester_id === user.id
    const isTarget = trade.target_id === user.id

    if (!isRequester && !isTarget) {
      return NextResponse.json({ error: 'Você não participa desta troca.' }, { status: 403 })
    }

    // 4. Determine the reviewed user (the other party)
    const reviewed_id = isRequester ? trade.target_id : trade.requester_id

    // 5. Check for existing review by this user on this trade
    const { data: existingReview } = await admin
      .from('trade_reviews')
      .select('id')
      .eq('trade_request_id', trade_request_id)
      .eq('reviewer_id', user.id)
      .single()

    if (existingReview) {
      return NextResponse.json({ error: 'Você já avaliou esta troca.' }, { status: 409 })
    }

    // 6. Insert review
    const { data: review, error: insertError } = await admin
      .from('trade_reviews')
      .insert({
        trade_request_id,
        reviewer_id: user.id,
        reviewed_id,
        rating,
        comment: comment?.trim() || null,
      })
      .select('id, rating, created_at')
      .single()

    if (insertError) {
      console.error('[trade-review] Insert error:', insertError)
      // Unique constraint = already reviewed
      if (insertError.code === '23505') {
        return NextResponse.json({ error: 'Você já avaliou esta troca.' }, { status: 409 })
      }
      return NextResponse.json({ error: 'Erro ao salvar avaliação.' }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      review: {
        id: review.id,
        rating: review.rating,
        created_at: review.created_at,
      },
    })
  } catch (err) {
    console.error('[trade-review] Error:', err)
    return NextResponse.json({ error: 'Erro ao processar avaliação.' }, { status: 500 })
  }
}
