'use client'

import { useState } from 'react'

export default function PremiumBanner() {
  const [loading, setLoading] = useState(false)

  async function handleUpgrade() {
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/checkout', { method: 'POST' })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        alert(data.error || 'Erro ao iniciar pagamento')
        setLoading(false)
      }
    } catch {
      alert('Erro ao conectar com o servidor')
      setLoading(false)
    }
  }

  return (
    <div className="bg-gradient-to-r from-violet-50 to-fuchsia-50 border border-violet-100 rounded-2xl p-4 mb-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm shrink-0">
          <span className="text-lg">⭐</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-800">Limite de 100 figurinhas atingido</p>
          <p className="text-[10px] text-gray-500 mt-0.5">Desbloqueie ilimitado a partir de R$9,90</p>
        </div>
        <button
          onClick={handleUpgrade}
          disabled={loading}
          className="bg-gray-900 text-white rounded-xl px-3 py-2 text-[10px] font-semibold hover:bg-gray-800 transition shrink-0 disabled:opacity-50"
        >
          {loading ? '...' : 'Upgrade'}
        </button>
      </div>
    </div>
  )
}
