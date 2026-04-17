import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { getCachedStickers } from '@/lib/stickers-cache'
import RankingPageClient from './RankingPageClient'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Ranking',
  description: 'Veja sua posição no ranking nacional e regional de colecionadores.',
}

export const dynamic = 'force-dynamic'

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export default async function RankingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const admin = getAdmin()
  const stickers = await getCachedStickers()

  // Fetch ranking (v2 with premium boost + friends)
  let ranking = null
  try {
    const { data } = await admin.rpc('get_user_ranking_v2', { p_user_id: user.id })
    ranking = data?.[0] || null
  } catch { /* ranking unavailable */ }

  // Fetch friends ranking
  let friendsRanking: any[] = []
  try {
    const { data } = await admin.rpc('get_friends_ranking', { p_user_id: user.id })
    friendsRanking = data || []
  } catch { /* friends unavailable */ }

  // Fetch most wanted stickers (national)
  let nationalStats: any[] = []
  try {
    const { data } = await admin.rpc('get_most_wanted_stickers', { p_section: null, p_limit: 10 })
    nationalStats = data || []
  } catch { /* stats unavailable */ }

  // Fetch most wanted stickers (neighborhood 2.5km)
  let neighborhoodStats: any[] = []
  try {
    const { data } = await admin.rpc('get_most_wanted_nearby', { p_user_id: user.id, p_radius_km: 2.5, p_limit: 10 })
    neighborhoodStats = data || []
  } catch { /* neighborhood stats unavailable */ }

  // Fetch user's own stats
  const { data: userStickers } = await supabase
    .from('user_stickers')
    .select('status, quantity')
    .eq('user_id', user.id)

  let owned = 0, duplicates = 0
  userStickers?.forEach((us) => {
    if (us.status === 'owned') owned++
    if (us.status === 'duplicate') { owned++; duplicates++ }
  })

  const specialSections = ['Introduction', 'Stadiums', 'Legends', 'FIFA World Cup', 'Golden Stickers', 'Memorable Moments']
  const sections = Array.from(new Set(stickers.map((s: { section: string }) => s.section)))
    .filter((s): s is string => !specialSections.includes(s as string))
    .sort()

  return (
    <RankingPageClient
      ranking={ranking}
      friendsRanking={friendsRanking}
      nationalStats={nationalStats}
      neighborhoodStats={neighborhoodStats}
      sections={sections}
      owned={owned}
      duplicates={duplicates}
      total={stickers.length}
      userId={user.id}
    />
  )
}
