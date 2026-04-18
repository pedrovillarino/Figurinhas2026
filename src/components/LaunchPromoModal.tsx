'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const PROMO_END_DATE = new Date('2026-05-01T02:59:59Z')
const STORAGE_KEY = 'launch-promo-last-shown'
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const DELAY_MS = 10_000

export default function LaunchPromoModal() {
  const router = useRouter()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (Date.now() > PROMO_END_DATE.getTime()) return

    const lastShown = localStorage.getItem(STORAGE_KEY)
    if (lastShown && Date.now() - Number(lastShown) < WEEK_MS) return

    let cancelled = false
    let timerId: ReturnType<typeof setTimeout> | null = null

    ;(async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('tier')
        .eq('id', user.id)
        .single()

      if (cancelled || !profile || profile.tier !== 'free') return

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

  function goToUpgrade() {
    localStorage.setItem(STORAGE_KEY, String(Date.now()))
    setVisible(false)
    router.push('/upgrade')
  }

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="launch-promo-title"
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
            Pré-lançamento
          </p>
          <h2 id="launch-promo-title" className="text-2xl font-black text-white leading-tight">
            Garanta seu plano com{' '}
            <span className="text-[#00C896]">desconto exclusivo</span>
          </h2>
        </div>

        <div className="px-6 py-6 space-y-4">
          <div className="rounded-2xl border-2 border-[#00C896] bg-[#E6FAF4] p-4">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-xs font-bold tracking-wider text-[#00A67D] uppercase">
                Cupom COPA100
              </span>
              <span className="text-[10px] font-bold text-[#00A67D] bg-white rounded-full px-2 py-0.5">
                100 vagas
              </span>
            </div>
            <p className="text-base font-bold text-navy leading-snug">
              Os 100 primeiros ganham qualquer plano <span className="text-[#00A67D]">100% grátis</span>
            </p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-xs font-bold tracking-wider text-gray-600 uppercase">
                Cupom COPA50
              </span>
              <span className="text-[10px] font-bold text-gray-600 bg-white rounded-full px-2 py-0.5">
                500 vagas
              </span>
            </div>
            <p className="text-sm font-semibold text-navy leading-snug">
              Os próximos 500 ganham <span className="text-[#00A67D]">50% de desconto</span> em qualquer plano
            </p>
          </div>

          <p className="text-[11px] text-center text-gray-500">
            ⏱ Cupons válidos até <strong className="text-navy">30 de abril</strong>
          </p>

          <button
            onClick={goToUpgrade}
            className="w-full bg-[#00C896] text-white font-bold rounded-2xl py-3.5 text-sm hover:bg-[#00A67D] active:scale-[0.98] transition shadow-lg shadow-[#00C896]/30"
          >
            Ver planos e usar cupom
          </button>
          <button
            onClick={close}
            className="w-full text-center text-xs text-gray-500 hover:text-gray-700 transition py-1"
          >
            Continuar navegando
          </button>
        </div>
      </div>
    </div>
  )
}
