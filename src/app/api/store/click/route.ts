/**
 * POST /api/store/click — fire-and-forget tracking de click em produto/ad.
 *
 * Pedro 2026-05-05: usado por <StoreClickTracker> e <FreeUserAd> pra
 * registrar o click ANTES do redirect pro link de afiliado ML.
 *
 * Body: { product_id: number, source: 'loja' | `placement_${string}`, placement_id?: string }
 *
 * Não exige auth — visitante anônimo da /loja também conta. Se houver
 * sessão, attacha user_id pro funnel.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { trackEvent, FUNNEL_EVENTS } from '@/lib/funnel'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const productId = Number(body.product_id)
    const source: string = (body.source || 'loja').toString().slice(0, 50)
    const placementId: string | undefined = body.placement_id?.toString().slice(0, 50)

    if (!productId || !Number.isFinite(productId)) {
      return NextResponse.json({ error: 'invalid_product_id' }, { status: 400 })
    }

    // Tenta pegar userId (se logado). Anônimo é OK.
    let userId: string | null = null
    try {
      const supabase = await createServerClient()
      const { data: { user } } = await supabase.auth.getUser()
      userId = user?.id || null
    } catch {
      // sessão ausente / erro — segue como anônimo
    }

    const eventName =
      source === 'loja' ? FUNNEL_EVENTS.STORE_CLICK : FUNNEL_EVENTS.AD_CLICK

    trackEvent(userId, eventName, {
      metadata: {
        product_id: productId,
        source,
        placement_id: placementId || null,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[store-click] error:', err)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
