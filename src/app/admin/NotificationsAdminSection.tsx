// Admin section: histórico de notificações automáticas + taxa de
// volta-ao-app 24h pós envio. Pedro 2026-05-03.

import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

type NotifStat = {
  type: string
  total_sent: number
  unique_recipients: number
  came_back_24h: number
  came_back_pct: number
  last_sent_at: string | null
}

const TYPE_LABELS: Record<string, { label: string; emoji: string; description: string }> = {
  match_digest: {
    label: 'Match digest',
    emoji: '🔔',
    description: 'Cron diário avisando trocas perto do user',
  },
  embaixadores_digest: {
    label: 'Embaixadores',
    emoji: '🏆',
    description: 'Progresso semanal da campanha de embaixadores',
  },
  coupon_expiry_warning: {
    label: 'Cupom expira',
    emoji: '⏰',
    description: 'Aviso 12h antes do cupom expirar',
  },
  trade_request: {
    label: 'Pedido de troca',
    emoji: '🤝',
    description: 'Alguém pediu uma troca',
  },
  trade_approved: {
    label: 'Troca aprovada',
    emoji: '✅',
    description: 'Sua troca foi aprovada',
  },
  courtesy: {
    label: 'Cortesia',
    emoji: '🎁',
    description: 'Service recovery (bug/erro consertado)',
  },
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'nunca'
  const date = new Date(iso)
  const diff = Date.now() - date.getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  if (hours < 1) return 'agora'
  if (hours < 24) return `${hours}h atrás`
  const days = Math.floor(hours / 24)
  return `${days}d atrás`
}

export default async function NotificationsAdminSection() {
  const admin = getAdmin()

  let stats: NotifStat[] = []
  try {
    const { data, error } = await admin.rpc('get_notifications_stats', { p_days: 30 })
    if (!error && data) stats = data as NotifStat[]
  } catch (err) {
    console.error('Notifications stats fetch failed:', err)
  }

  const totals = {
    sent: stats.reduce((s, r) => s + r.total_sent, 0),
    backInApp: stats.reduce((s, r) => s + r.came_back_24h, 0),
  }
  const overallPct = totals.sent > 0 ? Math.round((100 * totals.backInApp) / totals.sent) : 0

  return (
    <div>
      <h2 className="text-lg font-semibold mt-8 mb-1" style={{ color: '#0A1628' }}>
        🔔 Notificações automáticas
      </h2>
      <p className="text-[11px] text-gray-500 mb-4">
        Histórico (30 dias) de notificações disparadas por crons / triggers.
        Taxa de volta = % de destinatários que tiveram qualquer ação no app
        nas 24h depois de receber.
      </p>

      {/* Resumo geral */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <p className="text-[11px] text-gray-500">Total enviado (30d)</p>
          <p className="text-xl font-bold text-gray-800">{totals.sent}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <p className="text-[11px] text-gray-500">Voltaram em 24h</p>
          <p className="text-xl font-bold text-emerald-600">{totals.backInApp}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <p className="text-[11px] text-gray-500">Taxa de volta global</p>
          <p className={`text-xl font-bold ${overallPct >= 50 ? 'text-emerald-600' : overallPct >= 25 ? 'text-amber-600' : 'text-gray-700'}`}>
            {overallPct}%
          </p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <p className="text-[11px] text-gray-500">Tipos diferentes</p>
          <p className="text-xl font-bold text-gray-800">{stats.length}</p>
        </div>
      </div>

      {/* Detalhamento por tipo */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <p className="text-sm font-semibold text-gray-700">Por tipo</p>
        </div>
        {stats.length === 0 ? (
          <p className="text-sm text-gray-500 px-4 py-8 text-center">
            Nenhuma notificação automática enviada nos últimos 30 dias.
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {stats.map((row) => {
              const meta = TYPE_LABELS[row.type] || { label: row.type, emoji: '📬', description: '' }
              return (
                <div key={row.type} className="px-4 py-3 text-sm">
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{meta.emoji}</span>
                        <span className="font-semibold text-gray-800">{meta.label}</span>
                        <span className="text-[10px] text-gray-400">({row.type})</span>
                      </div>
                      {meta.description && (
                        <p className="text-[11px] text-gray-500 ml-7 mt-0.5">{meta.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <div className="text-right">
                        <p className="text-gray-500 text-[10px]">Enviadas</p>
                        <p className="font-semibold text-gray-800">{row.total_sent}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-gray-500 text-[10px]">Únicos</p>
                        <p className="font-semibold text-gray-800">{row.unique_recipients}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-gray-500 text-[10px]">Voltou 24h</p>
                        <p className={`font-semibold ${
                          row.came_back_pct >= 50 ? 'text-emerald-600' :
                          row.came_back_pct >= 25 ? 'text-amber-600' :
                          'text-gray-700'
                        }`}>
                          {row.came_back_24h} ({row.came_back_pct}%)
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-gray-500 text-[10px]">Último</p>
                        <p className="text-[11px] text-gray-600">{formatRelative(row.last_sent_at)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
