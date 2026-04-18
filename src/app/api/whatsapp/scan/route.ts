import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { sendText } from '@/lib/zapi'
import { getScanLimit, type Tier } from '@/lib/tiers'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br').trim()

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const SCAN_INSTRUCTION = `Você é um scanner de figurinhas Panini da Copa do Mundo FIFA 2026 (edição USA/Canadá/México).

Você pode receber:
1. Uma foto de uma PÁGINA INTEIRA do álbum — identifique todos os slots visíveis.
2. Uma foto de FIGURINHAS SOLTAS (uma ou várias) — identifique cada uma.

COMO LER UMA FIGURINHA PANINI:
- O NOME DO JOGADOR está impresso em letras grandes na parte inferior (ex: "NEYMAR JR", "CASEMIRO", "MARQUINHOS")
- O CÓDIGO DO PAÍS (3 letras) está perto da bandeira (ex: "BRA", "ARG", "FRA")
- ⚠️ NÃO confunda estes números com o número da figurinha:
  - Ano de 4 dígitos (ex: 2010, 2019) = ano de estreia na seleção, NÃO é número da figurinha
  - Números de altura/peso (ex: 1.75, 68) = estatísticas do jogador
- O NÚMERO DA FIGURINHA tem formato: CÓDIGO + espaço/hífen + número pequeno (ex: "BRA 17", "ARG 20"). Pode estar impresso pequeno na frente ou claramente no verso.
- Se NÃO conseguir ver um número no formato CÓDIGO-NÚMERO, deixe "number" como "" — o sistema encontra pelo nome.

TIPOS DE FIGURINHAS:
- Jogadores: têm nome do jogador impresso
- Emblemas/Escudos: mostram o brasão da seleção (ex: CBF, AFA, FFF) → use "Emblem"
- Foto do time: foto coletiva → use "Team Photo"
- Estádios e logos FIFA: figurinhas especiais (ex: FWC-1)

REGRAS:
- "filled": figurinha colada ou fotografada solta.
- "empty": espaço vazio no álbum.
- CRÍTICO: Identifique TODAS as figurinhas — jogadores, emblemas, escudos, fotos de time. NÃO pule nenhuma.
- CRÍTICO: Leia o nome EXATO. "MARQUINHOS" ≠ "NEYMAR JR" ≠ "CASEMIRO". Cada jogador é único.
- CRÍTICO DUPLICATAS: Se houver DUAS ou MAIS cópias da MESMA figurinha (ex: dois "NEYMAR JR"), liste CADA cópia como uma entrada SEPARADA no array. O usuário coleciona duplicatas para trocar — cada figurinha física = uma entrada.
- O NOME é o identificador principal. Acertar o nome é mais importante que o número.
- Confiança < 0.7 se incerto. Ignore decorações. Países em Português.

Retorne APENAS JSON válido:
{
  "pages_detected": 1,
  "scan_confidence": 0.9,
  "stickers": [
    {"number": "BRA-1", "player_name": "Emblem", "country": "Brasil", "status": "filled", "confidence": 0.95},
    {"number": "", "player_name": "Neymar Jr", "country": "Brasil", "status": "filled", "confidence": 0.95}
  ],
  "unreadable": [],
  "warnings": []
}`

// ── Matching helpers (same logic as /api/scan) ──

function normalizeName(name: string): string {
  return name
    .toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

type DbSticker = { id: number; number: string; player_name: string; country: string; type: string }

function fuzzyNameMatch(normTarget: string, stickers: DbSticker[]): DbSticker | null {
  const targetParts = normTarget.split(' ')
  const targetLast = targetParts[targetParts.length - 1]
  const targetFirst = targetParts[0]

  let best: DbSticker | null = null
  let bestScore = 0

  for (const s of stickers) {
    if (s.type !== 'player') continue
    const dbNorm = normalizeName(s.player_name)
    const dbParts = dbNorm.split(' ')
    const dbLast = dbParts[dbParts.length - 1]
    const dbFirst = dbParts[0]

    // Full contains
    if (normTarget.includes(dbNorm) || dbNorm.includes(normTarget)) {
      if (bestScore < 5) { best = s; bestScore = 5 }
    }
    // Exact last name
    if (targetLast === dbLast && targetLast.length >= 3) {
      if (bestScore < 3) { best = s; bestScore = 3 }
    }
    // First name match (single-name players: Neymar, Casemiro)
    if (targetFirst === dbFirst && targetFirst.length >= 4) {
      if (bestScore < 2) { best = s; bestScore = 2 }
    }
    // Cross-match first ↔ full
    if (targetFirst === dbNorm || dbFirst === normTarget) {
      if (bestScore < 3) { best = s; bestScore = 3 }
    }
  }

  return best
}

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  'brasil': 'BRA', 'brazil': 'BRA', 'argentina': 'ARG', 'franca': 'FRA', 'france': 'FRA',
  'portugal': 'POR', 'alemanha': 'GER', 'germany': 'GER', 'inglaterra': 'ENG', 'england': 'ENG',
  'espanha': 'ESP', 'spain': 'ESP', 'holanda': 'NED', 'netherlands': 'NED', 'japao': 'JPN',
  'japan': 'JPN', 'coreia': 'KOR', 'korea': 'KOR', 'marrocos': 'MAR', 'morocco': 'MAR',
  'croacia': 'CRO', 'croatia': 'CRO', 'belgica': 'BEL', 'belgium': 'BEL', 'canada': 'CAN',
  'mexico': 'MEX', 'uruguai': 'URU', 'uruguay': 'URU', 'suica': 'SUI', 'switzerland': 'SUI',
  'camaroes': 'CMR', 'cameroon': 'CMR', 'dinamarca': 'DEN', 'denmark': 'DEN', 'tunisia': 'TUN',
  'ira': 'IRN', 'iran': 'IRN', 'servia': 'SRB', 'serbia': 'SRB', 'gana': 'GHA', 'ghana': 'GHA',
  'catar': 'QAT', 'qatar': 'QAT', 'equador': 'ECU', 'ecuador': 'ECU', 'senegal': 'SEN',
  'gales': 'WAL', 'wales': 'WAL', 'australia': 'AUS', 'polonia': 'POL', 'poland': 'POL',
  'costa rica': 'CRC', 'arabia saudita': 'KSA', 'saudi arabia': 'KSA', 'eua': 'USA', 'fifa': 'FIFA',
}

// ── Module-level sticker cache for WhatsApp scan ──
let waCache: { stickers: DbSticker[]; byNumber: Map<string, DbSticker>; byCountry: Map<string, DbSticker[]>; at: number } | null = null
const WA_CACHE_TTL = 60 * 60 * 1000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getWaCache(db: any) {
  if (waCache && Date.now() - waCache.at < WA_CACHE_TTL) return waCache
  // Fetch in pages to avoid Supabase 1000-row default limit
  const [p1, p2] = await Promise.all([
    db.from('stickers').select('id, number, player_name, country, type').range(0, 999),
    db.from('stickers').select('id, number, player_name, country, type').range(1000, 1999),
  ])
  const data = [...(p1.data || []), ...(p2.data || [])]
  if (!data || data.length === 0) return null

  const stickers = data as DbSticker[]
  const byNumber = new Map(stickers.map((s: DbSticker) => [s.number.toUpperCase(), s]))
  const byCountry = new Map<string, DbSticker[]>()
  for (const s of stickers) {
    const code = s.number.split('-')[0]
    if (!byCountry.has(code)) byCountry.set(code, [])
    byCountry.get(code)!.push(s)
  }
  waCache = { stickers, byNumber, byCountry, at: Date.now() }
  console.log(`[WhatsApp scan] Cached ${stickers.length} stickers`)
  return waCache
}

function matchSticker(
  detected: { number?: string; player_name?: string; country?: string },
  cache: NonNullable<typeof waCache>
): DbSticker | null {
  const stickerNum = (detected.number || '').toUpperCase().trim()
  const playerName = detected.player_name || ''
  const country = (detected.country || '').trim()
  const normPlayer = normalizeName(playerName)

  // Priority 1: exact number match
  if (stickerNum) {
    // Try as-is, then normalize separators
    const exact = cache.byNumber.get(stickerNum)
    if (exact) return exact
    const normalized = stickerNum.replace(/\s+/g, '-').replace(/\.+/g, '-').replace(/_+/g, '-').replace(/-+/g, '-')
    const norm = cache.byNumber.get(normalized)
    if (norm) return norm
    // "BRA10" → "BRA-10"
    const noSep = stickerNum.match(/^([A-Z]{2,5})(\d+)$/)
    if (noSep) {
      const found = cache.byNumber.get(`${noSep[1]}-${noSep[2]}`)
      if (found) return found
    }
  }

  // Priority 2: name + country
  if (normPlayer && normPlayer.length >= 2) {
    // Resolve country code
    const normCountry = normalizeName(country)
    const code = COUNTRY_NAME_TO_CODE[normCountry] || COUNTRY_NAME_TO_CODE[country.toUpperCase()] || country.toUpperCase()
    const countryStickers = cache.byCountry.get(code)

    if (countryStickers) {
      // Exact name in country
      const exactName = countryStickers.find(s => normalizeName(s.player_name) === normPlayer)
      if (exactName) return exactName
      // Fuzzy in country
      const fuzzy = fuzzyNameMatch(normPlayer, countryStickers)
      if (fuzzy) return fuzzy
    }

    // Flat name search across all
    const exactFlat = cache.stickers.find(s => normalizeName(s.player_name) === normPlayer)
    if (exactFlat) return exactFlat

    // Fuzzy across all
    const fuzzyAll = fuzzyNameMatch(normPlayer, cache.stickers)
    if (fuzzyAll) return fuzzyAll
  }

  // Priority 3: special types (Emblem, Team Photo) + country
  if (normPlayer === 'emblem' || normPlayer === 'team photo') {
    const normCountry = normalizeName(country)
    const code = COUNTRY_NAME_TO_CODE[normCountry] || COUNTRY_NAME_TO_CODE[country.toUpperCase()] || country.toUpperCase()
    const countryStickers = cache.byCountry.get(code)
    if (countryStickers) {
      const typeMatch = normPlayer === 'emblem' ? 'badge' : 'player'
      const special = countryStickers.find(s =>
        normalizeName(s.player_name) === normPlayer ||
        (s.type === typeMatch) ||
        (normPlayer === 'emblem' && s.player_name.toLowerCase().includes('emblem')) ||
        (normPlayer === 'team photo' && s.player_name.toLowerCase().includes('team photo'))
      )
      if (special) return special
    }
  }

  return null
}

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

    // Load sticker cache
    const cache = await getWaCache(adminDb)
    if (!cache) {
      await sendText(phone, 'Erro ao carregar figurinhas. Tenta de novo! 📸')
      return NextResponse.json({ ok: true })
    }

    // Scan with Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const models = [
      'gemini-2.5-flash',
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
          { text: 'Identifique TODAS as figurinhas nesta foto — jogadores, emblemas, escudos, fotos de time. Leia o nome EXATO de cada jogador. Retorne JSON.' },
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

    if (filledStickers.length === 0) {
      await sendText(phone, 'Não encontrei figurinhas coladas nessa foto. Tenta outra! 📸')
      return NextResponse.json({ ok: true })
    }

    // Match each detected sticker using fuzzy matching (with quantity tracking)
    const stickerQty = new Map<number, { sticker: DbSticker; qty: number }>()
    const unmatchedNames: string[] = []

    for (const detected of filledStickers) {
      const matched = matchSticker(detected, cache)
      if (matched) {
        const existing = stickerQty.get(matched.id)
        if (existing) {
          existing.qty += 1
        } else {
          stickerQty.set(matched.id, { sticker: matched, qty: 1 })
        }
        console.log(`[WhatsApp scan] ✓ "${detected.player_name}" (${detected.country}) → ${matched.number} ${matched.player_name}`)
      } else {
        const label = detected.player_name || detected.number || '?'
        unmatchedNames.push(label)
        console.log(`[WhatsApp scan] ✗ "${detected.player_name}" (${detected.country}) → no match`)
      }
    }

    const dbStickers = Array.from(stickerQty.values())

    if (dbStickers.length === 0) {
      const names = unmatchedNames.slice(0, 5).join(', ')
      await sendText(phone, `Encontrei figurinha(s) mas não consegui identificar no banco: ${names}. Tenta pelo site! 📸\n\n${APP_URL}/scan`)
      return NextResponse.json({ ok: true })
    }

    // Check which ones user already has
    const { data: existing } = await adminDb
      .from('user_stickers')
      .select('sticker_id, status, quantity')
      .eq('user_id', userId)
      .in('sticker_id', dbStickers.map((s) => s.sticker.id))

    const existingMap = new Map((existing || []).map((e) => [e.sticker_id, e]))

    // Build preview list
    const previewLines: string[] = []
    const scanData: Array<{ sticker_id: number; number: string; player_name: string; quantity: number }> = []

    for (const { sticker, qty } of dbStickers) {
      const ex = existingMap.get(sticker.id)
      const label = `${sticker.number} ${sticker.player_name || ''}`.trim()
      const qtyLabel = qty > 1 ? ` (x${qty})` : ''

      if (!ex) {
        previewLines.push(qty > 1 ? `🆕 ${label}${qtyLabel}` : `🆕 ${label}`)
      } else if (ex.status === 'owned') {
        previewLines.push(`🔁 ${label}${qtyLabel} _(repetida)_`)
      } else if (ex.status === 'duplicate') {
        previewLines.push(`🔁 ${label}${qtyLabel} _(rep x${ex.quantity + qty})_`)
      }

      scanData.push({ sticker_id: sticker.id, number: sticker.number, player_name: sticker.player_name || '', quantity: qty })
    }

    // Save pending scan (expires in 1 hour — DB default)
    await adminDb.from('pending_scans').insert({
      user_id: userId,
      phone,
      scan_data: scanData,
    })

    // Check how many total pending scans this user has now
    const { count: pendingCount } = await adminDb
      .from('pending_scans')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gt('expires_at', new Date().toISOString())

    const totalPending = pendingCount || 1
    const totalStickersFound = dbStickers.reduce((sum, s) => sum + s.qty, 0)

    // Build message — different wording for first scan vs subsequent
    let msg: string
    if (totalPending === 1) {
      // First (or only) scan pending
      msg = `📋 *Encontrei ${totalStickersFound} figurinha(s):*\n\n`
      msg += previewLines.join('\n')
      msg += '\n\n💡 Pode mandar mais fotos! Quando terminar:'
      msg += '\n✅ *SIM* → registra tudo de uma vez'
      msg += '\n❌ *NÃO* → cancela tudo'
      msg += '\n\n⏰ _Expira em 1h se não responder_'
    } else {
      // Additional scans — accumulating
      msg = `📋 *+${totalStickersFound} figurinha(s) detectada(s):*\n\n`
      msg += previewLines.join('\n')
      msg += `\n\n📦 *${totalPending} fotos pendentes no total.*`
      msg += '\nMande mais fotos ou responda:'
      msg += '\n✅ *SIM* → registra todas de uma vez'
      msg += '\n❌ *NÃO* → cancela todas'
    }

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
