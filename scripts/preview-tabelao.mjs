// Renderiza o tabelão (sem precisar de Supabase) com 48 países mock + FIFA WC + Coca-Cola.
// Marca aleatoriamente ~50% das células pra simular um user médio. Output: /tmp/tabelao-preview.pdf.
// Pedro 2026-05-14: A4 portrait single-page, igual ao modo 'full' real.

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

const FIFA_CODE_BY_COUNTRY = {
  Algeria: 'ALG', Argentina: 'ARG', Australia: 'AUS', Austria: 'AUT',
  Belgium: 'BEL', 'Bosnia and Herzegovina': 'BIH', Brazil: 'BRA', Canada: 'CAN',
  'Cape Verde': 'CPV', Colombia: 'COL', Croatia: 'CRO', Curacao: 'CUW',
  'Czech Republic': 'CZE', 'DR Congo': 'COD', Ecuador: 'ECU', Egypt: 'EGY',
  England: 'ENG', France: 'FRA', Germany: 'GER', Ghana: 'GHA', Haiti: 'HAI',
  Iran: 'IRN', Iraq: 'IRQ', 'Ivory Coast': 'CIV', Japan: 'JPN', Jordan: 'JOR',
  Mexico: 'MEX', Morocco: 'MAR', Netherlands: 'NED', 'New Zealand': 'NZL',
  Norway: 'NOR', Panama: 'PAN', Paraguay: 'PAR', Portugal: 'POR', Qatar: 'QAT',
  'Saudi Arabia': 'KSA', Scotland: 'SCO', Senegal: 'SEN', 'South Africa': 'RSA',
  'South Korea': 'KOR', Spain: 'ESP', Sweden: 'SWE', Switzerland: 'SUI',
  Tunisia: 'TUN', Turkey: 'TUR', USA: 'USA', Uruguay: 'URU', Uzbekistan: 'UZB',
}
const PT_NAME_BY_KEY = {
  Algeria: 'ARGÉLIA', Argentina: 'ARGENTINA', Australia: 'AUSTRÁLIA', Austria: 'ÁUSTRIA',
  Belgium: 'BÉLGICA', 'Bosnia and Herzegovina': 'BÓSNIA', Brazil: 'BRASIL', Canada: 'CANADÁ',
  'Cape Verde': 'CABO VERDE', Colombia: 'COLÔMBIA', Croatia: 'CROÁCIA', Curacao: 'CURAÇAO',
  'Czech Republic': 'REP. TCHECA', 'DR Congo': 'R.D. CONGO', Ecuador: 'EQUADOR', Egypt: 'EGITO',
  England: 'INGLATERRA', France: 'FRANÇA', Germany: 'ALEMANHA', Ghana: 'GANA', Haiti: 'HAITI',
  Iran: 'IRÃ', Iraq: 'IRAQUE', 'Ivory Coast': 'COSTA DO MARFIM', Japan: 'JAPÃO', Jordan: 'JORDÂNIA',
  Mexico: 'MÉXICO', Morocco: 'MARROCOS', Netherlands: 'HOLANDA', 'New Zealand': 'NOVA ZELÂNDIA',
  Norway: 'NORUEGA', Panama: 'PANAMÁ', Paraguay: 'PARAGUAI', Portugal: 'PORTUGAL', Qatar: 'CATAR',
  'Saudi Arabia': 'ARÁBIA SAUDITA', Scotland: 'ESCÓCIA', Senegal: 'SENEGAL', 'South Africa': 'ÁFRICA DO SUL',
  'South Korea': 'COREIA DO SUL', Spain: 'ESPANHA', Sweden: 'SUÉCIA', Switzerland: 'SUÍÇA',
  Tunisia: 'TUNÍSIA', Turkey: 'TURQUIA', USA: 'ESTADOS UNIDOS', Uruguay: 'URUGUAI', Uzbekistan: 'UZBEQUISTÃO',
  'FIFA World Cup': 'FIFA WORLD CUP', 'Coca-Cola': 'COCA-COLA',
}
const FIFA_CODE_BY_SPECIAL = { 'FIFA World Cup': 'FWC', 'Coca-Cola': 'CC' }

const flagsDir = path.resolve(__dirname, '..', 'public', 'flags')
const flagPathFor = (fifaCode) => {
  const p = path.join(flagsDir, `${fifaCode}.png`)
  return fs.existsSync(p) ? p : null
}

const countryKeys = Object.keys(FIFA_CODE_BY_COUNTRY).sort()
const specialKeys = ['FIFA World Cup', 'Coca-Cola']
const sortedKeys = [...countryKeys, ...specialKeys]

const groups = {}
let stickerId = 1
for (const key of countryKeys) {
  const code = FIFA_CODE_BY_COUNTRY[key]
  groups[key] = Array.from({ length: 20 }, (_, i) => ({ id: stickerId++, number: `${code}-${i + 1}` }))
}
groups['FIFA World Cup'] = Array.from({ length: 20 }, (_, i) => ({ id: stickerId++, number: `FWC-${i + 1}` }))
groups['Coca-Cola'] = Array.from({ length: 14 }, (_, i) => ({ id: stickerId++, number: `CC-${i + 1}` }))

const userMap = new Map()
for (const key of sortedKeys) {
  for (const s of groups[key]) if (Math.random() < 0.5) userMap.set(s.id, { status: 'owned', quantity: 1 })
}

const type = 'missing'
const albumTotal = countryKeys.reduce((sum, k) => sum + groups[k].length, 0) + groups['FIFA World Cup'].length
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
  const subtitleStr = `Preview · ${new Date().toLocaleDateString('pt-BR')} · verde = já tem · vazio = falta colar`

  const drawPageHeader = () => {
    const yTop = MARGIN
    const logoSize = 22
    if (hasIcon) doc.image(iconPath, MARGIN, yTop, { width: logoSize })
    doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(13)
      .text('Complete', MARGIN + logoSize + 6, yTop + 4, { continued: true })
    doc.fillColor(COLOR_GREEN).text(' Aí', { continued: false })
    const titleX = MARGIN + logoSize + 90
    doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(11)
      .text(titleStr, titleX, yTop + 4, { width: 280, lineBreak: false })
    doc.fillColor(COLOR_GRAY_LIGHT).font('Helvetica').fontSize(7)
      .text(subtitleStr, titleX, yTop + 20, { width: 280, lineBreak: false })
    const qrSize = 34, qrX = PAGE_WIDTH - MARGIN - qrSize
    doc.image(qrBuffer, qrX, yTop, { width: qrSize, height: qrSize })
    const textW = 130, textX = qrX - textW - 4
    doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(7)
      .text('completeai.com.br', textX, yTop + 4, { width: textW, align: 'right', lineBreak: false })
    doc.fillColor(COLOR_GRAY_LIGHT).font('Helvetica').fontSize(6)
      .text('Indique pelo QR e ganhe benefícios!', textX, yTop + 16, { width: textW, align: 'right' })
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
  const drawCell = (x, y, label, state, zebraGreen) => {
    if (state === 'padding') doc.rect(x, y, CELL_W, CELL_H).fillColor('#1F2937').fill()
    else if (state === 'marked') doc.rect(x, y, CELL_W, CELL_H).fillColor(fillColorMarked).fill()
    else doc.rect(x, y, CELL_W, CELL_H).fillColor(zebraGreen ? '#C8E6C9' : '#FFFFFF').fill()
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
  for (const sectionKey of sortedKeys) {
    const items = groups[sectionKey]
    const ptName = PT_NAME_BY_KEY[sectionKey] || sectionKey.toUpperCase()
    const fifaCode = FIFA_CODE_BY_COUNTRY[sectionKey] || FIFA_CODE_BY_SPECIAL[sectionKey] || ''
    const flagPath = fifaCode && !FIFA_CODE_BY_SPECIAL[sectionKey] ? flagPathFor(fifaCode) : null
    const bandY = curY, bandBg = rowZebra ? '#F9FAFB' : '#FFFFFF'
    doc.rect(MARGIN, bandY, META_W, CELL_H).fillColor(bandBg).fill()
    doc.lineWidth(0.4).strokeColor('#9CA3AF').rect(MARGIN, bandY, META_W, CELL_H).stroke()
    const textY = bandY + (CELL_H - FS_META) / 2 - 0.5
    doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(FS_META).text(ptName, MARGIN + 3, textY, { width: NAME_W - 5, lineBreak: false, ellipsis: true })
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
        drawCell(x, y, numPart, shouldMark ? 'marked' : 'empty', col % 2 === 0)
      } else {
        drawCell(x, y, '', 'padding', false)
      }
    }
    rowZebra = !rowZebra
    curY += CELL_H
  }

  // Diagnóstico: imprime onde a tabela terminou — confirma que cabe em 1 página
  console.log(`Final curY = ${curY.toFixed(1)}pt, page height = ${PAGE_HEIGHT}pt, margin bottom = ${MARGIN}pt`)
  console.log(`Slack = ${(PAGE_HEIGHT - MARGIN - curY).toFixed(1)}pt`)
  console.log(`Total pages = ${doc.bufferedPageRange().count}`)
  doc.end()
  console.log(`Wrote ${outPath}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
