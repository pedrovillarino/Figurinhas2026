import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { cookies } from 'next/headers'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { getScanLimit, type Tier } from '@/lib/tiers'
import { checkRateLimit, getIp, scanLimiter } from '@/lib/ratelimit'
import { trackEvent, trackEventOnce, FUNNEL_EVENTS } from '@/lib/funnel'
import { createPerfLogger } from '@/lib/perf'
import { backgroundHealthPing } from '@/lib/health-ping'
import { embedImage } from '@/lib/embeddings'
import { savePendingSample, computeKnnVerdict, type Face } from '@/lib/sample-store'
import { twoPassScan, isTwoPassEnabled } from '@/lib/two-pass-scan'

const ENABLE_KNN_BOOST = process.env.ENABLE_KNN_BOOST === 'true'

export const maxDuration = 60

// VALID_CODES is built dynamically from the database via getStickersWithCache()

// ── Few-shot example images ──
// Drop any of these into public/scan-examples/ to teach Gemini to distinguish
// glued stickers from empty album slots:
//   - empty.jpg   → page with NO stickers (only printed placeholders)
//   - filled.jpg  → page with ALL slots filled (stickers everywhere)
//   - mixed.jpg   → page with SOME slots filled and others empty (real-world)
// Loaded lazily once and cached; missing files are fine — the prompt still
// works on its own.
type FewShotLabel = 'filled' | 'empty' | 'mixed'
type FewShotImage = { mimeType: string; data: string; label: FewShotLabel }
let fewShotCache: { images: FewShotImage[]; loadedAt: number } | null = null
const FEWSHOT_TTL_MS = 10 * 60 * 1000

async function getFewShotImages(): Promise<FewShotImage[]> {
  if (fewShotCache && Date.now() - fewShotCache.loadedAt < FEWSHOT_TTL_MS) {
    return fewShotCache.images
  }
  const dir = path.join(process.cwd(), 'public', 'scan-examples')
  const candidates: Array<{ file: string; label: FewShotLabel }> = [
    { file: 'empty.jpg', label: 'empty' },
    { file: 'mixed.jpg', label: 'mixed' },
    { file: 'filled.jpg', label: 'filled' },
  ]
  const images: FewShotImage[] = []
  for (const { file, label } of candidates) {
    try {
      const buf = await fs.readFile(path.join(dir, file))
      images.push({ mimeType: 'image/jpeg', data: buf.toString('base64'), label })
    } catch {
      // file absent — skip silently
    }
  }
  fewShotCache = { images, loadedAt: Date.now() }
  return images
}

function fewShotPreludeText(label: FewShotLabel): string {
  switch (label) {
    case 'empty':
      return 'REFERENCE EXAMPLE — every rectangle in this image is an EMPTY slot (no sticker glued). Note the blank/light interior with the player code (e.g. "BRA 4") printed inside, and the player name printed in small caps BELOW the rectangle. These are NOT stickers — DO NOT report any of them as detections.'
    case 'filled':
      return 'REFERENCE EXAMPLE — every rectangle in this image is a FILLED slot (a real sticker is glued in). Note the colored player photo, jersey, and graphic background INSIDE each rectangle.'
    case 'mixed':
      return 'REFERENCE EXAMPLE — this is the typical user photo. Some rectangles are FILLED (colored player photo glued inside) and others are EMPTY (blank rectangle with code "BRA 4" printed inside and player name below). Report ONLY the filled ones as stickers; mark the empty ones with status="empty" or omit them.'
  }
}

function buildSystemInstruction(validCodes: string[]): string {
  return `You are a Panini FIFA World Cup sticker scanner.

You analyze photos of Panini stickers and identify each one. Photos may show:
- FRONT of stickers (player photo, name printed at bottom, country flag, 3-letter code like "BRA")
- BACK of stickers (sticker number printed like "BRA 10", "FRA 19")
- Album pages with filled and empty slots
- Multiple stickers loose on a table

🚨 CRITICAL — DO NOT REPORT EMPTY SLOTS AS STICKERS 🚨
The Panini album page pre-prints the sticker number AND the player name UNDER every slot, even before any sticker is glued. This printed reference text is NOT a sticker.
- A FILLED slot has an ACTUAL physical sticker glued in: a colored player PHOTO with team uniform visible, a country flag, holographic/foil shine on emblems, gradient or graphic background, glossy finish.
- An EMPTY slot is just a flat rectangle (usually white, light gray, or a faint silhouette outline) with the player name and code printed BELOW the rectangle as a placeholder reference. There is NO photo, NO color, NO uniform, NO shine inside the rectangle.

If you can see the printed reference name "STEPHEN EUSTÁQUIO" under an empty white rectangle but NO physical sticker is glued there — this is an EMPTY slot. Set status to "empty". DO NOT pretend a sticker is there because the name is printed.

When in doubt: a real sticker is COLORFUL and PHOTOGRAPHIC inside the rectangle. An empty slot is BLANK inside the rectangle (the name is OUTSIDE/BELOW it).

CRITICAL — HOW TO READ PANINI STICKERS:
- The PLAYER NAME is printed in large letters at the bottom of the sticker (e.g., "NEYMAR JR", "CASEMIRO", "MARQUINHOS", "LIONEL MESSI")
- The 3-LETTER COUNTRY CODE is near the flag (e.g., "BRA", "ARG", "FRA", "POR")
- ⚠️ DO NOT confuse these numbers with the sticker number:
  - The 4-digit year (e.g., 2010, 2019) = year of national team debut, NOT the sticker number
  - Height/weight numbers (e.g., 1.75, 68) = player stats, NOT the sticker number
- The actual STICKER NUMBER follows format: CODE + space/hyphen + small number (e.g., "BRA 17", "ARG 20", "FRA 19"). It may be printed small on the front or clearly on the back.
- If you CANNOT see a clear sticker number in CODE-NUMBER format, leave sticker_number as "" — the system will match by player name instead.

CRITICAL — COUNT BEFORE LISTING:
Before identifying any sticker, COUNT the total filled stickers in the photo (left-to-right, top-to-bottom) and put that number in "total_stickers_visible". THEN list one entry per sticker. The size of the "stickers" array MUST EXACTLY equal "total_stickers_visible". If you cannot identify a specific one, STILL add an entry with player_name="?" and confidence=0.3 — do not skip it. We rely on this count to detect when you missed a sticker.

For EACH sticker visible, extract:
1. "player_name": Read the EXACT name printed. "NEYMAR JR" ≠ "CASEMIRO" ≠ "MARQUINHOS". For emblems/badges use "Emblem". For team photos use "Team Photo". For empty slots, leave as "". If unreadable, use "?".
2. "country_code": The 3-letter code. Valid codes: ${validCodes.join(', ')}
3. "sticker_number": ONLY if you see a clear CODE-NUMBER (e.g., "BRA-17"). Use hyphen format. If unsure, use "".
4. "status": "filled" or "empty".
   - "filled" = a REAL physical sticker is present. This includes BOTH the front (player photo, name, flag) AND the back (large sticker number "BRA 17", small print stats, no player photo). Backs are filled stickers turned over — never mark a back as empty.
   - "empty" = album slot with NO sticker at all — a blank rectangle with the player name printed as a placeholder UNDERNEATH it (outside the rectangle). The interior is white/gray with no content.
   When in doubt between front and back, choose front. When in doubt between back and empty, choose back (a back has structured content — number, position, stats, all printed inside).
5. "confidence": YOUR HONEST confidence 0.0 to 1.0 — see CONFIDENCE RULES below.
6. "face": "front" (player photo + name + flag visible) or "back" (only the sticker number visible, no player photo).
7. "bbox": tight bounding box around the sticker, as normalized 0-1 coordinates relative to the WHOLE photo: {"x1": left, "y1": top, "x2": right, "y2": bottom}. Be tight — exclude album page background. If you cannot localize precisely, omit bbox.

Return ONLY valid JSON:
{
  "scan_confidence": 0.7,
  "image_quality": "high" | "medium" | "low",
  "total_stickers_visible": 2,
  "stickers": [
    {"player_name": "Neymar Jr", "country_code": "BRA", "sticker_number": "BRA-17", "status": "filled", "confidence": 0.95, "face": "front", "bbox": {"x1": 0.10, "y1": 0.20, "x2": 0.34, "y2": 0.55}},
    {"player_name": "", "country_code": "ARG", "sticker_number": "ARG-10", "status": "filled", "confidence": 0.85, "face": "back", "bbox": {"x1": 0.40, "y1": 0.20, "x2": 0.64, "y2": 0.55}}
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
}

// ── Module-level sticker cache (avoids loading 670+ stickers from DB on every scan) ──
type CachedSticker = { id: number; number: string; player_name: string; country: string; section: string; type: string }
let stickerCache: {
  data: CachedSticker[]
  numberMap: Map<string, CachedSticker>
  nameByCountry: Map<string, Map<string, CachedSticker>>
  nameFlat: Map<string, CachedSticker>
  validCodes: string[]
  loadedAt: number
} | null = null
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getStickersWithCache(supabaseAdmin: any): Promise<typeof stickerCache> {
  if (stickerCache && Date.now() - stickerCache.loadedAt < CACHE_TTL_MS) {
    return stickerCache
  }

  // Fetch in pages to avoid Supabase 1000-row default limit
  const [page1, page2] = await Promise.all([
    supabaseAdmin.from('stickers').select('id, number, player_name, country, section, type').range(0, 999),
    supabaseAdmin.from('stickers').select('id, number, player_name, country, section, type').range(1000, 1999),
  ])

  const dbError = page1.error || page2.error
  const allDbStickers = [...(page1.data || []), ...(page2.data || [])]

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

  // Extract unique country codes from sticker numbers (e.g., "BRA-17" → "BRA")
  const validCodes = Array.from(new Set(stickers.map((s) => s.number.split('-')[0].toUpperCase())))

  stickerCache = { data: stickers, numberMap, nameByCountry, nameFlat, validCodes, loadedAt: Date.now() }
  console.log(`[scan] Cached ${allDbStickers.length} stickers (TTL: 1h)`)
  return stickerCache
}

export async function POST(request: NextRequest) {
  backgroundHealthPing() // fire-and-forget system monitor
  const requestStart = Date.now()
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

      // Funnel: scan limit hit (paywall trigger)
      trackEvent(user.id, FUNNEL_EVENTS.SCAN_LIMIT_HIT, {
        tier: userTier,
        metadata: { current: usageData.current, limit: usageData.limit },
      })

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

    // Funnel: scan accepted (track-once for first_scan, always for scan_used)
    trackEventOnce(user.id, FUNNEL_EVENTS.FIRST_SCAN, { tier: userTier })
    trackEvent(user.id, FUNNEL_EVENTS.SCAN_USED, {
      tier: userTier,
      metadata: { current: usageData?.current, limit: usageData?.limit },
    })

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
    const fewShotImages = await getFewShotImages()
    const fewShotPrelude: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = []
    for (const ex of fewShotImages) {
      fewShotPrelude.push({ text: fewShotPreludeText(ex.label) })
      fewShotPrelude.push({ inlineData: { mimeType: ex.mimeType, data: ex.data } })
    }

    const geminiPayload = [
      ...fewShotPrelude,
      { text: fewShotImages.length > 0 ? 'NOW analyze the USER\'S PHOTO below using the same filled-vs-empty distinction shown above:' : '' },
      {
        inlineData: {
          mimeType,
          data: image,
        },
      },
      { text: 'Identify ONLY physical stickers actually GLUED to the page in this photo. EMPTY album slots (blank rectangles with player names printed underneath as placeholders) MUST be marked status="empty" — DO NOT invent a sticker just because you see the printed name. First assess the image quality (high/medium/low). Then COUNT every physical sticker. List each with the EXACT name printed on the sticker — read carefully, do NOT guess. Be HONEST with confidence scores — blurry/small images CANNOT have 95% confidence. Only report duplicates if you can CLEARLY see two separate physical copies. Scan left-to-right, top-to-bottom. Do NOT confuse the year (2010, 2019) with the sticker number. Return JSON.' },
    ].filter((p) => !('text' in p) || (p as { text: string }).text.length > 0)
    if (fewShotImages.length > 0) {
      console.log(`[scan] Few-shot prelude: ${fewShotImages.map((x) => x.label).join('+')}`)
    }

    let responseText = ''
    let geminiMs = 0
    let usedModel = ''

    // Two-pass scan path — gated by env SCAN_TWO_PASS=true. Pass 1 detects
    // bbox per sticker; pass 2 reanalyzes each crop in parallel at near-
    // isolated resolution. Output schema is identical to the single-pass
    // JSON, so the rest of the matching pipeline is untouched. Falls back
    // to single-pass on any failure.
    if (isTwoPassEnabled()) {
      const twoPassStart = Date.now()
      try {
        const tp = await twoPassScan({
          imageB64: image,
          mimeType,
          apiKey,
          validCodes: cached!.validCodes,
        })
        if (tp && tp.stickers.length > 0) {
          responseText = JSON.stringify(tp)
          geminiMs = Date.now() - twoPassStart
          usedModel = 'gemini-2.5-flash (two-pass)'
          console.log(`[scan] two-pass ok: ${tp.stickers.length} stickers in ${geminiMs}ms`)
        } else {
          console.warn('[scan] two-pass returned no stickers — falling back to single-pass')
        }
      } catch (err) {
        console.error('[scan] two-pass exception, falling back:', err instanceof Error ? err.message : err)
      }
    }

    const isRetryable = (msg: string) =>
      msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED') ||
      msg.includes('Too Many') || msg.includes('404') || msg.includes('not found') ||
      msg.includes('deprecated') || msg.includes('503') || msg.includes('UNAVAILABLE') ||
      msg.includes('500') || msg.includes('INTERNAL')

    for (let i = 0; i < MODELS.length && !responseText; i++) {
      const modelName = MODELS[i]
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: buildSystemInstruction(cached!.validCodes),
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
      face?: string
      bbox?: { x1: number; y1: number; x2: number; y2: number }
    }> | undefined

    if (!stickersArr || !Array.isArray(stickersArr) || stickersArr.length === 0) {
      return NextResponse.json(
        { error: 'Não encontramos figurinhas nessa foto. Tente chegar mais perto.' },
        { status: 422 }
      )
    }

    // Drop empty album slots — Gemini reports them as detections because the
    // album page pre-prints each player's name under empty slots as a reference.
    // We only want stickers actually glued to the page. EXCEPT: if face='back'
    // (user is photographing the back of a real sticker showing the number),
    // never treat as empty — backs lack player photo by definition but ARE
    // glued physical stickers.
    const rawDetected = stickersArr.length
    const filledStickers = stickersArr.filter((s) => {
      const isEmpty = (s.status || 'filled').toLowerCase() === 'empty'
      const isBack = (s.face || '').toLowerCase() === 'back'
      return !isEmpty || isBack
    })
    const emptyFiltered = rawDetected - filledStickers.length
    if (emptyFiltered > 0) {
      console.log(`[scan] Filtered ${emptyFiltered} empty slot(s) reported by Gemini`)
    }

    if (filledStickers.length === 0) {
      return NextResponse.json(
        { error: 'Só vimos slots vazios nessa foto. Tente fotografar as figurinhas coladas.' },
        { status: 422 }
      )
    }

    // Gap detection: Gemini was asked to count BEFORE listing. If it counted
    // more cromos than it listed, it pulled a "skipped" — surface so the user
    // can re-scan the missed sticker isolated.
    const reportedTotal = typeof (parsed as { total_stickers_visible?: number }).total_stickers_visible === 'number'
      ? (parsed as { total_stickers_visible: number }).total_stickers_visible
      : 0
    const skippedCount = Math.max(0, reportedTotal - filledStickers.length - emptyFiltered)
    if (skippedCount > 0) {
      console.log(`[scan] gap detected: total=${reportedTotal}, filled=${filledStickers.length}, empty=${emptyFiltered}, skipped=${skippedCount}`)
    }

    console.log(`[scan] Gemini found ${filledStickers.length} filled stickers (${emptyFiltered} empty filtered):`,
      filledStickers.map((s) => `${s.player_name}(${s.country_code || s.country || '?'})`).join(', ')
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

    // Active-learning detection events — one entry per sticker Gemini detected
    // and we matched. Used after the loop to crop, embed and persist samples
    // for kNN. Independent of `matched[]` (which dedupes by sticker_id).
    type DetectionEvent = {
      stickerId: number
      face: Face
      bbox?: { x1: number; y1: number; x2: number; y2: number }
      geminiConfidence: number
      matchType: string
    }
    const detectionEvents: DetectionEvent[] = []

    // Detect image quality from base64 size (small image = low quality)
    const imageSizeKB = image.length * 0.75 / 1024
    const serverQuality: 'high' | 'medium' | 'low' =
      imageSizeKB < 50 ? 'low' : imageSizeKB < 150 ? 'medium' : 'high'
    const qualityPenalty = serverQuality === 'low' ? 0.7 : serverQuality === 'medium' ? 0.85 : 1.0

    for (const detected of filledStickers) {
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
        exact_name_country: 0.95,    // Exact name + right country = very good
        fuzzy_name_country: 0.80,    // Fuzzy name + right country = good
        exact_name_flat: 0.82,       // Exact name, no country verification = good
        fuzzy_cross_country: 0.60,   // Fuzzy name, wrong/no country = acceptable
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
        // Active-learning event — keep raw bbox + face for crop/embed pass
        detectionEvents.push({
          stickerId: dbSticker.id,
          face: detected.face === 'back' ? 'back' : 'front',
          bbox: detected.bbox && typeof detected.bbox === 'object'
            ? { x1: Number(detected.bbox.x1), y1: Number(detected.bbox.y1), x2: Number(detected.bbox.x2), y2: Number(detected.bbox.y2) }
            : undefined,
          geminiConfidence: typeof detected.confidence === 'number' ? detected.confidence : finalConfidence,
          matchType,
        })
        console.log(`[scan] ✓ "${playerName || stickerNumber}" (${countryCode}) → ${dbSticker.number} ${dbSticker.player_name} [${matchType}, ${finalConfidence}]`)
      } else if (!normPlayer && !stickerNumber) {
        // Skip — nothing to match on
      } else if (playerName === '?' || normPlayer === '' || normPlayer === '?') {
        // Two-pass returned "?" because Gemini explicitly couldn't read this
        // crop. Don't surface as "didn't recognize" — it's already counted
        // in the gap (skippedCount). Just log and move on.
        console.log(`[scan] ✗ unreadable crop (Gemini returned "?")`)
      } else {
        unmatched.push(playerName ? `${playerName} (${countryCode})` : stickerNumber)
        console.log(`[scan] ✗ "${playerName}" (${countryCode}) → no match`)
      }
    }

    perf.mark('match')
    perf.end({ matched: matched.length, unmatched: unmatched.length, model: usedModel })

    if (unmatched.length > 0 && matched.length > 0) {
      warnings.push(`Não reconheci ${unmatched.length} nome(s) que a IA leu na foto: ${unmatched.slice(0, 3).join(', ')}${unmatched.length > 3 ? '...' : ''}. Pode ter sido erro de leitura — tenta foto isolada e mais nítida.`)
    }

    if (skippedCount > 0) {
      warnings.unshift(`🚨 Vi ${reportedTotal} figurinhas na foto mas só identifiquei ${filledStickers.length}. ${skippedCount} cromo(s) podem ter passado batido — tira foto isolada do(s) que ficou(aram) de fora.`)
    }

    if (matched.length === 0 && filledStickers.length > 0) {
      console.error('[scan] ZERO matches! Names:', filledStickers.map((s) => s.player_name))
      warnings.push('Nenhuma figurinha pôde ser associada ao álbum. Verifique se as figurinhas são do álbum correto.')
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

    // Persist a scan_results row so we can compute Gemini accuracy later.
    // The PATCH /api/scan/[id] endpoint fills in user_confirmed_count and
    // rejected_sticker_ids when the user actually saves. Fire-and-forget so
    // a tracking failure never breaks the scan response.
    let scanResultId: number | null = null
    try {
      const { data: inserted } = await supabaseAdmin
        .from('scan_results')
        .insert({
          user_id: user.id,
          gemini_detected: filledStickers.length,
          matched_count: matched.length,
          unmatched_count: unmatched.length,
          model_used: usedModel,
          image_quality: serverQuality,
          gemini_ms: geminiMs,
          total_ms: Date.now() - requestStart,
        })
        .select('id')
        .single()
      scanResultId = inserted?.id ?? null
    } catch (trackErr) {
      console.error('[scan] scan_results insert failed (non-blocking):', trackErr)
    }

    // ── Active learning: crop + embed + save pending samples ──────────────
    // For every detection with a usable bbox, crop the region from the
    // original image, generate an embedding, and save a 'pending' sample.
    // The PATCH /api/scan/[id] endpoint will later promote each sample to
    // 'confirmed' or 'rejected' based on what the user kept.
    //
    // Trusted-user override: samples confirmed by users flagged
    // excluded_from_campaign (admin / Pedro) carry is_trusted=true and
    // single-handedly satisfy the kNN boost gate (no need for N=3 others).
    let isTrusted = false
    try {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('excluded_from_campaign')
        .eq('id', user.id)
        .single()
      isTrusted = !!profile?.excluded_from_campaign
    } catch {
      // best-effort
    }

    const knnAdjustments: Array<{ sticker_id: number; delta: number; label: string; validators: number }> = []
    if (scanResultId !== null && detectionEvents.length > 0) {
      // Decode the source image once for sharp cropping
      const srcBuffer = Buffer.from(image, 'base64')
      let srcMeta: { width: number; height: number } | null = null
      try {
        const meta = await sharp(srcBuffer).metadata()
        if (meta.width && meta.height) srcMeta = { width: meta.width, height: meta.height }
      } catch {
        srcMeta = null
      }

      // Process each detection — best-effort, never blocks the response on
      // any individual failure. Run in parallel for latency.
      await Promise.all(detectionEvents.map(async (ev) => {
        if (!ev.bbox || !srcMeta) return
        const { x1, y1, x2, y2 } = ev.bbox
        // Validate bbox: normalized 0-1, ordered, non-degenerate
        if ([x1, y1, x2, y2].some((n) => !Number.isFinite(n))) return
        if (x1 >= x2 || y1 >= y2) return
        const left = Math.max(0, Math.round(x1 * srcMeta.width))
        const top = Math.max(0, Math.round(y1 * srcMeta.height))
        const right = Math.min(srcMeta.width, Math.round(x2 * srcMeta.width))
        const bottom = Math.min(srcMeta.height, Math.round(y2 * srcMeta.height))
        const cropW = right - left
        const cropH = bottom - top
        if (cropW < 32 || cropH < 32) return // too small to be a sticker

        let cropBuf: Buffer
        try {
          cropBuf = await sharp(srcBuffer)
            .extract({ left, top, width: cropW, height: cropH })
            .resize({ width: 384, height: 384, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer()
        } catch (cropErr) {
          console.error('[scan] crop failed:', cropErr instanceof Error ? cropErr.message : cropErr)
          return
        }

        // Embed (returns null if Cohere not configured — sample still saved without vector)
        const embedding = await embedImage(cropBuf, 'image/jpeg')

        // Optional kNN verdict — only adjust confidence when boost is enabled
        if (ENABLE_KNN_BOOST && embedding) {
          const verdict = await computeKnnVerdict(supabaseAdmin, embedding, ev.face, ev.stickerId)
          if (verdict.label !== 'none') {
            knnAdjustments.push({ sticker_id: ev.stickerId, delta: verdict.delta, label: verdict.label, validators: verdict.validators })
            const m = matched.find((mm) => mm.sticker_id === ev.stickerId)
            if (m) m.confidence = Math.max(0, Math.min(1, +(m.confidence + verdict.delta).toFixed(2)))
          }
        }

        // Save pending sample (best-effort)
        await savePendingSample(supabaseAdmin, {
          scanResultId,
          stickerId: ev.stickerId,
          face: ev.face,
          embedding,
          imageBuffer: cropBuf,
          mimeType: 'image/jpeg',
          userId: user.id,
          geminiConfidence: ev.geminiConfidence,
          matchType: ev.matchType,
          isTrusted,
        })
      }))

      if (knnAdjustments.length > 0) {
        console.log(`[scan] kNN adjustments: ${JSON.stringify(knnAdjustments)}`)
      }
    }

    return NextResponse.json({
      matched,
      unmatched,
      warnings,
      confidence: serverQuality,
      imageQuality: serverQuality,
      scanResultId,
      scanUsage: scansRemaining !== null
        ? { remaining: scansRemaining, limit: usageData?.limit ?? tierScanLimit }
        : undefined,
      _debug: {
        geminiDetected: filledStickers.length,
        emptyFiltered,
        rawDetected,
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
