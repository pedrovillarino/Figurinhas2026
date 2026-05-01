import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { checkRateLimit, getIp, notifyLimiter } from '@/lib/ratelimit'
import { createPerfLogger } from '@/lib/perf'
import { backgroundHealthPing } from '@/lib/health-ping'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

type NotifyPrefs = {
  notify_channel?: string
  notify_min_threshold?: number
  notify_priority_stickers?: number[]
  notify_radius_km?: number
}

/**
 * POST /api/notify-matches
 *
 * Called when a user adds/updates stickers in their collection.
 * Instead of sending notifications immediately, ENQUEUES match candidates
 * into the `match_candidates` table. The /api/cron/process-notifications
 * cron drains the queue hourly, applies cooldowns + quiet hours, aggregates
 * per recipient, and sends a single consolidated digest message.
 *
 * Why a queue instead of immediate send (changed 2026-05-01):
 *   1. Avoid spam — same recipient won't get N pings per day if N people
 *      nearby scan dupes
 *   2. Allow ranking by (distance, qty) across multiple scanners
 *   3. Respect quiet hours globally without blocking the scan path
 *
 * Body: { sticker_ids: number[] }
 * Requires authentication.
 */
export async function POST(req: NextRequest) {
  backgroundHealthPing()

  // Rate limit (heavy endpoint)
  const rlResponse = await checkRateLimit(getIp(req), notifyLimiter)
  if (rlResponse) return rlResponse

  const perf = createPerfLogger('notify-matches')

  try {
    // Auth check
    const supabaseUser = await createServerClient()
    const { data: { user } } = await supabaseUser.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const body = await req.json()
    const sticker_ids: number[] = body.sticker_ids || body.sticker_ids || []

    if (!sticker_ids || sticker_ids.length === 0) {
      return NextResponse.json({ ok: true, notified: 0 })
    }

    const supabase = getAdmin()
    const user_id = user.id

    // 1. Get the user's profile (location + name)
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('display_name, location_lat, location_lng')
      .eq('id', user_id)
      .single()

    if (!userProfile?.location_lat || !userProfile?.location_lng) {
      return NextResponse.json({ ok: true, notified: 0 })
    }

    // 2. Get sticker details + check which are duplicates — in parallel
    const [{ data: stickerDetails }, { data: userDuplicates }] = await Promise.all([
      supabase
        .from('stickers')
        .select('id, number, player_name, country')
        .in('id', sticker_ids),
      supabase
        .from('user_stickers')
        .select('sticker_id')
        .eq('user_id', user_id)
        .eq('status', 'duplicate')
        .in('sticker_id', sticker_ids),
    ])

    if (!stickerDetails || stickerDetails.length === 0) {
      return NextResponse.json({ ok: true, notified: 0 })
    }

    const duplicateIds = new Set((userDuplicates || []).map((d) => d.sticker_id))
    if (duplicateIds.size === 0) {
      return NextResponse.json({ ok: true, notified: 0 })
    }

    perf.mark('setup')

    // 3. Find nearby users using PostGIS ST_DWithin (GiST index)
    //    Falls back to bounding box if RPC fails
    const MAX_RADIUS_KM = 100

    type NearbyProfile = { id: string; phone: string | null; email: string | null; display_name: string | null; location_lat: number; location_lng: number; distance_km?: number; notify_channel: string | null; notify_min_threshold: number | null; notify_priority_stickers: number[] | null; notify_radius_km: number | null; notify_configured: boolean | null; last_match_notified_at: string | null }
    let nearbyProfiles: NearbyProfile[] | null = null

    // Try PostGIS RPC first (uses GiST index, accurate distances)
    const { data: postgisResult, error: postgisError } = await supabase
      .rpc('find_nearby_profiles', { p_user_id: user_id, p_radius_km: MAX_RADIUS_KM })

    if (!postgisError && postgisResult) {
      nearbyProfiles = postgisResult as NearbyProfile[]
    } else {
      // Fallback: bounding box filter (works without PostGIS)
      console.warn('PostGIS RPC failed, falling back to bounding box:', postgisError?.message)
      const latDelta = MAX_RADIUS_KM / 111
      const lngDelta = MAX_RADIUS_KM / (111 * Math.cos(userProfile.location_lat * Math.PI / 180))

      const { data: nearbyProfilesFallback } = await supabase
        .from('profiles')
        .select('id, phone, email, display_name, location_lat, location_lng, notify_channel, notify_min_threshold, notify_priority_stickers, notify_radius_km, notify_configured, last_match_notified_at')
        .neq('id', user_id)
        .gte('location_lat', userProfile.location_lat - latDelta)
        .lte('location_lat', userProfile.location_lat + latDelta)
        .gte('location_lng', userProfile.location_lng - lngDelta)
        .lte('location_lng', userProfile.location_lng + lngDelta)
        .limit(200)

      nearbyProfiles = nearbyProfilesFallback as NearbyProfile[] | null
    }

    if (!nearbyProfiles || nearbyProfiles.length === 0) {
      return NextResponse.json({ ok: true, notified: 0 })
    }

    // 4. Batch: get ALL user_stickers for nearby users for the duplicate sticker IDs.
    //    Trade-dedup is done LATER (in the cron) to avoid re-sending if a trade
    //    is created between enqueue and processing. We only need ownership here.
    const nearbyIds = nearbyProfiles.map((p) => p.id)
    const dupIdsArr = Array.from(duplicateIds)

    const { data: allNearbyStickers } = await supabase
      .from('user_stickers')
      .select('user_id, sticker_id')
      .in('user_id', nearbyIds)
      .in('sticker_id', dupIdsArr)
      .in('status', ['owned', 'duplicate'])

    const ownedByUser = new Map<string, Set<number>>()
    for (const us of allNearbyStickers || []) {
      if (!ownedByUser.has(us.user_id)) ownedByUser.set(us.user_id, new Set())
      ownedByUser.get(us.user_id)!.add(us.sticker_id)
    }

    perf.mark('batch-queries')

    // 5. Build candidate rows for the queue. The cron applies cooldown,
    //    quiet hours, threshold and trade-dedup at send time — we just enqueue.
    type CandidateRow = {
      recipient_id: string
      scanner_id: string
      sticker_id: number
      distance_km: number
      is_priority: boolean
    }
    const candidates: CandidateRow[] = []

    for (const nearby of nearbyProfiles) {
      const prefs: NotifyPrefs = {
        notify_channel: nearby.notify_channel || 'whatsapp',
        notify_priority_stickers: nearby.notify_priority_stickers || [],
        notify_radius_km: nearby.notify_radius_km || 50,
      }

      // Skip users who explicitly opted out
      if (prefs.notify_channel === 'none') continue

      const dist = nearby.distance_km ?? haversine(
        userProfile.location_lat, userProfile.location_lng,
        nearby.location_lat, nearby.location_lng
      )
      if (dist > (prefs.notify_radius_km || 50)) continue

      const theirOwnedIds = ownedByUser.get(nearby.id) || new Set()
      const theyNeed = dupIdsArr.filter((id) => !theirOwnedIds.has(id))
      if (theyNeed.length === 0) continue

      const prioritySet = new Set(prefs.notify_priority_stickers || [])

      for (const stickerId of theyNeed) {
        candidates.push({
          recipient_id: nearby.id,
          scanner_id: user_id,
          sticker_id: stickerId,
          distance_km: Math.round(dist * 100) / 100,
          is_priority: prioritySet.has(stickerId),
        })
      }
    }

    // 6. Bulk-insert with ON CONFLICT DO NOTHING (UNIQUE constraint dedups
    //    same scanner+recipient+sticker pairs across multiple scans).
    let enqueued = 0
    if (candidates.length > 0) {
      const { error: insertError, count } = await supabase
        .from('match_candidates')
        .upsert(candidates, {
          onConflict: 'recipient_id,scanner_id,sticker_id',
          ignoreDuplicates: true,
          count: 'exact',
        })
      if (insertError) {
        console.error('match_candidates insert error:', insertError)
      } else {
        enqueued = count ?? candidates.length
      }
    }

    perf.mark('enqueue')
    perf.end({ enqueued, candidates: candidates.length, nearby: nearbyProfiles.length })

    return NextResponse.json({ ok: true, enqueued })
  } catch (err) {
    perf.end({ error: 'true' })
    console.error('Notify matches error:', err)
    return NextResponse.json({ ok: true, notified: 0 })
  }
}

// Haversine formula to calculate distance between two coordinates
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371 // Earth radius in km
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180)
}
