/**
 * Active-learning sample storage layer.
 *
 * Three responsibilities:
 *   1. Persist a pending sample (image crop + embedding) when a sticker is
 *      detected during /api/scan, before the user has confirmed.
 *   2. Promote pending → confirmed (or rejected) when the user PATCHes
 *      /api/scan/[id] with their kept/dropped sticker_ids.
 *   3. Run kNN over the confirmed samples to compute a confidence boost
 *      at scan time, gated by anti-poisoning (≥3 distinct validators).
 *
 * All operations use the service role client passed in by the caller —
 * the table is RLS-locked to server-side only.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = any

const STORAGE_BUCKET = 'sticker-samples'
const MIN_VALIDATORS_FOR_BOOST = 3
const COSINE_DISTANCE_BOOST_THRESHOLD = 0.25 // ~0.75 cosine similarity
const BOOST_AMOUNT = 0.1
const DAMP_AMOUNT = 0.15

export type Face = 'front' | 'back'

/** Save a pending sample row + upload the crop to private storage. */
export async function savePendingSample(
  admin: SupabaseAdmin,
  args: {
    scanResultId: number | null
    stickerId: number
    face: Face
    embedding: number[] | null
    imageBuffer: Buffer
    mimeType: string
    userId: string
    geminiConfidence: number
    matchType: string
    isTrusted?: boolean
  },
): Promise<number | null> {
  const ts = Date.now()
  const ext = args.mimeType === 'image/png' ? 'png' : args.mimeType === 'image/webp' ? 'webp' : 'jpg'
  const path = `${args.stickerId}/${args.userId}_${ts}.${ext}`

  // 1. Upload crop (best-effort — never block on storage error)
  const upload = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(path, args.imageBuffer, {
      contentType: args.mimeType,
      upsert: false,
    })

  const imagePath = upload.error ? null : path

  // 2. Insert sample row
  const { data, error } = await admin
    .from('sticker_samples')
    .insert({
      sticker_id: args.stickerId,
      face: args.face,
      embedding: args.embedding,
      image_path: imagePath,
      status: 'pending',
      user_id: args.userId,
      scan_result_id: args.scanResultId,
      gemini_confidence: args.geminiConfidence,
      match_type: args.matchType,
      is_trusted: !!args.isTrusted,
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[sample-store] savePendingSample failed:', error?.message)
    return null
  }
  return data.id as number
}

/** Look up top-K confirmed samples nearest to the embedding, scoped by face. */
export async function findSimilarConfirmed(
  admin: SupabaseAdmin,
  embedding: number[],
  face: Face,
  k: number = 5,
): Promise<Array<{ sticker_id: number; cosine_distance: number; user_id: string | null }>> {
  const { data, error } = await admin.rpc('find_similar_sticker_samples', {
    p_embedding: embedding,
    p_face: face,
    p_limit: k,
  })
  if (error) {
    console.error('[sample-store] findSimilarConfirmed failed:', error.message)
    return []
  }
  return (data || []).map((r: { sticker_id: number; cosine_distance: number; user_id: string | null }) => ({
    sticker_id: r.sticker_id,
    cosine_distance: r.cosine_distance,
    user_id: r.user_id,
  }))
}

/**
 * Decide whether kNN agrees / contradicts Gemini's match, gated by anti-
 * poisoning. Returns a confidence delta in [-DAMP, +BOOST] and a label.
 *
 *   - boost: top-K majority is the same as Gemini's sticker_id, and we have
 *     at least MIN_VALIDATORS_FOR_BOOST distinct users for that sticker_id.
 *   - damp:  top-K majority disagrees with Gemini's sticker_id (regardless
 *     of validator count — a contradiction is a useful signal).
 *   - none:  not enough data, or top distance too large.
 */
export async function computeKnnVerdict(
  admin: SupabaseAdmin,
  embedding: number[],
  face: Face,
  geminiStickerId: number,
): Promise<{ delta: number; label: 'boost' | 'damp' | 'none'; topMatchStickerId: number | null; topDistance: number | null; validators: number }> {
  const neighbors = await findSimilarConfirmed(admin, embedding, face, 5)
  if (neighbors.length === 0) {
    return { delta: 0, label: 'none', topMatchStickerId: null, topDistance: null, validators: 0 }
  }

  // Filter to "close enough" neighbors only
  const close = neighbors.filter((n) => n.cosine_distance <= COSINE_DISTANCE_BOOST_THRESHOLD)
  if (close.length === 0) {
    return { delta: 0, label: 'none', topMatchStickerId: neighbors[0].sticker_id, topDistance: neighbors[0].cosine_distance, validators: 0 }
  }

  // Majority vote among close neighbors
  const counts = new Map<number, number>()
  for (const n of close) counts.set(n.sticker_id, (counts.get(n.sticker_id) ?? 0) + 1)
  let topId = close[0].sticker_id
  let topCount = 0
  counts.forEach((c, id) => { if (c > topCount) { topCount = c; topId = id } })

  const validators = await countValidators(admin, topId, face)

  if (topId === geminiStickerId && validators >= MIN_VALIDATORS_FOR_BOOST) {
    return { delta: BOOST_AMOUNT, label: 'boost', topMatchStickerId: topId, topDistance: close[0].cosine_distance, validators }
  }
  if (topId !== geminiStickerId) {
    return { delta: -DAMP_AMOUNT, label: 'damp', topMatchStickerId: topId, topDistance: close[0].cosine_distance, validators }
  }
  return { delta: 0, label: 'none', topMatchStickerId: topId, topDistance: close[0].cosine_distance, validators }
}

async function countValidators(admin: SupabaseAdmin, stickerId: number, face: Face): Promise<number> {
  const { data, error } = await admin.rpc('count_sample_validators', {
    p_sticker_id: stickerId,
    p_face: face,
  })
  if (error) {
    console.error('[sample-store] countValidators failed:', error.message)
    return 0
  }
  return typeof data === 'number' ? data : 0
}

/**
 * Promote pending samples for a given scan_result_id when the user saves:
 *   - sticker_id in rejectedIds → status='rejected' (explicit unchecks)
 *   - everything else still pending → status='confirmed' (the user kept it)
 *
 * Order matters: we mark rejected first, then sweep the remaining pending
 * rows for this scan into confirmed.
 */
export async function promoteSamples(
  admin: SupabaseAdmin,
  scanResultId: number,
  rejectedIds: number[],
): Promise<void> {
  const now = new Date().toISOString()
  if (rejectedIds.length > 0) {
    await admin
      .from('sticker_samples')
      .update({ status: 'rejected', rejected_at: now })
      .eq('scan_result_id', scanResultId)
      .eq('status', 'pending')
      .in('sticker_id', rejectedIds)
  }
  await admin
    .from('sticker_samples')
    .update({ status: 'confirmed', confirmed_at: now })
    .eq('scan_result_id', scanResultId)
    .eq('status', 'pending')
}
