import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { ensureReferralCode, getReferrerStats, REFERRAL_CONSTANTS, isCampaignActive } from '@/lib/referrals'
import CampanhaClient from './CampanhaClient'

export const metadata: Metadata = {
  title: 'Campanha Embaixadores — Complete Aí',
  description:
    'Indique amigos e ganhe figurinhas, cupons e prêmios. Top 3 da semana ganha kit físico. Desafio comunitário ativo.',
  openGraph: {
    title: 'Embaixadores Complete Aí — ganhe pacotes e cupons',
    description:
      'Convide amigos pra completar o álbum. Top 3 do ranking semanal ganha pacotes Panini + porta-figurinha. Cada cadastro vira figurinha grátis.',
  },
}

export const dynamic = 'force-dynamic'

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export type RankingRow = {
  rank: number
  user_id: string
  display_name: string | null
  avatar_url: string | null
  confirmed_count: number
  paid_upgrade_count: number
  total_points: number
  is_self: boolean
}

export type ActiveCoupon = {
  code: string
  valid_until: string
  percent_off: number
}

export default async function CampanhaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = getAdmin()

  // ── Member-area data (only if logged in) ──
  let referralCode: string | null = null
  let stats: Awaited<ReturnType<typeof getReferrerStats>> | null = null
  let activeCoupons: ActiveCoupon[] = []
  let displayName: string | null = null

  let userExcluded = false
  if (user) {
    const { data: profile } = await admin
      .from('profiles')
      .select('display_name, excluded_from_campaign')
      .eq('id', user.id)
      .single()
    displayName = (profile as { display_name?: string } | null)?.display_name ?? null
    userExcluded = !!(profile as { excluded_from_campaign?: boolean } | null)?.excluded_from_campaign

    referralCode = await ensureReferralCode(user.id)
    stats = await getReferrerStats(user.id)

    // Active coupons (deduplicate by code — DB stores 3 rows/code, one per tier)
    const { data: couponRows } = await admin
      .from('discount_codes')
      .select('code, valid_until, percent_off, times_used, max_uses, active')
      .eq('restricted_to_user_id', user.id)
      .eq('created_by', 'referral_program')
      .eq('active', true)

    const seenCodes = new Set<string>()
    const now = Date.now()
    ;(couponRows || []).forEach((c) => {
      const cou = c as ActiveCoupon & { times_used: number; max_uses: number | null }
      if (seenCodes.has(cou.code)) return
      if (cou.valid_until && new Date(cou.valid_until).getTime() < now) return
      if (cou.max_uses !== null && cou.times_used >= cou.max_uses) return
      seenCodes.add(cou.code)
      activeCoupons.push({
        code: cou.code,
        valid_until: cou.valid_until,
        percent_off: cou.percent_off,
      })
    })
  }

  // ── Public ranking (top 50, anyone can see) ──
  let ranking: RankingRow[] = []
  try {
    const { data } = await admin.rpc('get_embaixadores_weekly_ranking', {
      p_user_id: user?.id || null,
      p_limit: 50,
    })
    ranking = (data || []) as RankingRow[]
  } catch (err) {
    console.error('Embaixadores ranking fetch failed:', err)
  }

  // ── Aggregate community counters (lifetime, not weekly) ──
  let totalConfirmed = 0
  let totalPaidUpgrades = 0
  let totalActiveAmbassadors = 0
  try {
    const { count: confirmed } = await admin
      .from('referral_rewards')
      .select('*', { count: 'exact', head: true })
      .in('status', ['confirmed', 'paid_upgrade'])
    const { count: paid } = await admin
      .from('referral_rewards')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'paid_upgrade')
    const { data: ambassadors } = await admin
      .from('referral_rewards')
      .select('referrer_id')
      .in('status', ['confirmed', 'paid_upgrade'])
    totalConfirmed = confirmed ?? 0
    totalPaidUpgrades = paid ?? 0
    totalActiveAmbassadors = new Set((ambassadors || []).map((r) => (r as { referrer_id: string }).referrer_id)).size
  } catch (err) {
    console.error('Embaixadores totals fetch failed:', err)
  }

  return (
    <CampanhaClient
      isLoggedIn={!!user}
      userId={user?.id || null}
      displayName={displayName}
      referralCode={referralCode}
      stats={stats}
      activeCoupons={activeCoupons}
      ranking={ranking}
      userExcluded={userExcluded}
      totals={{
        confirmed: totalConfirmed,
        paidUpgrades: totalPaidUpgrades,
        ambassadors: totalActiveAmbassadors,
      }}
      campaignActive={isCampaignActive()}
      campaignEndIso={REFERRAL_CONSTANTS.CAMPAIGN_END_DATE_ISO}
      constants={{
        couponPercentOff: REFERRAL_CONSTANTS.COUPON_PERCENT_OFF,
        couponValidityHours: REFERRAL_CONSTANTS.COUPON_VALIDITY_HOURS,
        friendsForCoupon: REFERRAL_CONSTANTS.FRIENDS_FOR_COUPON,
        pointsConfirmed: REFERRAL_CONSTANTS.POINTS_CONFIRMED,
        pointsPaidUpgrade: REFERRAL_CONSTANTS.POINTS_PAID_UPGRADE,
      }}
    />
  )
}
