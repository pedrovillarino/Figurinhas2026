'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { shouldShowModal, markModalOpen, markModalClosed, MODAL_PRIORITY } from '@/lib/modal-coordinator'

// Onboarding nudge for the scan feature.
//
// Why: data showed 88% of signups never test the scan, and scanners convert
// 2.3x more than non-scanners. Surfacing the scan as the first thing users
// do after signup is the highest-leverage retention move available.
//
// Trigger logic (all must be true):
//   1. User is logged in
//   2. User signed up in the last 3 days (don't bother veterans)
//   3. User has never scanned (zero rows in scan_usage)
//   4. User hasn't already dismissed this prompt (localStorage)
//
// Show on /album mount with a 3s delay (let the page settle first), one
// time per user (dismiss persists).
const STORAGE_KEY = 'first_scan_prompt_dismissed_v1'
const MAX_DAYS_AFTER_SIGNUP = 3
const SHOW_DELAY_MS = 3000

export default function FirstScanPrompt() {
  const router = useRouter()
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (localStorage.getItem(STORAGE_KEY) === 'true') return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    ;(async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user || cancelled) return

        // Check signup recency
        const { data: profile } = await supabase
          .from('profiles')
          .select('created_at, excluded_from_campaign')
          .eq('id', user.id)
          .maybeSingle()
        if (!profile || cancelled) return

        const prof = profile as { created_at: string | null; excluded_from_campaign: boolean | null }
        if (prof.excluded_from_campaign) return // Owner/team — skip

        if (prof.created_at) {
          const ageDays = (Date.now() - new Date(prof.created_at).getTime()) / (24 * 3600 * 1000)
          if (ageDays > MAX_DAYS_AFTER_SIGNUP) return
        }

        // Has the user ever scanned?
        const { count } = await supabase
          .from('scan_usage')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)

        if ((count ?? 0) > 0 || cancelled) return // Already scanned, leave them alone

        // All conditions met — show after delay (and only if no other modal
        // is hogging the screen)
        timer = setTimeout(() => {
          if (cancelled) return
          if (!shouldShowModal('first_scan_prompt', MODAL_PRIORITY.FIRST_SCAN_PROMPT)) return
          markModalOpen('first_scan_prompt', MODAL_PRIORITY.FIRST_SCAN_PROMPT)
          setShow(true)
        }, SHOW_DELAY_MS)
      } catch {
        // Silent fail — don't break the page if Supabase is slow
      }
    })()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  // Lock body scroll when shown
  useEffect(() => {
    if (!show) return
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = original
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, 'true')
    markModalClosed('first_scan_prompt')
    setShow(false)
  }

  function goToScan() {
    localStorage.setItem(STORAGE_KEY, 'true')
    markModalClosed('first_scan_prompt')
    setShow(false)
    router.push('/scan')
  }

  if (!show) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-scan-title"
      onClick={dismiss}
    >
      <div
        className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={dismiss}
          aria-label="Fechar"
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-white/90 hover:bg-gray-100 flex items-center justify-center text-gray-500 hover:text-gray-800 transition shadow-sm"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Hero */}
        <div className="bg-gradient-to-br from-[#0A1628] via-[#1A2332] to-[#0A1628] px-6 pt-7 pb-6 text-center">
          <div className="text-5xl mb-2">📸</div>
          <p className="text-[10px] font-bold tracking-widest text-[#FFB800] uppercase mb-1">
            Bem-vindo!
          </p>
          <h2 id="first-scan-title" className="text-2xl font-black text-white leading-tight">
            Catalogue suas figurinhas{' '}
            <span className="text-[#00C896]">com a câmera</span>
          </h2>
          <p className="text-xs text-gray-300 mt-2">A IA identifica todas em segundos.</p>
        </div>

        {/* Benefits */}
        <div className="px-6 py-5 space-y-2.5">
          <Bullet icon="⚡" text="Escaneia até 20 figurinhas por foto" />
          <Bullet icon="✨" text="Marca o álbum sozinho — sem clicar uma a uma" />
          <Bullet icon="🎁" text="Você ganha 5 scans grátis pra começar" />

          <button
            onClick={goToScan}
            className="w-full mt-4 bg-[#00C896] text-white font-bold rounded-2xl py-3.5 text-sm hover:bg-[#00A67D] active:scale-[0.98] transition shadow-lg shadow-[#00C896]/30"
          >
            📸 Escanear minha primeira figurinha
          </button>
          <button
            onClick={dismiss}
            className="w-full text-center text-xs text-gray-500 hover:text-gray-700 transition py-2"
          >
            Já tenho minhas figurinhas marcadas
          </button>
        </div>
      </div>
    </div>
  )
}

function Bullet({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xl shrink-0">{icon}</span>
      <span className="text-sm text-gray-700 leading-tight">{text}</span>
    </div>
  )
}
