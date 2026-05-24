import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { getCachedStickers } from '@/lib/stickers-cache'
import RankingPageClient from './RankingPageClient'
import type { Metadata } from 'next'
import { computeAlbumStats, type UserStickerEntry } from '@/lib/album-stats'

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

  // Fetch profile for visibility + referral code + identity (for "VOCÊ" card)
  const { data: profile } = await supabase
    .from('profiles')
    .select('ranking_visibility, referral_code, display_name, avatar_url')
    .eq('id', user.id)
    .single()

  // Total user count drives whether StickerStats is shown at all
  const { count: totalUsers } = await admin
    .from('profiles')
    .select('*', { count: 'exact', head: true })

  // Fetch ranking summary
  let ranking = null
  try {
    const { data } = await admin.rpc('get_user_ranking_v2', { p_user_id: user.id })
    ranking = data?.[0] || null
  } catch { /* unavailable */ }

  // Fetch leaderboards in parallel
  let nationalLeaderboard: any[] = []
  let cityLeaderboard: any[] = []
  let neighborhoodLeaderboard: any[] = []
  let friendsLeaderboard: any[] = []

  try {
    const [natRes, cityRes, neighRes, friendsRes] = await Promise.all([
      admin.rpc('get_ranking_leaderboard', { p_user_id: user.id, p_scope: 'national', p_limit: 30 }),
      admin.rpc('get_ranking_leaderboard', { p_user_id: user.id, p_scope: 'city', p_limit: 30 }),
      admin.rpc('get_ranking_leaderboard', { p_user_id: user.id, p_scope: 'neighborhood', p_limit: 30 }),
      admin.rpc('get_ranking_leaderboard', { p_user_id: user.id, p_scope: 'friends', p_limit: 30 }),
    ])
    nationalLeaderboard = natRes.data || []
    cityLeaderboard = cityRes.data || []
    neighborhoodLeaderboard = neighRes.data || []
    friendsLeaderboard = friendsRes.data || []
  } catch { /* leaderboards unavailable */ }

  // Fetch most wanted stickers
  let nationalStats: any[] = []
  let neighborhoodStats: any[] = []
  try {
    const [ns, nbs] = await Promise.all([
      admin.rpc('get_most_wanted_stickers', { p_section: null, p_limit: 10 }),
      admin.rpc('get_most_wanted_nearby', { p_user_id: user.id, p_radius_km: 2.5, p_limit: 10 }),
    ])
    nationalStats = ns.data || []
    neighborhoodStats = nbs.data || []
  } catch { /* stats unavailable */ }

  // Stats canônicos — mesma fonte das outras surfaces. Card do ranking
  // mostra owned/total do álbum oficial (counts_for_completion=true);
  // Coca-Cola e PANINI Extras não movem a barra.
  const { data: userStickers } = await supabase
    .from('user_stickers')
    .select('sticker_id, status, quantity')
    .eq('user_id', user.id)

  const userMap: Record<number, UserStickerEntry> = {}
  for (const us of (userStickers || []) as Array<{ sticker_id: number; status: string; quantity: number }>) {
    userMap[us.sticker_id] = { status: us.status, quantity: us.quantity }
  }
  const albumStats = computeAlbumStats(stickers, userMap)
  const owned = albumStats.album.pasted
  // "Repetidas" no ranking card mostra distintos do álbum + extras combinados
  // (mesma definição do bot e /album). Card é tight; cópias só aparecem
  // como tooltip via formatDuplicateLabel se quisermos no futuro.
  const duplicates = albumStats.all.duplicateStickers

  const specialSections = ['Coca-Cola', 'FIFA World Cup', 'PANINI Extras']
  const sections = Array.from(new Set(stickers.map((s: { section: string }) => s.section)))
    .filter((s): s is string => !specialSections.includes(s as string))
    .sort()

  return (
    <RankingPageClient
      ranking={ranking}
      nationalLeaderboard={nationalLeaderboard}
      cityLeaderboard={cityLeaderboard}
      neighborhoodLeaderboard={neighborhoodLeaderboard}
      friendsLeaderboard={friendsLeaderboard}
      nationalStats={nationalStats}
      neighborhoodStats={neighborhoodStats}
      sections={sections}
      owned={owned}
      duplicates={duplicates}
      duplicateCopies={albumStats.all.duplicateCopies}
      total={albumStats.album.total}
      extrasTotal={albumStats.extras.total}
      userId={user.id}
      userDisplayName={profile?.display_name || null}
      userAvatar={profile?.avatar_url || null}
      totalUsers={totalUsers ?? 0}
      rankingVisibility={profile?.ranking_visibility || 'public'}
      referralCode={profile?.referral_code || ''}
    />
  )
}
