import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { sendText, formatPhone } from '@/lib/zapi'
import { checkRateLimit, getIp, webhookLimiter } from '@/lib/ratelimit'
import { backgroundHealthPing } from '@/lib/health-ping'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br').trim()

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
  "intent": "status|missing|duplicates|trades|ranking|register|help|unknown",
  "confidence": 0.95,
  "response_hint": "brief note about what the user wants"
}

Intent definitions:
- status: user wants their collection progress/stats
- missing: user wants list of stickers they still need
- duplicates: user wants list of sticker duplicates to trade
- trades: user wants to see pending trade requests or trade status
- ranking: user wants to see their ranking position
- register: user is typing sticker codes/numbers to register them (e.g. "BRA-1 BRA-5 ARG-3" or "bra 1, bra 5, arg 3" or "BRA1 BRA5")
- help: user wants to know what the bot can do, asks about pricing/plans/how it works, gives feedback/suggestions/bug reports, or greets
- unknown: anything else

Be generous: "oi" → help, "quanto tenho" → status, "progresso" → status,
"quais me faltam" → missing, "faltando" → missing, "faltam" → missing,
"o que tenho repetido" → duplicates, "repetidas" → duplicates, "duplicatas" → duplicates,
"trocas pendentes" → trades, "aceitar troca" → trades, "trocas" → trades,
"ranking" → ranking, "posição" → ranking, "colocação" → ranking, "placar" → ranking,
"BRA-1 ARG-3" → register, any list of sticker codes → register,
"sugestão" → help, "ideia" → help, "bug" → help, "problema" → help, "faq" → help, "planos" → help, "preço" → help, "como funciona" → help.`

// ─── Sticker scan prompt (same as /api/whatsapp/scan) ───
const SCAN_INSTRUCTION = `Você é um scanner de figurinhas Panini da Copa do Mundo FIFA 2026 (edição USA/Canadá/México).

COMO LER UMA FIGURINHA PANINI:
- O NOME DO JOGADOR está em letras grandes na parte inferior (ex: "NEYMAR JR", "CASEMIRO", "MARQUINHOS")
- O CÓDIGO DO PAÍS (3 letras) está perto da bandeira (ex: "BRA", "ARG", "FRA")
- ⚠️ NÃO confunda: ano de 4 dígitos (2010, 2019) = ano de estreia, NÃO é número da figurinha. Altura/peso também NÃO.
- O NÚMERO DA FIGURINHA tem formato CÓDIGO-NÚMERO (ex: "BRA 17"). Se não conseguir ver, deixe "" — o sistema encontra pelo nome.

REGRAS:
- CRÍTICO: Leia o nome EXATO. "MARQUINHOS" ≠ "NEYMAR JR" ≠ "CASEMIRO".
- CRÍTICO: Se há DUAS cópias da mesma figurinha, liste CADA uma separadamente.
- O NOME é o identificador principal.
- Emblemas/escudos (CBF, AFA, FFF) → player_name "Emblem"
- Fotos de time → player_name "Team Photo"
- Países em Português.

Retorne APENAS JSON:
{
  "pages_detected": 1,
  "scan_confidence": 0.9,
  "stickers": [
    {"number": "", "player_name": "Neymar Jr", "country": "Brasil", "status": "filled", "confidence": 0.95}
  ],
  "unreadable": [],
  "warnings": []
}`

// ─── Welcome message for unknown users ───
function getWelcomeMessage(phone: string) {
  return `Olá! 👋 Sou o assistente do *Complete Aí* ⚽

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

  // Try exact match first, then without country code (55), then with +55
  const variants = [
    phone,
    phone.replace(/^55/, ''),
    `+${phone}`,
    `+55${phone.replace(/^55/, '')}`,
  ]

  for (const variant of variants) {
    const { data } = await supabase
      .from('profiles')
      .select('id, display_name, phone, tier')
      .eq('phone', variant)
      .single()
    if (data) return data
  }

  return null
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

  const total = totalStickers || 1028
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
  // Use gemini-2.5-flash for WhatsApp — much faster than 2.5-flash for image analysis
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SCAN_INSTRUCTION,
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  })

  const result = await model.generateContent([
    { inlineData: { mimeType, data: imageBase64 } },
    { text: 'Identify the sticker(s) in this photo. Return JSON.' },
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
async function saveScannedStickers(userId: string, stickerNumbers: string[], playerNames?: string[]) {
  const supabase = getAdmin()

  // Match by number first
  const { data: dbStickers } = await supabase
    .from('stickers')
    .select('id, number, player_name')
    .in('number', stickerNumbers)

  // If no match by number, try by player name
  if ((!dbStickers || dbStickers.length === 0) && playerNames && playerNames.length > 0) {
    const names = playerNames.filter(Boolean).map(n => n.trim())
    if (names.length > 0) {
      for (const name of names) {
        const { data: byName } = await supabase
          .from('stickers')
          .select('id, number, player_name')
          .ilike('player_name', `%${name}%`)
          .limit(1)
        if (byName && byName.length > 0) {
          if (!dbStickers) {
            return saveScannedStickersFromList(userId, byName)
          }
          // Add to existing results if not already there
          const existingIds = new Set(dbStickers.map(s => s.id))
          byName.forEach(s => { if (!existingIds.has(s.id)) dbStickers.push(s) })
        }
      }
    }
  }

  if (!dbStickers || dbStickers.length === 0) return { saved: 0, numbers: [] }

  return batchSaveStickers(supabase, userId, dbStickers.map((s) => ({ sticker_id: s.id, number: s.number })))
}

// Helper for when we already resolved DB stickers by name
async function saveScannedStickersFromList(userId: string, dbStickers: { id: number; number: string; player_name: string }[]) {
  const supabase = getAdmin()
  return batchSaveStickers(supabase, userId, dbStickers.map((s) => ({ sticker_id: s.id, number: s.number })))
}

/**
 * Batch save stickers — single query to fetch existing, then batch upserts.
 * Replaces the old N-query-per-sticker loop.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function batchSaveStickers(supabase: any, userId: string, stickers: { sticker_id: number; number: string; quantity?: number }[]) {
  if (stickers.length === 0) return { saved: 0, numbers: [] }

  // 1. Single query: fetch existing stickers for this user
  const { data: existing } = await supabase
    .from('user_stickers')
    .select('sticker_id, status, quantity')
    .eq('user_id', userId)
    .in('sticker_id', stickers.map((s) => s.sticker_id))

  const existingMap = new Map((existing || []).map((e: { sticker_id: number; status: string; quantity: number }) => [e.sticker_id, e]))

  // 2. Categorize: new inserts vs updates
  const toInsert: Array<{ user_id: string; sticker_id: number; status: string; quantity: number }> = []
  const toUpdate: Array<{ sticker_id: number; status: string; quantity: number }> = []
  const savedNumbers: string[] = []
  const now = new Date().toISOString()

  for (const sticker of stickers) {
    const qty = sticker.quantity || 1
    const ex = existingMap.get(sticker.sticker_id) as { status: string; quantity: number } | undefined
    if (!ex) {
      toInsert.push({ user_id: userId, sticker_id: sticker.sticker_id, status: qty > 1 ? 'duplicate' : 'owned', quantity: qty })
      savedNumbers.push(qty > 1 ? `${sticker.number} (x${qty})` : sticker.number)
    } else if (ex.status === 'owned') {
      toUpdate.push({ sticker_id: sticker.sticker_id, status: 'duplicate', quantity: ex.quantity + qty })
      savedNumbers.push(`${sticker.number} (rep${qty > 1 ? ` x${ex.quantity + qty}` : ''})`)
    } else if (ex.status === 'duplicate') {
      toUpdate.push({ sticker_id: sticker.sticker_id, status: 'duplicate', quantity: ex.quantity + qty })
      savedNumbers.push(`${sticker.number} (rep x${ex.quantity + qty})`)
    }
  }

  // 3. Batch insert new stickers (single query)
  if (toInsert.length > 0) {
    await supabase.from('user_stickers').insert(toInsert)
  }

  // 4. Batch update existing stickers (upsert with onConflict)
  if (toUpdate.length > 0) {
    const upsertData = toUpdate.map((u) => ({
      user_id: userId,
      sticker_id: u.sticker_id,
      status: u.status,
      quantity: u.quantity,
      updated_at: now,
    }))
    await supabase.from('user_stickers').upsert(upsertData, { onConflict: 'user_id,sticker_id' })
  }

  return { saved: toInsert.length + toUpdate.length, numbers: savedNumbers }
}

// ─── Download image from Z-API URL ───
async function downloadImage(url: string, messageId?: string): Promise<{ base64: string; mimeType: string } | null> {
  // Try Z-API's get-media-message endpoint first (more reliable)
  if (messageId) {
    try {
      const INSTANCE_ID = process.env.ZAPI_INSTANCE_ID!
      const TOKEN = process.env.ZAPI_TOKEN!
      const CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN!
      const zapiUrl = `https://api.z-api.io/instances/${INSTANCE_ID}/token/${TOKEN}/download-media-message/${messageId}`
      const res = await fetch(zapiUrl, {
        headers: { 'Client-Token': CLIENT_TOKEN },
      })
      if (res.ok) {
        const data = await res.json()
        if (data.url) {
          const imgRes = await fetch(data.url)
          if (imgRes.ok) {
            const buffer = await imgRes.arrayBuffer()
            return {
              base64: Buffer.from(buffer).toString('base64'),
              mimeType: imgRes.headers.get('content-type') || 'image/jpeg',
            }
          }
        }
      }
    } catch (err) {
      console.error('Z-API media download error:', err)
    }
  }

  // Fallback: direct URL download (with and without auth)
  try {
    const CLIENT_TOKEN_FALLBACK = process.env.ZAPI_CLIENT_TOKEN || ''
    // Try with Client-Token first (Z-API URLs may require it)
    let res = await fetch(url, {
      headers: CLIENT_TOKEN_FALLBACK ? { 'Client-Token': CLIENT_TOKEN_FALLBACK } : {},
    })
    // If auth header caused issues, try without
    if (!res.ok && CLIENT_TOKEN_FALLBACK) {
      res = await fetch(url)
    }
    if (!res.ok) {
      console.error('[WhatsApp] Direct image download failed:', res.status, res.statusText)
      return null
    }

    const buffer = await res.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const mimeType = res.headers.get('content-type') || 'image/jpeg'

    return { base64, mimeType }
  } catch (err) {
    console.error('[WhatsApp] Direct image download error:', err)
    return null
  }
}

// ─── Cleanup expired pending scans (fire-and-forget, throttled) ───
let lastCleanup = 0
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes

function cleanupExpiredScans() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now

  const supabase = getAdmin()
  Promise.resolve(supabase
    .from('pending_scans')
    .delete()
    .lt('expires_at', new Date().toISOString()))
    .then(({ error, count }) => {
      if (error) console.error('[cleanup] Failed to delete expired scans:', error.message)
      else if (count && count > 0) console.log(`[cleanup] Deleted ${count} expired pending scans`)
    })
    .catch(() => {}) // fire-and-forget
}

// ─── Dedup: avoid processing same message twice (Map with TTL) ───
const recentMessages = new Map<string, number>()
const DEDUP_TTL_MS = 5 * 60 * 1000 // 5 minutes
const DEDUP_MAX_SIZE = 500

function isDuplicate(messageId: string): boolean {
  if (!messageId) return false
  const now = Date.now()

  // Periodically clean expired entries (every check, but it's cheap for <500 items)
  if (recentMessages.size > DEDUP_MAX_SIZE / 2) {
    const expired: string[] = []
    recentMessages.forEach((timestamp, id) => {
      if (now - timestamp > DEDUP_TTL_MS) expired.push(id)
    })
    expired.forEach((id) => recentMessages.delete(id))
  }

  if (recentMessages.has(messageId)) return true
  recentMessages.set(messageId, now)
  return false
}

// ─── Main webhook handler ───
export async function POST(req: NextRequest) {
  backgroundHealthPing() // fire-and-forget system monitor

  // Cleanup expired pending scans (fire-and-forget, max once per 10 min)
  cleanupExpiredScans()

  // Rate limit by IP
  const rlResponse = await checkRateLimit(getIp(req), webhookLimiter)
  if (rlResponse) return rlResponse

  try {
    const body = await req.json()

    // Dedup — Z-API can send multiple webhooks for same message
    const msgId = body.messageId || body.id?.id || body.ids?.[0] || ''
    if (isDuplicate(msgId)) {
      return NextResponse.json({ ok: true })
    }

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

    // Z-API may send type in different formats — detect by content
    const rawType = body.type || ''
    const hasImage = !!(body.image?.imageUrl || body.image?.url || body.imageUrl)
    const hasText = !!(body.text?.message || body.body || body.message || '').toString().trim()
    const hasAudio = !!(body.audio?.audioUrl || body.audio?.url)

    const messageType = hasImage ? 'image'
      : (rawType === 'audio' || rawType === 'ptt' || hasAudio) ? 'audio'
      : hasText ? 'text'
      : rawType

    console.log('[WhatsApp webhook]', { phone, rawType, messageType, hasImage, hasText, bodyKeys: Object.keys(body) })

    // Find user by phone
    const user = await findUserByPhone(phone)

    // Unknown user → welcome message
    if (!user) {
      await sendText(phone, getWelcomeMessage(phone))
      return NextResponse.json({ ok: true })
    }

    // ─── Audio ───
    if (messageType === 'audio') {
      await sendText(phone, 'Ainda não processo áudios 😅 Manda texto ou foto!')
      return NextResponse.json({ ok: true })
    }

    // ─── Image ───
    if (messageType === 'image') {
      const imageUrl = body.image?.imageUrl || body.image?.url || body.imageUrl
      const imageBase64 = body.image?.base64 || body.base64 || null

      if (!imageUrl && !imageBase64) {
        await sendText(phone, 'Não consegui baixar a imagem. Tenta mandar de novo? 📸')
        return NextResponse.json({ ok: true })
      }

      // Scan credits are checked inside the /api/whatsapp/scan route
      // All tiers have scan credits (free=5, estreante=50, etc.)

      // Download image
      let imageData: { base64: string; mimeType: string } | null = null
      if (imageBase64) {
        imageData = { base64: imageBase64, mimeType: 'image/jpeg' }
      } else {
        imageData = await downloadImage(imageUrl, msgId)
      }

      if (!imageData) {
        await sendText(phone, 'Não consegui baixar a imagem. Tenta mandar de novo? 📸')
        return NextResponse.json({ ok: true })
      }

      await sendText(phone, '🔍 Analisando sua foto... aguarde!')

      // Run scan in background using waitUntil (continues after response)
      waitUntil(
        fetch(`${APP_URL}/api/whatsapp/scan`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': process.env.SUPABASE_SERVICE_ROLE_KEY!,
          },
          body: JSON.stringify({
            base64: imageData.base64,
            mimeType: imageData.mimeType,
            phone,
            userId: user.id,
          }),
        }).catch((err) => console.error('[WhatsApp] Failed to trigger scan:', err))
      )

      return NextResponse.json({ ok: true })
    }

    // ─── Text ───
    if (messageType === 'text') {
      const text = body.text?.message || body.body || body.message || ''

      if (!text.trim()) {
        return NextResponse.json({ ok: true })
      }

      const lower = text.trim().toLowerCase()

      // ─── Check for pending scan confirmation ───
      if (/^(sim|s|yes|y|confirma|ok)$/i.test(lower.trim())) {
        const supabaseAdmin = getAdmin()
        const { data: allPending } = await supabaseAdmin
          .from('pending_scans')
          .select('id, user_id, scan_data, expires_at, created_at')
          .eq('user_id', user.id)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: true })

        if (allPending && allPending.length > 0) {
          // Merge all pending scans into one list, summing quantities for same sticker
          const allStickers = new Map<number, { sticker_id: number; number: string; player_name: string; quantity: number }>()
          for (const pending of allPending) {
            const scanData = pending.scan_data as Array<{ sticker_id: number; number: string; player_name: string; quantity?: number }>
            for (const s of scanData) {
              const existing = allStickers.get(s.sticker_id)
              if (existing) {
                existing.quantity += (s.quantity || 1)
              } else {
                allStickers.set(s.sticker_id, { ...s, quantity: s.quantity || 1 })
              }
            }
          }
          const mergedStickers = Array.from(allStickers.values())

          // Batch save using shared helper (single insert + single upsert instead of N queries)
          const { saved, numbers: savedNumbers } = await batchSaveStickers(
            supabaseAdmin,
            user.id,
            mergedStickers.map((s) => ({ sticker_id: s.sticker_id, number: s.number, quantity: s.quantity }))
          )
          const savedLines = savedNumbers.map((n) => `• ${n}`)

          // Delete all pending scans
          await supabaseAdmin.from('pending_scans').delete().eq('user_id', user.id)

          // Get updated stats
          const stats = await getUserStats(user.id)

          const fromPhotos = allPending.length > 1 ? ` (de ${allPending.length} fotos)` : ''
          let reply = `✅ *${saved} figurinha(s) registrada(s)!*${fromPhotos}\n\n`
          reply += savedLines.join('\n') + '\n\n'
          reply += `📊 Progresso: *${stats.owned}/${stats.total}* (${stats.pct}%)`

          await sendText(phone, reply)
          return NextResponse.json({ ok: true })
        }
        // No pending scan — fall through to normal intent handling
      }

      if (/^(n[aã]o|n|cancelar|cancel)$/i.test(lower.trim())) {
        const supabaseAdmin = getAdmin()
        const { data: allPending } = await supabaseAdmin
          .from('pending_scans')
          .select('id')
          .eq('user_id', user.id)
          .gt('expires_at', new Date().toISOString())

        if (allPending && allPending.length > 0) {
          await supabaseAdmin.from('pending_scans').delete().eq('user_id', user.id)
          await sendText(phone, `❌ ${allPending.length} foto(s) cancelada(s). Nada foi registrado.\nMande outra foto para tentar novamente! 📸`)
          return NextResponse.json({ ok: true })
        }
      }

      // Fast keyword matching before calling Gemini
      let intent: string

      if (/(status|progresso|quanto|meu album|meu álbum|meu progresso|ver album|ver álbum)/.test(lower)) {
        intent = 'status'
      } else if (/(falt|missing|preciso|necessito|que me falta|o que falta|quais faltam)/.test(lower)) {
        intent = 'missing'
      } else if (/(repet|duplic|sobr|troc?ar|pra troc|minhas repetidas|minhas figurinhas repetidas)/.test(lower)) {
        intent = 'duplicates'
      } else if (/(troca|pendente|solicita|aceitar|minhas trocas|ver trocas)/.test(lower)) {
        intent = 'trades'
      } else if (/\b(ranking|posição|posicao|colocação|colocacao|placar)\b/.test(lower)) {
        intent = 'ranking'
      } else if (/[a-z]{2,5}[\s\-]?\d{1,2}/i.test(text) && (text.match(/[a-z]{2,5}[\s\-]?\d{1,2}/gi) || []).length >= 1) {
        // Looks like sticker codes: "BRA-1 ARG-3" or "bra 1, arg 3" or "BRA1"
        intent = 'register'
      } else if (/\b(oi|olá|ola|hey|hi|help|ajuda|menu|início|inicio|como|faq|perguntas?|dúvidas?|planos?|preços?|quanto custa|sugest|ideia|feedback|bug|problema|reclam|melhoria)\b/.test(lower)) {
        intent = 'help'
      } else {
        // Fallback to Gemini for ambiguous messages
        const detected = await detectIntent(text)
        intent = detected.intent
      }

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
              `🔁 *Minhas repetidas* (${dupes.length} figurinhas):\n\n${list}\n\n` +
              `📲 Lista gerada pelo *Complete Aí* — www.completeai.com.br\n` +
              `Escaneie suas figurinhas com IA e complete seu álbum mais rápido!`
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

        case 'register': {
          // Parse sticker codes from text (e.g. "BRA-1 BRA-5 ARG-3" or "bra 1, arg 3")
          const codePattern = /([a-z]{2,5})[\s\-]?(\d{1,2})/gi
          const matches: string[] = []
          let match
          while ((match = codePattern.exec(text)) !== null) {
            matches.push(`${match[1].toUpperCase()}-${match[2]}`)
          }

          if (matches.length === 0) {
            await sendText(phone, '❌ Não consegui identificar códigos de figurinhas. Use o formato: BRA-1 ARG-3 FRA-10')
            break
          }

          const supabaseAdmin = getAdmin()
          // Look up stickers by number
          const { data: foundStickers } = await supabaseAdmin
            .from('stickers')
            .select('id, number, player_name, country')
            .in('number', matches)

          if (!foundStickers || foundStickers.length === 0) {
            await sendText(phone, `❌ Nenhuma figurinha encontrada para: ${matches.join(', ')}\nVerifique os códigos e tente novamente.`)
            break
          }

          // Save as owned
          let saved = 0
          for (const sticker of foundStickers) {
            const { data: existing } = await supabaseAdmin
              .from('user_stickers')
              .select('id, status, quantity')
              .eq('user_id', user.id)
              .eq('sticker_id', sticker.id)
              .single()

            if (existing) {
              if (existing.status === 'owned') {
                await supabaseAdmin.from('user_stickers')
                  .update({ status: 'duplicate', quantity: (existing.quantity ?? 1) + 1, updated_at: new Date().toISOString() })
                  .eq('id', existing.id)
              } else if (existing.status === 'duplicate') {
                await supabaseAdmin.from('user_stickers')
                  .update({ quantity: (existing.quantity ?? 1) + 1, updated_at: new Date().toISOString() })
                  .eq('id', existing.id)
              } else {
                await supabaseAdmin.from('user_stickers')
                  .update({ status: 'owned', quantity: 1, updated_at: new Date().toISOString() })
                  .eq('id', existing.id)
              }
            } else {
              await supabaseAdmin.from('user_stickers').insert({
                user_id: user.id,
                sticker_id: sticker.id,
                status: 'owned',
                quantity: 1,
              })
            }
            saved++
          }

          const notFound = matches.filter(m => !foundStickers.some((s: { number: string }) => s.number === m))
          const stickerList = foundStickers.map((s: { number: string; player_name: string }) => `${s.number} (${s.player_name || ''})`).join('\n')

          let reply = `✅ *${saved} figurinha${saved > 1 ? 's' : ''} registrada${saved > 1 ? 's' : ''}!*\n\n${stickerList}`
          if (notFound.length > 0) {
            reply += `\n\n⚠️ Não encontradas: ${notFound.join(', ')}`
          }
          reply += `\n\n💡 Dica: mande uma *foto* para registrar mais rápido!`

          await sendText(phone, reply)
          break
        }

        case 'ranking': {
          try {
            const { data: rankData } = await getAdmin().rpc('get_user_ranking', { p_user_id: user.id })
            const r = rankData?.[0]
            if (r && r.national_rank) {
              const cityLine = r.city ? `📍 *${r.city}:* #${r.city_rank} de ${r.city_total}\n` : ''
              const stateLine = r.state ? `🗺️ *${r.state}:* #${r.state_rank} de ${r.state_total}\n` : ''
              await sendText(
                phone,
                `🏆 *Seu Ranking*\n\n` +
                `🇧🇷 *Nacional:* #${r.national_rank} de ${r.national_total} colecionadores\n` +
                cityLine + stateLine +
                `\n📊 ${r.owned_count} figurinhas coladas\n\n` +
                `Veja detalhes: ${APP_URL}/ranking`
              )
            } else {
              await sendText(phone, `🏆 Ative sua localização no app para ver seu ranking!\n\n${APP_URL}/ranking`)
            }
          } catch {
            await sendText(phone, `🏆 Veja seu ranking no app:\n${APP_URL}/ranking`)
          }
          break
        }

        case 'help':
        default: {
          const helpName = user.display_name?.split(' ')[0] || ''
          const greeting = helpName ? `Oi, *${helpName}*! ` : ''

          // Check if message looks like feedback/suggestion and forward to admin
          const isFeedback = /sugest|ideia|bug|problema|reclama|feedback|melhoria/i.test(text)
          if (isFeedback && text.length > 5) {
            const adminPhone = process.env.ADMIN_PHONE
            if (adminPhone) {
              sendText(adminPhone, `💡 *Feedback de ${helpName || 'Usuário'}*\n📱 ${phone}\n\n"${text}"`).catch(() => {})
            }
            await sendText(
              phone,
              `💡 Obrigado pelo feedback!\n\nSua mensagem foi encaminhada para nossa equipe. 🙏\n\nDúvidas: contato@completeai.com.br`
            )
            break
          }

          await sendText(
            phone,
            `${greeting}⚽ *O que posso fazer:*\n\n` +
              `📊 *status* — seu progresso\n` +
              `🔍 *faltando* — o que falta\n` +
              `🔁 *repetidas* — pra trocar\n` +
              `🔔 *trocas* — solicitações pendentes\n` +
              `🏆 *ranking* — sua posição\n\n` +
              `📸 Mande uma *foto* pra escanear!\n` +
              `✏️ Ou *digite os códigos*: BRA-1 ARG-3 FRA-10\n\n` +
              `💡 Mande *sugestões* a qualquer momento\n` +
              `❓ FAQ: ${APP_URL}/faq\n` +
              `📱 App: ${APP_URL}`
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
