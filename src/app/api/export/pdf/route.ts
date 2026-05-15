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

  // 2) Stickers + user_stickers
  // Pedro 2026-05-14 (alinha com o resto do app): o denominador "álbum"
  // exibido no título usa SÓ counts_for_completion=true (980). Coca-Cola
  // ainda aparece como SEÇÃO visual no tabelão (linha própria), mas não
  // entra na fração X/Y do header — assim bate com /album, /scan, /profile
  // e dashboard.
  // Pedro 2026-05-09 (bug 237 vs 315): supabase REST com .or() em produção
  // estava retornando lista incompleta (Vercel issue?). Adicionado .range
  // explícito + log do count pra detectar.
  const [{ data: allStickers, error: allErr }, { data: userStickers, error: userErr }] = await Promise.all([
    admin.from('stickers')
      .select('id, number, player_name, country, section, type, variant, display_order')
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

  type Sticker = { id: number; number: string; player_name: string | null; country: string; section: string; type: string; variant: string | null; display_order: number | null }
  const allList: Sticker[] = (allStickers || []) as Sticker[]
  // Total do álbum (denominador) = só counts_for_completion=true. Bate com
  // /album, /scan, /profile e dashboard.
  const albumTotal = allList.filter((s) => s.section !== 'Coca-Cola').length

  // Pedro 2026-05-14: contagem feita em JS sobre as listas já carregadas.
  // O .or() em foreign table do PostgREST tinha quirks que produziam
  // contagens significativamente menores (caso real: PDF mostrava ~300
  // mas álbum mostrava ~500). Como já temos allList + userMap em mem, é
  // mais robusto contar localmente.
  const albumStickerIds = new Set(
    allList.filter((s) => s.section !== 'Coca-Cola').map((s) => s.id),
  )
  // Pedro 2026-05-15: contagem alinhada com /album (AlbumClient stats):
  //   countOwned: só completable stickers (exclui Coca-Cola) → bate com X/980
  //   countDupeStickers: TODAS figurinhas distintas com status='duplicate',
  //     incluindo Coca-Cola (são moeda de troca igual a qualquer extra)
  //   countDupeExtras: total de cromos físicos extras = soma de (qty - 1)
  // Antes o PDF excluía Coca-Cola das repetidas e não somava qty — daí
  // não batia com o número que o user via no /album.
  let countOwned = 0
  let countDupeStickers = 0
  let countDupeExtras = 0
  for (const us of (userStickers || []) as Array<{ sticker_id: number; status: string; quantity: number }>) {
    if (albumStickerIds.has(us.sticker_id)) {
      if (us.status === 'owned' || us.status === 'duplicate') countOwned++
    }
    if (us.status === 'duplicate') {
      countDupeStickers++
      countDupeExtras += Math.max(0, (us.quantity ?? 1) - 1)
    }
  }
  console.log(
    `[pdf-export] user=${userId} type=${type} view=${view} ` +
    `allStickers=${allList.length} albumTotal=${albumTotal} userStickers=${userStickers?.length ?? 0} ` +
    `countOwned=${countOwned} countDupeStickers=${countDupeStickers} countDupeExtras=${countDupeExtras}`,
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

  // 5) Gera PDF
  // Pedro 2026-05-14: A4 PORTRAIT single-page no modo 'full' (tabelão).
  // Objetivo: caber 50 seções (48 países + FIFA WC + Coca-Cola) em UMA
  // folha A4 quando o user mandar imprimir. Foto do Panini control sheet
  // como referência. Modo 'compact' continua usando landscape multi-página.
  const isFullPortrait = view === 'full'
  const doc = new PDFDocument({
    margin: 18,
    size: 'A4',
    layout: isFullPortrait ? 'portrait' : 'landscape',
    info: { Title: 'Complete Aí', Author: 'Complete Aí' },
  })
  const chunks: Buffer[] = []
  doc.on('data', (c) => chunks.push(c))
  const endPromise = new Promise<void>((resolve) => doc.on('end', resolve))

  // A4 portrait: 595 × 842pt. A4 landscape: 842 × 595pt.
  const PAGE_WIDTH = isFullPortrait ? 595 : 842
  const PAGE_HEIGHT = isFullPortrait ? 842 : 595
  const MARGIN = isFullPortrait ? 18 : 24
  // Header compacto no portrait (1 linha de logo+title+QR mini)
  const HEADER_H = isFullPortrait ? 38 : 60
  const HEADER_BOTTOM = MARGIN + HEADER_H
  const CONTENT_TOP = HEADER_BOTTOM + 4

  // ── Título / subtítulo ──
  // Pedro 2026-05-09: layout matriz — TODAS figurinhas em grid de 20 colunas,
  // 1 linha por seção. Marcadas as que o user já tem.
  // Modo 'missing': marca verde = tem (vazias = falta colar)
  // Modo 'duplicates': marca âmbar = tem repetida (vazias = não pode trocar)
  const pct = albumTotal > 0 ? Math.round((countOwned / albumTotal) * 100) : 0
  // Repetidas no formato do /album: "X cromos · Y figs" (físico · distintas).
  const dupesStr = `${countDupeExtras} cromo${countDupeExtras === 1 ? '' : 's'} · ${countDupeStickers} fig${countDupeStickers === 1 ? '' : 's'}`
  const titleStr = type === 'missing'
    ? `Seu álbum: ${countOwned}/${albumTotal} (${pct}%) · repetidas: ${dupesStr}`
    : `Suas repetidas: ${dupesStr} · álbum ${countOwned}/${albumTotal} (${pct}%)`
  const subtitleStr = type === 'missing'
    ? `${firstName} · ${new Date().toLocaleDateString('pt-BR')} · verde com X = já tem · branco = falta colar`
    : `${firstName} · ${new Date().toLocaleDateString('pt-BR')} · âmbar com X = você tem repetida pra trocar`

  // ── Page header (logo + título + QR) ──
  // Compact portrait: 1 linha (38pt). Landscape antigo: 60pt com subtítulo.
  const drawPageHeader = () => {
    const yTop = MARGIN
    if (isFullPortrait) {
      // Layout enxuto pra portrait single-page
      const logoSize = 22
      if (hasIcon) doc.image(iconPath, MARGIN, yTop, { width: logoSize })
      doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(13)
        .text('Complete', MARGIN + logoSize + 6, yTop + 4, { continued: true })
      doc.fillColor(COLOR_GREEN).text(' Aí', { continued: false })

      // Título e subtítulo no meio
      const titleX = MARGIN + logoSize + 90
      doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(11)
        .text(titleStr, titleX, yTop + 4, { width: 280, lineBreak: false })
      doc.fillColor(COLOR_GRAY_LIGHT).font('Helvetica').fontSize(7)
        .text(subtitleStr, titleX, yTop + 20, { width: 280, lineBreak: false })

      // QR no canto direito, com texto pequeno à esquerda
      const qrSize = 34
      const qrX = PAGE_WIDTH - MARGIN - qrSize
      doc.image(qrBuffer, qrX, yTop, { width: qrSize, height: qrSize })
      const textW = 130
      const textX = qrX - textW - 4
      doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(7)
        .text('completeai.com.br', textX, yTop + 4, { width: textW, align: 'right', lineBreak: false })
      doc.fillColor(COLOR_GRAY_LIGHT).font('Helvetica').fontSize(6)
        .text('Indique pelo QR e ganhe benefícios!', textX, yTop + 16, { width: textW, align: 'right' })

      doc.moveTo(MARGIN, HEADER_BOTTOM).lineTo(PAGE_WIDTH - MARGIN, HEADER_BOTTOM)
        .strokeColor('#E5E7EB').lineWidth(0.6).stroke()
      return
    }

    // Landscape (modo legado, mantido pra view=compact)
    if (hasIcon) doc.image(iconPath, MARGIN, yTop, { width: 30 })
    doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(16)
      .text('Complete', MARGIN + 38, yTop + 4, { continued: true })
    doc.fillColor(COLOR_GREEN).text(' Aí', { continued: false })
    doc.fillColor(COLOR_GRAY_LIGHT).font('Helvetica').fontSize(7)
      .text('Álbum FIFA WC 2026 com IA', MARGIN + 38, yTop + 26)

    const titleX = MARGIN + 220
    const titleW = 360
    doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(14)
      .text(titleStr, titleX, yTop + 8, { width: titleW, lineBreak: false })
    doc.fillColor(COLOR_GRAY_LIGHT).font('Helvetica').fontSize(8)
      .text(subtitleStr, titleX, yTop + 30, { width: titleW, lineBreak: false })

    const qrSize = 56
    const qrX = PAGE_WIDTH - MARGIN - qrSize
    doc.image(qrBuffer, qrX, yTop, { width: qrSize, height: qrSize })
    const textW = 150
    const textX = qrX - textW - 6
    doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(8)
      .text('completeai.com.br', textX, yTop + 6, { width: textW, align: 'right', lineBreak: false })
    doc.fillColor(COLOR_GRAY_LIGHT).font('Helvetica').fontSize(7)
      .text('Indique através desse QR code seus amigos e ganhe benefícios!',
        textX, yTop + 22, { width: textW, align: 'right' })

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
  // Pedro 2026-05-14: ordem das seções segue o display_order do álbum
  // físico (mesma ordem que /album mostra): intro FWC → times em ordem de
  // grupo FIFA A-L → FIFA history → Coca-Cola. Cada seção é ordenada pelo
  // MENOR display_order dos seus itens. Fallback alfabético quando NULL.
  const sectionMinOrder: Record<string, number> = {}
  for (const [key, items] of Object.entries(groups)) {
    let minOrder = Number.POSITIVE_INFINITY
    for (const s of items) {
      const ord = s.display_order ?? Number.POSITIVE_INFINITY
      if (ord < minOrder) minOrder = ord
    }
    sectionMinOrder[key] = minOrder
  }
  const sortedKeys = Object.keys(groups).sort((a, b) => {
    const oa = sectionMinOrder[a]
    const ob = sectionMinOrder[b]
    if (oa !== ob) return oa - ob
    return a.localeCompare(b, 'pt-BR')
  })

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

  // ── TABELÃO (Pedro 2026-05-14, estilo Panini control sheet) ──
  // Cada linha = 1 seção (país, FIFA WC ou Coca-Cola).
  // Colunas: NOME PT-BR · CÓD 3-letras · BANDEIRA · 20 células de cromos
  // Células alternam verde/branco (zebra) pra facilitar leitura visual.
  // Quando o user já tem o cromo: célula com fundo cheio + X marcando.

  // Map country (EN, vindo do DB) → { display PT-BR, FIFA code, flag path }
  // PT-BR display: nomes oficiais Panini / FIFA Copa 2026.
  // Pedro 2026-05-14: nomes em inglês idênticos ao álbum, e o CÓDIGO FIFA
  // é derivado do prefixo do `number` (BRA-1 → BRA). Sem maps de tradução
  // de país: o display é `sectionKey.toUpperCase()` e o código vem do
  // sticker em si — à prova de novos países/renames no DB.
  // Único override: nomes longos demais que sobrariam da célula (mesmo
  // padrão do impresso Panini). Code FIFA segue oficial no CÓD.
  const DISPLAY_OVERRIDES: Record<string, string> = {
    'Bosnia and Herzegovina': 'BOSNIA',
  }

  const flagsDir = path.join(process.cwd(), 'public', 'flags')
  const flagPathFor = (fifaCode: string): string | null => {
    const p = path.join(flagsDir, `${fifaCode}.png`)
    return fs.existsSync(p) ? p : null
  }

  // Pedro 2026-05-14: dimensões responsivas por orientação.
  // PORTRAIT (modo default 'full'): tudo precisa caber em 1 página A4.
  //   50 linhas em ~742pt verticais → CELL_H=14pt.
  // LANDSCAPE (modo 'compact' legado): respira mais.
  const NUM_COLS = 20
  const NAME_W = isFullPortrait ? 78 : 96
  const CODE_W = isFullPortrait ? 20 : 30
  const FLAG_W = isFullPortrait ? 18 : 28
  const META_W = NAME_W + CODE_W + FLAG_W
  const TABLE_W = PAGE_WIDTH - 2 * MARGIN
  const GRID_W = TABLE_W - META_W
  const CELL_W = GRID_W / NUM_COLS
  const CELL_H = isFullPortrait ? 14 : 16
  const TABLE_HEADER_H = isFullPortrait ? 13 : 16
  // Tamanhos de fonte casados com a altura da célula
  const FS_TABLE_HEADER = isFullPortrait ? 7 : 8
  const FS_META = isFullPortrait ? 7 : 8
  const FS_CELL = isFullPortrait ? 6 : 7

  let curY = CONTENT_TOP
  const PAGE_BOTTOM = PAGE_HEIGHT - MARGIN - 8

  const cellX = (col: number) => MARGIN + META_W + col * CELL_W

  // Cabeçalho da tabela (1..20)
  const drawTableHeader = (y: number) => {
    const textY = y + (TABLE_HEADER_H - FS_TABLE_HEADER) / 2 - 0.5
    doc.rect(MARGIN, y, TABLE_W, TABLE_HEADER_H).fillColor(COLOR_NAVY).fill()
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(FS_TABLE_HEADER)
      .text('SELEÇÃO', MARGIN + 4, textY, { width: NAME_W - 6, lineBreak: false })
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(FS_TABLE_HEADER)
      .text('CÓD', MARGIN + NAME_W, textY, { width: CODE_W, align: 'center', lineBreak: false })
    // Coluna da bandeira sem rótulo
    for (let c = 0; c < NUM_COLS; c++) {
      const x = cellX(c)
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(FS_TABLE_HEADER)
        .text(String(c + 1), x, textY, { width: CELL_W, align: 'center', lineBreak: false })
    }
  }

  // Cor pra estado preenchido (já tem)
  const fillColorMarked = type === 'missing' ? '#A7F3D0' : '#FCD34D'  // verde claro | âmbar
  const xStrokeMarked = type === 'missing' ? '#047857' : '#B45309'    // verde escuro / âmbar escuro

  const drawCell = (x: number, y: number, label: string, state: 'empty' | 'marked' | 'padding') => {
    if (state === 'padding') {
      doc.rect(x, y, CELL_W, CELL_H).fillColor('#1F2937').fill()  // preto/cinza escuro = inexistente
    } else if (state === 'marked') {
      doc.rect(x, y, CELL_W, CELL_H).fillColor(fillColorMarked).fill()
    } else {
      // Pedro 2026-05-14: faltantes SEMPRE brancas (sem zebra verde).
      // Verde fica reservado pra "já tem" — sem ambiguidade visual.
      doc.rect(x, y, CELL_W, CELL_H).fillColor('#FFFFFF').fill()
    }
    doc.lineWidth(0.4).strokeColor('#9CA3AF').rect(x, y, CELL_W, CELL_H).stroke()

    if (state === 'padding') return
    const textY = y + (CELL_H - FS_CELL) / 2 - 0.5
    if (state === 'marked') {
      doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(FS_CELL)
        .text(label, x, textY, { width: CELL_W, align: 'center', lineBreak: false })
      const xPad = Math.max(2, Math.floor(CELL_W * 0.1))
      doc.lineWidth(0.8).strokeColor(xStrokeMarked)
        .moveTo(x + xPad, y + 2).lineTo(x + CELL_W - xPad, y + CELL_H - 2).stroke()
        .moveTo(x + CELL_W - xPad, y + 2).lineTo(x + xPad, y + CELL_H - 2).stroke()
    } else {
      doc.fillColor('#374151').font('Helvetica').fontSize(FS_CELL)
        .text(label, x, textY, { width: CELL_W, align: 'center', lineBreak: false })
    }
  }

  // Render header da primeira página
  drawTableHeader(curY)
  curY += TABLE_HEADER_H

  let rowZebra = false  // alterna fundo da linha (faixa branca/cinza claro)

  for (const sectionKey of sortedKeys) {
    const items = groups[sectionKey].sort((a, b) => {
      const numA = parseInt(a.number.split('-')[1] || '0', 10)
      const numB = parseInt(b.number.split('-')[1] || '0', 10)
      return numA - numB
    })

    // 1 linha por seção (todos os cromos cabem em 20 colunas: países=20, FWC≤20, Coca-Cola=14)
    const sectionHeight = CELL_H

    // Quebra de página
    if (curY + sectionHeight > PAGE_BOTTOM) {
      doc.addPage()
      drawPageHeader()
      curY = CONTENT_TOP
      drawTableHeader(curY)
      curY += TABLE_HEADER_H
      rowZebra = false
    }

    // Resolve nome PT-BR, código e bandeira
    // Nome: igual ao álbum (inglês), só caixa alta — com override pra
    // nomes longos que sobrariam da célula (ex: Bosnia and Herzegovina).
    const displayName = DISPLAY_OVERRIDES[sectionKey] || sectionKey.toUpperCase()
    // Código: deriva do prefixo do número da figurinha. "BRA-1" → "BRA",
    // "FWC-0" → "FWC", "CC-1" → "CC". Garante código nunca em branco.
    const fifaCode = items[0]?.number.split('-')[0] || ''
    // Bandeira: existe? só países têm; FWC/CC não tem flag PNG no disco.
    const flagPath = fifaCode ? flagPathFor(fifaCode) : null

    // Fundo da faixa de metadados (zebra horizontal sutil)
    const bandY = curY
    const bandBg = rowZebra ? '#F9FAFB' : '#FFFFFF'
    doc.rect(MARGIN, bandY, META_W, CELL_H).fillColor(bandBg).fill()
    doc.lineWidth(0.4).strokeColor('#9CA3AF').rect(MARGIN, bandY, META_W, CELL_H).stroke()

    const textY = bandY + (CELL_H - FS_META) / 2 - 0.5
    // NOME
    doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(FS_META)
      .text(displayName, MARGIN + 3, textY, { width: NAME_W - 5, height: FS_META + 2, lineBreak: false, ellipsis: true })

    // CÓDIGO
    doc.fillColor(COLOR_GRAY).font('Helvetica-Bold').fontSize(FS_META)
      .text(fifaCode, MARGIN + NAME_W, textY, { width: CODE_W, align: 'center', lineBreak: false })
    // separador vertical entre nome e código
    doc.lineWidth(0.4).strokeColor('#9CA3AF')
      .moveTo(MARGIN + NAME_W, bandY).lineTo(MARGIN + NAME_W, bandY + CELL_H).stroke()
    doc.moveTo(MARGIN + NAME_W + CODE_W, bandY).lineTo(MARGIN + NAME_W + CODE_W, bandY + CELL_H).stroke()

    // BANDEIRA (somente países). Mantém aspect ratio (flagcdn w80 ≈ 80×53,
    // ou seja ratio 3:2). Calcula largura limitada por altura da célula
    // e pela largura do slot, o que for menor.
    if (flagPath) {
      try {
        const slotPad = 2
        const maxH = CELL_H - slotPad * 2
        const maxW = FLAG_W - slotPad * 2
        let flagDrawH = maxH
        let flagDrawW = maxH * 1.5
        if (flagDrawW > maxW) {
          flagDrawW = maxW
          flagDrawH = maxW / 1.5
        }
        const flagX = MARGIN + NAME_W + CODE_W + (FLAG_W - flagDrawW) / 2
        const flagY = bandY + (CELL_H - flagDrawH) / 2
        doc.image(flagPath, flagX, flagY, { width: flagDrawW, height: flagDrawH })
      } catch (e) {
        // se embed falhar, mostra ".." pra não quebrar layout
        doc.fillColor(COLOR_GRAY_LIGHT).font('Helvetica').fontSize(7)
          .text('—', MARGIN + NAME_W + CODE_W, bandY + 4, { width: FLAG_W, align: 'center', lineBreak: false })
      }
    }
    // Seções especiais (FIFA WC, Coca-Cola) não têm bandeira — deixa em branco.
    // (Helvetica padrão não tem ★/◉, então evitamos ícones unicode aqui.)

    // 20 células de cromos
    for (let col = 0; col < NUM_COLS; col++) {
      const x = cellX(col)
      const y = bandY
      if (col < items.length) {
        const s = items[col]
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

    rowZebra = !rowZebra
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
