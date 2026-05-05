/**
 * GET /api/store/ad/[placement] — retorna o produto associado ao placement.
 *
 * Pedro 2026-05-05: usado pelo componente <FreeUserAd> client-side. Retorna
 * 200 com null se placement não tem produto, está inativo, ou produto está
 * inativo. O componente decide o que renderizar.
 *
 * NÃO checa tier do user — frontend já sabe se hasAds=true antes de chamar.
 *
 * Pedro 2026-05-05 (rotação opção B): trades_notification revesa entre
 * camisa, bola, mascote (e camisa infantil quando cadastrada). Random
 * a cada fetch — a cada visita o user vê produto diferente.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAdForPlacement, getStoreAdmin, type StoreProduct } from '@/lib/store'

export const dynamic = 'force-dynamic'

// IDs dos produtos que entram na rotação do trades_notification.
// Pedro 2026-05-05: camisa adulto Nike + bola Trionda + mascotes pop.
// TODO: adicionar camisa INFANTIL quando Pedro mandar link (id ?).
const TRADES_NOTIFICATION_ROTATION_IDS = [17, 18, 22]

export async function GET(_req: NextRequest, { params }: { params: { placement: string } }) {
  const placement = params.placement
  if (!placement || placement.length > 50) {
    return NextResponse.json({ ad: null }, { status: 400 })
  }

  // ── Rotação especial: trades_notification ──
  if (placement === 'trades_notification') {
    const admin = getStoreAdmin()
    // Verifica se placement está ativo (admin pode ter desativado)
    const { data: pl } = await admin
      .from('ad_placements')
      .select('placement_id, copy_override, active')
      .eq('placement_id', placement)
      .eq('active', true)
      .maybeSingle()
    if (!pl) return NextResponse.json({ ad: null })

    // Random pick + fetch product
    const idx = Math.floor(Math.random() * TRADES_NOTIFICATION_ROTATION_IDS.length)
    const productId = TRADES_NOTIFICATION_ROTATION_IDS[idx]
    const { data: product } = await admin
      .from('store_products')
      .select('*')
      .eq('id', productId)
      .eq('active', true)
      .maybeSingle()

    if (!product) return NextResponse.json({ ad: null })

    return NextResponse.json({
      ad: {
        placement_id: placement,
        copy_override: pl.copy_override,
        product_id: productId,
        active: true,
        product: product as StoreProduct,
      },
    })
  }

  // ── Default: 1 produto fixo via ad_placements.product_id ──
  const ad = await getAdForPlacement(placement)
  return NextResponse.json({ ad })
}
