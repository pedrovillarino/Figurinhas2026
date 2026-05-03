'use client'

import { useState, useEffect } from 'react'
import { TIER_CONFIG, tierIndex, type Tier } from '@/lib/tiers'
import { trackClient, FUNNEL_EVENTS } from '@/lib/funnel-client'

type UpgradePlansProps = {
  currentTier: Tier
  feature?: 'scan' | 'trades' | 'upgrade'
  isMinor?: boolean
  showHeader?: boolean
}

const PAID_TIERS: Tier[] = ['estreante', 'colecionador', 'copa_completa']

const TIER_HIGHLIGHTS: Record<string, string[]> = {
  estreante: [
    '30 scans com IA (~240 figurinhas)',
    '30 áudios pelo WhatsApp',
    '5 trocas incluídas',
    'Sem anúncios',
  ],
  colecionador: [
    '150 scans com IA (~1.200 figurinhas)',
    'Áudio ilimitado pelo WhatsApp',
    '15 trocas incluídas',
    'Packs avulsos mais baratos',
    'Sem anúncios',
  ],
  copa_completa: [
    '500 scans com IA (~4.000 figurinhas)',
    'Áudio e trocas ilimitados',
    'Sem anúncios',
    'Experiência completa',
  ],
}

const TIER_BADGE: Record<string, { text: string; bg: string; fg: string }> = {
  estreante: { text: 'POPULAR', bg: 'bg-brand-light', fg: 'text-brand-dark' },
  colecionador: { text: 'MELHOR CUSTO', bg: 'bg-gold/20', fg: 'text-gold-dark' },
  copa_completa: { text: 'COMPLETO', bg: 'bg-emerald-100', fg: 'text-emerald-700' },
}

export default function UpgradePlans({
  currentTier,
  feature = 'upgrade',
  isMinor = false,
  showHeader = true,
}: UpgradePlansProps) {
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

  const currentIdx = tierIndex(currentTier)

  const availableTiers = PAID_TIERS.filter((t) => {
    if (tierIndex(t) <= currentIdx) return false
    if (isMinor && t === 'copa_completa') return false
    return true
  })

  // Funnel: paywall_viewed (mount). Triggered every time UpgradePlans renders
  // for an authenticated user — captures both organic visits to /upgrade and
  // forced "you hit your limit" prompts.
  useEffect(() => {
    trackClient(FUNNEL_EVENTS.PAYWALL_VIEWED, { feature, current_tier: currentTier })
    // intentionally only fires once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function validateCoupon() {
    if (!couponCode.trim()) return
    setValidating(true)
    setCouponStatus(null)

    const testTier = availableTiers[0] || 'estreante'
    try {
      const res = await fetch('/api/discount/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: couponCode.trim(), tier: testTier }),
      })
      const data = await res.json()

      if (res.ok && data.valid) {
        setCouponStatus({ valid: true, percent_off: data.percent_off, tier: 'all' })
      } else {
        setCouponStatus({ valid: false, percent_off: 0, tier: testTier, error: data.error || 'Código inválido' })
      }
    } catch {
      setCouponStatus({ valid: false, percent_off: 0, tier: testTier, error: 'Erro ao validar' })
    }
    setValidating(false)
  }

  async function handleUpgrade(targetTier: Tier) {
    setLoading(targetTier)
    // Funnel: user clicked upgrade (intent signal — fires before checkout API call)
    trackClient(FUNNEL_EVENTS.UPGRADE_CLICKED, {
      target_tier: targetTier,
      current_tier: currentTier,
      has_coupon: !!couponStatus?.valid,
      feature,
    })
    try {
      const bodyData: Record<string, string> = { tier: targetTier }
      if (couponStatus?.valid && (couponStatus.tier === targetTier || couponStatus.tier === 'all')) {
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
    if (!couponStatus?.valid || (couponStatus.tier !== tier && couponStatus.tier !== 'all')) return null
    const config = TIER_CONFIG[tier as Tier]
    const targetPrice = 'priceBrl' in config ? (config as { priceBrl: number }).priceBrl : 0
    if (!targetPrice) return null
    const currentConfig = TIER_CONFIG[currentTier]
    const currentPrice = 'priceBrl' in currentConfig ? (currentConfig as { priceBrl: number }).priceBrl : 0
    const upgradePrice = Math.max(0, targetPrice - currentPrice)
    const discounted = Math.round(upgradePrice * (1 - couponStatus.percent_off / 100))
    if (discounted === 0) return 'Grátis'
    return `R$${(discounted / 100).toFixed(2).replace('.', ',')}`
  }

  const featureTitle = feature === 'scan' ? 'Scanner com IA'
    : feature === 'upgrade' ? 'Fazer Upgrade'
    : 'Trocas de Figurinhas'
  const featureIcon = feature === 'scan' ? '📸' : feature === 'upgrade' ? '⬆️' : '🔁'
  const featureDesc = feature === 'scan'
    ? 'Detecte suas figurinhas automaticamente com IA.'
    : feature === 'upgrade'
    ? 'Escolha o plano ideal para completar seu álbum.'
    : 'Encontre pessoas perto de você para trocar figurinhas.'

  return (
    <>
      {showHeader && (
        <div className="text-center mb-4">
          <span className="text-4xl">{featureIcon}</span>
          <h2 className="text-lg font-bold text-gray-900 mt-2">{featureTitle}</h2>
          <p className="text-sm text-gray-500 mt-1">{featureDesc}</p>
        </div>
      )}

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
                onClick={() => validateCoupon()}
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

      <div className="space-y-3 mb-4">
        {availableTiers.map((t) => {
          const config = TIER_CONFIG[t]
          const badge = TIER_BADGE[t]
          const highlights = TIER_HIGHLIGHTS[t]
          const discountedPrice = getDiscountedPrice(t)
          const isBest = t === 'colecionador'

          const targetPrice = 'priceBrl' in config ? (config as { priceBrl: number }).priceBrl : 0
          const currentConfig = TIER_CONFIG[currentTier]
          const currentPrice = 'priceBrl' in currentConfig ? (currentConfig as { priceBrl: number }).priceBrl : 0
          const upgradePrice = Math.max(0, targetPrice - currentPrice)
          const priceDisplay = upgradePrice !== targetPrice
            ? `R$${(upgradePrice / 100).toFixed(2).replace('.', ',')}`
            : 'priceDisplay' in config ? (config as { priceDisplay: string }).priceDisplay : ''

          return (
            <div
              key={t}
              className={`rounded-2xl p-4 ${
                isBest
                  ? 'border-2 border-brand/30 bg-brand-light/30'
                  : 'border border-gray-200'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold text-gray-800">{config.label}</span>
                  {badge && (
                    <span className={`text-[9px] ${badge.bg} ${badge.fg} rounded-full px-1.5 py-0.5 font-bold`}>
                      {badge.text}
                    </span>
                  )}
                </div>
                <span className={`text-sm font-black ${discountedPrice ? 'text-emerald-600' : 'text-gray-900'}`}>
                  {discountedPrice || priceDisplay}
                </span>
              </div>
              <div className="flex flex-col gap-1 mb-3">
                {highlights?.map((h) => (
                  <Feature key={h} text={h} />
                ))}
              </div>
              <button
                onClick={() => handleUpgrade(t)}
                disabled={loading !== null}
                className={`w-full rounded-xl py-2.5 text-xs font-semibold transition-all active:scale-[0.98] disabled:opacity-50 ${
                  isBest
                    ? 'bg-brand text-white hover:bg-brand-dark'
                    : 'bg-gray-900 text-white hover:bg-gray-800'
                }`}
              >
                {loading === t ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Redirecionando...
                  </span>
                ) : discountedPrice === 'Grátis' ? (
                  `Ativar ${config.label} Grátis`
                ) : currentTier !== 'free' ? (
                  `Upgrade para ${config.label}`
                ) : (
                  `Desbloquear ${config.label}`
                )}
              </button>
            </div>
          )
        })}
      </div>

      <p className="text-[10px] text-gray-300 text-center">
        Pagamento único via Stripe. Aceita cartão e boleto.
      </p>
      <p className="text-[9px] text-gray-300 text-center mt-1">
        Válido até 31/12/2026 (edição Copa 2026).
      </p>
    </>
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
