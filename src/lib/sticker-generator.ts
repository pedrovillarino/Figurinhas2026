/**
 * Pedro 2026-05-04: gera figurinha digital personalizada estilo Copa 2026.
 *
 * Pipeline (Opção B v2 — InstantID + template real + composição):
 *   1. recebe foto base64 + dados (nome/data/altura/peso/clube)
 *   2. chama InstantID via Replicate pra gerar RETRATO PRESERVANDO O
 *      ROSTO da pessoa (Gemini Imagen criava rosto aleatório similar —
 *      InstantID/PhotoMaker preservam identidade real)
 *   3. carrega o template real (figurinha BRA original em alta-res),
 *      sobrepõe o retrato cobrindo o jogador original, cobre as faixas
 *      de texto e renderiza nome/stats/clube novos por cima
 *   4. chroma key com FEATHERING nas bordas (em vez de threshold duro)
 *      pra eliminar aparência "colado" — silhueta funde com fundo
 *   5. retorna PNG final composto
 *
 * Watermark é aplicado por applyPreviewWatermark() em camada separada.
 */
import sharp from 'sharp'
import path from 'path'
import { promises as fs } from 'fs'
import { runInstantID } from './replicate'

const MODEL = 'replicate/zsxkib/instant-id'

// ─── Template real ───
// Imagem 480×639 com a figurinha do João Pedro. Vamos cobrir o jogador
// e os textos de nome/stats/clube. Resto do template (cor de fundo,
// "26" decorativo, FIFA, bandeira, "BRA" vertical, logo Panini) fica
// preservado.
const TEMPLATE_PATH = path.join(process.cwd(), 'public', 'sticker-templates', 'copa2026-bra-base.jpg')

// ─── Fontes bundladas (Inter Bold/Regular) ───
// Pedro 2026-05-04: fontes do sistema Vercel Lambda eram tofu (□□□).
// Bundlamos Inter TTF em public/fonts/ e passamos via fontfile pro Sharp/Pango.
const FONT_BOLD_PATH = path.join(process.cwd(), 'public', 'fonts', 'Inter-Bold.ttf')
const FONT_REGULAR_PATH = path.join(process.cwd(), 'public', 'fonts', 'Inter-Regular.ttf')

// Cores extraídas do template (estimadas — pode ajustar visualmente)
const COLORS = {
  bgTurquoise: '#6FC9C0',     // fundo principal da figurinha
  bgPillDark: '#2D9489',      // pill da faixa nome+stats
  bgPillLight: '#3FA89B',     // pill da faixa clube (um tom mais claro)
  textWhite: '#FFFFFF',
  textCream: '#E8D78F',
} as const

// ─── Coordenadas calibradas no template 480×639 ───
//
// Pedro 2026-05-04: medidas a olho na imagem do João Pedro. Se Pedro
// trocar o template-fonte por outra figurinha (ou versão maior), pode
// precisar recalibrar.
const TEMPLATE_W = 480
const TEMPLATE_H = 639

// Área onde o retrato gerado vai ser sobreposto (cobre o jogador original).
// Largura ampla pra cobrir cabelo/ombros, altura do topo até logo acima da pill.
const PORTRAIT_REGION = { x: 60, y: 8, w: 340, h: 500 }

// Pills inferiores (cobrir + re-renderizar texto novo)
// IMPORTANTE: dimensões precisam cobrir COMPLETAMENTE os pills do template
// (que têm "JOÃO PEDRO / 26-9-2001..." e "CHELSEA FC (ENG)"). v4 calibrado
// re-medindo o template: pill grande começa em y=538 e vai até y=600
// (largura x=22..338), pill clube começa em y=603 (x=105..325).
const PILL_NAME = { x: 22, y: 536, w: 316, h: 64, radius: 30 }
const PILL_CLUB = { x: 105, y: 602, w: 220, h: 32, radius: 14 }

// Pedro 2026-05-04: prompt curto e focado pra InstantID. Modelo é SDXL +
// IP-Adapter de identidade — entende prompt natural mas precisa preservar
// rosto da imagem (não inventar). NÃO precisa do nível de detalhe que o
// Gemini Imagen pedia (esse era prompt-only); InstantID já replica o rosto
// fielmente através do IP-Adapter facial.
const PORTRAIT_PROMPT =
  'professional studio headshot photograph, person from waist up, ' +
  'wearing the official yellow Brazil national football team jersey ' +
  '(Brazilian national team 2024-2026 kit, bright yellow with subtle ' +
  'vertical pattern, green V-collar, CBF crest visible on left chest, ' +
  'small Nike swoosh logo on right chest), neutral serious expression, ' +
  'looking directly at camera, shoulders slightly open, ' +
  'solid plain turquoise teal background color #6FC9C0 (no gradient, ' +
  'no scenery, no logos, no text), even soft studio lighting, ' +
  'high quality, photorealistic, sharp focus on the face'

export type GenerateStickerInput = {
  photoBase64: string         // foto da pessoa, sem data URL prefix
  photoMimeType: string       // 'image/jpeg' | 'image/png'
  personName?: string         // ex: "Vinícius Júnior"
  birthDate?: string          // ex: "12-7-2000" ou "12/07/2000"
  heightM?: string            // ex: "1,76"
  weightKg?: string           // ex: "73"
  clubName?: string           // ex: "Real Madrid CF"
  clubCountry?: string        // ex: "ESP"
  countryCode?: string        // sempre "BRA" (MVP só Brasil)
  variant?: 'copa2026'
}

export type GenerateStickerResult =
  | { ok: true; pngBase64: string; promptUsed: string; modelUsed: string; estimatedCostUsd: number }
  | { ok: false; error: string; promptUsed: string }

/**
 * Gera figurinha completa: retrato via Gemini + composição sobre o template real via Sharp.
 *
 * Custo: ~$0.04 por imagem (Gemini Image).
 */
export async function generateSticker(input: GenerateStickerInput): Promise<GenerateStickerResult> {
  // 1. Pede SÓ o retrato pro Gemini
  const portraitResult = await generatePortrait(input)
  if (!portraitResult.ok) return portraitResult

  // 2. Compõe template real + retrato + textos via Sharp
  try {
    const finalBuffer = await composeStickerFinal({
      portraitPngBase64: portraitResult.pngBase64,
      personName: input.personName,
      birthDate: input.birthDate,
      heightM: input.heightM,
      weightKg: input.weightKg,
      clubName: input.clubName,
      clubCountry: input.clubCountry,
    })
    return {
      ok: true,
      pngBase64: finalBuffer.toString('base64'),
      promptUsed: portraitResult.promptUsed,
      modelUsed: MODEL,
      estimatedCostUsd: 0.05,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sticker-gen] compose exception:', msg)
    return { ok: false, error: 'Falha ao compor figurinha: ' + msg, promptUsed: portraitResult.promptUsed }
  }
}

/**
 * Chama InstantID via Replicate pra gerar retrato PRESERVANDO O ROSTO da
 * pessoa enviada. Diferente de Gemini Imagen (que cria rosto novo similar),
 * InstantID usa IP-Adapter facial — o rosto na saída é REALMENTE da pessoa.
 *
 * Retorna PNG base64 do retrato com fundo turquesa próximo ao do template.
 */
async function generatePortrait(input: GenerateStickerInput): Promise<GenerateStickerResult> {
  const prompt = PORTRAIT_PROMPT
  const result = await runInstantID({
    faceImageBase64: input.photoBase64,
    faceMimeType: input.photoMimeType,
    prompt,
    // ipAdapterScale alto = preserva rosto fiel; baixo = mais estilo, menos identidade.
    // 0.8 é o sweet-spot recomendado: identidade clara + composição livre.
    ipAdapterScale: 0.8,
    width: 768,
    height: 1024, // ~3:4 — InstantID lida bem com retratos verticais
  })

  if (!result.ok) {
    return { ok: false, error: result.error, promptUsed: prompt }
  }

  return {
    ok: true,
    pngBase64: result.pngBase64,
    promptUsed: prompt,
    modelUsed: MODEL,
    estimatedCostUsd: result.estimatedCostUsd,
  }
}

// ─── Composição final via Sharp ─────────────────────────────────────────

type ComposeInput = {
  portraitPngBase64: string
  personName?: string
  birthDate?: string
  heightM?: string
  weightKg?: string
  clubName?: string
  clubCountry?: string
}

/**
 * Compõe a figurinha final:
 *   1. Carrega o template real (figurinha BRA original)
 *   2. Recorta/redimensiona o retrato gerado pra encaixar no slot do jogador
 *   3. Composita retrato (cobre jogador original); fundo turquesa do retrato
 *      blenda com fundo do template, e o "26" continua visível nas bordas
 *   4. Composita overlay SVG com:
 *      - 2 retângulos turquesa-escuros pra cobrir as pills antigas (nome/clube)
 *      - Textos novos: nome, stats, clube
 *   5. Output PNG final
 */
/**
 * Chroma key COM FEATHERING — varre pixels RGBA do buffer e ajusta alpha
 * baseado na distância da cor turquesa do template (#6FC9C0):
 *   - distância ≤ innerTol  → alpha=0 (totalmente transparente)
 *   - distância ≥ outerTol  → alpha=255 (mantém opaco)
 *   - faixa intermediária   → gradiente linear (transição suave nas bordas)
 *
 * Pedro 2026-05-04: v5 usava threshold duro (binary alpha), criava bordas
 * serrilhadas e aparência "foto colada". Feathering suaviza pra parecer
 * recortado profissionalmente.
 */
async function chromaKeyTurquoise(
  pngBuf: Buffer,
  innerTol: number = 30,
  outerTol: number = 55,
): Promise<Buffer> {
  const target = { r: 0x6F, g: 0xC9, b: 0xC0 }
  const innerSq = innerTol * innerTol
  const outerSq = outerTol * outerTol
  const featherRange = outerSq - innerSq

  const { data, info } = await sharp(pngBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - target.r
    const dg = data[i + 1] - target.g
    const db = data[i + 2] - target.b
    const distSq = dr * dr + dg * dg + db * db

    if (distSq <= innerSq) {
      data[i + 3] = 0 // totalmente transparente
    } else if (distSq < outerSq) {
      // Zona de feathering — alpha gradiente linear
      const t = (distSq - innerSq) / featherRange  // 0..1
      data[i + 3] = Math.round(255 * t)
    }
    // else: pixel fica opaco (sem alteração)
  }

  return await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer()
}

export async function composeStickerFinal(input: ComposeInput): Promise<Buffer> {
  // 1. Carrega o template real
  const templateBuffer = await fs.readFile(TEMPLATE_PATH)

  // 2. Prepara o retrato pra encaixar no slot do jogador
  // v5 (Pedro 2026-05-04): "26" do template não aparecia atrás do jogador
  // porque o retrato tinha fundo turquesa sólido que cobria o "26" inteiro.
  // Aplica chroma key — pixels próximos ao turquesa #6FC9C0 viram alpha=0,
  // então o "26" do template aparece atrás da silhueta do jogador.
  const portraitRaw = Buffer.from(input.portraitPngBase64, 'base64')
  const portraitResizedOpaque = await sharp(portraitRaw)
    .resize(PORTRAIT_REGION.w, PORTRAIT_REGION.h, { fit: 'cover', position: 'top' })
    .png()
    .toBuffer()
  const portraitResized = await chromaKeyTurquoise(portraitResizedOpaque, 40)

  // 3. Overlay SVG com SÓ os retângulos das pills (cobrir texto antigo)
  const pillsSvg = buildPillsSvg()

  // 4. Renderiza textos como bitmaps via Sharp.text() com fontfile bundlado.
  // Pedro 2026-05-04: SVG-text caía pra fonte de sistema (não existe) → tofu.
  // Sharp.text() usa Pango + fontfile direto — render correto.
  const name = (input.personName || 'COMPLETE AÍ').toUpperCase()
  const stats = formatStatsLine(input)
  const club = formatClubLine(input)

  const nameTextBuf = await renderText(name, {
    fontfile: FONT_BOLD_PATH,
    fontPxSize: 22, // v4: reduzido pra caber em nomes longos
    width: PILL_NAME.w - 16, // padding 8px cada lado
    color: COLORS.textWhite,
  })
  const statsTextBuf = stats
    ? await renderText(stats, {
        fontfile: FONT_REGULAR_PATH,
        fontPxSize: 12,
        width: PILL_NAME.w - 16,
        color: COLORS.textWhite,
      })
    : null
  const clubTextBuf = club
    ? await renderText(club, {
        fontfile: FONT_BOLD_PATH,
        fontPxSize: 11,
        width: PILL_CLUB.w - 12,
        color: COLORS.textWhite,
      })
    : null

  // Posições — centralizar texto horizontal e empilhar nome+stats verticalmente
  // dentro do PILL_NAME, club no centro vertical do PILL_CLUB.
  const nameMeta = await sharp(nameTextBuf).metadata()
  const nameW = nameMeta.width || 0
  const nameH = nameMeta.height || 0
  const nameLeft = PILL_NAME.x + Math.round((PILL_NAME.w - nameW) / 2)
  // v4: se TEM stats, nome fica em cima (linha 1); se não tem, centraliza vertical
  const nameTop = stats
    ? PILL_NAME.y + 8
    : PILL_NAME.y + Math.round((PILL_NAME.h - nameH) / 2)

  let statsLeft = 0, statsTop = 0
  if (statsTextBuf) {
    const m = await sharp(statsTextBuf).metadata()
    statsLeft = PILL_NAME.x + Math.round((PILL_NAME.w - (m.width || 0)) / 2)
    // Logo abaixo do nome: nameTop + nameHeight + gap pequeno
    statsTop = nameTop + nameH + 4
  }

  let clubLeft = 0, clubTop = 0
  if (clubTextBuf) {
    const m = await sharp(clubTextBuf).metadata()
    clubLeft = PILL_CLUB.x + Math.round((PILL_CLUB.w - (m.width || 0)) / 2)
    clubTop = PILL_CLUB.y + Math.round((PILL_CLUB.h - (m.height || 0)) / 2)
  }

  // 5. Compõe: template → retrato → pills (SVG) → textos (bitmaps)
  const composites: sharp.OverlayOptions[] = [
    { input: portraitResized, top: PORTRAIT_REGION.y, left: PORTRAIT_REGION.x },
    { input: Buffer.from(pillsSvg), top: 0, left: 0 },
    { input: nameTextBuf, top: nameTop, left: nameLeft },
  ]
  if (statsTextBuf) composites.push({ input: statsTextBuf, top: statsTop, left: statsLeft })
  if (clubTextBuf) composites.push({ input: clubTextBuf, top: clubTop, left: clubLeft })

  const composed = await sharp(templateBuffer)
    .composite(composites)
    .png()
    .toBuffer()

  return composed
}

/**
 * Renderiza uma string como PNG bitmap RGBA usando Sharp.text() com
 * fontfile bundlado. Sharp/Pango lê o TTF direto, contornando a falta
 * de fontes do sistema no Vercel Lambda.
 *
 * O `font` precisa do nome interno do TTF (não do basename do arquivo);
 * Inter usa "Inter Bold" / "Inter Regular".
 */
async function renderText(
  text: string,
  opts: { fontfile: string; fontPxSize: number; width: number; color: string },
): Promise<Buffer> {
  // Sharp.text usa pontos (pt) e não pixels. Conversão aproximada: pt = px * 0.75
  // Mas Sharp aceita "Inter Bold 24" diretamente como Pango font specifier,
  // onde 24 é tamanho em pontos. Aqui usamos px direto via dpi=72 (1pt = 1px).
  return await sharp({
    text: {
      text: `<span foreground="${opts.color}">${escapePango(text)}</span>`,
      font: `Inter ${opts.fontPxSize}px`,
      fontfile: opts.fontfile,
      rgba: true,
      width: opts.width,
      dpi: 72,
    },
  }).png().toBuffer()
}

/** Escapa caracteres especiais pra Pango markup (& < >). */
function escapePango(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * SVG só com os retângulos arredondados que cobrem as pills do template.
 * Os textos ficam de fora — renderizados via Sharp.text com fontfile.
 */
function buildPillsSvg(): string {
  const w = TEMPLATE_W
  const h = TEMPLATE_H
  return `
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
  <!-- Cobre pill nome+stats antiga -->
  <rect x="${PILL_NAME.x}" y="${PILL_NAME.y}"
        width="${PILL_NAME.w}" height="${PILL_NAME.h}"
        rx="${PILL_NAME.radius}" ry="${PILL_NAME.radius}"
        fill="${COLORS.bgPillDark}"/>
  <!-- Cobre pill clube antiga -->
  <rect x="${PILL_CLUB.x}" y="${PILL_CLUB.y}"
        width="${PILL_CLUB.w}" height="${PILL_CLUB.h}"
        rx="${PILL_CLUB.radius}" ry="${PILL_CLUB.radius}"
        fill="${COLORS.bgPillLight}"/>
</svg>`.trim()
}

function formatStatsLine(input: ComposeInput): string {
  // Pedro 2026-05-04: figurinha sem stats fica "esquisita" (pill vazio).
  // Aplica defaults amigáveis quando user não preenche, mantendo aparência
  // de figurinha legítima.
  const birthDate = input.birthDate?.trim() || '01-01-2000'
  const heightM   = input.heightM?.trim() || '1,80'
  const weightKg  = input.weightKg?.trim() || '75'
  return `${birthDate} | ${heightM}m | ${weightKg} kg`
}

function formatClubLine(input: ComposeInput): string {
  // Pedro 2026-05-04: default amigável pra clube (consistente com fan art)
  const club = (input.clubName?.trim() || 'ATLETA AMADOR').toUpperCase()
  return input.clubCountry
    ? `${club} (${input.clubCountry.toUpperCase().slice(0, 3)})`
    : club
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;')
}

// ─── Watermark agressiva (preview) ──────────────────────────────────

/**
 * Aplica marca d'água AGRESSIVA "Complete Aí · PREVIEW · PAGUE PARA LIBERAR"
 * sobre a imagem composta. Pedro 2026-05-04: deve ser visualmente forte o
 * suficiente pra impedir uso sem pagamento — overlay translúcido + texto
 * repetido em diagonal + barra horizontal central com call-to-action.
 *
 * Returns PNG buffer com WM.
 */
export async function applyPreviewWatermark(pngBase64: string): Promise<Buffer> {
  const img = sharp(Buffer.from(pngBase64, 'base64'))
  const meta = await img.metadata()
  const w = meta.width || TEMPLATE_W
  const h = meta.height || TEMPLATE_H

  const tileFontSize = Math.round(w * 0.06)
  const ctaFontSize = Math.round(w * 0.075)
  const ctaHeight = Math.round(h * 0.10)
  // v5 (Pedro 2026-05-04): "agressivo demais" — afastei texto do diagonal,
  // baixei opacidade do tile e do overlay. Mantém "preview inutilizável"
  // mas a figurinha continua reconhecível pra o user querer pagar.
  const ctaY = Math.round(h * 0.30) // central rosto, mas mais baixo

  // SVG: 3 camadas mais sutis
  const svg = `
    <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <!-- v5: tile maior (texto mais espaçado) + opacidade menor -->
        <pattern id="wm" patternUnits="userSpaceOnUse" width="${Math.round(w * 0.7)}" height="${Math.round(h * 0.25)}" patternTransform="rotate(-25)">
          <text x="0" y="${tileFontSize}" font-family="Arial Black, Helvetica, sans-serif" font-size="${tileFontSize}"
                font-weight="900" fill="rgba(255,255,255,0.40)"
                stroke="rgba(0,0,0,0.35)" stroke-width="1.5">
            COMPLETE AÍ
          </text>
          <text x="0" y="${tileFontSize * 2.4}" font-family="Arial Black, Helvetica, sans-serif" font-size="${Math.round(tileFontSize * 0.65)}"
                font-weight="900" fill="rgba(255,80,80,0.50)"
                stroke="rgba(0,0,0,0.35)" stroke-width="1">
            PREVIEW
          </text>
        </pattern>
      </defs>
      <!-- 1. Overlay escuro suave (reduzido de 30% pra 15%) -->
      <rect width="100%" height="100%" fill="rgba(0,0,0,0.15)"/>
      <!-- 2. Padrão diagonal mais espaçado e translúcido -->
      <rect width="100%" height="100%" fill="url(#wm)"/>
      <!-- 3. Barra central — único elemento de alto contraste -->
      <rect x="0" y="${ctaY}" width="${w}" height="${ctaHeight}" fill="rgba(220,30,30,0.80)"/>
      <text x="${w / 2}" y="${ctaY + ctaHeight * 0.62}" font-family="Arial Black, sans-serif"
            font-size="${ctaFontSize}" font-weight="900" fill="white"
            text-anchor="middle">
        PREVIEW · PAGUE PARA LIBERAR
      </text>
    </svg>
  `
  return await img
    .composite([{ input: Buffer.from(svg), gravity: 'center' }])
    .png()
    .toBuffer()
}

// PDF de impressão (Fase 1.5) — pendente: instalar pdf-lib via
// `npm i pdf-lib`. Vai gerar PDF 5.7×7.6cm + sangria 3mm + marcas de
// corte. Pedro pode adicionar quando quiser ativar a opção +R$2.
