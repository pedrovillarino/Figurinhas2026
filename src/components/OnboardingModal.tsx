'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'

const ONBOARDING_KEY = 'completeai_onboarding_v2'

type OnboardingStep = 'age' | 'terms' | 'tutorial'

const tutorialSteps = [
  {
    icon: '📖',
    title: 'Bem-vindo ao Complete Aí!',
    description: 'Gerencie seu álbum da Copa 2026. Marque coladas, faltantes e repetidas com facilidade.',
  },
  {
    icon: '👆',
    title: 'Toque para marcar',
    description: 'Toque em uma figurinha para expandir. Use + e - para ajustar a quantidade. Repetidas ficam com borda verde.',
  },
  {
    icon: '📸',
    title: 'Escaneie com IA',
    description: 'Tire uma foto da página do álbum e a IA identifica todas as figurinhas automaticamente. Muito mais rápido!',
  },
  {
    icon: '🔄',
    title: 'Encontre trocas',
    description: 'Na aba Trocas, veja quem perto de você tem as figurinhas que você precisa. Troque repetidas e complete mais rápido!',
  },
]

export default function OnboardingModal() {
  const [show, setShow] = useState(false)
  const [phase, setPhase] = useState<OnboardingStep>('age')
  const [tutorialIdx, setTutorialIdx] = useState(0)

  // Age verification
  const [birthDay, setBirthDay] = useState('')
  const [birthMonth, setBirthMonth] = useState('')
  const [birthYear, setBirthYear] = useState('')
  const [ageError, setAgeError] = useState('')
  const [isMinor, setIsMinor] = useState(false)

  // Terms
  const [termsAccepted, setTermsAccepted] = useState(false)

  const [saving, setSaving] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    async function checkOnboarding() {
      // First check localStorage (fast)
      const seen = localStorage.getItem(ONBOARDING_KEY)
      if (seen) return

      // Then check database — maybe user already completed on another device
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('tos_accepted_at, date_of_birth')
            .eq('id', user.id)
            .single()

          if (profile?.tos_accepted_at && profile?.date_of_birth) {
            // Already completed on another device — save locally and skip
            localStorage.setItem(ONBOARDING_KEY, 'true')
            return
          }
        }
      } catch {
        // If DB check fails, show onboarding anyway
      }

      setShow(true)
    }
    checkOnboarding()
  }, [])

  function calculateAge(day: number, month: number, year: number): number {
    const today = new Date()
    const birth = new Date(year, month - 1, day)
    let age = today.getFullYear() - birth.getFullYear()
    const monthDiff = today.getMonth() - birth.getMonth()
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--
    }
    return age
  }

  function handleAgeSubmit() {
    setAgeError('')
    const day = parseInt(birthDay)
    const month = parseInt(birthMonth)
    const year = parseInt(birthYear)

    if (!day || !month || !year || day < 1 || day > 31 || month < 1 || month > 12 || year < 1920 || year > 2026) {
      setAgeError('Data inválida.')
      return
    }

    const age = calculateAge(day, month, year)

    if (age < 13) {
      setAgeError('O Complete Aí não está disponível para menores de 13 anos.')
      return
    }

    setIsMinor(age < 18)
    setPhase('terms')
  }

  async function handleTermsAccept() {
    if (!termsAccepted) return
    setSaving(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const day = parseInt(birthDay)
        const month = parseInt(birthMonth)
        const year = parseInt(birthYear)
        const dob = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

        await supabase
          .from('profiles')
          .update({
            date_of_birth: dob,
            is_minor: isMinor,
            tos_accepted_at: new Date().toISOString(),
            tos_version: '1.0',
          })
          .eq('id', user.id)
      }
    } catch (err) {
      console.error('Error saving onboarding data:', err)
    }

    setSaving(false)
    setPhase('tutorial')
  }

  function handleClose() {
    localStorage.setItem(ONBOARDING_KEY, 'true')
    setShow(false)
  }

  function handleTutorialNext() {
    if (tutorialIdx < tutorialSteps.length - 1) {
      setTutorialIdx(tutorialIdx + 1)
    } else {
      handleClose()
    }
  }

  useBodyScrollLock(show)

  if (!show) return null

  // Total step count for indicator
  const totalDots = 2 + tutorialSteps.length // age + terms + tutorial steps
  const currentDot = phase === 'age' ? 0 : phase === 'terms' ? 1 : 2 + tutorialIdx

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-xl animate-slide-up">
        {/* Step indicator */}
        <div className="flex gap-1.5 justify-center mb-5">
          {Array.from({ length: totalDots }).map((_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full transition-all duration-300 ${
                i === currentDot ? 'w-6 bg-brand' : 'w-1.5 bg-gray-200'
              }`}
            />
          ))}
        </div>

        {/* ── Age Verification ── */}
        {phase === 'age' && (
          <>
            <div className="text-center mb-5">
              <div className="text-5xl mb-4">🎂</div>
              <h2 className="text-lg font-bold text-gray-900 mb-2">Qual sua data de nascimento?</h2>
              <p className="text-xs text-gray-500 leading-relaxed">
                Precisamos confirmar sua idade para cumprir a legislação brasileira.
              </p>
            </div>

            <div className="flex gap-2 mb-4">
              <div className="flex-1">
                <label className="block text-[10px] text-gray-400 mb-1 font-medium">Dia</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="31"
                  value={birthDay}
                  onChange={(e) => setBirthDay(e.target.value)}
                  placeholder="DD"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-center text-navy focus:ring-2 focus:ring-brand/30 focus:border-brand outline-none"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[10px] text-gray-400 mb-1 font-medium">Mês</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="12"
                  value={birthMonth}
                  onChange={(e) => setBirthMonth(e.target.value)}
                  placeholder="MM"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-center text-navy focus:ring-2 focus:ring-brand/30 focus:border-brand outline-none"
                />
              </div>
              <div className="flex-[1.5]">
                <label className="block text-[10px] text-gray-400 mb-1 font-medium">Ano</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1920"
                  max="2026"
                  value={birthYear}
                  onChange={(e) => setBirthYear(e.target.value)}
                  placeholder="AAAA"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-center text-navy focus:ring-2 focus:ring-brand/30 focus:border-brand outline-none"
                />
              </div>
            </div>

            {ageError && (
              <p className="text-xs text-red-500 text-center mb-3">{ageError}</p>
            )}

            <button
              onClick={handleAgeSubmit}
              disabled={!birthDay || !birthMonth || !birthYear}
              className="w-full py-3 rounded-xl text-sm font-bold text-white bg-brand hover:bg-brand-dark transition active:scale-[0.98] disabled:opacity-50"
            >
              Continuar
            </button>
          </>
        )}

        {/* ── Terms Acceptance ── */}
        {phase === 'terms' && (
          <>
            <div className="text-center mb-4">
              <div className="text-5xl mb-4">📋</div>
              <h2 className="text-lg font-bold text-gray-900 mb-2">Termos e Privacidade</h2>
              <p className="text-xs text-gray-500 leading-relaxed">
                Para usar o Complete Aí, você precisa aceitar nossos termos.
              </p>
            </div>

            {isMinor && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 mb-4">
                <p className="text-xs text-amber-700 leading-relaxed">
                  Como você é menor de 18, algumas funcionalidades possuem restrições adicionais para sua segurança.
                </p>
              </div>
            )}

            <div className="bg-gray-50 rounded-xl p-3 mb-4 max-h-32 overflow-y-auto">
              <p className="text-[10px] text-gray-500 leading-relaxed">
                O Complete Aí é uma plataforma para organizar e trocar figurinhas de futebol.
                Coletamos nome, e-mail e data de nascimento. Para o recurso de trocas, coletamos
                localização aproximada e telefone (opcional). Fotos do scanner são processadas e
                descartadas imediatamente, sem armazenamento. Este app não é afiliado à FIFA, Panini
                ou qualquer organização oficial. O serviço é válido até 31/12/2026.
              </p>
            </div>

            <label className="flex items-start gap-2.5 mb-5 cursor-pointer">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-brand focus:ring-brand"
              />
              <span className="text-xs text-gray-600 leading-relaxed">
                Li e concordo com os{' '}
                <a href="/termos" target="_blank" className="text-brand underline">
                  Termos de Serviço
                </a>{' '}
                e a{' '}
                <a href="/privacidade" target="_blank" className="text-brand underline">
                  Política de Privacidade
                </a>
                .
              </span>
            </label>

            <div className="flex gap-3">
              <button
                onClick={() => setPhase('age')}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-gray-500 bg-gray-100 hover:bg-gray-200 transition"
              >
                Voltar
              </button>
              <button
                onClick={handleTermsAccept}
                disabled={!termsAccepted || saving}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white bg-brand hover:bg-brand-dark transition active:scale-[0.98] disabled:opacity-50"
              >
                {saving ? '...' : 'Aceitar'}
              </button>
            </div>
          </>
        )}

        {/* ── Tutorial Steps ── */}
        {phase === 'tutorial' && (
          <>
            <div className="text-center mb-6">
              <div className="text-5xl mb-4">{tutorialSteps[tutorialIdx].icon}</div>
              <h2 className="text-lg font-bold text-gray-900 mb-2">
                {tutorialSteps[tutorialIdx].title}
              </h2>
              <p className="text-sm text-gray-500 leading-relaxed">
                {tutorialSteps[tutorialIdx].description}
              </p>
            </div>

            <div className="flex gap-3">
              {tutorialIdx > 0 && (
                <button
                  onClick={() => setTutorialIdx(tutorialIdx - 1)}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold text-gray-500 bg-gray-100 hover:bg-gray-200 transition"
                >
                  Voltar
                </button>
              )}
              <button
                onClick={handleTutorialNext}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white bg-brand hover:bg-brand-dark transition active:scale-[0.98]"
              >
                {tutorialIdx === tutorialSteps.length - 1 ? 'Começar!' : 'Próximo'}
              </button>
            </div>

            {tutorialIdx < tutorialSteps.length - 1 && (
              <button
                onClick={handleClose}
                className="w-full mt-3 text-xs text-gray-400 hover:text-gray-600 transition"
              >
                Pular tutorial
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
