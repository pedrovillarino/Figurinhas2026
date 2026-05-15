// Renderiza o tabelão (sem precisar de Supabase) com 48 países + FIFA WC + Coca-Cola
// na MESMA ordem do álbum (consultada via DB em 2026-05-14). Output: /tmp/tabelao-preview.pdf.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const APP_URL = 'https://www.completeai.com.br'
const COLOR_NAVY = '#0A1628'
const COLOR_GREEN = '#00C896'
const COLOR_GRAY = '#374151'
const COLOR_GRAY_LIGHT = '#6B7280'

// Ordem real do álbum (display_order min de cada seção, em 2026-05-14)
// FIFA WC primeiro, países em ordem de grupo FIFA, Coca-Cola por último.
const SECTIONS_ORDERED = [
  { name: 'FIFA World Cup', code: 'FWC', count: 20 },
  { name: 'Mexico', code: 'MEX', count: 20 },
  { name: 'South Africa', code: 'RSA', count: 20 },
  { name: 'Korea Republic', code: 'KOR', count: 20 },
  { name: 'Czechia', code: 'CZE', count: 20 },
  { name: 'Canada', code: 'CAN', count: 20 },
  { name: 'Bosnia and Herzegovina', code: 'BIH', count: 20, display: 'BOSNIA' },
  { name: 'Qatar', code: 'QAT', count: 20 },
  { name: 'Switzerland', code: 'SUI', count: 20 },
  { name: 'Brazil', code: 'BRA', count: 20 },
  { name: 'Morocco', code: 'MAR', count: 20 },
  { name: 'Haiti', code: 'HAI', count: 20 },
  { name: 'Scotland', code: 'SCO', count: 20 },
  { name: 'USA', code: 'USA', count: 20 },
  { name: 'Paraguay', code: 'PAR', count: 20 },
  { name: 'Australia', code: 'AUS', count: 20 },
  { name: 'Turkey', code: 'TUR', count: 20 },
  { name: 'Germany', code: 'GER', count: 20 },
  { name: 'Curaçao', code: 'CUW', count: 20 },
  { name: "Côte d'Ivoire", code: 'CIV', count: 20 },
  { name: 'Ecuador', code: 'ECU', count: 20 },
  { name: 'Netherlands', code: 'NED', count: 20 },
  { name: 'Japan', code: 'JPN', count: 20 },
  { name: 'Sweden', code: 'SWE', count: 20 },
  { name: 'Tunisia', code: 'TUN', count: 20 },
  { name: 'Belgium', code: 'BEL', count: 20 },
  { name: 'Egypt', code: 'EGY', count: 20 },
  { name: 'Iran', code: 'IRN', count: 20 },
  { name: 'New Zealand', code: 'NZL', count: 20 },
  { name: 'Spain', code: 'ESP', count: 20 },
  { name: 'Cabo Verde', code: 'CPV', count: 20 },
  { name: 'Saudi Arabia', code: 'KSA', count: 20 },
  { name: 'Uruguay', code: 'URU', count: 20 },
  { name: 'France', code: 'FRA', count: 20 },
  { name: 'Senegal', code: 'SEN', count: 20 },
  { name: 'Iraq', code: 'IRQ', count: 20 },
  { name: 'Norway', code: 'NOR', count: 20 },
  { name: 'Argentina', code: 'ARG', count: 20 },
  { name: 'Algeria', code: 'ALG', count: 20 },
  { name: 'Austria', code: 'AUT', count: 20 },
  { name: 'Jordan', code: 'JOR', count: 20 },
  { name: 'Portugal', code: 'POR', count: 20 },
  { name: 'DR Congo', code: 'COD', count: 20 },
  { name: 'Uzbekistan', code: 'UZB', count: 20 },
  { name: 'Colombia', code: 'COL', count: 20 },
  { name: 'England', code: 'ENG', count: 20 },
  { name: 'Croatia', code: 'CRO', count: 20 },
  { name: 'Ghana', code: 'GHA', count: 20 },
  { name: 'Panama', code: 'PAN', count: 20 },
  { name: 'Coca-Cola', code: 'CC', count: 14 },
]

const flagsDir = path.resolve(__dirname, '..', 'public', 'flags')
const flagPathFor = (code) => {
  const p = path.join(flagsDir, `${code}.png`)
  return fs.existsSync(p) ? p : null
}

const userMap = new Map()
let stickerId = 1
const groups = {}
for (const sec of SECTIONS_ORDERED) {
  groups[sec.name] = Array.from({ length: sec.count }, (_, i) => ({
    id: stickerId++, number: `${sec.code}-${i + 1}`,
  }))
  for (const s of groups[sec.name]) if (Math.random() < 0.5) userMap.set(s.id, { status: 'owned' })
}

const type = 'missing'
const albumTotal = SECTIONS_ORDERED.filter((s) => s.name !== 'Coca-Cola').reduce((a, s) => a + s.count, 0)
const countOwned = Array.from(userMap.values()).filter((u) => u.status === 'owned' || u.status === 'duplicate').length

async function main() {
  const qrUrl = `${APP_URL}/u/PREVIEW`
  const qrBuffer = await QRCode.toBuffer(qrUrl, { width: 220, margin: 1, color: { dark: COLOR_NAVY, light: '#FFFFFF' } })
  const iconPath = path.resolve(__dirname, '..', 'public', 'icon-192.png')
  const hasIcon = fs.existsSync(iconPath)

  const doc = new PDFDocument({ margin: 18, size: 'A4', layout: 'portrait', info: { Title: 'Complete Aí Preview' } })
  const outPath = '/tmp/tabelao-preview.pdf'
  doc.pipe(fs.createWriteStream(outPath))

  const PAGE_WIDTH = 595, PAGE_HEIGHT = 842, MARGIN = 18
  const HEADER_H = 38, HEADER_BOTTOM = MARGIN + HEADER_H, CONTENT_TOP = HEADER_BOTTOM + 4

  const titleStr = `Seu álbum: ${countOwned}/${albumTotal}`
  const subtitleStr = `Preview · ${new Date().toLocaleDateString('pt-BR')} · verde com X = já tem · branco = falta colar`

  const drawPageHeader = () => {
    const yTop = MARGIN, logoSize = 22
    if (hasIcon) doc.image(iconPath, MARGIN, yTop, { width: logoSize })
    doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(13).text('Complete', MARGIN + logoSize + 6, yTop + 4, { continued: true })
    doc.fillColor(COLOR_GREEN).text(' Aí', { continued: false })
    const titleX = MARGIN + logoSize + 90
    doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(11).text(titleStr, titleX, yTop + 4, { width: 280, lineBreak: false })
    doc.fillColor(COLOR_GRAY_LIGHT).font('Helvetica').fontSize(7).text(subtitleStr, titleX, yTop + 20, { width: 280, lineBreak: false })
    const qrSize = 34, qrX = PAGE_WIDTH - MARGIN - qrSize
    doc.image(qrBuffer, qrX, yTop, { width: qrSize, height: qrSize })
    const textW = 130, textX = qrX - textW - 4
    doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(7).text('completeai.com.br', textX, yTop + 4, { width: textW, align: 'right', lineBreak: false })
    doc.fillColor(COLOR_GRAY_LIGHT).font('Helvetica').fontSize(6).text('Indique pelo QR e ganhe benefícios!', textX, yTop + 16, { width: textW, align: 'right' })
    doc.moveTo(MARGIN, HEADER_BOTTOM).lineTo(PAGE_WIDTH - MARGIN, HEADER_BOTTOM).strokeColor('#E5E7EB').lineWidth(0.6).stroke()
  }
  drawPageHeader()

  const NUM_COLS = 20, NAME_W = 78, CODE_W = 20, FLAG_W = 18
  const META_W = NAME_W + CODE_W + FLAG_W
  const TABLE_W = PAGE_WIDTH - 2 * MARGIN, GRID_W = TABLE_W - META_W
  const CELL_W = GRID_W / NUM_COLS, CELL_H = 14, TABLE_HEADER_H = 13
  const FS_TABLE_HEADER = 7, FS_META = 7, FS_CELL = 6
  let curY = CONTENT_TOP
  const cellX = (col) => MARGIN + META_W + col * CELL_W

  const drawTableHeader = (y) => {
    const textY = y + (TABLE_HEADER_H - FS_TABLE_HEADER) / 2 - 0.5
    doc.rect(MARGIN, y, TABLE_W, TABLE_HEADER_H).fillColor(COLOR_NAVY).fill()
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(FS_TABLE_HEADER).text('SELEÇÃO', MARGIN + 4, textY, { width: NAME_W - 6, lineBreak: false })
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(FS_TABLE_HEADER).text('CÓD', MARGIN + NAME_W, textY, { width: CODE_W, align: 'center', lineBreak: false })
    for (let c = 0; c < NUM_COLS; c++) {
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(FS_TABLE_HEADER).text(String(c + 1), cellX(c), textY, { width: CELL_W, align: 'center', lineBreak: false })
    }
  }
  const fillColorMarked = '#A7F3D0'
  const xStrokeMarked = '#047857'
  const drawCell = (x, y, label, state) => {
    if (state === 'padding') doc.rect(x, y, CELL_W, CELL_H).fillColor('#1F2937').fill()
    else if (state === 'marked') doc.rect(x, y, CELL_W, CELL_H).fillColor(fillColorMarked).fill()
    else doc.rect(x, y, CELL_W, CELL_H).fillColor('#FFFFFF').fill()
    doc.lineWidth(0.4).strokeColor('#9CA3AF').rect(x, y, CELL_W, CELL_H).stroke()
    if (state === 'padding') return
    const textY = y + (CELL_H - FS_CELL) / 2 - 0.5
    if (state === 'marked') {
      doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(FS_CELL).text(label, x, textY, { width: CELL_W, align: 'center', lineBreak: false })
      const xPad = Math.max(2, Math.floor(CELL_W * 0.1))
      doc.lineWidth(0.8).strokeColor(xStrokeMarked)
        .moveTo(x + xPad, y + 2).lineTo(x + CELL_W - xPad, y + CELL_H - 2).stroke()
        .moveTo(x + CELL_W - xPad, y + 2).lineTo(x + xPad, y + CELL_H - 2).stroke()
    } else {
      doc.fillColor('#374151').font('Helvetica').fontSize(FS_CELL).text(label, x, textY, { width: CELL_W, align: 'center', lineBreak: false })
    }
  }

  drawTableHeader(curY); curY += TABLE_HEADER_H
  let rowZebra = false
  for (const sec of SECTIONS_ORDERED) {
    const items = groups[sec.name]
    const displayName = sec.display || sec.name.toUpperCase()
    const fifaCode = items[0].number.split('-')[0]
    const flagPath = flagPathFor(fifaCode)
    const bandY = curY, bandBg = rowZebra ? '#F9FAFB' : '#FFFFFF'
    doc.rect(MARGIN, bandY, META_W, CELL_H).fillColor(bandBg).fill()
    doc.lineWidth(0.4).strokeColor('#9CA3AF').rect(MARGIN, bandY, META_W, CELL_H).stroke()
    const textY = bandY + (CELL_H - FS_META) / 2 - 0.5
    doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(FS_META).text(displayName, MARGIN + 3, textY, { width: NAME_W - 5, height: FS_META + 2, lineBreak: false, ellipsis: true })
    doc.fillColor(COLOR_GRAY).font('Helvetica-Bold').fontSize(FS_META).text(fifaCode, MARGIN + NAME_W, textY, { width: CODE_W, align: 'center', lineBreak: false })
    doc.lineWidth(0.4).strokeColor('#9CA3AF').moveTo(MARGIN + NAME_W, bandY).lineTo(MARGIN + NAME_W, bandY + CELL_H).stroke()
    doc.moveTo(MARGIN + NAME_W + CODE_W, bandY).lineTo(MARGIN + NAME_W + CODE_W, bandY + CELL_H).stroke()
    if (flagPath) {
      const slotPad = 2
      const maxH = CELL_H - slotPad * 2, maxW = FLAG_W - slotPad * 2
      let flagDrawH = maxH, flagDrawW = maxH * 1.5
      if (flagDrawW > maxW) { flagDrawW = maxW; flagDrawH = maxW / 1.5 }
      const flagX = MARGIN + NAME_W + CODE_W + (FLAG_W - flagDrawW) / 2, flagY = bandY + (CELL_H - flagDrawH) / 2
      doc.image(flagPath, flagX, flagY, { width: flagDrawW, height: flagDrawH })
    }
    for (let col = 0; col < NUM_COLS; col++) {
      const x = cellX(col), y = bandY
      if (col < items.length) {
        const s = items[col], us = userMap.get(s.id)
        const isOwned = !!us && (us.status === 'owned' || us.status === 'duplicate')
        const shouldMark = type === 'missing' ? isOwned : false
        const numPart = s.number.split('-')[1] || s.number
        drawCell(x, y, numPart, shouldMark ? 'marked' : 'empty')
      } else {
        drawCell(x, y, '', 'padding')
      }
    }
    rowZebra = !rowZebra
    curY += CELL_H
  }

  console.log(`Final curY = ${curY.toFixed(1)}pt, page height = ${PAGE_HEIGHT}pt, margin bottom = ${MARGIN}pt`)
  console.log(`Slack = ${(PAGE_HEIGHT - MARGIN - curY).toFixed(1)}pt`)
  console.log(`Total pages = ${doc.bufferedPageRange().count}`)
  // Sanity check: garante 48 bandeiras presentes
  let missingFlags = 0
  for (const sec of SECTIONS_ORDERED) {
    if (sec.code === 'FWC' || sec.code === 'CC') continue
    if (!flagPathFor(sec.code)) { console.error(`MISSING FLAG: ${sec.code}`); missingFlags++ }
  }
  console.log(`Flags ausentes: ${missingFlags}`)
  doc.end()
  console.log(`Wrote ${outPath}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
