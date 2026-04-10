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

  // Try to get nearby match count if user has location
  let nearbyCount = 0
  let nearbyMatches: Array<{
    user_id: string
    display_name: string | null
    distance_km: number
    they_have: number
    i_have: number
    match_score: number
  }> = []

  if (hasLocation) {
    try {
      const { data } = await supabase.rpc('get_trade_matches', {
        p_user_id: user.id,
        p_radius_km: 50,
      })
      if (data) {
        nearbyCount = data.length
        nearbyMatches = (data as typeof nearbyMatches).slice(0, 5)
      }
    } catch {
      // RPC might not exist yet, that's ok
    }
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
    />
  )
}
