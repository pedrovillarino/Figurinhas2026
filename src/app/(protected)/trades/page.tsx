import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import TradesHub from './TradesHub'
import { type Tier } from '@/lib/tiers'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Trocas',
  description: 'Encontre colecionadores perto de você e troque figurinhas repetidas da Copa 2026.',
}

export const dynamic = 'force-dynamic'

export default async function TradesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const [{ data: profile }, { data: stickers }, { data: userStickers }] = await Promise.all([
    supabase.from('profiles').select('tier, location_lat, location_lng, display_name').eq('id', user.id).single(),
    supabase.from('stickers').select('id, number, player_name, country, section, type').order('number'),
    supabase.from('user_stickers').select('sticker_id, status, quantity').eq('user_id', user.id),
  ])

  const tier = (profile?.tier || 'free') as Tier
  const hasLocation = !!(profile?.location_lat && profile?.location_lng)

  // Build user stickers map
  const userStickersMap: Record<number, { status: string; quantity: number }> = {}
  userStickers?.forEach((us) => {
    userStickersMap[us.sticker_id] = { status: us.status, quantity: us.quantity }
  })

  // Run all trade-related queries in parallel
  type NearbyMatch = {
    user_id: string
    display_name: string | null
    distance_km: number
    they_have: number
    i_have: number
    match_score: number
  }
  type PendingRequest = {
    id: string
    requester_id: string
    requester_name: string | null
    requester_avatar: string | null
    they_have: number
    i_have: number
    match_score: number
    distance_km: number | null
    message: string | null
    created_at: string
  }

  const safe = <T,>(p: PromiseLike<{ data: T }>) =>
    Promise.resolve(p).catch(() => ({ data: null as T }))

  const [matchesResult, pendingResult, sentResult, approvedResult] = await Promise.all([
    // Nearby matches (only if has location)
    hasLocation
      ? safe(supabase.rpc('get_trade_matches', { p_user_id: user.id, p_radius_km: 50 }))
      : Promise.resolve({ data: null }),
    // Pending trade requests
    safe(supabase.rpc('get_pending_trade_requests', { p_user_id: user.id })),
    // Sent requests (still pending)
    safe(supabase.from('trade_requests').select('target_id').eq('requester_id', user.id).eq('status', 'pending')),
    // Recently approved trades
    safe(supabase.from('trade_requests').select('id, requester_id, responded_at').eq('target_id', user.id).eq('status', 'approved').order('responded_at', { ascending: false }).limit(5)),
  ])

  const nearbyMatches = ((matchesResult.data || []) as NearbyMatch[]).slice(0, 5)
  const nearbyCount = (matchesResult.data || []).length
  const pendingRequests = (pendingResult.data || []) as PendingRequest[]
  const sentRequestUserIds = (sentResult.data || []).map((r: { target_id: string }) => r.target_id)

  // Build approved trades with requester profiles
  let approvedTrades: Array<{ requestId: string; requesterName: string; contact: string | null }> = []
  const approved = approvedResult.data as Array<{ id: string; requester_id: string; responded_at: string }> | null
  if (approved && approved.length > 0) {
    const requesterIds = approved.map(a => a.requester_id)
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, phone, email')
      .in('id', requesterIds)

    const profileMap = new Map(profiles?.map(p => [p.id, p]) || [])

    approvedTrades = approved.map(a => {
      const p = profileMap.get(a.requester_id)
      const phone = p?.phone?.replace(/\D/g, '')
      return {
        requestId: a.id,
        requesterName: p?.display_name || 'Usuário',
        contact: phone ? `wa.me/${phone}` : p?.email || null,
      }
    })
  }

  return (
    <TradesHub
      userId={user.id}
      tier={tier}
      stickers={stickers || []}
      userStickersMap={userStickersMap}
      hasLocation={hasLocation}
      nearbyCount={nearbyCount}
      nearbyMatches={nearbyMatches}
      pendingRequests={pendingRequests}
      sentRequestUserIds={sentRequestUserIds}
      approvedTrades={approvedTrades}
    />
  )
}
