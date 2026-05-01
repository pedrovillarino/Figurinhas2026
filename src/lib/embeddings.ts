/**
 * Image embedding via Cohere multimodal embed.
 *
 * Returns a 1024-dim float vector that we store in `sticker_samples.embedding`
 * and search via pgvector cosine distance. Falls back to null on any error so
 * the scan flow never blocks on the embedding pipeline.
 *
 * Model: embed-multilingual-v3.0 — 1024 dims, supports input_type='image'.
 * Cost: ~$0.0001 per image (Cohere pricing as of 2026).
 *
 * Set COHERE_API_KEY in env. Without it, this module returns null silently.
 */
import { CohereClient } from 'cohere-ai'

const COHERE_MODEL = 'embed-multilingual-v3.0'
const EMBED_DIM = 1024

let _client: CohereClient | null = null
function getClient(): CohereClient | null {
  const key = process.env.COHERE_API_KEY
  if (!key) return null
  if (!_client) _client = new CohereClient({ token: key })
  return _client
}

/**
 * Embed a JPEG/PNG/WebP buffer into a 1024-dim float vector.
 * Returns null if the API key is missing, the call fails, or the response
 * shape is unexpected — callers must handle the null path.
 */
export async function embedImage(
  buf: Buffer,
  mimeType: string = 'image/jpeg',
): Promise<number[] | null> {
  const client = getClient()
  if (!client) return null

  const base64 = buf.toString('base64')
  const dataUri = `data:${mimeType};base64,${base64}`

  // 3s ceiling — never let an unhealthy Cohere call drag down the scan.
  const TIMEOUT_MS = 3000
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS))

  try {
    const call = client.embed({
      model: COHERE_MODEL,
      inputType: 'image',
      embeddingTypes: ['float'],
      images: [dataUri],
    }).then((res) => res, () => null)

    const res = await Promise.race([call, timeout])
    if (!res) {
      console.error('[embeddings] timeout or error after 3s')
      return null
    }
    const floats = (res.embeddings as { float?: number[][] }).float
    const vec = floats?.[0]
    if (!vec || vec.length !== EMBED_DIM) {
      console.error(`[embeddings] unexpected dim: ${vec?.length}`)
      return null
    }
    return vec
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[embeddings] embed failed:', msg.substring(0, 200))
    return null
  }
}

export const EMBEDDING_DIM = EMBED_DIM
