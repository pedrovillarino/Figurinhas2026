'use client'

/**
 * Wrapper client da faixa persistente do Quick Start. Faz fetch leve do
 * status do user 1× por mount e renderiza a faixa só se o user está em
 * modo ativo (step ≠ NULL && ≠ 'done'). Clicar na faixa navega pra
 * /album?qs=1 (ou /album?qs=resume) que reabre o wizard.
 *
 * Pedro 2026-05-11: vai no protected/layout.tsx pra cobrir todas as
 * telas do app durante o modo. Pequeno custo de fetch (cache 60s) é
 * aceitável — sem isso a feature perde a UX de "modo ativo".
 */
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { QuickStartModeBar, type QuickStartStep } from './QuickStart'

export default function QuickStartModeBarWrapper() {
  const [step, setStep] = useState<QuickStartStep>(null)
  const [loaded, setLoaded] = useState(false)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    let cancelled = false
    fetch('/api/album/quick-start')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        setStep((data?.step ?? null) as QuickStartStep)
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
    // Refetch quando muda de rota — ações na própria página podem ter mudado
    // o step (ex: completar passo no wizard).
  }, [pathname])

  if (!loaded) return null

  function handleResume() {
    // Navega pra /album com query param que o AlbumClient interpreta como
    // "abre o wizard onde parou".
    router.push('/album?qs=resume')
  }

  return <QuickStartModeBar step={step} onResume={handleResume} />
}
