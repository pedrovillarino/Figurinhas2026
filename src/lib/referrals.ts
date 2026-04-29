// Helpers for the "Embaixadores Complete Aí" launch campaign.
//
// Reward model (decided 2026-04-29):
//   - Indicated friend (just signed up): +1 trade credit, immediately
//   - Referrer per confirmed friend: +1 scan credit, immediately
//   - Referrer at 5 confirmed friends: 50% off coupon, valid 48h, single-use,
//     bound to the referrer's user_id (non-transferable)
//   - Referrer when friend purchases a paid tier: +5 points (replaces the +1
//     from confirmation, NOT additive) → moves up the weekly ranking
//
// All credits are granted on referral_rewards.status='confirmed'. We don't
// gate on email confirmation in S1 (Pedro's call — relax the bar for the
// first campaign cycle and tighten in S2).
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const COUPON_PERCENT_OFF = 50
const COUPON_VALIDITY_HOURS = 48
const FRIENDS_FOR_COUPON = 5
const POINTS_CONFIRMED = 1
const POINTS_PAID_UPGRADE = 5
const POINTS_SELF_UPGRADE = 5
// Retroactive lookback at opt-in: referrals/self-upgrade up to N days before
// the user clicked "Começar a participar" still count toward their ranking.
const OPTIN_LOOKBACK_DAYS = 3
// Minimum participants threshold — Complete Aí may extend the campaign end
// date if not met, per the official rules.
const MIN_PARTICIPANTS = 50
// Minimum participants before the public ranking + counters become visible.
// Below this we show a "warming up" placeholder instead, so a quiet first
// few hours don't feel deserted.
const MIN_PARTICIPANTS_FOR_DISPLAY = 8

// Single-cycle campaign: 2026-04-29 00:00 BRT → 2026-05-12 23:59:59 BRT
// (= 2026-04-29 03:00 UTC → 2026-05-13 02:59:59 UTC).
//
// The ranking is CUMULATIVE across the whole period — there is no weekly
// reset. Top 3 is decided at the campaign end. After the end:
//   - The "/campanha" page still loads but switches to a "campaign ended" view
//   - The launch-promo modal stops appearing
//   - The "Prêmios" tab in BottomNav auto-hides
//   - Cron jobs no-op
const CAMPAIGN_START_DATE_ISO = '2026-04-29T03:00:00.000Z'
const CAMPAIGN_END_DATE_ISO = '2026-05-13T02:59:59.000Z'

export const REFERRAL_CONSTANTS = {
  COUPON_PERCENT_OFF,
  COUPON_VALIDITY_HOURS,
  FRIENDS_FOR_COUPON,
  POINTS_CONFIRMED,
  POINTS_PAID_UPGRADE,
  POINTS_SELF_UPGRADE,
  OPTIN_LOOKBACK_DAYS,
  MIN_PARTICIPANTS,
  MIN_PARTICIPANTS_FOR_DISPLAY,
  CAMPAIGN_START_DATE_ISO,
  CAMPAIGN_END_DATE_ISO,
} as const

export function isCampaignActive(now: Date = new Date()): boolean {
  const t = now.getTime()
  return t >= new Date(CAMPAIGN_START_DATE_ISO).getTime()
    && t < new Date(CAMPAIGN_END_DATE_ISO).getTime()
}

function getAdmin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

// ─── Referral code generation ───────────────────────────────────────────────
// Format: <prefix>-<rand4>  e.g. "PEDRO-9K4X"
// Prefix = first 5 alphanumeric chars of display_name (uppercased), or
// random if name is missing/short. Random suffix avoids collisions.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/0/1 (visually similar)

function randomChars(n: number): string {
  let out = ''
  for (let i = 0; i < n; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return out
}

function nameToPrefix(name: string | null | undefined): string {
  if (!name) return randomChars(5)
  const cleaned = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)
  return cleaned.length >= 3 ? cleaned : randomChars(5)
}

/** Generate a unique referral code, retrying on collision. */
export async function generateReferralCode(displayName?: string | null): Promise<string> {
  const admin = getAdmin()
  const prefix = nameToPrefix(displayName)

  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = `${prefix}-${randomChars(4)}`
    const { data: existing } = await admin
      .from('profiles')
      .select('id')
      .eq('referral_code', candidate)
      .maybeSingle()

    if (!existing) return candidate
  }

  // Fallback: pure random
  return `${randomChars(5)}-${randomChars(4)}`
}

/** Get or create a referral code for the user. Idempotent. */
export async function ensureReferralCode(userId: string): Promise<string> {
  const admin = getAdmin()
  const { data: profile } = await admin
    .from('profiles')
    .select('referral_code, display_name')
    .eq('id', userId)
    .single()

  if (profile?.referral_code) return profile.referral_code

  const code = await generateReferralCode(profile?.display_name)
  const { error } = await admin
    .from('profiles')
    .update({ referral_code: code })
    .eq('id', userId)

  if (error) {
    // Race: another request grabbed a code between our SELECT and UPDATE.
    // Re-read and return whatever's there.
    const { data: refreshed } = await admin
      .from('profiles')
      .select('referral_code')
      .eq('id', userId)
      .single()
    return refreshed?.referral_code || code
  }

  return code
}

// ─── Referrer stats ─────────────────────────────────────────────────────────
export type ReferrerStats = {
  pending: number
  confirmed: number
  paidUpgrade: number
  totalRewardsGranted: number
  points: number
  pendingCouponCount: number // already issued, not yet redeemed
}

export async function getReferrerStats(userId: string): Promise<ReferrerStats> {
  const admin = getAdmin()
  const { data: rewards } = await admin
    .from('referral_rewards')
    .select('status, points')
    .eq('referrer_id', userId)

  const stats: ReferrerStats = {
    pending: 0, confirmed: 0, paidUpgrade: 0,
    totalRewardsGranted: 0, points: 0, pendingCouponCount: 0,
  }

  ;(rewards || []).forEach((r) => {
    const row = r as { status: string; points: number }
    if (row.status === 'pending') stats.pending++
    else if (row.status === 'confirmed') stats.confirmed++
    else if (row.status === 'paid_upgrade') stats.paidUpgrade++
    if (row.status === 'confirmed' || row.status === 'paid_upgrade') {
      stats.totalRewardsGranted++
      stats.points += row.points || 0
    }
  })

  // Active (unredeemed, not expired) coupons issued to this referrer
  const { data: coupons } = await admin
    .from('discount_codes')
    .select('id, valid_until, times_used, max_uses')
    .eq('restricted_to_user_id', userId)
    .eq('active', true)

  const now = new Date()
  ;(coupons || []).forEach((c) => {
    const cou = c as { valid_until: string | null; times_used: number; max_uses: number | null }
    if (cou.valid_until && new Date(cou.valid_until) < now) return
    if (cou.max_uses !== null && cou.times_used >= cou.max_uses) return
    stats.pendingCouponCount++
  })

  return stats
}

// ─── Coupon issuance (50% off, 48h, non-transferable) ───────────────────────
/**
 * Issue a 50%-off coupon bound to the user. Returns the coupon row + code.
 * Idempotent guard: callers should check if the user already has a recent
 * unredeemed coupon to avoid duplicate issuance per ranking-window.
 */
export async function issueReferrerCoupon(userId: string): Promise<{
  code: string
  validUntil: string
  id: string
} | null> {
  const admin = getAdmin()

  // Generate unique code: REF-<5char>
  let code = ''
  for (let attempt = 0; attempt < 8; attempt++) {
    code = `REF-${randomChars(5)}`
    // Check uniqueness across ALL tiers (we'll insert one row per tier below)
    const { data: existing } = await admin
      .from('discount_codes')
      .select('id')
      .eq('code', code)
      .limit(1)
      .maybeSingle()
    if (!existing) break
  }

  const validUntil = new Date(Date.now() + COUPON_VALIDITY_HOURS * 3600 * 1000).toISOString()

  // The discount_codes table has UNIQUE(code, tier). We want this single coupon
  // to work on ANY tier the referrer chooses, so insert one row per tier with
  // the same code. The validate endpoint resolves by (code, tier).
  const tiers: Array<'estreante' | 'colecionador' | 'copa_completa'> = [
    'estreante', 'colecionador', 'copa_completa',
  ]

  let firstId: string | null = null
  for (const tier of tiers) {
    const { data, error } = await admin
      .from('discount_codes')
      .insert({
        code,
        tier,
        percent_off: COUPON_PERCENT_OFF,
        max_uses: 1,
        times_used: 0,
        valid_until: validUntil,
        active: true,
        created_by: 'referral_program',
        restricted_to_user_id: userId,
      })
      .select('id')
      .single()

    if (error) {
      console.error(`Failed to insert coupon for tier ${tier}:`, error)
      continue
    }
    if (!firstId && data) firstId = (data as { id: string }).id
  }

  if (!firstId) return null
  return { code, validUntil, id: firstId }
}

/**
 * Should we issue a new coupon right now?
 *
 * Rules (Pedro's call, 2026-04-29):
 *   - Coupons DO NOT stack — at most one ACTIVE (unredeemed, unexpired)
 *     coupon per referrer at any time
 *   - Threshold: every batch of FRIENDS_FOR_COUPON confirmed friends earns
 *     one coupon (5, 10, 15, …)
 *   - If the current coupon expires/gets used and the user already passed a
 *     new multiple-of-5 threshold, the NEXT confirmation (or a backfill job)
 *     issues the next coupon
 *
 * Returns true when: confirmed-count is a multiple of 5 AND the user has no
 * active unredeemed coupon AND they haven't already received N coupons where
 * N = floor(confirmed / 5).
 */
export async function shouldIssueCouponNow(referrerId: string): Promise<boolean> {
  const admin = getAdmin()

  // Coupons gated on opt-in — non-participants don't earn campaign rewards.
  const { data: profile } = await admin
    .from('profiles')
    .select('opted_into_campaign_at, excluded_from_campaign')
    .eq('id', referrerId)
    .single()
  const prof = profile as { opted_into_campaign_at: string | null; excluded_from_campaign: boolean | null } | null
  if (!prof || !prof.opted_into_campaign_at || prof.excluded_from_campaign) return false

  // Confirmed + upgraded both count as "this friend was a real win"
  const { count: confirmedCount } = await admin
    .from('referral_rewards')
    .select('*', { count: 'exact', head: true })
    .eq('referrer_id', referrerId)
    .in('status', ['confirmed', 'paid_upgrade'])

  if (!confirmedCount || confirmedCount < FRIENDS_FOR_COUPON) return false
  if (confirmedCount % FRIENDS_FOR_COUPON !== 0) return false

  // Hard rule: no stacking. If user already has any ACTIVE (unredeemed,
  // unexpired) coupon from the program, do not issue a new one yet.
  const { data: activeCoupons } = await admin
    .from('discount_codes')
    .select('id, valid_until, times_used, max_uses')
    .eq('restricted_to_user_id', referrerId)
    .eq('created_by', 'referral_program')
    .eq('active', true)

  const now = Date.now()
  const hasActive = (activeCoupons || []).some((c) => {
    const cou = c as { valid_until: string | null; times_used: number; max_uses: number | null }
    if (cou.valid_until && new Date(cou.valid_until).getTime() < now) return false
    if (cou.max_uses !== null && cou.times_used >= cou.max_uses) return false
    return true
  })
  if (hasActive) return false

  // Track total coupons earned — used to compute deficits when this fires
  // after a previous coupon expired/was redeemed and user already had the
  // points to claim a new one.
  const couponsEarned = Math.floor(confirmedCount / FRIENDS_FOR_COUPON)
  // Each unique code creates 3 rows (one per tier) — divide accordingly.
  const couponsIssuedTotal = Math.floor((activeCoupons?.length || 0) / 3)

  // Count ALL coupons (including expired/redeemed) — same divide-by-3 applies
  const { count: allCouponRows } = await admin
    .from('discount_codes')
    .select('*', { count: 'exact', head: true })
    .eq('restricted_to_user_id', referrerId)
    .eq('created_by', 'referral_program')

  const couponsEverIssued = Math.floor((allCouponRows || 0) / 3)
  // Use the broader count so we don't re-issue once user is "caught up"
  void couponsIssuedTotal // silence unused-var lint
  return couponsEverIssued < couponsEarned
}
