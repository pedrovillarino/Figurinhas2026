'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function HomeLogin() {
  const [mode, setMode] = useState<'buttons' | 'email'>('buttons')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  async function handleGoogle() {
    setLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
    }
  }

  async function handleApple() {
    setLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
    }
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    if (isSignUp) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      })
      if (error) setError(error.message)
      else if (data.session) {
        // Confirmação de email desativada — sessão ativa imediatamente
        router.push('/album')
        router.refresh()
      } else {
        // Confirmação de email ativada — pede para verificar caixa de entrada
        setMessage('Verifique seu email para confirmar!')
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
      else { router.push('/album'); router.refresh() }
    }
    setLoading(false)
  }

  if (mode === 'buttons') {
    return (
      <div className="space-y-3">
        {/* Apple */}
        <button
          onClick={handleApple}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 bg-white text-[#060608] font-medium text-sm rounded-full px-6 py-3 hover:bg-white/90 transition active:scale-[0.98] disabled:opacity-50"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.4c1.33.07 2.26.73 3.03.75.91-.14 1.79-.87 3.06-.93 1.93-.1 3.33.88 4.18 2.3-3.82 2.31-3.18 7.46.73 8.76zM12.03 7.25c-.13-2.17 1.67-4.01 3.72-4.25.27 2.37-2.08 4.26-3.72 4.25z"/>
          </svg>
          Continuar com Apple
        </button>

        {/* Google */}
        <button
          onClick={handleGoogle}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 bg-white text-[#060608] font-medium text-sm rounded-full px-6 py-3 hover:bg-white/90 transition active:scale-[0.98] disabled:opacity-50"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continuar com Google
        </button>

        {/* Email option */}
        <button
          onClick={() => setMode('email')}
          className="w-full text-sm text-white/55 hover:text-white/75 transition py-2"
        >
          ou entre com email
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleEmail} className="space-y-3">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        placeholder="seu@email.com"
        className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/50 outline-none transition"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={6}
        placeholder="Senha"
        className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/50 outline-none transition"
      />

      {error && <p className="text-red-400 text-xs text-center">{error}</p>}
      {message && <p className="text-green-400 text-xs text-center">{message}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-white text-[#060608] font-medium text-sm rounded-full px-6 py-3 hover:bg-white/90 transition active:scale-[0.98] disabled:opacity-50"
      >
        {loading ? '...' : isSignUp ? 'Criar conta' : 'Entrar'}
      </button>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => { setIsSignUp(!isSignUp); setError(null); setMessage(null) }}
          className="text-[11px] text-white/30 hover:text-white/50 transition"
        >
          {isSignUp ? 'Já tenho conta' : 'Criar conta'}
        </button>
        <button
          type="button"
          onClick={() => setMode('buttons')}
          className="text-[11px] text-white/30 hover:text-white/50 transition"
        >
          Voltar
        </button>
      </div>
    </form>
  )
}
