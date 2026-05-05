/**
 * GET /api/store/ad/[placement] — retorna o produto associado ao placement.
 *
 * Pedro 2026-05-05: usado pelo componente <FreeUserAd> client-side. Retorna
 * 200 com null se placement não tem produto, está inativo, ou produto está
 * inativo. O componente decide o que renderizar.
 *
 * NÃO checa tier do user — frontend já sabe se hasAds=true antes de chamar.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAdForPlacement } from '@/lib/store'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { placement: string } }) {
  const placement = params.placement
  if (!placement || placement.length > 50) {
    return NextResponse.json({ ad: null }, { status: 400 })
  }

  const ad = await getAdForPlacement(placement)
  return NextResponse.json({ ad })
}
