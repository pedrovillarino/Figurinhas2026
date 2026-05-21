'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { shouldShowModal, markModalOpen, markModalClosed, MODAL_PRIORITY } from '@/lib/modal-coordinator'

// ── Liga Complete Aí 2026 promo ──
// Substituiu o promo da campanha Embaixadores em 21/05 (Embaixadores encerrou
// 12/05 e a Liga começou 15/05 09:00 BRT). Surface pra users autenticados que
// AINDA NÃO deram opt-in na Liga (liga_opt_in_at IS NULL).
//
// Estrutura/cooldown preservados do anterior: aparece 8s após login, a cada
// 3 dias, respeita modal-coordinator (não pisa em FirstScan / Onboarding) e
// pula novos users (<24h) e quem já está em /liga.
const PROMO_END_DATE = new Date('2026-07-16T23:59:59-03:00') // fim da T4
const STORAGE_KEY = 'liga-promo-last-shown'
const REPEAT_MS = 3 * 24 * 60 * 60 * 1000 // a cada 3 dias
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

      // Skip on /liga (user já está vendo a Liga; modal seria redundante).
      if (typeof window !== 'undefined' && window.location.pathname.startsWith('/liga')) {
        return
      }

      // Skip pra brand-new users (< 24h) — eles ainda estão no fluxo de
      // onboarding (legal/age + tutorial). Liga entra depois.
      // Também skipa se já deu opt-in na Liga.
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('created_at, liga_opt_in_at')
          .eq('id', user.id)
          .maybeSingle()
        const p = profile as { created_at?: string; liga_opt_in_at?: string | null } | null
        if (p?.liga_opt_in_at) return // já participa
        const createdAt = p?.created_at
        if (createdAt) {
          const ageHours = (Date.now() - new Date(createdAt).getTime()) / (3600 * 1000)
          if (ageHours < 24) return
        }
      } catch { /* segue mostrando se profile falhar */ }

      timerId = setTimeout(() => {
        if (cancelled) return
        if (!shouldShowModal('launch_promo', MODAL_PRIORITY.LAUNCH_PROMO)) return
        markModalOpen('launch_promo', MODAL_PRIORITY.LAUNCH_PROMO)
        setVisible(true)
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
    markModalClosed('launch_promo')
    setVisible(false)
  }

  function goToLiga() {
    localStorage.setItem(STORAGE_KEY, String(Date.now()))
    markModalClosed('launch_promo')
    setVisible(false)
    router.push('/liga')
  }

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="liga-promo-title"
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
            Já começou
          </p>
          <h2 id="liga-promo-title" className="text-2xl font-black text-white leading-tight">
            Liga{' '}
            <span className="text-[#00C896]">Complete Aí 2026</span>
          </h2>
          <p className="text-xs text-gray-300 mt-2">Acumule pontos durante a Copa. Top 3 ganha brindes.</p>
        </div>

        <div className="px-6 py-6 space-y-3">
          <PromoLine icon="📸" text="Cada figurinha registrada vira pontos" />
          <PromoLine icon="🔓" text="Bata marcos e desbloqueie cupons e scans extras" />
          <PromoLine icon="🥇" text="Top 3 de cada Temporada ganha porta-figurinhas + pacotes" />
          <PromoLine icon="🏆" text="Campeão Geral em 17/07 leva kit colecionador completo" />

          <div className="rounded-2xl border-2 border-[#00C896] bg-[#E6FAF4] p-3 text-center">
            <p className="text-xs font-bold text-[#0A1628]">
              T1 já está rolando · termina em <span className="text-[#00A67D]">30/05</span>
            </p>
            <p className="text-[10px] text-gray-600 mt-0.5">Quanto antes começar, mais pontos acumula.</p>
          </div>

          <button
            onClick={goToLiga}
            className="w-full bg-[#00C896] text-white font-bold rounded-2xl py-3.5 text-sm hover:bg-[#00A67D] active:scale-[0.98] transition shadow-lg shadow-[#00C896]/30"
          >
            Entrar na Liga
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
