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

const STYLE_PROMPT_COPA_2026 = `Reproduza FIELMENTE uma figurinha do álbum Panini FIFA World Cup 2026 — exatamente como a figurinha oficial "BRA-14 Vinícius Júnior" da seleção brasileira. É REPRODUÇÃO, não reinterpretação. Toda figurinha deve ser IDÊNTICA em layout, cores e posicionamento — apenas o ROSTO e os DADOS do nome/clube/data mudam.

═══ COMPOSIÇÃO EXATA DA FIGURINHA BRA (BRASIL) ═══

PROPORÇÃO: retrato vertical 5:7 (formato figurinha Panini standard).

FUNDO (4 camadas, do mais distante pro mais próximo):
1. Fundo base: turquesa médio/azul-piscina sólido (HEX #6FC9C0 a #5DBDB3, igual ao da figurinha do Vinícius — tom água-marinha clara, NÃO verde-bandeira nem verde-CBF).
2. Atrás do jogador, ocupando largura inteira: o número "26" GIGANTE estilizado, fonte Panini WC 2026 (sans-serif bold, traços largos). O "2" ocupa metade esquerda em VERDE-ESCURO (HEX #1B5E4F, tom CBF escuro). O "6" ocupa metade direita em AMARELO-OURO (HEX #FFD23F, tom CBF amarelo). Os dois números ficam ATRÁS do jogador, semi-cortados pela silhueta dele.
3. Brilho "foil" sutil no fundo (efeito holográfico discreto, como nas figurinhas reais Panini).

JOGADOR (centralizado, da cintura pra cima):
- Foto recortada SEM fundo (apenas a pessoa).
- Vestindo CAMISA AMARELA do Brasil (HEX #FFD400) com:
  • Gola e detalhe nos ombros em VERDE Brasil (HEX #009C3B)
  • Escudo da CBF no peito esquerdo (escudo azul com CBF amarelo + 5 estrelas)
  • No peito central, palavra "BRASIL" em verde escuro pequena
  • Logo da fabricante (Nike) discreto no peito direito
- Pose neutra/séria, olhar adiante, ombros relaxados.
- Pessoa ocupa do alto (logo embaixo do "26") até o início da faixa de nome embaixo.

CANTO SUPERIOR DIREITO:
- Logo FIFA branco oficial — troféu estilizado pequeno + texto "FIFA" embaixo, branco sobre a cor de fundo.

LATERAL DIREITA (descendente, alinhada à direita):
- Bandeira do BRASIL em formato CIRCULAR pequena (verde/amarelo/azul com losango).
- Logo abaixo da bandeira: texto VERTICAL em 3 letras maiúsculas BRANCAS, fonte bold ENORME, dizendo "BRA" — orientado de cima pra baixo (rotacionado 90°), descendo até quase o canto inferior direito.

FAIXA INFERIOR (3 partes empilhadas, ocupando ~22% da altura):
1. Faixa principal turquesa-escuro (HEX #2A8B82, mais escuro que o fundo):
   • Linha 1 (fonte grande, BRANCA, bold maiúsculas, sans-serif): NOME COMPLETO da pessoa
   • Linha 2 (fonte pequena, BEGE/DOURADA HEX #E8D78F): "DD-MM-AAAA | X,XX m | XX kg" (data, altura, peso)
2. Faixa inferior fina turquesa-escuro:
   • Texto pequeno BRANCO/CLARO: "TIME (PAÍS)" — ex: "REAL MADRID CF (ESP)"
3. CANTO INFERIOR DIREITO da faixa inferior: pequeno retângulo VERMELHO com logo "Panini" em AMARELO + escudo decorativo amarelo ao lado.

═══ INSTRUÇÃO CRÍTICA — INTEGRAÇÃO ROSTO/PESCOÇO/CAMISA ═══

A pessoa que enviei na foto tem o ROSTO que eu quero usar. Mas o resultado precisa parecer UM ÚNICO RETRATO PROFISSIONAL — não montagem.

Faça:
- TOM DE PELE perfeitamente uniforme entre rosto, pescoço, orelhas e qualquer parte do braço/mão visível. Se a foto original tem variação de cor (luz amarelada, branco automático ruim), EQUALIZE pra um tom consistente.
- ILUMINAÇÃO única: a luz da camisa e do rosto vem da mesma direção, mesma intensidade. Sombra suave embaixo do queixo conectando ao pescoço e à gola, sem linha de corte visível.
- PESCOÇO ANATÔMICO: gere o pescoço a partir do rosto, com músculo trapézio levando aos ombros. Não deixe o rosto "flutuando" sobre a camisa.
- GOLA da camisa abraça o pescoço naturalmente (não "embaixo" do rosto colado).
- Se a foto enviada tem cabelo cortado ou pescoço ausente, COMPLETE com geração natural.
- Se a foto tem fundo, IGNORE o fundo. Apenas o sujeito.

═══ NÃO FAÇA ═══

- ❌ Outras seleções (não tem opção: SEMPRE Brasil)
- ❌ Outras paletas de cor (sempre turquesa #6FC9C0 + 26 verde+amarelo)
- ❌ Estilizar exageradamente, "cartoon", anime, ilustração — é FOTOGRAFIA real
- ❌ Bordas, frames, marca d'água, texto extra
- ❌ Reinterpretação artística — é cópia 1:1 do layout Panini
- ❌ Mudar pose, ângulo da câmera, expressão — neutra/séria sempre

═══ DADOS PADRÃO QUANDO FALTAR ═══

Se algum dado abaixo não for fornecido, use:
- Nome: "FIGURINHA COMPLETE AÍ"
- Data: "01-01-2000"
- Altura: "1,80"
- Peso: "75"
- Clube: "COMPLETE AÍ FC"
- País clube: "BRA"`

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
