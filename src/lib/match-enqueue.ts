/**
 * Pedro 2026-05-04: lógica de enfileiramento de match_candidates extraída
 * em lib pra ser usada tanto pelo client (/api/notify-matches) quanto pelo
 * server (webhook WhatsApp). Antes só o client web/app populava a queue —
 * registro via WhatsApp ficava órfão.
 *
 * ESTRATÉGIA:
 * - Não dispara push imediato. Só enfileira em match_candidates.
 * - O cron /api/cron/process-notifications (hourly) drena a queue, agrega
 *   por recipient e envia 1 mensagem consolidada. Isso evita flood quando
 *   user registra muitas figurinhas em sequência (Pedro pediu cooldown
 *   natural via cron de ~30min/1h).
 *
 * VERSÃO ANTERIOR tinha um push imediato pra copa_completa próximos. Foi
 * removido — agora copa_completa também usa o cron, só com freq mais alta
 * via match_alerts_freq=high.
 */
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/**
 * Enfileira match_candidates pra cada user nearby que pode receber alerta
 * sobre as figurinhas que o scanner acabou de registrar.
 *
 * Bilateralidade NÃO é checada aqui (rápido) — o cron faz a checagem
 * completa antes de enviar. Aqui só faz o filtro mínimo:
 *   - Scanner tem essas figurinhas como duplicate (caso contrário nada a oferecer)
 *   - Recipients estão dentro do raio (notify_radius_km)
 *   - Recipients NÃO têm essas figurinhas (precisa)
 *
 * @returns número de candidates enfileirados
 */
export async function enqueueMatchCandidates(
  scannerId: string,
  stickerIds: number[],
): Promise<number> {
  if (stickerIds.length === 0) return 0
  const supabase = getAdmin()

  // 1. Scanner precisa ter location + as figurinhas como duplicate
  const { data: scannerProfile } = await supabase
    .from('profiles')
    .select('location_lat, location_lng')
    .eq('id', scannerId)
    .maybeSingle()

  if (!scannerProfile?.location_lat || !scannerProfile?.location_lng) return 0

  const { data: scannerDupes } = await supabase
    .from('user_stickers')
    .select('sticker_id')
    .eq('user_id', scannerId)
    .eq('status', 'duplicate')
    .in('sticker_id', stickerIds)

  const duplicateIds = new Set((scannerDupes || []).map((d: { sticker_id: number }) => d.sticker_id))
  if (duplicateIds.size === 0) return 0

  // 2. Encontra recipients dentro de raio amplo (cron filtra por radius do user)
  const MAX_RADIUS_KM = 100
  type NearbyProfile = {
    id: string
    location_lat: number
    location_lng: number
    distance_km?: number
    notify_channel: string | null
    notify_priority_stickers: number[] | null
    notify_radius_km: number | null
  }
  let nearbyProfiles: NearbyProfile[] = []

  const { data: postgisResult, error: postgisError } = await supabase
    .rpc('find_nearby_profiles', { p_user_id: scannerId, p_radius_km: MAX_RADIUS_KM })

  if (!postgisError && postgisResult) {
    nearbyProfiles = postgisResult as NearbyProfile[]
  } else {
    // Fallback bounding-box
    const latDelta = MAX_RADIUS_KM / 111
    const lngDelta = MAX_RADIUS_KM / (111 * Math.cos((scannerProfile.location_lat * Math.PI) / 180))
    const { data: bbox } = await supabase
      .from('profiles')
      .select('id, location_lat, location_lng, notify_channel, notify_priority_stickers, notify_radius_km')
      .neq('id', scannerId)
      .gte('location_lat', scannerProfile.location_lat - latDelta)
      .lte('location_lat', scannerProfile.location_lat + latDelta)
      .gte('location_lng', scannerProfile.location_lng - lngDelta)
      .lte('location_lng', scannerProfile.location_lng + lngDelta)
      .limit(200)
    nearbyProfiles = (bbox || []) as NearbyProfile[]
  }

  if (nearbyProfiles.length === 0) return 0

  // 3. Filtra recipients que JÁ têm essas figurinhas (precisam = NÃO têm)
  const dupIdsArr = Array.from(duplicateIds)
  const nearbyIds = nearbyProfiles.map((p) => p.id)
  const { data: nearbyOwned } = await supabase
    .from('user_stickers')
    .select('user_id, sticker_id')
    .in('user_id', nearbyIds)
    .in('sticker_id', dupIdsArr)
    .in('status', ['owned', 'duplicate'])

  const ownedByUser = new Map<string, Set<number>>()
  for (const us of (nearbyOwned || []) as Array<{ user_id: string; sticker_id: number }>) {
    if (!ownedByUser.has(us.user_id)) ownedByUser.set(us.user_id, new Set())
    ownedByUser.get(us.user_id)!.add(us.sticker_id)
  }

  // 4. Build candidate rows
  type CandidateRow = {
    recipient_id: string
    scanner_id: string
    sticker_id: number
    distance_km: number
    is_priority: boolean
  }
  const candidates: CandidateRow[] = []
  for (const nearby of nearbyProfiles) {
    if (nearby.notify_channel === 'none') continue
    const userRadiusKm = nearby.notify_radius_km || 50
    const dist = nearby.distance_km ?? haversine(
      scannerProfile.location_lat, scannerProfile.location_lng,
      nearby.location_lat, nearby.location_lng,
    )
    if (dist > userRadiusKm) continue

    const theirOwnedIds = ownedByUser.get(nearby.id) || new Set()
    const theyNeed = dupIdsArr.filter((id) => !theirOwnedIds.has(id))
    if (theyNeed.length === 0) continue

    const prioritySet = new Set(nearby.notify_priority_stickers || [])
    for (const stickerId of theyNeed) {
      candidates.push({
        recipient_id: nearby.id,
        scanner_id: scannerId,
        sticker_id: stickerId,
        distance_km: Math.round(dist * 100) / 100,
        is_priority: prioritySet.has(stickerId),
      })
    }
  }

  if (candidates.length === 0) return 0

  // 5. Bulk insert (ignore duplicates)
  const { error, count } = await supabase
    .from('match_candidates')
    .upsert(candidates, {
      onConflict: 'recipient_id,scanner_id,sticker_id',
      ignoreDuplicates: true,
      count: 'exact',
    })
  if (error) {
    console.error('[match-enqueue] insert error:', error)
    return 0
  }
  return count ?? candidates.length
}
