import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { sendText } from '@/lib/zapi'
import { getScanLimit, type Tier } from '@/lib/tiers'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://completeai.com.br').trim()

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const SCAN_INSTRUCTION = `Você é um scanner de figurinhas de álbuns Panini de Copa do Mundo (qualquer edição: 2022, 2026, etc).

Você pode receber:
1. Uma foto de uma PÁGINA INTEIRA do álbum — identifique todos os slots visíveis.
2. Uma foto de FIGURINHAS SOLTAS (uma ou várias) — identifique cada uma.

TIPOS DE FIGURINHAS:
- Jogadores: têm nome do jogador e número (ex: BRA-10 Neymar Jr)
- Emblemas/Escudos: mostram o brasão da seleção (ex: BRA-1 Emblem)
- Foto do time: foto coletiva da seleção (ex: BRA-2 Team Photo)
- Estádios e logos FIFA: figurinhas especiais (ex: FWC-1, FWC-2)

REGRAS:
- "filled": figurinha colada ou figurinha individual fotografada.
- "empty": espaço vazio no álbum.
- CRÍTICO: Identifique TODAS as figurinhas visíveis — jogadores, emblemas, escudos, fotos de time, logos FIFA. NÃO pule nenhuma.
- CRÍTICO: Leia o nome EXATO impresso na figurinha. NÃO adivinhe — "MARQUINHOS" NÃO é "NEYMAR JR".
- Use o número EXATO impresso (ex: FWC-1, QAT-1, BRA-10, ARG-12).
- NÃO invente números. Leia o que está impresso.
- Para emblemas sem nome de jogador, use "Emblem" como player_name.
- Para fotos de time, use "Team Photo" como player_name.
- Confiança < 0.7 se incerto.
- Ignore decorações do álbum. Países em Português.

Retorne APENAS JSON válido neste formato:
{
  "pages_detected": 1,
  "scan_confidence": 0.9,
  "stickers": [
    {"number": "BRA-1", "player_name": "Emblem", "country": "Brasil", "status": "filled", "confidence": 0.95},
    {"number": "BRA-3", "player_name": "Thiago Silva", "country": "Brasil", "status": "filled", "confidence": 0.95}
  ],
  "unreadable": [],
  "warnings": []
}`

export async function POST(req: NextRequest) {
  let phone = ''
  try {
    const body = await req.json()
    const { base64, mimeType, userId } = body
    phone = body.phone || ''

    if (!base64 || !phone || !userId) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    // Verify internal secret
    const secret = req.headers.get('x-internal-secret')
    if (secret !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminDb = getAdmin()

    // Check scan limit
    const { data: profile } = await adminDb
      .from('profiles')
      .select('tier')
      .eq('id', userId)
      .single()

    const userTier = (profile?.tier || 'free') as Tier
    const tierScanLimit = getScanLimit(userTier)

    const { data: usageData } = await adminDb
      .rpc('increment_scan_usage', {
        p_user_id: userId,
        p_daily_limit: tierScanLimit,
      })

    if (usageData && !usageData.allowed) {
      const isFree = userTier === 'free'
      const msg = isFree
        ? `Você usou seus 5 scans gratuitos! Faça upgrade para continuar:\n${APP_URL}/profile`
        : `Você usou todos os seus ${usageData.limit} scans. Compre um pacote extra pelo app:\n${APP_URL}/profile`
      await sendText(phone, msg)
      return NextResponse.json({ ok: true })
    }

    // Scan with Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const models = [
      'gemini-2.5-flash',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite-preview',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash-001',
    ]
    let responseText = ''

    const isRetryable = (msg: string) =>
      msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED') ||
      msg.includes('Too Many') || msg.includes('404') || msg.includes('not found') ||
      msg.includes('deprecated') || msg.includes('503') || msg.includes('UNAVAILABLE') ||
      msg.includes('500') || msg.includes('INTERNAL')

    for (const modelName of models) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: SCAN_INSTRUCTION,
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        })

        const result = await model.generateContent([
          { inlineData: { mimeType: mimeType || 'image/jpeg', data: base64 } },
          { text: 'Identify ALL stickers in this photo — players, emblems, team photos, FIFA logos. Do not miss any. Return JSON.' },
        ])
        responseText = result.response.text()
        console.log(`[WhatsApp scan] ${modelName} succeeded`)
        break
      } catch (modelErr) {
        const msg = modelErr instanceof Error ? modelErr.message : String(modelErr)
        console.error(`[WhatsApp scan] ${modelName} failed:`, msg.substring(0, 200))
        if (isRetryable(msg)) continue
        throw modelErr
      }
    }

    if (!responseText) {
      await sendText(phone, 'O serviço de scan está ocupado. Tenta de novo em 1 minuto ou use o scan pelo site! 🌐\n\n' + APP_URL + '/scan')
      return NextResponse.json({ ok: true })
    }

    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      await sendText(phone, 'Não encontrei figurinhas nessa foto. Tenta uma com mais nitidez! 📸')
      return NextResponse.json({ ok: true })
    }

    const parsed = JSON.parse(jsonMatch[0])
    if (!parsed.stickers || !Array.isArray(parsed.stickers) || parsed.stickers.length === 0) {
      await sendText(phone, 'Não encontrei figurinhas nessa foto. Tenta uma com mais nitidez! 📸')
      return NextResponse.json({ ok: true })
    }

    const filledStickers = parsed.stickers.filter((s: { status: string }) => s.status === 'filled')
    const filledNumbers = filledStickers.map((s: { number: string }) => s.number)
    const filledNames = filledStickers.map((s: { player_name?: string }) => s.player_name || '')

    if (filledNumbers.length === 0) {
      await sendText(phone, 'Não encontrei figurinhas coladas nessa foto. Tenta outra! 📸')
      return NextResponse.json({ ok: true })
    }

    // Match stickers in DB
    let dbStickers = (await adminDb
      .from('stickers')
      .select('id, number, player_name')
      .in('number', filledNumbers)).data || []

    // If no match by number, try by player name
    if (dbStickers.length === 0 && filledNames.length > 0) {
      for (const name of filledNames.filter(Boolean)) {
        const { data } = await adminDb
          .from('stickers')
          .select('id, number, player_name')
          .ilike('player_name', `%${name.trim()}%`)
          .limit(1)
        if (data && data.length > 0) dbStickers.push(...data)
      }
    }

    if (dbStickers.length === 0) {
      await sendText(phone, `Encontrei figurinha(s) mas não consegui identificar no banco: ${filledNumbers.join(', ')}. Tenta pelo site! 📸`)
      return NextResponse.json({ ok: true })
    }

    // Deduplicate by sticker id
    const uniqueMap = new Map(dbStickers.map((s) => [s.id, s]))
    dbStickers = Array.from(uniqueMap.values())

    // Check which ones user already has
    const { data: existing } = await adminDb
      .from('user_stickers')
      .select('sticker_id, status, quantity')
      .eq('user_id', userId)
      .in('sticker_id', dbStickers.map((s) => s.id))

    const existingMap = new Map((existing || []).map((e) => [e.sticker_id, e]))

    // Build preview list
    const previewLines: string[] = []
    const scanData: Array<{ sticker_id: number; number: string; player_name: string }> = []

    for (const sticker of dbStickers) {
      const ex = existingMap.get(sticker.id)
      const label = `${sticker.number} ${sticker.player_name || ''}`.trim()

      if (!ex) {
        previewLines.push(`🆕 ${label}`)
      } else if (ex.status === 'owned') {
        previewLines.push(`🔁 ${label} _(repetida)_`)
      } else if (ex.status === 'duplicate') {
        previewLines.push(`🔁 ${label} _(rep x${ex.quantity + 1})_`)
      }

      scanData.push({ sticker_id: sticker.id, number: sticker.number, player_name: sticker.player_name || '' })
    }

    // Save pending scan
    await adminDb.from('pending_scans').insert({
      user_id: userId,
      phone,
      scan_data: scanData,
    })

    // Send preview and ask for confirmation
    let msg = `📋 *Encontrei ${dbStickers.length} figurinha(s):*\n\n`
    msg += previewLines.join('\n')
    msg += '\n\n✅ Responda *SIM* para registrar'
    msg += '\n❌ Responda *NÃO* para cancelar'

    await sendText(phone, msg)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[WhatsApp scan] Error:', errMsg)
    if (phone) {
      const isQuota = errMsg.includes('429') || errMsg.includes('quota')
      const userMsg = isQuota
        ? 'O serviço de scan está sobrecarregado. Tenta de novo mais tarde ou use o scan pelo site! 🌐\n\n' + APP_URL + '/scan'
        : 'Não consegui analisar essa foto. Tenta com mais nitidez! 📸'
      await sendText(phone, userMsg).catch(() => {})
    }
    return NextResponse.json({ error: 'scan failed' }, { status: 500 })
  }
}
