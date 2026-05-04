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
const MODEL = 'gemini-2.5-flash-image-preview'

const STYLE_PROMPT_COPA_2026 = `Crie uma figurinha estilo Panini FIFA World Cup 2026 (idêntica às figurinhas oficiais do álbum Panini Copa 2026), usando a foto da pessoa que enviei.

Especificações VISUAIS (siga fielmente):
- Fundo: gradiente colorido vibrante com grande número "26" estilizado em texto translúcido, similar ao das figurinhas dos jogadores do Brasil no álbum Copa 2026.
- Foto da pessoa: recortada da cintura pra cima, posando como jogador (foto do tipo "estudio"), nítida.
- Faixa horizontal embaixo (estilo Panini): nome em letras maiúsculas brancas (use "FIGURINHA · COMPLETE AÍ" se nenhum nome foi fornecido), com data de "nascimento", altura e peso fictícios em fonte pequena bege/dourada.
- Faixa de "clube": linha embaixo da faixa de nome, dizendo "COMPLETE AÍ" + "(ALBUM PANINI 2026)"
- Bandeira fictícia no canto superior direito (use as cores verde e amarela do Brasil como default)
- Logo "FIFA" pequeno e código de país de 3 letras tipo "FAN" no canto direito.
- Acabamento brilhante (foil-like) similar às figurinhas oficiais
- Proporção: retrato vertical 5:7 (igual figurinha Panini real)

IMPORTANTE: o estilo deve ser FIEL ao álbum Panini Copa 2026 (referência: figurinhas como "BRA-14 Vinícius Júnior", "BRA-15 Rodrygo"). Não estilizar exageradamente — deve parecer figurinha real.`

export type GenerateStickerInput = {
  photoBase64: string         // foto da pessoa, sem data URL prefix
  photoMimeType: string       // 'image/jpeg' | 'image/png'
  personName?: string         // opcional
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
  if (input.personName) {
    prompt += `\n\nNome a usar na faixa: "${input.personName.toUpperCase()}".`
  }
  return prompt
}

/**
 * Aplica marca d'água diagonal "Complete Aí · PREVIEW" sobre a imagem.
 * Usado pra preview pré-pagamento — user vê o resultado mas não pode usar.
 *
 * Returns PNG buffer com WM.
 */
export async function applyPreviewWatermark(pngBase64: string): Promise<Buffer> {
  const img = sharp(Buffer.from(pngBase64, 'base64'))
  const meta = await img.metadata()
  const w = meta.width || 1024
  const h = meta.height || 1434

  // SVG de marca d'água — texto repetido em diagonal
  const fontSize = Math.round(w * 0.06)
  const svg = `
    <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="wm" patternUnits="userSpaceOnUse" width="${w * 0.6}" height="${h * 0.25}" patternTransform="rotate(-30)">
          <text x="0" y="${fontSize}" font-family="Arial, sans-serif" font-size="${fontSize}"
                font-weight="bold" fill="rgba(255,255,255,0.55)"
                stroke="rgba(0,0,0,0.4)" stroke-width="2">
            COMPLETE AÍ · PREVIEW
          </text>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#wm)"/>
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
