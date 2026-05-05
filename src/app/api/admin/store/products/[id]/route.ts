/**
 * Admin store products [id] — PATCH atualiza, DELETE soft delete (active=false).
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
  const expected = process.env.ADMIN_SECRET || 'completeai2026'
  return provided === expected
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const id = parseInt(params.id, 10)
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const updates: Record<string, unknown> = {}

  if (typeof body.title === 'string') updates.title = body.title.trim()
  if (typeof body.description === 'string') updates.description = body.description.trim() || null
  if (typeof body.image_url === 'string') updates.image_url = body.image_url.trim() || null
  if (typeof body.price_display === 'string') updates.price_display = body.price_display.trim() || null
  if (typeof body.affiliate_url === 'string') {
    const url = body.affiliate_url.trim()
    if (url) {
      try {
        new URL(url)
        updates.affiliate_url = url
      } catch {
        return NextResponse.json({ error: 'affiliate_url inválida' }, { status: 400 })
      }
    }
  }
  if (typeof body.category === 'string' && VALID_CATEGORIES.includes(body.category as StoreCategory)) {
    updates.category = body.category
  }
  if (typeof body.featured === 'boolean') updates.featured = body.featured
  if (Number.isFinite(body.sort_order)) updates.sort_order = Number(body.sort_order)
  if (typeof body.active === 'boolean') updates.active = body.active

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'nada pra atualizar' }, { status: 400 })
  }

  const admin = getStoreAdmin()
  const { data, error } = await admin
    .from('store_products')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('[admin/store/products PATCH] error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ product: data })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const id = parseInt(params.id, 10)
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  // Soft delete = active=false. Mantém histórico pra eventual reativação +
  // não quebra ad_placements que tenham referência (FK ON DELETE SET NULL).
  const admin = getStoreAdmin()
  const { error } = await admin
    .from('store_products')
    .update({ active: false })
    .eq('id', id)

  if (error) {
    console.error('[admin/store/products DELETE] error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
