/**
 * Admin store products — POST cria, GET lista (admin only).
 * Pedro 2026-05-05.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getStoreAdmin, type StoreCategory } from '@/lib/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const VALID_CATEGORIES: StoreCategory[] = [
  'album',
  'pacotes',
  'acessorios',
  'camisas',
  'bolas',
  'mascotes',
  'outros',
]

function checkAuth(req: NextRequest): boolean {
  const provided = req.headers.get('x-admin-secret')
  // Pedro 2026-05-05: usa mesmo fallback do /admin/page.tsx pra funcionar
  // mesmo sem ADMIN_SECRET nas env vars do Vercel.
  const expected = process.env.ADMIN_SECRET || 'completeai2026'
  return provided === expected
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const title = (body.title || '').toString().trim()
  const affiliateUrl = (body.affiliate_url || '').toString().trim()
  const description = body.description?.toString().trim() || null
  const imageUrl = body.image_url?.toString().trim() || null
  const priceDisplay = body.price_display?.toString().trim() || null
  const category = VALID_CATEGORIES.includes(body.category) ? body.category : 'outros'
  const featured = !!body.featured
  const sortOrder = Number.isFinite(body.sort_order) ? Number(body.sort_order) : 0
  const active = body.active !== false

  if (!title || !affiliateUrl) {
    return NextResponse.json(
      { error: 'title e affiliate_url são obrigatórios' },
      { status: 400 },
    )
  }

  // Validação leve da URL
  try {
    new URL(affiliateUrl)
  } catch {
    return NextResponse.json({ error: 'affiliate_url inválida' }, { status: 400 })
  }
  if (imageUrl) {
    try {
      new URL(imageUrl)
    } catch {
      return NextResponse.json({ error: 'image_url inválida' }, { status: 400 })
    }
  }

  const admin = getStoreAdmin()
  const { data, error } = await admin
    .from('store_products')
    .insert({
      title,
      description,
      image_url: imageUrl,
      price_display: priceDisplay,
      affiliate_url: affiliateUrl,
      category,
      featured,
      sort_order: sortOrder,
      active,
    })
    .select()
    .single()

  if (error) {
    console.error('[admin/store/products] insert error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ product: data })
}
