'use client'

import { useState, useEffect, useCallback } from 'react'

const DISMISS_KEY = 'completeai_install_dismissed'
const DISMISS_DAYS = 7
const SHOW_DELAY_MS = 60000 // show after 1 min of usage

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function InstallBanner() {
  const [show, setShow] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)

  const handleInstallPrompt = useCallback((e: Event) => {
    e.preventDefault()
    setDeferredPrompt(e as BeforeInstallPromptEvent)
  }, [])

  useEffect(() => {
    // Already installed as PWA?
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true

    if (isStandalone) return

    // Dismissed recently?
    const dismissed = localStorage.getItem(DISMISS_KEY)
    if (dismissed) {
      const dismissedAt = parseInt(dismissed)
      if (Date.now() - dismissedAt < DISMISS_DAYS * 24 * 60 * 60 * 1000) return
    }

    // Detect iOS
    const ua = navigator.userAgent
    const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    setIsIOS(ios)

    // Listen for Android/Chrome install prompt
    window.addEventListener('beforeinstallprompt', handleInstallPrompt)

    // Show after delay
    const timer = setTimeout(() => setShow(true), SHOW_DELAY_MS)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
    }
  }, [handleInstallPrompt])

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
    setShow(false)
  }

  async function handleInstall() {
    if (deferredPrompt) {
      await deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') {
        setShow(false)
      }
      setDeferredPrompt(null)
    }
  }

  if (!show) return null

  return (
    <div className="fixed bottom-16 left-0 right-0 z-40 px-4 pb-2 animate-slide-up">
      <div className="bg-navy text-white rounded-2xl p-4 shadow-xl max-w-lg mx-auto">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="w-10 h-10 rounded-xl bg-brand/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75v6.75m0 0l-3-3m3 3l3-3m-8.25 6a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
            </svg>
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold">Adicione à tela inicial</p>
            {isIOS ? (
              <p className="text-xs text-white/60 mt-0.5 leading-relaxed">
                Toque em{' '}
                <svg className="w-3.5 h-3.5 inline-block align-text-bottom" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                {' '}e depois em <strong>&quot;Adicionar à Tela de Início&quot;</strong>
              </p>
            ) : (
              <p className="text-xs text-white/60 mt-0.5">
                Acesse mais rápido direto da sua tela inicial.
              </p>
            )}
          </div>

          {/* Close */}
          <button
            onClick={handleDismiss}
            className="text-white/30 hover:text-white/60 transition p-1 -mt-1 -mr-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Install button (Android/Chrome only) */}
        {!isIOS && deferredPrompt && (
          <button
            onClick={handleInstall}
            className="w-full mt-3 bg-brand text-white rounded-xl py-2.5 text-xs font-bold hover:bg-brand-dark transition active:scale-[0.98]"
          >
            Instalar app
          </button>
        )}
      </div>
    </div>
  )
}
