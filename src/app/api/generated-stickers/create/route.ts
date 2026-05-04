/**
 * POST /api/generated-stickers/create
 *
 * Body: { photoBase64: string, photoMimeType: string, personName?: string }
 *
 * Gera figurinha estilo Copa 2026 com a foto enviada, aplica marca d'água
 * e retorna URL do preview WM. User precisa pagar (ou usar cota do plano)
 * pra liberar versão limpa via /api/generated-stickers/checkout.
 *
 * Pedro 2026-05-04: Fase 1 MVP.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { generateSticker, applyPreviewWatermark } from '@/lib/sticker-generator'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

const MAX_PHOTO_BYTES = 8 * 1024 * 1024 // 8MB

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  // Rate-limit simples: máx 5 gerações/hora por user (pra evitar custo escapar)
  const admin = getAdmin()
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count: recentGen } = await admin
    .from('generated_stickers')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', oneHourAgo)
  if ((recentGen ?? 0) >= 5) {
    return NextResponse.json(
      { error: 'Você gerou muitas figurinhas na última hora. Tenta de novo em alguns minutos.' },
      { status: 429 },
    )
  }

  let body: { photoBase64?: string; photoMimeType?: string; personName?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const { photoBase64, photoMimeType, personName } = body

  if (!photoBase64 || typeof photoBase64 !== 'string') {
    return NextResponse.json({ error: 'photoBase64 obrigatório' }, { status: 400 })
  }
  if (!photoMimeType || !/^image\/(jpeg|jpg|png|webp)$/.test(photoMimeType)) {
    return NextResponse.json({ error: 'photoMimeType inválido (use image/jpeg, image/png ou image/webp)' }, { status: 400 })
  }

  // Estimativa rápida do tamanho (base64 ≈ 4/3 do binary)
  const estimatedBytes = (photoBase64.length * 3) / 4
  if (estimatedBytes > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: 'Foto muito grande (máx 8MB)' }, { status: 400 })
  }

  // 1. Cria registro inicial em status 'preview'
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const { data: stickerRow, error: insertErr } = await admin
    .from('generated_stickers')
    .insert({
      user_id: user.id,
      status: 'preview',
      variant: 'copa2026',
      expires_at: expiresAt,
    })
    .select('id')
    .single()
  if (insertErr || !stickerRow) {
    console.error('[generated-stickers/create] insert err:', insertErr)
    return NextResponse.json({ error: 'Erro ao registrar figurinha' }, { status: 500 })
  }
  const stickerId = (stickerRow as { id: number }).id

  // 2. Gera via Gemini Imagen
  const result = await generateSticker({
    photoBase64,
    photoMimeType,
    personName,
    variant: 'copa2026',
  })

  if (!result.ok) {
    await admin.from('generated_stickers').update({ status: 'expired' }).eq('id', stickerId)
    return NextResponse.json({ error: 'Geração falhou: ' + result.error }, { status: 500 })
  }

  // 3. Aplica marca d'água
  const wmBuffer = await applyPreviewWatermark(result.pngBase64)

  // 4. Upload preview-wm pro Storage
  const wmPath = `${user.id}/${stickerId}/preview-wm.png`
  const { error: uploadWmErr } = await admin.storage
    .from('generated-stickers')
    .upload(wmPath, wmBuffer, { contentType: 'image/png', upsert: true })
  if (uploadWmErr) {
    console.error('[generated-stickers/create] upload WM err:', uploadWmErr)
    return NextResponse.json({ error: 'Erro ao salvar preview' }, { status: 500 })
  }

  // 5. Upload imagem limpa (pra ficar disponível pro checkout depois)
  const cleanPath = `${user.id}/${stickerId}/clean.png`
  const cleanBuffer = Buffer.from(result.pngBase64, 'base64')
  const { error: uploadCleanErr } = await admin.storage
    .from('generated-stickers')
    .upload(cleanPath, cleanBuffer, { contentType: 'image/png', upsert: true })
  if (uploadCleanErr) {
    console.error('[generated-stickers/create] upload clean err:', uploadCleanErr)
    // Continua mesmo assim — preview WM tá no ar
  }

  // 6. URL pública do preview WM
  const { data: wmUrlData } = admin.storage.from('generated-stickers').getPublicUrl(wmPath)
  const watermarkedUrl = wmUrlData?.publicUrl

  // 7. Atualiza registro
  await admin
    .from('generated_stickers')
    .update({
      watermarked_url: watermarkedUrl,
      clean_url: uploadCleanErr ? null : cleanPath, // path interno; libera URL signed só após pago
      prompt_used: result.promptUsed,
      generation_model: result.modelUsed,
      generation_cost_usd: result.estimatedCostUsd,
    })
    .eq('id', stickerId)

  return NextResponse.json({
    ok: true,
    stickerId,
    previewUrl: watermarkedUrl,
    expiresAt,
  })
}
