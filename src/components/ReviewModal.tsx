'use client'

import { useState } from 'react'

type ReviewModalProps = {
  tradeRequestId: string
  partnerName: string
  onClose: () => void
  onSubmitted: () => void
}

function StarButton({ filled, onClick }: { filled: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="p-0.5 focus:outline-none">
      <svg
        className={`h-8 w-8 transition-colors ${filled ? 'text-yellow-400' : 'text-gray-200'}`}
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
      </svg>
    </button>
  )
}

export default function ReviewModal({
  tradeRequestId,
  partnerName,
  onClose,
  onSubmitted,
}: ReviewModalProps) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (rating === 0) {
      setError('Selecione uma nota.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/trade-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trade_request_id: tradeRequestId,
          rating,
          comment: comment.trim() || null,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Erro ao enviar avaliação.')
      }

      onSubmitted()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar avaliação.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-navy">Avaliar troca</h2>
        <p className="mt-1 text-sm text-gray-500">
          Como foi sua troca com <span className="font-medium text-gray-700">{partnerName}</span>?
        </p>

        {/* Star selector */}
        <div className="mt-4 flex justify-center gap-1" role="radiogroup" aria-label="Nota">
          {[1, 2, 3, 4, 5].map((i) => (
            <StarButton key={i} filled={i <= rating} onClick={() => setRating(i)} />
          ))}
        </div>

        {/* Comment */}
        <textarea
          className="mt-4 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand resize-none"
          rows={3}
          maxLength={500}
          placeholder="Como foi a troca? (opcional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <p className="mt-1 text-right text-[10px] text-gray-400">{comment.length}/500</p>

        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

        {/* Actions */}
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || rating === 0}
            className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
          >
            {loading ? 'Enviando...' : 'Enviar avaliação'}
          </button>
        </div>
      </div>
    </div>
  )
}
