/**
 * Pedro 2026-05-10 (Opção 2 — fila persistente de imagens):
 *
 * Quando user manda múltiplas fotos numa rajada, em vez de descartar
 * com mensagem (Opt 1), enfileira as fotos extras e processa
 * automaticamente após cada confirmação (SIM/NÃO/cancela).
 *
 * Storage: prioriza imageUrl Z-API (~200 bytes, dura horas) sobre
 * base64 inline (~2MB). TTL 1h + cleanup function.
 *
 * Sem perda silenciosa (Opt 1 já cobria) e sem perda explícita
 * (foto descartada). User vê: "Recebi 3 fotos! Processando uma por
 * vez. Posição na fila: 1 de 3."
 */
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export type EnqueuedImage = {
  id: number
  user_id: string
  phone: string
  image_url: string | null
  image_base64: string | null
  mime_type: string | null
  caption: string | null
  is_query_mode: boolean
  msg_id: string | null
  created_at: string
  expires_at: string
}

export type EnqueueParams = {
  userId: string
  phone: string
  imageUrl?: string | null
  imageBase64?: string | null
  mimeType?: string | null
  caption?: string | null
  isQueryMode?: boolean
  msgId?: string | null
}

/**
 * Enfileira uma imagem pra processamento posterior. Retorna a posição
 * na fila (1-based) e o id do registro.
 */
export async function enqueueImage(params: EnqueueParams): Promise<{
  id: number
  position: number
  totalQueued: number
} | null> {
  const sb = getAdmin()
  // Pelo menos uma das duas precisa estar presente
  if (!params.imageUrl && !params.imageBase64) {
    console.error('[image-queue] enqueue called without imageUrl or imageBase64')
    return null
  }
  const { data, error } = await sb
    .from('image_queue')
    .insert({
      user_id: params.userId,
      phone: params.phone,
      image_url: params.imageUrl || null,
      image_base64: params.imageBase64 || null,
      mime_type: params.mimeType || 'image/jpeg',
      caption: params.caption || null,
      is_query_mode: params.isQueryMode || false,
      msg_id: params.msgId || null,
    })
    .select('id')
    .single()
  if (error || !data) {
    console.error('[image-queue] enqueue failed:', error?.message)
    return null
  }
  // Conta total de pendentes pra posicionar na fila
  const { count } = await sb
    .from('image_queue')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', params.userId)
    .is('processed_at', null)
    .gt('expires_at', new Date().toISOString())

  const totalQueued = count || 1
  return { id: data.id as number, position: totalQueued, totalQueued }
}

/**
 * Pega a próxima imagem da fila pra esse user (FIFO), marcando como
 * processada atomicamente. Retorna null se não há.
 *
 * Uso atômico via UPDATE com ID escolhido por subselect — evita race
 * se duas confirmações disparam dispatcher ao mesmo tempo.
 */
export async function dequeueNextImage(
  userId: string,
): Promise<EnqueuedImage | null> {
  const sb = getAdmin()
  // Postgres não suporta UPDATE LIMIT direto via Supabase JS, então
  // fazemos: SELECT pra pegar id → UPDATE WHERE id e processed_at IS NULL
  const { data: candidate } = await sb
    .from('image_queue')
    .select('*')
    .eq('user_id', userId)
    .is('processed_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!candidate) return null

  const { data: claimed, error: updateErr } = await sb
    .from('image_queue')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', candidate.id)
    .is('processed_at', null) // CAS — só claima se ainda não foi
    .select('*')
    .maybeSingle()

  if (updateErr) {
    console.error('[image-queue] dequeue update failed:', updateErr.message)
    return null
  }
  // Se outro processo já claimou, claimed será null
  return claimed as EnqueuedImage | null
}

/**
 * Quantas imagens ainda esperam pra esse user. Usado pra mostrar
 * "Posição na fila: X de Y" e pro dispatcher decidir se processa
 * próxima.
 */
export async function getQueueLength(userId: string): Promise<number> {
  const sb = getAdmin()
  const { count } = await sb
    .from('image_queue')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('processed_at', null)
    .gt('expires_at', new Date().toISOString())
  return count || 0
}

/**
 * Limpa a fila inteira pra um user. Usado quando user manda comando
 * "cancelar" ou similar — descarta tudo que estava esperando.
 */
export async function clearQueue(userId: string): Promise<number> {
  const sb = getAdmin()
  const { data } = await sb
    .from('image_queue')
    .update({ processed_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('processed_at', null)
    .select('id')
  return data?.length || 0
}
