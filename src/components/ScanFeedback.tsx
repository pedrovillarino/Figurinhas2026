'use client'

import { useState } from 'react'

// Inline feedback banner after a scan result. NOT a modal — sits below
// the results so the user can ignore it without dismissing anything.
//
// Friction rules (Pedro's call):
//   • Renders in-flow, no overlay, no body lock
//   • Two clicks max: 👍 = done; 👎 = optional textarea + submit
//   • Sample-only: caller decides when to render (1st, 3rd, 5th scan…)
//   • Once interacted with (any choice), hides for the rest of the session
//   • Tiny "X" to dismiss outright
//
// Caller integration:
//   {showFeedback && <ScanFeedback onClose={() => setShowFeedback(false)} />}

const SESSION_KEY = 'scan_feedback_done_session'

export default function ScanFeedback({
  onClose,
  metadata,
}: {
  onClose?: () => void
  metadata?: Record<string, unknown>
}) {
  const [phase, setPhase] = useState<'ask' | 'comment' | 'done'>('ask')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // If the user already gave feedback in this session, we self-hide
  if (typeof window !== 'undefined' && sessionStorage.getItem(SESSION_KEY) === 'true') {
    return null
  }

  async function send(rating: 'positive' | 'negative', extra?: { comment?: string }) {
    setSubmitting(true)
    try {
      // Fire-and-forget: don't block the UI on a network error
      fetch('/api/scan/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating,
          comment: extra?.comment || null,
          metadata: metadata || {},
        }),
        keepalive: true,
      }).catch(() => { /* swallow */ })
    } catch { /* swallow */ }

    sessionStorage.setItem(SESSION_KEY, 'true')
    setPhase('done')
    setSubmitting(false)
    // Auto-close 2s after the thank-you flashes
    setTimeout(() => onClose?.(), 2000)
  }

  function handleClose() {
    sessionStorage.setItem(SESSION_KEY, 'true')
    onClose?.()
  }

  return (
    <div className="my-4 rounded-2xl border border-gray-200 bg-white p-4 relative">
      <button
        onClick={handleClose}
        aria-label="Fechar"
        className="absolute top-2 right-2 w-6 h-6 rounded-full text-gray-300 hover:text-gray-600 hover:bg-gray-50 flex items-center justify-center transition"
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {phase === 'ask' && (
        <>
          <p className="text-xs font-semibold text-gray-700 mb-2">
            💬 Esse scan funcionou bem pra você?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => send('positive')}
              disabled={submitting}
              className="flex-1 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold hover:bg-emerald-100 transition active:scale-95 disabled:opacity-50"
            >
              👍 Ficou ótimo
            </button>
            <button
              onClick={() => setPhase('comment')}
              disabled={submitting}
              className="flex-1 py-2 rounded-xl bg-gray-50 border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-100 transition active:scale-95 disabled:opacity-50"
            >
              👎 Tive problema
            </button>
          </div>
          <p className="text-[10px] text-gray-400 mt-2 text-center">Anônimo — só nos ajuda a melhorar.</p>
        </>
      )}

      {phase === 'comment' && (
        <>
          <p className="text-xs font-semibold text-gray-700 mb-2">
            👎 O que rolou? <span className="text-gray-400 font-normal">(opcional)</span>
          </p>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Ex: faltou figurinha X, identificou errado…"
            rows={2}
            maxLength={500}
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs focus:ring-2 focus:ring-brand/30 focus:border-brand outline-none resize-none"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => send('negative', { comment: comment.trim() || undefined })}
              disabled={submitting}
              className="flex-1 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-800 transition active:scale-95 disabled:opacity-50"
            >
              {submitting ? 'Enviando…' : 'Enviar'}
            </button>
            <button
              onClick={() => send('negative')}
              disabled={submitting}
              className="px-3 py-2 rounded-xl text-xs text-gray-500 hover:text-gray-700 transition disabled:opacity-50"
            >
              Pular
            </button>
          </div>
        </>
      )}

      {phase === 'done' && (
        <p className="text-xs font-semibold text-emerald-700 text-center py-1">
          🙏 Valeu pelo feedback!
        </p>
      )}
    </div>
  )
}
