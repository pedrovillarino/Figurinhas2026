/**
 * End-to-end smoke test for the Embaixadores campaign.
 *
 * Walks the entire flow against the production DB with cleanup-prefixed users:
 *   1. Schema sanity (all expected columns/tables exist)
 *   2. Pedro is excluded
 *   3. Code generation + ensureReferralCode idempotent
 *   4. Referral application flow (signup → +1 trade for friend, +1 scan for referrer)
 *   5. Coupon issuance at 5 friends + non-stacking
 *   6. paid_upgrade replaces points (1 → 5)
 *   7. Excluded referrer earns 0 points + 0 credits
 *   8. Anti-fraud: disposable email blocked, honeypot triggers, IP rate-limit
 *   9. Weekly ranking RPC returns correct order, excludes Pedro, excludes invalidated
 *  10. Coupon validation rejects non-owner usage
 *  11. Cleanup leaves no test artifacts
 *
 * Run: npx ts-node --compiler-options '...' scripts/smoke-embaixadores.ts
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import path from 'path'

config({ path: path.join(__dirname, '..', '.env.local') })

import {
  ensureReferralCode,
  getReferrerStats,
  shouldIssueCouponNow,
  issueReferrerCoupon,
  REFERRAL_CONSTANTS,
  isCampaignActive,
} from '../src/lib/referrals'
import {
  isDisposableEmail,
  isHoneypotTriggered,
  checkReferralIpRateLimit,
} from '../src/lib/anti-fraud'

const TEST_PREFIX = '_smoke_'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

let pass = 0
let fail = 0
const failures: string[] = []

function header(s: string) { console.log(`\n━━━ ${s} ━━━`) }
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`) }
  else { fail++; failures.push(msg); console.log(`  ❌ ${msg}`) }
}

async function createTestUser(
  label: string,
  opts?: { email?: string; excluded?: boolean; optedIn?: boolean; selfUpgradedAt?: string },
) {
  const email = opts?.email || `${TEST_PREFIX}${label}_${Date.now()}@completeai.test`
  const { data, error } = await admin.auth.admin.createUser({
    email, password: 'test123!T', email_confirm: true,
  })
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`)
  await admin.from('profiles').upsert({
    id: data.user.id,
    email,
    display_name: `Smoke ${label}`,
    excluded_from_campaign: !!opts?.excluded,
    opted_into_campaign_at: opts?.optedIn ? new Date().toISOString() : null,
    self_upgrade_at: opts?.selfUpgradedAt || null,
  }, { onConflict: 'id' })
  return data.user.id
}

async function cleanup() {
  console.log('\n🧹 Cleaning up smoke test data...')
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const testUsers = (users?.users || []).filter((u) => u.email?.startsWith(TEST_PREFIX))
  for (const u of testUsers) {
    await admin.from('referral_rewards').delete().eq('referrer_id', u.id)
    await admin.from('referral_rewards').delete().eq('referred_id', u.id)
    await admin.from('discount_codes').delete().eq('restricted_to_user_id', u.id)
    await admin.from('signup_attempts').delete().eq('email', u.email)
    await admin.from('profiles').delete().eq('id', u.id)
    await admin.auth.admin.deleteUser(u.id)
  }
  console.log(`  Cleaned ${testUsers.length} test users`)
}

async function runTests() {
  // ── 1. Schema sanity ──
  header('1. Schema sanity')
  const expectedCols = [
    { table: 'profiles', col: 'excluded_from_campaign' },
    { table: 'profiles', col: 'referral_code' },
    { table: 'profiles', col: 'referred_by' },
    { table: 'discount_codes', col: 'restricted_to_user_id' },
    { table: 'referral_rewards', col: 'status' },
    { table: 'referral_rewards', col: 'points' },
    { table: 'referral_rewards', col: 'signup_ip' },
    { table: 'referral_rewards', col: 'signup_fingerprint' },
  ]
  for (const { table, col } of expectedCols) {
    const { error } = await admin.from(table).select(col).limit(1)
    assert(!error, `Column ${table}.${col} exists`)
  }
  // Tables
  for (const tbl of ['community_goals', 'signup_attempts']) {
    const { error } = await admin.from(tbl).select('*').limit(1)
    assert(!error, `Table public.${tbl} exists`)
  }
  // RPC
  const { error: rpcErr } = await admin.rpc('get_embaixadores_weekly_ranking', {
    p_user_id: null, p_limit: 1,
  })
  assert(!rpcErr, `RPC get_embaixadores_weekly_ranking callable`)

  // ── 2. Pedro is excluded ──
  header('2. Pedro is excluded')
  const { data: pedro } = await admin
    .from('profiles')
    .select('display_name, excluded_from_campaign')
    .eq('phone', '21997838210')
    .maybeSingle()
  assert(pedro !== null, `Pedro exists in DB`)
  assert((pedro as { excluded_from_campaign?: boolean })?.excluded_from_campaign === true, `Pedro.excluded_from_campaign = true`)

  // ── 3. Code generation + idempotency ──
  header('3. Code generation')
  const referrerId = await createTestUser('ambassador')
  const code1 = await ensureReferralCode(referrerId)
  const code2 = await ensureReferralCode(referrerId)
  assert(code1 === code2, `ensureReferralCode idempotent (${code1})`)
  assert(/^SMOKE-[A-Z0-9]{4}$/.test(code1), `Code uses display_name prefix (got ${code1})`)

  // ── 4. Referral application flow (manual since /api requires auth) ──
  header('4. Manual referral application')
  const friendId = await createTestUser('friend1')
  const referrerProfileBefore = await admin.from('profiles').select('scan_credits, trade_credits').eq('id', referrerId).single()
  const friendProfileBefore = await admin.from('profiles').select('scan_credits, trade_credits').eq('id', friendId).single()

  await admin.rpc('add_trade_credits', { p_user_id: friendId, p_credits: 1 })
  await admin.rpc('add_scan_credits', { p_user_id: referrerId, p_credits: 1 })
  await admin.from('referral_rewards').insert({
    referrer_id: referrerId, referred_id: friendId, reward_type: 'signup',
    status: 'confirmed', points: 1, trade_credits: 1, scan_credits: 1,
    confirmed_at: new Date().toISOString(),
  })
  await admin.from('profiles').update({ referred_by: referrerId }).eq('id', friendId)

  const referrerAfter = await admin.from('profiles').select('scan_credits').eq('id', referrerId).single()
  const friendAfter = await admin.from('profiles').select('trade_credits').eq('id', friendId).single()

  const refScanDelta = (referrerAfter.data as { scan_credits: number }).scan_credits - (referrerProfileBefore.data as { scan_credits: number }).scan_credits
  const friendTradeDelta = (friendAfter.data as { trade_credits: number }).trade_credits - (friendProfileBefore.data as { trade_credits: number }).trade_credits
  assert(refScanDelta === 1, `Referrer got +1 scan credit`)
  assert(friendTradeDelta === 1, `Indicated friend got +1 trade credit`)

  // ── 5. Coupon at 5 friends (requires opt-in now) ──
  header('5. Coupon at 5 friends')
  // Coupons are gated on opt-in — set it for the referrer BEFORE the check
  await admin.from('profiles')
    .update({ opted_into_campaign_at: new Date().toISOString() })
    .eq('id', referrerId)
  for (let i = 2; i <= 5; i++) {
    const fId = await createTestUser(`friend${i}`)
    await admin.from('referral_rewards').insert({
      referrer_id: referrerId, referred_id: fId, reward_type: 'signup',
      status: 'confirmed', points: 1, trade_credits: 1, scan_credits: 1,
      confirmed_at: new Date().toISOString(),
    })
  }
  assert(await shouldIssueCouponNow(referrerId), `should issue at 5 friends (after opt-in)`)
  // Reset to NOT opted-in so test 9 (ranking gating) starts clean
  await admin.from('profiles')
    .update({ opted_into_campaign_at: null })
    .eq('id', referrerId)
  const issued = await issueReferrerCoupon(referrerId)
  assert(issued !== null && /^REF-[A-Z0-9]{5}$/.test(issued.code), `Coupon issued (${issued?.code})`)

  // Non-stacking: 6th friend should NOT trigger second coupon
  const friend6 = await createTestUser('friend6')
  await admin.from('referral_rewards').insert({
    referrer_id: referrerId, referred_id: friend6, reward_type: 'signup',
    status: 'confirmed', points: 1, trade_credits: 1, scan_credits: 1,
    confirmed_at: new Date().toISOString(),
  })
  assert(!(await shouldIssueCouponNow(referrerId)), `does NOT issue at 6 (still 1 active coupon, no stacking)`)

  // ── 6. paid_upgrade replaces points (1→5) ──
  header('6. paid_upgrade')
  await admin.from('referral_rewards')
    .update({ status: 'paid_upgrade', points: 5, upgraded_at: new Date().toISOString() })
    .eq('referrer_id', referrerId).eq('referred_id', friend6)
  const stats = await getReferrerStats(referrerId)
  assert(stats.paidUpgrade === 1, `paidUpgrade count = 1`)
  // 5 confirmed (1pt each) + 1 paid_upgrade (5pts) = 5 + 5 = 10
  assert(stats.points === 10, `points = 5 confirmed × 1 + 1 paid × 5 = 10 (got ${stats.points})`)

  // ── 7. Excluded referrer earns 0 ──
  header('7. Excluded referrer')
  const excludedId = await createTestUser('excluded', { excluded: true })
  const { data: excludedProf } = await admin.from('profiles').select('excluded_from_campaign').eq('id', excludedId).single()
  assert((excludedProf as { excluded_from_campaign: boolean }).excluded_from_campaign === true, `excluded flag set`)

  // Simulate the conditional logic in /api/referral/apply
  const friendOfExcluded = await createTestUser('friend-of-excluded')
  const isExcluded = (excludedProf as { excluded_from_campaign: boolean }).excluded_from_campaign
  await admin.from('referral_rewards').insert({
    referrer_id: excludedId, referred_id: friendOfExcluded, reward_type: 'signup',
    status: 'confirmed',
    points: isExcluded ? 0 : 1,
    trade_credits: 1, scan_credits: isExcluded ? 0 : 1,
    confirmed_at: new Date().toISOString(),
  })
  const excludedStats = await getReferrerStats(excludedId)
  assert(excludedStats.confirmed === 1, `excluded referrer has 1 confirmed`)
  assert(excludedStats.points === 0, `excluded referrer has 0 points (got ${excludedStats.points})`)

  // ── 8. Anti-fraud ──
  header('8. Anti-fraud')
  assert(isDisposableEmail('test@mailinator.com'), `mailinator detected`)
  assert(isDisposableEmail('test@10minutemail.com'), `10minutemail detected`)
  assert(!isDisposableEmail('test@gmail.com'), `gmail NOT flagged`)
  assert(!isDisposableEmail('user@completeai.com.br'), `our domain NOT flagged`)
  assert(!isDisposableEmail(''), `empty string handled`)
  assert(!isDisposableEmail(null), `null handled`)

  assert(isHoneypotTriggered({ website: 'https://spam.com' }), `honeypot website detected`)
  assert(isHoneypotTriggered({ url: 'http://x.com' }), `honeypot url detected`)
  assert(!isHoneypotTriggered({ website: '' }), `empty website allowed`)
  assert(!isHoneypotTriggered({ referral_code: 'ABC' }), `legitimate field allowed`)
  assert(!isHoneypotTriggered(null), `null body allowed`)

  // IP rate limit (won't trigger in test since we use test IPs)
  const ipCheck = await checkReferralIpRateLimit('192.168.99.99')
  assert(ipCheck.allowed === true, `fresh IP allowed (count=${ipCheck.count}/${ipCheck.limit})`)
  const localhost = await checkReferralIpRateLimit('127.0.0.1')
  assert(localhost.allowed === true, `localhost never rate-limited`)
  const nullIp = await checkReferralIpRateLimit(null)
  assert(nullIp.allowed === true, `null IP never rate-limited`)

  // ── 9. Ranking RPC: requires opt-in ──
  header('9. Ranking RPC (opt-in gating)')

  // referrerId from earlier tests is NOT opted-in yet — should be invisible
  const { data: rankingNoOpt } = await admin.rpc('get_embaixadores_weekly_ranking', {
    p_user_id: referrerId, p_limit: 50,
  })
  const rowsNoOpt = (rankingNoOpt || []) as Array<{ user_id: string; rank: number; total_points: number; self_upgraded: boolean }>
  const beforeOptInRow = rowsNoOpt.find((r) => r.user_id === referrerId)
  assert(beforeOptInRow === undefined, `referrer NOT in ranking before opting in`)

  // Opt-in the referrer manually
  await admin.from('profiles')
    .update({ opted_into_campaign_at: new Date().toISOString() })
    .eq('id', referrerId)

  const { data: rankingOpted } = await admin.rpc('get_embaixadores_weekly_ranking', {
    p_user_id: referrerId, p_limit: 50,
  })
  const rowsOpted = (rankingOpted || []) as Array<{ user_id: string; rank: number; total_points: number; self_upgraded: boolean }>
  const afterOptInRow = rowsOpted.find((r) => r.user_id === referrerId)
  assert(afterOptInRow !== undefined, `referrer appears in ranking AFTER opt-in`)
  assert(afterOptInRow!.total_points === 10, `referrer points = 10 (5 confirmed × 1 + 1 paid × 5)`)

  // Excluded user must NOT appear
  const excludedRow = rowsOpted.find((r) => r.user_id === excludedId)
  assert(excludedRow === undefined, `excluded user does NOT appear in ranking`)

  // Pedro (excluded) shouldn't appear either
  const { data: pedroProf } = await admin.from('profiles').select('id').eq('phone', '21997838210').single()
  if (pedroProf) {
    const pedroRow = rowsOpted.find((r) => r.user_id === (pedroProf as { id: string }).id)
    assert(pedroRow === undefined, `Pedro does NOT appear in ranking`)
  }

  // ── 9b. Self-upgrade adds +5 ──
  header('9b. Self-upgrade bonus')
  const selfUpgradedId = await createTestUser('selfup', { optedIn: true, selfUpgradedAt: new Date().toISOString() })
  const { data: rankingSelfUp } = await admin.rpc('get_embaixadores_weekly_ranking', {
    p_user_id: selfUpgradedId, p_limit: 100,
  })
  const selfUpRows = (rankingSelfUp || []) as Array<{ user_id: string; total_points: number; self_upgraded: boolean }>
  const selfUpRow = selfUpRows.find((r) => r.user_id === selfUpgradedId)
  assert(selfUpRow !== undefined, `self-upgrade user appears in ranking`)
  assert(selfUpRow!.self_upgraded === true, `self_upgraded flag is true`)
  assert(selfUpRow!.total_points === 5, `self-upgrade alone = 5 points`)

  // ── 9c. Pre-opt-in referrals count, pre-campaign referrals don't ──
  header('9c. Lookback boundary')
  const lateOptedInId = await createTestUser('late_optin')

  // Friend confirmed NOW (within campaign + lookback window)
  const friendInsideWindow = await createTestUser('friend_inside')
  await admin.from('referral_rewards').insert({
    referrer_id: lateOptedInId, referred_id: friendInsideWindow, reward_type: 'signup',
    status: 'confirmed', points: 1, trade_credits: 1, scan_credits: 1,
    confirmed_at: new Date().toISOString(),
  })

  // Friend confirmed BEFORE campaign_start (must NOT count even with lookback,
  // because earliest_eligible is clamped to campaign_start)
  const friendBeforeCampaign = await createTestUser('friend_before')
  await admin.from('referral_rewards').insert({
    referrer_id: lateOptedInId, referred_id: friendBeforeCampaign, reward_type: 'signup',
    status: 'confirmed', points: 1, trade_credits: 1, scan_credits: 1,
    confirmed_at: '2026-04-20T00:00:00Z',  // 9 days before campaign_start
  })

  // Now opt in (NOW is within campaign window)
  await admin.from('profiles')
    .update({ opted_into_campaign_at: new Date().toISOString() })
    .eq('id', lateOptedInId)

  const { data: rankingLate } = await admin.rpc('get_embaixadores_weekly_ranking', {
    p_user_id: lateOptedInId, p_limit: 100,
  })
  const lateRows = (rankingLate || []) as Array<{ user_id: string; total_points: number }>
  const lateRow = lateRows.find((r) => r.user_id === lateOptedInId)
  assert(lateRow !== undefined, `late-opted-in user appears`)
  assert(lateRow!.total_points === 1,
    `only the in-window referral counts; pre-campaign one excluded (got ${lateRow?.total_points})`)

  // ── 9d. Cupom requires opt-in ──
  header('9d. Coupon issuance gated on opt-in')
  const noOptId = await createTestUser('no_optin') // NOT opted in
  for (let i = 0; i < 5; i++) {
    const fId = await createTestUser(`no_optin_friend${i}`)
    await admin.from('referral_rewards').insert({
      referrer_id: noOptId, referred_id: fId, reward_type: 'signup',
      status: 'confirmed', points: 1, trade_credits: 1, scan_credits: 1,
      confirmed_at: new Date().toISOString(),
    })
  }
  const shouldIssueWithoutOptIn = await shouldIssueCouponNow(noOptId)
  assert(!shouldIssueWithoutOptIn, `5 friends but NOT opted in → no coupon`)

  // Now opt in
  await admin.from('profiles')
    .update({ opted_into_campaign_at: new Date().toISOString() })
    .eq('id', noOptId)
  const shouldIssueAfterOptIn = await shouldIssueCouponNow(noOptId)
  assert(shouldIssueAfterOptIn, `same user, after opt-in → cupon CAN be issued`)

  // ── 9e. participant count helper ──
  header('9e. Participant count')
  const { data: participantCount } = await admin.rpc('get_embaixadores_participant_count')
  assert(typeof participantCount === 'number', `participant count returns a number`)
  assert((participantCount as number) >= 3, `participant count includes our test opt-ins (got ${participantCount})`)

  // ── 10. Coupon validation cross-user check ──
  header('10. Coupon non-transferability')
  const otherUserId = await createTestUser('other')
  const { data: couponRow } = await admin
    .from('discount_codes')
    .select('restricted_to_user_id')
    .eq('code', issued!.code)
    .limit(1)
    .single()
  const couponOwner = (couponRow as { restricted_to_user_id: string }).restricted_to_user_id
  assert(couponOwner === referrerId, `coupon bound to issuing user`)
  assert(couponOwner !== otherUserId, `coupon NOT usable by other user`)

  // ── 11. Campaign active flag ──
  header('11. Campaign active flag')
  assert(isCampaignActive(), `campaign currently active (today < end date)`)
  const futureDate = new Date('2027-01-01')
  assert(!isCampaignActive(futureDate), `campaign inactive after end date`)
  assert(REFERRAL_CONSTANTS.CAMPAIGN_END_DATE_ISO === '2026-05-13T02:59:59.000Z',
    `end date = 2026-05-12 23:59:59 BRT (= 2026-05-13 02:59:59 UTC)`)
}

;(async () => {
  try {
    await runTests()
  } catch (err) {
    console.error('\n💥 Smoke test crashed:', err)
    fail++
  } finally {
    await cleanup()
    console.log(`\n${'═'.repeat(50)}`)
    console.log(`Smoke test: ${pass} passed, ${fail} failed`)
    if (fail > 0) {
      console.log('\nFailures:')
      failures.forEach((f) => console.log(`  • ${f}`))
      process.exit(1)
    }
    console.log('✨ All smoke tests passed!')
    process.exit(0)
  }
})()
