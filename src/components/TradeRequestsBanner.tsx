'use client'

import { useState } from 'react'

type PendingRequest = {
  id: string
  requester_id: string
  requester_name: string | null
  requester_avatar: string | null
  they_have: number
  i_have: number
  match_score: number
  distance_km: number | null
  message: string | null
  created_at: string
}

export default function TradeRequestsBanner({
  requests: initialRequests,
  onRespond,
}: {
  requests: PendingRequest[]
  onRespond: (requestId: string, action: 'approve' | 'reject') => Promise<void>
}) {
  const [requests, setRequests] = useState(initialRequests)
  const [responding, setResponding] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  if (requests.length === 0) return null

  async function handleRespond(requestId: string, action: 'approve' | 'reject') {
    setResponding(requestId)
    try {
      await onRespond(requestId, action)
      setRequests((prev) => prev.filter((r) => r.id !== requestId))
    } finally {
      setResponding(null)
    }
  }

  function getInitials(name: string | null): string {
    if (!name) return '?'
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
  }

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    if (hours < 1) return 'agora'
    if (hours < 24) return `${hours}h atrás`
    const days = Math.floor(hours / 24)
    return `${days}d atrás`
  }

  return (
    <div className="mb-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-3 p-3"
      >
        <div className="w-8 h-8 rounded-lg bg-amber-400 flex items-center justify-center flex-shrink-0">
          <span className="text-sm">🔔</span>
        </div>
        <div className="flex-1 text-left">
          <p className="text-xs font-bold text-amber-900">
            {requests.length} solicitação{requests.length > 1 ? 'ões' : ''} de troca
          </p>
          <p className="text-[10px] text-amber-700">
            Aprove para compartilhar seu contato
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="bg-amber-400 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
            {requests.length}
          </span>
          <svg
            className={`w-4 h-4 text-amber-500 transition-transform ${collapsed ? '' : 'rotate-180'}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </button>

      {/* Request cards */}
      {!collapsed && (
        <div className="px-3 pb-3 space-y-2">
          {requests.map((req) => {
            const isResponding = responding === req.id
            const totalTrade = req.they_have + req.i_have
            const distStr = req.distance_km != null
              ? (req.distance_km < 1 ? '<1km' : `${Math.round(req.distance_km)}km`)
              : null

            return (
              <div key={req.id} className="bg-white rounded-xl p-3 border border-amber-100">
                {/* User info row */}
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="w-8 h-8 bg-brand-light rounded-full flex items-center justify-center text-brand font-bold text-[10px] shrink-0">
                    {getInitials(req.requester_name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-gray-800 truncate">
                        {req.requester_name?.split(' ')[0] || 'Usuário'}
                      </span>
                      {distStr && (
                        <span className="text-[9px] text-gray-400">{distStr}</span>
                      )}
                      <span className="text-[9px] text-gray-300 ml-auto flex-shrink-0">{timeAgo(req.created_at)}</span>
                    </div>
                  </div>
                </div>

                {/* Trade potential */}
                <div className="flex gap-1.5 mb-3">
                  <div className="flex-1 bg-emerald-50 rounded-lg px-2 py-1.5 text-center">
                    <p className="text-sm font-bold text-emerald-700">{req.they_have}</p>
                    <p className="text-[8px] text-emerald-600">tem pra você</p>
                  </div>
                  <div className="flex-1 bg-blue-50 rounded-lg px-2 py-1.5 text-center">
                    <p className="text-sm font-bold text-blue-700">{req.i_have}</p>
                    <p className="text-[8px] text-blue-600">quer de você</p>
                  </div>
                  <div className="flex-1 bg-brand-light rounded-lg px-2 py-1.5 text-center">
                    <p className="text-sm font-bold text-brand-dark">{totalTrade}</p>
                    <p className="text-[8px] text-brand">total</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleRespond(req.id, 'reject')}
                    disabled={isResponding}
                    className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-xs font-semibold transition active:scale-[0.98] disabled:opacity-50"
                  >
                    Recusar
                  </button>
                  <button
                    onClick={() => handleRespond(req.id, 'approve')}
                    disabled={isResponding}
                    className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold transition active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-1"
                  >
                    {isResponding ? (
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        Aprovar
                      </>
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
