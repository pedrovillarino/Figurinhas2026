/**
 * Pedro 2026-05-04: gera figurinha digital personalizada com foto da
 * pessoa, no estilo Copa 2026 (igual jogadores do Brasil no álbum Panini).
 *
 * Pipeline:
 *   1. recebe foto base64 + nome opcional
 *   2. chama Gemini Image (gemini-2.5-flash-image-preview) com prompt
 *      detalhado do estilo + foto como referência
 *   3. retorna PNG base64
 *
 * NÃO faz watermark nem upload — quem chama decide o que fazer com
 * o output (geralmente: aplicar WM via sticker-watermark.ts e subir pro
 * Supabase Storage).
 */

import sharp from 'sharp'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!
const MODEL = 'gemini-2.5-flash-image'

const STYLE_PROMPT_COPA_2026 = `Crie uma figurinha IDÊNTICA ao layout do álbum Panini FIFA World Cup 2026 (Brasil), usando a foto da pessoa que enviei. Use a figurinha oficial do "Vinícius Júnior" como referência exata de layout.

LAYOUT EXATO (copie fielmente, posições e cores):

1. PROPORÇÃO: retrato vertical 5:7 (5,7×7,6cm — figurinha Panini standard).

2. FUNDO: cor sólida turquesa/verde-água (#4ECDC4 / #5DD3CB), com um GRANDE número "26" estilizado atrás do jogador, em verde-escuro (#1A5F4E) ocupando largura inteira. O "2" ocupa metade esquerda, o "6" metade direita, ambos translúcidos atrás da pessoa.

3. PESSOA: foto da cintura pra cima, centralizada, sem fundo (recortada), vestindo uma camiseta esportiva (cor a definir conforme dados; default amarela do Brasil com gola verde). Pose: olhando pra frente, neutra/séria.

4. CAMISA: gola verde, mangas curtas, com escudo do clube no peito esquerdo (use o do time fornecido). No peito central pode ter o nome do país escrito pequeno tipo "BRASIL".

5. CANTO SUPERIOR DIREITO:
   - Logo "FIFA" branco com troféu pequeno, num quadrado branco
   - Logo "FIFA" branco também com troféu estilizado nos topo

6. LATERAL DIREITA (vertical, descendente):
   - Pequena bandeira do país (default Brasil verde/amarela), formato circular
   - Texto VERTICAL grande do código do país em 3 letras BRANCAS (ex: "BRA"), virado 90° pra direita

7. FAIXA HORIZONTAL EMBAIXO (estilo "barra" turquesa escuro):
   Linha 1: NOME em maiúsculas brancas, fonte sans-serif bold
   Linha 2: pequena, fonte bege/dourada: "DD-MM-AAAA | X,XX m | XX kg"

8. FAIXA INFERIOR (linha embaixo da faixa de nome):
   Texto em verde-água claro: "TIME (PAÍS)" — ex: "REAL MADRID CF (ESP)"

9. CANTO INFERIOR DIREITO: logo "Panini" amarelo no fundo vermelho retangular pequeno + escudo decorativo amarelo.

ACABAMENTO: aspecto de papel impresso fosco (não brilhante demais), cantos arredondados sutilmente, formato Panini standard.

⚠️ CRÍTICO — INTEGRAÇÃO DO ROSTO COM A CAMISA:
- A transição entre o ROSTO/PESCOÇO da pessoa e a CAMISA deve ser PERFEITAMENTE NATURAL (pele continua fluida até a gola).
- NÃO faça parecer montagem/colagem (sem linhas duras, sem mismatch de tom de pele, sem "head pasted on body").
- O pescoço deve ter sombra natural conectando-se ao tronco e à gola da camisa.
- Iluminação consistente: o rosto e a camisa têm a MESMA fonte de luz e tom.
- Se a foto enviada tem fundo, REMOVA o fundo do recorte da pessoa antes de compor — só o sujeito deve aparecer.
- Tom da pele do rosto e do pescoço/braços deve ser idêntico (mesmo que a foto original tenha cores levemente diferentes — equalize).

IMPORTANTE GERAL:
- NÃO adicione bordas ou marca d'água
- A pessoa deve ocupar do "26" pra baixo até o início da faixa do nome
- Mantenha o LAYOUT FIEL — é uma reprodução do estilo Panini, não uma reinterpretação
- Se algum dado não for fornecido, use placeholder coerente (ex: clube "COMPLETE AÍ FC")`

export type GenerateStickerInput = {
  photoBase64: string         // foto da pessoa, sem data URL prefix
  photoMimeType: string       // 'image/jpeg' | 'image/png'
  personName?: string         // ex: "Vinícius Júnior"
  birthDate?: string          // formato livre, vai pro prompt como dado bruto (ex: "12-7-2000" ou "12/07/2000")
  heightM?: string            // ex: "1,76"
  weightKg?: string           // ex: "73"
  clubName?: string           // ex: "Real Madrid CF"
  clubCountry?: string        // ex: "ESP"
  countryCode?: string        // 3 letras pro vertical, ex: "BRA"
  variant?: 'copa2026'        // futuro: 'vintage' | 'holo' | etc
}

export type GenerateStickerResult =
  | { ok: true; pngBase64: string; promptUsed: string; modelUsed: string; estimatedCostUsd: number }
  | { ok: false; error: string; promptUsed: string }

/**
 * Gera figurinha via Gemini Image. Retorna PNG base64.
 *
 * Custo: ~$0.04 por imagem (Gemini Imagen via gemini-2.5-flash-image).
 */
export async function generateSticker(input: GenerateStickerInput): Promise<GenerateStickerResult> {
  const prompt = buildPrompt(input)

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
          temperature: 0.4, // baixa pra fidelidade ao estilo
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
    console.error('[sticker-gen] exception:', msg)
    return { ok: false, error: msg, promptUsed: prompt }
  }
}

function buildPrompt(input: GenerateStickerInput): string {
  let prompt = STYLE_PROMPT_COPA_2026
  const data: string[] = []

  if (input.personName) data.push(`Nome (faixa branca em maiúsculas): ${input.personName.toUpperCase()}`)
  const stats: string[] = []
  if (input.birthDate)  stats.push(`Data de nascimento: ${input.birthDate}`)
  if (input.heightM)    stats.push(`Altura: ${input.heightM} m`)
  if (input.weightKg)   stats.push(`Peso: ${input.weightKg} kg`)
  if (stats.length)     data.push(`Linha de estatísticas (faixa pequena bege): "${stats.map((s) => s.split(': ')[1]).join(' | ')}"`)
  if (input.clubName) {
    const club = input.clubCountry
      ? `${input.clubName.toUpperCase()} (${input.clubCountry.toUpperCase()})`
      : input.clubName.toUpperCase()
    data.push(`Clube (faixa inferior): "${club}"`)
  }
  if (input.countryCode) {
    data.push(`Código de país (vertical lateral direita): "${input.countryCode.toUpperCase().slice(0, 3)}" (3 letras maiúsculas brancas)`)
  }

  if (data.length > 0) {
    prompt += `\n\nDADOS A USAR NESSA FIGURINHA (preencha exatamente):\n- ${data.join('\n- ')}`
  }
  return prompt
}

/**
 * Aplica marca d'água AGRESSIVA "Complete Aí · PREVIEW · PAGUE PARA LIBERAR"
 * sobre a imagem. Pedro 2026-05-04: deve ser visualmente forte o suficiente
 * pra impedir uso sem pagamento — overlay translúcido + texto repetido em
 * diagonal + barra horizontal central com call-to-action.
 *
 * Returns PNG buffer com WM.
 */
export async function applyPreviewWatermark(pngBase64: string): Promise<Buffer> {
  const img = sharp(Buffer.from(pngBase64, 'base64'))
  const meta = await img.metadata()
  const w = meta.width || 1024
  const h = meta.height || 1434

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
