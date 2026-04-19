'use client'

import { useEffect, useState } from 'react'
import { track } from '@vercel/analytics'

const STORAGE_KEY = 'ig-webview-promo-seen'

type Platform = 'ios' | 'android' | 'other'

function detect(): { isInApp: boolean; platform: Platform; sourceLabel: string } {
  if (typeof navigator === 'undefined') {
    return { isInApp: false, platform: 'other', sourceLabel: '' }
  }
  const ua = navigator.userAgent
  const isInstagram = /Instagram/i.test(ua)
  const isFacebook = /FBAN|FBAV/i.test(ua)
  const isInApp = isInstagram || isFacebook
  const platform: Platform = /iPhone|iPad|iPod/i.test(ua)
    ? 'ios'
    : /Android/i.test(ua)
    ? 'android'
    : 'other'
  const sourceLabel = isInstagram ? 'instagram' : isFacebook ? 'facebook' : ''
  return { isInApp, platform, sourceLabel }
}

export default function InstagramWebViewPromo() {
  const [visible, setVisible] = useState(false)
  const [info, setInfo] = useState<{ platform: Platform; sourceLabel: string }>({
    platform: 'other',
    sourceLabel: '',
  })

  useEffect(() => {
    if (sessionStorage.getItem(STORAGE_KEY) === 'true') return
    const { isInApp, platform, sourceLabel } = detect()
    if (!isInApp) return

    setInfo({ platform, sourceLabel })
    setVisible(true)
    sessionStorage.setItem(STORAGE_KEY, 'true')
    track('instagram_promo_view', { source: sourceLabel, platform })
  }, [])

  useEffect(() => {
    if (!visible) return
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = original
    }
  }, [visible])

  function close() {
    track('instagram_promo_close', { source: info.sourceLabel, platform: info.platform })
    setVisible(false)
  }

  function start() {
    track('instagram_promo_cta_click', { source: info.sourceLabel, platform: info.platform })
    setVisible(false)
    // Silently try to escape the in-app browser when possible.
    // Android: intent:// jumps to Chrome if installed, otherwise stays in WebView.
    // iOS: no programmatic way to open Safari from a WebView — we just close the modal.
    if (info.platform === 'android') {
      window.location.href =
        'intent://www.completeai.com.br/#Intent;scheme=https;package=com.android.chrome;end'
    }
  }

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ig-promo-title"
    >
      <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom-8 sm:zoom-in-95 duration-300">
        <button
          onClick={close}
          aria-label="Fechar"
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-white/90 hover:bg-gray-100 flex items-center justify-center text-gray-500 transition shadow-sm"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="bg-gradient-to-br from-[#0A1628] via-[#1A2332] to-[#0A1628] px-6 pt-7 pb-5 text-center">
          <p className="text-[10px] font-bold tracking-widest text-[#FFB800] uppercase mb-1">
            Bem-vindo do Instagram 👋
          </p>
          <h2 id="ig-promo-title" className="text-2xl font-black text-white leading-tight">
            Conheça o <span className="text-[#00C896]">Complete Aí</span>
          </h2>
          <p className="text-white/70 text-xs mt-2 leading-relaxed">
            O app que organiza seu álbum da Copa 2026 e encontra trocas perto de você
          </p>
        </div>

        <div className="px-5 py-5 grid grid-cols-2 gap-3">
          <FeatureCard icon="📸" title="Scanner com IA" description="Escaneia suas figurinhas e identifica automaticamente." />
          <FeatureCard icon="🔁" title="Trocas perto" description="Match com colecionadores na sua região." />
          <FeatureCard icon="💬" title="WhatsApp" description="Notificação direto no seu zap quando aparece troca." />
          <FeatureCard
            icon="⚡"
            title="COPA100"
            description="Os 100 primeiros ganham qualquer plano grátis."
            highlight
          />
        </div>

        <div className="px-5 pb-5">
          <button
            onClick={start}
            className="w-full bg-[#00C896] text-white font-bold rounded-2xl py-3.5 text-sm hover:bg-[#00A67D] active:scale-[0.98] transition shadow-lg shadow-[#00C896]/30"
          >
            Começar agora
          </button>
        </div>
      </div>
    </div>
  )
}

function FeatureCard({
  icon,
  title,
  description,
  highlight = false,
}: {
  icon: string
  title: string
  description: string
  highlight?: boolean
}) {
  return (
    <div
      className={`rounded-2xl p-3 ${
        highlight
          ? 'border-2 border-[#FFB800] bg-[#FFF8E6]'
          : 'border border-gray-200 bg-gray-50'
      }`}
    >
      <div className="text-3xl mb-1">{icon}</div>
      <p className={`text-xs font-bold leading-tight mb-0.5 ${highlight ? 'text-[#B07000]' : 'text-navy'}`}>
        {title}
      </p>
      <p className="text-[10px] text-gray-600 leading-snug">{description}</p>
    </div>
  )
}
