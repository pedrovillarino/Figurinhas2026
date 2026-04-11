'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function UpgradeSuccessPage() {
  const router = useRouter()
  const supabase = createClient()

  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!phone.trim()) {
      setError('Informe seu número de celular para continuar.')
      return
    }

    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/')
      return
    }

    const { error: dbError } = await supabase
      .from('profiles')
      .update({
        phone: phone.trim(),
        whatsapp_consent: consent,
        last_active: new Date().toISOString(),
      })
      .eq('id', user.id)

    if (dbError) {
      setError('Erro ao salvar. Tente novamente.')
      setSaving(false)
      return
    }

    router.push('/album')
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="max-w-sm w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-4 animate-bounce">🎉</div>
          <h1 className="text-2xl font-black text-gray-900 mb-2">
            Upgrade feito!
          </h1>
          <p className="text-sm text-gray-500">
            Só mais um passo para liberar as trocas.
          </p>
        </div>

        {/* Unlocked features */}
        <div className="space-y-2 mb-8">
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

        {/* Phone + consent form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              Número de celular <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-gray-400 mb-2">
              Necessário para conectar você com outros colecionadores.
            </p>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+55 11 99999-9999"
              required
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition"
            />
          </div>

          {/* Consent checkbox */}
          <label className="flex items-start gap-3 cursor-pointer group">
            <div className="relative mt-0.5 flex-shrink-0">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="sr-only"
              />
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                consent
                  ? 'bg-brand border-brand'
                  : 'bg-white border-gray-300 group-hover:border-brand'
              }`}>
                {consent && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </div>
            <span className="text-xs text-gray-600 leading-relaxed">
              Eu autorizo compartilhar meu número de WhatsApp para troca de figurinhas.{' '}
              <span className="text-gray-400">
                Ao desmarcar, você não será encontrado por outros colecionadores.
              </span>
            </span>
          </label>

          {error && (
            <p className="text-red-500 text-xs text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-gray-900 text-white rounded-2xl py-3.5 text-sm font-semibold hover:bg-gray-800 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Salvando...
              </span>
            ) : (
              'Ir para o Álbum'
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
