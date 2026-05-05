/**
 * Admin ad_placements [id] — PATCH muda product_id, copy_override, active.
 * Pedro 2026-05-05.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getStoreAdmin } from '@/lib/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function checkAuth(req: NextRequest): boolean {
  const provided = req.headers.get('x-admin-secret')
  const expected = process.env.ADMIN_SECRET
  return !!expected && provided === expected
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const placementId = params.id
  if (!placementId) {
    return NextResponse.json({ error: 'invalid placement_id' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const updates: Record<string, unknown> = {}

  // product_id pode vir como número, null (pra desassociar), ou undefined (no-op)
  if (body.product_id === null) {
    updates.product_id = null
  } else if (Number.isFinite(body.product_id)) {
    updates.product_id = Number(body.product_id)
  }

  if (typeof body.copy_override === 'string') {
    updates.copy_override = body.copy_override.trim() || null
  }
  if (typeof body.active === 'boolean') {
    updates.active = body.active
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'nada pra atualizar' }, { status: 400 })
  }

  const admin = getStoreAdmin()
  const { data, error } = await admin
    .from('ad_placements')
    .update(updates)
    .eq('placement_id', placementId)
    .select()
    .single()

  if (error) {
    console.error('[admin/store/placements PATCH] error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ placement: data })
}
