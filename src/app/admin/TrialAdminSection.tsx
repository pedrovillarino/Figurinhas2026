/**
 * Trial Admin Section — funnel do trial-paywall.
 *
 * Read-only. Métricas derivadas direto da tabela profiles (sem precisar
 * de funnel_events novos). Pedro 21/05/2026.
 *
 * Estados rastreados (ver lib/trial.ts):
 *   - trial_active: trial_starts_at IS NOT NULL AND trial_ends_at > NOW
 *   - expired: tier='free' AND trial_ends_at < NOW AND !is_grandfathered_free
 *   - converted: tier != 'free' AND trial_starts_at IS NOT NULL
 *   - grandfathered: is_grandfathered_free = true (legacy free permanente)
 *
 * Conversion rate = converted / (trial_active + expired + converted)
 * Excluí grandfathered (não estão no funil novo).
 */
import { createClient as createAdminClient } from '@supabase/supabase-js'

const DAY_MS = 24 * 60 * 60 * 1000

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

type ExpiringSoon = {
  id: string
  display_name: string | null
  trial_ends_at: string
  phone: string | null
  trial_expired_notified_at: string | null
}

export default async function TrialAdminSection() {
  const admin = getAdmin()
  const now = new Date()
  const nowIso = now.toISOString()
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString()
  const next3Days = new Date(now.getTime() + 3 * DAY_MS).toISOString()

  // ── Queries em paralelo ──
  const [
    activeRes,
    expiredRes,
    convertedRes,
    grandfatheredRes,
    starts7dRes,
    convs7dRes,
    expiringSoonRes,
  ] = await Promise.all([
    // Trial ativo agora
    admin.from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('tier', 'free')
      .eq('is_grandfathered_free', false)
      .not('trial_ends_at', 'is', null)
      .gt('trial_ends_at', nowIso),
    // Expirou sem assinar
    admin.from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('tier', 'free')
      .eq('is_grandfathered_free', false)
      .not('trial_ends_at', 'is', null)
      .lt('trial_ends_at', nowIso),
    // Converteu (assinou — tier != 'free' E tem trial_starts_at, ou seja, ENTROU em trial antes)
    admin.from('profiles')
      .select('*', { count: 'exact', head: true })
      .neq('tier', 'free')
      .not('trial_starts_at', 'is', null),
    // Grandfathered (legacy free permanente, fora do funil)
    admin.from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('is_grandfathered_free', true),
    // Novos trials últimos 7d (pra sparkline)
    admin.from('profiles')
      .select('trial_starts_at')
      .not('trial_starts_at', 'is', null)
      .gte('trial_starts_at', sevenDaysAgo),
    // Conversões (= upgrades de quem veio do trial) últimos 7d
    admin.from('profiles')
      .select('upgraded_at')
      .neq('tier', 'free')
      .not('trial_starts_at', 'is', null)
      .not('upgraded_at', 'is', null)
      .gte('upgraded_at', sevenDaysAgo),
    // Próximos 10 a expirar (next 3 days)
    admin.from('profiles')
      .select('id, display_name, trial_ends_at, phone, trial_expired_notified_at')
      .eq('tier', 'free')
      .eq('is_grandfathered_free', false)
      .not('trial_ends_at', 'is', null)
      .gt('trial_ends_at', nowIso)
      .lt('trial_ends_at', next3Days)
      .order('trial_ends_at', { ascending: true })
      .limit(10),
  ])

  const trialActive = activeRes.count ?? 0
  const expired = expiredRes.count ?? 0
  const converted = convertedRes.count ?? 0
  const grandfathered = grandfatheredRes.count ?? 0

  // Conversion rate sobre o universo trial (exclui legacy)
  const trialUniverse = trialActive + expired + converted
  const conversionRate = trialUniverse === 0 ? 0 : (converted / trialUniverse) * 100

  // Sparklines 7d
  const startsByDay = bucketByDate(
    (starts7dRes.data || []).map((r) => (r as { trial_starts_at: string }).trial_starts_at),
    7,
  )
  const convsByDay = bucketByDate(
    (convs7dRes.data || []).map((r) => (r as { upgraded_at: string }).upgraded_at),
    7,
  )

  const expiringSoon = (expiringSoonRes.data || []) as ExpiringSoon[]

  return (
    <div>
      <h2 className="text-lg font-semibold mt-8 mb-4" style={{ color: '#0A1628' }}>
        🎁 Trial Funnel (paywall híbrido)
      </h2>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        <AdminStat label="Em trial agora" value={trialActive} color="bg-emerald-50" />
        <AdminStat label="Expirou sem assinar" value={expired} color="bg-red-50" />
        <AdminStat label="Converteu (pagou)" value={converted} color="bg-amber-50" />
        <AdminStat
          label="Taxa de conversão"
          value={`${conversionRate.toFixed(1)}%`}
          sub={`${converted}/${trialUniverse} no funil`}
          color="bg-blue-50"
        />
        <AdminStat label="Legacy grandfathered" value={grandfathered} sub="fora do funil (free permanente)" />
      </div>

      {/* ── Sparklines ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <SparkCard label="Novos trials / dia (7d)" buckets={startsByDay} color="#00C896" />
        <SparkCard label="Conversões / dia (7d)" buckets={convsByDay} color="#FFB800" />
      </div>

      {/* ── Próximos a expirar ── */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <p className="text-sm font-semibold text-gray-700">Próximos a expirar (3 dias)</p>
          <p className="text-[10px] text-gray-500">
            Cron <code>trial-expiry-notif</code> notifica via WhatsApp 24h antes (idempotente).
          </p>
        </div>
        {expiringSoon.length === 0 ? (
          <p className="text-sm text-gray-500 px-4 py-8 text-center">
            Nenhum trial expirando nos próximos 3 dias.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-gray-500 bg-gray-50/40">
                <th className="px-4 py-2 font-medium">User</th>
                <th className="px-4 py-2 font-medium">Tem phone?</th>
                <th className="px-4 py-2 font-medium">Já notificado?</th>
                <th className="px-4 py-2 font-medium text-right">Expira em</th>
              </tr>
            </thead>
            <tbody>
              {expiringSoon.map((u) => {
                const hoursLeft = Math.max(
                  0,
                  Math.round((new Date(u.trial_ends_at).getTime() - now.getTime()) / (60 * 60 * 1000)),
                )
                const isUrgent = hoursLeft <= 24
                return (
                  <tr key={u.id} className="border-t border-gray-100">
                    <td className="px-4 py-2 text-gray-700 truncate max-w-[160px]">
                      {u.display_name || <span className="text-gray-400">(sem nome)</span>}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {u.phone ? <span className="text-emerald-700">✓</span> : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {u.trial_expired_notified_at
                        ? <span className="text-blue-700" title={u.trial_expired_notified_at}>✓</span>
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className={`px-4 py-2 text-right tabular-nums font-bold ${isUrgent ? 'text-red-600' : 'text-gray-700'}`}>
                      {hoursLeft}h
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ─── Helpers ───

function bucketByDate(timestamps: string[], days: number): number[] {
  const labels = Array.from({ length: days }, (_, i) => {
    const d = new Date()
    d.setUTCHours(0, 0, 0, 0)
    d.setUTCDate(d.getUTCDate() - (days - 1 - i))
    return d.toISOString().split('T')[0]
  })
  const indexByDate = new Map(labels.map((label, i) => [label, i]))
  const buckets = new Array(days).fill(0)
  for (const ts of timestamps) {
    const day = ts.slice(0, 10)
    const idx = indexByDate.get(day)
    if (idx !== undefined) buckets[idx]++
  }
  return buckets
}

function AdminStat({
  label,
  value,
  sub,
  color = 'bg-white',
}: {
  label: string
  value: number | string
  sub?: string
  color?: string
}) {
  const display = typeof value === 'number' ? value.toLocaleString('pt-BR') : value
  return (
    <div className={`${color} rounded-lg border border-gray-200 p-3`}>
      <p className="text-2xl font-black text-gray-800 truncate">{display}</p>
      <p className="text-[10px] text-gray-500 leading-tight mt-1">{label}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function SparkCard({ label, buckets, color }: { label: string; buckets: number[]; color: string }) {
  const total = buckets.reduce((s, v) => s + v, 0)
  const max = Math.max(...buckets, 1)
  const width = 240
  const height = 40
  const barW = width / buckets.length
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
        <p className="text-xs font-bold text-gray-800 tabular-nums">{total}</p>
      </div>
      <svg viewBox={`0 0 ${width} ${height + 12}`} preserveAspectRatio="none" className="w-full h-12">
        {buckets.map((v, i) => {
          const h = (v / max) * height
          const x = i * barW
          const y = height - h
          return (
            <rect
              key={i}
              x={x + 0.5}
              y={y}
              width={Math.max(barW - 1, 1)}
              height={h}
              fill={color}
              opacity={v === 0 ? 0.15 : 0.95}
              rx={1}
            >
              <title>{`${v}`}</title>
            </rect>
          )
        })}
        <text x={0} y={height + 10} fontSize={8} fill="#9CA3AF">
          7d atrás
        </text>
        <text x={width} y={height + 10} fontSize={8} fill="#9CA3AF" textAnchor="end">
          hoje
        </text>
      </svg>
    </div>
  )
}
