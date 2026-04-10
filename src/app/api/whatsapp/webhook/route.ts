import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { sendText, formatPhone } from '@/lib/zapi'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

// ─── Admin Supabase client (service role) ───
function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ─── Gemini client ───
function getGemini() {
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
}

// ─── Intent detection prompt (Gemini instead of GPT-4o mini) ───
const INTENT_SYSTEM = `You are an intent classifier for a Panini sticker album WhatsApp bot.
Given a user message in Portuguese, return ONLY valid JSON:

{
  "intent": "status|missing|duplicates|trades|help|unknown",
  "confidence": 0.95,
  "response_hint": "brief note about what the user wants"
}

Intent definitions:
- status: user wants their collection progress/stats
- missing: user wants list of stickers they still need
- duplicates: user wants list of sticker duplicates to trade
- trades: user wants to see pending trade requests or trade status ("trocas", "aceitar", "pendentes", "solicitações")
- help: user wants to know what the bot can do
- unknown: anything else (greetings map to help)

Be generous: "oi" → help, "quanto tenho" → status,
"quais me faltam" → missing, "o que tenho repetido" → duplicates,
"trocas pendentes" → trades, "aceitar troca" → trades.`

// ─── Sticker scan prompt (same as /api/scan) ───
const SCAN_INSTRUCTION = `Você é um scanner de figurinhas de álbuns Panini de Copa do Mundo (qualquer edição: 2022, 2026, etc).

Você pode receber:
1. Uma foto de uma PÁGINA INTEIRA do álbum — identifique todos os slots visíveis.
2. Uma foto de uma FIGURINHA INDIVIDUAL (solta, fora do álbum) — identifique o número, jogador e país.

REGRAS:
- "filled": figurinha colada ou figurinha individual fotografada.
- "empty": espaço vazio no álbum.
- Confiança < 0.7 se incerto.
- "unreadable": descreva slots ilegíveis.
- scan_confidence: qualidade geral da imagem.
- Ignore decorações. Países em Português.
- Para figurinha individual: retorne apenas 1 item no array stickers com status "filled".
- Use o número EXATO impresso na figurinha (ex: FWC-1, QAT-1, BRA-10, ARG-12).
- NÃO invente números. Leia o que está impresso.

Retorne APENAS JSON válido neste formato:
{
  "pages_detected": 1,
  "scan_confidence": 0.9,
  "stickers": [
    {"number": "BRA-1", "player_name": "Neymar", "country": "Brasil", "status": "filled", "confidence": 0.95}
  ],
  "unreadable": [],
  "warnings": []
}`

// ─── Welcome message for unknown users ───
function getWelcomeMessage(phone: string) {
  return `Olá! 👋 Sou o assistente do *Álbum da Copa 2026* ⚽

Posso te ajudar com:
📊 *status* — seu progresso atual
🔍 *faltando* — o que você ainda precisa
🔁 *repetidas* — suas figurinhas para trocar
📸 Mande uma *foto* de qualquer folha para eu registrar!

Para começar, acesse: ${APP_URL}/register?phone=${phone}
e crie sua conta gratuita 🎉`
}

// ─── Find user by phone ───
async function findUserByPhone(phone: string) {
  const supabase = getAdmin()
  const { data } = await supabase
    .from('profiles')
    .select('id, display_name, phone, tier')
    .eq('phone', phone)
    .single()
  return data
}

// ─── Get user stats ───
async function getUserStats(userId: string) {
  const supabase = getAdmin()

  const { count: totalStickers } = await supabase
    .from('stickers')
    .select('*', { count: 'exact', head: true })

  const { data: userStickers } = await supabase
    .from('user_stickers')
    .select('status, quantity')
    .eq('user_id', userId)

  const total = totalStickers || 670
  let owned = 0
  let duplicates = 0

  userStickers?.forEach((us) => {
    if (us.status === 'owned') owned++
    if (us.status === 'duplicate') {
      owned++
      duplicates++
    }
  })

  const missing = total - owned
  const pct = Math.round((owned / total) * 100)

  return { owned, missing, duplicates, total, pct }
}

// ─── Get missing sticker list ───
async function getMissingStickers(userId: string, limit = 30) {
  const supabase = getAdmin()

  const { data: owned } = await supabase
    .from('user_stickers')
    .select('sticker_id')
    .eq('user_id', userId)
    .in('status', ['owned', 'duplicate'])

  const ownedIds = (owned || []).map((o) => o.sticker_id)

  const query = supabase
    .from('stickers')
    .select('number, player_name, country')
    .order('number')
    .limit(limit)

  if (ownedIds.length > 0) {
    // Get stickers NOT in owned list
    const { data } = await supabase
      .from('stickers')
      .select('number, player_name, country')
      .not('id', 'in', `(${ownedIds.join(',')})`)
      .order('number')
      .limit(limit)
    return data || []
  }

  const { data } = await query
  return data || []
}

// ─── Get duplicate sticker list ───
async function getDuplicateStickers(userId: string) {
  const supabase = getAdmin()

  const { data } = await supabase
    .from('user_stickers')
    .select('quantity, sticker_id, stickers(number, player_name, country)')
    .eq('user_id', userId)
    .eq('status', 'duplicate')
    .order('sticker_id')

  return (data || []).map((d: Record<string, unknown>) => {
    const sticker = d.stickers as Record<string, string> | null
    return {
      number: sticker?.number || '?',
      player_name: sticker?.player_name || '',
      country: sticker?.country || '',
      quantity: (d.quantity as number) || 2,
    }
  })
}

// ─── Detect intent via Gemini ───
async function detectIntent(text: string): Promise<{ intent: string; confidence: number }> {
  try {
    const genAI = getGemini()
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: INTENT_SYSTEM,
    })

    const result = await model.generateContent([{ text }])
    const response = result.response.text()
    const jsonMatch = response.match(/\{[\s\S]*\}/)

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return { intent: parsed.intent || 'unknown', confidence: parsed.confidence || 0.5 }
    }
  } catch (err) {
    console.error('Intent detection error:', err)
  }
  return { intent: 'unknown', confidence: 0 }
}

// ─── Scan image via Gemini ───
async function scanImage(imageBase64: string, mimeType: string) {
  const genAI = getGemini()
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SCAN_INSTRUCTION,
  })

  const result = await model.generateContent([
    { inlineData: { mimeType, data: imageBase64 } },
    { text: 'Scan this album page and return the sticker inventory as JSON.' },
  ])

  const responseText = result.response.text()
  const jsonMatch = responseText.match(/\{[\s\S]*\}/)

  if (!jsonMatch) return null

  try {
    const parsed = JSON.parse(jsonMatch[0])
    if (!parsed.stickers || !Array.isArray(parsed.stickers)) return null
    return parsed
  } catch {
    return null
  }
}

// ─── Save scanned stickers to DB ───
async function saveScannedStickers(userId: string, stickerNumbers: string[]) {
  const supabase = getAdmin()

  const { data: dbStickers } = await supabase
    .from('stickers')
    .select('id, number, player_name')
    .in('number', stickerNumbers)

  if (!dbStickers || dbStickers.length === 0) return { saved: 0, numbers: [] }

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
      // New sticker → owned
      await supabase.from('user_stickers').insert({
        user_id: userId,
        sticker_id: sticker.id,
        status: 'owned',
        quantity: 1,
      })
      saved++
      savedNumbers.push(sticker.number)
    } else if (ex.status === 'owned') {
      // Already owned → duplicate
      await supabase
        .from('user_stickers')
        .update({ status: 'duplicate', quantity: 2, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('sticker_id', sticker.id)
      saved++
      savedNumbers.push(`${sticker.number} (rep)`)
    } else if (ex.status === 'duplicate') {
      // Already duplicate → increment
      await supabase
        .from('user_stickers')
        .update({ quantity: ex.quantity + 1, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('sticker_id', sticker.id)
      saved++
      savedNumbers.push(`${sticker.number} (rep x${ex.quantity + 1})`)
    }
  }

  return { saved, numbers: savedNumbers }
}

// ─── Download image from Z-API URL ───
async function downloadImage(url: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null

    const buffer = await res.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const mimeType = res.headers.get('content-type') || 'image/jpeg'

    return { base64, mimeType }
  } catch {
    return null
  }
}

// ─── Main webhook handler ───
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Z-API sends different event types
    // We care about received messages
    const isMessage = body.isGroup === false && body.fromMe === false

    if (!isMessage) {
      return NextResponse.json({ ok: true })
    }

    const phone = formatPhone(body.phone || body.chatId || '')
    if (!phone) {
      return NextResponse.json({ ok: true })
    }

    const messageType = body.type // 'text', 'image', 'audio', 'video', etc.

    // Find user by phone
    const user = await findUserByPhone(phone)

    // Unknown user → welcome message
    if (!user) {
      await sendText(phone, getWelcomeMessage(phone))
      return NextResponse.json({ ok: true })
    }

    // ─── Audio ───
    if (messageType === 'audio' || messageType === 'ptt') {
      await sendText(phone, 'Ainda não processo áudios 😅 Manda texto ou foto!')
      return NextResponse.json({ ok: true })
    }

    // ─── Image ───
    if (messageType === 'image') {
      const imageUrl = body.image?.imageUrl || body.image?.url || body.imageUrl
      if (!imageUrl) {
        await sendText(phone, 'Não consegui baixar a imagem. Tenta mandar de novo? 📸')
        return NextResponse.json({ ok: true })
      }

      // Check tier
      if (user.tier === 'free') {
        await sendText(
          phone,
          `📸 O scanner é uma funcionalidade *Plus*.\n\nDesbloqueie por apenas R$9,90:\n${APP_URL}/scan`
        )
        return NextResponse.json({ ok: true })
      }

      await sendText(phone, '🔍 Analisando sua foto... aguarde!')

      const imageData = await downloadImage(imageUrl)
      if (!imageData) {
        await sendText(phone, 'Não consegui baixar a imagem. Tenta mandar de novo? 📸')
        return NextResponse.json({ ok: true })
      }

      const scanResult = await scanImage(imageData.base64, imageData.mimeType)
      if (!scanResult || scanResult.stickers.length === 0) {
        await sendText(phone, 'Não encontrei figurinhas nessa foto. Tenta uma com mais nitidez! 📸')
        return NextResponse.json({ ok: true })
      }

      const filledNumbers = scanResult.stickers
        .filter((s: { status: string }) => s.status === 'filled')
        .map((s: { number: string }) => s.number)

      if (filledNumbers.length === 0) {
        await sendText(phone, 'Não encontrei figurinhas coladas nessa foto. Tenta outra! 📸')
        return NextResponse.json({ ok: true })
      }

      const { saved, numbers } = await saveScannedStickers(user.id, filledNumbers)

      const stats = await getUserStats(user.id)

      let reply = `✅ *${saved} figurinha(s) registrada(s)!*\n\n`
      reply += numbers.join(', ') + '\n\n'
      reply += `📊 Progresso: *${stats.owned}/${stats.total}* (${stats.pct}%)`

      await sendText(phone, reply)
      return NextResponse.json({ ok: true })
    }

    // ─── Text ───
    if (messageType === 'text' || messageType === 'chat') {
      const text = body.text?.message || body.body || body.message || ''

      if (!text.trim()) {
        return NextResponse.json({ ok: true })
      }

      const { intent } = await detectIntent(text)

      switch (intent) {
        case 'status': {
          const stats = await getUserStats(user.id)
          await sendText(
            phone,
            `📊 *Seu álbum:*\n\n` +
              `✅ Coladas: *${stats.owned}*\n` +
              `❌ Faltam: *${stats.missing}*\n` +
              `🔁 Repetidas: *${stats.duplicates}*\n` +
              `📈 Progresso: *${stats.pct}%* (${stats.owned}/${stats.total})`
          )
          break
        }

        case 'missing': {
          const missing = await getMissingStickers(user.id, 30)
          if (missing.length === 0) {
            await sendText(phone, '🎉 Você completou o álbum! Parabéns!')
          } else {
            const list = missing
              .map((s) => `${s.number}${s.player_name ? ' ' + s.player_name : ''}`)
              .join('\n')
            const stats = await getUserStats(user.id)
            await sendText(
              phone,
              `🔍 *Figurinhas que faltam* (${stats.missing} total):\n\n${list}${
                stats.missing > 30 ? `\n\n... e mais ${stats.missing - 30}` : ''
              }`
            )
          }
          break
        }

        case 'duplicates': {
          const dupes = await getDuplicateStickers(user.id)
          if (dupes.length === 0) {
            await sendText(phone, 'Você não tem figurinhas repetidas ainda.')
          } else {
            const list = dupes
              .map(
                (d) =>
                  `${d.number}${d.player_name ? ' ' + d.player_name : ''} (x${d.quantity})`
              )
              .join('\n')
            await sendText(
              phone,
              `🔁 *Suas repetidas* (${dupes.length} figurinhas):\n\n${list}`
            )
          }
          break
        }

        case 'trades': {
          // Show pending trade requests
          const supabaseAdmin = getAdmin()
          const { data: pending } = await supabaseAdmin
            .from('trade_requests')
            .select('id, requester_id, they_have, i_have, distance_km, token, created_at')
            .eq('target_id', user.id)
            .eq('status', 'pending')
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(5)

          if (!pending || pending.length === 0) {
            await sendText(
              phone,
              `📋 Nenhuma solicitação de troca pendente.\n\nAbra o app para encontrar trocas:\n${APP_URL}/trades`
            )
          } else {
            // Get requester names
            const requesterIds = pending.map((p) => p.requester_id)
            const { data: profiles } = await supabaseAdmin
              .from('profiles')
              .select('id, display_name')
              .in('id', requesterIds)

            const nameMap = new Map((profiles || []).map((p) => [p.id, p.display_name || 'Usuário']))

            let msg = `🔔 *${pending.length} solicitação(ões) de troca pendente(s):*\n\n`

            for (const req of pending) {
              const name = nameMap.get(req.requester_id) || 'Usuário'
              const distStr = req.distance_km != null ? `${Math.round(req.distance_km)}km` : '?'
              const total = (req.they_have || 0) + (req.i_have || 0)
              const approveUrl = `${APP_URL}/trade-approve?token=${req.token}&action=approve`

              msg += `👤 *${name}* (${distStr})\n`
              msg += `   ${total} figurinhas para trocar\n`
              msg += `   ✅ Aceitar: ${approveUrl}\n\n`
            }

            msg += `Ou abra o app: ${APP_URL}/trades`
            await sendText(phone, msg)
          }
          break
        }

        case 'help':
        default: {
          await sendText(
            phone,
            `⚽ *O que posso fazer:*\n\n` +
              `📊 *status* — seu progresso\n` +
              `🔍 *faltando* — o que falta\n` +
              `🔁 *repetidas* — pra trocar\n` +
              `🔔 *trocas* — ver solicitações pendentes\n` +
              `📸 Mande uma *foto* pra eu escanear!\n\n` +
              `Acesse o app: ${APP_URL}`
          )
          break
        }
      }

      return NextResponse.json({ ok: true })
    }

    // Other message types (video, document, etc.)
    await sendText(phone, 'Eu entendo texto e fotos! 📸 Manda uma foto do álbum ou digite *status*.')
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('WhatsApp webhook error:', err)
    return NextResponse.json({ ok: true }) // Always return 200 to Z-API
  }
}

// Z-API may send GET to verify webhook
export async function GET() {
  return NextResponse.json({ status: 'ok' })
}
