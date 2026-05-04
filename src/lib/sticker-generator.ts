/**
 * Pedro 2026-05-04: gera figurinha digital personalizada estilo Copa 2026.
 *
 * Pipeline (Opção C — template real + composição):
 *   1. recebe foto base64 + dados (nome/data/altura/peso/clube)
 *   2. chama Gemini Image SOMENTE pra gerar o RETRATO (cintura pra cima,
 *      camisa amarela do Brasil, fundo turquesa idêntico ao template)
 *   3. carrega o template real (figurinha BRA original em alta-res),
 *      sobrepõe o retrato cobrindo o jogador original, cobre as faixas
 *      de texto e renderiza nome/stats/clube novos por cima
 *   4. retorna PNG final composto
 *
 * Watermark é aplicado por applyPreviewWatermark() em camada separada.
 */
import sharp from 'sharp'
import path from 'path'
import { promises as fs } from 'fs'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!
const MODEL = 'gemini-2.5-flash-image'

// ─── Template real ───
// Imagem 480×639 com a figurinha do João Pedro. Vamos cobrir o jogador
// e os textos de nome/stats/clube. Resto do template (cor de fundo,
// "26" decorativo, FIFA, bandeira, "BRA" vertical, logo Panini) fica
// preservado.
const TEMPLATE_PATH = path.join(process.cwd(), 'public', 'sticker-templates', 'copa2026-bra-base.jpg')

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
// (que têm "JOÃO PEDRO / 26-9-2001..." e "CHELSEA FC (ENG)"). Calibradas
// após observar que o pill nome+stats vai de ~y=515 a ~y=585, e o pill
// clube de ~y=590 a ~y=618.
const PILL_NAME = { x: 13, y: 510, w: 320, h: 75, radius: 36 }
// Pill clube — não pode estender até o canto direito senão cobre logo Panini
const PILL_CLUB = { x: 108, y: 587, w: 220, h: 32, radius: 16 }

// Prompt focado APENAS no retrato — sem layout, sem fundo gráfico, sem texto.
const PORTRAIT_PROMPT = `Gere SOMENTE um retrato fotorrealista profissional da pessoa na foto enviada, no estilo "jogador da seleção brasileira posando para foto oficial de figurinha Panini Copa do Mundo 2026".

═══ ENQUADRAMENTO (CRÍTICO — bate com slot da figurinha) ═══

- Pessoa da CINTURA PARA CIMA — cabeça + pescoço + busto + ombros + parte do peito até logo abaixo do escudo.
- Cabeça centralizada horizontalmente, ocupando a TERÇA SUPERIOR da imagem.
- Pose neutra, séria, ombros levemente abertos para a câmera (pose simétrica frontal).
- Olhar diretamente pra frente, expressão neutra/séria.
- Não corte a cabeça nem mostre só rosto — quero busto completo.

═══ VESTUÁRIO (camisa oficial Brasil 2026) ═══

- Camisa AMARELO-OURO sólido (HEX #FFD400) com TEXTURA de listras verticais discretas/franjas sutis (igual à camisa original do Brasil 2024-2026).
- Gola V em VERDE-BRASIL (HEX #009C3B), discreta, ajustada ao pescoço.
- Detalhes de ombro/manga com pequenos detalhes verdes.
- No peito esquerdo (lado direito da imagem olhando pra figurinha): escudo da CBF — escudo azul-marinho com 5 estrelinhas amarelas em arco no topo + sigla "CBF" amarela ao centro.
- No peito direito (lado esquerdo da imagem): logo Nike swoosh BRANCO discreto.

═══ FUNDO (CRÍTICO — copy this color exactly) ═══

⚠️ FUNDO COR SÓLIDA EXATA: HEX #6FC9C0 (turquesa água-marinha clara).
A SEGUNDA IMAGEM que estou enviando é a figurinha Panini Copa 2026 oficial — copie EXATAMENTE essa cor de fundo turquesa para o seu fundo. RGB(111, 201, 192). Não use cinza, não use azul, não use verde — APENAS esse turquesa específico.

- ❌ Nada de cinza neutro (commits frequentes — NÃO COMETA)
- ❌ Nada de gradiente, paisagem, estádio, holograma, textura, ruído
- ❌ Nada de letras, números (especialmente NADA de "26" verde), logos, frames, bordas
- ❌ Nada de marca d'água, rótulo, escrita
- ❌ Nada de bandeira, escudo, símbolos extras atrás
- ✅ APENAS cor sólida #6FC9C0 100% uniforme atrás da pessoa, idêntica à segunda imagem
- ✅ Pessoa centralizada, bordas naturais (cabelos, ombros, pescoço — sem artefatos)

═══ INTEGRAÇÃO ROSTO/PESCOÇO/CAMISA ═══

A pessoa enviada tem o ROSTO que quero usar. O resultado precisa parecer UM ÚNICO RETRATO PROFISSIONAL — nunca montagem.

OBRIGATÓRIO:
- TOM DE PELE perfeitamente uniforme entre rosto, pescoço, orelhas e qualquer parte do braço/mão visível. Equalize variações da foto original (luz amarelada, branco automático, sombras duras).
- ILUMINAÇÃO única vinda do alto-frente (estilo estúdio): sombra suave embaixo do queixo + leve sombra na lateral oposta do nariz. Mesma direção em todo o corpo.
- PESCOÇO ANATÔMICO completo: trapézios descendo pros ombros. Não deixe rosto "flutuando" sobre a camisa.
- Gola da camisa ABRAÇA o pescoço naturalmente (sem linha de corte visível, sem aparência de Photoshop colado).
- Se a foto enviada cortou cabelo/pescoço, COMPLETE com geração natural respeitando estilo de cabelo da pessoa.
- Mantenha 100% das características faciais (formato do rosto, traços, pele, cabelo, expressão). NÃO embeleze, NÃO suavize pele exageradamente, NÃO mude idade aparente.

═══ NÃO FAÇA ═══

- ❌ Não desenhe o número "26" (vou compor depois)
- ❌ Não desenhe faixas de nome embaixo (vou compor depois)
- ❌ Não desenhe bandeira, logos FIFA/Panini, "BRA" vertical (já estão no template)
- ❌ Não desenhe outras seleções — sempre Brasil
- ❌ Não estilize cartoon/anime/ilustração — é FOTOGRAFIA real
- ❌ Não adicione bordas, frame, sombra projetada, watermark
- ❌ Não mude pose dramática, ângulo lateral, expressão sorridente — neutra/séria sempre

OUTPUT: PNG retrato vertical (proporção próxima a 2:3) com APENAS a pessoa + fundo turquesa sólido.`

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
      estimatedCostUsd: 0.04,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sticker-gen] compose exception:', msg)
    return { ok: false, error: 'Falha ao compor figurinha: ' + msg, promptUsed: portraitResult.promptUsed }
  }
}

/**
 * Chama Gemini Image pra gerar SOMENTE o retrato (sem template).
 * Retorna PNG base64 da pessoa em camisa do Brasil, fundo turquesa sólido.
 */
async function generatePortrait(input: GenerateStickerInput): Promise<GenerateStickerResult> {
  const prompt = PORTRAIT_PROMPT
  try {
    // Carrega o template como SEGUNDA imagem de referência —
    // Gemini vê a cor exata do fundo turquesa que precisa replicar.
    let templateBase64: string | null = null
    try {
      const tplBuffer = await fs.readFile(TEMPLATE_PATH)
      templateBase64 = tplBuffer.toString('base64')
    } catch (e) {
      console.warn('[sticker-gen] template not found, prompt-only mode:', e)
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`
    const requestParts: Array<Record<string, unknown>> = [
      { text: prompt },
      { inline_data: { mime_type: input.photoMimeType, data: input.photoBase64 } },
    ]
    if (templateBase64) {
      requestParts.push({ inline_data: { mime_type: 'image/jpeg', data: templateBase64 } })
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: requestParts,
        }],
        generationConfig: {
          responseModalities: ['Text', 'Image'],
          temperature: 0.35, // baixa pra fidelidade
        },
      }),
    })

    if (!res.ok) {
      const errBody = await res.text()
      console.error('[sticker-gen] Gemini error:', res.status, errBody.slice(0, 500))
      return { ok: false, error: `Gemini API ${res.status}: ${errBody.slice(0, 200)}`, promptUsed: prompt }
    }

    type GeminiResponse = {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: { data: string; mimeType: string }
            text?: string
          }>
        }
      }>
    }
    const data = (await res.json()) as GeminiResponse
    const parts = data?.candidates?.[0]?.content?.parts || []
    const imagePart = parts.find((p) => p.inlineData?.data)

    if (!imagePart?.inlineData?.data) {
      console.error('[sticker-gen] no image in response:', JSON.stringify(data).slice(0, 400))
      return { ok: false, error: 'Gemini não retornou imagem', promptUsed: prompt }
    }

    return {
      ok: true,
      pngBase64: imagePart.inlineData.data,
      promptUsed: prompt,
      modelUsed: MODEL,
      estimatedCostUsd: 0.04,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sticker-gen] portrait exception:', msg)
    return { ok: false, error: msg, promptUsed: prompt }
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
export async function composeStickerFinal(input: ComposeInput): Promise<Buffer> {
  // 1. Carrega o template real
  const templateBuffer = await fs.readFile(TEMPLATE_PATH)

  // 2. Prepara o retrato pra encaixar no slot do jogador
  const portraitRaw = Buffer.from(input.portraitPngBase64, 'base64')
  const portraitResized = await sharp(portraitRaw)
    .resize(PORTRAIT_REGION.w, PORTRAIT_REGION.h, { fit: 'cover', position: 'top' })
    .png()
    .toBuffer()

  // 3. Overlay com pills cobrindo + textos novos
  const overlaySvg = buildOverlaySvg(input)

  // 4. Compõe: template → retrato → overlay
  const composed = await sharp(templateBuffer)
    .composite([
      { input: portraitResized, top: PORTRAIT_REGION.y, left: PORTRAIT_REGION.x },
      { input: Buffer.from(overlaySvg), top: 0, left: 0 },
    ])
    .png()
    .toBuffer()

  return composed
}

/**
 * SVG que cobre as pills antigas (nome/stats/clube) e renderiza textos novos.
 * Não desenha logos FIFA, Panini, "26", "BRA" — esses ficam intactos no template.
 */
function buildOverlaySvg(input: ComposeInput): string {
  const w = TEMPLATE_W
  const h = TEMPLATE_H

  const name = (input.personName || 'COMPLETE AÍ').toUpperCase()
  const stats = formatStatsLine(input)
  const club = formatClubLine(input)

  // Tamanhos calibrados pra resolução 480×639
  const nameFontSize = 24
  const statsFontSize = 13
  const clubFontSize = 12

  // Posições dos textos dentro das pills (centralizado vertical)
  const nameY = PILL_NAME.y + 28 // linha 1 do pill
  const statsY = PILL_NAME.y + 56 // linha 2 do pill
  const clubY = PILL_CLUB.y + PILL_CLUB.h / 2

  // Vercel Lambda só tem fontes Linux: DejaVu Sans, Liberation Sans, Noto Sans.
  // Helvetica/Arial NÃO existem — caía em fallback que renderizava tofu (□□□).
  // DejaVu Sans Bold é a escolha mais segura, suporta UTF-8 PT-BR completo.
  const FONT_BOLD = "'DejaVu Sans', 'Liberation Sans', sans-serif"

  return `
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
  <!-- ═══ Cobre pill nome+stats antiga ═══ -->
  <rect x="${PILL_NAME.x}" y="${PILL_NAME.y}"
        width="${PILL_NAME.w}" height="${PILL_NAME.h}"
        rx="${PILL_NAME.radius}" ry="${PILL_NAME.radius}"
        fill="${COLORS.bgPillDark}"/>

  <!-- Linha 1: NOME (branco bold) -->
  <text x="${PILL_NAME.x + PILL_NAME.w / 2}" y="${nameY}"
        font-family="${FONT_BOLD}"
        font-size="${nameFontSize}" font-weight="bold"
        fill="${COLORS.textWhite}"
        text-anchor="middle"
        dominant-baseline="middle">${escapeXml(name)}</text>

  <!-- Linha 2: STATS (branco menor) -->
  ${stats ? `<text x="${PILL_NAME.x + PILL_NAME.w / 2}" y="${statsY}"
        font-family="${FONT_BOLD}"
        font-size="${statsFontSize}" font-weight="normal"
        fill="${COLORS.textWhite}"
        text-anchor="middle"
        dominant-baseline="middle">${escapeXml(stats)}</text>` : ''}

  <!-- ═══ Cobre pill clube antiga ═══ -->
  <rect x="${PILL_CLUB.x}" y="${PILL_CLUB.y}"
        width="${PILL_CLUB.w}" height="${PILL_CLUB.h}"
        rx="${PILL_CLUB.radius}" ry="${PILL_CLUB.radius}"
        fill="${COLORS.bgPillLight}"/>

  ${club ? `<text x="${PILL_CLUB.x + PILL_CLUB.w / 2}" y="${clubY}"
        font-family="${FONT_BOLD}"
        font-size="${clubFontSize}" font-weight="bold"
        fill="${COLORS.textWhite}"
        text-anchor="middle"
        dominant-baseline="middle">${escapeXml(club)}</text>` : ''}
</svg>`.trim()
}

function formatStatsLine(input: ComposeInput): string {
  const parts: string[] = []
  if (input.birthDate) parts.push(input.birthDate)
  if (input.heightM)   parts.push(`${input.heightM}m`)
  if (input.weightKg)  parts.push(`${input.weightKg} kg`)
  return parts.join(' | ')
}

function formatClubLine(input: ComposeInput): string {
  if (!input.clubName) return ''
  const club = input.clubName.toUpperCase()
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

  const tileFontSize = Math.round(w * 0.07)
  const ctaFontSize = Math.round(w * 0.085)
  const ctaHeight = Math.round(h * 0.12)
  // Posiciona a barra central NO ROSTO (não cobre os pills inferiores).
  // Rosto está em ~y=15-180px (proporcional 2.3-28%); barra em 22-34% cobre
  // a região nariz+queixo perfeitamente sem invadir o nome.
  const ctaY = Math.round(h * 0.22)

  // SVG: 3 camadas — overlay escuro semi-transparente + texto diagonal denso + barra central
  const svg = `
    <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="wm" patternUnits="userSpaceOnUse" width="${w * 0.45}" height="${h * 0.18}" patternTransform="rotate(-28)">
          <text x="0" y="${tileFontSize}" font-family="Arial Black, Helvetica, sans-serif" font-size="${tileFontSize}"
                font-weight="900" fill="rgba(255,255,255,0.65)"
                stroke="rgba(0,0,0,0.7)" stroke-width="3">
            COMPLETE AÍ
          </text>
          <text x="0" y="${tileFontSize * 2.2}" font-family="Arial Black, Helvetica, sans-serif" font-size="${Math.round(tileFontSize * 0.7)}"
                font-weight="900" fill="rgba(255,80,80,0.85)"
                stroke="rgba(0,0,0,0.7)" stroke-width="2">
            PREVIEW · PAGUE PARA LIBERAR
          </text>
        </pattern>
      </defs>
      <!-- 1. Overlay escuro pra reduzir uso "como está" -->
      <rect width="100%" height="100%" fill="rgba(0,0,0,0.30)"/>
      <!-- 2. Padrão diagonal cobrindo tudo -->
      <rect width="100%" height="100%" fill="url(#wm)"/>
      <!-- 3. Barra central horizontal de alto impacto -->
      <rect x="0" y="${ctaY}" width="${w}" height="${ctaHeight}" fill="rgba(220,30,30,0.85)"/>
      <text x="${w / 2}" y="${ctaY + ctaHeight * 0.60}" font-family="Arial Black, sans-serif"
            font-size="${ctaFontSize}" font-weight="900" fill="white"
            text-anchor="middle"
            stroke="rgba(0,0,0,0.6)" stroke-width="2">
        PREVIEW · NÃO USE
      </text>
      <text x="${w / 2}" y="${ctaY + ctaHeight * 0.92}" font-family="Arial, sans-serif"
            font-size="${Math.round(ctaFontSize * 0.45)}" font-weight="700" fill="white"
            text-anchor="middle">
        Pague para liberar a versão limpa
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
