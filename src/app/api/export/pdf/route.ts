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

  // Pedro 2026-05-09: view=compact gera lista enxuta só com faltantes
  // (sem tabelão, otimizado pra caber em 1 página quando possível). Só
  // faz sentido pra type='missing'. Se vier compact + duplicates, ignora.
  const viewParam = url.searchParams.get('view')
  const view: 'full' | 'compact' = (viewParam === 'compact' && type === 'missing') ? 'compact' : 'full'

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
  // Pedro 2026-05-09 (bug 237 vs 315): supabase REST com .or() em produção
  // estava retornando lista incompleta (Vercel issue?). Adicionado .range
  // explícito + log do count pra detectar.
  const [{ data: allStickers, error: allErr }, { data: userStickers, error: userErr }] = await Promise.all([
    admin.from('stickers')
      .select('id, number, player_name, country, section, type, variant')
      .or('counts_for_completion.eq.true,section.eq.Coca-Cola')
      .range(0, 1999),
    admin.from('user_stickers')
      .select('sticker_id, status, quantity')
      .eq('user_id', userId)
      .range(0, 1999),
  ])
  if (allErr) console.error(`[pdf-export] stickers query error:`, allErr.message)
  if (userErr) console.error(`[pdf-export] user_stickers query error:`, userErr.message)

  const userMap = new Map<number, { status: string; quantity: number }>()
  ;(userStickers || []).forEach((us) => userMap.set((us as { sticker_id: number }).sticker_id, us as { status: string; quantity: number }))

  type Sticker = { id: number; number: string; player_name: string | null; country: string; section: string; type: string; variant: string | null }
  const allList: Sticker[] = (allStickers || []) as Sticker[]

  // Conta stats pra exibir no título — usa count exato direto do DB pra
  // evitar dependência de paginação implícita do REST.
  const { count: countOwnedExact } = await admin
    .from('user_stickers')
    .select('sticker_id, stickers!inner(counts_for_completion,section)', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('status', ['owned', 'duplicate'])
    .or('counts_for_completion.eq.true,section.eq.Coca-Cola', { foreignTable: 'stickers' })
  const { count: countDuplicatesExact } = await admin
    .from('user_stickers')
    .select('sticker_id, stickers!inner(counts_for_completion,section)', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'duplicate')
    .or('counts_for_completion.eq.true,section.eq.Coca-Cola', { foreignTable: 'stickers' })
  const countOwned = countOwnedExact ?? 0
  const countDuplicates = countDuplicatesExact ?? 0
  console.log(
    `[pdf-export] user=${userId} type=${type} view=${view} ` +
    `allStickers=${allList.length} userStickers=${userStickers?.length ?? 0} ` +
    `countOwned=${countOwned} countDuplicates=${countDuplicates}`,
  )

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
  const HEADER_H = 60            // header único compacto (texto AO LADO do QR)
  const HEADER_BOTTOM = MARGIN + HEADER_H
  const CONTENT_TOP = HEADER_BOTTOM + 6

  // ── Título / subtítulo ──
  // Pedro 2026-05-09: layout matriz — TODAS figurinhas em grid de 20 colunas,
  // 1 linha por seção. Marcadas as que o user já tem.
  // Modo 'missing': marca verde = tem (vazias = falta colar)
  // Modo 'duplicates': marca âmbar = tem repetida (vazias = não pode trocar)
  const titleStr = type === 'missing'
    ? `Seu álbum: ${countOwned}/${allList.length}`
    : `Suas repetidas: ${countDuplicates}`
  const subtitleStr = type === 'missing'
    ? `${firstName} · ${new Date().toLocaleDateString('pt-BR')} · em verde = já tem · vazio = falta colar`
    : `${firstName} · ${new Date().toLocaleDateString('pt-BR')} · em âmbar = você tem repetida pra trocar`

  // ── Page header (logo + título + QR) — repetido em TODAS as páginas ──
  // Pedro 2026-05-09: economiza espaço (footer separado some). QR em
  // toda página → user pode imprimir qualquer página solta e ainda ter
  // o link de indicação visível.
  const drawPageHeader = () => {
    const yTop = MARGIN
    // Logo + nome
    if (hasIcon) {
      doc.image(iconPath, MARGIN, yTop, { width: 30 })
    }
    doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(16)
      .text('Complete', MARGIN + 38, yTop + 4, { continued: true })
    doc.fillColor(COLOR_GREEN).text(' Aí', { continued: false })
    doc.fillColor(COLOR_GRAY_LIGHT).font('Helvetica').fontSize(7)
      .text('Álbum FIFA WC 2026 com IA', MARGIN + 38, yTop + 26)

    // Título imediatamente após o logo (sem centralizar — evita colisão
    // com o bloco texto+QR à direita)
    const titleX = MARGIN + 220
    const titleW = 360
    doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(14)
      .text(titleStr, titleX, yTop + 8, { width: titleW, lineBreak: false })
    doc.fillColor(COLOR_GRAY_LIGHT).font('Helvetica').fontSize(8)
      .text(subtitleStr, titleX, yTop + 30, { width: titleW, lineBreak: false })

    // QR à direita + texto AO LADO (à esquerda do QR) — Pedro 2026-05-09
    // QR no canto direito; texto wrappa numa coluna à esquerda dele.
    const qrSize = 56
    const qrX = PAGE_WIDTH - MARGIN - qrSize
    doc.image(qrBuffer, qrX, yTop, { width: qrSize, height: qrSize })
    // Texto à esquerda do QR (largura ~150pt, alinhado à direita pra ficar
    // colado no QR). Domínio em cima + chamada embaixo.
    const textW = 150
    const textX = qrX - textW - 6
    doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(8)
      .text('completeai.com.br', textX, yTop + 6, { width: textW, align: 'right', lineBreak: false })
    doc.fillColor(COLOR_GRAY_LIGHT).font('Helvetica').fontSize(7)
      .text('Indique através desse QR code seus amigos e ganhe benefícios!',
        textX, yTop + 22, { width: textW, align: 'right' })

    // Linha separadora
    doc.moveTo(MARGIN, HEADER_BOTTOM).lineTo(PAGE_WIDTH - MARGIN, HEADER_BOTTOM)
      .strokeColor('#E5E7EB').lineWidth(0.8).stroke()
  }

  drawPageHeader()

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

  // ── MODO COMPACT — só faltantes em lista densa (Pedro 2026-05-09) ──
  // Otimizado pra caber em poucas páginas. Cada seção: header + lista
  // corrida dos números faltantes. Em 4 colunas de texto.
  if (view === 'compact') {
    const NUM_COLS_TEXT = 4
    const COL_GAP_TEXT = 16
    const COL_W_TEXT = (PAGE_WIDTH - 2 * MARGIN - (NUM_COLS_TEXT - 1) * COL_GAP_TEXT) / NUM_COLS_TEXT
    const colXText = (i: number) => MARGIN + i * (COL_W_TEXT + COL_GAP_TEXT)
    const PAGE_BOTTOM_TXT = PAGE_HEIGHT - MARGIN - 8

    let curCol = 0
    let curY = HEADER_BOTTOM + 8

    const ensureCompactSpace = (h: number) => {
      if (curY + h > PAGE_BOTTOM_TXT) {
        curCol++
        if (curCol >= NUM_COLS_TEXT) {
          doc.addPage()
          drawPageHeader()
          curCol = 0
          curY = HEADER_BOTTOM + 8
        } else {
          curY = HEADER_BOTTOM + 8
        }
      }
    }

    let totalMissing = 0
    for (const sectionKey of sortedKeys) {
      const items = groups[sectionKey]
        .filter((s) => {
          const us = userMap.get(s.id)
          return !us || us.status === 'missing' || us.quantity === 0
        })
        .sort((a, b) => {
          const numA = parseInt(a.number.split('-')[1] || '0', 10)
          const numB = parseInt(b.number.split('-')[1] || '0', 10)
          return numA - numB
        })

      if (items.length === 0) continue
      totalMissing += items.length

      const x = colXText(curCol)
      // Header da seção
      ensureCompactSpace(14)
      doc.fillColor(COLOR_GREEN).font('Helvetica-Bold').fontSize(9)
        .text(`${sectionKey.toUpperCase()} (${items.length})`, x, curY, { width: COL_W_TEXT, lineBreak: false })
      curY += 12

      // Lista corrida de números, quebrando em múltiplas linhas se preciso
      doc.fillColor(COLOR_GRAY).font('Helvetica').fontSize(9)
      const numbersStr = items.map((s) => s.number.split('-')[1] || s.number).join('  ')
      // Calcula altura textual
      const heightOfNumbers = doc.heightOfString(numbersStr, { width: COL_W_TEXT })
      ensureCompactSpace(heightOfNumbers)
      doc.text(numbersStr, x, curY, { width: COL_W_TEXT })
      curY = doc.y + 8
    }

    // Se não há nada faltando
    if (totalMissing === 0) {
      doc.fillColor(COLOR_GRAY).font('Helvetica').fontSize(14)
        .text('🎉 Você não tem nenhuma figurinha faltando! Parabéns!', MARGIN, HEADER_BOTTOM + 30, { align: 'center', width: PAGE_WIDTH - 2 * MARGIN })
    }

    doc.end()
    await endPromise
    const buffer = Buffer.concat(chunks)
    const filename = `complete-ai-faltantes-compact-${new Date().toISOString().slice(0, 10)}.pdf`
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  }

  // ── TABELÃO ──
  // Pedro 2026-05-09: estilo planilha clássica — cabeçalho numerado,
  // bordas sólidas em todas as células, zebra striping nas seções.
  // 20 colunas casa exato com países (20 cromos) e FIFA WC (20).
  // Coca-Cola (14 cromos) ocupa as primeiras 14 + 6 paddings cinza.
  const NUM_COLS = 20
  const SECTION_NAME_W = 100
  const TABLE_W = PAGE_WIDTH - 2 * MARGIN
  const GRID_W = TABLE_W - SECTION_NAME_W
  const CELL_W = GRID_W / NUM_COLS  // ~34pt em landscape
  const CELL_H = 18
  const TABLE_HEADER_H = 16

  let curY = CONTENT_TOP
  const PAGE_BOTTOM = PAGE_HEIGHT - MARGIN - 12

  const cellX = (col: number) => MARGIN + SECTION_NAME_W + col * CELL_W

  // Cabeçalho da tabela (1, 2, 3... 13)
  const drawTableHeader = (y: number) => {
    // Fundo escuro
    doc.rect(MARGIN, y, TABLE_W, TABLE_HEADER_H).fillColor(COLOR_NAVY).fill()
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
      // Número
      doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(8)
        .text(label, x, y + 6, { width: CELL_W, align: 'center', lineBreak: false })
      // X riscando (Pedro 2026-05-09): além da cor, X em cima reforça
      // visualmente "já tem". Cor mais escura que o fill pra contraste.
      const xColor = type === 'missing' ? '#047857' : '#B45309'  // verde escuro / âmbar escuro
      doc.lineWidth(1).strokeColor(xColor)
        .moveTo(x + 3, y + 3).lineTo(x + CELL_W - 3, y + CELL_H - 3).stroke()
        .moveTo(x + CELL_W - 3, y + 3).lineTo(x + 3, y + CELL_H - 3).stroke()
    } else {
      doc.fillColor('#6B7280').font('Helvetica').fontSize(8)
        .text(label, x, y + 6, { width: CELL_W, align: 'center', lineBreak: false })
    }
  }

  // Render header da primeira página
  drawTableHeader(curY)
  curY += TABLE_HEADER_H

  let zebra = false  // alterna fundo da célula de nome de seção

  for (const sectionKey of sortedKeys) {
    const items = groups[sectionKey].sort((a, b) => {
      const numA = parseInt(a.number.split('-')[1] || '0', 10)
      const numB = parseInt(b.number.split('-')[1] || '0', 10)
      return numA - numB
    })

    const numRows = Math.ceil(items.length / NUM_COLS)
    const sectionHeight = numRows * CELL_H

    // Quebra de página: se não cabe seção inteira + page header + table header, vai pra próxima
    if (curY + sectionHeight > PAGE_BOTTOM) {
      doc.addPage()
      drawPageHeader()
      curY = CONTENT_TOP
      drawTableHeader(curY)
      curY += TABLE_HEADER_H
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

  // Pedro 2026-05-09: footer dedicado removido — QR de indicação agora
  // aparece no header de TODAS as páginas (drawPageHeader). Economiza
  // 1 página inteira e cada folha impressa fica auto-suficiente.

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
