/**
 * POST /api/generated-stickers/checkout
 *
 * Body: { stickerId: number, withPrintPdf?: boolean }
 *
 * Cria sessão Stripe pra liberar a versão limpa da figurinha gerada.
 * Se user tem cota disponível no plano, libera direto sem cobrar.
 *
 * Pedro 2026-05-04: Fase 1 MVP.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import {
  GENERATED_STICKER_PRICING,
  GENERATED_STICKER_QUOTA,
  type Tier,
} from '@/lib/tiers'

export const dynamic = 'force-dynamic'

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-03-25.dahlia',
  })
}

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  let body: { stickerId?: number; withPrintPdf?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const stickerId = Number(body.stickerId)
  const withPrintPdf = !!body.withPrintPdf

  if (!Number.isFinite(stickerId) || stickerId <= 0) {
    return NextResponse.json({ error: 'stickerId inválido' }, { status: 400 })
  }

  const admin = getAdmin()

  // 1. Carrega sticker + checa propriedade + status
  const { data: stickerRow } = await admin
    .from('generated_stickers')
    .select('id, user_id, status, watermarked_url, clean_url, paid_amount_brl')
    .eq('id', stickerId)
    .single()

  if (!stickerRow || stickerRow.user_id !== user.id) {
    return NextResponse.json({ error: 'Figurinha não encontrada' }, { status: 404 })
  }
  if (stickerRow.status === 'paid') {
    return NextResponse.json({ error: 'Figurinha já liberada' }, { status: 400 })
  }
  if (!stickerRow.clean_url) {
    return NextResponse.json({ error: 'Imagem ainda não pronta — tenta gerar de novo' }, { status: 400 })
  }

  // 2. Pega tier do user + checa cota
  const { data: profile } = await admin
    .from('profiles')
    .select('tier, email, generated_stickers_used')
    .eq('id', user.id)
    .single()

  const tier = ((profile?.tier as Tier) || 'free') as Tier
  const quotaLimit = GENERATED_STICKER_QUOTA[tier] || 0
  const used = profile?.generated_stickers_used || 0
  const hasQuotaLeft = used < quotaLimit

  // Cota só libera digital, não inclui PDF print. Se quer PDF, paga add-on.
  if (hasQuotaLeft && !withPrintPdf) {
    // Libera direto via cota — sem Stripe
    await admin
      .from('generated_stickers')
      .update({
        status: 'paid',
        paid_amount_brl: 0,
        paid_with_quota: true,
        paid_at: new Date().toISOString(),
      })
      .eq('id', stickerId)

    await admin
      .from('profiles')
      .update({ generated_stickers_used: used + 1 })
      .eq('id', user.id)

    // Gera signed URL com TTL longo (24h)
    const { data: signed } = await admin.storage
      .from('generated-stickers')
      .createSignedUrl(stickerRow.clean_url as string, 60 * 60 * 24)

    return NextResponse.json({
      ok: true,
      kind: 'quota',
      cleanUrl: signed?.signedUrl,
    })
  }

  // 3. Stripe checkout — sem cota OU quer PDF impressão
  const pricing = GENERATED_STICKER_PRICING[tier]
  const choice = withPrintPdf ? pricing.withPrintPdf : pricing.digital
  const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br'

  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: profile?.email || user.email,
    line_items: [
      {
        price_data: {
          currency: 'brl',
          unit_amount: choice.priceBrl,
          product_data: {
            name: withPrintPdf
              ? 'Complete Aí — Figurinha digital + PDF impressão'
              : 'Complete Aí — Figurinha digital',
            description: withPrintPdf
              ? 'Imagem alta resolução + PDF formato Panini (5,7×7,6cm com sangria) pronto pra gráfica'
              : 'Imagem alta resolução da sua figurinha personalizada estilo Copa 2026',
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      user_id: user.id,
      type: 'generated_sticker',
      sticker_id: String(stickerId),
      with_print_pdf: withPrintPdf ? '1' : '0',
    },
    success_url: `${origin}/criar-figurinha?paid=${stickerId}`,
    cancel_url: `${origin}/criar-figurinha?cancelled=${stickerId}`,
  })

  // Marca o session_id pra reconciliação no webhook
  await admin
    .from('generated_stickers')
    .update({ stripe_session_id: session.id })
    .eq('id', stickerId)

  return NextResponse.json({ ok: true, kind: 'stripe', url: session.url })
}
