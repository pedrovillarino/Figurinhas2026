'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function UpgradeSuccessPage() {
  const router = useRouter()
  const [countdown, setCountdown] = useState(5)

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer)
          router.push('/album')
          return 0
        }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [router])

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        <div className="text-6xl mb-6 animate-bounce">🎉</div>

        <h1 className="text-2xl font-black text-gray-900 mb-2">
          Upgrade feito!
        </h1>
        <p className="text-sm text-gray-500 mb-8">
          Agora é só colar! Suas novas funcionalidades já estão desbloqueadas.
        </p>

        <div className="space-y-3">
          <div className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
            <span className="text-lg">📸</span>
            <span className="text-sm text-gray-700">Scanner IA desbloqueado</span>
          </div>
          <div className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
            <span className="text-lg">🔁</span>
            <span className="text-sm text-gray-700">Trocas desbloqueadas</span>
          </div>
          <div className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
            <span className="text-lg">♾️</span>
            <span className="text-sm text-gray-700">Figurinhas ilimitadas</span>
          </div>
        </div>

        <button
          onClick={() => router.push('/album')}
          className="mt-8 w-full bg-gray-900 text-white rounded-2xl py-3.5 text-sm font-semibold hover:bg-gray-800 transition-all active:scale-[0.98]"
        >
          Ir para o Álbum
        </button>

        <p className="text-[10px] text-gray-300 mt-3">
          Redirecionando em {countdown}s...
        </p>
      </div>
    </div>
  )
}
