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

  // Auth: tenta x-admin-secret + user_id primeiro (bot path), senão cookie session
  let userId: string | null = null
  const adminSecret = req.headers.get('x-admin-secret')
  if (adminSecret && process.env.ADMIN_SECRET && adminSecret === process.env.ADMIN_SECRET) {
    userId = url.searchParams.get('user_id')
    if (!userId) {
      return NextResponse.json({ error: 'user_id required when using admin secret' }, { status: 400 })
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

  // 5) Gera PDF
  const doc = new PDFDocument({ margin: 40, size: 'A4', info: { Title: 'Complete Aí', Author: 'Complete Aí' } })
  const chunks: Buffer[] = []
  doc.on('data', (c) => chunks.push(c))
  const endPromise = new Promise<void>((resolve) => doc.on('end', resolve))

  // ── Header ──
  if (hasIcon) {
    doc.image(iconPath, 40, 38, { width: 36 })
  }
  doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(22).text('Complete', 90, 42, { continued: true })
  doc.fillColor(COLOR_GREEN).text(' Aí', { continued: false })
  doc.moveDown(0.2)
  doc.fillColor(COLOR_GRAY_LIGHT).font('Helvetica').fontSize(9).text('Álbum FIFA World Cup 2026 com IA', 90)

  // Linha separadora
  doc.moveTo(40, 92).lineTo(555, 92).strokeColor('#E5E7EB').lineWidth(1).stroke()

  // ── Título ──
  doc.moveDown(2)
  doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(18)
    .text(type === 'missing' ? `Suas faltantes (${list.length})` : `Suas repetidas (${list.length})`, 40)
  doc.font('Helvetica').fontSize(10).fillColor(COLOR_GRAY_LIGHT)
    .text(`${firstName} · gerado em ${new Date().toLocaleDateString('pt-BR')}`, 40)
  doc.moveDown(1)

  if (list.length === 0) {
    doc.fontSize(12).fillColor(COLOR_GRAY)
      .text(type === 'missing'
        ? '🎉 Você não tem nenhuma figurinha faltando! Parabéns!'
        : 'Você ainda não tem nenhuma figurinha repetida pra trocar.',
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

    // Layout em 2 colunas pra economizar páginas
    const colWidth = 250
    const colXLeft = 40
    const colXRight = 305
    let currentCol: 'L' | 'R' = 'L'
    let x = colXLeft

    for (const country of sortedKeys) {
      const items = groups[country].sort((a, b) => {
        // Ordena por número (BRA-1, BRA-2, ..., BRA-10)
        const numA = parseInt(a.number.split('-')[1] || '0', 10)
        const numB = parseInt(b.number.split('-')[1] || '0', 10)
        return numA - numB
      })

      // Quebra de página/coluna se faltar espaço (~ 14 pontos por linha + 16 do header)
      const blockHeight = 16 + items.length * 12 + 6
      if (doc.y + blockHeight > 760) {
        if (currentCol === 'L') {
          currentCol = 'R'
          x = colXRight
          doc.y = 130 // reset Y pra topo da coluna direita (após header+título)
        } else {
          doc.addPage()
          currentCol = 'L'
          x = colXLeft
          doc.y = 50
        }
      }

      doc.fillColor(COLOR_GREEN).font('Helvetica-Bold').fontSize(11)
        .text(`${country.toUpperCase()} (${items.length})`, x, doc.y, { width: colWidth })
      doc.font('Helvetica').fontSize(9).fillColor(COLOR_GRAY)
      for (const s of items) {
        const numStr = s.number.padEnd(8, ' ')
        const name = s.player_name || ''
        const qty = type === 'duplicates' ? userMap.get(s.id)?.quantity : null
        const qtyTail = qty && qty > 1 ? `  (×${qty})` : ''
        doc.text(`${numStr}${name}${qtyTail}`, x, doc.y, { width: colWidth, lineBreak: false })
      }
      doc.moveDown(0.5)
    }
  }

  // ── Footer com QR (sempre na última página) ──
  // Garante espaço; se não tiver, addPage
  if (doc.y > 600) doc.addPage()
  // Vai pro fim da página
  doc.y = 660

  // Faixa de fundo claro
  doc.rect(40, 660, 515, 130).fillColor('#F3F4F6').fill()

  // Texto à esquerda do QR
  doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(12)
    .text('Use IA pra escanear seu álbum', 60, 680, { width: 280 })
  doc.fillColor(COLOR_GRAY).font('Helvetica').fontSize(10)
    .text('e descobrir trocas perto de você. Grátis pra começar.', 60, 698, { width: 280 })
  doc.fillColor(COLOR_NAVY).font('Helvetica-Bold').fontSize(11)
    .text('Indique este QR code com amigos', 60, 730, { width: 280 })
  doc.fillColor(COLOR_GREEN).font('Helvetica-Bold').fontSize(11)
    .text('e ganhe benefícios.', 60, 745, { width: 280 })
  doc.fillColor(COLOR_GRAY_LIGHT).font('Helvetica').fontSize(9)
    .text('completeai.com.br', 60, 770, { width: 280 })

  // QR code à direita
  doc.image(qrBuffer, 410, 670, { width: 110, height: 110 })

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
