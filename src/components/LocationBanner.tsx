'use client'

/**
 * Persistent banner shown on /album to users who don't have a city set.
 * Click → modal with geo / CEP / WhatsApp capture (same flow as the
 * onboarding location step, just standalone). Dismissible per session.
 */
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const DISMISS_KEY = 'completeai_location_banner_dismissed'

export default function LocationBanner() {
  const [show, setShow] = useState(false)
  const [open, setOpen] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    if (sessionStorage.getItem(DISMISS_KEY)) return
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return
      const { data: profile } = await supabase
        .from('profiles')
        .select('city, location_lat')
        .eq('id', user.id)
        .single()
      if (cancelled) return
      const hasCity = !!profile?.city || profile?.location_lat != null
      if (!hasCity) setShow(true)
    })()
    return () => { cancelled = true }
  }, [supabase])

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1')
    setShow(false)
  }

  if (!show) return null

  return (
    <>
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 mb-3 flex items-center gap-2">
        <span className="text-base">📍</span>
        <p className="flex-1 text-[12px] text-amber-900 leading-snug">
          Adicione sua localização pra ver trocas perto de você.
        </p>
        <button
          onClick={() => setOpen(true)}
          className="text-[11px] font-bold bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg transition active:scale-[0.98]"
        >
          Ativar
        </button>
        <button
          onClick={dismiss}
          aria-label="Dispensar"
          className="text-amber-600 hover:text-amber-900 text-lg leading-none px-1 transition"
        >
          ×
        </button>
      </div>
      {open && <LocationCaptureModal onClose={() => { setOpen(false); setShow(false) }} />}
    </>
  )
}

function LocationCaptureModal({ onClose }: { onClose: () => void }) {
  const [phoneInput, setPhoneInput] = useState('')
  const [cepInput, setCepInput] = useState('')
  const [showCepInput, setShowCepInput] = useState(false)
  const [requestingGeo, setRequestingGeo] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [geoCity, setGeoCity] = useState<string | null>(null)
  const [cepCity, setCepCity] = useState<string | null>(null)

  function requestGeo() {
    if (!navigator.geolocation) {
      setError('Seu navegador não suporta localização.')
      return
    }
    setError('')
    setRequestingGeo(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude
        const lng = position.coords.longitude
        try {
          const res = await fetch('/api/geocode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat, lng }),
          })
          const data = await res.json()
          if (res.ok && data.city) {
            setGeoCity(data.city)
          } else {
            setError('Não consegui identificar sua cidade. Tente o CEP.')
          }
        } catch {
          setError('Sem conexão. Tenta de novo?')
        }
        setRequestingGeo(false)
      },
      (err) => {
        setRequestingGeo(false)
        if (err.code === 1) setError('Permissão negada. Use CEP ou WhatsApp.')
        else setError('Não foi possível obter a localização.')
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    )
  }

  async function saveAndClose() {
    setError('')
    setSaving(true)

    const phoneTrimmed = phoneInput.trim()
    if (phoneTrimmed) {
      try {
        const res = await fetch('/api/me/phone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phoneTrimmed }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setError(data?.error || 'Não consegui salvar o WhatsApp.')
          setSaving(false)
          return
        }
      } catch {
        setError('Sem conexão. Tenta de novo?')
        setSaving(false)
        return
      }
    }

    const cepTrimmed = cepInput.replace(/\D/g, '')
    if (cepTrimmed.length === 8 && !geoCity) {
      try {
        const viaRes = await fetch(`https://viacep.com.br/ws/${cepTrimmed}/json/`)
        const viaData = await viaRes.json()
        if (!viaData.erro && viaData.localidade) {
          await fetch('/api/geocode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              city: viaData.localidade,
              state: viaData.uf,
              neighborhood: viaData.bairro || undefined,
            }),
          })
          setCepCity(viaData.localidade)
        } else {
          setError('CEP não encontrado.')
          setSaving(false)
          return
        }
      } catch {
        setError('Erro ao buscar CEP.')
        setSaving(false)
        return
      }
    }

    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-xl">
        <div className="text-center mb-5">
          <div className="text-5xl mb-3">📍</div>
          <h2 className="text-lg font-bold text-gray-900 mb-1.5">
            Pra te avisar de trocas perto de você
          </h2>
          <p className="text-xs text-gray-500 leading-relaxed">
            Precisamos saber sua cidade. WhatsApp é opcional — sem ele, avisamos por email.
          </p>
        </div>

        <div className="mb-4">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Onde você está?</p>

          {!geoCity && !cepCity ? (
            <>
              <button
                onClick={requestGeo}
                disabled={requestingGeo || saving}
                className="w-full py-2.5 mb-2 rounded-xl text-sm font-semibold border border-brand text-brand hover:bg-brand-light/40 transition active:scale-[0.98] disabled:opacity-50"
              >
                {requestingGeo ? 'Solicitando…' : '📍 Permitir localização'}
              </button>

              {!showCepInput ? (
                <button
                  onClick={() => setShowCepInput(true)}
                  disabled={saving}
                  className="w-full text-xs text-gray-500 hover:text-gray-700 underline transition disabled:opacity-50"
                >
                  ou digitar CEP
                </button>
              ) : (
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  placeholder="CEP — 00000-000"
                  value={cepInput}
                  onChange={(e) => setCepInput(e.target.value)}
                  maxLength={9}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                  disabled={saving}
                />
              )}
            </>
          ) : (
            <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
              ✅ Cidade: <span className="font-semibold">{geoCity || cepCity}</span>
            </div>
          )}
        </div>

        <div className="mb-3">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
            WhatsApp <span className="text-gray-400 font-normal normal-case">(opcional)</span>
          </p>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(21) 99999-8888"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            disabled={saving}
          />
        </div>

        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

        <button
          onClick={saveAndClose}
          disabled={saving || requestingGeo}
          className="w-full py-3 rounded-xl text-sm font-bold text-white bg-brand hover:bg-brand-dark transition active:scale-[0.98] shadow-lg shadow-brand/20 disabled:opacity-50"
        >
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
        <button
          onClick={onClose}
          disabled={saving || requestingGeo}
          className="w-full mt-2 py-2 text-[11px] text-gray-400 hover:text-gray-600 transition disabled:opacity-50"
        >
          Fechar
        </button>
      </div>
    </div>
  )
}
