/**
 * Pedro 2026-05-04: wrapper minimalista da API Replicate pra rodar modelos
 * de identity-preserving generation (InstantID, PhotoMaker, etc).
 *
 * Por que Replicate vs Gemini Imagen / OpenAI:
 *   • Modelos OPEN-SOURCE dedicados a preservar identidade facial
 *     (InstantID, PhotoMaker) entregam resultado MUITO mais fiel à pessoa
 *     da foto do que prompt-only image generators.
 *   • API simples (REST + polling), latência ~10-20s.
 *
 * Uso típico (sticker-generator):
 *   const result = await runInstantID({
 *     faceImageBase64: photo,
 *     faceMimeType: 'image/jpeg',
 *     prompt: '...professional headshot Brazil jersey...',
 *     ipAdapterScale: 0.8,
 *   })
 */
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN
const REPLICATE_BASE = 'https://api.replicate.com/v1'

// Pinned version of zsxkib/instant-id (mais estável; identity-preserving SDXL).
// Fonte: https://replicate.com/zsxkib/instant-id/versions
// Pedro 2026-05-04: se mudarmos pra outro modelo (ex: photomaker), trocar aqui.
const INSTANT_ID_VERSION =
  '491ddf5be6b827f8931f088ef10c6f0e7bc9f0e1bce87c19a1e55d9b0f65cb3a'

type ReplicatePrediction = {
  id: string
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'
  output: string | string[] | null
  error: string | null
  urls: { get: string; cancel: string }
}

type RunInstantIDInput = {
  faceImageBase64: string
  faceMimeType: string
  prompt: string
  negativePrompt?: string
  ipAdapterScale?: number  // 0..1, default 0.8 — quanto preserva identidade
  guidanceScale?: number   // padrão 5
  numInferenceSteps?: number // padrão 30
  width?: number
  height?: number
}

type RunInstantIDResult =
  | { ok: true; pngBase64: string; predictionId: string; estimatedCostUsd: number }
  | { ok: false; error: string; predictionId?: string }

/**
 * Executa o modelo InstantID via Replicate. Bloqueia até finalizar
 * (polling a cada 1.5s, timeout 50s pra ficar dentro do maxDuration=60
 * dos endpoints serverless da Vercel).
 *
 * Retorna PNG base64 do retrato gerado.
 */
export async function runInstantID(input: RunInstantIDInput): Promise<RunInstantIDResult> {
  if (!REPLICATE_API_TOKEN) {
    return { ok: false, error: 'REPLICATE_API_TOKEN não configurada' }
  }

  // Replicate aceita data URI direto pro input image
  const dataUri = `data:${input.faceMimeType};base64,${input.faceImageBase64}`

  try {
    const createRes = await fetch(`${REPLICATE_BASE}/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
        Prefer: 'wait=10', // tenta esperar 10s no create antes de cair em polling
      },
      body: JSON.stringify({
        version: INSTANT_ID_VERSION,
        input: {
          image: dataUri,
          prompt: input.prompt,
          negative_prompt:
            input.negativePrompt ||
            'blurry, cartoon, anime, illustration, painting, low quality, deformed, multiple people, watermark, text, logo, frame, border, sunglasses, hat, fake',
          ip_adapter_scale: input.ipAdapterScale ?? 0.8,
          controlnet_conditioning_scale: 0.8,
          guidance_scale: input.guidanceScale ?? 5,
          num_inference_steps: input.numInferenceSteps ?? 30,
          width: input.width ?? 768,
          height: input.height ?? 1024,
          // safety_checker desabilitado nem é exposto — Replicate aplica
        },
      }),
    })

    if (!createRes.ok) {
      const errBody = await createRes.text()
      console.error('[replicate] create error:', createRes.status, errBody.slice(0, 400))
      return { ok: false, error: `Replicate ${createRes.status}: ${errBody.slice(0, 200)}` }
    }

    let prediction = (await createRes.json()) as ReplicatePrediction
    const predictionId = prediction.id

    // Se já chegou pronto via Prefer:wait=10, salta polling
    const startTime = Date.now()
    const TIMEOUT_MS = 50_000
    while (
      (prediction.status === 'starting' || prediction.status === 'processing') &&
      Date.now() - startTime < TIMEOUT_MS
    ) {
      await new Promise((r) => setTimeout(r, 1500))
      const pollRes = await fetch(prediction.urls.get, {
        headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
      })
      if (!pollRes.ok) {
        const errBody = await pollRes.text()
        console.error('[replicate] poll error:', pollRes.status, errBody.slice(0, 400))
        return { ok: false, error: `Replicate poll ${pollRes.status}`, predictionId }
      }
      prediction = (await pollRes.json()) as ReplicatePrediction
    }

    if (prediction.status !== 'succeeded') {
      console.error('[replicate] not succeeded:', prediction.status, prediction.error?.slice?.(0, 400))
      return {
        ok: false,
        error: `Replicate ${prediction.status}: ${prediction.error || 'timeout'}`,
        predictionId,
      }
    }

    // output pode ser string (URL) ou array — InstantID retorna array de 1
    const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output
    if (!outputUrl) {
      return { ok: false, error: 'Replicate retornou sem output URL', predictionId }
    }

    // Baixa o PNG da URL pública
    const imgRes = await fetch(outputUrl)
    if (!imgRes.ok) {
      return { ok: false, error: `Falha baixando output: HTTP ${imgRes.status}`, predictionId }
    }
    const buf = Buffer.from(await imgRes.arrayBuffer())

    return {
      ok: true,
      pngBase64: buf.toString('base64'),
      predictionId,
      // InstantID custa ~$0.05 por run (gpu-a40-large rodando ~10s)
      estimatedCostUsd: 0.05,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[replicate] exception:', msg)
    return { ok: false, error: msg }
  }
}
