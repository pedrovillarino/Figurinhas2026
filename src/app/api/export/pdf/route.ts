// Pedro 2026-05-09: PDF de faltantes/repetidas com logo + QR de indicação.
// Acessível via web (cookie session) OU bot WhatsApp (x-admin-secret + user_id).
//
// GET /api/export/pdf?type=missing|duplicates              ← web (cookie)
// GET /api/export/pdf?type=missing&user_id=UUID            ← bot (header secret)
//
// Layout: header com logo + nome, lista agrupada por país, footer com QR
// code apontando pro link de indicação do user (/u/{ref_code}). Frase
// genérica perto do QR pra resistir a mudança de regras de pontuação.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import path from 'path'
import fs from 'fs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'   // pdfkit precisa Node runtime
export const maxDuration = 30

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br'

// Cores da brand (memória do projeto)
const COLOR_NAVY = '#0A1628'
const COLOR_GREEN = '#00C896'
const COLOR_GOLD = '#FFB800'
const COLOR_GRAY = '#374151'
const COLOR_GRAY_LIGHT = '#6B7280'

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const typeParam = url.searchParams.get('type')
  if (typeParam !== 'missing' && typeParam !== 'duplicates') {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 })
  }
  const type = typeParam as 'missing' | 'duplicates'

  // Auth: aceita 3 caminhos
  //   1) x-admin-secret: header (chamadas admin manuais)
  //   2) Authorization: Bearer ${CRON_SECRET} (chamadas server-side
  //      internas — bot WhatsApp usa isso)
  //   3) Cookie session (usuário logado no site)
  // Se for via secret (1 ou 2), é OBRIGATÓRIO passar ?user_id=
  let userId: string | null = null
  const adminSecret = req.headers.get('x-admin-secret')
  const authHeader = req.headers.get('authorization')
  const validAdmin = !!(adminSecret && process.env.ADMIN_SECRET && adminSecret === process.env.ADMIN_SECRET)
  const validCron = !!(authHeader && process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`)
  if (validAdmin || validCron) {
    userId = url.searchParams.get('user_id')
    if (!userId) {
      return NextResponse.json({ error: 'user_id required when using secret auth' }, { status: 400 })
    }
  } else {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    userId = user.id
  }

  const admin = getAdmin()

  // 1) Profile (display_name + ref_code)
  const { data: profile } = await admin
    .from('profiles')
    .select('display_name, referral_code')
    .eq('id', userId)
    .single()
  if (!profile) {
    return NextResponse.json({ error: 'user not found' }, { status: 404 })
  }
  const displayName = (profile.display_name as string | null) || 'Colecionador'
  const firstName = displayName.split(' ')[0] || displayName
  const refCode = (profile.referral_code as string | null) || null

  // 2) Stickers + user_stickers (pra calcular missing/duplicates)
  const [{ data: allStickers }, { data: userStickers }] = await Promise.all([
    admin.from('stickers').select('id, number, player_name, country, section, type').eq('counts_for_completion', true),
    admin.from('user_stickers').select('sticker_id, status, quantity').eq('user_id', userId),
  ])
  const userMap = new Map<number, { status: string; quantity: number }>()
  ;(userStickers || []).forEach((us) => userMap.set((us as { sticker_id: number }).sticker_id, us as { status: string; quantity: number }))

  type Sticker = { id: number; number: string; player_name: string | null; country: string; section: string; type: string }
  const list: Sticker[] = ((allStickers || []) as Sticker[]).filter((s) => {
    const us = userMap.get(s.id)
    if (type === 'missing') return !us || us.status === 'missing' || us.quantity === 0
    return us?.status === 'duplicate'
  })

  // 3) QR code (data URL → PNG buffer pra embedar no PDF)
  const qrUrl = refCode ? `${APP_URL}/u/${refCode}` : `${APP_URL}/register`
  const qrBuffer = await QRCode.toBuffer(qrUrl, {
    width: 220,
    margin: 1,
    color: { dark: COLOR_NAVY, light: '#FFFFFF' },
  })

  // 4) Logo PNG (icon-192 é o que temos no /public)
  const iconPath = path.join(process.cwd(), 'public', 'icon-192.png')
  const hasIcon = fs.existsSync(iconPath)

  // 5) Gera PDF — paisagem (A4 landscape) com checkboxes pra marcar
  // Pedro 2026-05-09: paisagem cabe 4 colunas (mais itens por página) e
  // checkboxes permitem usar o PDF impresso como controle físico de troca.
  const doc = new PDFDocument({
    margin: 36,
    size: 'A4',
    layout: 'landscape',
    info: { Title: 'Complete Aí', Author: 'Complete Aí' },
  })
  const chunks: Buffer[] = []
  doc.on('data', (c) => chunks.push(c))
  const endPromise = new Promise<void>((resolve) => doc.on('end', resolve))

  // A4 landscape: 842 × 595 pontos. Margem 36 → área útil 770 × 523.
  const PAGE_WIDTH = 842
  const PAGE_HEIGHT = 595
  const MARGIN = 36
  const HEADER_BOTTOM = 90       // y onde acaba o header (linha separadora)
  const TITLE_BOTTOM = 130       // y onde acaba o bloco do título
  const FOOTER_TOP = 480         // y onde começa a faixa de footer (QR)
  const CONTENT_TOP = TITLE_BOTTOM + 8

  // ── Header ──
  if (hasIcon) {
    doc.image(iconPath, MARGIN, 38, { width: 36 })
  }
  doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(22).text('Complete', MARGIN + 50, 42, { continued: true })
  doc.fillColor(COLOR_GREEN).text(' Aí', { continued: false })
  doc.fillColor(COLOR_GRAY_LIGHT).font('Helvetica').fontSize(9).text('Álbum FIFA World Cup 2026 com IA', MARGIN + 50, 70)

  // Linha separadora
  doc.moveTo(MARGIN, HEADER_BOTTOM).lineTo(PAGE_WIDTH - MARGIN, HEADER_BOTTOM)
    .strokeColor('#E5E7EB').lineWidth(1).stroke()

  // ── Título ──
  doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(18)
    .text(type === 'missing' ? `Suas faltantes (${list.length})` : `Suas repetidas (${list.length})`, MARGIN, HEADER_BOTTOM + 10)
  doc.font('Helvetica').fontSize(10).fillColor(COLOR_GRAY_LIGHT)
    .text(
      `${firstName} · gerado em ${new Date().toLocaleDateString('pt-BR')} · ` +
      `marque ☑ conforme ${type === 'missing' ? 'colar' : 'trocar'}`,
      MARGIN,
      HEADER_BOTTOM + 32,
    )

  if (list.length === 0) {
    doc.fontSize(12).fillColor(COLOR_GRAY)
      .text(type === 'missing'
        ? '🎉 Você não tem nenhuma figurinha faltando! Parabéns!'
        : 'Você ainda não tem nenhuma figurinha repetida pra trocar.',
        MARGIN, CONTENT_TOP,
      )
  } else {
    // Agrupa por país (ordem alfabética)
    const groups: Record<string, Sticker[]> = {}
    for (const s of list) {
      const key = s.country || s.section || 'Outros'
      if (!groups[key]) groups[key] = []
      groups[key].push(s)
    }
    const sortedKeys = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'pt-BR'))

    // ── Layout em 4 colunas (paisagem cabe bem) ──
    const NUM_COLS = 4
    const COL_GAP = 12
    const COL_WIDTH = (PAGE_WIDTH - 2 * MARGIN - (NUM_COLS - 1) * COL_GAP) / NUM_COLS  // ~187pt
    const ROW_HEIGHT = 11      // altura por item
    const COUNTRY_HEADER_HEIGHT = 16
    const COUNTRY_BOTTOM_PAD = 4
    const CHECKBOX_SIZE = 8
    const CHECKBOX_PAD_Y = 1.5

    const colX = (i: number) => MARGIN + i * (COL_WIDTH + COL_GAP)

    let curCol = 0
    let curY = CONTENT_TOP
    // Footer só aparece na ÚLTIMA página — primeiras páginas usam até PAGE_HEIGHT - MARGIN
    // Reservamos FOOTER_TOP só na última (decidimos em runtime).
    const COL_BOTTOM_NORMAL = PAGE_HEIGHT - MARGIN - 10

    const nextColumnOrPage = () => {
      curCol++
      if (curCol >= NUM_COLS) {
        doc.addPage()
        curCol = 0
        curY = MARGIN
      } else {
        curY = CONTENT_TOP
      }
    }

    const ensureSpace = (neededHeight: number) => {
      if (curY + neededHeight > COL_BOTTOM_NORMAL) {
        nextColumnOrPage()
      }
    }

    for (const country of sortedKeys) {
      const items = groups[country].sort((a, b) => {
        const numA = parseInt(a.number.split('-')[1] || '0', 10)
        const numB = parseInt(b.number.split('-')[1] || '0', 10)
        return numA - numB
      })

      // Tenta manter o header do país junto com pelo menos 3 itens (evita
      // header órfão no fim da coluna)
      ensureSpace(COUNTRY_HEADER_HEIGHT + Math.min(3, items.length) * ROW_HEIGHT)

      // Header do país
      doc.fillColor(COLOR_GREEN).font('Helvetica-Bold').fontSize(10)
        .text(`${country.toUpperCase()}  (${items.length})`, colX(curCol), curY, { width: COL_WIDTH, lineBreak: false })
      curY += COUNTRY_HEADER_HEIGHT

      // Itens
      doc.font('Helvetica').fontSize(8).fillColor(COLOR_GRAY)
      for (const s of items) {
        ensureSpace(ROW_HEIGHT)
        // Checkbox quadradinho
        const x = colX(curCol)
        doc.lineWidth(0.7).strokeColor('#9CA3AF')
          .rect(x, curY + CHECKBOX_PAD_Y, CHECKBOX_SIZE, CHECKBOX_SIZE).stroke()
        // Número + nome (truncar se ultrapassar largura)
        const name = s.player_name || ''
        const qty = type === 'duplicates' ? userMap.get(s.id)?.quantity : null
        const qtyTail = qty && qty > 1 ? `  ×${qty}` : ''
        doc.fillColor(COLOR_GRAY).font('Helvetica').fontSize(8)
          .text(`${s.number}  ${name}${qtyTail}`, x + CHECKBOX_SIZE + 4, curY, {
            width: COL_WIDTH - CHECKBOX_SIZE - 4,
            lineBreak: false,
            ellipsis: true,
          })
        curY += ROW_HEIGHT
      }

      curY += COUNTRY_BOTTOM_PAD
    }
  }

  // ── Footer com QR (sempre na última página, paisagem) ──
  // A4 landscape = 595 altura. Footer ocupa últimos ~95pt.
  // Se conteúdo já chegou perto, addPage pra manter footer limpo.
  doc.addPage()
  const FOOTER_Y = PAGE_HEIGHT - MARGIN - 95
  const FOOTER_HEIGHT = 95
  const FOOTER_LEFT = MARGIN
  const FOOTER_RIGHT = PAGE_WIDTH - MARGIN

  // Faixa de fundo claro
  doc.rect(FOOTER_LEFT, FOOTER_Y, FOOTER_RIGHT - FOOTER_LEFT, FOOTER_HEIGHT)
    .fillColor('#F3F4F6').fill()

  // QR à direita (90pt) + texto à esquerda
  const QR_SIZE = 78
  const QR_X = FOOTER_RIGHT - QR_SIZE - 20
  const QR_Y = FOOTER_Y + (FOOTER_HEIGHT - QR_SIZE) / 2
  doc.image(qrBuffer, QR_X, QR_Y, { width: QR_SIZE, height: QR_SIZE })

  // Texto à esquerda do QR
  const TEXT_X = FOOTER_LEFT + 24
  const TEXT_W = QR_X - TEXT_X - 16
  doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(13)
    .text('Use IA pra escanear seu álbum', TEXT_X, FOOTER_Y + 14, { width: TEXT_W })
  doc.fillColor(COLOR_GRAY).font('Helvetica').fontSize(10)
    .text('e descobrir trocas perto de você. Grátis pra começar.', TEXT_X, FOOTER_Y + 32, { width: TEXT_W })
  doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(12)
    .text('Indique este QR code com amigos', TEXT_X, FOOTER_Y + 56, { width: TEXT_W, continued: true })
  doc.fillColor(COLOR_GREEN).text(' e ganhe benefícios.', { continued: false })
  doc.fillColor(COLOR_GRAY_LIGHT).font('Helvetica').fontSize(9)
    .text('completeai.com.br', TEXT_X, FOOTER_Y + 78, { width: TEXT_W })

  doc.end()
  await endPromise

  const buffer = Buffer.concat(chunks)
  const filename = `complete-ai-${type === 'missing' ? 'faltantes' : 'repetidas'}-${new Date().toISOString().slice(0, 10)}.pdf`

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
