import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { getCachedStickers } from '@/lib/stickers-cache'
import DashboardClient from './DashboardClient'
import RankingCard from '@/components/RankingCard'
import StickerStats from '@/components/StickerStats'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Painel com resumo do progresso do seu álbum de figurinhas.',
}

export const dynamic = 'force-dynamic'

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const admin = getAdmin()

  const [stickers, { data: userStickers }] = await Promise.all([
    getCachedStickers(),
    supabase.from('user_stickers').select('sticker_id, status, quantity, updated_at').eq('user_id', user.id),
  ])

  // Fetch ranking and stats separately (PromiseLike doesn't support .catch)
  let rankingResult = null
  let nationalStatsResult: any[] = []
  let neighborhoodStatsResult: any[] = []

  try {
    const { data } = await admin.rpc('get_user_ranking', { p_user_id: user.id })
    rankingResult = data?.[0] || null
  } catch { /* ranking unavailable */ }

  try {
    const { data } = await admin.rpc('get_most_wanted_stickers', { p_section: null, p_limit: 10 })
    nationalStatsResult = data || []
  } catch { /* stats unavailable */ }

  try {
    const { data } = await admin.rpc('get_most_wanted_nearby', { p_user_id: user.id, p_radius_km: 2.5, p_limit: 10 })
    neighborhoodStatsResult = data || []
  } catch { /* neighborhood stats unavailable */ }

  type UserSticker = { sticker_id: number; status: string; quantity: number; updated_at: string | null }
  const userStickersMap: Record<number, { status: string; quantity: number; updated_at: string | null }> = {}
  ;(userStickers as UserSticker[] | null)?.forEach((us) => {
    userStickersMap[us.sticker_id] = {
      status: us.status,
      quantity: us.quantity,
      updated_at: us.updated_at || null,
    }
  })

  // Get unique sections (team names) for the team filter dropdown
  const specialSections = ['Introduction', 'FIFA World Cup', 'Golden Stickers', 'Legends', 'Memorable Moments', 'Stadiums']
  const sections = Array.from(new Set(stickers.map((s: { section: string }) => s.section)))
    .filter((s): s is string => !specialSections.includes(s as string))
    .sort()

  return (
    <>
      <DashboardClient
        stickers={stickers}
        userStickersMap={userStickersMap}
      />
      <div className="px-5 max-w-md mx-auto space-y-4 pb-4">
        <RankingCard ranking={rankingResult} />
        <StickerStats
          nationalStats={nationalStatsResult}
          neighborhoodStats={neighborhoodStatsResult}
          sections={sections}
        />
      </div>
    </>
  )
}
