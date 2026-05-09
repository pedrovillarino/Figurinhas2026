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

  // 2) Stickers + user_stickers — TUDO (counts_for_completion=true) + Coca-Cola.
  // Pedro 2026-05-09: PANINI Extras (variant=gold/silver/bronze/regular) NÃO
  // entra no PDF. Mas Coca-Cola entra (linha própria).
  const [{ data: allStickers }, { data: userStickers }] = await Promise.all([
    admin.from('stickers')
      .select('id, number, player_name, country, section, type, variant')
      .or('counts_for_completion.eq.true,section.eq.Coca-Cola'),
    admin.from('user_stickers').select('sticker_id, status, quantity').eq('user_id', userId),
  ])
  const userMap = new Map<number, { status: string; quantity: number }>()
  ;(userStickers || []).forEach((us) => userMap.set((us as { sticker_id: number }).sticker_id, us as { status: string; quantity: number }))

  type Sticker = { id: number; number: string; player_name: string | null; country: string; section: string; type: string; variant: string | null }
  const allList: Sticker[] = (allStickers || []) as Sticker[]

  // Conta stats pra exibir no título (info pro user)
  const countOwned = allList.filter((s) => {
    const us = userMap.get(s.id)
    return us && (us.status === 'owned' || us.status === 'duplicate')
  }).length
  const countDuplicates = allList.filter((s) => {
    const us = userMap.get(s.id)
    return us && us.status === 'duplicate'
  }).length

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
  // Pedro 2026-05-09: paisagem cabe 6 colunas (densidade alta pra menos
  // páginas impressas) e checkboxes permitem usar como checklist físico.
  const doc = new PDFDocument({
    margin: 24,
    size: 'A4',
    layout: 'landscape',
    info: { Title: 'Complete Aí', Author: 'Complete Aí' },
  })
  const chunks: Buffer[] = []
  doc.on('data', (c) => chunks.push(c))
  const endPromise = new Promise<void>((resolve) => doc.on('end', resolve))

  // A4 landscape: 842 × 595 pontos. Margem 24 → área útil 794 × 547.
  const PAGE_WIDTH = 842
  const PAGE_HEIGHT = 595
  const MARGIN = 24
  const HEADER_BOTTOM = 78       // y onde acaba o header
  const TITLE_BOTTOM = 112       // y onde acaba o bloco do título
  const CONTENT_TOP = TITLE_BOTTOM + 6

  // ── Header ──
  if (hasIcon) {
    doc.image(iconPath, MARGIN, 28, { width: 30 })
  }
  doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(18).text('Complete', MARGIN + 40, 32, { continued: true })
  doc.fillColor(COLOR_GREEN).text(' Aí', { continued: false })
  doc.fillColor(COLOR_GRAY_LIGHT).font('Helvetica').fontSize(8).text('Álbum FIFA World Cup 2026 com IA', MARGIN + 40, 56)

  // Linha separadora
  doc.moveTo(MARGIN, HEADER_BOTTOM).lineTo(PAGE_WIDTH - MARGIN, HEADER_BOTTOM)
    .strokeColor('#E5E7EB').lineWidth(1).stroke()

  // ── Título ──
  // Pedro 2026-05-09: layout matriz — TODAS figurinhas em grid de 13 colunas,
  // 1+ linhas por seção. Marcadas as que o user já tem.
  // Modo 'missing': marca verde = tem (vazias = falta colar)
  // Modo 'duplicates': marca âmbar = tem repetida (vazias = não pode trocar)
  const titleStr = type === 'missing'
    ? `Seu álbum: ${countOwned}/${allList.length}`
    : `Suas repetidas: ${countDuplicates}`
  const subtitleStr = type === 'missing'
    ? `${firstName} · ${new Date().toLocaleDateString('pt-BR')} · em verde = já tem · vazio = falta colar`
    : `${firstName} · ${new Date().toLocaleDateString('pt-BR')} · em âmbar = você tem repetida pra trocar`
  doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(15)
    .text(titleStr, MARGIN, HEADER_BOTTOM + 6)
  doc.font('Helvetica').fontSize(9).fillColor(COLOR_GRAY_LIGHT)
    .text(subtitleStr, MARGIN, HEADER_BOTTOM + 26)

  // ── Layout matriz: 13 colunas fixas, linha = seção ──
  // Sem PANINI Extras (Pedro 2026-05-09).
  // Filtra: só counts_for_completion + Coca-Cola (variant=null), exclui Extras.
  // PANINI Extras tem variant != null (gold/silver/bronze/regular).
  const filteredForGrid = allList.filter((s) => s.section !== 'PANINI Extras' && s.variant === null)

  // Agrupa por seção (country pra times, section pra Coca-Cola/FIFA WC)
  const groups: Record<string, Sticker[]> = {}
  for (const s of filteredForGrid) {
    // Usa section pra Coca-Cola e FIFA WC, country pros times
    const key = (s.section === 'Coca-Cola' || s.section === 'FIFA World Cup')
      ? s.section
      : (s.country || s.section || 'Outros')
    if (!groups[key]) groups[key] = []
    groups[key].push(s)
  }
  // Ordem: países alfabéticos primeiro, depois FIFA WC, depois Coca-Cola
  const countryKeys = Object.keys(groups).filter((k) => k !== 'Coca-Cola' && k !== 'FIFA World Cup').sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const specialKeys = ['FIFA World Cup', 'Coca-Cola'].filter((k) => groups[k])
  const sortedKeys = [...countryKeys, ...specialKeys]

  // ── TABELÃO ──
  // Pedro 2026-05-09: estilo planilha clássica — cabeçalho numerado,
  // bordas sólidas em todas as células, zebra striping nas seções com
  // múltiplas fileiras.
  const NUM_COLS = 13
  const SECTION_NAME_W = 105
  const TABLE_W = PAGE_WIDTH - 2 * MARGIN
  const GRID_W = TABLE_W - SECTION_NAME_W
  const CELL_W = GRID_W / NUM_COLS  // sem gap = ~52pt
  const CELL_H = 18
  const HEADER_H = 16

  let curY = CONTENT_TOP
  const PAGE_BOTTOM = PAGE_HEIGHT - MARGIN - 12

  const cellX = (col: number) => MARGIN + SECTION_NAME_W + col * CELL_W

  // Cabeçalho da tabela (1, 2, 3... 13)
  const drawTableHeader = (y: number) => {
    // Fundo escuro
    doc.rect(MARGIN, y, TABLE_W, HEADER_H).fillColor(COLOR_NAVY).fill()
    // "Seção" à esquerda
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8)
      .text('SEÇÃO', MARGIN + 6, y + 5, { width: SECTION_NAME_W - 10, lineBreak: false })
    // Números 1-13
    for (let c = 0; c < NUM_COLS; c++) {
      const x = cellX(c)
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8)
        .text(String(c + 1), x, y + 5, { width: CELL_W, align: 'center', lineBreak: false })
    }
    // Bordas verticais brancas no header (separa colunas)
    doc.strokeColor('#FFFFFF').lineWidth(0.4)
    for (let c = 1; c <= NUM_COLS; c++) {
      const x = cellX(c - 1) + (c === NUM_COLS ? 0 : 0)
      // skip — bordas serão desenhadas no corpo
    }
  }

  const drawCell = (x: number, y: number, label: string, state: 'empty' | 'marked' | 'padding') => {
    // Background
    if (state === 'padding') {
      doc.rect(x, y, CELL_W, CELL_H).fillColor('#D1D5DB').fill()  // cinza médio = "não existe"
    } else if (state === 'marked') {
      const fillColor = type === 'missing' ? '#A7F3D0' : '#FCD34D'  // verde claro | âmbar claro
      doc.rect(x, y, CELL_W, CELL_H).fillColor(fillColor).fill()
    } else {
      doc.rect(x, y, CELL_W, CELL_H).fillColor('#FFFFFF').fill()
    }
    // Borda
    doc.lineWidth(0.5).strokeColor('#374151').rect(x, y, CELL_W, CELL_H).stroke()
    // Label
    if (state === 'padding') {
      // sem texto
    } else if (state === 'marked') {
      doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(8)
        .text(label, x, y + 6, { width: CELL_W, align: 'center', lineBreak: false })
    } else {
      doc.fillColor('#6B7280').font('Helvetica').fontSize(8)
        .text(label, x, y + 6, { width: CELL_W, align: 'center', lineBreak: false })
    }
  }

  // Render header da primeira página
  drawTableHeader(curY)
  curY += HEADER_H

  let zebra = false  // alterna fundo da célula de nome de seção

  for (const sectionKey of sortedKeys) {
    const items = groups[sectionKey].sort((a, b) => {
      const numA = parseInt(a.number.split('-')[1] || '0', 10)
      const numB = parseInt(b.number.split('-')[1] || '0', 10)
      return numA - numB
    })

    const numRows = Math.ceil(items.length / NUM_COLS)
    const sectionHeight = numRows * CELL_H

    // Quebra de página: se não cabe seção inteira + header novo, vai pra próxima
    if (curY + sectionHeight > PAGE_BOTTOM) {
      doc.addPage()
      curY = MARGIN
      drawTableHeader(curY)
      curY += HEADER_H
    }

    // Coluna do nome da seção (rowspan visual: ocupa todas as numRows fileiras)
    const sectionX = MARGIN
    const sectionY = curY
    const sectionH = sectionHeight
    // Background zebra
    doc.rect(sectionX, sectionY, SECTION_NAME_W, sectionH).fillColor(zebra ? '#F3F4F6' : '#E5E7EB').fill()
    doc.lineWidth(0.5).strokeColor('#374151').rect(sectionX, sectionY, SECTION_NAME_W, sectionH).stroke()
    // Texto centrado
    doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(9)
      .text(sectionKey.toUpperCase(), sectionX + 6, sectionY + sectionH / 2 - 9, {
        width: SECTION_NAME_W - 12,
        lineBreak: false,
      })
    doc.fillColor(COLOR_GRAY_LIGHT).font('Helvetica').fontSize(7)
      .text(`(${items.length})`, sectionX + 6, sectionY + sectionH / 2 + 2, {
        width: SECTION_NAME_W - 12,
        lineBreak: false,
      })
    zebra = !zebra

    // Células do grid (números 1..13 na 1ª fileira, 14..26 na 2ª, etc)
    for (let row = 0; row < numRows; row++) {
      const y = curY + row * CELL_H
      for (let col = 0; col < NUM_COLS; col++) {
        const idx = row * NUM_COLS + col
        const x = cellX(col)
        if (idx < items.length) {
          const s = items[idx]
          const us = userMap.get(s.id)
          const isOwned = !!us && (us.status === 'owned' || us.status === 'duplicate')
          const isDuplicate = !!us && us.status === 'duplicate'
          const shouldMark = type === 'missing' ? isOwned : isDuplicate
          const numPart = s.number.split('-')[1] || s.number
          drawCell(x, y, numPart, shouldMark ? 'marked' : 'empty')
        } else {
          drawCell(x, y, '', 'padding')
        }
      }
    }

    curY += sectionHeight
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
