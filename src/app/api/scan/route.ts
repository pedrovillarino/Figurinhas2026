import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { cookies } from 'next/headers'

export const maxDuration = 60

const SYSTEM_INSTRUCTION = `You are a Panini FIFA World Cup Qatar 2022 sticker scanner.
Analyze photos of stickers (album pages, loose stickers, or stickers on a table).

For EACH sticker visible, extract:
1. "player_name": The player or item name printed on the sticker (e.g., "NEYMAR JR", "CASEMIRO", "LIONEL MESSI"). For badges/emblems, use "Emblem" or "Team Photo".
2. "country_code": The 3-letter country code visible on the sticker (e.g., "BRA", "ARG", "FRA", "POR", "GER", "ENG"). Look for it near the flag.
3. "status": "filled" if it's an actual sticker (pasted or loose). "empty" if it's just an empty album slot.
4. "confidence": 0.0 to 1.0 — how sure you are about the identification.

Return ONLY valid JSON in this format:
{
  "scan_confidence": 0.9,
  "stickers": [
    {"player_name": "Neymar Jr", "country_code": "BRA", "status": "filled", "confidence": 0.95},
    {"player_name": "Lionel Messi", "country_code": "ARG", "status": "filled", "confidence": 0.90}
  ],
  "warnings": []
}

RULES:
- Read the name EXACTLY as printed on the sticker
- Read the country code EXACTLY as shown (BRA, ARG, FRA, POR, GER, ENG, ESP, etc.)
- For team photo stickers (group photo), use player_name "Team Photo"
- For emblem/badge stickers (team crest), use player_name "Emblem"
- For special stickers (trophy, mascot, stadium), describe what it is
- ALWAYS read ALL stickers visible in the photo — do not skip any
- If the image is not sticker-related: {"error": "not_album_page", "message": "description"}
- Country names in Portuguese for the country field (Brasil, Argentina, França, etc.)`

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

    // 2. Parse request
    const body = await request.json()
    const { image, mimeType } = body as { image: string; mimeType: string }

    if (!image || !mimeType) {
      return NextResponse.json({ error: 'Nenhuma imagem recebida. Tente novamente.' }, { status: 400 })
    }

    console.log(`[scan] Image: ${(image.length * 0.75 / 1024).toFixed(0)}KB, mime: ${mimeType}`)

    // 3. Check Gemini API key
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey || apiKey === 'your-gemini-api-key-here') {
      return NextResponse.json(
        { error: 'Serviço de scan temporariamente indisponível. Tente mais tarde.' },
        { status: 503 }
      )
    }

    // 4. Load ALL stickers from DB for name-based matching
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

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
    // Map: normalized_name -> sticker (per country code)
    // e.g., "BRA" -> { "neymar jr" -> {id, number, ...}, "casemiro" -> {...} }
    const nameByCountry = new Map<string, Map<string, typeof allDbStickers[0]>>()
    // Also a flat name map for fallback (ignoring country)
    const nameFlat = new Map<string, typeof allDbStickers[0]>()

    for (const s of allDbStickers) {
      const code = s.number.split('-')[0] // "BRA", "ARG", etc.
      const normName = normalizeName(s.player_name)

      if (!nameByCountry.has(code)) nameByCountry.set(code, new Map())
      nameByCountry.get(code)!.set(normName, s)

      // Flat map — only if not ambiguous (same name in multiple countries is rare for players)
      if (!nameFlat.has(normName)) {
        nameFlat.set(normName, s)
      }
    }

    // 5. Call Gemini
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    })

    console.log('[scan] Calling Gemini...')
    const geminiStart = Date.now()

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType,
          data: image,
        },
      },
      { text: 'Identify all stickers in this photo. Return player names and country codes as JSON.' },
    ])

    const geminiMs = Date.now() - geminiStart
    const responseText = result.response.text()
    console.log(`[scan] Gemini: ${geminiMs}ms, ${responseText.length} chars`)
    console.log('[scan] Response:', responseText.substring(0, 1200))

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
      const normPlayer = normalizeName(playerName)

      if (!normPlayer || normPlayer.length < 2) continue

      let dbSticker = null

      // Strategy 1: Match by name within the country
      if (countryCode) {
        // Try exact country code
        const countryMap = nameByCountry.get(countryCode)
        if (countryMap) {
          dbSticker = countryMap.get(normPlayer) || null
          // Try partial match (first/last name)
          if (!dbSticker) {
            dbSticker = fuzzyNameMatch(normPlayer, countryMap)
          }
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

      // Strategy 2: Flat name match (ignore country)
      if (!dbSticker) {
        dbSticker = nameFlat.get(normPlayer) || null
      }

      // Strategy 3: Fuzzy match across all countries
      if (!dbSticker) {
        for (const [, countryMap] of nameByCountry) {
          const found = fuzzyNameMatch(normPlayer, countryMap)
          if (found) {
            dbSticker = found
            break
          }
        }
      }

      if (dbSticker && !seenIds.has(dbSticker.id)) {
        seenIds.add(dbSticker.id)
        matched.push({
          sticker_id: dbSticker.id,
          number: dbSticker.number,
          player_name: dbSticker.player_name,
          country: dbSticker.country,
          status: detected.status || 'filled',
        })
        console.log(`[scan] ✓ "${playerName}" (${countryCode}) → ${dbSticker.number} ${dbSticker.player_name}`)
      } else if (!dbSticker) {
        unmatched.push(`${playerName} (${countryCode})`)
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
      _debug: {
        geminiDetected: stickersArr.length,
        matched: matched.length,
        unmatched: unmatched.length,
        geminiMs,
        totalMs,
      },
    })
  } catch (err) {
    const totalMs = Date.now() - startTime
    console.error(`[scan] Error after ${totalMs}ms:`, err)

    const errMsg = err instanceof Error ? err.message : String(err)

    let message = 'Algo deu errado no scan. Tente novamente.'
    let status = 500

    if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('Too Many Requests') || errMsg.includes('RESOURCE_EXHAUSTED')) {
      message = 'Muitos scans seguidos! Espere um minutinho e tente de novo. ☕'
      status = 429
    } else if (errMsg.includes('timeout') || errMsg.includes('DEADLINE_EXCEEDED')) {
      message = 'O scan demorou demais. Tente uma foto com melhor iluminação. 📷'
    } else if (errMsg.includes('403') || errMsg.includes('PERMISSION_DENIED')) {
      message = 'Serviço de scan temporariamente indisponível. Tente mais tarde.'
      status = 503
    } else if (errMsg.includes('404') || errMsg.includes('not found')) {
      message = 'Serviço de scan em manutenção. Tente em alguns minutos.'
      status = 503
    } else if (errMsg.includes('500') || errMsg.includes('INTERNAL')) {
      message = 'O serviço de scan está instável. Tente em instantes.'
    }

    return NextResponse.json({ error: message, _debug: { errorMsg: errMsg, totalMs } }, { status })
  }
}

// ── Matching helpers ──

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
