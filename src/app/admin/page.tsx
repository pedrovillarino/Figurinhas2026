import { createClient } from '@supabase/supabase-js'
import { TIER_CONFIG, type Tier } from '@/lib/tiers'

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
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://completeai.com.br'}/api/health`, {
      cache: 'no-store',
    })
    const data = await res.json()
    return { ...data, fetch_ms: Date.now() - start }
  } catch {
    return { status: 'unreachable', checks: {}, latency_ms: 0, fetch_ms: 0 }
  }
}

async function getMetrics() {
  const sb = supabaseAdmin()
  const now = new Date()
  const todayStr = now.toISOString().split('T')[0]
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

    // Scans today
    sb.from('scan_usage')
      .select('scan_count')
      .eq('scan_date', todayStr),

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

    // Top scanners today
    sb.from('scan_usage')
      .select('user_id, scan_count')
      .eq('scan_date', todayStr)
      .order('scan_count', { ascending: false })
      .limit(5),
  ])

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
    topScanners: topScannersRes.data ?? [],
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
  searchParams: { secret?: string }
}) {
  // Auth check
  if (searchParams.secret !== ADMIN_SECRET) {
    return <LoginForm />
  }

  const [m, health] = await Promise.all([getMetrics(), getHealthCheck()])

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
                  <th className="px-4 py-3 font-medium text-gray-500">User ID</th>
                  <th className="px-4 py-3 font-medium text-gray-500 text-right">Scans</th>
                </tr>
              </thead>
              <tbody>
                {m.topScanners.map((s: { user_id: string; scan_count: number }, i: number) => (
                  <tr key={s.user_id} className="border-t border-gray-100">
                    <td className="px-4 py-2.5 text-gray-400">{i + 1}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{s.user_id.slice(0, 8)}...</td>
                    <td className="px-4 py-2.5 text-right font-semibold">{s.scan_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Infrastructure */}
      <SectionTitle>Infraestrutura</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <div className={`rounded-xl shadow-sm border p-5 ${health.status === 'healthy' ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
          <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">API Health</p>
          <p className={`text-2xl font-bold mt-1 ${health.status === 'healthy' ? 'text-emerald-600' : 'text-red-600'}`}>
            {health.status === 'healthy' ? 'Saudavel' : health.status === 'degraded' ? 'Degradado' : 'Fora do ar'}
          </p>
          <p className="text-sm text-gray-400 mt-1">{health.latency_ms}ms DB · {health.fetch_ms}ms total</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">Supabase</p>
          <p className={`text-2xl font-bold mt-1 ${health.checks?.supabase === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
            {health.checks?.supabase === 'ok' ? 'Online' : 'Offline'}
          </p>
          <p className="text-sm text-gray-400 mt-1">Pro · PostGIS ativo</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">Versao</p>
          <p className="text-2xl font-bold mt-1" style={{ color: '#0A1628' }}>{health.version || 'dev'}</p>
          <p className="text-sm text-gray-400 mt-1">commit SHA</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">Env Vars</p>
          <p className={`text-2xl font-bold mt-1 ${health.checks?.env === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
            {health.checks?.env === 'ok' ? 'OK' : 'Faltando'}
          </p>
          <p className="text-sm text-gray-400 mt-1">Supabase + Stripe</p>
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
