'use client'

// Pedro 2026-05-03: nudge contextual pra coletar CEP/cidade depois de
// engajamento mínimo (não na 1ª tela). Aparece em /album e /trades.
//
// Critérios pra mostrar:
//   1. Não tem city no profile
//   2. cep_nudge_dismissed_at é null (não fechou nem preencheu)
//   3. cep_nudge_snoozed_at é null OU > 3 dias atrás
//   4. Engajamento mínimo: tem 5+ figurinhas marcadas OU 1+ scan feito
//
// Ações:
//   📍 Inserir CEP — 8 dígitos, ViaCEP busca cidade, salva direto
//   📡 Permitir GPS — navigator.geolocation, /api/geocode reverse
//   ⏳ Mais tarde — POST /api/profile/cep-nudge {action:'snooze'}
//   ✕ Fechar — POST /api/profile/cep-nudge {action:'dismiss'}

import { useState } from 'react'

type CepNudgeProps = {
  // Server-side decidiu que deve mostrar (todos os critérios passaram)
  show: boolean
  // Quantidade de figurinhas (pra texto "Você marcou X figurinhas")
  stickersOwned: number
}

export default function CepNudge({ show, stickersOwned }: CepNudgeProps) {
  const [hidden, setHidden] = useState(false)
  const [mode, setMode] = useState<'banner' | 'cep_input' | 'gps_loading' | 'success'>('banner')
  const [cep, setCep] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [savedCity, setSavedCity] = useState<string | null>(null)

  if (!show || hidden) return null

  async function submitCep(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setErrMsg(null)
    try {
      const digits = cep.replace(/\D/g, '')
      if (digits.length !== 8) {
        setErrMsg('CEP precisa ter 8 dígitos.')
        setSubmitting(false)
        return
      }
      const res = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cep: digits }),
      })
      const data = await res.json()
      if (res.ok) {
        setSavedCity(data.city || null)
        setMode('success')
        setTimeout(() => setHidden(true), 3000)
      } else {
        setErrMsg(data.error || 'Erro ao salvar CEP.')
      }
    } catch {
      setErrMsg('Erro de conexão.')
    }
    setSubmitting(false)
  }

  function requestGps() {
    if (!navigator.geolocation) {
      setErrMsg('Seu navegador não suporta GPS. Tenta o CEP.')
      setMode('cep_input')
      return
    }
    setMode('gps_loading')
    setErrMsg(null)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch('/api/geocode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          })
          const data = await res.json()
          if (res.ok) {
            setSavedCity(data.city || null)
            setMode('success')
            setTimeout(() => setHidden(true), 3000)
          } else {
            setErrMsg(data.error || 'Erro ao salvar GPS.')
            setMode('banner')
          }
        } catch {
          setErrMsg('Erro de conexão.')
          setMode('banner')
        }
      },
      () => {
        setErrMsg('Não conseguimos sua localização. Tenta o CEP.')
        setMode('cep_input')
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  async function handleSnooze() {
    setHidden(true)
    fetch('/api/profile/cep-nudge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'snooze' }),
    }).catch(() => {})
  }

  async function handleDismiss() {
    setHidden(true)
    fetch('/api/profile/cep-nudge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dismiss' }),
    }).catch(() => {})
  }

  return (
    <div className="bg-gradient-to-br from-amber-50 to-yellow-100 border border-amber-300 rounded-xl p-4 mb-4 relative shadow-sm">
      {/* Close button */}
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Fechar"
        className="absolute top-2 right-2 w-7 h-7 rounded-full hover:bg-amber-200/50 flex items-center justify-center text-amber-800 transition"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {mode === 'success' ? (
        <div className="text-center py-2">
          <p className="text-base font-bold text-emerald-700">📍 Achei sua cidade{savedCity ? `: ${savedCity}` : ''}!</p>
          <p className="text-xs text-emerald-600 mt-1">Agora vou te avisar quando alguém perto tiver figurinhas que faltam.</p>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-3 mb-3 pr-6">
            <div className="text-3xl">📍</div>
            <div>
              <p className="text-sm font-bold text-amber-900">Quer encontrar trocas perto de você?</p>
              <p className="text-[12px] text-amber-800 mt-0.5">
                {stickersOwned >= 5
                  ? `Você já marcou ${stickersOwned} figurinhas — vou te avisar quando alguém na sua região tiver as que faltam pro seu álbum.`
                  : 'Cadastra sua localização e vou te avisar quando alguém na sua região tiver as figurinhas que faltam.'}
              </p>
            </div>
          </div>

          {mode === 'banner' && (
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setMode('cep_input')}
                className="bg-amber-500 text-white rounded-lg px-2 py-2 text-xs font-bold hover:bg-amber-600 active:scale-[0.98] transition"
              >
                📝 CEP
              </button>
              <button
                type="button"
                onClick={requestGps}
                className="bg-white border border-amber-300 text-amber-700 rounded-lg px-2 py-2 text-xs font-bold hover:bg-amber-50 active:scale-[0.98] transition"
              >
                📡 GPS
              </button>
              <button
                type="button"
                onClick={handleSnooze}
                className="bg-transparent text-amber-700 rounded-lg px-2 py-2 text-xs font-medium hover:bg-amber-100/50 active:scale-[0.98] transition"
              >
                ⏳ Depois
              </button>
            </div>
          )}

          {mode === 'cep_input' && (
            <form onSubmit={submitCep} className="flex flex-col gap-2">
              <input
                type="text"
                inputMode="numeric"
                placeholder="Digite seu CEP (só números)"
                value={cep}
                onChange={(e) => setCep(e.target.value.replace(/\D/g, '').slice(0, 8))}
                autoFocus
                className="w-full px-3 py-2 rounded-lg border border-amber-300 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
              />
              {errMsg && <p className="text-xs text-red-600">{errMsg}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={submitting || cep.length !== 8}
                  className="flex-1 bg-amber-500 text-white rounded-lg px-3 py-2 text-xs font-bold hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {submitting ? 'Salvando...' : 'Salvar CEP'}
                </button>
                <button
                  type="button"
                  onClick={() => { setMode('banner'); setErrMsg(null) }}
                  className="px-3 py-2 text-xs text-amber-700 hover:bg-amber-100/50 rounded-lg transition"
                >
                  Voltar
                </button>
              </div>
            </form>
          )}

          {mode === 'gps_loading' && (
            <div className="text-center py-2">
              <p className="text-xs text-amber-700">📡 Pegando sua localização...</p>
            </div>
          )}

          {errMsg && mode === 'banner' && (
            <p className="text-xs text-red-600 mt-2">{errMsg}</p>
          )}
        </>
      )}
    </div>
  )
}
