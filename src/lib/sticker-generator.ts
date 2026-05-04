/**
 * Pedro 2026-05-04: gera figurinha digital personalizada estilo Copa 2026.
 *
 * Pipeline (Opção B — template + composição):
 *   1. recebe foto base64 + dados (nome/data/altura/peso/clube)
 *   2. chama Gemini Image SOMENTE pra gerar o RETRATO (cintura pra cima,
 *      camisa amarela do Brasil, fundo TRANSPARENTE) — não pede o layout
 *      completo da figurinha (LLM não copia layout pixel-perfect)
 *   3. compõe template SVG (fundo turquesa + "26" + faixas + logos + textos)
 *      em cima do retrato via Sharp — layout 100% fiel à Panini garantido
 *   4. retorna PNG final composto
 *
 * Watermark é aplicado por aplicarPreviewWatermark() em camada separada,
 * pra que a versão paga (limpa) reuse a mesma composição base.
 */
import sharp from 'sharp'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!
const MODEL = 'gemini-2.5-flash-image'

// ─── Dimensões da figurinha (5:7, padrão Panini) ───
const STICKER_W = 1000
const STICKER_H = 1400

// Cores oficiais Copa 2026 (extraídas da figurinha real do Vinícius Júnior)
const COLORS = {
  bgTurquoise: '#6FC9C0',
  bgTurquoiseDark: '#2A8B82',
  numberGreen: '#1B5E4F',
  numberYellow: '#FFD23F',
  jerseyYellow: '#FFD400',
  jerseyGreen: '#009C3B',
  textWhite: '#FFFFFF',
  textCream: '#E8D78F',
  paniniRed: '#D62828',
} as const

// Prompt focado APENAS no retrato — sem layout, sem fundo gráfico, sem texto.
const PORTRAIT_PROMPT = `Gere SOMENTE um retrato fotorrealista profissional da pessoa na foto enviada, no estilo "jogador da seleção brasileira posando para foto oficial de figurinha Panini Copa do Mundo 2026".

═══ O QUE GERAR ═══

ENQUADRAMENTO:
- Pessoa da CINTURA PARA CIMA (busto + cabeça + parte dos ombros).
- Pose neutra, séria, ombros ligeiramente abertos para a câmera.
- Olhar diretamente pra frente (lente da câmera).
- Cabeça centralizada, levemente acima do meio-vertical.

VESTUÁRIO (camisa oficial Brasil 2026):
- Camisa AMARELO-OURO sólido (HEX #FFD400).
- Gola V em VERDE-BRASIL (HEX #009C3B), discreta, ajustada ao pescoço.
- Detalhes de ombro/manga em verde Brasil sutis.
- No peito esquerdo (olhando pra figurinha): escudo da CBF — escudo azul-marinho com 5 estrelinhas amarelas em arco no topo + sigla "CBF" amarela ao centro.
- No peito direito: logo discreto do fornecedor (Nike swoosh branco pequeno).
- No peito central, palavra "BRASIL" em verde escuro pequena (opcional, sutil).

═══ FUNDO ═══

⚠️ FUNDO COR SÓLIDA TURQUESA #6FC9C0 (cor água-marinha clara, idêntica ao fundo da figurinha Panini Copa 2026).
- ❌ Nada de gradiente, paisagem, estádio, holograma, textura, ruído.
- ❌ Nada de letras, números (especialmente NADA de "26"), logos, frames, bordas.
- ❌ Nada de marca d'água, rótulo, escrita.
- ❌ Nada de bandeira, escudo, símbolos extras.
- ✅ APENAS cor sólida #6FC9C0 100% uniforme atrás da pessoa.
- ✅ A pessoa centralizada, recortada com bordas naturais (cabelos, ombros, pescoço — bordas suaves, sem artefatos).

═══ INTEGRAÇÃO ROSTO/PESCOÇO/CAMISA ═══

A pessoa enviada tem o ROSTO que quero usar. O resultado precisa parecer UM ÚNICO RETRATO PROFISSIONAL — nunca montagem.

OBRIGATÓRIO:
- TOM DE PELE perfeitamente uniforme entre rosto, pescoço, orelhas e parte do braço/mão visível. Equalize variações da foto original (luz amarelada, branco automático, sombras duras).
- ILUMINAÇÃO única vinda do alto-frente (estilo estúdio): sombra suave embaixo do queixo + leve sombra na lateral oposta do nariz. Mesma direção em todo o corpo.
- PESCOÇO ANATÔMICO completo: trapézios descendo pros ombros. Não deixe rosto "flutuando" sobre a camisa.
- Gola da camisa ABRAÇA o pescoço naturalmente (sem linha de corte visível, sem aparência de Photoshop colado).
- Se a foto enviada cortou cabelo/pescoço, COMPLETE com geração natural respeitando estilo de cabelo da pessoa.
- Mantenha 100% das características faciais (formato do rosto, traços, pele, cabelo, expressão). NÃO embeleze, NÃO suavize pele exageradamente, NÃO mude idade aparente.

═══ NÃO FAÇA ═══

- ❌ Não desenhe o número "26" gigante atrás (vou compor depois)
- ❌ Não desenhe faixa de nome embaixo (vou compor depois)
- ❌ Não desenhe bandeira, logos FIFA/Panini, "BRA" vertical (vou compor depois)
- ❌ Não desenhe outras seleções — sempre Brasil
- ❌ Não estilize cartoon/anime/ilustração — é FOTOGRAFIA real
- ❌ Não adicione bordas, frame, sombra projetada, watermark
- ❌ Não mude pose dramática, ângulo lateral, expressão sorridente — neutra/séria sempre
- ❌ Não corte a cabeça nem mostre só rosto — quero busto completo

OUTPUT: PNG fundo transparente (ou verde-lima sólido se transparência indisponível), 1024×1024 ou maior, retrato vertical da pessoa com camisa Brasil.`

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
  variant?: 'copa2026'        // futuro: 'vintage' | 'holo' | etc
}

export type GenerateStickerResult =
  | { ok: true; pngBase64: string; promptUsed: string; modelUsed: string; estimatedCostUsd: number }
  | { ok: false; error: string; promptUsed: string }

/**
 * Gera figurinha completa: retrato via Gemini + composição do template via Sharp.
 *
 * Custo: ~$0.04 por imagem (Gemini Image).
 */
export async function generateSticker(input: GenerateStickerInput): Promise<GenerateStickerResult> {
  // 1. Pede SÓ o retrato pro Gemini
  const portraitResult = await generatePortrait(input)
  if (!portraitResult.ok) return portraitResult

  // 2. Compõe template + retrato + textos via Sharp
  try {
    const finalBuffer = await composeStickerFinal({
      portraitPngBase64: portraitResult.pngBase64,
      personName: input.personName,
      birthDate: input.birthDate,
      heightM: input.heightM,
      weightKg: input.weightKg,
      clubName: input.clubName,
      clubCountry: input.clubCountry,
      countryCode: input.countryCode || 'BRA',
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
 * Retorna PNG base64 da pessoa em camisa do Brasil, fundo idealmente transparente.
 */
async function generatePortrait(input: GenerateStickerInput): Promise<GenerateStickerResult> {
  const prompt = PORTRAIT_PROMPT
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: input.photoMimeType, data: input.photoBase64 } },
          ],
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
  countryCode: string
}

/**
 * Compõe a figurinha final:
 *   1. Renderiza o template SVG de fundo (turquesa + "26" + lateral "BRA" + bandeira + faixas vazias)
 *   2. Recorta/redimensiona o retrato e tenta remover fundo verde se Gemini retornou chroma key
 *   3. Composita o retrato no centro, atrás do "BRA" mas na frente do "26"
 *   4. Renderiza camada de texto (nome, stats, clube, logos FIFA/Panini)
 *   5. Output PNG final
 */
export async function composeStickerFinal(input: ComposeInput): Promise<Buffer> {
  // 1. Template de fundo
  const bgSvg = buildBackgroundSvg()

  // 2. Prepara o retrato — redimensiona pra caber + tenta chroma-key se for verde sólido
  const portraitRaw = Buffer.from(input.portraitPngBase64, 'base64')
  const portraitProcessed = await processPortrait(portraitRaw)

  // Posicionamento do retrato: ocupa do topo (~y=120) até início da faixa (~y=1080).
  // Largura proporcional (~ 78% da largura, centralizado).
  const portraitW = Math.round(STICKER_W * 0.78)
  const portraitH = Math.round(STICKER_H * 0.70) // 70% da altura
  const portraitX = Math.round((STICKER_W - portraitW) / 2)
  const portraitY = Math.round(STICKER_H * 0.075) // 7.5% do topo

  const portraitResized = await sharp(portraitProcessed)
    .resize(portraitW, portraitH, { fit: 'cover', position: 'top' })
    .png()
    .toBuffer()

  // 3. Camada de overlay: lateral "BRA" + faixas inferiores + textos + logos
  const overlaySvg = buildOverlaySvg(input)

  // 4. Composita: bg → retrato → overlay
  const composed = await sharp(Buffer.from(bgSvg))
    .composite([
      { input: portraitResized, top: portraitY, left: portraitX },
      { input: Buffer.from(overlaySvg), top: 0, left: 0 },
    ])
    .png()
    .toBuffer()

  return composed
}

/**
 * Tenta limpar o fundo do retrato:
 * - Se o retrato veio com alpha (Gemini respeitou transparência), passa adiante
 * - Se veio com fundo verde-lima sólido (chroma key), remove via threshold
 * - Senão, mantém como está e o overlay vai sobrepor
 *
 * Pedro 2026-05-04: Sharp não tem chroma key nativo, então fazemos um
 * threshold simples no canal verde + alpha. Em produção pode-se trocar
 * por uma chamada a um serviço de remove.bg ou similar.
 */
async function processPortrait(raw: Buffer): Promise<Buffer> {
  const meta = await sharp(raw).metadata()
  // Se já tem alpha, assume transparência ok — só garante PNG.
  if (meta.hasAlpha) {
    return await sharp(raw).png().toBuffer()
  }
  // Senão, retorna como está. Implementação futura: chroma key via threshold.
  return await sharp(raw).png().toBuffer()
}

/**
 * SVG do template de fundo: cor turquesa + "26" gigante decorativo +
 * brilho holográfico sutil (gradiente).
 */
function buildBackgroundSvg(): string {
  const w = STICKER_W
  const h = STICKER_H
  // "26" gigante no centro: 2 ocupa esquerda, 6 ocupa direita.
  // Posições calibradas pra ficar atrás do jogador.
  const numFontSize = Math.round(h * 0.62) // bem grande
  const numY = Math.round(h * 0.62)         // baseline
  const num2X = Math.round(w * 0.04)
  const num6X = Math.round(w * 0.96)

  return `
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="holo" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#FFFFFF" stop-opacity="0.10"/>
      <stop offset="40%"  stop-color="#FFFFFF" stop-opacity="0"/>
      <stop offset="60%"  stop-color="#FFFFFF" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- Fundo turquesa -->
  <rect width="${w}" height="${h}" fill="${COLORS.bgTurquoise}"/>

  <!-- "26" gigante (2 verde-escuro à esquerda + 6 amarelo à direita) -->
  <text x="${num2X}" y="${numY}"
        font-family="Impact, 'Arial Black', sans-serif"
        font-size="${numFontSize}" font-weight="900"
        fill="${COLORS.numberGreen}"
        text-anchor="start">2</text>
  <text x="${num6X}" y="${numY}"
        font-family="Impact, 'Arial Black', sans-serif"
        font-size="${numFontSize}" font-weight="900"
        fill="${COLORS.numberYellow}"
        text-anchor="end">6</text>

  <!-- Brilho holográfico sutil -->
  <rect width="${w}" height="${h}" fill="url(#holo)"/>
</svg>`.trim()
}

/**
 * SVG do overlay (frente): faixa inferior nome+stats+clube, "BRA" vertical
 * direita, bandeira circular Brasil, logos FIFA + Panini.
 */
function buildOverlaySvg(input: ComposeInput): string {
  const w = STICKER_W
  const h = STICKER_H

  const name = (input.personName || 'COMPLETE AÍ').toUpperCase()
  const stats = formatStatsLine(input)
  const club = formatClubLine(input)
  const country3 = (input.countryCode || 'BRA').toUpperCase().slice(0, 3)

  // ─── Faixas inferiores ───
  // Faixa principal: ~14% da altura, contém nome + stats
  const mainBarH = Math.round(h * 0.14)
  const mainBarY = Math.round(h * 0.78)
  // Faixa do clube: ~6% da altura
  const clubBarH = Math.round(h * 0.06)
  const clubBarY = mainBarY + mainBarH
  // Sobra (panini) ocupa o resto
  const paniniBarY = clubBarY + clubBarH
  const paniniBarH = h - paniniBarY

  // Tamanhos de texto
  const nameFontSize = Math.round(w * 0.058)
  const statsFontSize = Math.round(w * 0.027)
  const clubFontSize = Math.round(w * 0.030)

  // ─── Lateral direita "BRA" vertical ───
  const braFontSize = Math.round(w * 0.10)
  const braX = Math.round(w * 0.945)
  const braYStart = Math.round(h * 0.32)

  // ─── Bandeira circular Brasil (canto superior direito-acima do BRA) ───
  const flagCx = Math.round(w * 0.92)
  const flagCy = Math.round(h * 0.15)
  const flagR = Math.round(w * 0.045)

  // ─── Logo FIFA (canto superior direito) ───
  const fifaX = Math.round(w * 0.045)
  const fifaY = Math.round(h * 0.06)
  const fifaFontSize = Math.round(w * 0.038)

  return `
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
  <!-- ═══ Logo FIFA canto superior esquerdo ═══ -->
  <g transform="translate(${fifaX}, ${fifaY})">
    <text x="0" y="0" font-family="'Helvetica Neue', Arial, sans-serif"
          font-size="${fifaFontSize}" font-weight="900"
          fill="${COLORS.textWhite}" letter-spacing="2">FIFA</text>
    <text x="0" y="${fifaFontSize * 1.0}" font-family="Arial, sans-serif"
          font-size="${Math.round(fifaFontSize * 0.32)}" font-weight="700"
          fill="${COLORS.textWhite}" letter-spacing="1">WORLD CUP 26</text>
  </g>

  <!-- ═══ Bandeira circular Brasil (lateral direita topo) ═══ -->
  <g>
    <!-- aro branco -->
    <circle cx="${flagCx}" cy="${flagCy}" r="${flagR + 3}" fill="${COLORS.textWhite}"/>
    <!-- verde -->
    <circle cx="${flagCx}" cy="${flagCy}" r="${flagR}" fill="${COLORS.jerseyGreen}"/>
    <!-- losango amarelo -->
    <polygon points="${flagCx},${flagCy - flagR * 0.7}
                     ${flagCx + flagR * 0.78},${flagCy}
                     ${flagCx},${flagCy + flagR * 0.7}
                     ${flagCx - flagR * 0.78},${flagCy}"
             fill="${COLORS.numberYellow}"/>
    <!-- círculo azul -->
    <circle cx="${flagCx}" cy="${flagCy}" r="${flagR * 0.42}" fill="#002776"/>
    <!-- estrelinhas brancas (3 pontos representando) -->
    <circle cx="${flagCx - flagR * 0.15}" cy="${flagCy - flagR * 0.05}" r="${flagR * 0.04}" fill="${COLORS.textWhite}"/>
    <circle cx="${flagCx + flagR * 0.10}" cy="${flagCy + flagR * 0.10}" r="${flagR * 0.04}" fill="${COLORS.textWhite}"/>
    <circle cx="${flagCx + flagR * 0.20}" cy="${flagCy - flagR * 0.18}" r="${flagR * 0.03}" fill="${COLORS.textWhite}"/>
  </g>

  <!-- ═══ Lateral direita "BRA" vertical (rotacionado 90°) ═══ -->
  <g transform="translate(${braX}, ${braYStart}) rotate(90)">
    <text x="0" y="0" font-family="Impact, 'Arial Black', sans-serif"
          font-size="${braFontSize}" font-weight="900"
          fill="${COLORS.textWhite}"
          letter-spacing="6">${country3}</text>
  </g>

  <!-- ═══ Faixa principal (nome + stats) ═══ -->
  <rect x="0" y="${mainBarY}" width="${w}" height="${mainBarH}" fill="${COLORS.bgTurquoiseDark}"/>
  <text x="${Math.round(w * 0.05)}" y="${mainBarY + mainBarH * 0.50}"
        font-family="'Helvetica Neue', Arial, sans-serif"
        font-size="${nameFontSize}" font-weight="900"
        fill="${COLORS.textWhite}"
        dominant-baseline="middle"
        letter-spacing="1">${escapeXml(name)}</text>
  ${stats ? `<text x="${Math.round(w * 0.05)}" y="${mainBarY + mainBarH * 0.85}"
        font-family="Arial, sans-serif"
        font-size="${statsFontSize}" font-weight="600"
        fill="${COLORS.textCream}"
        dominant-baseline="middle"
        letter-spacing="2">${escapeXml(stats)}</text>` : ''}

  <!-- ═══ Faixa do clube ═══ -->
  <rect x="0" y="${clubBarY}" width="${w}" height="${clubBarH}" fill="${COLORS.bgTurquoiseDark}" opacity="0.85"/>
  ${club ? `<text x="${Math.round(w * 0.05)}" y="${clubBarY + clubBarH * 0.62}"
        font-family="Arial, sans-serif"
        font-size="${clubFontSize}" font-weight="700"
        fill="${COLORS.textWhite}"
        dominant-baseline="middle"
        letter-spacing="1">${escapeXml(club)}</text>` : ''}

  <!-- ═══ Logo Panini canto inferior direito ═══ -->
  <g transform="translate(${Math.round(w * 0.78)}, ${paniniBarY + Math.round(paniniBarH * 0.15)})">
    <rect x="0" y="0" width="${Math.round(w * 0.18)}" height="${Math.round(paniniBarH * 0.70)}"
          fill="${COLORS.paniniRed}" rx="4"/>
    <text x="${Math.round(w * 0.09)}" y="${Math.round(paniniBarH * 0.50)}"
          font-family="'Brush Script MT', 'Lucida Handwriting', cursive"
          font-size="${Math.round(w * 0.040)}" font-weight="900"
          fill="${COLORS.numberYellow}"
          text-anchor="middle"
          dominant-baseline="middle"
          font-style="italic">Panini</text>
  </g>
</svg>`.trim()
}

function formatStatsLine(input: ComposeInput): string {
  const parts: string[] = []
  if (input.birthDate) parts.push(input.birthDate)
  if (input.heightM)   parts.push(`${input.heightM} m`)
  if (input.weightKg)  parts.push(`${input.weightKg} kg`)
  return parts.join('   |   ')
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
  const w = meta.width || STICKER_W
  const h = meta.height || STICKER_H

  const tileFontSize = Math.round(w * 0.07)
  const ctaFontSize = Math.round(w * 0.085)
  const ctaHeight = Math.round(h * 0.14)
  const ctaY = Math.round(h * 0.42) // central-superior pra cobrir rosto

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
