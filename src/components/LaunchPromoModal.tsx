'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { REFERRAL_CONSTANTS } from '@/lib/referrals'

// ── Embaixadores campaign promo ──
// This modal replaced the old "COPA100/COPA50 cupom" promo on 2026-04-29.
// It surfaces the new launch campaign (referral program) to logged-in users
// of any tier — pagantes also win pontos no ranking, então faz sentido pra
// todos. Auto-stops appearing after the campaign end date.
const PROMO_END_DATE = new Date(REFERRAL_CONSTANTS.CAMPAIGN_END_DATE_ISO)
// Friendly "DD/MM" + "HHhMM" labels in Brazilian locale, derived from the
// canonical end-date constant so we never drift out of sync again.
const CAMPAIGN_END_DAY = PROMO_END_DATE.toLocaleDateString('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
})
const CAMPAIGN_END_TIME = PROMO_END_DATE.toLocaleTimeString('pt-BR', {
  timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
}).replace(':', 'h')
const STORAGE_KEY = 'embaixadores-promo-last-shown'
// Show once every 3 days (campaign is short — don't burn out users)
const REPEAT_MS = 3 * 24 * 60 * 60 * 1000
const DELAY_MS = 8_000

export default function LaunchPromoModal() {
  const router = useRouter()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (Date.now() > PROMO_END_DATE.getTime()) return

    const lastShown = localStorage.getItem(STORAGE_KEY)
    if (lastShown && Date.now() - Number(lastShown) < REPEAT_MS) return

    let cancelled = false
    let timerId: ReturnType<typeof setTimeout> | null = null

    ;(async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return

      // Show to everyone (free + paid). Paid users still benefit from ranking
      // and from sharing their code. Skip only on /campanha itself (avoid
      // redundancy — they're already there).
      if (typeof window !== 'undefined' && window.location.pathname.startsWith('/campanha')) {
        return
      }

      timerId = setTimeout(() => {
        if (!cancelled) setVisible(true)
      }, DELAY_MS)
    })()

    return () => {
      cancelled = true
      if (timerId) clearTimeout(timerId)
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = original
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  function close() {
    localStorage.setItem(STORAGE_KEY, String(Date.now()))
    setVisible(false)
  }

  function goToCampanha() {
    localStorage.setItem(STORAGE_KEY, String(Date.now()))
    setVisible(false)
    router.push('/campanha')
  }

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="embaixadores-promo-title"
      onClick={close}
    >
      <div
        className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={close}
          aria-label="Fechar"
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-white/90 hover:bg-gray-100 flex items-center justify-center text-gray-500 hover:text-gray-800 transition shadow-sm"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="bg-gradient-to-br from-[#0A1628] via-[#1A2332] to-[#0A1628] px-6 pt-7 pb-6 text-center">
          <div className="text-4xl mb-2">🏆</div>
          <p className="text-[10px] font-bold tracking-widest text-[#FFB800] uppercase mb-1">
            Campanha de Lançamento
          </p>
          <h2 id="embaixadores-promo-title" className="text-2xl font-black text-white leading-tight">
            Embaixadores{' '}
            <span className="text-[#00C896]">Complete Aí</span>
          </h2>
          <p className="text-xs text-gray-300 mt-2">Indique amigos. Ganhe figurinhas.</p>
        </div>

        <div className="px-6 py-6 space-y-3">
          <PromoLine icon="🎁" text="A cada amigo cadastrado: +1 scan grátis" />
          <PromoLine icon="🎫" text="A cada 5 amigos: cupom 50% off (48h)" />
          <PromoLine icon="💎" text="Amigo que assina = 5 pontos pra você" />
          <PromoLine icon="🥇" text="Top 3 da campanha ganha pacotes em casa" />

          <div className="rounded-2xl border-2 border-[#00C896] bg-[#E6FAF4] p-3 text-center">
            <p className="text-xs font-bold text-[#0A1628]">
              Campanha vai até <span className="text-[#00A67D]">{CAMPAIGN_END_DAY} às {CAMPAIGN_END_TIME}</span>
            </p>
            <p className="text-[10px] text-gray-600 mt-0.5">Bora começar agora?</p>
          </div>

          <button
            onClick={goToCampanha}
            className="w-full bg-[#00C896] text-white font-bold rounded-2xl py-3.5 text-sm hover:bg-[#00A67D] active:scale-[0.98] transition shadow-lg shadow-[#00C896]/30"
          >
            Quero participar
          </button>
          <button
            onClick={close}
            className="w-full text-center text-xs text-gray-500 hover:text-gray-700 transition py-1"
          >
            Mais tarde
          </button>
        </div>
      </div>
    </div>
  )
}

function PromoLine({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xl">{icon}</span>
      <span className="text-sm text-gray-700 leading-tight">{text}</span>
    </div>
  )
}
