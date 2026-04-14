import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { sendText, formatPhone } from '@/lib/zapi'
import { checkRateLimit, getIp, notifyLimiter } from '@/lib/ratelimit'
import { createPerfLogger } from '@/lib/perf'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br'

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
 * Checks if any nearby users need the stickers this user has as duplicates,
 * and sends them a WhatsApp/email notification based on their preferences.
 *
 * Body: { sticker_ids: number[] }
 * Requires authentication.
 */
export async function POST(req: NextRequest) {
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

    // 4. Batch: get ALL user_stickers for nearby users for the duplicate sticker IDs
    //    Single query instead of N queries in a loop
    const nearbyIds = nearbyProfiles.map((p) => p.id)
    const dupIdsArr = Array.from(duplicateIds)

    const [{ data: allNearbyStickers }, { data: allRecentTrades }] = await Promise.all([
      // One query: all nearby users' ownership of these specific stickers
      supabase
        .from('user_stickers')
        .select('user_id, sticker_id')
        .in('user_id', nearbyIds)
        .in('sticker_id', dupIdsArr)
        .in('status', ['owned', 'duplicate']),
      // One query: all trade requests between current user and nearby users
      supabase
        .from('trade_requests')
        .select('id, requester_id, target_id, status, created_at')
        .or(
          nearbyIds.map((nid) =>
            `and(requester_id.eq.${user_id},target_id.eq.${nid}),and(requester_id.eq.${nid},target_id.eq.${user_id})`
          ).join(',')
        ),
    ])

    // Build lookup maps from batch results
    const ownedByUser = new Map<string, Set<number>>()
    for (const us of allNearbyStickers || []) {
      if (!ownedByUser.has(us.user_id)) ownedByUser.set(us.user_id, new Set())
      ownedByUser.get(us.user_id)!.add(us.sticker_id)
    }

    // Build trade dedup map: user_id -> { hasPending, hasRecent24h }
    const tradeStatus = new Map<string, { hasPending: boolean; hasRecent24h: boolean }>()
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    for (const tr of allRecentTrades || []) {
      const otherId = tr.requester_id === user_id ? tr.target_id : tr.requester_id
      if (!tradeStatus.has(otherId)) tradeStatus.set(otherId, { hasPending: false, hasRecent24h: false })
      const status = tradeStatus.get(otherId)!
      if (tr.status === 'pending' || tr.status === 'approved') status.hasPending = true
      if (new Date(tr.created_at) > twentyFourHoursAgo) status.hasRecent24h = true
    }

    perf.mark('batch-queries')

    // 5. Process each nearby user (no more DB queries in this loop!)
    let notified = 0
    const notifiedUserIds: string[] = []

    for (const nearby of nearbyProfiles) {
      const prefs: NotifyPrefs = {
        notify_channel: nearby.notify_channel || 'whatsapp',
        notify_min_threshold: nearby.notify_min_threshold || 1,
        notify_priority_stickers: nearby.notify_priority_stickers || [],
        notify_radius_km: nearby.notify_radius_km || 50,
      }

      // Distance check: use PostGIS distance if available, else haversine fallback
      const dist = nearby.distance_km ?? haversine(
        userProfile.location_lat, userProfile.location_lng,
        nearby.location_lat, nearby.location_lng
      )
      if (dist > (prefs.notify_radius_km || 50)) continue

      // Rate limit: if user hasn't configured notifications, limit to 1 every 15 days
      if (!nearby.notify_configured && nearby.last_match_notified_at) {
        const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)
        if (new Date(nearby.last_match_notified_at) > fifteenDaysAgo) continue
      }

      // Check which stickers they need (from pre-fetched batch data)
      const theirOwnedIds = ownedByUser.get(nearby.id) || new Set()
      const theyNeed = dupIdsArr.filter((id) => !theirOwnedIds.has(id))

      if (theyNeed.length === 0) continue

      // Check threshold
      const prioritySet = new Set(prefs.notify_priority_stickers || [])
      const hasPriority = theyNeed.some((id) => prioritySet.has(id))
      const minThreshold = prefs.notify_min_threshold || 1
      if (!hasPriority && theyNeed.length < minThreshold) continue

      // Dedup: skip if there's already a pending/recent trade (from pre-fetched batch data)
      const ts = tradeStatus.get(nearby.id)
      if (ts?.hasPending || ts?.hasRecent24h) continue

      // Build notification message
      const neededStickers = stickerDetails
        .filter((s) => theyNeed.includes(s.id))
        .map((s) => ({ number: s.number, isPriority: prioritySet.has(s.id) }))

      if (neededStickers.length === 0) continue

      const distStr = dist < 1 ? 'menos de 1km' : `${Math.round(dist)}km`
      const firstName = userProfile.display_name?.split(' ')[0] || 'Alguém'
      const stickerList = neededStickers.slice(0, 10).map((s) => s.isPriority ? `⭐${s.number}` : s.number).join(', ')
      const extra = neededStickers.length > 10 ? ` e mais ${neededStickers.length - 10}` : ''
      const priorityNote = hasPriority ? '\n⭐ Inclui figurinhas prioritárias!\n' : ''

      const msg = `🔔 *Alerta de figurinhas!*\n\n` +
        `${firstName} (a ${distStr} de voce) tem ${neededStickers.length} figurinha${neededStickers.length > 1 ? 's' : ''} que voce precisa:\n\n` +
        `📋 ${stickerList}${extra}\n${priorityNote}\n` +
        `Abra o app para solicitar a troca (com aprovação segura):\n${APP_URL}/trades`

      const channel = prefs.notify_channel || 'whatsapp'

      // Send via WhatsApp
      let didNotify = false
      if (channel === 'whatsapp' || channel === 'both') {
        const phone = nearby.phone ? formatPhone(nearby.phone) : null
        if (phone) {
          await sendText(phone, msg)
          notified++
          didNotify = true
        }
      }

      // Send via email (placeholder)
      if (channel === 'email' || channel === 'both') {
        if (nearby.email) {
          console.log(`[EMAIL] Would notify ${nearby.email}: ${neededStickers.length} stickers available`)
        }
      }

      if (didNotify) {
        notifiedUserIds.push(nearby.id)
      }
    }

    // 6. Batch update last_match_notified_at for all notified users (single query)
    if (notifiedUserIds.length > 0) {
      await supabase
        .from('profiles')
        .update({ last_match_notified_at: new Date().toISOString() })
        .in('id', notifiedUserIds)
    }

    perf.mark('notify')
    perf.end({ notified, nearby: nearbyProfiles.length })

    return NextResponse.json({ ok: true, notified })
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
