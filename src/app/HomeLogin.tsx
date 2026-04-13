'use client'

import { useState, useMemo, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'

// ─── helpers visuais ──────────────────────────────────────────────────────────

const inputClass = (hasError?: boolean) =>
  `w-full bg-gray-50 border rounded-xl px-4 py-2.5 text-sm text-navy placeholder-gray-300 focus:ring-2 focus:ring-brand/30 focus:border-brand outline-none transition ${
    hasError ? 'border-red-400 bg-red-50' : 'border-gray-200'
  }`

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null
  return <p className="text-red-500 text-xs mt-1 ml-1">{msg}</p>
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ) : (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  )
}

// ─── regras de senha ──────────────────────────────────────────────────────────

const PASSWORD_RULES = [
  { id: 'length',    label: 'Mínimo 8 caracteres',          test: (p: string) => p.length >= 8 },
  { id: 'upper',     label: 'Uma letra maiúscula (A–Z)',     test: (p: string) => /[A-Z]/.test(p) },
  { id: 'lower',     label: 'Uma letra minúscula (a–z)',     test: (p: string) => /[a-z]/.test(p) },
  { id: 'number',    label: 'Um número (0–9)',               test: (p: string) => /[0-9]/.test(p) },
  { id: 'special',   label: 'Um caractere especial (!@#...)', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
]

function usePasswordStrength(password: string) {
  return useMemo(() => {
    const results = PASSWORD_RULES.map(rule => ({ ...rule, ok: rule.test(password) }))
    const passed  = results.filter(r => r.ok).length
    const total   = results.length
    const pct     = total > 0 ? passed / total : 0

    let label = ''
    let color = ''
    if (password.length === 0) { label = '';          color = '' }
    else if (pct <= 0.4)       { label = 'Fraca';     color = 'bg-red-400' }
    else if (pct <= 0.6)       { label = 'Razoável';  color = 'bg-orange-400' }
    else if (pct <= 0.8)       { label = 'Boa';       color = 'bg-yellow-400' }
    else                       { label = 'Forte';     color = 'bg-brand' }

    return { results, passed, total, pct, label, color, allPassed: passed === total }
  }, [password])
}

function PasswordStrengthMeter({ password }: { password: string }) {
  const { results, pct, label, color } = usePasswordStrength(password)

  if (password.length === 0) return null

  const bars = PASSWORD_RULES.length
  const filledBars = Math.round(pct * bars)

  return (
    <div className="mt-2 space-y-2">
      {/* Barra de força */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1 flex-1">
          {Array.from({ length: bars }).map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                i < filledBars ? color : 'bg-gray-200'
              }`}
            />
          ))}
        </div>
        {label && (
          <span className={`text-[11px] font-medium shrink-0 transition-colors ${
            pct <= 0.4 ? 'text-red-400' :
            pct <= 0.6 ? 'text-orange-400' :
            pct <= 0.8 ? 'text-yellow-500' : 'text-brand'
          }`}>
            {label}
          </span>
        )}
      </div>

      {/* Checklist de regras */}
      <ul className="space-y-1">
        {results.map(rule => (
          <li key={rule.id} className="flex items-center gap-1.5">
            {rule.ok ? (
              <svg className="w-3.5 h-3.5 text-brand shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="9" />
              </svg>
            )}
            <span className={`text-[11px] transition-colors ${rule.ok ? 'text-brand' : 'text-gray-400'}`}>
              {rule.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── componente principal ─────────────────────────────────────────────────────

export default function HomeLogin() {
  const [mode, setMode] = useState<'buttons' | 'email' | 'forgot'>('buttons')
  const [isSignUp, setIsSignUp] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [passwordTouched, setPasswordTouched] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const strength = usePasswordStrength(password)

  // Capture referral code from URL (?ref=CODE) and store in localStorage
  useEffect(() => {
    const ref = searchParams.get('ref')
    if (ref) {
      localStorage.setItem('referral_code', ref.trim().toUpperCase())
    }
  }, [searchParams])

  // Reset loading when user returns from OAuth (e.g. cancelled Google popup)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Small delay to let the redirect happen if auth succeeded
        setTimeout(() => setLoading(false), 1000)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  async function applyReferralCode() {
    const code = localStorage.getItem('referral_code')
    if (!code) return
    try {
      await fetch('/api/referral/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referral_code: code }),
      })
    } catch {
      // Silently fail — referral is non-critical
    } finally {
      localStorage.removeItem('referral_code')
    }
  }

  function validate() {
    const errors: Record<string, string> = {}
    if (isSignUp) {
      if (name.trim().length < 2)
        errors.name = 'Informe seu nome (mínimo 2 caracteres)'
      if (!strength.allPassed)
        errors.password = 'A senha não atende todos os requisitos'
      if (!confirmPassword)
        errors.confirmPassword = 'Confirme sua senha'
      else if (password !== confirmPassword)
        errors.confirmPassword = 'As senhas não coincidem'
    }
    return errors
  }

  function switchMode(toSignUp: boolean) {
    setIsSignUp(toSignUp)
    setError(null)
    setMessage(null)
    setFieldErrors({})
    setName('')
    setPassword('')
    setConfirmPassword('')
    setPasswordTouched(false)
  }

  async function handleGoogle() {
    setError(null)
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      })
      if (error) {
        setError('Não foi possível conectar ao Google. Tente novamente.')
        setLoading(false)
      }
      // If no error, browser will redirect — keep loading=true
      // But set a timeout to unblock in case redirect doesn't happen
      setTimeout(() => setLoading(false), 5000)
    } catch {
      setError('Erro ao conectar. Verifique sua internet e tente novamente.')
      setLoading(false)
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    if (!email) {
      setError('Informe seu e-mail para redefinir a senha.')
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    })
    if (error) {
      setError(error.message)
    } else {
      setMessage('Link de redefinição enviado! Verifique seu e-mail.')
    }
    setLoading(false)
  }

  function friendlyError(msg: string): string {
    if (msg.includes('Invalid login credentials'))
      return 'E-mail ou senha incorretos. Se você criou a conta pelo Google, entre pelo botão Google. Ou use "Esqueci minha senha" para criar uma.'
    if (msg.includes('Email not confirmed'))
      return 'Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada.'
    if (msg.includes('User already registered'))
      return 'Este e-mail já está cadastrado. Tente fazer login, entrar pelo Google ou use "Esqueci minha senha".'
    if (msg.includes('Signups not allowed'))
      return 'Cadastro temporariamente indisponível. Tente pelo Google.'
    if (msg.includes('provider'))
      return 'Esta conta usa login pelo Google. Use o botão "Começar com Google".'
    return msg
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)

    const errors = validate()
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      if (isSignUp) setPasswordTouched(true)
      return
    }
    setFieldErrors({})
    setLoading(true)

    if (isSignUp) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name.trim() },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })
      if (error) setError(friendlyError(error.message))
      else if (data.session) {
        await applyReferralCode()
        router.push('/album')
        router.refresh()
      } else {
        setMessage('Verifique seu email para confirmar o cadastro!')
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(friendlyError(error.message))
      else { await applyReferralCode(); router.push('/album'); router.refresh() }
    }
    setLoading(false)
  }

  // ── tela de botões OAuth ────────────────────────────────────────────────────
  if (mode === 'buttons') {
    return (
      <div className="space-y-2.5">
        <button
          onClick={handleGoogle}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 bg-brand text-white font-semibold text-sm rounded-full px-6 py-3 hover:bg-brand-dark transition active:scale-[0.98] disabled:opacity-50 shadow-sm shadow-brand/20"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="white" fillOpacity="0.8"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="white" fillOpacity="0.9"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="white" fillOpacity="0.7"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="white" fillOpacity="0.8"/>
          </svg>
          Começar com Google
        </button>

        <button
          onClick={() => setMode('email')}
          className="w-full text-xs text-gray-500 hover:text-brand transition py-1.5 font-medium underline underline-offset-2 decoration-gray-300 hover:decoration-brand"
        >
          Entrar ou cadastrar com e-mail
        </button>
      </div>
    )
  }

  // ── tela esqueci senha ──────────────────────────────────────────────────────
  if (mode === 'forgot') {
    return (
      <form onSubmit={handleForgotPassword} className="space-y-3">
        <div className="text-center mb-2">
          <p className="text-sm font-semibold text-gray-800">Redefinir senha</p>
          <p className="text-[11px] text-gray-400 mt-1">
            Informe seu e-mail e enviaremos um link para criar uma nova senha.
          </p>
        </div>

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="seu@email.com"
          aria-label="E-mail"
          autoComplete="email"
          className={inputClass()}
        />

        {error   && <p className="text-red-500 text-xs text-center">{error}</p>}
        {message && <p className="text-brand   text-xs text-center">{message}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-brand text-white font-semibold text-sm rounded-full px-6 py-3 hover:bg-brand-dark transition active:scale-[0.98] disabled:opacity-50 shadow-sm shadow-brand/20"
        >
          {loading ? '...' : 'Enviar link'}
        </button>

        <button
          type="button"
          onClick={() => { setError(null); setMessage(null); setMode('email') }}
          className="w-full text-[11px] text-gray-400 hover:text-gray-600 transition py-1"
        >
          Voltar para login
        </button>
      </form>
    )
  }

  // ── formulário de email ─────────────────────────────────────────────────────
  return (
    <form onSubmit={handleEmail} className="space-y-2">

      {/* Nome — só no cadastro */}
      {isSignUp && (
        <div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Seu nome"
            aria-label="Nome"
            autoComplete="name"
            className={inputClass(!!fieldErrors.name)}
          />
          <FieldError msg={fieldErrors.name} />
        </div>
      )}

      {/* Email */}
      <div>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="seu@email.com"
          aria-label="E-mail"
          autoComplete="email"
          className={inputClass()}
        />
      </div>

      {/* Senha */}
      <div>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => { setPassword(e.target.value); if (!passwordTouched) setPasswordTouched(true) }}
            required
            placeholder="Senha"
            aria-label="Senha"
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            className={`${inputClass(!!fieldErrors.password)} pr-10`}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
            aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
          >
            <EyeIcon open={showPassword} />
          </button>
        </div>

        {/* Medidor de força — só no cadastro e após começar a digitar */}
        {isSignUp && passwordTouched && (
          <PasswordStrengthMeter password={password} />
        )}
        <FieldError msg={fieldErrors.password} />
      </div>

      {/* Confirmar senha — só no cadastro */}
      {isSignUp && (
        <div>
          <div className="relative">
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirme sua senha"
              aria-label="Confirmar senha"
              autoComplete="new-password"
              className={`${inputClass(!!fieldErrors.confirmPassword)} pr-10`}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
              aria-label={showConfirmPassword ? 'Ocultar senha' : 'Mostrar senha'}
            >
              <EyeIcon open={showConfirmPassword} />
            </button>
          </div>
          <FieldError msg={fieldErrors.confirmPassword} />
        </div>
      )}

      {/* Erros gerais e mensagens de sucesso */}
      {error   && <p className="text-red-500 text-xs text-center pt-1">{error}</p>}
      {message && <p className="text-brand   text-xs text-center pt-1">{message}</p>}

      {/* Botão principal */}
      <button
        type="submit"
        disabled={loading}
        className="w-full bg-brand text-white font-semibold text-sm rounded-full px-6 py-3 hover:bg-brand-dark transition active:scale-[0.98] disabled:opacity-50 shadow-sm shadow-brand/20 mt-1"
      >
        {loading ? '...' : isSignUp ? 'Criar conta' : 'Entrar'}
      </button>

      {/* Esqueci senha + Alternar modo + Voltar */}
      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={() => switchMode(!isSignUp)}
          className="text-[11px] text-gray-400 hover:text-gray-600 transition"
        >
          {isSignUp ? 'Já tenho conta' : 'Criar conta'}
        </button>
        <div className="flex items-center gap-3">
          {!isSignUp && (
            <button
              type="button"
              onClick={() => { setError(null); setMessage(null); setMode('forgot') }}
              className="text-[11px] text-brand hover:text-brand-dark transition font-medium"
            >
              Esqueci a senha
            </button>
          )}
          <button
            type="button"
            onClick={() => setMode('buttons')}
            className="text-[11px] text-gray-400 hover:text-gray-600 transition"
          >
            Voltar
          </button>
        </div>
      </div>
    </form>
  )
}
