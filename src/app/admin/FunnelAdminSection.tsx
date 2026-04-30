/**
 * Conversion funnel — read-only summary for /admin.
 *
 * Reads the get_conversion_funnel RPC to show the 7-stage pipeline + per-step
 * conversion %. Also shows recent activity (last 24h) for quick-scan.
 *
 * Pure server component. No interactivity in S1 — Pedro can refresh the page
 * to see fresh data. Date-window selector lives as URL query (?days=N).
 */
import { createClient as createAdminClient } from '@supabase/supabase-js'

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

type FunnelRow = {
  stage: string
  stage_order: number
  user_count: number
  conversion_from_previous: number | null
}

const STAGE_LABELS: Record<string, { label: string; emoji: string }> = {
  signup: { label: 'Cadastros', emoji: '🆕' },
  first_scan: { label: '1º scan', emoji: '📸' },
  scan_limit_hit: { label: 'Bateu limite scan', emoji: '🚧' },
  paywall_viewed: { label: 'Viu paywall', emoji: '👀' },
  upgrade_clicked: { label: 'Clicou upgrade', emoji: '🛒' },
  checkout_started: { label: 'Iniciou checkout', emoji: '💳' },
  payment_completed: { label: 'Pagou', emoji: '💎' },
}

export default async function FunnelAdminSection({ days = 30 }: { days?: number }) {
  const admin = getAdmin()

  // Funnel for the requested window
  const { data: funnelData } = await admin.rpc('get_conversion_funnel', { p_days: days })
  const funnel = (funnelData || []) as FunnelRow[]

  // Last-24h activity counts (sanity check / fresh data verification)
  const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const { data: recentRaw } = await admin
    .from('funnel_events')
    .select('event_name')
    .gte('created_at', since24h)

  const recentByEvent: Record<string, number> = {}
  ;(recentRaw || []).forEach((r) => {
    const name = (r as { event_name: string }).event_name
    recentByEvent[name] = (recentByEvent[name] || 0) + 1
  })

  // End-to-end conversion (signup → payment)
  const signupCount = funnel.find((f) => f.stage === 'signup')?.user_count || 0
  const paymentCount = funnel.find((f) => f.stage === 'payment_completed')?.user_count || 0
  const overallConversion = signupCount > 0
    ? ((paymentCount / signupCount) * 100).toFixed(2)
    : '0'

  // Bar visualization helper
  const maxCount = Math.max(...funnel.map((f) => f.user_count), 1)

  return (
    <div>
      <h2 className="text-lg font-semibold mt-8 mb-4" style={{ color: '#0A1628' }}>
        🎯 Funil de Conversão (últimos {days} dias)
      </h2>

      {/* Headline */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div>
            <p className="text-3xl font-black text-brand">{overallConversion}%</p>
            <p className="text-xs text-gray-500 mt-1">
              Cadastro → Pagamento ({paymentCount} de {signupCount.toLocaleString('pt-BR')} cadastros pagaram)
            </p>
          </div>
          <div className="flex gap-2 text-xs">
            <a href="?secret=completeai2026&days=7" className="px-3 py-1 rounded-lg border border-gray-200 hover:bg-gray-50">7d</a>
            <a href="?secret=completeai2026&days=30" className="px-3 py-1 rounded-lg border border-gray-200 hover:bg-gray-50">30d</a>
            <a href="?secret=completeai2026&days=90" className="px-3 py-1 rounded-lg border border-gray-200 hover:bg-gray-50">90d</a>
          </div>
        </div>
      </div>

      {/* Funnel table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-4">
        {funnel.length === 0 ? (
          <p className="text-sm text-gray-500 px-4 py-8 text-center">
            Sem eventos nesse período. Métricas começam a aparecer assim que os
            primeiros usuários interagirem.
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {funnel.map((row) => {
              const meta = STAGE_LABELS[row.stage] || { label: row.stage, emoji: '•' }
              const widthPct = (row.user_count / maxCount) * 100
              const isDropoff = row.conversion_from_previous !== null && row.conversion_from_previous < 30
              return (
                <div key={row.stage} className="px-4 py-3 hover:bg-gray-50 transition">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{meta.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm font-semibold text-gray-800 truncate">{meta.label}</span>
                        <span className="text-sm font-mono font-bold text-gray-700">
                          {row.user_count.toLocaleString('pt-BR')}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            row.stage === 'payment_completed' ? 'bg-emerald-500' : 'bg-brand'
                          }`}
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                    <div className="w-16 text-right">
                      {row.conversion_from_previous !== null ? (
                        <span className={`text-xs font-bold ${isDropoff ? 'text-red-600' : 'text-emerald-600'}`}>
                          {row.conversion_from_previous}%
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-400">início</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Last 24h sanity check */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <p className="text-xs font-semibold text-gray-700 mb-2">Atividade nas últimas 24h (todos os eventos)</p>
        {Object.keys(recentByEvent).length === 0 ? (
          <p className="text-xs text-gray-400">Sem eventos nas últimas 24h.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.entries(recentByEvent)
              .sort(([, a], [, b]) => b - a)
              .map(([event, count]) => (
                <div key={event} className="text-xs">
                  <span className="font-mono text-gray-500">{event}</span>{' '}
                  <span className="font-bold text-gray-800">{count}</span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}
