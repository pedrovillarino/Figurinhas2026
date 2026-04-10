'use client'

import { useState, useEffect } from 'react'

const ONBOARDING_KEY = 'figurinhas_onboarding_v1'

const steps = [
  {
    icon: '📖',
    title: 'Bem-vindo ao Figurinhas 2026!',
    description: 'Gerencie seu album da Copa do Mundo. Marque coladas, faltantes e repetidas com facilidade.',
  },
  {
    icon: '👆',
    title: 'Toque para marcar',
    description: 'Toque em uma figurinha para expandir. Use + e - para ajustar a quantidade. Repetidas ficam com borda roxa.',
  },
  {
    icon: '📸',
    title: 'Escaneie com IA',
    description: 'Tire uma foto da pagina do album e a IA identifica todas as figurinhas automaticamente. Muito mais rapido!',
  },
  {
    icon: '🔄',
    title: 'Encontre trocas',
    description: 'Na aba Trocas, veja quem perto de voce tem as figurinhas que voce precisa. Troque repetidas e complete mais rapido!',
  },
]

export default function OnboardingModal() {
  const [show, setShow] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const seen = localStorage.getItem(ONBOARDING_KEY)
      if (!seen) setShow(true)
    }
  }, [])

  function handleClose() {
    localStorage.setItem(ONBOARDING_KEY, 'true')
    setShow(false)
  }

  function handleNext() {
    if (step < steps.length - 1) {
      setStep(step + 1)
    } else {
      handleClose()
    }
  }

  if (!show) return null

  const current = steps[step]
  const isLast = step === steps.length - 1

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-xl animate-slide-up">
        {/* Step indicator */}
        <div className="flex gap-1.5 justify-center mb-5">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full transition-all duration-300 ${
                i === step ? 'w-6 bg-violet-500' : 'w-1.5 bg-gray-200'
              }`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="text-center mb-6">
          <div className="text-5xl mb-4">{current.icon}</div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">{current.title}</h2>
          <p className="text-sm text-gray-500 leading-relaxed">{current.description}</p>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="flex-1 py-3 rounded-xl text-sm font-semibold text-gray-500 bg-gray-100 hover:bg-gray-200 transition"
            >
              Voltar
            </button>
          )}
          <button
            onClick={handleNext}
            className="flex-1 py-3 rounded-xl text-sm font-bold text-white bg-violet-600 hover:bg-violet-700 transition active:scale-[0.98]"
          >
            {isLast ? 'Comecar!' : 'Proximo'}
          </button>
        </div>

        {/* Skip */}
        {!isLast && (
          <button
            onClick={handleClose}
            className="w-full mt-3 text-xs text-gray-400 hover:text-gray-600 transition"
          >
            Pular tutorial
          </button>
        )}
      </div>
    </div>
  )
}
