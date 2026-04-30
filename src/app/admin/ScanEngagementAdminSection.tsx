/**
 * Scan Engagement — answers the 3 questions Pedro asked on 2026-04-30:
 *   1. Quem escaneou continua ativo? (retention comparison)
 *   2. Usa novamente o scan? (repeat-use distribution)
 *   3. Scan aumenta conversão pra pago? (cohort comparison)
 *
 * Pure server component. Reads scan_usage + profiles + tier directly —
 * no RPC needed (queries are simple enough to inline and easy to tweak).
 */
import { createClient as createAdminClient } from '@supabase/supabase-js'

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export default async function ScanEngagementAdminSection() {
  const admin = getAdmin()

  // Pull all the raw signals in parallel — small dataset, no aggregation pain
  const [profilesRes, scanUsageRes] = await Promise.all([
    admin
      .from('profiles')
      .select('id, tier, created_at, last_active, opted_into_campaign_at, excluded_from_campaign'),
    admin
      .from('scan_usage')
      .select('user_id, scan_date, scan_count'),
  ])

  type Profile = {
    id: string
    tier: string | null
    created_at: string | null
    last_active: string | null
    opted_into_campaign_at: string | null
    excluded_from_campaign: boolean | null
  }
  type ScanRow = { user_id: string; scan_date: string; scan_count: number }

  const profiles = ((profilesRes.data || []) as Profile[]).filter((p) => !p.excluded_from_campaign)
  const scanRows = (scanUsageRes.data || []) as ScanRow[]

  // Aggregate per-user scan stats
  const scanByUser = new Map<string, { totalScans: number; distinctDays: Set<string> }>()
  scanRows.forEach((r) => {
    const entry = scanByUser.get(r.user_id) || { totalScans: 0, distinctDays: new Set<string>() }
    entry.totalScans += r.scan_count
    entry.distinctDays.add(r.scan_date)
    scanByUser.set(r.user_id, entry)
  })

  // Cohort: scanners vs non-scanners
  const scanners = profiles.filter((p) => scanByUser.has(p.id))
  const nonScanners = profiles.filter((p) => !scanByUser.has(p.id))

  const now = Date.now()
  const HOUR = 3600 * 1000
  const DAY = 24 * HOUR

  function activePct(group: Profile[], windowMs: number) {
    if (group.length === 0) return 0
    const active = group.filter(
      (p) => p.last_active && new Date(p.last_active).getTime() >= now - windowMs,
    ).length
    return (active / group.length) * 100
  }

  function paidPct(group: Profile[]) {
    if (group.length === 0) return 0
    const paid = group.filter((p) => p.tier && p.tier !== 'free').length
    return (paid / group.length) * 100
  }

  // Distribution: 1 scan, 2-4, 5-9, 10+
  const dist = { one: 0, two_to_four: 0, five_to_nine: 0, ten_plus: 0 }
  scanByUser.forEach((v) => {
    if (v.totalScans === 1) dist.one++
    else if (v.totalScans <= 4) dist.two_to_four++
    else if (v.totalScans <= 9) dist.five_to_nine++
    else dist.ten_plus++
  })

  const multiDayScanners = Array.from(scanByUser.values()).filter((v) => v.distinctDays.size >= 2).length
  const multiDayPct = scanByUser.size > 0 ? (multiDayScanners / scanByUser.size) * 100 : 0

  // Bottleneck funnel: signups → tested scan → returned → paid
  const totalSignups = profiles.length
  const testedScan = scanByUser.size
  const returnedToScan = multiDayScanners
  const paidFromScan = scanners.filter((p) => p.tier && p.tier !== 'free').length
  const paidFromNonScan = nonScanners.filter((p) => p.tier && p.tier !== 'free').length

  return (
    <div>
      <h2 className="text-lg font-semibold mt-8 mb-4" style={{ color: '#0A1628' }}>
        📸 Engajamento do Scan
      </h2>

      {/* Headline metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <AdminStat
          label="Testaram o scan"
          value={`${testedScan}/${totalSignups}`}
          sub={`${pct(testedScan, totalSignups)}% dos cadastros`}
        />
        <AdminStat
          label="Voltaram em outro dia"
          value={`${returnedToScan}/${testedScan}`}
          sub={`${pct(returnedToScan, testedScan)}% dos scanners`}
        />
        <AdminStat
          label="Conv. scanners → pago"
          value={`${paidPct(scanners).toFixed(1)}%`}
          sub={`${paidFromScan} pagantes de ${scanners.length}`}
        />
        <AdminStat
          label="Conv. NÃO-scanners → pago"
          value={`${paidPct(nonScanners).toFixed(1)}%`}
          sub={`${paidFromNonScan} pagantes de ${nonScanners.length}`}
        />
      </div>

      {/* Bottleneck funnel — visual */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">Funil de descoberta do scan</p>
        <FunnelBar label="🆕 Cadastros" count={totalSignups} max={totalSignups} color="bg-gray-400" />
        <FunnelBar label="📸 Testaram o scan" count={testedScan} max={totalSignups}
          conv={pct(testedScan, totalSignups)} color="bg-amber-500" warn={testedScan / totalSignups < 0.3} />
        <FunnelBar label="🔁 Voltaram em outro dia" count={returnedToScan} max={totalSignups}
          conv={pct(returnedToScan, testedScan)} color="bg-orange-500" warn={multiDayPct < 20} />
        <FunnelBar label="💎 Pagaram (vindos do scan)" count={paidFromScan} max={totalSignups}
          conv={pct(paidFromScan, returnedToScan)} color="bg-emerald-500" />
      </div>

      {/* Comparison: cohort retention */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-4">
        <p className="text-sm font-semibold text-gray-700 px-4 py-3 border-b border-gray-200 bg-gray-50">
          Retenção: scanners vs não-scanners
        </p>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Coorte</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Total</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Ativos 24h</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Ativos 7d</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">% Pagantes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr>
              <td className="px-4 py-2 font-medium">📸 Escaneou ≥1x</td>
              <td className="px-4 py-2 text-right font-mono">{scanners.length}</td>
              <td className="px-4 py-2 text-right">{activePct(scanners, DAY).toFixed(1)}%</td>
              <td className="px-4 py-2 text-right">{activePct(scanners, 7 * DAY).toFixed(1)}%</td>
              <td className="px-4 py-2 text-right font-bold text-emerald-600">
                {paidPct(scanners).toFixed(1)}%
              </td>
            </tr>
            <tr>
              <td className="px-4 py-2 font-medium">🚫 Nunca escaneou</td>
              <td className="px-4 py-2 text-right font-mono">{nonScanners.length}</td>
              <td className="px-4 py-2 text-right">{activePct(nonScanners, DAY).toFixed(1)}%</td>
              <td className="px-4 py-2 text-right">{activePct(nonScanners, 7 * DAY).toFixed(1)}%</td>
              <td className="px-4 py-2 text-right">{paidPct(nonScanners).toFixed(1)}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Distribution of scan usage */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">Distribuição: quantos scans por usuário</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <DistTile label="1 scan apenas" value={dist.one} total={scanByUser.size} color="text-red-600" />
          <DistTile label="2 a 4 scans" value={dist.two_to_four} total={scanByUser.size} color="text-amber-600" />
          <DistTile label="5 a 9 scans" value={dist.five_to_nine} total={scanByUser.size} color="text-emerald-600" />
          <DistTile label="10+ scans" value={dist.ten_plus} total={scanByUser.size} color="text-emerald-700" />
        </div>
      </div>
    </div>
  )
}

function AdminStat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <p className="text-2xl font-black text-gray-800">{value}</p>
      <p className="text-[10px] text-gray-500 leading-tight mt-1">{label}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function FunnelBar({
  label, count, max, conv, color, warn,
}: { label: string; count: number; max: number; conv?: string; color: string; warn?: boolean }) {
  const widthPct = max > 0 ? (count / max) * 100 : 0
  return (
    <div className="mb-2 last:mb-0">
      <div className="flex items-baseline justify-between text-xs mb-0.5">
        <span className="text-gray-700">{label}</span>
        <span className="font-mono">
          <strong>{count}</strong>
          {conv !== undefined && (
            <span className={`ml-2 ${warn ? 'text-red-500' : 'text-gray-400'}`}>
              ({conv}%)
            </span>
          )}
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full transition-all duration-500 ${color}`} style={{ width: `${widthPct}%` }} />
      </div>
    </div>
  )
}

function DistTile({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className={`text-xl font-black ${color}`}>{value}</p>
      <p className="text-[10px] text-gray-500 mt-0.5">{label}</p>
      <p className="text-[9px] text-gray-400">{pct(value, total)}%</p>
    </div>
  )
}

function pct(part: number, total: number): string {
  if (total === 0) return '0'
  return ((part / total) * 100).toFixed(1)
}
