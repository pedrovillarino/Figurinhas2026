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

export default async function EmbaixadoresAdminSection() {
  const admin = getAdmin()

  // ── Lifetime totals (since campaign launch) ──
  const [confirmedRes, paidRes, ambassadorsRes, couponsRes] = await Promise.all([
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
  ])

  const confirmedTotal = confirmedRes.count ?? 0
  const paidTotal = paidRes.count ?? 0
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

  return (
    <div>
      <h2 className="text-lg font-semibold mt-8 mb-4" style={{ color: '#0A1628' }}>
        🏆 Embaixadores — Campanha de Lançamento
      </h2>

      {/* Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <AdminStat label="Embaixadores ativos" value={uniqueAmbassadors} />
        <AdminStat label="Cadastros via indicação" value={confirmedTotal} />
        <AdminStat label="Pagantes via indicação" value={paidTotal} sub={`${pctOf(paidTotal, confirmedTotal)}% conversão`} />
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
            {ranking.map((r) => (
              <div key={r.user_id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-8 text-center font-bold text-gray-500">
                  {r.rank <= 3
                    ? ['🥇', '🥈', '🥉'][r.rank - 1]
                    : `#${r.rank}`}
                </span>
                <span className="flex-1 truncate text-gray-800">
                  {r.display_name || <span className="text-gray-400">(sem nome)</span>}
                </span>
                <span className="text-[10px] text-gray-500 font-mono">
                  {r.user_id.slice(0, 8)}…
                </span>
                <span className="text-xs text-gray-600 w-20 text-right">
                  {r.confirmed_count} cadastros
                </span>
                <span className="text-xs text-amber-700 w-20 text-right font-semibold">
                  {r.paid_upgrade_count} pagantes
                </span>
                <span className="font-black text-brand w-16 text-right">{r.total_points} pts</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
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
