'use client'

import { useState, useMemo, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getFlag } from '@/lib/countries'
import { canTrade, type Tier } from '@/lib/tiers'
import PaywallModal from '@/components/PaywallModal'

type Sticker = {
  id: number
  number: string
  player_name: string | null
  country: string
  section: string
  type: string
}

type UserStickerInfo = { status: string; quantity: number }

type NearbyMatch = {
  user_id: string
  display_name: string | null
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

const WATCHLIST_KEY = 'figurinhas_watchlist'
const WATCH_RADIUS_KEY = 'figurinhas_watch_radius'

function loadWatchlist(): number[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]')
  } catch { return [] }
}

function saveWatchlist(ids: number[]) {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(ids))
}

export default function TradesHub({
  userId,
  tier,
  stickers,
  userStickersMap,
  hasLocation: initialHasLocation,
  nearbyCount: initialNearbyCount,
  nearbyMatches: initialMatches,
}: {
  userId: string
  tier: Tier
  stickers: Sticker[]
  userStickersMap: Record<number, UserStickerInfo>
  hasLocation: boolean
  nearbyCount: number
  nearbyMatches: NearbyMatch[]
}) {
  const supabase = createClient()
  const isPremium = canTrade(tier)

  // ─── State ───
  const [showPaywall, setShowPaywall] = useState(false)
  const [watchlist, setWatchlist] = useState<number[]>([])
  const [watchRadius, setWatchRadius] = useState(50)
  const [showWatchPicker, setShowWatchPicker] = useState(false)
  const [watchSearch, setWatchSearch] = useState('')
  const [nearbyCount, setNearbyCount] = useState(initialNearbyCount)
  const [matches, setMatches] = useState<NearbyMatch[]>(initialMatches)
  const [hasLocation, setHasLocation] = useState(initialHasLocation)
  const [requestingLocation, setRequestingLocation] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, TradeDetail[]>>({})
  const [loadingDetails, setLoadingDetails] = useState<string | null>(null)
  const [radius, setRadius] = useState(50)
  const [loadingMatches, setLoadingMatches] = useState(false)

  // Load watchlist from localStorage
  useEffect(() => {
    setWatchlist(loadWatchlist())
    const savedRadius = localStorage.getItem(WATCH_RADIUS_KEY)
    if (savedRadius) setWatchRadius(Number(savedRadius))
  }, [])

  // ─── Computed ───
  const missingStickers = useMemo(() =>
    stickers.filter((s) => {
      const us = userStickersMap[s.id]
      return !us || us.status === 'missing'
    }),
    [stickers, userStickersMap]
  )

  const duplicateStickers = useMemo(() =>
    stickers.filter((s) => userStickersMap[s.id]?.status === 'duplicate'),
    [stickers, userStickersMap]
  )

  const totalExtras = useMemo(() =>
    duplicateStickers.reduce((acc, s) => acc + ((userStickersMap[s.id]?.quantity || 0) - 1), 0),
    [duplicateStickers, userStickersMap]
  )

  // Average sticker price estimate (R$1.50 each)
  const STICKER_PRICE = 1.5
  const potentialSavings = totalExtras * STICKER_PRICE
  const missingCost = missingStickers.length * STICKER_PRICE

  const watchedStickers = useMemo(() =>
    stickers.filter((s) => watchlist.includes(s.id)),
    [stickers, watchlist]
  )

  const filteredMissing = useMemo(() => {
    if (!watchSearch.trim()) return missingStickers.slice(0, 50)
    const q = watchSearch.toLowerCase()
    return missingStickers.filter(
      (s) =>
        s.number.toLowerCase().includes(q) ||
        (s.player_name && s.player_name.toLowerCase().includes(q)) ||
        s.country.toLowerCase().includes(q)
    ).slice(0, 50)
  }, [missingStickers, watchSearch])

  // Total stickers that nearby people have that user needs
  const nearbyStickersAvailable = useMemo(() =>
    matches.reduce((acc, m) => acc + m.they_have, 0),
    [matches]
  )

  // ─── Actions ───
  function toggleWatch(stickerId: number) {
    setWatchlist((prev) => {
      const next = prev.includes(stickerId)
        ? prev.filter((id) => id !== stickerId)
        : [...prev, stickerId]
      saveWatchlist(next)
      return next
    })
  }

  function updateWatchRadius(r: number) {
    setWatchRadius(r)
    localStorage.setItem(WATCH_RADIUS_KEY, String(r))
  }

  function requirePremium(action: () => void) {
    if (isPremium) {
      action()
    } else {
      setShowPaywall(true)
    }
  }

  async function requestLocation() {
    if (!navigator.geolocation) return
    setRequestingLocation(true)

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude
        const lng = position.coords.longitude

        await supabase
          .from('profiles')
          .update({
            location_lat: lat,
            location_lng: lng,
            last_active: new Date().toISOString(),
          })
          .eq('id', userId)

        setHasLocation(true)
        setRequestingLocation(false)
        loadMatchesFromServer()
      },
      () => {
        setRequestingLocation(false)
        alert('Não foi possível obter sua localização. Verifique as permissões do navegador.')
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  async function loadMatchesFromServer() {
    setLoadingMatches(true)
    try {
      const { data } = await supabase.rpc('get_trade_matches', {
        p_user_id: userId,
        p_radius_km: radius,
      })
      if (data) {
        setMatches(data as NearbyMatch[])
        setNearbyCount(data.length)
      }
    } catch {
      // RPC might not exist
    }
    setLoadingMatches(false)
  }

  async function loadDetails(otherId: string) {
    if (details[otherId]) return
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
    requirePremium(() => {
      if (expandedId === matchUserId) {
        setExpandedId(null)
      } else {
        setExpandedId(matchUserId)
        loadDetails(matchUserId)
      }
    })
  }

  function openWhatsApp(match: NearbyMatch) {
    const stickers = details[match.user_id] || []
    const theyHave = stickers.filter((s) => s.direction === 'they_have').slice(0, 10).map((s) => s.number)
    const iHave = stickers.filter((s) => s.direction === 'i_have').slice(0, 10).map((s) => s.number)

    let msg = 'Oi! Vi no app do Album da Copa que a gente pode trocar figurinhas!\n\n'
    if (iHave.length > 0) msg += 'Tenho repetidas pra te dar:\n' + iHave.join(', ') + '\n\n'
    if (theyHave.length > 0) msg += 'Preciso dessas suas:\n' + theyHave.join(', ') + '\n\n'
    msg += 'Bora trocar?'

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }

  function getInitials(name: string | null): string {
    if (!name) return '?'
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
  }

  return (
    <div className="px-4 pt-6 pb-28">
      {/* ─── Header ─── */}
      <h1 className="text-2xl font-black tracking-tight text-gray-900 mb-1">Trocas</h1>
      <p className="text-xs text-gray-400 mb-5">Encontre colecionadores perto de voce e economize</p>

      {/* ─── Savings Hero ─── */}
      <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-5 mb-4 shadow-lg">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-xs text-emerald-100 font-medium mb-1">Economia potencial com trocas</p>
            <p className="text-3xl font-black text-white">
              R${potentialSavings.toFixed(0)}
              <span className="text-sm font-medium text-emerald-200">,00</span>
            </p>
          </div>
          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
            </svg>
          </div>
        </div>
        <div className="flex gap-4">
          <div>
            <p className="text-xl font-bold text-white">{totalExtras}</p>
            <p className="text-[10px] text-emerald-200">figurinhas para trocar</p>
          </div>
          <div className="w-px bg-white/20" />
          <div>
            <p className="text-xl font-bold text-white">{missingStickers.length}</p>
            <p className="text-[10px] text-emerald-200">figurinhas faltantes</p>
          </div>
          <div className="w-px bg-white/20" />
          <div>
            <p className="text-xl font-bold text-white">R${missingCost.toFixed(0)}</p>
            <p className="text-[10px] text-emerald-200">custo sem trocar</p>
          </div>
        </div>
      </div>

      {/* ─── Nearby People Teaser ─── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center">
            <svg className="w-5 h-5 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-gray-900">Colecionadores perto de voce</p>
            <p className="text-[10px] text-gray-400">Raio de {radius} km</p>
          </div>
          {hasLocation && (
            <button
              onClick={loadMatchesFromServer}
              className="text-[10px] text-violet-500 font-semibold"
            >
              Atualizar
            </button>
          )}
        </div>

        {/* Radius selector */}
        <div className="flex gap-1.5 mb-4">
          {[10, 25, 50, 100].map((r) => (
            <button
              key={r}
              onClick={() => {
                setRadius(r)
                if (hasLocation) loadMatchesFromServer()
              }}
              className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold transition-all ${
                radius === r
                  ? 'bg-violet-500 text-white shadow-sm'
                  : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
              }`}
            >
              {r} km
            </button>
          ))}
        </div>

        {!hasLocation ? (
          <button
            onClick={requestLocation}
            disabled={requestingLocation}
            className="w-full flex items-center justify-center gap-2 py-3 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition active:scale-[0.98] disabled:opacity-50"
          >
            {requestingLocation ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Obtendo localizacao...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                </svg>
                Ativar localizacao para ver trocas
              </>
            )}
          </button>
        ) : loadingMatches ? (
          <div className="flex justify-center py-4">
            <div className="w-6 h-6 border-2 border-gray-200 border-t-violet-500 rounded-full animate-spin" />
          </div>
        ) : nearbyCount > 0 ? (
          <div>
            <div className="flex items-center gap-2 mb-3 bg-emerald-50 rounded-xl px-3 py-2.5">
              <span className="text-lg">🎉</span>
              <div>
                <p className="text-xs font-bold text-emerald-800">
                  {nearbyCount} pessoa{nearbyCount > 1 ? 's' : ''} encontrada{nearbyCount > 1 ? 's' : ''}!
                </p>
                <p className="text-[10px] text-emerald-600">
                  {nearbyStickersAvailable} figurinha{nearbyStickersAvailable > 1 ? 's' : ''} disponive{nearbyStickersAvailable > 1 ? 'is' : 'l'} que voce precisa
                </p>
              </div>
            </div>

            {/* Match preview cards */}
            <div className="space-y-2">
              {matches.map((match) => {
                const isExpanded = expandedId === match.user_id
                const matchDetails = details[match.user_id]
                const isLoadingDetail = loadingDetails === match.user_id

                return (
                  <div key={match.user_id} className="bg-gray-50 rounded-xl overflow-hidden border border-gray-100">
                    <button
                      onClick={() => toggleExpand(match.user_id)}
                      className="w-full px-3 py-3 flex items-center gap-3 text-left"
                    >
                      <div className="w-9 h-9 bg-violet-100 rounded-full flex items-center justify-center text-violet-600 font-bold text-xs shrink-0">
                        {getInitials(match.display_name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold text-gray-800 truncate">
                            {match.display_name?.split(' ')[0] || 'Usuario'}
                          </span>
                          <span className="text-[9px] text-gray-400">{match.distance_km} km</span>
                        </div>
                        <div className="flex gap-1.5 flex-wrap">
                          {match.they_have > 0 && (
                            <span className="inline-flex items-center gap-0.5 bg-emerald-100 text-emerald-700 rounded px-1.5 py-0.5 text-[9px] font-medium">
                              Tem {match.they_have} que voce precisa
                            </span>
                          )}
                          {match.i_have > 0 && (
                            <span className="inline-flex items-center gap-0.5 bg-blue-100 text-blue-700 rounded px-1.5 py-0.5 text-[9px] font-medium">
                              Precisa de {match.i_have} suas
                            </span>
                          )}
                        </div>
                      </div>

                      {!isPremium ? (
                        <span className="text-[9px] bg-violet-100 text-violet-600 rounded-full px-2 py-1 font-bold shrink-0">
                          PREMIUM
                        </span>
                      ) : (
                        <svg
                          className={`w-4 h-4 text-gray-300 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                      )}
                    </button>

                    {/* Premium: expanded details */}
                    {isPremium && isExpanded && (
                      <div className="px-3 pb-3 border-t border-gray-100">
                        {isLoadingDetail ? (
                          <div className="flex justify-center py-3">
                            <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
                          </div>
                        ) : matchDetails ? (
                          <>
                            {matchDetails.filter((d) => d.direction === 'they_have').length > 0 && (
                              <div className="mt-2">
                                <p className="text-[9px] font-semibold text-emerald-600 uppercase tracking-wider mb-1.5">Tem pra te dar</p>
                                <div className="flex flex-wrap gap-1">
                                  {matchDetails.filter((d) => d.direction === 'they_have').map((d) => (
                                    <span key={d.sticker_id} className="bg-emerald-50 text-emerald-800 rounded-lg px-1.5 py-0.5 text-[10px] font-medium">
                                      {d.number}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {matchDetails.filter((d) => d.direction === 'i_have').length > 0 && (
                              <div className="mt-2">
                                <p className="text-[9px] font-semibold text-blue-600 uppercase tracking-wider mb-1.5">Voce tem pra dar</p>
                                <div className="flex flex-wrap gap-1">
                                  {matchDetails.filter((d) => d.direction === 'i_have').map((d) => (
                                    <span key={d.sticker_id} className="bg-blue-50 text-blue-800 rounded-lg px-1.5 py-0.5 text-[10px] font-medium">
                                      {d.number}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); openWhatsApp(match) }}
                              className="mt-3 w-full flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20BD5A] text-white rounded-xl py-2.5 text-xs font-semibold transition active:scale-[0.98]"
                            >
                              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                              </svg>
                              Chamar no WhatsApp
                            </button>
                          </>
                        ) : null}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {!isPremium && (
              <button
                onClick={() => setShowPaywall(true)}
                className="w-full mt-3 py-3 bg-violet-600 text-white rounded-xl text-sm font-bold hover:bg-violet-700 transition active:scale-[0.98]"
              >
                Desbloquear trocas — ver detalhes e contatar
              </button>
            )}
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-2xl mb-2">🔍</p>
            <p className="text-xs text-gray-500 font-medium">Ninguem encontrado em {radius} km</p>
            <p className="text-[10px] text-gray-400 mt-1">Tente aumentar o raio de busca</p>
          </div>
        )}
      </div>

      {/* ─── Watchlist ─── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center text-sm">
              🔔
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Lista de desejos</p>
              <p className="text-[10px] text-gray-400">
                {watchlist.length > 0
                  ? `${watchlist.length} figurinha${watchlist.length > 1 ? 's' : ''} monitorada${watchlist.length > 1 ? 's' : ''}`
                  : 'Marque figurinhas para ser notificado'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowWatchPicker(!showWatchPicker)}
            className="text-xs font-semibold text-violet-500 bg-violet-50 px-3 py-1.5 rounded-lg hover:bg-violet-100 transition"
          >
            {showWatchPicker ? 'Fechar' : '+ Adicionar'}
          </button>
        </div>

        {/* Watch radius */}
        {watchlist.length > 0 && (
          <div className="mb-3">
            <p className="text-[10px] text-gray-400 mb-1.5">Raio de notificacao</p>
            <div className="flex gap-1.5">
              {[10, 25, 50, 100].map((r) => (
                <button
                  key={r}
                  onClick={() => updateWatchRadius(r)}
                  className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold transition-all ${
                    watchRadius === r
                      ? 'bg-amber-400 text-white'
                      : 'bg-gray-50 text-gray-400'
                  }`}
                >
                  {r} km
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Watched stickers display */}
        {watchedStickers.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {watchedStickers.map((s) => (
              <button
                key={s.id}
                onClick={() => toggleWatch(s.id)}
                className="inline-flex items-center gap-1 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-2 py-1 text-[10px] font-medium hover:bg-amber-100 transition group"
              >
                {getFlag(s.country)} {s.number}
                <svg className="w-3 h-3 text-amber-400 group-hover:text-red-500 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            ))}
          </div>
        )}

        {/* Sticker picker */}
        {showWatchPicker && (
          <div className="border-t border-gray-100 pt-3">
            <div className="relative mb-3">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={watchSearch}
                onChange={(e) => setWatchSearch(e.target.value)}
                placeholder="Buscar figurinha faltante..."
                className="w-full bg-gray-50 rounded-lg pl-8 pr-3 py-2 text-xs text-gray-700 placeholder-gray-300 focus:ring-1 focus:ring-violet-300 outline-none"
              />
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1">
              {filteredMissing.map((s) => {
                const isWatched = watchlist.includes(s.id)
                return (
                  <button
                    key={s.id}
                    onClick={() => toggleWatch(s.id)}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition ${
                      isWatched ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50 hover:bg-gray-100'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                      isWatched ? 'bg-amber-400 border-amber-400' : 'border-gray-200'
                    }`}>
                      {isWatched && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <span className="text-base leading-none">{getFlag(s.country)}</span>
                    <span className="text-[11px] font-bold text-gray-700">{s.number}</span>
                    <span className="text-[10px] text-gray-400 truncate flex-1">{s.player_name || s.country}</span>
                  </button>
                )
              })}
              {filteredMissing.length === 0 && (
                <p className="text-center text-[10px] text-gray-400 py-4">Nenhuma figurinha encontrada</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─── How it works ─── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <h2 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
          <span className="text-sm">💡</span>
          Como funciona
        </h2>
        <div className="space-y-3">
          <Step num={1} title="Encontre pessoas" desc="Veja quem perto de voce tem figurinhas que voce precisa" />
          <Step num={2} title="Combine trocas" desc="O app mostra automaticamente quais figurinhas combinem" />
          <Step num={3} title="Converse via WhatsApp" desc="Envie uma mensagem pronta e combine o ponto de encontro" />
          <Step num={4} title="Economize dinheiro" desc={`Ao inves de comprar, troque! Cada figurinha sai em media R$${STICKER_PRICE.toFixed(2)}`} />
        </div>
      </div>

      {/* ─── Fun facts ─── */}
      <div className="bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl p-5 shadow-lg mb-4">
        <h2 className="text-sm font-bold text-white/90 mb-3">Voce sabia?</h2>
        <div className="space-y-2.5">
          <div className="flex items-start gap-2">
            <span className="text-sm">💰</span>
            <p className="text-xs text-white/85 leading-relaxed">
              Completar o album comprando custaria aproximadamente <span className="font-bold">R${(stickers.length * STICKER_PRICE).toFixed(0)}</span>. Trocando, voce pode economizar muito!
            </p>
          </div>
          {totalExtras > 0 && (
            <div className="flex items-start gap-2">
              <span className="text-sm">🔄</span>
              <p className="text-xs text-white/85 leading-relaxed">
                Suas <span className="font-bold">{totalExtras} figurinhas extras</span> valem <span className="font-bold">R${potentialSavings.toFixed(0)}</span> em trocas
              </p>
            </div>
          )}
          <div className="flex items-start gap-2">
            <span className="text-sm">📊</span>
            <p className="text-xs text-white/85 leading-relaxed">
              Em media, colecionadores precisam trocar <span className="font-bold">3x mais</span> figurinhas do que o tamanho do album para completa-lo
            </p>
          </div>
        </div>
      </div>

      {/* ─── Premium CTA for non-premium ─── */}
      {!isPremium && (
        <div className="bg-white rounded-2xl border-2 border-violet-200 p-4">
          <div className="text-center mb-3">
            <span className="text-3xl">🔓</span>
          </div>
          <h3 className="text-sm font-bold text-gray-900 text-center mb-1">Desbloqueie Trocas</h3>
          <p className="text-[10px] text-gray-400 text-center mb-3">
            Veja detalhes dos matches, converse via WhatsApp e receba notificacoes da sua lista de desejos
          </p>
          <div className="flex flex-col gap-1 mb-3 px-4">
            <FeatureCheck text="Ver detalhes de cada colecionador" />
            <FeatureCheck text="Mensagem pronta no WhatsApp" />
            <FeatureCheck text="Alerta de figurinhas desejadas" />
            <FeatureCheck text="Scanner IA ilimitado" />
          </div>
          <button
            onClick={() => setShowPaywall(true)}
            className="w-full bg-violet-600 text-white rounded-xl py-3 text-sm font-bold hover:bg-violet-700 transition active:scale-[0.98]"
          >
            Desbloquear por R$19,90
          </button>
          <p className="text-[9px] text-gray-300 text-center mt-2">Pagamento unico. Sem assinatura.</p>
        </div>
      )}

      {/* Paywall Modal */}
      {showPaywall && (
        <PaywallModal
          feature="trades"
          currentTier={tier}
          onClose={() => setShowPaywall(false)}
        />
      )}
    </div>
  )
}

function Step({ num, title, desc }: { num: number; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-7 h-7 rounded-full bg-violet-50 flex items-center justify-center shrink-0">
        <span className="text-[10px] font-black text-violet-500">{num}</span>
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-800">{title}</p>
        <p className="text-[10px] text-gray-400 mt-0.5">{desc}</p>
      </div>
    </div>
  )
}

function FeatureCheck({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2">
      <svg className="w-3.5 h-3.5 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      <span className="text-[10px] text-gray-600">{text}</span>
    </div>
  )
}
