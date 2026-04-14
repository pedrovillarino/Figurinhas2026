'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

type TradeMatch = {
  user_id: string
  display_name: string | null
  avatar_url: string | null
  distance_km: number
  they_have: number
  i_have: number
  match_score: number
}

type TradeDetail = {
  sticker_id: number
  number: string
  player_name: string | null
  country: string
  direction: 'they_have' | 'i_have'
}

type LocationState = 'unknown' | 'requesting' | 'granted' | 'denied' | 'saving'

export default function TradesClient({ userId }: { userId: string }) {
  const supabase = createClient()
  const [locationState, setLocationState] = useState<LocationState>('unknown')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [matches, setMatches] = useState<TradeMatch[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, TradeDetail[]>>({})
  const [loadingDetails, setLoadingDetails] = useState<string | null>(null)
  const [radius, setRadius] = useState(50)

  // Check if user already has location saved
  useEffect(() => {
    checkSavedLocation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function checkSavedLocation() {
    const { data } = await supabase
      .from('profiles')
      .select('location_lat, location_lng')
      .eq('id', userId)
      .single()

    if (data?.location_lat && data?.location_lng) {
      setCoords({ lat: data.location_lat, lng: data.location_lng })
      setLocationState('granted')
      loadMatches()
    }
  }

  async function requestLocation(highAccuracy = false) {
    if (!navigator.geolocation) {
      setLocationState('denied')
      return
    }

    setLocationState('requesting')

    // Try fast location first (cell tower / WiFi — ~1-3s), then offer GPS refinement
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude
        const lng = position.coords.longitude
        setCoords({ lat, lng })
        setLocationState('saving')

        await supabase
          .from('profiles')
          .update({
            location_lat: lat,
            location_lng: lng,
            last_active: new Date().toISOString(),
          })
          .eq('id', userId)

        setLocationState('granted')
        loadMatches()
      },
      (error) => {
        console.error('Geolocation error:', error)
        if (error.code === 1) {
          // PERMISSION_DENIED
          setLocationState('denied')
        } else if (!highAccuracy) {
          // Timeout or unavailable with low accuracy — retry once with high accuracy
          requestLocation(true)
        } else {
          setLocationState('denied')
        }
      },
      {
        enableHighAccuracy: highAccuracy,
        timeout: highAccuracy ? 10000 : 5000,
        maximumAge: 5 * 60 * 1000, // accept cached location up to 5 min old
      }
    )
  }

  async function loadMatches(overrideRadius?: number) {
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('get_trade_matches', {
        p_user_id: userId,
        p_radius_km: overrideRadius ?? radius,
      })

      if (error) {
        console.error('Trade match error:', error)
        setMatches([])
      } else {
        setMatches((data || []) as TradeMatch[])
      }
    } catch (err) {
      console.error('Trade match error:', err)
    }
    setLoading(false)
  }

  async function loadDetails(otherId: string) {
    if (details[otherId]) return // already loaded

    setLoadingDetails(otherId)
    const { data, error } = await supabase.rpc('get_trade_details', {
      p_user_id: userId,
      p_other_id: otherId,
    })

    if (!error && data) {
      setDetails((prev) => ({ ...prev, [otherId]: data as TradeDetail[] }))
    }
    setLoadingDetails(null)
  }

  function toggleExpand(matchUserId: string) {
    if (expandedId === matchUserId) {
      setExpandedId(null)
    } else {
      setExpandedId(matchUserId)
      loadDetails(matchUserId)
    }
  }

  function buildWhatsAppMessage(match: TradeMatch, stickers: TradeDetail[]) {
    const theyHave = stickers
      .filter((s) => s.direction === 'they_have')
      .slice(0, 10)
      .map((s) => `${s.number}${s.player_name ? ' ' + s.player_name : ''}`)
    const iHave = stickers
      .filter((s) => s.direction === 'i_have')
      .slice(0, 10)
      .map((s) => `${s.number}${s.player_name ? ' ' + s.player_name : ''}`)

    let msg = 'Oi! Vi no app do Álbum da Copa que a gente pode trocar figurinhas 😄\n\n'

    if (iHave.length > 0) {
      msg += 'Tenho repetidas pra te dar:\n'
      msg += iHave.join('\n')
      msg += '\n\n'
    }

    if (theyHave.length > 0) {
      msg += 'Preciso dessas suas:\n'
      msg += theyHave.join('\n')
      msg += '\n\n'
    }

    msg += 'Bora trocar? 🔥'
    return msg
  }

  function openWhatsApp(match: TradeMatch) {
    const stickers = details[match.user_id] || []
    const message = buildWhatsAppMessage(match, stickers)
    const encoded = encodeURIComponent(message)
    window.open(`https://wa.me/?text=${encoded}`, '_blank')
  }

  function getInitials(name: string | null): string {
    if (!name) return '?'
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  // No location state
  if (locationState === 'unknown' || locationState === 'denied') {
    return (
      <div className="px-4 pt-6">
        <h1 className="text-xl font-bold mb-1 text-gray-900">Trocas</h1>
        <p className="text-xs text-gray-400 mb-8">Encontre pessoas perto de você para trocar figurinhas</p>

        <div className="flex flex-col items-center justify-center mt-8">
          <div className="w-20 h-20 bg-gray-50 rounded-2xl flex items-center justify-center mb-5">
            <svg className="w-10 h-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
          </div>

          {locationState === 'denied' ? (
            <>
              <p className="text-sm font-medium text-gray-700 mb-1">Localização bloqueada</p>
              <p className="text-xs text-gray-400 text-center max-w-[260px] mb-4">
                Para encontrar trocas, ative a localização nas configurações do navegador.
              </p>
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 mb-6 max-w-[280px]">
                <p className="text-[10px] text-amber-700 leading-relaxed text-center">
                  📍 <strong>iPhone:</strong> Ajustes → Safari → Localização → Permitir<br />
                  📍 <strong>Android:</strong> Toque no cadeado na barra de endereço → Localização → Permitir
                </p>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-gray-700 mb-1">Ative sua localização</p>
              <p className="text-xs text-gray-400 text-center max-w-[260px] mb-2">
                Precisamos da sua localização para encontrar colecionadores perto de você.
              </p>
              <p className="text-[10px] text-gray-300 text-center max-w-[240px] mb-6">
                Usamos apenas sua região aproximada. Sua posição exata não é compartilhada.
              </p>
            </>
          )}

          <button
            onClick={() => requestLocation()}
            className="bg-gray-900 text-white rounded-xl px-6 py-3 text-sm font-medium hover:bg-gray-800 transition-all active:scale-[0.98]"
          >
            {locationState === 'denied' ? 'Tentar novamente' : 'Permitir localização'}
          </button>
        </div>
      </div>
    )
  }

  // Requesting / saving location
  if (locationState === 'requesting' || locationState === 'saving') {
    return (
      <div className="px-4 pt-6">
        <h1 className="text-xl font-bold mb-1 text-gray-900">Trocas</h1>
        <div className="flex flex-col items-center justify-center mt-16">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-gray-800 rounded-full animate-spin mb-4" />
          <p className="text-sm text-gray-500">
            {locationState === 'requesting' ? 'Obtendo localização...' : 'Salvando localização...'}
          </p>
        </div>
      </div>
    )
  }

  // Main trades view
  return (
    <div className="px-4 pt-6 pb-24">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {loading
              ? 'Buscando trocas...'
              : matches.length > 0
                ? `${matches.length} pessoa${matches.length > 1 ? 's' : ''} perto de você`
                : 'Nenhuma troca encontrada'}
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Raio de {radius} km da sua localização
          </p>
        </div>

        <button
          onClick={() => loadMatches()}
          className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 shrink-0 mt-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M21.016 4.357v4.992" />
          </svg>
          Atualizar
        </button>
      </div>

      {/* Radius selector */}
      <div className="flex gap-2 mb-5">
        {[5, 10, 15, 25, 50].map((r) => (
          <button
            key={r}
            onClick={() => {
              setRadius(r)
              if (coords) loadMatches(r)
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              radius === r
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {r} km
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center justify-center mt-12">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-gray-800 rounded-full animate-spin mb-4" />
          <p className="text-sm text-gray-400">Procurando colecionadores...</p>
        </div>
      )}

      {/* No matches */}
      {!loading && matches.length === 0 && (
        <div className="flex flex-col items-center justify-center mt-12">
          <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-600 mb-1">Ninguém encontrado</p>
          <p className="text-xs text-gray-400 text-center max-w-[240px]">
            Tente aumentar o raio de busca ou volte mais tarde
          </p>
        </div>
      )}

      {/* Match cards */}
      <div className="space-y-3">
        {matches.map((match) => {
          const isExpanded = expandedId === match.user_id
          const matchDetails = details[match.user_id]
          const isLoadingDetails = loadingDetails === match.user_id

          return (
            <div
              key={match.user_id}
              className="bg-white rounded-2xl border border-gray-100 overflow-hidden transition-all"
            >
              {/* Card header */}
              <button
                onClick={() => toggleExpand(match.user_id)}
                className="w-full px-4 py-3.5 flex items-center gap-3 text-left"
              >
                {/* Avatar */}
                <div className="w-11 h-11 bg-brand-light rounded-full flex items-center justify-center text-brand font-bold text-sm shrink-0">
                  {getInitials(match.display_name)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-gray-900 truncate">
                      {match.display_name?.split(' ')[0] || 'Usuário'}
                    </span>
                    <span className="text-[10px] text-gray-400 shrink-0">
                      {match.distance_km} km
                    </span>
                  </div>

                  {/* Badges */}
                  <div className="flex gap-1.5 flex-wrap">
                    {match.they_have > 0 && (
                      <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 rounded-md px-2 py-0.5 text-[10px] font-medium">
                        <span className="w-1 h-1 bg-emerald-500 rounded-full" />
                        Tem {match.they_have} que você precisa
                      </span>
                    )}
                    {match.i_have > 0 && (
                      <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 rounded-md px-2 py-0.5 text-[10px] font-medium">
                        <span className="w-1 h-1 bg-blue-500 rounded-full" />
                        Precisa de {match.i_have} que você tem
                      </span>
                    )}
                  </div>
                </div>

                {/* Chevron */}
                <svg
                  className={`w-4 h-4 text-gray-300 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>

              {/* Expanded details */}
              {isExpanded && (
                <div className="px-4 pb-4 border-t border-gray-50">
                  {isLoadingDetails ? (
                    <div className="flex justify-center py-4">
                      <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
                    </div>
                  ) : matchDetails ? (
                    <>
                      {/* They have (stickers I need) */}
                      {matchDetails.filter((d) => d.direction === 'they_have').length > 0 && (
                        <div className="mt-3">
                          <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider mb-2">
                            Tem pra te dar
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {matchDetails
                              .filter((d) => d.direction === 'they_have')
                              .map((d) => (
                                <span
                                  key={d.sticker_id}
                                  className="bg-emerald-50 text-emerald-800 rounded-lg px-2 py-1 text-[11px] font-medium"
                                  title={d.player_name || d.number}
                                >
                                  {d.number}
                                </span>
                              ))}
                          </div>
                        </div>
                      )}

                      {/* I have (stickers they need) */}
                      {matchDetails.filter((d) => d.direction === 'i_have').length > 0 && (
                        <div className="mt-3">
                          <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wider mb-2">
                            Você tem pra dar
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {matchDetails
                              .filter((d) => d.direction === 'i_have')
                              .map((d) => (
                                <span
                                  key={d.sticker_id}
                                  className="bg-blue-50 text-blue-800 rounded-lg px-2 py-1 text-[11px] font-medium"
                                  title={d.player_name || d.number}
                                >
                                  {d.number}
                                </span>
                              ))}
                          </div>
                        </div>
                      )}

                      {/* WhatsApp button - only if match_score >= 2 */}
                      {match.match_score >= 2 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            openWhatsApp(match)
                          }}
                          className="mt-4 w-full flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20BD5A] text-white rounded-xl py-2.5 text-sm font-medium transition-all active:scale-[0.98]"
                        >
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                          </svg>
                          Chamar no WhatsApp
                        </button>
                      )}
                    </>
                  ) : null}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
