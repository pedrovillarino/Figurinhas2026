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

const TIER_PRICES: Record<string, number> = {
  plus: 990,
  premium: 1990,
}

const TIER_DISPLAY: Record<string, string> = {
  plus: 'R$9,90',
  premium: 'R$19,90',
}

export default function PaywallModal({ feature, currentTier, onClose }: PaywallModalProps) {
  const [loading, setLoading] = useState<string | null>(null)
  const [showCoupon, setShowCoupon] = useState(false)
  const [couponCode, setCouponCode] = useState('')
  const [couponStatus, setCouponStatus] = useState<{
    valid: boolean
    percent_off: number
    tier: string
    error?: string
  } | null>(null)
  const [validating, setValidating] = useState(false)
  const info = featureInfo[feature]

  async function validateCoupon(tier: string) {
    if (!couponCode.trim()) return
    setValidating(true)
    setCouponStatus(null)

    try {
      const res = await fetch('/api/discount/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: couponCode.trim(), tier }),
      })
      const data = await res.json()

      if (res.ok && data.valid) {
        setCouponStatus({ valid: true, percent_off: data.percent_off, tier: data.tier })
      } else {
        setCouponStatus({ valid: false, percent_off: 0, tier, error: data.error || 'Código inválido' })
      }
    } catch {
      setCouponStatus({ valid: false, percent_off: 0, tier, error: 'Erro ao validar' })
    }
    setValidating(false)
  }

  async function handleUpgrade(targetTier: 'plus' | 'premium') {
    setLoading(targetTier)
    try {
      const bodyData: Record<string, string> = { tier: targetTier }
      if (couponStatus?.valid && couponStatus.tier === targetTier) {
        bodyData.discountCode = couponCode.trim()
      }

      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData),
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

  function getDiscountedPrice(tier: string): string | null {
    if (!couponStatus?.valid || couponStatus.tier !== tier) return null
    const original = TIER_PRICES[tier] || 0
    const discounted = Math.round(original * (1 - couponStatus.percent_off / 100))
    if (discounted === 0) return 'Grátis'
    return `R$${(discounted / 100).toFixed(2).replace('.', ',')}`
  }

  // For scan paywall: show Plus option (and Premium as upgrade)
  // For trades paywall: show Premium only (user might already be Plus)
  const showPlus = feature === 'scan' && currentTier === 'free'
  const showPremium = true

  const plusDiscountedPrice = getDiscountedPrice('plus')
  const premiumDiscountedPrice = getDiscountedPrice('premium')

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

        {/* Discount code section */}
        <div className="mb-4">
          {!showCoupon ? (
            <button
              onClick={() => setShowCoupon(true)}
              className="w-full text-xs text-brand hover:text-brand-dark font-medium transition"
            >
              Tem código de desconto?
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={couponCode}
                  onChange={(e) => {
                    setCouponCode(e.target.value.toUpperCase())
                    setCouponStatus(null)
                  }}
                  placeholder="Digite o código"
                  className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-xs uppercase tracking-wider focus:ring-2 focus:ring-brand focus:border-transparent outline-none"
                />
                <button
                  onClick={() => validateCoupon(showPlus ? 'plus' : 'premium')}
                  disabled={validating || !couponCode.trim()}
                  className="bg-gray-900 text-white rounded-xl px-3 py-2 text-xs font-semibold hover:bg-gray-800 transition disabled:opacity-50"
                >
                  {validating ? '...' : 'Aplicar'}
                </button>
              </div>
              {couponStatus && (
                <p className={`text-xs text-center ${couponStatus.valid ? 'text-emerald-600 font-medium' : 'text-red-500'}`}>
                  {couponStatus.valid
                    ? couponStatus.percent_off === 100
                      ? 'Código aplicado — upgrade grátis!'
                      : `Código aplicado — ${couponStatus.percent_off}% de desconto!`
                    : couponStatus.error}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Tier cards */}
        <div className="space-y-3 mb-5">
          {/* Plus tier */}
          {showPlus && (
            <div className="border border-gray-200 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-gray-800">Plus</span>
                <div className="flex items-center gap-1.5">
                  {plusDiscountedPrice && (
                    <span className="text-xs text-gray-400 line-through">{TIER_DISPLAY.plus}</span>
                  )}
                  <span className={`text-sm font-black ${plusDiscountedPrice ? 'text-emerald-600' : 'text-gray-900'}`}>
                    {plusDiscountedPrice || TIER_DISPLAY.plus}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-1 mb-3">
                <Feature text="200 scans com IA (~1.400 figurinhas)" />
                <Feature text="Escaneie e registre automaticamente" />
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
                ) : plusDiscountedPrice === 'Grátis' ? (
                  'Ativar Plus Grátis'
                ) : (
                  'Desbloquear Plus'
                )}
              </button>
            </div>
          )}

          {/* Premium tier */}
          {showPremium && (
            <div className="border-2 border-brand/30 bg-brand-light/30 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold text-gray-800">Premium</span>
                  <span className="text-[9px] bg-gold text-navy rounded-full px-1.5 py-0.5 font-bold">MELHOR</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {premiumDiscountedPrice && (
                    <span className="text-xs text-gray-400 line-through">{TIER_DISPLAY.premium}</span>
                  )}
                  <span className={`text-sm font-black ${premiumDiscountedPrice ? 'text-emerald-600' : 'text-gray-900'}`}>
                    {premiumDiscountedPrice || TIER_DISPLAY.premium}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-1 mb-3">
                <Feature text="400 scans com IA (dobro do Plus!)" />
                <Feature text="Trocas com colecionadores" />
                <Feature text="Relatório semanal" />
              </div>
              <button
                onClick={() => handleUpgrade('premium')}
                disabled={loading !== null}
                className="w-full bg-brand text-white rounded-xl py-2.5 text-xs font-semibold hover:bg-brand-dark transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {loading === 'premium' ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Redirecionando...
                  </span>
                ) : premiumDiscountedPrice === 'Grátis' ? (
                  'Ativar Premium Grátis'
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
        <p className="text-[9px] text-gray-300 text-center mt-1">
          Serviço válido até 31/12/2026 (Copa do Mundo FIFA 2026).
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
