import { createClient } from '@supabase/supabase-js'
import { TIER_CONFIG, type Tier } from '@/lib/tiers'
import EmbaixadoresAdminSection from './EmbaixadoresAdminSection'
import FunnelAdminSection from './FunnelAdminSection'
import ScanEngagementAdminSection from './ScanEngagementAdminSection'
import AudioEngagementAdminSection from './AudioEngagementAdminSection'
import ScanFeedbackAdminSection from './ScanFeedbackAdminSection'
import SupportAdminSection from './SupportAdminSection'
import NotificationsAdminSection from './NotificationsAdminSection'

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'completeai2026'

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// ─── Data fetchers ───

async function getHealthCheck() {
  try {
    const start = Date.now()
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br'}/api/health`, {
      cache: 'no-store',
    })
    const data = await res.json()
    return { ...data, fetch_ms: Date.now() - start }
  } catch {
    return { status: 'unreachable', checks: {}, latency_ms: 0, fetch_ms: 0 }
  }
}

async function getWhatsAppHealth() {
  try {
    const cronSecret = process.env.CRON_SECRET
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br'}/api/whatsapp/health`,
      {
        cache: 'no-store',
        headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {},
      },
    )
    return await res.json()
  } catch {
    return { ok: false, whatsapp: { connected: false }, error: 'unreachable' }
  }
}

// ─── Time-series helpers ───

const DAY_MS = 24 * 60 * 60 * 1000

function dateLabels(days: number): string[] {
  const now = new Date()
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(now)
    d.setUTCHours(0, 0, 0, 0)
    d.setUTCDate(d.getUTCDate() - (days - 1 - i))
    return d.toISOString().split('T')[0]
  })
}

function bucketByCreatedAt(items: { created_at: string }[], days: number): number[] {
  const labels = dateLabels(days)
  const indexByDate = new Map(labels.map((label, i) => [label, i]))
  const buckets = new Array(days).fill(0)
  for (const item of items) {
    const dayKey = item.created_at.slice(0, 10)
    const idx = indexByDate.get(dayKey)
    if (idx !== undefined) buckets[idx]++
  }
  return buckets
}

function bucketScansByDate(items: { scan_date: string; scan_count: number }[], days: number): number[] {
  const labels = dateLabels(days)
  const indexByDate = new Map(labels.map((label, i) => [label, i]))
  const buckets = new Array(days).fill(0)
  for (const item of items) {
    const idx = indexByDate.get(item.scan_date)
    if (idx !== undefined) buckets[idx] += item.scan_count
  }
  return buckets
}

function sumRange(buckets: number[], from: number, count: number): number {
  return buckets.slice(from, from + count).reduce((s, v) => s + v, 0)
}

async function getEvolutionMetrics() {
  const sb = supabaseAdmin()
  const thirtyDaysAgo = new Date(Date.now() - 30 * DAY_MS).toISOString()
  const thirtyDaysAgoStr = thirtyDaysAgo.split('T')[0]

  const [signupsRes, scansRes, tradesRes] = await Promise.all([
    sb.from('profiles').select('created_at').gte('created_at', thirtyDaysAgo),
    sb.from('scan_usage').select('scan_date, scan_count').gte('scan_date', thirtyDaysAgoStr),
    sb.from('trade_requests').select('created_at').gte('created_at', thirtyDaysAgo),
  ])

  const signupsBuckets = bucketByCreatedAt(signupsRes.data ?? [], 30)
  const scansBuckets = bucketScansByDate(scansRes.data ?? [], 30)
  const tradesBuckets = bucketByCreatedAt(tradesRes.data ?? [], 30)

  // Week-over-week: [23..29] = this week, [16..22] = last week
  const wow = (b: number[]) => ({
    thisWeek: sumRange(b, 23, 7),
    lastWeek: sumRange(b, 16, 7),
  })

  return {
    signups: { buckets: signupsBuckets, ...wow(signupsBuckets) },
    scans: { buckets: scansBuckets, ...wow(scansBuckets) },
    trades: { buckets: tradesBuckets, ...wow(tradesBuckets) },
  }
}

async function getScanAccuracy() {
  const sb = supabaseAdmin()
  const sevenDaysAgo = new Date(Date.now() - 7 * DAY_MS).toISOString()

  const [scansRes, rejectedRes] = await Promise.all([
    sb.from('scan_results')
      .select('gemini_detected, matched_count, user_confirmed_count, model_used, image_quality')
      .gte('created_at', sevenDaysAgo),
    // Pull every rejected_sticker_ids array from the last 7 days so we can
    // unnest + count client-side. Cap at 1000 rows for safety on large sets.
    sb.from('scan_results')
      .select('rejected_sticker_ids')
      .gte('created_at', sevenDaysAgo)
      .not('rejected_sticker_ids', 'is', null)
      .limit(1000),
  ])

  // Aggregate rejections per sticker and join player names from stickers table.
  const rejectionCounts = new Map<number, number>()
  for (const row of (rejectedRes.data ?? []) as Array<{ rejected_sticker_ids: number[] | null }>) {
    for (const sid of row.rejected_sticker_ids ?? []) {
      rejectionCounts.set(sid, (rejectionCounts.get(sid) ?? 0) + 1)
    }
  }
  const topIds = Array.from(rejectionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
  let topRejected: Array<{ sticker_id: number; rejections: number; player_name: string | null; number: string }> = []
  if (topIds.length > 0) {
    const { data: stickerInfo } = await sb
      .from('stickers')
      .select('id, number, player_name')
      .in('id', topIds.map(([id]) => id))
    const byId = new Map((stickerInfo ?? []).map((s) => [s.id, s]))
    topRejected = topIds.map(([id, count]) => ({
      sticker_id: id,
      rejections: count,
      player_name: byId.get(id)?.player_name ?? null,
      number: byId.get(id)?.number ?? `#${id}`,
    }))
  }

  const rows = scansRes.data ?? []
  const total = rows.length
  const detected = rows.reduce((sum, r) => sum + (r.gemini_detected || 0), 0)
  const matched = rows.reduce((sum, r) => sum + (r.matched_count || 0), 0)
  const confirmed = rows
    .filter((r) => r.user_confirmed_count !== null && r.user_confirmed_count !== undefined)
    .reduce((sum, r) => sum + (r.user_confirmed_count || 0), 0)
  const confirmable = rows
    .filter((r) => r.user_confirmed_count !== null && r.user_confirmed_count !== undefined)
    .reduce((sum, r) => sum + (r.matched_count || 0), 0)

  const matchRate = detected > 0 ? Math.round((matched / detected) * 100) : 0
  const confirmRate = confirmable > 0 ? Math.round((confirmed / confirmable) * 100) : 0

  // Quality breakdown
  const byQuality: Record<string, number> = { high: 0, medium: 0, low: 0 }
  rows.forEach((r) => {
    const q = (r.image_quality || 'high') as string
    byQuality[q] = (byQuality[q] || 0) + 1
  })

  return {
    totalScans: total,
    detected,
    matched,
    confirmed,
    matchRate,
    confirmRate,
    byQuality,
    topRejected,
  }
}

async function getGeoDistribution() {
  const sb = supabaseAdmin()
  const { data, error } = await sb
    .from('profiles')
    .select('city, state')
  if (error || !data) return { cities: [], withCity: 0, withoutCity: 0 }

  const counts = new Map<string, { city: string; state: string; users: number }>()
  let withCity = 0
  let withoutCity = 0
  for (const row of data as { city: string | null; state: string | null }[]) {
    if (!row.city) {
      withoutCity++
      continue
    }
    withCity++
    const key = `${row.city}|${row.state ?? ''}`
    const existing = counts.get(key)
    if (existing) {
      existing.users++
    } else {
      counts.set(key, { city: row.city, state: row.state ?? '', users: 1 })
    }
  }
  const cities = Array.from(counts.values()).sort(
    (a, b) => b.users - a.users || a.city.localeCompare(b.city, 'pt-BR'),
  )
  return { cities, withCity, withoutCity }
}

/**
 * Returns the ISO timestamp of midnight today in BRT (São Paulo timezone),
 * expressed in UTC. BRT is UTC-3 (no DST since 2019).
 *
 * Why: the admin counts "scans hoje" but `scan_usage.scan_date` is stored
 * in UTC (because Postgres CURRENT_DATE runs in UTC). Using UTC as "today"
 * makes the counter zero out at 21h BRT instead of midnight BRT, which is
 * confusing for the Brazilian operator. This helper lets the admin filter
 * by the actual BRT day boundary using `last_scan_at >= startOfDayBrt()`.
 */
function startOfDayBrtAsUtc(): Date {
  const now = new Date()
  // Shift by BRT offset (-3h) to get a Date whose UTC components match BRT
  // wall-clock components.
  const brtView = new Date(now.getTime() - 3 * 60 * 60 * 1000)
  // Build "midnight BRT" = "03:00 UTC of that BRT-date"
  return new Date(Date.UTC(
    brtView.getUTCFullYear(),
    brtView.getUTCMonth(),
    brtView.getUTCDate(),
    3, 0, 0, 0,
  ))
}

async function getMetrics() {
  const sb = supabaseAdmin()
  const now = new Date()
  const startOfDayBrt = startOfDayBrtAsUtc()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // Run all queries in parallel
  const [
    totalUsersRes,
    tierCountsRes,
    scansTodayRes,
    tradesCompletedRes,
    signups7dRes,
    scans7dRes,
    trades7dRes,
    pendingTradesRes,
    rejectedTradesRes,
    expiredTradesRes,
    topScannersRes,
  ] = await Promise.all([
    // Total users
    sb.from('profiles').select('id', { count: 'exact', head: true }),

    // Users by tier
    sb.from('profiles').select('tier'),

    // Scans today (BRT) — usa last_scan_at em vez de scan_date pra alinhar
    // o "hoje" com a meia-noite BRT (e não UTC). Aproximação: conta scan_count
    // de toda row cujo último scan foi após meia-noite BRT. Pode haver pequena
    // imprecisão se a row cruza o boundary BRT, mas é melhor que UTC pro user.
    sb.from('scan_usage')
      .select('scan_count')
      .gte('last_scan_at', startOfDayBrt.toISOString()),

    // Trades completed (approved)
    sb.from('trade_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'approved'),

    // New signups last 7 days
    sb.from('profiles')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sevenDaysAgo),

    // Scans last 7 days
    sb.from('scan_usage')
      .select('scan_count')
      .gte('scan_date', new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]),

    // Trade requests last 7 days
    sb.from('trade_requests')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sevenDaysAgo),

    // Pending trades
    sb.from('trade_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),

    // Rejected trades
    sb.from('trade_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'rejected'),

    // Expired trades
    sb.from('trade_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'expired'),

    // Top scanners today (BRT) — mesma lógica do "scans today"
    sb.from('scan_usage')
      .select('user_id, scan_count')
      .gte('last_scan_at', startOfDayBrt.toISOString())
      .order('scan_count', { ascending: false })
      .limit(5),
  ])

  // Pedro 2026-05-03: DAU/WAU/MAU via RPC (qualquer evento conta).
  type ActiveMetrics = { dau: number; wau: number; mau: number; total_30d: number; total_users: number }
  let activeMetrics: ActiveMetrics = { dau: 0, wau: 0, mau: 0, total_30d: 0, total_users: 0 }
  try {
    const { data, error } = await sb.rpc('get_active_users_metrics')
    if (!error && data) activeMetrics = data as ActiveMetrics
  } catch (err) {
    console.error('Active metrics fetch failed:', err)
  }

  // Process tier counts
  const tierCounts: Record<string, number> = { free: 0, estreante: 0, colecionador: 0, copa_completa: 0 }
  if (tierCountsRes.data) {
    for (const row of tierCountsRes.data) {
      const t = (row as { tier: string }).tier || 'free'
      tierCounts[t] = (tierCounts[t] || 0) + 1
    }
  }

  // Revenue estimate
  const revenue =
    tierCounts.estreante * (TIER_CONFIG.estreante.priceBrl / 100) +
    tierCounts.colecionador * (TIER_CONFIG.colecionador.priceBrl / 100) +
    tierCounts.copa_completa * (TIER_CONFIG.copa_completa.priceBrl / 100)

  // Sum scans today
  const scansToday = scansTodayRes.data
    ? scansTodayRes.data.reduce((sum: number, r: { scan_count: number }) => sum + r.scan_count, 0)
    : 0

  // Sum scans 7d
  const scans7d = scans7dRes.data
    ? scans7dRes.data.reduce((sum: number, r: { scan_count: number }) => sum + r.scan_count, 0)
    : 0

  // Enrich top scanners with tier + display_name from profiles in one extra query.
  const topScannerRows = (topScannersRes.data ?? []) as Array<{ user_id: string; scan_count: number }>
  let topScanners: Array<{ user_id: string; scan_count: number; tier: string; display_name: string | null }> = []
  if (topScannerRows.length > 0) {
    const { data: scannerProfiles } = await sb
      .from('profiles')
      .select('id, tier, display_name')
      .in('id', topScannerRows.map((r) => r.user_id))
    const byId = new Map((scannerProfiles ?? []).map((p) => [p.id, p]))
    topScanners = topScannerRows.map((r) => ({
      user_id: r.user_id,
      scan_count: r.scan_count,
      tier: (byId.get(r.user_id)?.tier as string) || 'free',
      display_name: byId.get(r.user_id)?.display_name ?? null,
    }))
  }

  return {
    totalUsers: totalUsersRes.count ?? 0,
    tierCounts,
    scansToday,
    tradesCompleted: tradesCompletedRes.count ?? 0,
    revenue,
    signups7d: signups7dRes.count ?? 0,
    scans7d,
    trades7d: trades7dRes.count ?? 0,
    pendingTrades: pendingTradesRes.count ?? 0,
    rejectedTrades: rejectedTradesRes.count ?? 0,
    expiredTrades: expiredTradesRes.count ?? 0,
    topScanners,
    activeMetrics,
  }
}

// ─── Components ───

function StatCard({ label, value, sub, color = 'bg-white' }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className={`${color} rounded-xl shadow-sm border border-gray-200 p-5`}>
      <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-bold mt-1" style={{ color: '#0A1628' }}>{value}</p>
      {sub && <p className="text-sm text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

function TierBadge({ tier, count }: { tier: string; count: number }) {
  const colors: Record<string, string> = {
    free: 'bg-gray-100 text-gray-700',
    estreante: 'bg-green-50 text-green-700',
    colecionador: 'bg-amber-50 text-amber-700',
    copa_completa: 'bg-indigo-50 text-indigo-700',
  }
  const labels: Record<string, string> = {
    free: 'Free',
    estreante: 'Estreante',
    colecionador: 'Colecionador',
    copa_completa: 'Copa Completa',
  }
  return (
    <div className={`${colors[tier] || 'bg-gray-100 text-gray-700'} rounded-lg px-4 py-3 flex items-center justify-between`}>
      <span className="font-medium text-sm">{labels[tier] || tier}</span>
      <span className="text-2xl font-bold">{count}</span>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold mt-8 mb-4" style={{ color: '#0A1628' }}>{children}</h2>
}

function WoWCard({
  label,
  thisWeek,
  lastWeek,
  buckets,
  color,
}: {
  label: string
  thisWeek: number
  lastWeek: number
  buckets: number[]
  color: string
}) {
  const delta = lastWeek === 0 ? (thisWeek > 0 ? 100 : 0) : ((thisWeek - lastWeek) / lastWeek) * 100
  const positive = delta >= 0
  const arrow = positive ? '▲' : '▼'
  const deltaColor = positive ? 'text-emerald-600' : 'text-red-500'
  const deltaText = lastWeek === 0 && thisWeek === 0 ? '—' : `${arrow} ${Math.abs(delta).toFixed(0)}%`
  const compareText = lastWeek === 0 && thisWeek === 0 ? 'sem dados' : `vs ${lastWeek} sem. anterior`

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">{label}</p>
        <span className={`text-xs font-bold ${deltaColor}`}>{deltaText}</span>
      </div>
      <p className="text-3xl font-bold" style={{ color: '#0A1628' }}>{thisWeek}</p>
      <p className="text-xs text-gray-400 mb-3">esta semana · {compareText}</p>
      <TimeChart buckets={buckets} color={color} />
    </div>
  )
}

function TimeChart({ buckets, color }: { buckets: number[]; color: string }) {
  const max = Math.max(...buckets, 1)
  const width = 280
  const height = 50
  const barW = width / buckets.length
  const labels = dateLabels(buckets.length)

  return (
    <svg viewBox={`0 0 ${width} ${height + 14}`} preserveAspectRatio="none" className="w-full h-16">
      {buckets.map((v, i) => {
        const h = (v / max) * height
        const x = i * barW
        const y = height - h
        const dateLabel = labels[i]
        const dayPart = dateLabel.split('-').slice(1).reverse().join('/')
        return (
          <g key={i}>
            <rect
              x={x + 0.5}
              y={y}
              width={Math.max(barW - 1, 1)}
              height={h}
              fill={color}
              opacity={v === 0 ? 0.15 : 0.95}
              rx={1}
            >
              <title>{`${dayPart}: ${v}`}</title>
            </rect>
          </g>
        )
      })}
      <text x={0} y={height + 12} fontSize={9} fill="#9CA3AF">
        {labels[0].split('-').slice(1).reverse().join('/')}
      </text>
      <text x={width} y={height + 12} fontSize={9} fill="#9CA3AF" textAnchor="end">
        hoje
      </text>
    </svg>
  )
}

// ─── Login form ───

function LoginForm() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm text-center">
        <h1 className="text-xl font-bold mb-1" style={{ color: '#0A1628' }}>Complete Aí</h1>
        <p className="text-gray-400 text-sm mb-6">Painel Administrativo</p>
        <form method="GET">
          <input
            type="password"
            name="secret"
            placeholder="Senha de acesso"
            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00C896] mb-4"
            autoFocus
          />
          <button
            type="submit"
            className="w-full text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
            style={{ backgroundColor: '#00C896' }}
          >
            Entrar
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Page ───

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function AdminPage({
  searchParams,
}: {
  searchParams: { secret?: string; days?: string }
}) {
  // Auth check
  if (searchParams.secret !== ADMIN_SECRET) {
    return <LoginForm />
  }

  // Funnel window — defaults to 30 days, overridable via ?days=N
  const funnelDays = (() => {
    const n = parseInt(searchParams.days || '30', 10)
    return Number.isFinite(n) && n >= 1 && n <= 365 ? n : 30
  })()

  const [m, health, waHealth, evo, geo, scanAcc] = await Promise.all([
    getMetrics(),
    getHealthCheck(),
    getWhatsAppHealth(),
    getEvolutionMetrics(),
    getGeoDistribution(),
    getScanAccuracy(),
  ])

  const refreshUrl = `/admin?secret=${ADMIN_SECRET}`

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#0A1628' }}>
            Complete Aí <span className="text-gray-400 font-normal">— Admin</span>
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Atualizado em {new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
          </p>
        </div>
        <a
          href={refreshUrl}
          className="text-sm font-medium px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 transition-colors"
          style={{ color: '#0A1628' }}
        >
          Atualizar
        </a>
      </div>

      {/* Big Numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard label="Usuarios totais" value={m.totalUsers} />
        <StatCard label="Scans hoje" value={m.scansToday} />
        <StatCard label="Trocas aprovadas" value={m.tradesCompleted} />
        <StatCard label="Pagantes" value={m.tierCounts.estreante + m.tierCounts.colecionador + m.tierCounts.copa_completa} />
        <StatCard
          label="Receita estimada"
          value={`R$${m.revenue.toFixed(2).replace('.', ',')}`}
          sub="mensal"
        />
      </div>

      {/* Pedro 2026-05-03: Usuários ativos (DAU/WAU/MAU) — qualquer evento.
          Mostra % do total cadastrado e absoluto. Sweet spot: WAU/MAU acima
          de 50% indica boa retenção. */}
      <SectionTitle>Usuarios ativos (qualquer evento)</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          label="Ativos hoje (DAU)"
          value={m.activeMetrics.dau}
          sub={m.activeMetrics.total_users > 0 ? `${Math.round((m.activeMetrics.dau / m.activeMetrics.total_users) * 100)}% dos cadastrados` : undefined}
        />
        <StatCard
          label="Ativos 7d (WAU)"
          value={m.activeMetrics.wau}
          sub={m.activeMetrics.total_users > 0 ? `${Math.round((m.activeMetrics.wau / m.activeMetrics.total_users) * 100)}% dos cadastrados` : undefined}
        />
        <StatCard
          label="Ativos 30d (MAU)"
          value={m.activeMetrics.mau}
          sub={m.activeMetrics.total_users > 0 ? `${Math.round((m.activeMetrics.mau / m.activeMetrics.total_users) * 100)}% dos cadastrados` : undefined}
        />
        <StatCard
          label="Stickiness (DAU/MAU)"
          value={m.activeMetrics.mau > 0 ? `${Math.round((m.activeMetrics.dau / m.activeMetrics.mau) * 100)}%` : '—'}
          sub="ideal: >20%"
        />
      </div>

      {/* Suporte — escalations do bot WhatsApp pro time de atendimento humano */}
      <SupportAdminSection />

      {/* Conversion funnel — answers "are users converting Free → Paid?" */}
      <FunnelAdminSection days={funnelDays} />

      {/* Scan engagement — answers "is scan driving conversion / repeat use?" */}
      <ScanEngagementAdminSection />

      {/* Audio engagement — espelho do scan, mas pra áudio (Pedro 2026-05-03) */}
      <AudioEngagementAdminSection />

      {/* Scan feedback — perceived quality of the scan feature (👍/👎 + comments) */}
      <ScanFeedbackAdminSection />

      {/* Embaixadores campaign — read-only summary (ranking + counters) */}
      <EmbaixadoresAdminSection />

      {/* Pedro 2026-05-03: Notificações automáticas — histórico + taxa de
          volta 24h por tipo. Útil pra ver se as notificações estão
          gerando engajamento ou virando ruído. */}
      <NotificationsAdminSection />

      {/* Tier breakdown */}
      <SectionTitle>Usuarios por plano</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(['free', 'estreante', 'colecionador', 'copa_completa'] as const).map((tier) => (
          <TierBadge key={tier} tier={tier} count={m.tierCounts[tier]} />
        ))}
      </div>

      {/* Activity - last 7 days */}
      <SectionTitle>Atividade (ultimos 7 dias)</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Novos cadastros" value={m.signups7d} />
        <StatCard label="Total de scans" value={m.scans7d} />
        <StatCard label="Pedidos de troca" value={m.trades7d} />
      </div>

      {/* Evolution - last 30 days + WoW */}
      <SectionTitle>Evolucao (ultimos 30 dias)</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <WoWCard
          label="Cadastros"
          thisWeek={evo.signups.thisWeek}
          lastWeek={evo.signups.lastWeek}
          buckets={evo.signups.buckets}
          color="#00C896"
        />
        <WoWCard
          label="Scans"
          thisWeek={evo.scans.thisWeek}
          lastWeek={evo.scans.lastWeek}
          buckets={evo.scans.buckets}
          color="#FFB800"
        />
        <WoWCard
          label="Pedidos de troca"
          thisWeek={evo.trades.thisWeek}
          lastWeek={evo.trades.lastWeek}
          buckets={evo.trades.buckets}
          color="#0A1628"
        />
      </div>

      {/* Health / Status */}
      <SectionTitle>Saude e status</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Trocas pendentes"
          value={m.pendingTrades}
          sub="aguardando resposta"
        />
        <StatCard
          label="Trocas rejeitadas"
          value={m.rejectedTrades}
          sub="total historico"
        />
        <StatCard
          label="Trocas expiradas"
          value={m.expiredTrades}
          sub="sem resposta em 72h"
        />
      </div>

      {/* Top scanners today */}
      {m.topScanners.length > 0 && (
        <>
          <SectionTitle>Top scanners hoje</SectionTitle>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-4 py-3 font-medium text-gray-500">#</th>
                  <th className="px-4 py-3 font-medium text-gray-500">Usuario</th>
                  <th className="px-4 py-3 font-medium text-gray-500">Plano</th>
                  <th className="px-4 py-3 font-medium text-gray-500 text-right">Scans</th>
                </tr>
              </thead>
              <tbody>
                {m.topScanners.map((s, i) => {
                  const tierColors: Record<string, string> = {
                    free: 'bg-gray-100 text-gray-600',
                    estreante: 'bg-green-50 text-green-700',
                    colecionador: 'bg-amber-50 text-amber-700',
                    copa_completa: 'bg-indigo-50 text-indigo-700',
                  }
                  const tierLabels: Record<string, string> = {
                    free: 'Free',
                    estreante: 'Estreante',
                    colecionador: 'Colecionador',
                    copa_completa: 'Copa Completa',
                  }
                  return (
                    <tr key={s.user_id} className="border-t border-gray-100">
                      <td className="px-4 py-2.5 text-gray-400">{i + 1}</td>
                      <td className="px-4 py-2.5 text-xs">
                        <div className="font-medium text-gray-700">{s.display_name || '—'}</div>
                        <div className="font-mono text-[10px] text-gray-400">{s.user_id.slice(0, 8)}...</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${tierColors[s.tier] || tierColors.free}`}>
                          {tierLabels[s.tier] || s.tier}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold">{s.scan_count}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Scan accuracy (last 7 days) */}
      <SectionTitle>Acuracia do scan (ultimos 7 dias)</SectionTitle>
      {scanAcc.totalScans === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 text-sm text-gray-400">
          Sem scans nos ultimos 7 dias.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Scans 7d" value={scanAcc.totalScans} />
            <StatCard
              label="Match rate"
              value={`${scanAcc.matchRate}%`}
              sub={`${scanAcc.matched}/${scanAcc.detected} detectadas`}
            />
            <StatCard
              label="Confirmadas"
              value={`${scanAcc.confirmRate}%`}
              sub={`apos clique em salvar`}
            />
            <StatCard
              label="Qualidade"
              value={`${scanAcc.byQuality.high}/${scanAcc.byQuality.medium}/${scanAcc.byQuality.low}`}
              sub="alta / media / baixa"
            />
          </div>

          {scanAcc.topRejected.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mt-4">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                <p className="text-sm font-medium text-gray-700">Figurinhas mais desmarcadas (Gemini errou)</p>
                <p className="text-[11px] text-gray-400">Candidatas a melhorar prompt ou imagem de treino</p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="px-4 py-2.5 font-medium text-gray-500">Numero</th>
                    <th className="px-4 py-2.5 font-medium text-gray-500">Jogador</th>
                    <th className="px-4 py-2.5 font-medium text-gray-500 text-right">Desmarcadas</th>
                  </tr>
                </thead>
                <tbody>
                  {scanAcc.topRejected.map((r) => (
                    <tr key={r.sticker_id} className="border-t border-gray-100">
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{r.number}</td>
                      <td className="px-4 py-2.5 text-gray-700">{r.player_name || '—'}</td>
                      <td className="px-4 py-2.5 text-right font-semibold">{r.rejections}x</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Geographic distribution */}
      <SectionTitle>Distribuicao geografica</SectionTitle>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-baseline justify-between">
          <p className="text-sm font-medium text-gray-500">
            <span className="font-bold text-[#0A1628]">{geo.withCity}</span> com cidade
            {' · '}
            <span className="font-bold text-gray-500">{geo.withoutCity}</span> sem cidade
          </p>
          <p className="text-xs text-gray-400">{geo.cities.length} cidades</p>
        </div>
        {geo.cities.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-400 text-center">Sem dados de cidade ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="px-4 py-2.5 font-medium text-gray-500">Cidade</th>
                <th className="px-4 py-2.5 font-medium text-gray-500">Estado</th>
                <th className="px-4 py-2.5 font-medium text-gray-500 text-right">Usuarios</th>
              </tr>
            </thead>
            <tbody>
              {geo.cities.slice(0, 30).map((c) => (
                <tr key={`${c.city}|${c.state}`} className="border-t border-gray-100">
                  <td className="px-4 py-2.5 font-medium" style={{ color: '#0A1628' }}>{c.city}</td>
                  <td className="px-4 py-2.5 text-gray-500">{c.state || '—'}</td>
                  <td className="px-4 py-2.5 text-right font-semibold">{c.users}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* System Monitor */}
      <SectionTitle>Monitor do Sistema</SectionTitle>

      {/* Alerts banner */}
      {waHealth.alerts && waHealth.alerts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
          <p className="text-sm font-bold text-red-700 mb-2">🚨 Alertas ativos ({waHealth.alerts.length})</p>
          <ul className="text-sm text-red-600 space-y-1">
            {waHealth.alerts.map((a: string, i: number) => (
              <li key={i}>• {a}</li>
            ))}
          </ul>
          <p className="text-xs text-red-400 mt-2">Ultima verificacao: {waHealth.timestamp ? new Date(waHealth.timestamp).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'}</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
        {/* WhatsApp */}
        <div className={`rounded-xl shadow-sm border p-5 ${
          waHealth.whatsapp?.connected ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'
        }`}>
          <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">WhatsApp</p>
          <p className={`text-2xl font-bold mt-1 ${waHealth.whatsapp?.connected ? 'text-emerald-600' : 'text-red-600'}`}>
            {waHealth.whatsapp?.connected ? 'Conectado' : 'Desconectado'}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            {waHealth.whatsapp?.connected
              ? `Celular: ${waHealth.whatsapp?.smartphoneConnected ? 'OK' : 'Offline'}`
              : waHealth.whatsapp_action === 'restarted' ? 'Restart enviado' : 'Verificar Z-API'}
          </p>
        </div>

        {/* API Health */}
        <div className={`rounded-xl shadow-sm border p-5 ${health.status === 'healthy' ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
          <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">API Health</p>
          <p className={`text-2xl font-bold mt-1 ${health.status === 'healthy' ? 'text-emerald-600' : 'text-red-600'}`}>
            {health.status === 'healthy' ? 'Saudavel' : health.status === 'degraded' ? 'Degradado' : 'Fora do ar'}
          </p>
          <p className="text-sm text-gray-400 mt-1">{health.latency_ms}ms DB · {health.fetch_ms}ms total</p>
        </div>

        {/* Supabase */}
        <div className={`rounded-xl shadow-sm border p-5 ${
          (waHealth.supabase?.ok ?? health.checks?.supabase === 'ok') ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'
        }`}>
          <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">Supabase</p>
          <p className={`text-2xl font-bold mt-1 ${
            (waHealth.supabase?.ok ?? health.checks?.supabase === 'ok') ? 'text-emerald-600' : 'text-red-600'
          }`}>
            {(waHealth.supabase?.ok ?? health.checks?.supabase === 'ok') ? 'Online' : 'Offline'}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            {waHealth.supabase?.latency_ms ? `${waHealth.supabase.latency_ms}ms` : 'Pro · PostGIS'}
          </p>
        </div>

        {/* Notification Queue */}
        <div className={`rounded-xl shadow-sm border p-5 ${
          (waHealth.notification_queue?.failed ?? 0) === 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
        }`}>
          <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">Fila Notif.</p>
          <p className={`text-2xl font-bold mt-1 ${
            (waHealth.notification_queue?.failed ?? 0) === 0 ? 'text-emerald-600' : 'text-amber-600'
          }`}>
            {(waHealth.notification_queue?.failed ?? 0) === 0 ? 'Limpa' : `${waHealth.notification_queue?.failed} falhas`}
          </p>
          <p className="text-sm text-gray-400 mt-1">retry a cada 2min</p>
        </div>

        {/* Env Vars */}
        <div className={`rounded-xl shadow-sm border p-5 ${
          waHealth.env === 'ok' ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'
        }`}>
          <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">Env Vars</p>
          <p className={`text-2xl font-bold mt-1 ${waHealth.env === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
            {waHealth.env === 'ok' ? 'OK' : 'Faltando'}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            {waHealth.env === 'ok' ? '6 vars criticas' : (waHealth.env?.missing || []).join(', ')}
          </p>
        </div>
      </div>

      {/* Version + links */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4 flex items-center justify-between">
        <div>
          <span className="text-sm text-gray-500">Versao:</span>{' '}
          <span className="font-mono text-sm font-bold" style={{ color: '#0A1628' }}>{health.version || 'dev'}</span>
        </div>
        <div className="text-sm text-gray-400">
          Monitor roda a cada 5min · Alertas via WhatsApp + Email
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <a href="https://inove-ai-32.sentry.io" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-50 border border-purple-200 text-purple-700 text-sm font-medium hover:bg-purple-100 transition">
          <span>🐛</span> Sentry (Erros)
        </a>
        <a href="https://stats.uptimerobot.com/T6hoVVuvwy" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm font-medium hover:bg-green-100 transition">
          <span>📡</span> UptimeRobot (Uptime)
        </a>
        <a href="https://supabase.com/dashboard/project/vcxswsbmulztuzdmuuui" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium hover:bg-emerald-100 transition">
          <span>🗄️</span> Supabase
        </a>
        <a href="https://vercel.com" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-50 border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-100 transition">
          <span>▲</span> Vercel (Deploy)
        </a>
        <a href="https://vercel.com/pedrovillarinos-projects/figurinhas2026/analytics" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-sm font-medium hover:bg-blue-100 transition">
          <span>📊</span> Vercel Analytics (Visitas)
        </a>
        <a href="https://dashboard.stripe.com" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-sm font-medium hover:bg-indigo-100 transition">
          <span>💳</span> Stripe (Pagamentos)
        </a>
      </div>

      {/* Footer */}
      <p className="text-center text-xs text-gray-300 mt-12 mb-4">
        Complete Ai — Painel Admin (interno)
      </p>
    </div>
  )
}
