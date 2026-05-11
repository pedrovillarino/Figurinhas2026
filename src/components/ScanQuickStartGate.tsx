'use client'

/**
 * Gate client-side pro /scan durante o Quick Start. Se o user está no
 * modo (step ≠ null && ≠ 'done'), bloqueia o scan e mostra
 * QuickStartScanBlock no lugar dos children. Caso contrário renderiza
 * normalmente.
 *
 * Pedro 2026-05-11: o /scan precisa ser bloqueado durante o modo pra
 * cumprir o compromisso "completa os 3 passos pra usar recursos
 * normais". Em PRs futuros pode evoluir pra um scan dedicado a
 * faltantes/repetidas — por enquanto bloqueia + direciona ao wizard.
 */
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { QuickStartScanBlock, type QuickStartStep } from './QuickStart'

export default function ScanQuickStartGate({
  initialStep,
  children,
}: {
  initialStep: QuickStartStep
  children: React.ReactNode
}) {
  const [step, setStep] = useState<QuickStartStep>(initialStep)
  const router = useRouter()

  if (step === null || step === 'done') {
    return <>{children}</>
  }

  async function handleExit() {
    if (!confirm('Sair do Quick Start? Você pode voltar depois — o que já registrou continua salvo.')) return
    try {
      const res = await fetch('/api/album/quick-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'exit' }),
      })
      if (res.ok) {
        setStep(null)
        router.refresh()
      }
    } catch (err) {
      console.error('[scan-gate] exit failed:', err)
    }
  }

  function handleResume() {
    router.push('/album?qs=resume')
  }

  return (
    <main className="pb-24 pt-2">
      <QuickStartScanBlock step={step} onResume={handleResume} onExit={handleExit} />
    </main>
  )
}
