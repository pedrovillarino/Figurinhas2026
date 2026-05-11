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

type ApprovedTrade = {
  requestId: string
  requesterName: string
  contact: string | null // wa.me/... or email
  // Pedro 12/05/2026 — Liga Complete Aí: estado da confirmação dupla
  confirmedByMe?: boolean
  confirmedByOther?: boolean
  alreadyReviewed?: boolean
}

export default function TradeRequestsBanner({
  requests: initialRequests,
  onRespond,
  initialApprovedTrades = [],
}: {
  requests: PendingRequest[]
  onRespond: (requestId: string, action: 'approve' | 'reject') => Promise<{ requester_name?: string; requester_contact?: string } | null>
  initialApprovedTrades?: ApprovedTrade[]
}) {
  const [requests, setRequests] = useState(initialRequests)
  const [responding, setResponding] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [approvedTrades, setApprovedTrades] = useState<ApprovedTrade[]>(initialApprovedTrades)
  // Pedro 12/05/2026 — Liga Complete Aí: confirmação dupla + avaliação
  const [confirming, setConfirming] = useState<string | null>(null)
  const [reviewModalFor, setReviewModalFor] = useState<ApprovedTrade | null>(null)
  const [reviewRating, setReviewRating] = useState(0)
  const [reviewComment, setReviewComment] = useState('')
  const [reviewSubmitting, setReviewSubmitting] = useState(false)

  async function handleConfirmTrade(trade: ApprovedTrade) {
    setConfirming(trade.requestId)
    try {
      const res = await fetch('/api/trade-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trade_request_id: trade.requestId }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Erro ao confirmar troca')
        return
      }
      // Atualiza estado local
      setApprovedTrades((prev) =>
        prev.map((t) =>
          t.requestId === trade.requestId
            ? { ...t, confirmedByMe: true, confirmedByOther: data.both_confirmed === true }
            : t,
        ),
      )
      // Se AMBOS confirmaram, abre modal de avaliação
      if (data.both_confirmed && !trade.alreadyReviewed) {
        setReviewModalFor({ ...trade, confirmedByMe: true, confirmedByOther: true })
      }
    } catch (err) {
      console.error(err)
      alert('Erro de rede. Tenta de novo.')
    } finally {
      setConfirming(null)
    }
  }

  async function handleSubmitReview() {
    if (!reviewModalFor || reviewRating < 1) return
    setReviewSubmitting(true)
    try {
      const res = await fetch('/api/trade-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trade_request_id: reviewModalFor.requestId,
          rating: reviewRating,
          comment: reviewComment.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        alert(data.error || 'Erro ao enviar avaliação')
        return
      }
      // Marca como avaliada e fecha modal
      setApprovedTrades((prev) =>
        prev.map((t) =>
          t.requestId === reviewModalFor.requestId ? { ...t, alreadyReviewed: true } : t,
        ),
      )
      setReviewModalFor(null)
      setReviewRating(0)
      setReviewComment('')
    } catch (err) {
      console.error(err)
      alert('Erro de rede. Tenta de novo.')
    } finally {
      setReviewSubmitting(false)
    }
  }

  if (requests.length === 0 && approvedTrades.length === 0) return null

  async function handleRespond(requestId: string, action: 'approve' | 'reject') {
    setResponding(requestId)
    try {
      const result = await onRespond(requestId, action)
      if (action === 'approve' && result) {
        setApprovedTrades((prev) => [
          ...prev,
          {
            requestId,
            requesterName: result.requester_name || 'Usuário',
            contact: result.requester_contact || null,
          },
        ])
      }
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
    <div className="space-y-3 mb-4">
      {/* Approved trades — show contact to click */}
      {approvedTrades.map((trade) => (
        <div key={trade.requestId} className="bg-gradient-to-r from-emerald-50 to-green-50 border border-emerald-200 rounded-2xl p-4 relative">
          {/* Close button */}
          <button
            onClick={() => setApprovedTrades((prev) => prev.filter((t) => t.requestId !== trade.requestId))}
            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/80 border border-emerald-200 flex items-center justify-center hover:bg-white transition"
            aria-label="Fechar"
          >
            <svg className="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-emerald-900">Troca aprovada!</p>
              <p className="text-[10px] text-emerald-700">Combine a troca com {trade.requesterName}</p>
            </div>
          </div>
          {trade.contact ? (
            <a
              href={trade.contact.startsWith('wa.me/')
                ? `https://api.whatsapp.com/send?phone=${trade.contact.replace('wa.me/', '')}&text=${encodeURIComponent(`Oi! Vi no Complete Aí que temos figurinhas pra trocar. Vamos combinar? ⚽`)}`
                : `mailto:${trade.contact}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-bold transition active:scale-[0.98]"
            >
              {trade.contact.startsWith('wa.me/') ? (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  Abrir WhatsApp de {trade.requesterName}
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                  </svg>
                  Enviar email para {trade.requesterName}
                </>
              )}
            </a>
          ) : (
            <p className="text-xs text-emerald-700 text-center">
              Contato enviado por WhatsApp. Verifique suas mensagens.
            </p>
          )}

          {/* Pedro 12/05/2026 — Liga Complete Aí: confirmação dupla da troca presencial */}
          <div className="mt-3 pt-3 border-t border-emerald-200">
            {trade.confirmedByMe && trade.confirmedByOther && trade.alreadyReviewed ? (
              <p className="text-xs text-emerald-700 text-center font-semibold">
                ✅ Troca concluída e avaliada — +pontos Liga aplicados
              </p>
            ) : trade.confirmedByMe && trade.confirmedByOther ? (
              <button
                type="button"
                onClick={() => setReviewModalFor(trade)}
                className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition active:scale-[0.98]"
              >
                ⭐ Avaliar troca (+5 pts Liga)
              </button>
            ) : trade.confirmedByMe ? (
              <p className="text-xs text-emerald-700 text-center font-medium">
                ⏳ Aguardando {trade.requesterName} confirmar do outro lado...
              </p>
            ) : (
              <button
                type="button"
                onClick={() => handleConfirmTrade(trade)}
                disabled={confirming === trade.requestId}
                className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold transition active:scale-[0.98] disabled:opacity-50"
              >
                {confirming === trade.requestId
                  ? 'Confirmando...'
                  : '✅ Concluí a troca'}
              </button>
            )}
          </div>
        </div>
      ))}

      {/* Pedro 12/05/2026 — Modal de avaliação por estrelas */}
      {reviewModalFor && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => !reviewSubmitting && setReviewModalFor(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-md w-full p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xl">⭐</span>
              <h2 className="text-lg font-bold text-gray-900">
                Avaliar troca com {reviewModalFor.requesterName}
              </h2>
            </div>
            <p className="text-sm text-gray-600 mb-4 leading-relaxed">
              Como foi a troca? Sua avaliação ajuda outros usuários a confiarem na rede.
            </p>

            {/* Estrelas */}
            <div className="flex justify-center gap-2 mb-4">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setReviewRating(n)}
                  disabled={reviewSubmitting}
                  className="text-4xl transition transform active:scale-90 disabled:opacity-50"
                  aria-label={`${n} estrelas`}
                >
                  {n <= reviewRating ? '⭐' : '☆'}
                </button>
              ))}
            </div>

            <textarea
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value.slice(0, 200))}
              placeholder="Comentário (opcional, máx 200 chars)"
              disabled={reviewSubmitting}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-4 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-100 resize-none"
              rows={3}
            />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setReviewModalFor(null)}
                disabled={reviewSubmitting}
                className="flex-1 py-2.5 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 active:scale-95 transition disabled:opacity-50"
              >
                Pular
              </button>
              <button
                type="button"
                onClick={handleSubmitReview}
                disabled={reviewRating < 1 || reviewSubmitting}
                className="flex-1 py-2.5 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {reviewSubmitting ? 'Enviando...' : 'Enviar avaliação'}
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-3 text-center leading-snug">
              +5 pts Liga por avaliar · +5 pts pra quem recebe nota 4-5⭐
            </p>
          </div>
        </div>
      )}

      {/* Pending requests */}
      {requests.length > 0 && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl overflow-hidden">
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
      )}
    </div>
  )
}
