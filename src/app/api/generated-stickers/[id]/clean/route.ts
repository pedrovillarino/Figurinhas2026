/**
 * GET /api/generated-stickers/{id}/clean
 *
 * Retorna URL signed (24h TTL) da imagem limpa, SE a figurinha estiver
 * paga e pertencer ao user logado.
 *
 * Pedro 2026-05-04: Fase 1 MVP.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  const stickerId = Number(params.id)
  if (!Number.isFinite(stickerId) || stickerId <= 0) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  }

  const admin = getAdmin()
  const { data: sticker } = await admin
    .from('generated_stickers')
    .select('id, user_id, status, clean_url')
    .eq('id', stickerId)
    .single()

  if (!sticker || sticker.user_id !== user.id) {
    return NextResponse.json({ error: 'Figurinha não encontrada' }, { status: 404 })
  }
  if (sticker.status !== 'paid') {
    return NextResponse.json({ error: 'Figurinha ainda não liberada' }, { status: 402 })
  }
  if (!sticker.clean_url) {
    return NextResponse.json({ error: 'Imagem indisponível' }, { status: 500 })
  }

  // Signed URL com 24h de validade
  const { data: signed, error } = await admin.storage
    .from('generated-stickers')
    .createSignedUrl(sticker.clean_url as string, 60 * 60 * 24)

  if (error || !signed) {
    console.error('[generated-stickers/clean] signed URL error:', error)
    return NextResponse.json({ error: 'Erro ao gerar link' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, url: signed.signedUrl })
}
