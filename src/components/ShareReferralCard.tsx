'use client'

// Pedro 2026-05-08: card reutilizável de indicação 1-clique.
// Apelo comunitário ("comunidade da cidade/bairro") + recompensa concreta
// (+2 scans grátis por confirmação) + botão grande "Indicar agora".
//
// Onde usar: /album, /trades, /profile, /dashboard — qualquer surface
// onde o user já está engajado e pode ser convertido a indicar.
//
// Variants:
//   - "full" (default): card amarelo destacado, ideal pra empty states
//   - "compact": linha discreta, ideal pra rodapé de páginas densas
//
// 1-clique: usa navigator.share() (WebShare API). Fallback pra clipboard
// + abrir wa.me (WhatsApp explícito) em devices sem WebShare.

import { useMemo, useState } from 'react'

type Variant = 'full' | 'compact'

type Props = {
  referralCode: string | null
  displayName: string | null
  source: string                  // 'album' | 'trades' | 'profile' | 'dashboard' | etc.
  variant?: Variant
}

export default function ShareReferralCard({
  referralCode,
  displayName,
  source,
  variant = 'full',
}: Props) {
  const [shared, setShared] = useState<'pending' | 'done' | null>(null)

  const appUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.host}`
      : 'https://www.completeai.com.br'
  const referralUrl = referralCode ? `${appUrl}/register?ref=${referralCode}` : ''

  const shareText = useMemo(() => {
    const firstName = displayName?.split(' ')[0] || 'Eu'
    return (
      `${firstName} te chamou pra completar o álbum da Copa 2026 com Complete Aí! 🎉\n\n` +
      `📸 Escaneia suas figurinhas com IA, mostra repetidas/faltantes, e encontra trocas perto de você.\n\n` +
      `Use meu link e ganhe *+1 troca extra* no cadastro:\n${referralUrl}`
    )
  }, [displayName, referralUrl])

  function trackShared(via: 'native_share' | 'whatsapp_link' | 'copy') {
    fetch('/api/funnel/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'referral_link_shared',
        metadata: { via, source },
      }),
      keepalive: true,
    }).catch(() => {})
  }

  async function handleShare() {
    if (!referralUrl) return
    setShared('pending')

    // Tier 1: WebShare API (mobile native share sheet — best UX)
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> }
    if (typeof nav.share === 'function') {
      try {
        await nav.share({
          title: 'Complete Aí',
          text: shareText,
          url: referralUrl,
        })
        trackShared('native_share')
        setShared('done')
        return
      } catch {
        // user cancelled OR share failed — fall through to tier 2
      }
    }

    // Tier 2: deeplink direto pro WhatsApp (sempre funciona, abre WA aberto
    // com texto pronto)
    const waUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`
    window.open(waUrl, '_blank', 'noopener,noreferrer')
    trackShared('whatsapp_link')
    setShared('done')
  }

  if (!referralCode) return null

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={handleShare}
        className="w-full flex items-center justify-between gap-2 rounded-xl bg-gradient-to-r from-amber-50 to-emerald-50 border border-amber-200 px-3 py-2.5 hover:bg-amber-100/50 active:scale-[0.99] transition"
      >
        <div className="flex items-center gap-2 text-left">
          <span className="text-xl">🌟</span>
          <div>
            <p className="text-[12px] font-bold text-amber-900 leading-tight">
              Indicar amigos · +2 scans cada
            </p>
            <p className="text-[10px] text-amber-700 leading-tight">
              {shared === 'done' ? 'Compartilhado! ✅' : 'Toque pra mandar no WhatsApp'}
            </p>
          </div>
        </div>
        <svg className="w-4 h-4 text-amber-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    )
  }

  // FULL variant — Pedro 2026-05-08: enxugado pra ficar entre compact (album)
  // e o card grande original. Padding menor, header inline, texto mais curto,
  // botão menor.
  return (
    <div className="rounded-xl bg-gradient-to-br from-amber-50 via-yellow-50 to-emerald-50 border border-amber-300 px-3 py-2.5 shadow-sm">
      <div className="flex items-start gap-2 mb-2">
        <div className="text-xl shrink-0 leading-none mt-0.5">🌟</div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-black text-amber-900 leading-tight">
            Indique amigos · <span className="text-emerald-700">+2 scans cada</span>
          </p>
          <p className="text-[10.5px] text-amber-800 leading-snug mt-0.5">
            Faça a comunidade da sua cidade crescer e complete seu álbum ainda mais rápido.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={handleShare}
        disabled={shared === 'pending'}
        className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-lg px-3 py-2 font-bold text-[12px] shadow-sm active:scale-[0.98] transition flex items-center justify-center gap-1.5 disabled:opacity-60"
      >
        {shared === 'done' ? (
          <>
            <span>✅</span>
            <span>Compartilhado!</span>
          </>
        ) : (
          <>
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
              <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 01-4.243-1.214l-.257-.154-2.87.853.853-2.87-.154-.257A8 8 0 1112 20z" />
            </svg>
            <span>Compartilhar no WhatsApp</span>
          </>
        )}
      </button>
    </div>
  )
}
