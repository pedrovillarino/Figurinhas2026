import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { sendText } from '@/lib/zapi'
import { getScanLimit, type Tier } from '@/lib/tiers'
import { getQuotas, buildPaywallMessage } from '@/lib/whatsapp-quotas'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br').trim()

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const SCAN_INSTRUCTION = `Você identifica figurinhas Panini Copa do Mundo 2026. Retorne JSON apenas.

Para CADA figurinha física visível (frente ou verso):
- player_name: nome EXATO impresso (ex: "Neymar Jr"). Para escudos use "Emblem"; foto do time "Team Photo". Se ilegível, use "?".
- country: país (ex: "Brasil", "Argentina"), ou "Extra" pra PANINI Extras (veja abaixo).
- number: só se você ver um código claro tipo "BRA-17" ou "BRA 17" (use hífen). Senão "".
- status: "filled" se figurinha real está presente (frente OU verso). "empty" só pra slot vazio do álbum (retângulo em branco com nome impresso EMBAIXO como placeholder).
- confidence: 0.0–1.0 honesto. Abaixo de 0.4, pule.
- tier: SÓ pra PANINI Extras. "ouro" | "prata" | "bronze" | "regular". Omita pra figurinhas normais.

PANINI EXTRAS: figurinhas com selo vermelho "EXTRA STICKER" no canto superior direito E selo dourado circular "FIFA" no canto superior esquerdo são especiais (NÃO figurinhas normais de país). Pra essas:
  - country = "Extra"
  - tier pelo fundo: "ouro" (dourado brilhante), "prata" (prateado brilhante), "bronze" (marrom/cobre brilhante), "regular" (branco ou cor de time, sem brilho)
  - player_name normal (ex: "Erling Haaland")
  - number = "" (o código EXT-NN-TIER não aparece na frente)

COCA-COLA: figurinhas com fundo ESCURO (foto do jogador em ação, NÃO fundo branco de estúdio como cromo normal), nome do jogador escrito VERTICAL na lateral ESQUERDA em letras brancas maiúsculas, seguido do código de país entre parênteses (ex: "LAMINE YAMAL (ESP)", "FEDERICO VALVERDE (URU)"). Tem só o logo FIFA pequeno no canto superior esquerdo — SEM "PANINI", SEM "EXTRA STICKER". São 14 cromos (CC1-CC14). Pra essas:
  - country = "Coca" (NÃO o país entre parênteses — esse é só indicador)
  - player_name normal (ex: "Lamine Yamal", "Federico Valverde")
  - tier omitido
  - number = ""

Leia com cuidado. Não chute nomes. Ano (2010, 2019) e altura/peso (1.75, 68) NÃO são número da figurinha. Cada figurinha física = 1 entrada (duplicatas viram entradas separadas).

Retorne JSON:
{
  "scan_confidence": 0.9,
  "stickers": [
    {"number": "BRA-1", "player_name": "Emblem", "country": "Brasil", "status": "filled", "confidence": 0.95},
    {"player_name": "Erling Haaland", "country": "Extra", "tier": "ouro", "status": "filled", "confidence": 0.9},
    {"player_name": "Lamine Yamal", "country": "Coca", "status": "filled", "confidence": 0.92}
  ]
}`

// ── Matching helpers (same logic as /api/scan) ──

function normalizeName(name: string): string {
  return name
    .toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

type DbSticker = { id: number; number: string; player_name: string; country: string; type: string; section?: string }
type ExtraTier = 'ouro' | 'prata' | 'bronze' | 'regular'

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
  'curacao': 'CUW', 'curaçao': 'CUW', 'korsou': 'CUW',
}

// ── Module-level sticker cache for WhatsApp scan ──
let waCache: {
  stickers: DbSticker[]
  byNumber: Map<string, DbSticker>
  byCountry: Map<string, DbSticker[]>
  // PANINI Extras: 4 variants per player. Same isolation as web scan to avoid
  // collision with normal player matching.
  extrasByPlayer: Map<string, Map<ExtraTier, DbSticker>>
  // Coca-Cola: 14 stickers, share player names with country sections.
  cocaColaByPlayer: Map<string, DbSticker>
  at: number
} | null = null
const WA_CACHE_TTL = 60 * 60 * 1000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getWaCache(db: any) {
  if (waCache && Date.now() - waCache.at < WA_CACHE_TTL) return waCache
  // Fetch in pages to avoid Supabase 1000-row default limit
  const [p1, p2] = await Promise.all([
    db.from('stickers').select('id, number, player_name, country, type, section').range(0, 999),
    db.from('stickers').select('id, number, player_name, country, type, section').range(1000, 1999),
  ])
  const data = [...(p1.data || []), ...(p2.data || [])]
  if (!data || data.length === 0) return null

  const stickers = data as DbSticker[]
  const byNumber = new Map(stickers.map((s: DbSticker) => [s.number.toUpperCase(), s]))
  const byCountry = new Map<string, DbSticker[]>()
  const extrasByPlayer = new Map<string, Map<ExtraTier, DbSticker>>()
  const cocaColaByPlayer = new Map<string, DbSticker>()

  const extrasNameRegex = /^(.*?)\s*\((Regular|Bronze|Prata|Ouro)\)\s*$/i
  const tierMap: Record<string, ExtraTier> = {
    regular: 'regular', bronze: 'bronze', prata: 'prata', ouro: 'ouro',
  }

  for (const s of stickers) {
    if (s.section === 'PANINI Extras') {
      const m = s.player_name.match(extrasNameRegex)
      if (m) {
        const normBare = normalizeName(m[1].trim())
        const tier = tierMap[m[2].toLowerCase()]
        if (!extrasByPlayer.has(normBare)) extrasByPlayer.set(normBare, new Map())
        extrasByPlayer.get(normBare)!.set(tier, s)
      }
      continue // keep extras out of byCountry
    }
    if (s.section === 'Coca-Cola') {
      cocaColaByPlayer.set(normalizeName(s.player_name), s)
      continue // keep Coca-Cola out of byCountry too
    }
    const code = s.number.split('-')[0]
    if (!byCountry.has(code)) byCountry.set(code, [])
    byCountry.get(code)!.push(s)
  }
  waCache = { stickers, byNumber, byCountry, extrasByPlayer, cocaColaByPlayer, at: Date.now() }
  console.log(`[WhatsApp scan] Cached ${stickers.length} stickers (${extrasByPlayer.size} extras players, ${cocaColaByPlayer.size} coca-cola)`)
  return waCache
}

function matchSticker(
  detected: { number?: string; player_name?: string; country?: string; tier?: string },
  cache: NonNullable<typeof waCache>
): DbSticker | null {
  const stickerNum = (detected.number || '').toUpperCase().trim()
  const playerName = detected.player_name || ''
  const country = (detected.country || '').trim()
  const normPlayer = normalizeName(playerName)
  const normCountry = normalizeName(country)

  // Priority 0a: Coca-Cola (country = "Coca").
  // Same isolation reasoning as Extras — CC players also exist in their
  // country sections, so we only route here when Gemini explicitly tags
  // "Coca". No country fallback — false positives would shadow the right one.
  const looksCoca = country.toUpperCase() === 'COCA' || normCountry === 'coca' || normCountry === 'cocacola' || normCountry === 'coca cola'
  if (looksCoca && normPlayer && normPlayer.length >= 2) {
    const exact = cache.cocaColaByPlayer.get(normPlayer)
    if (exact) return exact
    let foundNorm: string | null = null
    cache.cocaColaByPlayer.forEach((_, name) => {
      if (!foundNorm && (name.includes(normPlayer) || normPlayer.includes(name))) foundNorm = name
    })
    return foundNorm ? cache.cocaColaByPlayer.get(foundNorm) || null : null
  }

  // Priority 0b: PANINI Extras (country = "Extra" + tier).
  // Distinct path because extras live in a separate section with 4 variants.
  // No fallback to country lookup — if we can't resolve the tier, return null
  // (avoids matching an Extra as the player's regular country sticker).
  const looksExtra = country.toUpperCase() === 'EXT' || normCountry === 'extra' || normCountry === 'extras'
  if (looksExtra && normPlayer && normPlayer.length >= 2) {
    const tierRaw = (detected.tier || '').toLowerCase().trim()
    const tier: ExtraTier =
      tierRaw === 'ouro' || tierRaw === 'gold' ? 'ouro' :
      tierRaw === 'prata' || tierRaw === 'silver' ? 'prata' :
      tierRaw === 'bronze' ? 'bronze' :
      'regular' // default when tier is missing or unrecognized
    const tiersForPlayer = cache.extrasByPlayer.get(normPlayer)
    if (tiersForPlayer) return tiersForPlayer.get(tier) || null
    // Fuzzy player match across extras
    let foundNorm: string | null = null
    cache.extrasByPlayer.forEach((_, name) => {
      if (!foundNorm && (name.includes(normPlayer) || normPlayer.includes(name))) foundNorm = name
    })
    if (foundNorm) {
      const fuzzyTiers = cache.extrasByPlayer.get(foundNorm)
      return fuzzyTiers?.get(tier) || null
    }
    return null
  }

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
      // Mensagem em escada (Pedro 2026-05-02): se ainda tem áudio, sugere
      // áudio. Senão, texto. Sempre mostra opções de upgrade válidas.
      const quotas = await getQuotas(userId, userTier)
      const msg = buildPaywallMessage(APP_URL, 'scan', quotas)
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

    // Keep filled stickers; ALSO keep backs (face='back') even if Gemini
    // mistakenly marked them as 'empty' — backs are physical stickers,
    // they just lack the colored player photo by design.
    const filledStickers = parsed.stickers.filter((s: { status: string; face?: string }) => {
      if (s.status === 'filled') return true
      if ((s.face || '').toLowerCase() === 'back') return true
      return false
    })

    if (filledStickers.length === 0) {
      await sendText(phone, 'Não encontrei figurinhas coladas nessa foto. Tenta outra! 📸')
      return NextResponse.json({ ok: true })
    }

    // Gap detection: Gemini was asked to count BEFORE listing. If it counted
    // more cromos than it listed, it pulled a "skipped" — surface to user
    // so they can re-scan the missed sticker isolated.
    const reportedTotal = typeof parsed.total_stickers_visible === 'number' ? parsed.total_stickers_visible : 0
    const skippedCount = Math.max(0, reportedTotal - filledStickers.length)
    if (skippedCount > 0) {
      console.log(`[WhatsApp scan] gap detected: total=${reportedTotal}, listed=${filledStickers.length}, skipped=${skippedCount}`)
    }

    // Soft warning quando passa de 10 cromos: processa normalmente mas
    // adiciona aviso ao final dizendo que a assertividade cai. Pedro
    // confirmou que vale tentar ler mais, só com transparência sobre
    // o trade-off.
    const overLimit = filledStickers.length > 10

    // Match each detected sticker using fuzzy matching (with quantity tracking).
    // Also keep the WORST confidence reported by Gemini for each sticker_id so
    // we can flag low-confidence items in the preview ("⚠️ confira").
    const stickerQty = new Map<number, { sticker: DbSticker; qty: number; minConfidence: number }>()
    const unmatchedNames: string[] = []

    for (const detected of filledStickers as Array<{ player_name?: string; country?: string; number?: string; confidence?: number; tier?: string }>) {
      const matched = matchSticker(detected, cache)
      const conf = typeof detected.confidence === 'number' ? detected.confidence : 1
      if (matched) {
        const existing = stickerQty.get(matched.id)
        if (existing) {
          existing.qty += 1
          if (conf < existing.minConfidence) existing.minConfidence = conf
        } else {
          stickerQty.set(matched.id, { sticker: matched, qty: 1, minConfidence: conf })
        }
        console.log(`[WhatsApp scan] ✓ "${detected.player_name}" (${detected.country}) → ${matched.number} ${matched.player_name} [conf=${conf.toFixed(2)}]`)
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

    // Build preview list — numbered so the user can remove specific items
    // (e.g. "tirar 3" or "tirar 2,5") without canceling the whole batch.
    const previewLines: string[] = []
    const scanData: Array<{ sticker_id: number; number: string; player_name: string; quantity: number }> = []

    const LOW_CONFIDENCE_THRESHOLD = 0.8
    let lowConfidenceCount = 0

    dbStickers.forEach(({ sticker, qty, minConfidence }, idx) => {
      const ex = existingMap.get(sticker.id)
      const label = `${sticker.number} ${sticker.player_name || ''}`.trim()
      const qtyLabel = qty > 1 ? ` (x${qty})` : ''
      const n = idx + 1
      const lowConf = minConfidence < LOW_CONFIDENCE_THRESHOLD
      if (lowConf) lowConfidenceCount++
      const warn = lowConf ? ' ⚠️' : ''

      if (!ex) {
        previewLines.push(qty > 1 ? `*${n}.* 🆕 ${label}${qtyLabel}${warn}` : `*${n}.* 🆕 ${label}${warn}`)
      } else if (ex.status === 'owned') {
        previewLines.push(`*${n}.* 🔁 ${label}${qtyLabel} _(repetida)_${warn}`)
      } else if (ex.status === 'duplicate') {
        previewLines.push(`*${n}.* 🔁 ${label}${qtyLabel} _(rep x${ex.quantity + qty})_${warn}`)
      }

      scanData.push({ sticker_id: sticker.id, number: sticker.number, player_name: sticker.player_name || '', quantity: qty })
    })

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
    const lowConfNote = lowConfidenceCount > 0
      ? `\n\n⚠️ _${lowConfidenceCount} item(s) com baixa confiança — confira antes de salvar. Use *tirar N* se algum estiver errado._`
      : ''
    const gapNote = skippedCount > 0
      ? `\n\n🚨 _Vi *${reportedTotal} figurinhas* na foto mas só identifiquei ${filledStickers.length}. ${skippedCount} cromo(s) podem ter passado batido — confira a foto e mande de novo só o(s) que ficou(aram) de fora._`
      : ''
    const overLimitNote = overLimit
      ? `\n\n📸 _Foto com *${filledStickers.length} cromos* — passou do recomendado (10). A assertividade cai bastante; confira tudo antes de salvar e use *tirar N* pra remover erros._`
      : ''

    // Pedro 2026-05-03 (caso Joao Gabriel): user respondeu "TIRAR N" achando
    // que era o comando literal. E quando tem 1 item só, oferecer TIRAR
    // confunde mais que ajuda. Adapta conforme totalStickersFound.
    const exampleN = Math.min(totalStickersFound, 3)
    let msg: string
    if (totalPending === 1) {
      msg = `📋 *Encontrei ${totalStickersFound} figurinha(s):*\n\n`
      msg += previewLines.join('\n')
      msg += lowConfNote
      msg += gapNote
      msg += overLimitNote
      msg += '\n\n💡 Pode mandar mais fotos! Quando terminar:'
      msg += totalStickersFound === 1 ? '\n✅ *SIM* → registra' : '\n✅ *SIM* → registra tudo'
      if (totalStickersFound >= 2) {
        msg += `\n✏️ *TIRAR ${exampleN}* → remove o item ${exampleN} (vale também: _tirar 2,5_)`
      }
      msg += '\n❌ *NÃO* → cancela'
      msg += '\n\n⏰ _Expira em 1h se não responder_'
    } else {
      msg = `📋 *+${totalStickersFound} figurinha(s) detectada(s):*\n\n`
      msg += previewLines.join('\n')
      msg += lowConfNote
      msg += gapNote
      msg += overLimitNote
      msg += `\n\n📦 *${totalPending} fotos pendentes no total.*`
      msg += '\nMande mais fotos ou responda:'
      msg += '\n✅ *SIM* → registra todas'
      if (totalStickersFound >= 2) {
        msg += `\n✏️ *TIRAR ${exampleN}* → remove o item ${exampleN} desta foto (_tirar 2,5_)`
      }
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
