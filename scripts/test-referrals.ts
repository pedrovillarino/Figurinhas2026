/**
 * Integration test for src/lib/referrals.ts.
 *
 * Strategy: create N dummy "_referral_test_" profiles + auth users, exercise
 * the helpers, assert behavior, then clean up. We DO write to production DB
 * (no separate test DB available), so the cleanup section is critical.
 *
 * Run: npx ts-node --project tsconfig.scripts.json scripts/test-referrals.ts
 *      (or: node --import tsx scripts/test-referrals.ts if tsx installed)
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import path from 'path'

config({ path: path.join(__dirname, '..', '.env.local') })

import {
  generateReferralCode,
  ensureReferralCode,
  getReferrerStats,
  shouldIssueCouponNow,
  issueReferrerCoupon,
  REFERRAL_CONSTANTS,
} from '../src/lib/referrals'

const TEST_PREFIX = '_referral_test_'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

let pass = 0
let fail = 0
const failures: string[] = []

function assert(cond: boolean, msg: string) {
  if (cond) {
    pass++
    console.log(`  ✅ ${msg}`)
  } else {
    fail++
    failures.push(msg)
    console.log(`  ❌ ${msg}`)
  }
}

async function createTestUser(label: string) {
  const email = `${TEST_PREFIX}${label}_${Date.now()}@completeai.test`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'testtest123!',
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`Failed to create user: ${error?.message}`)

  // Ensure profile row (Supabase Auth trigger may or may not create it)
  await admin.from('profiles').upsert({
    id: data.user.id,
    email,
    display_name: `Test ${label}`,
  }, { onConflict: 'id' })

  return data.user.id
}

async function cleanup() {
  console.log('\n🧹 Cleaning up test data...')

  // Delete test users (cascades to profiles via FK)
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const testUsers = (users?.users || []).filter((u) => u.email?.startsWith(TEST_PREFIX))
  for (const u of testUsers) {
    // Delete referral_rewards first (FK to profiles)
    await admin.from('referral_rewards').delete().eq('referrer_id', u.id)
    await admin.from('referral_rewards').delete().eq('referred_id', u.id)
    // Delete coupons
    await admin.from('discount_codes').delete().eq('restricted_to_user_id', u.id)
    // Delete profile
    await admin.from('profiles').delete().eq('id', u.id)
    // Delete auth user
    await admin.auth.admin.deleteUser(u.id)
  }
  console.log(`  Cleaned ${testUsers.length} test users + their data`)
}

async function runTests() {
  console.log('\n🧪 Testing src/lib/referrals.ts\n')

  // ── Test 1: generateReferralCode pure logic ──────────────────────────
  console.log('Test 1: generateReferralCode')
  const code1 = await generateReferralCode('Pedro Villarino')
  assert(/^PEDRO-[A-Z0-9]{4}$/.test(code1), `Code from "Pedro Villarino" matches PEDRO-XXXX (got: ${code1})`)

  const code2 = await generateReferralCode('Maria')
  assert(/^MARIA-[A-Z0-9]{4}$/.test(code2), `Code from "Maria" matches MARIA-XXXX (got: ${code2})`)

  const code3 = await generateReferralCode(null)
  assert(/^[A-Z0-9]{5}-[A-Z0-9]{4}$/.test(code3), `Code from null name = random format (got: ${code3})`)

  const code4 = await generateReferralCode('A')   // too short
  assert(/^[A-Z0-9]{5}-[A-Z0-9]{4}$/.test(code4), `Code from short "A" = random format (got: ${code4})`)

  // No I/O/0/1 in alphabet (avoid visual confusion). Only check the random
  // SUFFIX part (after the dash) of each code — name prefixes can contain
  // those characters legitimately (e.g. "MARIO" has I).
  const suffixes = [code1, code2, code3, code4]
    .map((c) => c.split('-')[1])
    .join('')
  assert(!/[IO01]/.test(suffixes), `No I/O/0/1 in random suffixes (got: ${suffixes})`)

  // ── Test 2: ensureReferralCode is idempotent ─────────────────────────
  console.log('\nTest 2: ensureReferralCode idempotency')
  const referrerId = await createTestUser('referrer')
  const codeA = await ensureReferralCode(referrerId)
  const codeB = await ensureReferralCode(referrerId)
  assert(codeA === codeB, `Returns same code on repeat call (${codeA} === ${codeB})`)
  // display_name "Test referrer" → "TESTR" prefix (first 5 alphanum, no space)
  assert(/^TESTR-[A-Z0-9]{4}$/.test(codeA), `Code uses display_name prefix (got: ${codeA})`)

  // ── Test 3: getReferrerStats with no referrals ───────────────────────
  console.log('\nTest 3: getReferrerStats — empty')
  const emptyStats = await getReferrerStats(referrerId)
  assert(emptyStats.confirmed === 0, `Empty: confirmed = 0`)
  assert(emptyStats.points === 0, `Empty: points = 0`)
  assert(emptyStats.pendingCouponCount === 0, `Empty: 0 active coupons`)

  // ── Test 4: shouldIssueCouponNow at 0, 1, 4 friends → false ──────────
  console.log('\nTest 4: shouldIssueCouponNow at friends < 5 → false')
  for (let i = 0; i < 4; i++) {
    const friendId = await createTestUser(`friend${i}`)
    await admin.from('referral_rewards').insert({
      referrer_id: referrerId,
      referred_id: friendId,
      reward_type: 'signup',
      status: 'confirmed',
      points: 1,
      trade_credits: 1,
      scan_credits: 1,
      confirmed_at: new Date().toISOString(),
    })
  }

  const shouldNotIssueAt4 = await shouldIssueCouponNow(referrerId)
  assert(!shouldNotIssueAt4, `4 friends → no coupon issued`)

  // ── Test 5: shouldIssueCouponNow at exactly 5 → true ─────────────────
  console.log('\nTest 5: shouldIssueCouponNow at friends === 5 → true')
  const friend5Id = await createTestUser('friend5')
  await admin.from('referral_rewards').insert({
    referrer_id: referrerId,
    referred_id: friend5Id,
    reward_type: 'signup',
    status: 'confirmed',
    points: 1,
    trade_credits: 1,
    scan_credits: 1,
    confirmed_at: new Date().toISOString(),
  })

  const shouldIssueAt5 = await shouldIssueCouponNow(referrerId)
  assert(shouldIssueAt5, `5 friends → SHOULD issue coupon`)

  // ── Test 6: issueReferrerCoupon creates 3 tier rows + restricted_to ──
  console.log('\nTest 6: issueReferrerCoupon')
  const issued = await issueReferrerCoupon(referrerId)
  assert(issued !== null, `Coupon issuance returned non-null`)
  if (issued) {
    assert(/^REF-[A-Z0-9]{5}$/.test(issued.code), `Coupon code matches REF-XXXXX (got: ${issued.code})`)

    const validUntilDate = new Date(issued.validUntil)
    const hoursOut = (validUntilDate.getTime() - Date.now()) / 3600000
    assert(hoursOut > 47.9 && hoursOut < 48.1, `validUntil ≈ 48h from now (got: ${hoursOut.toFixed(2)}h)`)

    // Verify 3 rows in DB (one per tier), all restricted to referrer
    const { data: couponRows } = await admin
      .from('discount_codes')
      .select('tier, restricted_to_user_id, percent_off, max_uses, valid_until')
      .eq('code', issued.code)

    assert(couponRows?.length === 3, `3 rows created (one per tier), got ${couponRows?.length}`)
    assert(!!couponRows?.every((r) => r.restricted_to_user_id === referrerId), `All rows restricted to referrer`)
    assert(!!couponRows?.every((r) => r.percent_off === 50), `All rows percent_off=50`)
    assert(!!couponRows?.every((r) => r.max_uses === 1), `All rows max_uses=1`)
    const tiers = couponRows?.map((r) => r.tier).sort()
    assert(
      JSON.stringify(tiers) === JSON.stringify(['colecionador', 'copa_completa', 'estreante']),
      `All 3 paid tiers covered (got: ${tiers?.join(',')})`,
    )
  }

  // ── Test 7: stats after coupon issuance ──────────────────────────────
  console.log('\nTest 7: getReferrerStats after 5 friends + 1 coupon')
  const fullStats = await getReferrerStats(referrerId)
  assert(fullStats.confirmed === 5, `confirmed = 5 (got ${fullStats.confirmed})`)
  assert(fullStats.points === 5, `points = 5 × 1 (got ${fullStats.points})`)
  assert(fullStats.pendingCouponCount === 3, `pendingCouponCount = 3 (one per tier row, got ${fullStats.pendingCouponCount})`)

  // ── Test 8: shouldIssueCouponNow at 5 with coupon already issued → false ─
  console.log('\nTest 8: idempotency — no second coupon at same threshold')
  const shouldNotIssueAgain = await shouldIssueCouponNow(referrerId)
  assert(!shouldNotIssueAgain, `Already issued at 5 → no double-issue`)

  // ── Test 9: paid_upgrade replaces points (1 → 5) ─────────────────────
  console.log('\nTest 9: paid_upgrade gives 5 points (replaces, not stacks)')
  const friendUpgradeId = await createTestUser('paying_friend')
  await admin.from('referral_rewards').insert({
    referrer_id: referrerId,
    referred_id: friendUpgradeId,
    reward_type: 'signup',
    status: 'confirmed',
    points: 1,
    trade_credits: 1,
    scan_credits: 1,
    confirmed_at: new Date().toISOString(),
  })
  // Simulate webhook updating it to paid_upgrade
  await admin.from('referral_rewards')
    .update({ status: 'paid_upgrade', points: 5, upgraded_at: new Date().toISOString() })
    .eq('referrer_id', referrerId)
    .eq('referred_id', friendUpgradeId)

  const upgradedStats = await getReferrerStats(referrerId)
  assert(upgradedStats.paidUpgrade === 1, `paidUpgrade = 1 (got ${upgradedStats.paidUpgrade})`)
  assert(upgradedStats.points === 5 + 5, `points = 5 (confirmed) + 5 (1 upgrade × 5pts) = 10 (got ${upgradedStats.points})`)
  assert(upgradedStats.confirmed === 5, `confirmed still = 5 (paid not double-counted, got ${upgradedStats.confirmed})`)

  // ── Test 10: shouldIssueCouponNow at 6 (5 conf + 1 upgrade) → false ──
  console.log('\nTest 10: 6 valid friends, but already issued at 5 → no new coupon')
  const shouldNotIssueAt6 = await shouldIssueCouponNow(referrerId)
  assert(!shouldNotIssueAt6, `6 friends, 1 coupon already issued → no second coupon yet`)

  // ── Test 11: Constants sanity check ──────────────────────────────────
  console.log('\nTest 11: Constants')
  assert(REFERRAL_CONSTANTS.COUPON_PERCENT_OFF === 50, `Coupon = 50% off`)
  assert(REFERRAL_CONSTANTS.COUPON_VALIDITY_HOURS === 48, `Coupon = 48h`)
  assert(REFERRAL_CONSTANTS.FRIENDS_FOR_COUPON === 5, `Threshold = 5 friends`)
  assert(REFERRAL_CONSTANTS.POINTS_CONFIRMED === 1, `Confirmed = 1 pt`)
  assert(REFERRAL_CONSTANTS.POINTS_PAID_UPGRADE === 5, `Paid upgrade = 5 pts`)
}

;(async () => {
  try {
    await runTests()
  } catch (err) {
    console.error('\n💥 Test suite crashed:', err)
    fail++
  } finally {
    await cleanup()
    console.log(`\n${'═'.repeat(50)}`)
    console.log(`Results: ${pass} passed, ${fail} failed`)
    if (fail > 0) {
      console.log('\nFailures:')
      failures.forEach((f) => console.log(`  • ${f}`))
      process.exit(1)
    }
    console.log('✨ All tests passed!')
    process.exit(0)
  }
})()
