import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendText, formatPhone } from '@/lib/zapi'

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
  notify_channel?: string       // 'whatsapp' | 'email' | 'both'
  notify_min_threshold?: number // minimum stickers needed to trigger
  notify_priority_stickers?: number[] // sticker IDs that always trigger
  notify_radius_km?: number     // max distance radius
}

/**
 * POST /api/notify-matches
 *
 * Called when a user adds/updates stickers in their collection.
 * Checks if any nearby users need the stickers this user has as duplicates,
 * and sends them a WhatsApp/email notification based on their preferences.
 *
 * Body: { user_id: string, sticker_ids: number[] }
 * sticker_ids = the stickers that were just added/updated
 */
export async function POST(req: NextRequest) {
  try {
    const { user_id, sticker_ids } = await req.json()

    if (!user_id || !sticker_ids || sticker_ids.length === 0) {
      return NextResponse.json({ ok: true, notified: 0 })
    }

    const supabase = getAdmin()

    // 1. Get the user's profile (location + name)
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('display_name, location_lat, location_lng')
      .eq('id', user_id)
      .single()

    if (!userProfile?.location_lat || !userProfile?.location_lng) {
      return NextResponse.json({ ok: true, notified: 0 })
    }

    // 2. Get the sticker details for the ones just updated
    const { data: stickerDetails } = await supabase
      .from('stickers')
      .select('id, number, player_name, country')
      .in('id', sticker_ids)

    if (!stickerDetails || stickerDetails.length === 0) {
      return NextResponse.json({ ok: true, notified: 0 })
    }

    // 3. Check which of these stickers the user has as duplicates (available for trade)
    const { data: userDuplicates } = await supabase
      .from('user_stickers')
      .select('sticker_id')
      .eq('user_id', user_id)
      .eq('status', 'duplicate')
      .in('sticker_id', sticker_ids)

    const duplicateIds = new Set((userDuplicates || []).map((d) => d.sticker_id))

    if (duplicateIds.size === 0) {
      return NextResponse.json({ ok: true, notified: 0 })
    }

    // 4. Find nearby users who need these stickers
    //    Fetch all users with location (phone or email for notifications)
    const { data: nearbyProfiles } = await supabase
      .from('profiles')
      .select('id, phone, email, display_name, location_lat, location_lng, notify_channel, notify_min_threshold, notify_priority_stickers, notify_radius_km, notify_configured, last_match_notified_at')
      .neq('id', user_id)
      .not('location_lat', 'is', null)
      .not('location_lng', 'is', null)

    if (!nearbyProfiles || nearbyProfiles.length === 0) {
      return NextResponse.json({ ok: true, notified: 0 })
    }

    let notified = 0

    for (const nearby of nearbyProfiles) {
      // Read notification preferences (with safe defaults)
      const prefs: NotifyPrefs = {
        notify_channel: nearby.notify_channel || 'whatsapp',
        notify_min_threshold: nearby.notify_min_threshold || 1,
        notify_priority_stickers: nearby.notify_priority_stickers || [],
        notify_radius_km: nearby.notify_radius_km || 50,
      }

      // Check distance against this user's preferred radius
      const dist = haversine(
        userProfile.location_lat, userProfile.location_lng,
        nearby.location_lat, nearby.location_lng
      )
      if (dist > (prefs.notify_radius_km || 50)) continue

      // Rate limit: if user hasn't configured notifications, limit to 1 every 15 days
      if (!nearby.notify_configured && nearby.last_match_notified_at) {
        const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)
        if (new Date(nearby.last_match_notified_at) > fifteenDaysAgo) continue
      }

      // Check which of the duplicate stickers this user is missing
      const { data: theirStickers } = await supabase
        .from('user_stickers')
        .select('sticker_id')
        .eq('user_id', nearby.id)
        .in('sticker_id', Array.from(duplicateIds))
        .in('status', ['owned', 'duplicate'])

      const theirOwnedIds = new Set((theirStickers || []).map((s) => s.sticker_id))

      // Stickers they DON'T have = ones they need
      const theyNeed = Array.from(duplicateIds).filter((id) => !theirOwnedIds.has(id))

      if (theyNeed.length === 0) continue

      // Check threshold: does this meet the user's minimum count?
      const prioritySet = new Set(prefs.notify_priority_stickers || [])
      const hasPriority = theyNeed.some((id) => prioritySet.has(id))
      const minThreshold = prefs.notify_min_threshold || 1

      // If they have priority stickers, always notify. Otherwise check threshold.
      if (!hasPriority && theyNeed.length < minThreshold) continue

      // Dedup: skip if there's already a pending/approved trade request between these users
      // or if any trade request was created in the last 24 hours
      const { data: recentTrade } = await supabase
        .from('trade_requests')
        .select('id')
        .or(`and(requester_id.eq.${user_id},target_id.eq.${nearby.id}),and(requester_id.eq.${nearby.id},target_id.eq.${user_id})`)
        .in('status', ['pending', 'approved'])
        .limit(1)

      if (recentTrade && recentTrade.length > 0) continue

      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { data: recentAnyTrade } = await supabase
        .from('trade_requests')
        .select('id')
        .or(`and(requester_id.eq.${user_id},target_id.eq.${nearby.id}),and(requester_id.eq.${nearby.id},target_id.eq.${user_id})`)
        .gte('created_at', twentyFourHoursAgo)
        .limit(1)

      if (recentAnyTrade && recentAnyTrade.length > 0) continue

      // Get sticker numbers for the message
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

      // Send via email (placeholder — can integrate email service later)
      if (channel === 'email' || channel === 'both') {
        // TODO: integrate email sending (e.g., Resend, SendGrid)
        // For now, log the intent
        if (nearby.email) {
          console.log(`[EMAIL] Would notify ${nearby.email}: ${neededStickers.length} stickers available`)
        }
      }

      // Update last_match_notified_at so rate limiting works
      if (didNotify) {
        await supabase
          .from('profiles')
          .update({ last_match_notified_at: new Date().toISOString() })
          .eq('id', nearby.id)
      }
    }

    return NextResponse.json({ ok: true, notified })
  } catch (err) {
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
