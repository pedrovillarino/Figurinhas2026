'use client'

/**
 * TrialStateBanner — banner de cima das telas (protected) mostrando o
 * estado do trial do user.
 *
 * Estados visiveis:
 *   - trial_active: faixa verde com X dias restantes + CTA "Aproveite"
 *   - expired:    faixa laranja com "Trial acabou" + CTA "Assinar plano"
 *   - paid / free_legacy: nao renderiza nada
 *
 * Implementacao: fetch ao /api/me/trial. Carrega 1x por mount.
 * Modelo decidido em docs/trial-7d-analise.md sec 13.
 *
 * Pedro 21/05/2026.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { TrialState, EffectiveTier } from '@/lib/trial'

type TrialInfo = {
  state: TrialState
  effective_tier: EffectiveTier
  trial_ends_at: string | null
  days_remaining: number
}

export default function TrialStateBanner() {
  const [info, setInfo] = useState<TrialInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/me/trial', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setInfo(data)
      })
      .catch(() => { /* silencioso — banner ausente se fetch falhar */ })
    return () => { cancelled = true }
  }, [])

  if (!info || dismissed) return null
  if (info.state === 'paid' || info.state === 'free_legacy') return null

  if (info.state === 'trial_active') {
    const days = info.days_remaining
    const isUrgent = days <= 2
    const bgClass = isUrgent ? 'bg-amber-50 border-amber-300' : 'bg-emerald-50 border-emerald-300'
    const textClass = isUrgent ? 'text-amber-900' : 'text-emerald-900'
    return (
      <div className={`${bgClass} border-b px-4 py-2.5 flex items-center justify-between gap-3 text-sm`}>
        <div className={`flex-1 ${textClass}`}>
          <span className="font-bold">🎁 Trial Boost ativo</span>{' '}
          <span className="text-xs">
            {days === 0
              ? 'expira hoje'
              : days === 1
                ? '· 1 dia restante'
                : `· ${days} dias restantes`}
          </span>
          <span className="hidden sm:inline text-xs ml-2 opacity-80">
            Aproveite: 150 scans + áudio ilimitado + 15 trocas
          </span>
        </div>
        <Link
          href="/upgrade"
          className={`text-xs font-bold px-3 py-1.5 rounded-full bg-white border ${isUrgent ? 'border-amber-400 text-amber-800' : 'border-emerald-400 text-emerald-800'} hover:opacity-80 transition`}
        >
          Assinar
        </Link>
        <button
          onClick={() => setDismissed(true)}
          className={`${textClass} opacity-60 hover:opacity-100`}
          aria-label="Fechar"
        >
          ✕
        </button>
      </div>
    )
  }

  // expired
  return (
    <div className="bg-red-50 border-b border-red-300 px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
      <div className="flex-1 text-red-900">
        <span className="font-bold">🚫 Trial Boost acabou</span>{' '}
        <span className="text-xs">
          Pra continuar escaneando e trocando, escolha um plano (a partir de R$9,90 — pagamento único).
        </span>
      </div>
      <Link
        href="/upgrade"
        className="text-xs font-bold px-3 py-1.5 rounded-full bg-red-600 text-white hover:bg-red-700 transition shrink-0"
      >
        Ver planos
      </Link>
    </div>
  )
}
