'use client'

import { useState } from 'react'
import type { Tier } from '@/lib/tiers'

type PaywallModalProps = {
  feature: 'scan' | 'trades'
  currentTier: Tier
  onClose?: () => void
}

const featureInfo = {
  scan: {
    icon: '📸',
    title: 'Scanner é Plus',
    description: 'Detecte suas figurinhas automaticamente com IA.',
    requiredTier: 'plus' as Tier,
  },
  trades: {
    icon: '🔁',
    title: 'Trocas é Premium',
    description: 'Encontre pessoas perto de você para trocar figurinhas.',
    requiredTier: 'premium' as Tier,
  },
}

export default function PaywallModal({ feature, currentTier, onClose }: PaywallModalProps) {
  const [loading, setLoading] = useState<string | null>(null)
  const info = featureInfo[feature]

  async function handleUpgrade(targetTier: 'plus' | 'premium') {
    setLoading(targetTier)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: targetTier }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        alert(data.error || 'Erro ao iniciar pagamento')
        setLoading(null)
      }
    } catch {
      alert('Erro ao conectar com o servidor')
      setLoading(null)
    }
  }

  // For scan paywall: show Plus option (and Premium as upgrade)
  // For trades paywall: show Premium only (user might already be Plus)
  const showPlus = feature === 'scan' && currentTier === 'free'
  const showPremium = true

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-6">
      <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl animate-fade-up relative">
        {/* Close button */}
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-300 hover:text-gray-500 transition"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* Icon */}
        <div className="text-center mb-4">
          <span className="text-5xl">{info.icon}</span>
        </div>

        {/* Content */}
        <h2 className="text-lg font-bold text-gray-900 text-center mb-1">
          {info.title}
        </h2>
        <p className="text-sm text-gray-500 text-center mb-5">
          {info.description}
        </p>

        {/* Tier cards */}
        <div className="space-y-3 mb-5">
          {/* Plus tier */}
          {showPlus && (
            <div className="border border-gray-200 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-gray-800">Plus</span>
                <span className="text-sm font-black text-gray-900">R$9,90</span>
              </div>
              <div className="flex flex-col gap-1 mb-3">
                <Feature text="Scanner IA ilimitado" />
                <Feature text="Figurinhas ilimitadas" />
              </div>
              <button
                onClick={() => handleUpgrade('plus')}
                disabled={loading !== null}
                className="w-full bg-gray-900 text-white rounded-xl py-2.5 text-xs font-semibold hover:bg-gray-800 transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {loading === 'plus' ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Redirecionando...
                  </span>
                ) : (
                  'Desbloquear Plus'
                )}
              </button>
            </div>
          )}

          {/* Premium tier */}
          {showPremium && (
            <div className="border-2 border-violet-200 bg-violet-50/30 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold text-gray-800">Premium</span>
                  <span className="text-[9px] bg-violet-500 text-white rounded-full px-1.5 py-0.5 font-bold">MELHOR</span>
                </div>
                <span className="text-sm font-black text-gray-900">R$19,90</span>
              </div>
              <div className="flex flex-col gap-1 mb-3">
                <Feature text="Scanner IA ilimitado" />
                <Feature text="Figurinhas ilimitadas" />
                <Feature text="Trocas com colecionadores" />
                <Feature text="Relatório semanal" />
              </div>
              <button
                onClick={() => handleUpgrade('premium')}
                disabled={loading !== null}
                className="w-full bg-violet-600 text-white rounded-xl py-2.5 text-xs font-semibold hover:bg-violet-700 transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {loading === 'premium' ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Redirecionando...
                  </span>
                ) : currentTier === 'plus' ? (
                  'Upgrade para Premium'
                ) : (
                  'Desbloquear Premium'
                )}
              </button>
            </div>
          )}
        </div>

        <p className="text-[10px] text-gray-300 text-center">
          Pagamento único via Stripe. Aceita cartão e boleto.
        </p>
      </div>
    </div>
  )
}

function Feature({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2">
      <svg className="w-3.5 h-3.5 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      <span className="text-xs text-gray-600">{text}</span>
    </div>
  )
}
