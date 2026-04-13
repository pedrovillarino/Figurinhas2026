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
2. Uma foto de uma FIGURINHA INDIVIDUAL (solta, fora do álbum) — identifique o número, jogador e país.

REGRAS:
- "filled": figurinha colada ou figurinha individual fotografada.
- "empty": espaço vazio no álbum.
- Confiança < 0.7 se incerto.
- scan_confidence: qualidade geral da imagem.
- Ignore decorações. Países em Português.
- Para figurinha individual: retorne apenas 1 item no array stickers com status "filled".
- Use o número EXATO impresso na figurinha (ex: FWC-1, QAT-1, BRA-10, ARG-12).
- NÃO invente números. Leia o que está impresso.
- CRÍTICO: Leia o nome EXATO impresso na figurinha. NÃO adivinhe — "MARQUINHOS" NÃO é "NEYMAR JR". Cada jogador tem um nome único.

Retorne APENAS JSON válido neste formato:
{
  "pages_detected": 1,
  "scan_confidence": 0.9,
  "stickers": [
    {"number": "BRA-1", "player_name": "Alisson", "country": "Brasil", "status": "filled", "confidence": 0.95}
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

    // Check scan limit
    const adminDb = getAdmin()
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

    // Scan with Gemini — try 2.5-flash first, fallback to 2.5-flash-lite
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite']
    let responseText = ''

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
          { text: 'Identify the sticker(s) in this photo. Return JSON.' },
        ])

        responseText = result.response.text()
        console.log(`[WhatsApp scan] ${modelName} succeeded`)
        break
      } catch (modelErr) {
        const msg = modelErr instanceof Error ? modelErr.message : String(modelErr)
        console.error(`[WhatsApp scan] ${modelName} failed:`, msg.substring(0, 200))
        // If rate limited or model not found, try next model
        if (msg.includes('429') || msg.includes('404') || msg.includes('not found') || msg.includes('deprecated') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
          console.log(`[WhatsApp scan] Falling back to next model...`)
          continue
        }
        // For other errors on last model, throw
        if (modelName === models[models.length - 1]) throw modelErr
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

    // Save stickers to DB
    const supabase = getAdmin()

    // Match by number
    let dbStickers = (await supabase
      .from('stickers')
      .select('id, number, player_name')
      .in('number', filledNumbers)).data || []

    // If no match by number, try by player name
    if (dbStickers.length === 0 && filledNames.length > 0) {
      for (const name of filledNames.filter(Boolean)) {
        const { data } = await supabase
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

    // Get existing user stickers
    const { data: existing } = await supabase
      .from('user_stickers')
      .select('sticker_id, status, quantity')
      .eq('user_id', userId)
      .in('sticker_id', dbStickers.map((s) => s.id))

    const existingMap = new Map((existing || []).map((e) => [e.sticker_id, e]))
    let saved = 0
    const savedNumbers: string[] = []

    for (const sticker of dbStickers) {
      const ex = existingMap.get(sticker.id)
      if (!ex) {
        await supabase.from('user_stickers').insert({ user_id: userId, sticker_id: sticker.id, status: 'owned', quantity: 1 })
        saved++
        savedNumbers.push(sticker.number)
      } else if (ex.status === 'owned') {
        await supabase.from('user_stickers').update({ status: 'duplicate', quantity: 2, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('sticker_id', sticker.id)
        saved++
        savedNumbers.push(`${sticker.number} (rep)`)
      } else if (ex.status === 'duplicate') {
        await supabase.from('user_stickers').update({ quantity: ex.quantity + 1, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('sticker_id', sticker.id)
        saved++
        savedNumbers.push(`${sticker.number} (rep x${ex.quantity + 1})`)
      }
    }

    // Get updated stats
    const { count: totalStickers } = await supabase.from('stickers').select('*', { count: 'exact', head: true })
    const { data: userStickers } = await supabase.from('user_stickers').select('status, quantity').eq('user_id', userId)

    const total = totalStickers || 670
    let owned = 0
    userStickers?.forEach((us) => {
      if (us.status === 'owned' || us.status === 'duplicate') owned++
    })
    const pct = Math.round((owned / total) * 100)

    let reply = `✅ *${saved} figurinha(s) registrada(s)!*\n\n`
    reply += savedNumbers.join(', ') + '\n\n'
    reply += `📊 Progresso: *${owned}/${total}* (${pct}%)`

    await sendText(phone, reply)
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
