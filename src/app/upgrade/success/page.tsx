'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function UpgradeSuccessPage() {
  const router = useRouter()
  const supabase = createClient()

  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasPhone, setHasPhone] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function checkPhone() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data } = await supabase
        .from('profiles')
        .select('phone')
        .eq('id', user.id)
        .single()

      if (data?.phone) {
        setHasPhone(true)
        setPhone(data.phone)
      }
      setLoading(false)
    }
    checkPhone()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/'); return }

    // Only update phone if user entered one
    const updates: Record<string, unknown> = {
      whatsapp_consent: consent,
      last_active: new Date().toISOString(),
    }
    if (phone.trim()) {
      updates.phone = phone.trim()
    }

    const { error: dbError } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)

    if (dbError) {
      setError('Erro ao salvar. Tente novamente.')
      setSaving(false)
      return
    }

    router.push('/album')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <span className="w-8 h-8 border-3 border-brand/30 border-t-brand rounded-full animate-spin" />
      </div>
    )
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
            {hasPhone
              ? 'Tudo pronto! Suas novas funcionalidades já estão ativas.'
              : 'Adicione seu celular para receber alertas de troca (opcional).'}
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
          {!hasPhone && (
            <>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">
                  Número de celular <span className="text-gray-400 text-xs font-normal">(opcional)</span>
                </label>
                <p className="text-xs text-gray-400 mb-2">
                  Para receber alertas de trocas por WhatsApp.
                </p>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+55 11 99999-9999"
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition"
                />
              </div>

              {phone.trim() && (
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
                    Eu autorizo compartilhar meu número de WhatsApp para troca de figurinhas.
                  </span>
                </label>
              )}
            </>
          )}

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
