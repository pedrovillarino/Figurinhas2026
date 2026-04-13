import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { cookies } from 'next/headers'
import { getScanLimit, type Tier } from '@/lib/tiers'

export const maxDuration = 60

// All valid country codes in our database
const VALID_CODES = [
  'FIFA', 'QAT', 'ECU', 'SEN', 'NED', 'ENG', 'IRN', 'USA', 'WAL',
  'ARG', 'KSA', 'MEX', 'POL', 'FRA', 'AUS', 'DEN', 'TUN', 'ESP',
  'CRC', 'GER', 'JPN', 'BEL', 'CAN', 'MAR', 'CRO', 'BRA', 'SRB',
  'SUI', 'CMR', 'POR', 'GHA', 'URU', 'KOR',
]

const SYSTEM_INSTRUCTION = `You are a Panini FIFA World Cup Qatar 2022 sticker scanner.
Analyze photos of stickers — this could be:
- FRONT of stickers (showing player photo, name, country flag)
- BACK of stickers (showing a sticker number like "BRA 10", "FRA 19", "ARG 20")
- Album pages with slots (some filled, some empty)
- Multiple stickers on a table

For EACH sticker visible, extract:
1. "player_name": The player name if visible (e.g., "NEYMAR JR", "CASEMIRO", "LIONEL MESSI"). For badges, use "Emblem" or "Team Photo". If only the back is visible and no name is shown, use "".
2. "country_code": The 3-letter code (e.g., "BRA", "ARG", "FRA"). Look for it on the sticker front near the flag, or on the back.
3. "sticker_number": If you can see a sticker code/number like "BRA 10", "FRA 19", "FIFA 3" — include it here in the format CODE-NUMBER (with a hyphen). Valid codes are: ${VALID_CODES.join(', ')}. If no sticker number is visible, use "".
4. "status": "filled" if it's an actual sticker. "empty" if it's an empty album slot.
5. "confidence": 0.0 to 1.0.

Return ONLY valid JSON:
{
  "scan_confidence": 0.9,
  "stickers": [
    {"player_name": "Alisson", "country_code": "BRA", "sticker_number": "BRA-1", "status": "filled", "confidence": 0.95},
    {"player_name": "Enzo Fernandez", "country_code": "ARG", "sticker_number": "", "status": "filled", "confidence": 0.90}
  ],
  "warnings": []
}

RULES:
- CRITICAL: Read EVERY SINGLE sticker visible — do NOT skip any. Count them first, then list each one.
- CRITICAL: Read the ACTUAL player name printed on the sticker. Do NOT guess or assume — read exactly what is written. "MARQUINHOS" is NOT "NEYMAR JR". Every player has a unique name printed.
- If the photo shows many stickers (e.g. a table full of stickers), scan the image systematically: left-to-right, top-to-bottom, and list ALL of them.
- If you see the BACK of stickers, the number is the most important field
- If you see the FRONT, the player name and country code are most important
- For the sticker_number, ALWAYS use a hyphen between code and number (e.g., "BRA-10" not "BRA 10")
- For team photos, use player_name "Team Photo"
- For emblems/badges, use player_name "Emblem"
- Double-check: did you list every sticker? If you see 15 stickers, your array must have 15 entries.
- If the image is not sticker-related: {"error": "not_album_page", "message": "description"}`

export async function POST(request: Request) {
  const startTime = Date.now()

  try {
    // 1. Validate auth
    const cookieStore = cookies()
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {}
          },
        },
      }
    )
    const { data: { user } } = await supabaseAuth.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Faça login para usar o scanner.' }, { status: 401 })
    }

    // 2. Parse request (do this early so we have body ready)
    const body = await request.json()
    const { image, mimeType } = body as { image: string; mimeType: string }

    if (!image || !mimeType) {
      return NextResponse.json({ error: 'Nenhuma imagem recebida. Tente novamente.' }, { status: 400 })
    }

    console.log(`[scan] Image: ${(image.length * 0.75 / 1024).toFixed(0)}KB, mime: ${mimeType}`)

    // 3. Check scan limit (total per account, based on tier + purchased credits)
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Get user tier
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('tier')
      .eq('id', user.id)
      .single()

    const userTier = (profile?.tier || 'free') as Tier
    const tierScanLimit = getScanLimit(userTier)

    const { data: usageData, error: usageError } = await supabaseAdmin
      .rpc('increment_scan_usage', {
        p_user_id: user.id,
        p_daily_limit: tierScanLimit,
      })

    if (usageError) {
      console.error('[scan] Usage check error:', usageError.message)
      // Don't block on usage tracking errors — just log and continue
    } else if (usageData && !usageData.allowed) {
      console.log(`[scan] User ${user.id} hit scan limit: ${usageData.current}/${usageData.limit} (tier=${userTier})`)

      const isFree = userTier === 'free'
      const canBuyPack = userTier === 'estreante' || userTier === 'colecionador'
      const errorMsg = isFree
        ? 'Você usou seus 5 scans gratuitos! Cada scan detecta várias figurinhas — faça upgrade para continuar.'
        : `Você usou todos os seus ${usageData.limit} scans. Cada scan lê várias figurinhas${canBuyPack ? ' — compre um pacote extra para continuar!' : '.'}`

      return NextResponse.json(
        {
          error: errorMsg,
          scanUsage: usageData,
          needsUpgrade: isFree,
          needsPack: canBuyPack,
        },
        { status: 429 }
      )
    }

    const scansRemaining = usageData?.remaining ?? null
    console.log(`[scan] User scans: ${usageData?.current ?? '?'}/${usageData?.limit ?? tierScanLimit} (tier=${userTier})`)

    // 4. Check Gemini API key
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey || apiKey === 'your-gemini-api-key-here') {
      return NextResponse.json(
        { error: 'Serviço de scan temporariamente indisponível. Tente mais tarde.' },
        { status: 503 }
      )
    }

    // 5. Load ALL stickers from DB for name-based matching
    const { data: allDbStickers, error: dbError } = await supabaseAdmin
      .from('stickers')
      .select('id, number, player_name, country, section, type')

    if (dbError) {
      console.error('[scan] DB error:', dbError.message)
    }

    if (!allDbStickers || allDbStickers.length === 0) {
      return NextResponse.json(
        { error: 'Dados de figurinhas não encontrados. Contate o suporte.' },
        { status: 500 }
      )
    }

    console.log(`[scan] Loaded ${allDbStickers.length} stickers from DB`)

    // Build lookup maps
    // 1. Exact number map: "BRA-10" -> sticker
    const numberMap = new Map(allDbStickers.map((s) => [s.number.toUpperCase(), s]))
    // 2. Name by country: "BRA" -> { "neymar jr" -> sticker }
    const nameByCountry = new Map<string, Map<string, typeof allDbStickers[0]>>()
    // 3. Flat name map for fallback
    const nameFlat = new Map<string, typeof allDbStickers[0]>()

    for (const s of allDbStickers) {
      const code = s.number.split('-')[0]
      const normName = normalizeName(s.player_name)

      if (!nameByCountry.has(code)) nameByCountry.set(code, new Map())
      nameByCountry.get(code)!.set(normName, s)

      if (!nameFlat.has(normName)) {
        nameFlat.set(normName, s)
      }
    }

    // 6. Call Gemini — try primary model, fallback to lite if it fails
    const genAI = new GoogleGenerativeAI(apiKey)
    const MODELS = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']
    const geminiPayload = [
      {
        inlineData: {
          mimeType,
          data: image,
        },
      },
      { text: 'Identify ALL stickers in this photo — do not miss any. First count how many stickers you see, then list every single one. Read player names, country codes, and sticker numbers (if visible on the back). Scan systematically left-to-right, top-to-bottom. Return JSON.' },
    ]

    let responseText = ''
    let geminiMs = 0
    let usedModel = ''

    const isRateLimit = (msg: string) =>
      msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Too Many')
    const isRetryable = (msg: string) =>
      isRateLimit(msg) || msg.includes('404') || msg.includes('not found') || msg.includes('deprecated')
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

    for (const modelName of MODELS) {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: SYSTEM_INSTRUCTION,
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          maxOutputTokens: 8192,
        },
      })

      // Try up to 2 attempts per model (with delay on rate limit)
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (attempt > 0) {
            console.log(`[scan] Retrying ${modelName} after delay...`)
            await delay(4000)
          }
          console.log(`[scan] Trying ${modelName} (attempt ${attempt + 1})...`)
          const geminiStart = Date.now()

          const result = await model.generateContent(geminiPayload)
          geminiMs = Date.now() - geminiStart
          responseText = result.response.text()
          usedModel = modelName
          console.log(`[scan] ${modelName}: ${geminiMs}ms, ${responseText.length} chars`)
          console.log('[scan] Response:', responseText.substring(0, 1200))
          break
        } catch (modelErr) {
          const msg = modelErr instanceof Error ? modelErr.message : String(modelErr)
          console.error(`[scan] ${modelName} attempt ${attempt + 1} failed:`, msg.substring(0, 200))

          if (isRateLimit(msg) && attempt === 0) continue // Retry same model
          if (isRetryable(msg)) break // Move to next model
          throw modelErr // Unknown error
        }
      }
      if (responseText) break // Got a response, stop trying models
    }

    if (!responseText) {
      return NextResponse.json(
        { error: 'Nossos servidores estão ocupados no momento. Tente novamente em 1 minuto.' },
        { status: 429 }
      )
    }

    // 6. Parse response
    let parsed: Record<string, unknown> | null = null
    try {
      parsed = JSON.parse(responseText)
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]) } catch {}
      }
    }

    if (!parsed) {
      console.error('[scan] JSON parse failed:', responseText.substring(0, 300))
      return NextResponse.json(
        { error: 'Não conseguimos analisar a imagem. Tente uma foto mais nítida. 📷' },
        { status: 422 }
      )
    }

    if (parsed.error) {
      const msg = parsed.error === 'not_album_page'
        ? 'Essa foto não parece ser de figurinhas. Tente fotografar figurinhas do álbum.'
        : (parsed.message as string) || 'Não conseguimos identificar figurinhas.'
      return NextResponse.json({ error: msg }, { status: 422 })
    }

    const stickersArr = parsed.stickers as Array<{
      player_name?: string
      country_code?: string
      country?: string
      sticker_number?: string
      number?: string
      status?: string
      confidence?: number
    }> | undefined

    if (!stickersArr || !Array.isArray(stickersArr) || stickersArr.length === 0) {
      return NextResponse.json(
        { error: 'Não encontramos figurinhas nessa foto. Tente chegar mais perto.' },
        { status: 422 }
      )
    }

    console.log(`[scan] Gemini found ${stickersArr.length} stickers:`,
      stickersArr.map((s) => `${s.player_name}(${s.country_code || s.country || '?'})`).join(', ')
    )

    // 7. Match by player name + country
    const warnings: string[] = [...((parsed.warnings as string[]) || [])]
    const matched: Array<{
      sticker_id: number
      number: string
      player_name: string | null
      country: string
      status: string
    }> = []
    const unmatched: string[] = []
    const seenIds = new Set<number>()

    for (const detected of stickersArr) {
      const playerName = detected.player_name || ''
      const countryCode = (detected.country_code || detected.country || '').toUpperCase().trim()
      const stickerNumber = (detected.sticker_number || detected.number || '').toUpperCase().trim()
      const normPlayer = normalizeName(playerName)

      let dbSticker = null

      // ── Priority 1: Match by sticker number (e.g., back of sticker shows "BRA-10") ──
      if (stickerNumber) {
        dbSticker = findByNumber(stickerNumber, numberMap)
      }

      // ── Priority 2: Match by player name + country ──
      if (!dbSticker && normPlayer && normPlayer.length >= 2) {
        if (countryCode) {
          // Try exact country code
          const countryMap = nameByCountry.get(countryCode)
          if (countryMap) {
            dbSticker = countryMap.get(normPlayer) || fuzzyNameMatch(normPlayer, countryMap)
          }
          // Try country name → code mapping
          if (!dbSticker) {
            const mappedCode = COUNTRY_TO_CODE[countryCode] || COUNTRY_TO_CODE[normalizeName(countryCode)]
            if (mappedCode) {
              const mappedMap = nameByCountry.get(mappedCode)
              if (mappedMap) {
                dbSticker = mappedMap.get(normPlayer) || fuzzyNameMatch(normPlayer, mappedMap)
              }
            }
          }
        }

        // Flat name match (ignore country)
        if (!dbSticker) {
          dbSticker = nameFlat.get(normPlayer) || null
        }

        // Fuzzy match across all countries
        if (!dbSticker) {
          for (const [, countryMap] of nameByCountry) {
            const found = fuzzyNameMatch(normPlayer, countryMap)
            if (found) { dbSticker = found; break }
          }
        }
      }

      // Skip if we have nothing to match on
      if (!dbSticker && !normPlayer && !stickerNumber) continue

      if (dbSticker && !seenIds.has(dbSticker.id)) {
        seenIds.add(dbSticker.id)
        matched.push({
          sticker_id: dbSticker.id,
          number: dbSticker.number,
          player_name: dbSticker.player_name,
          country: dbSticker.country,
          status: detected.status || 'filled',
        })
        console.log(`[scan] ✓ "${playerName || stickerNumber}" (${countryCode}) → ${dbSticker.number} ${dbSticker.player_name}`)
      } else if (!dbSticker) {
        unmatched.push(playerName ? `${playerName} (${countryCode})` : stickerNumber)
        console.log(`[scan] ✗ "${playerName}" (${countryCode}) → no match`)
      }
    }

    console.log(`[scan] Result: ${matched.length} matched, ${unmatched.length} unmatched`)

    if (unmatched.length > 0 && matched.length > 0) {
      warnings.push(`${unmatched.length} figurinha(s) não encontrada(s) no álbum: ${unmatched.slice(0, 3).join(', ')}${unmatched.length > 3 ? '...' : ''}`)
    }

    if (matched.length === 0 && stickersArr.length > 0) {
      console.error('[scan] ZERO matches! Names:', stickersArr.map((s) => s.player_name))
      warnings.push('Nenhuma figurinha pôde ser associada ao álbum. Verifique se as figurinhas são da Copa 2022.')
    }

    const scanConf = parsed.scan_confidence as number | undefined
    if (scanConf && scanConf < 0.5) {
      warnings.push('Qualidade da foto baixa. Confira os resultados.')
    }

    const totalMs = Date.now() - startTime

    return NextResponse.json({
      matched,
      unmatched,
      warnings,
      confidence: scanConf || 'high',
      scanUsage: scansRemaining !== null
        ? { remaining: scansRemaining, limit: usageData?.limit ?? tierScanLimit }
        : undefined,
      _debug: {
        geminiDetected: stickersArr.length,
        matched: matched.length,
        unmatched: unmatched.length,
        geminiMs,
        totalMs,
        model: usedModel,
      },
    })
  } catch (err) {
    const totalMs = Date.now() - startTime
    console.error(`[scan] Error after ${totalMs}ms:`, err)

    const errMsg = err instanceof Error ? err.message : String(err)

    let message = 'Não foi possível analisar sua foto. Tente novamente com uma imagem mais nítida e com boa iluminação.'
    let status = 500

    if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('Too Many Requests') || errMsg.includes('RESOURCE_EXHAUSTED')) {
      message = 'Muitos scans sendo processados agora. Espere um minutinho e tente de novo.'
      status = 429
    } else if (errMsg.includes('timeout') || errMsg.includes('DEADLINE_EXCEEDED')) {
      message = 'A análise demorou demais. Tente uma foto com melhor iluminação e mais perto das figurinhas.'
    } else if (errMsg.includes('403') || errMsg.includes('PERMISSION_DENIED')) {
      message = 'Serviço de scan temporariamente indisponível. Tente novamente em alguns minutos.'
      status = 503
    } else if (errMsg.includes('404') || errMsg.includes('not found')) {
      message = 'Serviço de scan em manutenção. Tente novamente em alguns minutos.'
      status = 503
    } else if (errMsg.includes('500') || errMsg.includes('INTERNAL')) {
      message = 'Nosso serviço de scan está instável no momento. Tente novamente em instantes.'
    }

    return NextResponse.json({ error: message, _debug: { errorMsg: errMsg, totalMs } }, { status })
  }
}

// ── Matching helpers ──

type DbSticker = { id: number; number: string; player_name: string; country: string; section: string; type: string }

/** Try to match by sticker number (from back of sticker). Handles "BRA-10", "BRA 10", "BRA10" */
function findByNumber(raw: string, numberMap: Map<string, DbSticker>): DbSticker | null {
  const upper = raw.toUpperCase().trim()

  // Exact: "BRA-10"
  const exact = numberMap.get(upper)
  if (exact) return exact

  // Normalize separators: "BRA 10" → "BRA-10"
  const normalized = upper.replace(/\s+/g, '-').replace(/\.+/g, '-').replace(/_+/g, '-').replace(/-+/g, '-')
  const norm = numberMap.get(normalized)
  if (norm) return norm

  // No separator: "BRA10" → "BRA-10"
  const noSep = upper.match(/^([A-Z]{2,5})(\d+)$/)
  if (noSep) {
    const withHyphen = `${noSep[1]}-${noSep[2]}`
    const found = numberMap.get(withHyphen)
    if (found) return found
  }

  return null
}

/** Normalize a name for comparison: lowercase, remove accents, trim */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-z0-9\s]/g, '')     // remove special chars
    .replace(/\s+/g, ' ')            // collapse spaces
    .trim()
}

/** Try fuzzy matching: last name, first name, contains */
function fuzzyNameMatch(
  normTarget: string,
  nameMap: Map<string, { id: number; number: string; player_name: string; country: string; section: string; type: string }>,
) {
  const targetParts = normTarget.split(' ')
  const targetLast = targetParts[targetParts.length - 1]
  const targetFirst = targetParts[0]

  let bestMatch: { id: number; number: string; player_name: string; country: string; section: string; type: string } | null = null
  let bestScore = 0

  for (const [dbNorm, sticker] of nameMap) {
    if (sticker.type !== 'player') continue // Skip badges/special for fuzzy

    const dbParts = dbNorm.split(' ')
    const dbLast = dbParts[dbParts.length - 1]
    const dbFirst = dbParts[0]

    // Exact last name match (most common: "Messi" matches "Lionel Messi")
    if (targetLast === dbLast && targetLast.length >= 3) {
      if (bestScore < 3) { bestMatch = sticker; bestScore = 3 }
    }

    // Target contains DB name or vice versa
    if (normTarget.includes(dbNorm) || dbNorm.includes(normTarget)) {
      if (bestScore < 4) { bestMatch = sticker; bestScore = 4 }
    }

    // First name match + similar length (for single-name players like "Neymar", "Casemiro")
    if (targetFirst === dbFirst && targetFirst.length >= 4) {
      if (bestScore < 2) { bestMatch = sticker; bestScore = 2 }
    }

    // Last name of target matches first name of DB (e.g., "Neymar Jr" → last="jr", first="neymar")
    if (targetFirst === dbNorm || dbFirst === normTarget) {
      if (bestScore < 3) { bestMatch = sticker; bestScore = 3 }
    }
  }

  return bestMatch
}

/** Map country names/codes to our DB codes */
const COUNTRY_TO_CODE: Record<string, string> = {
  'brasil': 'BRA', 'brazil': 'BRA', 'bra': 'BRA',
  'argentina': 'ARG', 'arg': 'ARG',
  'franca': 'FRA', 'france': 'FRA', 'fra': 'FRA',
  'portugal': 'POR', 'por': 'POR',
  'alemanha': 'GER', 'germany': 'GER', 'ger': 'GER',
  'inglaterra': 'ENG', 'england': 'ENG', 'eng': 'ENG',
  'espanha': 'ESP', 'spain': 'ESP', 'esp': 'ESP',
  'holanda': 'NED', 'netherlands': 'NED', 'ned': 'NED',
  'japao': 'JPN', 'japan': 'JPN', 'jpn': 'JPN',
  'coreia': 'KOR', 'korea': 'KOR', 'kor': 'KOR',
  'marrocos': 'MAR', 'morocco': 'MAR', 'mar': 'MAR',
  'croacia': 'CRO', 'croatia': 'CRO', 'cro': 'CRO',
  'belgica': 'BEL', 'belgium': 'BEL', 'bel': 'BEL',
  'canada': 'CAN', 'can': 'CAN',
  'mexico': 'MEX', 'mex': 'MEX',
  'uruguai': 'URU', 'uruguay': 'URU', 'uru': 'URU',
  'suica': 'SUI', 'switzerland': 'SUI', 'sui': 'SUI',
  'camaroes': 'CMR', 'cameroon': 'CMR', 'cmr': 'CMR',
  'dinamarca': 'DEN', 'denmark': 'DEN', 'den': 'DEN',
  'tunisia': 'TUN', 'tun': 'TUN',
  'ira': 'IRN', 'iran': 'IRN', 'irn': 'IRN',
  'servia': 'SRB', 'serbia': 'SRB', 'srb': 'SRB',
  'gana': 'GHA', 'ghana': 'GHA', 'gha': 'GHA',
  'catar': 'QAT', 'qatar': 'QAT', 'qat': 'QAT',
  'equador': 'ECU', 'ecuador': 'ECU', 'ecu': 'ECU',
  'senegal': 'SEN', 'sen': 'SEN',
  'gales': 'WAL', 'wales': 'WAL', 'wal': 'WAL',
  'australia': 'AUS', 'aus': 'AUS',
  'polonia': 'POL', 'poland': 'POL', 'pol': 'POL',
  'costa rica': 'CRC', 'costarica': 'CRC', 'crc': 'CRC',
  'arabia saudita': 'KSA', 'saudi arabia': 'KSA', 'ksa': 'KSA',
  'eua': 'USA', 'usa': 'USA',
  'fifa': 'FIFA',
}
