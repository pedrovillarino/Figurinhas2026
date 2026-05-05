'use client'

/**
 * Card de produto da /loja. Pedro 2026-05-05.
 * Cliente porque dispara tracking via fetch antes do redirect.
 */
import { useState } from 'react'

type ProductCardProduct = {
  id: number
  title: string
  description: string | null
  image_url: string | null
  price_display: string | null
  affiliate_url: string
}

export default function StoreProductCard({
  product,
  source,
}: {
  product: ProductCardProduct
  source: string
}) {
  const [redirecting, setRedirecting] = useState(false)

  async function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault()
    if (redirecting) return
    setRedirecting(true)

    // Fire-and-forget tracking — não bloqueia o redirect.
    fetch('/api/store/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: product.id,
        source,
      }),
      keepalive: true,
    }).catch(() => {
      // Ignora erro — tracking é best-effort
    })

    // Pequeno delay pra dar tempo do beacon sair antes da nav
    setTimeout(() => {
      window.open(product.affiliate_url, '_blank', 'noopener,noreferrer')
      setRedirecting(false)
    }, 60)
  }

  return (
    <a
      href={product.affiliate_url}
      onClick={handleClick}
      target="_blank"
      rel="noopener noreferrer sponsored"
      className="group block bg-white border border-gray-200 rounded-2xl overflow-hidden hover:shadow-md hover:border-brand/40 transition"
    >
      {/* Imagem */}
      <div className="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image_url}
            alt={product.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <span className="text-4xl">⚽</span>
        )}
      </div>
      {/* Info */}
      <div className="p-3">
        <p className="text-xs font-semibold text-navy line-clamp-2 leading-snug min-h-[2.4em]">
          {product.title}
        </p>
        {product.price_display && (
          <p className="text-sm font-black text-brand mt-1">{product.price_display}</p>
        )}
        <div className="mt-2">
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-500">
            {redirecting ? 'Abrindo...' : 'Comprar no Mercado Livre →'}
          </span>
        </div>
      </div>
    </a>
  )
}
