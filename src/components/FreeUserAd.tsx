'use client'

/**
 * <FreeUserAd placement="..." tier={tier} /> — ad contextual pra free users.
 * Pedro 2026-05-05.
 *
 * Comportamento:
 * - Se hasAds(tier) === false → renderiza null (paid users não veem nada)
 * - Senão fetcha /api/store/ad/[placement] e renderiza um card discreto
 *   com label "Patrocinado" + link "Sem anúncios? Upgrade →" pra /upgrade
 * - Click → fire tracking + abre affiliate URL em nova aba
 *
 * Nunca bloqueia conteúdo. Sempre dismissable (botão × → esconde 24h via
 * localStorage). Nunca mais de 1 por tela.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { hasAds, type Tier } from '@/lib/tiers'

type AdProduct = {
  id: number
  title: string
  description: string | null
  image_url: string | null
  price_display: string | null
  affiliate_url: string
}

type Ad = {
  placement_id: string
  copy_override: string | null
  product: AdProduct
}

export default function FreeUserAd({
  placement,
  tier,
  className = '',
}: {
  placement: string
  tier: Tier
  className?: string
}) {
  const [ad, setAd] = useState<Ad | null>(null)
  const [dismissed, setDismissed] = useState(true) // começa dismissed pra evitar flash
  const [redirecting, setRedirecting] = useState(false)

  // Paid users → null (early return via state, depois do mount)
  const showForTier = hasAds(tier)

  // Pedro 2026-05-05: dismiss em GRUPO pra album_progress_* — user dispensa
  // 1 milestone, não vê nenhum dos outros por 24h. Evita spam ao subir
  // múltiplos brackets num scan só.
  const dismissKey = placement.startsWith('album_progress_')
    ? 'ad_dismissed_album_progress'
    : `ad_dismissed_${placement}`

  useEffect(() => {
    if (!showForTier) return

    // Checa dismiss local (24h)
    const dismissedAt = localStorage.getItem(dismissKey)
    if (dismissedAt) {
      const ageMs = Date.now() - parseInt(dismissedAt, 10)
      if (ageMs < 24 * 60 * 60 * 1000) {
        setDismissed(true)
        return
      }
      // expirado — limpa
      localStorage.removeItem(dismissKey)
    }

    setDismissed(false)

    // Fetch ad
    fetch(`/api/store/ad/${encodeURIComponent(placement)}`)
      .then((r) => (r.ok ? r.json() : { ad: null }))
      .then((data) => {
        if (data?.ad?.product) {
          setAd(data.ad as Ad)
          // Track view (fire-and-forget)
          fetch('/api/store/click', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              product_id: data.ad.product.id,
              source: `placement_${placement}_view`,
              placement_id: placement,
            }),
            keepalive: true,
          }).catch(() => {})
        }
      })
      .catch(() => {
        // Silencioso — falha de rede não deve quebrar UX
      })
  }, [placement, showForTier])

  if (!showForTier || dismissed || !ad) return null

  const product = ad.product
  const headline = ad.copy_override || product.title

  function handleDismiss(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    localStorage.setItem(dismissKey, String(Date.now()))
    setDismissed(true)
  }

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault()
    if (redirecting) return
    setRedirecting(true)

    fetch('/api/store/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: product.id,
        source: `placement_${placement}`,
        placement_id: placement,
      }),
      keepalive: true,
    }).catch(() => {})

    setTimeout(() => {
      window.open(product.affiliate_url, '_blank', 'noopener,noreferrer')
      setRedirecting(false)
    }, 60)
  }

  return (
    <div className={`relative bg-gradient-to-br from-amber-50 to-brand-light/30 border border-brand/20 rounded-2xl overflow-hidden ${className}`}>
      {/* Dismiss × */}
      <button
        onClick={handleDismiss}
        className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white/80 hover:bg-white text-gray-500 hover:text-gray-900 text-xs font-bold flex items-center justify-center transition z-10"
        aria-label="Esconder por 24h"
      >
        ×
      </button>

      {/* Label patrocinado */}
      <div className="absolute top-2 left-2 z-10">
        <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500 bg-white/80 px-1.5 py-0.5 rounded">
          Patrocinado
        </span>
      </div>

      <a
        href={product.affiliate_url}
        onClick={handleClick}
        target="_blank"
        rel="noopener noreferrer sponsored"
        className="flex items-stretch gap-3 p-3 pt-7"
      >
        {product.image_url && (
          <div className="w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={product.image_url}
              alt={product.title}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-navy leading-snug line-clamp-2">
            {headline}
          </p>
          {product.description && !ad.copy_override && (
            <p className="text-[11px] text-gray-600 mt-0.5 line-clamp-2">
              {product.description}
            </p>
          )}
          {product.price_display && (
            <p className="text-xs font-black text-brand mt-1">{product.price_display}</p>
          )}
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-brand-dark mt-1">
            {redirecting ? 'Abrindo...' : 'Ver no Mercado Livre →'}
          </span>
        </div>
      </a>

      {/* Pedro 2026-05-08: CTA mais claro pro upgrade — deixa explícito que
          a "saída" dos anúncios é via plano pago (incentivo gentil sem ser
          agressivo). Visual destaca leve com ícone + texto. */}
      <div className="px-3 pb-2 pt-1 border-t border-brand/10 bg-white/40">
        <Link
          href="/upgrade"
          className="text-[10.5px] text-gray-700 hover:text-brand-dark transition flex items-center justify-between gap-2"
        >
          <span className="flex items-center gap-1">
            <span>🚫</span>
            <span><strong>Sem anúncios</strong> e mais scans</span>
          </span>
          <span className="font-bold text-brand-dark">Upgrade →</span>
        </Link>
      </div>
    </div>
  )
}
