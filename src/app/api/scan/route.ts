import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { cookies } from 'next/headers'
import { getScanLimit, type Tier } from '@/lib/tiers'
import { checkRateLimit, getIp, scanLimiter } from '@/lib/ratelimit'
import { createPerfLogger } from '@/lib/perf'
import { backgroundHealthPing } from '@/lib/health-ping'

export const maxDuration = 60

// All valid country codes in our database
const VALID_CODES = [
  'FIFA', 'QAT', 'ECU', 'SEN', 'NED', 'ENG', 'IRN', 'USA', 'WAL',
  'ARG', 'KSA', 'MEX', 'POL', 'FRA', 'AUS', 'DEN', 'TUN', 'ESP',
  'CRC', 'GER', 'JPN', 'BEL', 'CAN', 'MAR', 'CRO', 'BRA', 'SRB',
  'SUI', 'CMR', 'POR', 'GHA', 'URU', 'KOR',
]

const SYSTEM_INSTRUCTION = `You are a Panini FIFA World Cup sticker scanner (supports ALL editions: Qatar 2022, USA/Canada/Mexico 2026, etc).

You analyze photos of Panini stickers and identify each one. Photos may show:
- FRONT of stickers (player photo, name printed at bottom, country flag, 3-letter code like "BRA")
- BACK of stickers (sticker number printed like "BRA 10", "FRA 19")
- Album pages with filled and empty slots
- Multiple stickers loose on a table

CRITICAL — HOW TO READ PANINI STICKERS:
- The PLAYER NAME is printed in large letters at the bottom of the sticker (e.g., "NEYMAR JR", "CASEMIRO", "MARQUINHOS", "LIONEL MESSI")
- The 3-LETTER COUNTRY CODE is near the flag (e.g., "BRA", "ARG", "FRA", "POR")
- ⚠️ DO NOT confuse these numbers with the sticker number:
  - The 4-digit year (e.g., 2010, 2019) = year of national team debut, NOT the sticker number
  - Height/weight numbers (e.g., 1.75, 68) = player stats, NOT the sticker number
- The actual STICKER NUMBER follows format: CODE + space/hyphen + small number (e.g., "BRA 17", "ARG 20", "FRA 19"). It may be printed small on the front or clearly on the back.
- If you CANNOT see a clear sticker number in CODE-NUMBER format, leave sticker_number as "" — the system will match by player name instead.

For EACH sticker visible, extract:
1. "player_name": Read the EXACT name printed. "NEYMAR JR" ≠ "CASEMIRO" ≠ "MARQUINHOS". For emblems/badges use "Emblem". For team photos use "Team Photo".
2. "country_code": The 3-letter code. Valid codes: ${VALID_CODES.join(', ')}
3. "sticker_number": ONLY if you see a clear CODE-NUMBER (e.g., "BRA-17"). Use hyphen format. If unsure, use "".
4. "status": "filled" (actual sticker) or "empty" (empty album slot)
5. "confidence": YOUR HONEST confidence 0.0 to 1.0 — see CONFIDENCE RULES below.

Return ONLY valid JSON:
{
  "scan_confidence": 0.7,
  "image_quality": "high" | "medium" | "low",
  "stickers": [
    {"player_name": "Neymar Jr", "country_code": "BRA", "sticker_number": "BRA-17", "status": "filled", "confidence": 0.95},
    {"player_name": "Lionel Messi", "country_code": "ARG", "sticker_number": "", "status": "filled", "confidence": 0.65}
  ],
  "warnings": []
}

CONFIDENCE RULES — BE HONEST, users rely on this to decide what to save:
- 0.95+: You can CLEARLY read the full printed name AND country code — sharp image, no doubt.
- 0.80-0.94: You can read most of the name but some letters are slightly unclear.
- 0.60-0.79: Image is blurry/small, you're making an educated guess based on partial text or context.
- 0.40-0.59: You can barely read the text, mostly guessing from uniform color, position, or one visible word.
- Below 0.40: Do NOT include the sticker — skip it entirely.
- CRITICAL: If the image is low resolution or blurry, ALL confidences MUST be lower. A blurry photo CANNOT have 0.95 confidence.
- scan_confidence reflects OVERALL image quality: "low" quality photo → scan_confidence ≤ 0.5.
- image_quality: "high" = sharp/clear text readable, "medium" = somewhat blurry but names partially readable, "low" = very blurry/small/dark.

DUPLICATE RULES — BE CONSERVATIVE:
- ONLY report a sticker as duplicate if you can CLEARLY see TWO separate physical copies of the SAME sticker in the image.
- Each physical copy must be visibly distinct (different position, separate edges visible).
- If you see ONE sticker and you're not 100% sure there's a second copy, report it ONCE only.
- NEVER assume duplicates — if in doubt, report ONE copy. The user can scan again.
- Wrong duplicates are WORSE than missing duplicates for the user.

OTHER RULES:
- CRITICAL: Read EVERY SINGLE sticker visible — count them first, then list each one. Left-to-right, top-to-bottom.
- CRITICAL: Read the ACTUAL name printed on the sticker — do NOT guess or infer from jersey number. Each player has a unique name.
- CRITICAL: Emblems/badges showing a country crest (e.g., CBF logo for Brazil, AFA logo for Argentina, FFF logo for France) are stickers too — include them with player_name "Emblem".
- Player name is the PRIMARY identifier. Getting the name right is more important than the number.
- If you see the BACK of a sticker, the CODE-NUMBER printed there IS the sticker number.
- If the image is not sticker-related: {"error": "not_album_page", "message": "description"}
- PREFER skipping a sticker over guessing wrong. A wrong identification hurts the user more than a missed one.`

// ── Module-level sticker cache (avoids loading 670+ stickers from DB on every scan) ──
type CachedSticker = { id: number; number: string; player_name: string; country: string; section: string; type: string }
let stickerCache: {
  data: CachedSticker[]
  numberMap: Map<string, CachedSticker>
  nameByCountry: Map<string, Map<string, CachedSticker>>
  nameFlat: Map<string, CachedSticker>
  loadedAt: number
} | null = null
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getStickersWithCache(supabaseAdmin: any): Promise<typeof stickerCache> {
  if (stickerCache && Date.now() - stickerCache.loadedAt < CACHE_TTL_MS) {
    return stickerCache
  }

  const { data: allDbStickers, error: dbError } = await supabaseAdmin
    .from('stickers')
    .select('id, number, player_name, country, section, type')

  if (dbError) {
    console.error('[scan] DB error loading stickers:', dbError.message)
  }

  if (!allDbStickers || allDbStickers.length === 0) {
    return null
  }

  const stickers = allDbStickers as CachedSticker[]

  // Build lookup maps
  const numberMap = new Map(stickers.map((s) => [s.number.toUpperCase(), s]))
  const nameByCountry = new Map<string, Map<string, CachedSticker>>()
  const nameFlat = new Map<string, CachedSticker>()

  for (const s of stickers) {
    const code = s.number.split('-')[0]
    const normName = normalizeName(s.player_name)

    if (!nameByCountry.has(code)) nameByCountry.set(code, new Map())
    nameByCountry.get(code)!.set(normName, s)

    if (!nameFlat.has(normName)) {
      nameFlat.set(normName, s)
    }
  }

  stickerCache = { data: stickers, numberMap, nameByCountry, nameFlat, loadedAt: Date.now() }
  console.log(`[scan] Cached ${allDbStickers.length} stickers (TTL: 1h)`)
  return stickerCache
}

export async function POST(request: NextRequest) {
  backgroundHealthPing() // fire-and-forget system monitor
  const perf = createPerfLogger('scan')

  // Rate limit
  const rlResponse = await checkRateLimit(getIp(request), scanLimiter)
  if (rlResponse) return rlResponse

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

    // 2. Parse & validate request
    const body = await request.json()
    const { image, mimeType } = body as { image: string; mimeType: string }

    if (!image || !mimeType) {
      return NextResponse.json({ error: 'Nenhuma imagem recebida. Tente novamente.' }, { status: 400 })
    }

    // Validate mimeType
    const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']
    if (!ALLOWED_MIMES.includes(mimeType)) {
      return NextResponse.json({ error: 'Formato de imagem não suportado. Use JPEG, PNG ou WebP.' }, { status: 400 })
    }

    // Validate base64 size (approximate decoded size: base64 is ~4/3 of original)
    const approxSizeBytes = image.length * 0.75
    const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB
    if (approxSizeBytes > MAX_IMAGE_SIZE) {
      return NextResponse.json({ error: 'Imagem muito grande. Máximo 10MB. Tente tirar mais perto.' }, { status: 400 })
    }
    if (image.length < 100) {
      return NextResponse.json({ error: 'Imagem muito pequena ou corrompida. Tente outra foto.' }, { status: 400 })
    }

    perf.mark('auth')
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

    perf.mark('usage')

    // 5. Load stickers with module-level cache (avoids 670+ row query on every scan)
    const cached = await getStickersWithCache(supabaseAdmin)

    if (!cached) {
      return NextResponse.json(
        { error: 'Dados de figurinhas não encontrados. Contate o suporte.' },
        { status: 500 }
      )
    }

    const { numberMap, nameByCountry, nameFlat } = cached
    perf.mark('cache')

    // 6. Call Gemini — try primary model, fallback to lite if it fails
    const genAI = new GoogleGenerativeAI(apiKey)
    const MODELS = [
      'gemini-2.5-flash',           // principal — melhor qualidade estável
      'gemini-2.5-flash-lite',      // fallback 1 — estável, leve
      'gemini-2.0-flash-001',       // fallback 2 — legado, sempre disponível
    ]
    const geminiPayload = [
      {
        inlineData: {
          mimeType,
          data: image,
        },
      },
      { text: 'Identify ALL physical stickers in this photo. First assess the image quality (high/medium/low). Then COUNT every physical sticker you can see. List EVERY one with the EXACT name printed on the sticker — read carefully, do NOT guess. Be HONEST with confidence scores — blurry/small images CANNOT have 95% confidence. Only report duplicates if you can CLEARLY see two separate physical copies. Scan left-to-right, top-to-bottom. Do NOT confuse the year (2010, 2019) with the sticker number. Return JSON.' },
    ]

    let responseText = ''
    let geminiMs = 0
    let usedModel = ''

    const isRetryable = (msg: string) =>
      msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED') ||
      msg.includes('Too Many') || msg.includes('404') || msg.includes('not found') ||
      msg.includes('deprecated') || msg.includes('503') || msg.includes('UNAVAILABLE') ||
      msg.includes('500') || msg.includes('INTERNAL')

    for (let i = 0; i < MODELS.length; i++) {
      const modelName = MODELS[i]
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: SYSTEM_INSTRUCTION,
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            maxOutputTokens: 8192,
          },
        })

        console.log(`[scan] Trying ${modelName}...`)
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
        console.error(`[scan] ${modelName} failed:`, msg.substring(0, 200))
        if (isRetryable(msg) && i < MODELS.length - 1) {
          // Exponential backoff: 500ms, 1500ms before next model
          const backoffMs = 500 * Math.pow(3, i)
          console.log(`[scan] Backing off ${backoffMs}ms before next model...`)
          await new Promise((r) => setTimeout(r, backoffMs))
          continue
        }
        if (!isRetryable(msg)) throw modelErr
      }
    }

    perf.mark('gemini')

    if (!responseText) {
      return NextResponse.json(
        {
          error: 'Scanner temporariamente indisponível. Use a entrada manual no álbum.',
          fallback: true,
        },
        { status: 503 }
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
      confidence: number
      quantity: number
    }> = []
    const unmatched: string[] = []
    const seenIds = new Set<number>()

    // Detect image quality from base64 size (small image = low quality)
    const imageSizeKB = image.length * 0.75 / 1024
    const serverQuality: 'high' | 'medium' | 'low' =
      imageSizeKB < 50 ? 'low' : imageSizeKB < 150 ? 'medium' : 'high'
    const qualityPenalty = serverQuality === 'low' ? 0.7 : serverQuality === 'medium' ? 0.85 : 1.0

    for (const detected of stickersArr) {
      const playerName = detected.player_name || ''
      const countryCode = (detected.country_code || detected.country || '').toUpperCase().trim()
      const stickerNumber = (detected.sticker_number || detected.number || '').toUpperCase().trim()
      const normPlayer = normalizeName(playerName)

      let dbSticker: CachedSticker | null = null
      let matchType: 'number' | 'exact_name_country' | 'fuzzy_name_country' | 'exact_name_flat' | 'fuzzy_cross_country' = 'fuzzy_cross_country'

      // ── Priority 1: Match by sticker number (e.g., back of sticker shows "BRA-10") ──
      if (stickerNumber) {
        dbSticker = findByNumber(stickerNumber, numberMap)
        if (dbSticker) matchType = 'number'
      }

      // ── Priority 2: Match by player name + country ──
      if (!dbSticker && normPlayer && normPlayer.length >= 2) {
        if (countryCode) {
          // Try exact country code
          const countryMap = nameByCountry.get(countryCode)
          if (countryMap) {
            const exactMatch = countryMap.get(normPlayer)
            if (exactMatch) {
              dbSticker = exactMatch
              matchType = 'exact_name_country'
            } else {
              const fuzzyMatch = fuzzyNameMatch(normPlayer, countryMap)
              if (fuzzyMatch) {
                dbSticker = fuzzyMatch
                matchType = 'fuzzy_name_country'
              }
            }
          }
          // Try country name → code mapping
          if (!dbSticker) {
            const mappedCode = COUNTRY_TO_CODE[countryCode] || COUNTRY_TO_CODE[normalizeName(countryCode)]
            if (mappedCode) {
              const mappedMap = nameByCountry.get(mappedCode)
              if (mappedMap) {
                const exactMatch = mappedMap.get(normPlayer)
                if (exactMatch) {
                  dbSticker = exactMatch
                  matchType = 'exact_name_country'
                } else {
                  const fuzzyMatch = fuzzyNameMatch(normPlayer, mappedMap)
                  if (fuzzyMatch) {
                    dbSticker = fuzzyMatch
                    matchType = 'fuzzy_name_country'
                  }
                }
              }
            }
          }
        }

        // Flat name match (ignore country)
        if (!dbSticker) {
          const flatMatch = nameFlat.get(normPlayer)
          if (flatMatch) {
            dbSticker = flatMatch
            matchType = 'exact_name_flat'
          }
        }

        // Fuzzy match across all countries
        if (!dbSticker) {
          nameByCountry.forEach((countryMap) => {
            if (!dbSticker) {
              const found = fuzzyNameMatch(normPlayer, countryMap)
              if (found) {
                dbSticker = found
                matchType = 'fuzzy_cross_country'
              }
            }
          })
        }
      }

      // Skip if we have nothing to match on
      if (!dbSticker && !normPlayer && !stickerNumber) continue

      // ── Calculate server-side confidence (DON'T trust Gemini's self-reported value) ──
      const matchConfidence: Record<string, number> = {
        number: 0.97,                // Sticker number match = near certain
        exact_name_country: 0.92,    // Exact name + right country = very good
        fuzzy_name_country: 0.72,    // Fuzzy name + right country = decent
        exact_name_flat: 0.75,       // Exact name, no country verification = decent
        fuzzy_cross_country: 0.50,   // Fuzzy name, wrong/no country = risky
      }
      const baseConfidence = matchConfidence[matchType] || 0.5
      const finalConfidence = Math.round(baseConfidence * qualityPenalty * 100) / 100

      if (dbSticker) {
        if (!seenIds.has(dbSticker.id)) {
          seenIds.add(dbSticker.id)
          matched.push({
            sticker_id: dbSticker.id,
            number: dbSticker.number,
            player_name: dbSticker.player_name,
            country: dbSticker.country,
            status: detected.status || 'filled',
            confidence: finalConfidence,
            quantity: 1,
          })
        } else {
          // Same sticker seen again in this scan → increment quantity
          const existing = matched.find((m) => m.sticker_id === dbSticker!.id)
          if (existing) existing.quantity = (existing.quantity || 1) + 1
        }
        console.log(`[scan] ✓ "${playerName || stickerNumber}" (${countryCode}) → ${dbSticker.number} ${dbSticker.player_name} [${matchType}, ${finalConfidence}]`)
      } else if (!normPlayer && !stickerNumber) {
        // Skip — nothing to match on
      } else {
        unmatched.push(playerName ? `${playerName} (${countryCode})` : stickerNumber)
        console.log(`[scan] ✗ "${playerName}" (${countryCode}) → no match`)
      }
    }

    perf.mark('match')
    perf.end({ matched: matched.length, unmatched: unmatched.length, model: usedModel })

    if (unmatched.length > 0 && matched.length > 0) {
      warnings.push(`${unmatched.length} figurinha(s) não encontrada(s) no álbum: ${unmatched.slice(0, 3).join(', ')}${unmatched.length > 3 ? '...' : ''}`)
    }

    if (matched.length === 0 && stickersArr.length > 0) {
      console.error('[scan] ZERO matches! Names:', stickersArr.map((s) => s.player_name))
      warnings.push('Nenhuma figurinha pôde ser associada ao álbum. Verifique se as figurinhas são da Copa 2022.')
    }

    if (serverQuality === 'low') {
      warnings.push('Foto com pouca qualidade — confira cada figurinha antes de salvar.')
    }

    // Log confidence distribution for monitoring
    const confDist = matched.reduce((acc, m) => {
      const bucket = m.confidence >= 0.85 ? 'high' : m.confidence >= 0.6 ? 'medium' : 'low'
      acc[bucket] = (acc[bucket] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    console.log(`[scan] Confidence: ${JSON.stringify(confDist)}, imageQuality: ${serverQuality} (${imageSizeKB.toFixed(0)}KB)`)

    return NextResponse.json({
      matched,
      unmatched,
      warnings,
      confidence: serverQuality,
      imageQuality: serverQuality,
      scanUsage: scansRemaining !== null
        ? { remaining: scansRemaining, limit: usageData?.limit ?? tierScanLimit }
        : undefined,
      _debug: {
        geminiDetected: stickersArr.length,
        matched: matched.length,
        unmatched: unmatched.length,
        geminiMs,
        model: usedModel,
      },
    })
  } catch (err) {
    perf.end({ error: 'true' })
    console.error('[scan] Error:', err)

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

    return NextResponse.json({ error: message, _debug: { errorMsg: errMsg } }, { status })
  }
}

// ── Matching helpers ──

// Reuse CachedSticker type alias for matching functions
type DbSticker = CachedSticker

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
  nameMap: Map<string, CachedSticker>,
) {
  const targetParts = normTarget.split(' ')
  const targetLast = targetParts[targetParts.length - 1]
  const targetFirst = targetParts[0]

  let bestMatch: CachedSticker | null = null
  let bestScore = 0

  nameMap.forEach((sticker, dbNorm) => {
    if (sticker.type !== 'player') return // Skip badges/special for fuzzy

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
  })

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
