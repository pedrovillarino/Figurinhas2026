'use client'

import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const PASSWORD_RULES = [
  { id: 'length',  label: 'Mínimo 8 caracteres',           test: (p: string) => p.length >= 8 },
  { id: 'upper',   label: 'Uma letra maiúscula (A-Z)',      test: (p: string) => /[A-Z]/.test(p) },
  { id: 'lower',   label: 'Uma letra minúscula (a-z)',      test: (p: string) => /[a-z]/.test(p) },
  { id: 'number',  label: 'Um número (0-9)',                test: (p: string) => /[0-9]/.test(p) },
  { id: 'special', label: 'Um caractere especial (!@#...)', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
]

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const strength = useMemo(() => {
    const results = PASSWORD_RULES.map(rule => ({ ...rule, ok: rule.test(password) }))
    const passed = results.filter(r => r.ok).length
    const pct = PASSWORD_RULES.length > 0 ? passed / PASSWORD_RULES.length : 0
    return { results, passed, pct, allPassed: passed === PASSWORD_RULES.length }
  }, [password])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!strength.allPassed) {
      setError('A senha não atende todos os requisitos.')
      return
    }
    if (password !== confirmPassword) {
      setError('As senhas não coincidem.')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
    } else {
      setSuccess(true)
      setTimeout(() => { router.push('/album'); router.refresh() }, 2000)
    }
    setLoading(false)
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 bg-gray-50">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-sm w-full text-center">
          <div className="text-4xl mb-3">✅</div>
          <h1 className="text-lg font-bold text-gray-900 mb-1">Senha atualizada!</h1>
          <p className="text-sm text-gray-500">Redirecionando para o app...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-gray-50">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 max-w-sm w-full">
        <div className="text-center mb-5">
          <div className="text-3xl mb-2">🔑</div>
          <h1 className="text-lg font-bold text-gray-900">Nova senha</h1>
          <p className="text-xs text-gray-400 mt-1">Crie uma nova senha para sua conta.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="Nova senha"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 placeholder-gray-300 focus:ring-2 focus:ring-brand/30 focus:border-brand outline-none transition pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                {showPassword ? (
                  <>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </>
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                )}
              </svg>
            </button>
          </div>

          {/* Strength rules */}
          {password.length > 0 && (
            <ul className="space-y-1 ml-1">
              {strength.results.map(rule => (
                <li key={rule.id} className="flex items-center gap-1.5">
                  {rule.ok ? (
                    <svg className="w-3 h-3 text-brand shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-3 h-3 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <circle cx="12" cy="12" r="9" />
                    </svg>
                  )}
                  <span className={`text-[10px] ${rule.ok ? 'text-brand' : 'text-gray-400'}`}>{rule.label}</span>
                </li>
              ))}
            </ul>
          )}

          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            placeholder="Confirme a nova senha"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 placeholder-gray-300 focus:ring-2 focus:ring-brand/30 focus:border-brand outline-none transition"
          />

          {error && <p className="text-red-500 text-xs text-center">{error}</p>}

          <button
            type="submit"
            disabled={loading || !strength.allPassed}
            className="w-full bg-brand text-white font-semibold text-sm rounded-full px-6 py-3 hover:bg-brand-dark transition active:scale-[0.98] disabled:opacity-50 shadow-sm shadow-brand/20"
          >
            {loading ? '...' : 'Salvar nova senha'}
          </button>
        </form>
      </div>
    </div>
  )
}
