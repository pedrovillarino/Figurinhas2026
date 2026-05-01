/**
 * Embaixadores admin section — read-only view of the campaign state.
 *
 * Per Pedro (2026-04-29): admin doesn't need Instagram counter, doesn't need
 * Top 3 export, doesn't need "announce milestone" button. Just:
 *   - Live ranking (this week)
 *   - Total signups via referral
 *   - Total paying signups via referral
 *
 * No client-side interactivity needed (no buttons in S1) — pure server render.
 */
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { TIER_CONFIG, type Tier } from '@/lib/tiers'

const ALBUM_COMPLETABLE_TOTAL = 980

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

type RankingRow = {
  rank: number
  user_id: string
  display_name: string | null
  confirmed_count: number
  paid_upgrade_count: number
  total_points: number
}

type UserStats = {
  tier: Tier
  ownedUnique: number
  scansUsed: number
}

export default async function EmbaixadoresAdminSection() {
  const admin = getAdmin()

  // ── Lifetime totals (since campaign launch) ──
  const [confirmedRes, paidRes, ambassadorsRes, couponsRes, optedInRes, selfUpgradedRes] = await Promise.all([
    admin.from('referral_rewards')
      .select('*', { count: 'exact', head: true })
      .in('status', ['confirmed', 'paid_upgrade']),
    admin.from('referral_rewards')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'paid_upgrade'),
    admin.from('referral_rewards')
      .select('referrer_id')
      .in('status', ['confirmed', 'paid_upgrade']),
    admin.from('discount_codes')
      .select('id, code, restricted_to_user_id, valid_until, times_used, max_uses')
      .eq('created_by', 'referral_program')
      .eq('active', true),
    // Opted-in participants — clicked "Começar a participar"
    admin.from('profiles')
      .select('*', { count: 'exact', head: true })
      .not('opted_into_campaign_at', 'is', null)
      .eq('excluded_from_campaign', false),
    // Self-upgraded users (worth +5 ranking points each)
    admin.from('profiles')
      .select('*', { count: 'exact', head: true })
      .not('self_upgrade_at', 'is', null)
      .not('opted_into_campaign_at', 'is', null)
      .eq('excluded_from_campaign', false),
  ])

  const confirmedTotal = confirmedRes.count ?? 0
  const paidTotal = paidRes.count ?? 0
  const optedInTotal = optedInRes.count ?? 0
  const selfUpgradedTotal = selfUpgradedRes.count ?? 0
  const uniqueAmbassadors = new Set(
    (ambassadorsRes.data || []).map((r) => (r as { referrer_id: string }).referrer_id),
  ).size

  // Coupons: dedupe by code (3 rows per code, one per tier)
  const couponsByCode = new Map<string, { active: boolean; redeemed: boolean }>()
  const now = Date.now()
  ;(couponsRes.data || []).forEach((c) => {
    const cou = c as { code: string; valid_until: string | null; times_used: number; max_uses: number | null }
    const expired = cou.valid_until ? new Date(cou.valid_until).getTime() < now : false
    const redeemed = cou.max_uses !== null && cou.times_used >= cou.max_uses
    const existing = couponsByCode.get(cou.code)
    if (!existing) {
      couponsByCode.set(cou.code, { active: !expired && !redeemed, redeemed })
    } else if (redeemed) {
      // Once redeemed in any tier, mark as redeemed
      couponsByCode.set(cou.code, { active: false, redeemed: true })
    }
  })

  let activeCoupons = 0
  let redeemedCoupons = 0
  couponsByCode.forEach((v) => {
    if (v.active) activeCoupons++
    if (v.redeemed) redeemedCoupons++
  })

  // ── Weekly ranking (top 30) ──
  let ranking: RankingRow[] = []
  try {
    const { data } = await admin.rpc('get_embaixadores_weekly_ranking', {
      p_user_id: null,
      p_limit: 30,
    })
    ranking = (data || []) as RankingRow[]
  } catch (err) {
    console.error('Admin ranking fetch failed:', err)
  }

  // ── Per-user stats for the ranking (admin-only enrichment) ──
  const userStats = new Map<string, UserStats>()
  if (ranking.length > 0) {
    const userIds = ranking.map((r) => r.user_id)
    const [tiersRes, ownedRes, scansRes] = await Promise.all([
      admin.from('profiles').select('id, tier').in('id', userIds),
      admin.from('user_stickers')
        .select('user_id, sticker:stickers!inner(counts_for_completion)')
        .in('user_id', userIds)
        .gt('quantity', 0)
        .eq('sticker.counts_for_completion', true),
      admin.from('scan_usage').select('user_id, scan_count').in('user_id', userIds),
    ])

    for (const id of userIds) userStats.set(id, { tier: 'free', ownedUnique: 0, scansUsed: 0 })

    for (const row of (tiersRes.data || []) as Array<{ id: string; tier: string | null }>) {
      const s = userStats.get(row.id)
      if (s) s.tier = (row.tier || 'free') as Tier
    }
    for (const row of (ownedRes.data || []) as Array<{ user_id: string }>) {
      const s = userStats.get(row.user_id)
      if (s) s.ownedUnique += 1
    }
    for (const row of (scansRes.data || []) as Array<{ user_id: string; scan_count: number | null }>) {
      const s = userStats.get(row.user_id)
      if (s) s.scansUsed += row.scan_count ?? 0
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mt-8 mb-4" style={{ color: '#0A1628' }}>
        🏆 Embaixadores — Campanha de Lançamento
      </h2>

      {/* Counters — top row: participation, bottom row: results */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <AdminStat label="Participantes (opt-in)" value={optedInTotal} sub="clicaram 'Começar a participar'" />
        <AdminStat label="Indicaram alguém" value={uniqueAmbassadors} sub={`${pctOf(uniqueAmbassadors, optedInTotal)}% dos opt-ins`} />
        <AdminStat label="Auto-upgrade" value={selfUpgradedTotal} sub="opt-ins que assinaram (+5 pts)" />
        <AdminStat label="Cadastros via indicação" value={confirmedTotal} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <AdminStat label="Pagantes via indicação" value={paidTotal} sub={`${pctOf(paidTotal, confirmedTotal)}% das indicações`} />
        <AdminStat label="Cupons 50% off ativos" value={activeCoupons} />
        <AdminStat label="Cupons já redimidos" value={redeemedCoupons} />
      </div>

      {/* Cumulative campaign ranking */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <p className="text-sm font-semibold text-gray-700">Ranking da campanha (top 30)</p>
          <p className="text-[10px] text-gray-500">Acumulado desde 29/04 — fecha em 12/05 às 23h59 (BRT)</p>
        </div>
        {ranking.length === 0 ? (
          <p className="text-sm text-gray-500 px-4 py-8 text-center">
            Nenhuma indicação confirmada na campanha ainda.
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {ranking.map((r) => {
              const stats = userStats.get(r.user_id) ?? { tier: 'free' as Tier, ownedUnique: 0, scansUsed: 0 }
              const albumPct = (stats.ownedUnique / ALBUM_COMPLETABLE_TOTAL) * 100
              return (
                <div key={r.user_id} className="flex items-center gap-3 px-4 py-2.5 text-sm flex-wrap">
                  <span className="w-8 text-center font-bold text-gray-500 shrink-0">
                    {r.rank <= 3
                      ? ['🥇', '🥈', '🥉'][r.rank - 1]
                      : `#${r.rank}`}
                  </span>
                  <span className="flex-1 min-w-[140px] truncate text-gray-800">
                    {r.display_name || <span className="text-gray-400">(sem nome)</span>}
                  </span>
                  <TierBadge tier={stats.tier} />
                  <span className="text-[11px] text-gray-600 w-24 text-right tabular-nums" title={`${stats.ownedUnique} de ${ALBUM_COMPLETABLE_TOTAL} coladas`}>
                    {albumPct.toFixed(1)}% álbum
                  </span>
                  <span className="text-[11px] text-gray-600 w-20 text-right tabular-nums">
                    {stats.scansUsed} scans
                  </span>
                  <span className="text-xs text-gray-600 w-20 text-right tabular-nums">
                    {r.confirmed_count} cadastros
                  </span>
                  <span className="text-xs text-amber-700 w-20 text-right font-semibold tabular-nums">
                    {r.paid_upgrade_count} pagantes
                  </span>
                  <span className="font-black text-brand w-16 text-right tabular-nums">{r.total_points} pts</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function TierBadge({ tier }: { tier: Tier }) {
  const styles: Record<Tier, string> = {
    free: 'bg-gray-100 text-gray-600 border-gray-200',
    estreante: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    colecionador: 'bg-amber-50 text-amber-700 border-amber-200',
    copa_completa: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded border w-24 justify-center ${styles[tier]}`}>
      {TIER_CONFIG[tier].label}
    </span>
  )
}

function AdminStat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <p className="text-2xl font-black text-gray-800">{value.toLocaleString('pt-BR')}</p>
      <p className="text-[10px] text-gray-500 leading-tight mt-1">{label}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function pctOf(part: number, total: number): string {
  if (total === 0) return '0'
  return ((part / total) * 100).toFixed(1)
}
