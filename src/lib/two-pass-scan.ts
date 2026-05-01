/**
 * Two-pass sticker scan via Gemini.
 *
 * Pass 1: minimal prompt — Gemini just locates each physical sticker (bbox)
 *         and reports face (front/back) + status (filled/empty). Cheap to
 *         run, doesn't try to read names.
 * Crop:   server uses sharp to extract each filled bbox at the photo's
 *         native resolution, resized to 768px max side for pass 2.
 * Pass 2: per-crop, in parallel, full identification prompt — same detail
 *         as the single-pass scanner but operating on a single sticker
 *         that fills the frame. Reads name, country, number, confidence.
 *
 * Net effect: every sticker gets analyzed at near-isolated resolution,
 * regardless of how many were in the original photo. Solves the bulk
 * back-of-sticker case where 20 small stickers in one photo were
 * previously unreadable. Trade-off: latency ≈ pass1 + max(pass2 calls)
 * ≈ 5–10 s; cost ≈ 1 + N Gemini calls.
 *
 * Output schema is intentionally compatible with the single-pass JSON so
 * callers can swap `parse(responseText)` for `twoPassScan()` without
 * touching downstream matching/persistence.
 */
import sharp from 'sharp'
import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai'

const PASS1_TIMEOUT_MS = 20_000
const PASS2_TIMEOUT_MS = 15_000
const PASS2_CONCURRENCY = 8 // limit parallel pass-2 calls
const MIN_BBOX_PX = 32

export type TwoPassSticker = {
  player_name: string
  country_code: string
  sticker_number: string
  status: 'filled' | 'empty'
  face: 'front' | 'back'
  confidence: number
  bbox: { x1: number; y1: number; x2: number; y2: number }
}

export type TwoPassResult = {
  total_stickers_visible: number
  scan_confidence: number
  image_quality: 'high' | 'medium' | 'low'
  stickers: TwoPassSticker[]
  warnings: string[]
}

type Pass1Item = {
  face: 'front' | 'back'
  status: 'filled' | 'empty'
  bbox: { x1: number; y1: number; x2: number; y2: number }
}

type Pass1Response = {
  total_visible?: number
  image_quality?: 'high' | 'medium' | 'low'
  stickers?: Pass1Item[]
}

type Pass2Response = {
  player_name?: string
  country_code?: string
  sticker_number?: string
  confidence?: number
}

const PASS1_SYSTEM = `You are a Panini sticker locator. Find the bounding box and face of EACH physical sticker in the photo. Do NOT try to read player names or numbers — that comes later. Be exhaustive: count every sticker first, then list one entry per sticker so the array length equals the count.`

const PASS1_USER = `Locate every physical sticker in this photo. Return:

{
  "total_visible": N,
  "image_quality": "high" | "medium" | "low",
  "stickers": [
    {"face": "front", "status": "filled", "bbox": {"x1": 0..1, "y1": 0..1, "x2": 0..1, "y2": 0..1}},
    {"face": "back",  "status": "filled", "bbox": {...}}
  ]
}

RULES:
- "filled" = a real sticker is glued/visible (front OR back). Backs lack player photo but are filled stickers.
- "empty" = album slot with NO sticker — just a printed name placeholder. Skip empties unless you're sure.
- bbox in normalized 0–1 coordinates of the WHOLE photo (x1<x2, y1<y2). Be tight — exclude margins.
- The "stickers" array length MUST equal "total_visible". If you can't localize one precisely, include a rough bbox anyway.`

function buildPass2System(validCodes: string[]): string {
  return `You are a Panini FIFA World Cup sticker reader. The image you receive is a CROPPED photo of ONE single sticker — front or back. Identify it precisely.

For the sticker visible:
1. "player_name": EXACT name printed (e.g., "Neymar Jr", "Casemiro", "Yassine Bounou"). For badges/emblems return "Emblem". For team photos "Team Photo". If unreadable, "?".
2. "country_code": 3-letter code. Valid: ${validCodes.join(', ')}.
3. "sticker_number": only if you see a clear CODE-NUMBER like "BRA-17" or "BRA 17" (use hyphen format). Otherwise "".
4. "confidence": YOUR HONEST 0..1 confidence in player_name+country.

CRITICAL:
- The 4-digit year (2010, 2019) is NOT the sticker number. Height/weight aren't either.
- BACK of sticker = number is the dominant element on a colored panel — read it carefully.
- FRONT of sticker = player photo + name printed below the photo.
- If unsure of the name, use "?" with confidence 0.3 — never invent.

Return JSON ONLY:
{"player_name": "...", "country_code": "...", "sticker_number": "...", "confidence": 0.0}`
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))
  const result = await Promise.race([p.catch(() => null), timeout])
  if (result === null) console.error(`[two-pass] ${label} timed out (${ms}ms)`)
  return result as T | null
}

function parseJson<T>(text: string): T | null {
  try { return JSON.parse(text) as T } catch {}
  const match = text.match(/\{[\s\S]*\}/)
  if (match) {
    try { return JSON.parse(match[0]) as T } catch {}
  }
  return null
}

async function callPass1(
  model: GenerativeModel,
  imageB64: string,
  mimeType: string,
): Promise<Pass1Response | null> {
  const payload = [
    { inlineData: { mimeType, data: imageB64 } },
    { text: PASS1_USER },
  ]
  const res = await withTimeout(model.generateContent(payload), PASS1_TIMEOUT_MS, 'pass1')
  if (!res) return null
  return parseJson<Pass1Response>(res.response.text())
}

async function callPass2(
  model: GenerativeModel,
  cropB64: string,
  mimeType: string,
): Promise<Pass2Response | null> {
  const payload = [
    { inlineData: { mimeType, data: cropB64 } },
    { text: 'Identify this single Panini sticker. Return JSON.' },
  ]
  const res = await withTimeout(model.generateContent(payload), PASS2_TIMEOUT_MS, 'pass2')
  if (!res) return null
  return parseJson<Pass2Response>(res.response.text())
}

async function cropToBuffer(
  src: Buffer,
  meta: { width: number; height: number },
  bbox: { x1: number; y1: number; x2: number; y2: number },
): Promise<Buffer | null> {
  const { x1, y1, x2, y2 } = bbox
  if ([x1, y1, x2, y2].some((n) => !Number.isFinite(n))) return null
  if (x1 >= x2 || y1 >= y2) return null
  const left = Math.max(0, Math.round(x1 * meta.width))
  const top = Math.max(0, Math.round(y1 * meta.height))
  const right = Math.min(meta.width, Math.round(x2 * meta.width))
  const bottom = Math.min(meta.height, Math.round(y2 * meta.height))
  const w = right - left
  const h = bottom - top
  if (w < MIN_BBOX_PX || h < MIN_BBOX_PX) return null
  try {
    return await sharp(src)
      .extract({ left, top, width: w, height: h })
      .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()
  } catch (err) {
    console.error('[two-pass] crop failed:', err instanceof Error ? err.message : err)
    return null
  }
}

async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
  await Promise.all(workers)
  return out
}

export async function twoPassScan(args: {
  imageB64: string
  mimeType: string
  apiKey: string
  validCodes: string[]
  modelName?: string
}): Promise<TwoPassResult | null> {
  const start = Date.now()
  const genAI = new GoogleGenerativeAI(args.apiKey)
  const modelName = args.modelName ?? 'gemini-2.5-flash'

  const pass1Model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: PASS1_SYSTEM,
    // 8192 cabe ~30 stickers de bbox (cada item ~250 tokens c/ JSON)
    generationConfig: { temperature: 0.0, responseMimeType: 'application/json', maxOutputTokens: 8192 },
  })

  const pass1 = await callPass1(pass1Model, args.imageB64, args.mimeType)
  if (!pass1 || !Array.isArray(pass1.stickers) || pass1.stickers.length === 0) {
    console.error('[two-pass] pass1 produced no stickers')
    return null
  }
  console.log(`[two-pass] pass1: ${pass1.stickers.length} stickers in ${Date.now() - start}ms`)

  // Drop empties before pass 2 — only filled stickers (front or back) get analyzed.
  const filled = pass1.stickers.filter((s) => s.status !== 'empty')
  if (filled.length === 0) {
    return {
      total_stickers_visible: pass1.total_visible ?? pass1.stickers.length,
      scan_confidence: 0.5,
      image_quality: pass1.image_quality ?? 'medium',
      stickers: [],
      warnings: ['Só vi slots vazios — fotografe figurinhas coladas.'],
    }
  }

  // Decode source once for cropping
  const srcBuffer = Buffer.from(args.imageB64, 'base64')
  let meta: { width: number; height: number } | null = null
  try {
    const m = await sharp(srcBuffer).metadata()
    if (m.width && m.height) meta = { width: m.width, height: m.height }
  } catch {
    meta = null
  }
  if (!meta) {
    console.error('[two-pass] failed to read image metadata')
    return null
  }

  const pass2Model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: buildPass2System(args.validCodes),
    generationConfig: { temperature: 0.0, responseMimeType: 'application/json', maxOutputTokens: 512 },
  })

  const pass2Start = Date.now()
  const results = await mapWithLimit(filled, PASS2_CONCURRENCY, async (item) => {
    const crop = await cropToBuffer(srcBuffer, meta!, item.bbox)
    if (!crop) return null
    const id = await callPass2(pass2Model, crop.toString('base64'), 'image/jpeg')
    if (!id) return null
    return { item, id }
  })
  console.log(`[two-pass] pass2: ${results.filter(Boolean).length}/${filled.length} ok in ${Date.now() - pass2Start}ms`)

  const stickers: TwoPassSticker[] = []
  let unreadable = 0
  for (const r of results) {
    if (!r) { unreadable++; continue }
    const conf = typeof r.id.confidence === 'number' ? r.id.confidence : 0.5
    const code = (r.id.country_code ?? '').trim().toUpperCase()
    const num = (r.id.sticker_number ?? '').trim()
    stickers.push({
      player_name: (r.id.player_name ?? '').trim(),
      country_code: code,
      // Mirror the field aliases the WhatsApp matchSticker reads (number/country)
      // so the same JSON works for both endpoints without a transform.
      country: code,
      sticker_number: num,
      number: num,
      status: 'filled',
      face: r.item.face === 'back' ? 'back' : 'front',
      confidence: conf,
      bbox: r.item.bbox,
    } as TwoPassSticker & { country: string; number: string })
  }

  // Don't surface a separate "pass 2 unreadable" warning here — the gap
  // detection at the endpoint level already covers the same signal in
  // better wording (total_visible vs stickers.length). Avoids 3 stacked
  // confusing messages on the user's screen.
  if (unreadable > 0) {
    console.log(`[two-pass] ${unreadable} sticker(s) unreadable in pass 2`)
  }

  return {
    total_stickers_visible: pass1.total_visible ?? pass1.stickers.length,
    scan_confidence: 0.85,
    image_quality: pass1.image_quality ?? 'medium',
    stickers,
    warnings: [],
  }
}

export function isTwoPassEnabled(): boolean {
  return process.env.SCAN_TWO_PASS === 'true'
}
