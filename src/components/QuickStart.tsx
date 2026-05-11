'use client'

/**
 * Quick Start — modo onboarding em 3 passos pra quem já tem >50% do
 * álbum físico colado. Em vez de marcar uma por uma, user lista as
 * faltantes e o sistema marca todo o resto.
 *
 * Exportado:
 *  - <QuickStartBanner /> — banner promocional no topo do /album.
 *    Só aparece se progresso < 10% E step IS NULL.
 *  - <QuickStartWizard /> — modal de 3 passos (controlled).
 *  - <QuickStartModeBar /> — faixa amarela persistente em telas
 *    relevantes enquanto o user está no modo.
 *  - <QuickStartScanBlock /> — bloqueio do /scan quando em modo ativo.
 */
import { useState, useCallback } from 'react'
import Link from 'next/link'

export type QuickStartStep = 'missing' | 'extras' | 'duplicates' | 'done' | null

const STEP_INDEX: Record<Exclude<QuickStartStep, null>, number> = {
  missing: 1,
  extras: 2,
  duplicates: 3,
  done: 3,
}

export function isInQuickStart(step: QuickStartStep): boolean {
  return step !== null && step !== 'done'
}

// ─── Banner promocional (entrada do fluxo) ─────────────────────────
export function QuickStartBanner({
  progressPct,
  step,
  onStart,
}: {
  progressPct: number
  step: QuickStartStep
  onStart: () => void
}) {
  const [dismissed, setDismissed] = useState(false)
  // Critério: user com poucas figurinhas marcadas no app (<10%) E que
  // ainda não passou pelo Quick Start (step NULL — 'done' significa que
  // já passou ou saiu, não mostra mais).
  if (step !== null) return null
  if (progressPct >= 10) return null
  if (dismissed) return null

  return (
    <div className="rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
          <span className="text-xl">✨</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-gray-900 leading-tight">
            Já tem mais de 50% do álbum colado?
          </h3>
          <p className="text-[12px] text-gray-600 mt-1 leading-snug">
            Quick Start cadastra suas figurinhas em <strong>3 passos</strong> —
            você lista só as poucas que <strong>faltam</strong> e a gente
            preenche o resto.
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2">
        <button
          type="button"
          onClick={onStart}
          className="w-full px-4 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 active:scale-[0.98] transition shadow-sm"
        >
          Começar Quick Start →
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="w-full px-4 py-2 text-xs text-gray-500 hover:text-gray-700 transition"
        >
          Não, continuar do jeito normal
          <span className="block text-[10px] text-gray-400 mt-0.5">
            (recomendado pra quem tem &lt; 50% do álbum)
          </span>
        </button>
      </div>
    </div>
  )
}

// ─── Faixa persistente: avisa que está no modo ─────────────────────
export function QuickStartModeBar({
  step,
  onResume,
}: {
  step: QuickStartStep
  onResume: () => void
}) {
  if (!isInQuickStart(step)) return null
  const stepNum = step ? STEP_INDEX[step] : 1
  const stepLabel =
    step === 'missing'
      ? 'Registrar faltantes'
      : step === 'extras'
        ? 'Registrar extras'
        : 'Registrar repetidas'

  return (
    <button
      type="button"
      onClick={onResume}
      className="w-full flex items-center justify-between gap-3 px-4 py-2.5 bg-amber-400 hover:bg-amber-500 transition text-amber-950 text-sm font-semibold border-b-2 border-amber-500"
      aria-label="Voltar ao Quick Start"
    >
      <span className="flex items-center gap-2 min-w-0">
        <span className="text-base">🟡</span>
        <span className="truncate">
          Quick Start — Passo {stepNum} de 3: {stepLabel}
        </span>
      </span>
      <span className="text-xs font-bold whitespace-nowrap">Voltar ao wizard →</span>
    </button>
  )
}

// ─── Bloqueio do /scan ─────────────────────────────────────────────
export function QuickStartScanBlock({
  step,
  onResume,
  onExit,
}: {
  step: QuickStartStep
  onResume: () => void
  onExit: () => void
}) {
  if (!isInQuickStart(step)) return null
  const stepNum = step ? STEP_INDEX[step] : 1
  return (
    <div className="mx-4 mt-4 rounded-2xl border-2 border-amber-200 bg-amber-50 p-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-2xl">🟡</span>
        <h2 className="text-base font-bold text-amber-900">
          Quick Start em andamento
        </h2>
      </div>
      <p className="text-sm text-amber-900 leading-relaxed mb-3">
        Você está no <strong>Passo {stepNum} de 3</strong> do modo Quick Start.
        O scan está pausado até você concluir o cadastro inicial pelo wizard.
      </p>
      <p className="text-xs text-amber-800 mb-4 leading-relaxed">
        Isso evita confusão — durante o Quick Start, o scan será dedicado a
        ler faltantes e repetidas (não coladas).
      </p>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onResume}
          className="w-full px-4 py-2.5 bg-amber-600 text-white font-semibold rounded-lg hover:bg-amber-700 active:scale-95 transition text-sm"
        >
          Continuar Quick Start →
        </button>
        <button
          type="button"
          onClick={onExit}
          className="w-full px-4 py-2 text-xs text-amber-800 hover:text-amber-900 transition"
        >
          Sair do modo e usar o scan normal
        </button>
      </div>
    </div>
  )
}

// ─── Wizard (modal de 3 passos) ────────────────────────────────────
export function QuickStartWizard({
  isOpen,
  onClose,
  step,
  onStepChange,
  onUserStickersChange,
}: {
  isOpen: boolean
  onClose: () => void
  step: QuickStartStep
  onStepChange: (next: QuickStartStep) => void
  /** Callback opcional pra refletir as mudanças no álbum sem F5. */
  onUserStickersChange?: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [missingText, setMissingText] = useState('')
  const [dupesText, setDupesText] = useState('')
  const [lastResult, setLastResult] = useState<{
    markedOwned?: number
    markedMissing?: number
    incremented?: number
    unmatched?: string[]
  } | null>(null)

  const call = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      setLoading(true)
      try {
        const res = await fetch('/api/album/quick-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...extra }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'failed')
        return data as {
          step: QuickStartStep
          markedOwned?: number
          markedMissing?: number
          incremented?: number
          unmatched?: string[]
        }
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  if (!isOpen) return null

  async function handleStart() {
    const data = await call('start')
    onStepChange(data.step)
    setLastResult(null)
  }

  async function handleRegisterMissing() {
    try {
      const data = await call('register_missing', { text: missingText })
      setLastResult({
        markedOwned: data.markedOwned,
        markedMissing: data.markedMissing,
        unmatched: data.unmatched,
      })
      setMissingText('')
      onStepChange(data.step)
      onUserStickersChange?.()
    } catch {
      alert('Não conseguimos processar agora. Tente novamente em alguns minutos.')
    }
  }

  async function handleAdvance() {
    const data = await call('advance')
    onStepChange(data.step)
    setLastResult(null)
  }

  async function handleRegisterDupes() {
    try {
      const data = await call('register_duplicates', { text: dupesText })
      setLastResult({
        incremented: data.incremented,
        unmatched: data.unmatched,
      })
      setDupesText('')
      onStepChange(data.step)
      onUserStickersChange?.()
    } catch {
      alert('Não conseguimos processar agora. Tente novamente em alguns minutos.')
    }
  }

  async function handleExit() {
    if (!confirm('Sair do Quick Start? Você pode voltar depois — o que já registrou continua salvo.')) return
    const data = await call('exit')
    onStepChange(data.step)
    onClose()
  }

  async function handleComplete() {
    const data = await call('complete')
    onStepChange(data.step)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={() => !loading && onClose()}
    >
      <div
        className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xl">✨</span>
            <h2 className="text-base font-bold text-gray-900 truncate">
              Quick Start
              {isInQuickStart(step) && (
                <span className="text-gray-400 font-normal text-xs ml-2">
                  Passo {STEP_INDEX[step as Exclude<QuickStartStep, null>]} de 3
                </span>
              )}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="text-gray-400 hover:text-gray-600 p-1 -mr-1 disabled:opacity-50"
            aria-label="Fechar"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5">
          {/* ─── Tela 0: entrada / aviso ─── */}
          {step === null && (
            <>
              <p className="text-sm text-gray-700 leading-relaxed mb-3">
                O <strong>Quick Start</strong> é pra você se já tem mais de
                metade do álbum físico colado. Em vez de marcar uma por uma,
                a gente cadastra tudo em <strong>3 passos guiados</strong>:
              </p>
              <ol className="text-sm text-gray-700 space-y-2 mb-4 pl-5 list-decimal">
                <li>
                  <strong>Listar as faltantes</strong> — você digita ou cola os
                  códigos. A gente marca todo o resto como <em>colado</em>.
                </li>
                <li>
                  <strong>Registrar extras especiais</strong> (Coca-Cola, PANINI Extras) — manual ou pular.
                </li>
                <li>
                  <strong>Registrar repetidas</strong> — você lista as duplicatas que tem.
                </li>
              </ol>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
                <p className="text-xs text-amber-900 leading-relaxed">
                  ⚠️ <strong>Durante o Quick Start o app fica nesse modo</strong> até
                  você concluir os 3 passos (ou sair). O scan vai ficar pausado —
                  você usa as listas dentro do wizard.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 active:scale-95 transition disabled:opacity-50 text-sm"
                >
                  Agora não
                </button>
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={loading}
                  className="flex-1 px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 active:scale-95 transition disabled:opacity-50 text-sm"
                >
                  {loading ? 'Iniciando…' : 'Sim, começar →'}
                </button>
              </div>
            </>
          )}

          {/* ─── Passo 1: faltantes ─── */}
          {step === 'missing' && (
            <>
              <h3 className="text-base font-bold text-gray-900 mb-1">
                Quais figurinhas você <span className="text-red-600">NÃO</span> tem?
              </h3>
              <p className="text-xs text-gray-600 mb-3 leading-relaxed">
                Digite ou cole os <strong>códigos das que faltam</strong> — separados por vírgula, espaço ou linha. A gente marca <strong>todo o resto</strong> como colado.
              </p>
              <textarea
                value={missingText}
                onChange={(e) => setMissingText(e.target.value)}
                disabled={loading}
                placeholder={'Ex:\nBRA-1, BRA-5, ARG-3\nMAR-12\nBrasil: 7, 9, 14'}
                rows={7}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-100 text-sm font-mono"
                autoFocus
              />
              <p className="text-[11px] text-gray-500 italic mb-4 leading-relaxed">
                Aceita formatos: <code className="bg-gray-100 px-1 rounded">BRA-1</code>,{' '}
                <code className="bg-gray-100 px-1 rounded">Brasil: 1, 5, 7</code> ou só números
                quando agrupado por país.
              </p>
              {lastResult?.unmatched && lastResult.unmatched.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3 text-xs text-amber-900">
                  <strong>Códigos não reconhecidos:</strong>{' '}
                  {lastResult.unmatched.slice(0, 10).join(', ')}
                  {lastResult.unmatched.length > 10 && `… +${lastResult.unmatched.length - 10}`}
                </div>
              )}
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleRegisterMissing}
                  disabled={loading}
                  className="w-full px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 active:scale-95 transition disabled:opacity-50 text-sm"
                >
                  {loading ? 'Marcando…' : 'Marcar resto como colado →'}
                </button>
                <button
                  type="button"
                  onClick={handleExit}
                  disabled={loading}
                  className="w-full px-4 py-2 text-xs text-gray-500 hover:text-gray-700 transition"
                >
                  Sair do Quick Start
                </button>
              </div>
              <p className="text-[10px] text-gray-400 italic mt-3 leading-relaxed">
                ↩️ Pode desfazer enviando <strong>desfaz</strong> no WhatsApp nos próximos 10min.
              </p>
            </>
          )}

          {/* ─── Passo 2: extras especiais ─── */}
          {step === 'extras' && (
            <>
              {lastResult?.markedOwned !== undefined && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-3">
                  <p className="text-xs text-emerald-900">
                    ✅ <strong>{lastResult.markedOwned}</strong> figurinha
                    {lastResult.markedOwned !== 1 ? 's' : ''} marcada
                    {lastResult.markedOwned !== 1 ? 's' : ''} como colada
                    {lastResult.markedOwned !== 1 ? 's' : ''}.
                    {lastResult.markedMissing ? (
                      <>
                        {' '}
                        <strong>{lastResult.markedMissing}</strong> deixada
                        {lastResult.markedMissing !== 1 ? 's' : ''} como faltando.
                      </>
                    ) : null}
                  </p>
                </div>
              )}
              <h3 className="text-base font-bold text-gray-900 mb-1">
                Você tem alguma figurinha <span className="text-amber-600">extra</span>?
              </h3>
              <p className="text-xs text-gray-600 mb-3 leading-relaxed">
                Os <strong>Coca-Cola</strong> e <strong>PANINI Extras</strong> não fazem
                parte das 980 do álbum, mas são colecionáveis. Se você tem algum, marque
                manualmente no álbum. Caso contrário, pode pular este passo.
              </p>
              <div className="flex flex-col gap-2">
                <Link
                  href="/album?tab=extras"
                  onClick={onClose}
                  className="w-full px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 active:scale-95 transition text-sm text-center"
                >
                  Marcar manualmente na aba Extras →
                </Link>
                <button
                  type="button"
                  onClick={handleAdvance}
                  disabled={loading}
                  className="w-full px-4 py-2.5 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 active:scale-95 transition disabled:opacity-50 text-sm"
                >
                  {loading ? 'Avançando…' : 'Não tenho extras — pular →'}
                </button>
                <button
                  type="button"
                  onClick={handleAdvance}
                  disabled={loading}
                  className="w-full px-4 py-2 text-xs text-emerald-700 hover:text-emerald-800 transition font-semibold"
                >
                  Já marquei os extras — continuar →
                </button>
              </div>
            </>
          )}

          {/* ─── Passo 3: repetidas ─── */}
          {step === 'duplicates' && (
            <>
              <h3 className="text-base font-bold text-gray-900 mb-1">
                Você tem <span className="text-blue-600">figurinhas repetidas</span>?
              </h3>
              <p className="text-xs text-gray-600 mb-3 leading-relaxed">
                Liste os <strong>códigos das repetidas</strong> — uma vez por unidade extra. Ex: se tem 3 cópias da BRA-1, digite <code className="bg-gray-100 px-1 rounded">BRA-1, BRA-1</code> (a primeira já tá colada do passo 1, faltam 2).
              </p>
              <textarea
                value={dupesText}
                onChange={(e) => setDupesText(e.target.value)}
                disabled={loading}
                placeholder={'Ex:\nBRA-1, BRA-1, ARG-5\nMAR-12'}
                rows={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 text-sm font-mono"
                autoFocus
              />
              {lastResult?.unmatched && lastResult.unmatched.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3 text-xs text-amber-900">
                  <strong>Códigos não reconhecidos:</strong>{' '}
                  {lastResult.unmatched.slice(0, 10).join(', ')}
                </div>
              )}
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleRegisterDupes}
                  disabled={loading}
                  className="w-full px-4 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 active:scale-95 transition disabled:opacity-50 text-sm"
                >
                  {loading ? 'Registrando…' : 'Registrar repetidas →'}
                </button>
                <button
                  type="button"
                  onClick={handleAdvance}
                  disabled={loading}
                  className="w-full px-4 py-2 text-xs text-gray-500 hover:text-gray-700 transition"
                >
                  Não tenho repetidas — concluir
                </button>
              </div>
            </>
          )}

          {/* ─── Tela final ─── */}
          {step === 'done' && (
            <>
              <div className="text-center py-2">
                <div className="text-5xl mb-3">🎉</div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">
                  Quick Start concluído!
                </h3>
                <p className="text-sm text-gray-600 mb-4 leading-relaxed">
                  Seu álbum está cadastrado. Agora você pode usar o app
                  normalmente: scan, áudio, trocas — tudo liberado.
                </p>
                {lastResult?.incremented !== undefined && lastResult.incremented > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 text-xs text-blue-900 text-left">
                    ✅ <strong>{lastResult.incremented}</strong> repetida
                    {lastResult.incremented !== 1 ? 's' : ''} registrada
                    {lastResult.incremented !== 1 ? 's' : ''}.
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleComplete}
                  disabled={loading}
                  className="w-full px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 active:scale-95 transition disabled:opacity-50 text-sm"
                >
                  {loading ? 'Fechando…' : 'Fechar e usar o app'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
