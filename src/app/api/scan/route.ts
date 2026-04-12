import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { cookies } from 'next/headers'

export const maxDuration = 60

// All valid country codes in our database
const VALID_CODES = [
  'FIFA', 'QAT', 'ECU', 'SEN', 'NED', 'ENG', 'IRN', 'USA', 'WAL',
  'ARG', 'KSA', 'MEX', 'POL', 'FRA', 'AUS', 'DEN', 'TUN', 'ESP',
  'CRC', 'GER', 'JPN', 'BEL', 'CAN', 'MAR', 'CRO', 'BRA', 'SRB',
  'SUI', 'CMR', 'POR', 'GHA', 'URU', 'KOR',
]

const SYSTEM_INSTRUCTION = `You are a Panini FIFA World Cup sticker album scanner. Your job is to read sticker numbers from photos.

STICKER NUMBER FORMAT:
Numbers in this album follow the pattern: CODE-NUMBER
Where CODE is one of: ${VALID_CODES.join(', ')}
And NUMBER is 1 to 20 (or up to 30 for FIFA).

Examples: FIFA-1, BRA-10, ARG-12, GER-5, QAT-1, USA-20, FRA-15

WHAT YOU MIGHT SEE IN PHOTOS:
- Album pages with sticker slots (some filled, some empty)
- Individual loose stickers
- Multiple stickers spread on a table
- The number is usually printed small on the sticker or on the album slot

HOW TO READ NUMBERS:
1. Look for the printed number on each sticker or slot
2. The number might appear as "BRA 1", "BRA-1", "BRA1", or just "1" near a country section
3. ALWAYS output in the format CODE-NUMBER with a hyphen (e.g., "BRA-1", not "BRA 1")
4. If you only see a bare number (like "1" or "15"), determine the country from context (page header, flag, team name visible) and prepend the code
5. If you cannot determine the country for a bare number, skip it

STATUS RULES:
- "filled" = sticker is pasted in the album OR it's a loose/individual sticker
- "empty" = the slot is empty, showing only the placeholder/outline

CONFIDENCE:
- Set confidence to 0.9+ only if you can clearly read the number
- Set confidence below 0.7 if the number is partially obscured or you're guessing
- Set scan_confidence based on overall photo quality

OUTPUT FORMAT (return ONLY this JSON, no other text):
{
  "scan_confidence": 0.9,
  "stickers": [
    {"number": "BRA-1", "player_name": "Player Name", "country": "Brasil", "status": "filled", "confidence": 0.95}
  ],
  "unreadable": [],
  "warnings": []
}

If the image is NOT a sticker/album photo:
{"error": "not_album_page", "message": "description of what you see instead"}

CRITICAL: Read EVERY sticker visible. Do not skip any. Output the country name in Portuguese.`

export async function POST(request: Request) {
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

    // 3. Check Gemini API key
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey || apiKey === 'your-gemini-api-key-here') {
      return NextResponse.json(
        { error: 'Serviço de scan temporariamente indisponível. Tente mais tarde.' },
        { status: 503 }
      )
    }

    // 4. Load ALL stickers from DB upfront for flexible matching
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { data: allDbStickers } = await supabaseAdmin
      .from('stickers')
      .select('id, number, player_name, country, section, type')

    if (!allDbStickers || allDbStickers.length === 0) {
      console.error('No stickers found in database!')
      return NextResponse.json(
        { error: 'Dados de figurinhas não encontrados. Contate o suporte.' },
        { status: 500 }
      )
    }

    // Build multiple lookup maps for flexible matching
    const exactMap = new Map(allDbStickers.map((s) => [s.number.toUpperCase(), s]))
    // Map by just the numeric part per country: "BRA" -> { "1": sticker, "2": sticker, ... }
    const countryNumMap = new Map<string, Map<string, typeof allDbStickers[0]>>()
    for (const s of allDbStickers) {
      const [code, num] = s.number.split('-')
      if (!countryNumMap.has(code)) countryNumMap.set(code, new Map())
      countryNumMap.get(code)!.set(num, s)
    }

    // 5. Call Gemini
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        temperature: 0.1, // Low temperature for precise reading
      },
    })

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType,
          data: image,
        },
      },
      { text: 'Read all sticker numbers visible in this photo. Return the JSON inventory.' },
    ])

    const responseText = result.response.text()
    console.log('Gemini raw response (first 800 chars):', responseText.substring(0, 800))

    // 6. Parse Gemini response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('No JSON in Gemini response:', responseText.substring(0, 300))
      return NextResponse.json(
        { error: 'Não conseguimos analisar a imagem. Tente uma foto mais nítida, com boa iluminação. 📷' },
        { status: 422 }
      )
    }

    let parsed
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch (parseErr) {
      console.error('JSON parse failed:', jsonMatch[0].substring(0, 300))
      return NextResponse.json(
        { error: 'Erro ao processar a análise. Tente tirar a foto novamente.' },
        { status: 422 }
      )
    }

    // Check for Gemini error response
    if (parsed.error) {
      const msg = parsed.error === 'not_album_page'
        ? 'Essa foto não parece ser de figurinhas. Tente fotografar uma página do álbum ou figurinhas soltas.'
        : parsed.message || 'Não conseguimos identificar figurinhas nessa foto.'
      console.log('Gemini classified as error:', parsed.error, parsed.message)
      return NextResponse.json({ error: msg }, { status: 422 })
    }

    if (!parsed.stickers || !Array.isArray(parsed.stickers)) {
      console.error('No stickers array. Keys:', Object.keys(parsed))
      return NextResponse.json(
        { error: 'Não encontramos figurinhas nessa foto. Tente chegar mais perto e com melhor iluminação.' },
        { status: 422 }
      )
    }

    console.log(`Gemini detected ${parsed.stickers.length} stickers:`,
      parsed.stickers.map((s: { number: string; status: string }) => `${s.number}(${s.status})`).join(', ')
    )

    // 7. Normalize and match detected stickers
    const warnings: string[] = [...(parsed.warnings || [])]
    const matched: Array<{
      sticker_id: number
      number: string
      player_name: string | null
      country: string
      status: string
    }> = []
    const unmatched: string[] = []

    for (const detected of parsed.stickers) {
      const raw = String(detected.number || '').trim()
      if (!raw) continue

      const dbSticker = findSticker(raw, exactMap, countryNumMap)

      if (dbSticker) {
        matched.push({
          sticker_id: dbSticker.id,
          number: dbSticker.number,
          player_name: dbSticker.player_name,
          country: dbSticker.country,
          status: detected.status || 'filled',
        })
      } else {
        unmatched.push(raw)
        console.log(`Unmatched sticker: "${raw}" (normalized attempts failed)`)
      }
    }

    console.log(`Matching result: ${matched.length} matched, ${unmatched.length} unmatched`)

    if (unmatched.length > 0 && matched.length > 0) {
      warnings.push(`${unmatched.length} figurinha(s) não reconhecida(s): ${unmatched.slice(0, 5).join(', ')}${unmatched.length > 5 ? '...' : ''}`)
    }

    if (matched.length === 0 && parsed.stickers.length > 0) {
      // Gemini saw stickers but none matched the DB — likely format mismatch
      console.error('Zero matches! Gemini numbers:', parsed.stickers.map((s: { number: string }) => s.number))
      warnings.push('A IA detectou figurinhas mas não conseguiu associar aos números do álbum. Tente uma foto mais nítida dos números.')
    }

    // Check confidence
    if (parsed.scan_confidence && parsed.scan_confidence < 0.5) {
      warnings.push('Qualidade da foto baixa. Confira os resultados com atenção.')
    }
    if (parsed.unreadable && parsed.unreadable.length > 0) {
      warnings.push(`${parsed.unreadable.length} figurinha(s) ilegível(is) na foto.`)
    }

    // Per-sticker low confidence
    const lowConf = parsed.stickers.filter((s: { confidence?: number }) => s.confidence && s.confidence < 0.7)
    if (lowConf.length > 0) {
      warnings.push(`Leitura incerta em ${lowConf.length} figurinha(s). Verifique se estão corretas.`)
    }

    return NextResponse.json({
      matched,
      unmatched,
      warnings,
      confidence: parsed.scan_confidence || parsed.confidence || 'medium',
    })
  } catch (err) {
    console.error('Scan error:', err)

    const errMsg = err instanceof Error ? err.message : String(err)
    let message = 'Algo deu errado no scan. Tente novamente.'
    let status = 500

    if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('Too Many Requests') || errMsg.includes('RESOURCE_EXHAUSTED')) {
      message = 'Muitos scans seguidos! Espere um minutinho e tente de novo. ☕'
      status = 429
    } else if (errMsg.includes('timeout') || errMsg.includes('DEADLINE_EXCEEDED')) {
      message = 'O scan demorou demais. Tente uma foto com melhor iluminação e mais perto das figurinhas. 📷'
    } else if (errMsg.includes('403') || errMsg.includes('PERMISSION_DENIED')) {
      message = 'Serviço de scan temporariamente indisponível. Tente novamente mais tarde.'
      status = 503
    } else if (errMsg.includes('404') || errMsg.includes('not found')) {
      message = 'Serviço de scan em manutenção. Tente novamente em alguns minutos.'
      status = 503
    } else if (errMsg.includes('500') || errMsg.includes('INTERNAL')) {
      message = 'O serviço de scan está instável. Tente novamente em instantes.'
    }

    return NextResponse.json({ error: message }, { status })
  }
}

/**
 * Try to find a sticker in the database using multiple matching strategies.
 * Handles variations like: "BRA-1", "BRA 1", "BRA1", "bra-1", "1" (bare number)
 */
function findSticker(
  raw: string,
  exactMap: Map<string, { id: number; number: string; player_name: string; country: string; section: string; type: string }>,
  countryNumMap: Map<string, Map<string, { id: number; number: string; player_name: string; country: string; section: string; type: string }>>,
) {
  const upper = raw.toUpperCase().trim()

  // Strategy 1: Exact match (e.g., "BRA-1")
  const exact = exactMap.get(upper)
  if (exact) return exact

  // Strategy 2: Normalize separators — "BRA 1", "BRA  1", "BRA.1" → "BRA-1"
  const normalized = upper
    .replace(/\s+/g, '-')    // spaces → hyphen
    .replace(/\.+/g, '-')    // dots → hyphen
    .replace(/_+/g, '-')     // underscores → hyphen
    .replace(/-+/g, '-')     // multiple hyphens → single
  const fromNormalized = exactMap.get(normalized)
  if (fromNormalized) return fromNormalized

  // Strategy 3: No separator — "BRA1" → "BRA-1"
  const noSepMatch = upper.match(/^([A-Z]{2,5})(\d+)$/)
  if (noSepMatch) {
    const withHyphen = `${noSepMatch[1]}-${noSepMatch[2]}`
    const found = exactMap.get(withHyphen)
    if (found) return found
  }

  // Strategy 4: Has a clear CODE-NUMBER pattern but code might be wrong/partial
  const parts = normalized.split('-')
  if (parts.length === 2) {
    const [code, num] = parts
    // Try exact code first
    const countryMap = countryNumMap.get(code)
    if (countryMap) {
      const found = countryMap.get(num)
      if (found) return found
    }
    // Try common code aliases
    const aliases: Record<string, string> = {
      'FWC': 'FIFA', 'WORLD': 'FIFA', 'WC': 'FIFA',
      'BRASIL': 'BRA', 'BRAZIL': 'BRA',
      'ARGENTINA': 'ARG',
      'GERMANY': 'GER', 'ALEMANHA': 'GER', 'DEU': 'GER',
      'FRANCE': 'FRA', 'FRANCA': 'FRA', 'FRANÇA': 'FRA',
      'ENGLAND': 'ENG', 'INGLATERRA': 'ENG',
      'SPAIN': 'ESP', 'ESPANHA': 'ESP',
      'PORTUGAL': 'POR',
      'NETHERLANDS': 'NED', 'HOLANDA': 'NED', 'HOLLAND': 'NED',
      'JAPAN': 'JPN', 'JAPAO': 'JPN', 'JAPÃO': 'JPN',
      'KOREA': 'KOR', 'COREIA': 'KOR',
      'MOROCCO': 'MAR', 'MARROCOS': 'MAR',
      'CROATIA': 'CRO', 'CROACIA': 'CRO', 'CROÁCIA': 'CRO',
      'BELGIUM': 'BEL', 'BELGICA': 'BEL', 'BÉLGICA': 'BEL',
      'CANADA': 'CAN', 'CANADÁ': 'CAN',
      'MEXICO': 'MEX', 'MÉXICO': 'MEX',
      'URUGUAY': 'URU', 'URUGUAI': 'URU',
      'SWITZERLAND': 'SUI', 'SUICA': 'SUI', 'SUÍÇA': 'SUI',
      'CAMEROON': 'CMR', 'CAMAROES': 'CMR', 'CAMARÕES': 'CMR',
      'DENMARK': 'DEN', 'DINAMARCA': 'DEN',
      'TUNISIA': 'TUN', 'TUNISIA': 'TUN', 'TUNÍSIA': 'TUN',
      'IRAN': 'IRN', 'IRÃ': 'IRN',
      'SERBIA': 'SRB', 'SERVIA': 'SRB', 'SÉRVIA': 'SRB',
      'GHANA': 'GHA', 'GANA': 'GHA',
      'QATAR': 'QAT', 'CATAR': 'QAT',
      'ECUADOR': 'ECU', 'EQUADOR': 'ECU',
      'SENEGAL': 'SEN',
      'WALES': 'WAL', 'GALES': 'WAL',
      'AUSTRALIA': 'AUS', 'AUSTRÁLIA': 'AUS',
      'POLAND': 'POL', 'POLONIA': 'POL', 'POLÔNIA': 'POL',
      'COSTARICA': 'CRC', 'COSTA RICA': 'CRC',
      'SAUDI': 'KSA', 'SAUDITA': 'KSA', 'ARABIA': 'KSA',
    }
    const aliasCode = aliases[code]
    if (aliasCode) {
      const aliasMap = countryNumMap.get(aliasCode)
      if (aliasMap) {
        const found = aliasMap.get(num)
        if (found) return found
      }
    }
  }

  // Strategy 5: Bare number — "1", "15" — can't determine country without context
  // We skip these since they're ambiguous (every country has number 1-20)
  // But if there's only ONE sticker with that number across all countries, use it
  if (/^\d+$/.test(upper)) {
    const num = upper
    const candidates: typeof exactMap extends Map<string, infer V> ? V[] : never[] = []
    for (const [, cMap] of countryNumMap) {
      const found = cMap.get(num)
      if (found) candidates.push(found)
    }
    if (candidates.length === 1) return candidates[0]
    // Can't disambiguate — skip
  }

  return null
}
