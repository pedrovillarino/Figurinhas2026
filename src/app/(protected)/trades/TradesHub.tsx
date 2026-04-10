'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getFlag } from '@/lib/countries'
import { canTrade, type Tier } from '@/lib/tiers'
import PaywallModal from '@/components/PaywallModal'
import TradeRequestsBanner from '@/components/TradeRequestsBanner'

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

type PendingRequest = {
  id: string
  requester_id: string
  requester_name: string | null
  requester_avatar: string | null
  they_have: number
  i_have: number
  match_score: number
  distance_km: number | null
  message: string | null
  created_at: string
}

type TradeDetail = {
  sticker_id: number
  number: string
  player_name: string | null
  country: string
  direction: 'they_have' | 'i_have'
}

// localStorage stores EXCLUDED sticker ids (inverse logic: all missing are watched by default)
const EXCLUDED_KEY = 'figurinhas_watch_excluded'
const WATCH_RADIUS_KEY = 'figurinhas_watch_radius'
const NOTIFY_CHANNEL_KEY = 'figurinhas_notify_channel'
const NOTIFY_MIN_KEY = 'figurinhas_notify_min_threshold'
const NOTIFY_PRIORITY_KEY = 'figurinhas_notify_priority'

type NotifyChannel = 'whatsapp' | 'email' | 'both'

function loadExcluded(): number[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(EXCLUDED_KEY) || '[]')
  } catch { return [] }
}

function saveExcluded(ids: number[]) {
  localStorage.setItem(EXCLUDED_KEY, JSON.stringify(ids))
}

function loadNotifyPrefs(): { channel: NotifyChannel; minThreshold: number; priorityIds: number[] } {
  if (typeof window === 'undefined') return { channel: 'whatsapp', minThreshold: 1, priorityIds: [] }
  try {
    return {
      channel: (localStorage.getItem(NOTIFY_CHANNEL_KEY) as NotifyChannel) || 'whatsapp',
      minThreshold: Number(localStorage.getItem(NOTIFY_MIN_KEY) || '1'),
      priorityIds: JSON.parse(localStorage.getItem(NOTIFY_PRIORITY_KEY) || '[]'),
    }
  } catch { return { channel: 'whatsapp', minThreshold: 1, priorityIds: [] } }
}

export default function TradesHub({
  userId,
  tier,
  stickers,
  userStickersMap,
  hasLocation: initialHasLocation,
  nearbyCount: initialNearbyCount,
  nearbyMatches: initialMatches,
  pendingRequests: initialPendingRequests,
}: {
  userId: string
  tier: Tier
  stickers: Sticker[]
  userStickersMap: Record<number, UserStickerInfo>
  hasLocation: boolean
  nearbyCount: number
  nearbyMatches: NearbyMatch[]
  pendingRequests: PendingRequest[]
}) {
  const supabase = createClient()
  const isPremium = canTrade(tier)

  // ─── State ───
  const [showPaywall, setShowPaywall] = useState(false)
  const [excluded, setExcluded] = useState<number[]>([])
  const [watchRadius, setWatchRadius] = useState(50)
  const [showExcludeManager, setShowExcludeManager] = useState(false)
  const [excludeSearch, setExcludeSearch] = useState('')
  const [nearbyCount, setNearbyCount] = useState(initialNearbyCount)
  const [matches, setMatches] = useState<NearbyMatch[]>(
    [...initialMatches].sort((a, b) => a.distance_km - b.distance_km)
  )
  const [hasLocation, setHasLocation] = useState(initialHasLocation)
  const [requestingLocation, setRequestingLocation] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, TradeDetail[]>>({})
  const [loadingDetails, setLoadingDetails] = useState<string | null>(null)
  const [radius, setRadius] = useState(50)
  const [loadingMatches, setLoadingMatches] = useState(false)
  const [requestingTrade, setRequestingTrade] = useState<string | null>(null)
  const [requestedTrades, setRequestedTrades] = useState<Set<string>>(new Set())

  // Notification preferences
  const [notifyChannel, setNotifyChannel] = useState<NotifyChannel>('whatsapp')
  const [notifyMinThreshold, setNotifyMinThreshold] = useState(1)
  const [notifyPriorityIds, setNotifyPriorityIds] = useState<number[]>([])
  const [showNotifyConfig, setShowNotifyConfig] = useState(false)
  const [showPriorityPicker, setShowPriorityPicker] = useState(false)
  const [prioritySearch, setPrioritySearch] = useState('')
  const [savingPrefs, setSavingPrefs] = useState(false)

  // Load excluded list + notification prefs from localStorage
  useEffect(() => {
    setExcluded(loadExcluded())
    const savedRadius = localStorage.getItem(WATCH_RADIUS_KEY)
    if (savedRadius) setWatchRadius(Number(savedRadius))
    const prefs = loadNotifyPrefs()
    setNotifyChannel(prefs.channel)
    setNotifyMinThreshold(prefs.minThreshold)
    setNotifyPriorityIds(prefs.priorityIds)
  }, [])

  // ─── Computed ───
  const missingStickers = useMemo(() =>
    stickers.filter((s) => {
      const us = userStickersMap[s.id]
      return !us || us.status === 'missing'
    }),
    [stickers, userStickersMap]
  )

  // Watchlist = all missing MINUS excluded (auto-synced: collected stickers disappear automatically)
  const watchedIds = useMemo(() => {
    return missingStickers.filter((s) => !excluded.includes(s.id)).map((s) => s.id)
  }, [missingStickers, excluded])

  const watchedCount = watchedIds.length

  const duplicateStickers = useMemo(() =>
    stickers.filter((s) => userStickersMap[s.id]?.status === 'duplicate'),
    [stickers, userStickersMap]
  )

  const totalExtras = useMemo(() =>
    duplicateStickers.reduce((acc, s) => acc + ((userStickersMap[s.id]?.quantity || 0) - 1), 0),
    [duplicateStickers, userStickersMap]
  )

  const STICKER_PRICE = 1.5
  const PACK_SIZE = 5
  const PACK_PRICE = PACK_SIZE * STICKER_PRICE // R$7,50 por pacote
  const potentialSavings = totalExtras * STICKER_PRICE

  // ─── Probabilidade & Custo (Problema do Colecionador de Cupons) ───
  const albumStats = useMemo(() => {
    const N = stickers.length
    const k = N - missingStickers.length // figurinhas ja coladas
    const missing = missingStickers.length
    const totalExtrasCount = totalExtras

    if (N === 0) return null

    // Numero harmonico: H(n) = 1 + 1/2 + 1/3 + ... + 1/n
    function harmonic(n: number): number {
      let h = 0
      for (let i = 1; i <= n; i++) h += 1 / i
      return h
    }

    // Probabilidade de uma figurinha avulsa ser nova
    const probNova = missing / N

    // Probabilidade de pelo menos 1 nova no pacote de PACK_SIZE
    const probPacote = missing > 0 ? 1 - Math.pow(k / N, PACK_SIZE) : 0

    // Custo esperado RESTANTE sem trocar (Coupon Collector corrigido)
    // E[restante | ja tem k] = N × H(N-k) figurinhas individuais
    const expectedRemaining = missing > 0 ? N * harmonic(missing) : 0
    const expectedPacks = expectedRemaining / PACK_SIZE
    const expectedCost = expectedPacks * PACK_PRICE

    // Custo se pudesse comprar exatamente as faltantes (cenario ideal com trocas)
    const idealCost = missing * STICKER_PRICE

    // Custo com troca otimizada (app encontra as trocas certas)
    // Estima que trocando repetidas o usuario cobre ~70% das faltantes, comprando so ~30%
    const tradeEfficiency = Math.min(0.7, totalExtrasCount > 0 ? (totalExtrasCount / missing) * 0.8 : 0.3)
    const optimizedCost = Math.round(missing * (1 - tradeEfficiency) * STICKER_PRICE + (missing * tradeEfficiency * STICKER_PRICE * 0.15))
    const savingsVsAlone = expectedCost - optimizedCost
    const savingsOptPercent = expectedCost > 0 ? Math.round((savingsVsAlone / expectedCost) * 100) : 0

    return {
      total: N,
      owned: k,
      missing,
      probNova: Math.round(probNova * 100),
      probPacote: Math.round(probPacote * 100),
      expectedPacks: Math.round(expectedPacks),
      expectedCost: Math.round(expectedCost),
      idealCost: Math.round(idealCost),
      optimizedCost,
      savingsVsAlone: Math.round(savingsVsAlone),
      savingsOptPercent,
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stickers.length, missingStickers.length, totalExtras])

  const nearbyStickersAvailable = useMemo(() =>
    matches.reduce((acc, m) => acc + m.they_have, 0),
    [matches]
  )

  // Stickers the user can search to exclude from watchlist
  const filteredWatched = useMemo(() => {
    const watched = missingStickers.filter((s) => !excluded.includes(s.id))
    if (!excludeSearch.trim()) return watched.slice(0, 50)
    const q = excludeSearch.toLowerCase()
    return watched.filter(
      (s) =>
        s.number.toLowerCase().includes(q) ||
        (s.player_name && s.player_name.toLowerCase().includes(q)) ||
        s.country.toLowerCase().includes(q)
    ).slice(0, 50)
  }, [missingStickers, excluded, excludeSearch])

  // ─── Actions ───
  function toggleExclude(stickerId: number) {
    setExcluded((prev) => {
      const next = prev.includes(stickerId)
        ? prev.filter((id) => id !== stickerId)
        : [...prev, stickerId]
      saveExcluded(next)
      return next
    })
  }

  // Save notification preferences to localStorage + Supabase
  async function saveNotifyPrefs(channel: NotifyChannel, min: number, priority: number[], notifyRadius: number) {
    localStorage.setItem(NOTIFY_CHANNEL_KEY, channel)
    localStorage.setItem(NOTIFY_MIN_KEY, String(min))
    localStorage.setItem(NOTIFY_PRIORITY_KEY, JSON.stringify(priority))
    localStorage.setItem(WATCH_RADIUS_KEY, String(notifyRadius))
    setSavingPrefs(true)
    try {
      await supabase
        .from('profiles')
        .update({
          notify_channel: channel,
          notify_min_threshold: min,
          notify_priority_stickers: priority,
          notify_radius_km: notifyRadius,
        })
        .eq('id', userId)
    } catch {
      // columns might not exist yet, prefs still saved in localStorage
    }
    setSavingPrefs(false)
  }

  function togglePrioritySticker(stickerId: number) {
    setNotifyPriorityIds((prev) => {
      const next = prev.includes(stickerId)
        ? prev.filter((id) => id !== stickerId)
        : [...prev, stickerId]
      return next
    })
  }

  // Priority sticker search results
  const filteredPriority = useMemo(() => {
    if (!prioritySearch.trim()) return missingStickers.slice(0, 50)
    const q = prioritySearch.toLowerCase()
    return missingStickers.filter(
      (s) =>
        s.number.toLowerCase().includes(q) ||
        (s.player_name && s.player_name.toLowerCase().includes(q)) ||
        s.country.toLowerCase().includes(q)
    ).slice(0, 50)
  }, [missingStickers, prioritySearch])

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

  const loadMatchesFromServer = useCallback(async () => {
    setLoadingMatches(true)
    try {
      const { data } = await supabase.rpc('get_trade_matches', {
        p_user_id: userId,
        p_radius_km: radius,
      })
      if (data) {
        setMatches([...(data as NearbyMatch[])].sort((a, b) => a.distance_km - b.distance_km))
        setNearbyCount(data.length)
      }
    } catch {
      // RPC might not exist
    }
    setLoadingMatches(false)
  }, [supabase, userId, radius])

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

  // Send trade request (approval flow instead of direct WhatsApp)
  async function requestTrade(match: NearbyMatch) {
    setRequestingTrade(match.user_id)

    try {
      const res = await fetch('/api/trade-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_user_id: match.user_id,
          they_have: match.they_have,
          i_have: match.i_have,
          match_score: match.match_score,
        }),
      })

      const data = await res.json()
      if (res.ok) {
        setRequestedTrades((prev) => new Set([...Array.from(prev), match.user_id]))
      } else {
        // Already requested or other error
        if (res.status === 409) {
          setRequestedTrades((prev) => new Set([...Array.from(prev), match.user_id]))
        }
        alert(data.error || 'Erro ao solicitar troca.')
      }
    } catch {
      alert('Erro de conexão. Tente novamente.')
    }

    setRequestingTrade(null)
  }

  // Respond to a received trade request (approve/reject)
  async function handleRespondToRequest(requestId: string, action: 'approve' | 'reject') {
    const res = await fetch('/api/trade-respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: requestId, action }),
    })

    if (!res.ok) {
      const data = await res.json()
      alert(data.error || 'Erro ao responder.')
    }
  }

  function getInitials(name: string | null): string {
    if (!name) return '?'
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
  }

  return (
    <div className="px-4 pt-6 pb-28">
      {/* ─── Header ─── */}
      <h1 className="text-2xl font-black tracking-tight text-gray-900 mb-1">Trocas</h1>
      <p className="text-xs text-gray-400 mb-5">Encontre colecionadores perto de você e economize</p>

      {/* ─── Por que trocar? ─── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-4">
        {/* Header com economia */}
        <div className="bg-gradient-to-br from-emerald-500 to-teal-600 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-emerald-100 font-medium">Por que trocar vale a pena</p>
            {albumStats && albumStats.savingsVsAlone > 0 && (
              <span className="text-[10px] font-bold text-emerald-900 bg-emerald-200 rounded-full px-2 py-0.5">
                -{albumStats.savingsOptPercent}% custo
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-black text-white">
              R${albumStats ? albumStats.savingsVsAlone : potentialSavings.toFixed(0)}
            </p>
            <p className="text-sm text-emerald-200">de economia estimada</p>
          </div>
        </div>

        {/* Comparativo visual */}
        <div className="p-4">
          {albumStats && (
            <div className="space-y-2.5 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs">😰</span>
                <div className="flex-1">
                  <div className="flex justify-between text-[10px] mb-0.5">
                    <span className="text-gray-500">Comprando sozinho</span>
                    <span className="font-bold text-red-500">R${albumStats.expectedCost}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-red-400 rounded-full" style={{ width: '100%' }} />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs">🚀</span>
                <div className="flex-1">
                  <div className="flex justify-between text-[10px] mb-0.5">
                    <span className="text-gray-500 font-semibold">Trocando com o app</span>
                    <span className="font-bold text-emerald-600">R${albumStats.optimizedCost}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-400 to-teal-400 rounded-full"
                      style={{ width: `${albumStats.expectedCost > 0 ? Math.max(5, (albumStats.optimizedCost / albumStats.expectedCost) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Stats row */}
          <div className="flex gap-2">
            <div className="flex-1 bg-gray-50 rounded-lg p-2.5 text-center">
              <p className="text-lg font-black text-gray-800">{totalExtras}</p>
              <p className="text-[9px] text-gray-500">repetidas para trocar</p>
            </div>
            <div className="flex-1 bg-gray-50 rounded-lg p-2.5 text-center">
              <p className="text-lg font-black text-gray-800">{missingStickers.length}</p>
              <p className="text-[9px] text-gray-500">faltantes</p>
            </div>
            <div className="flex-1 bg-gray-50 rounded-lg p-2.5 text-center">
              <p className="text-lg font-black text-gray-800">{albumStats ? albumStats.probNova : Math.round((missingStickers.length / stickers.length) * 100)}%</p>
              <p className="text-[9px] text-gray-500">chance de nova</p>
            </div>
          </div>

          {/* Contextual message */}
          {albumStats && albumStats.probNova < 40 && (
            <p className="text-[10px] text-orange-600 bg-orange-50 rounded-lg px-3 py-2 mt-2.5 leading-relaxed">
              Com {albumStats.probNova}% de chance de nova, {albumStats.probNova < 20 ? '4 em cada 5' : '3 em cada 5'} figurinhas compradas serao repetidas. Trocar e muito mais eficiente nessa fase.
            </p>
          )}
        </div>
      </div>

      {/* ─── Notificacoes & Lista de desejos ─── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-sm shadow-sm">🔔</div>
            <div>
              <p className="text-sm font-bold text-gray-900">Alertas de figurinhas</p>
              <p className="text-[10px] text-gray-400">
                Seja notificado quando alguém perto tiver figurinhas que você precisa
              </p>
            </div>
          </div>
        </div>

        {/* Summary bar */}
        <div className="flex items-center gap-2 bg-amber-50 rounded-xl px-3 py-2.5 mb-3">
          <span className="text-sm">📋</span>
          <div className="flex-1">
            <p className="text-[11px] font-semibold text-amber-800">
              Monitorando <span className="text-amber-600">{watchedCount}</span> figurinha{watchedCount !== 1 ? 's' : ''} faltante{watchedCount !== 1 ? 's' : ''}
            </p>
            <p className="text-[9px] text-amber-600">
              {notifyPriorityIds.length > 0 && `${notifyPriorityIds.length} prioritária${notifyPriorityIds.length > 1 ? 's' : ''} · `}
              Via {notifyChannel === 'whatsapp' ? 'WhatsApp' : notifyChannel === 'email' ? 'e-mail' : 'WhatsApp + e-mail'} · Raio {watchRadius}km · Min. {notifyMinThreshold} fig.
            </p>
          </div>
          <button
            onClick={() => setShowNotifyConfig(!showNotifyConfig)}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${showNotifyConfig ? 'bg-amber-200' : 'bg-amber-100 hover:bg-amber-200'}`}
          >
            <svg className="w-4 h-4 text-amber-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>

        <p className="text-[10px] text-gray-400 mb-3">
          Todas as figurinhas faltantes são monitoradas automaticamente. Quando você cola uma no álbum, ela sai da lista. Configure abaixo como e quando quer ser notificado.
        </p>

        {/* ─── Notification Config Panel ─── */}
        {showNotifyConfig && (
          <div className="border border-amber-100 rounded-xl p-3 mb-3 bg-amber-50/30 space-y-4">
            <p className="text-[11px] font-bold text-gray-800 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Configurações de notificação
            </p>

            {/* Canal de notificacao */}
            <div>
              <p className="text-[10px] text-gray-500 font-medium mb-1.5">Como quer ser notificado?</p>
              <div className="flex gap-1.5">
                {([
                  { key: 'whatsapp' as NotifyChannel, icon: '💬', label: 'WhatsApp' },
                  { key: 'email' as NotifyChannel, icon: '📧', label: 'E-mail' },
                  { key: 'both' as NotifyChannel, icon: '📲', label: 'Ambos' },
                ]).map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setNotifyChannel(opt.key)}
                    className={`flex-1 py-2 rounded-lg text-[10px] font-semibold transition-all flex items-center justify-center gap-1 ${
                      notifyChannel === opt.key
                        ? 'bg-amber-400 text-white shadow-sm'
                        : 'bg-white text-gray-400 border border-gray-100 hover:border-amber-200'
                    }`}
                  >
                    <span className="text-xs">{opt.icon}</span> {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Raio de notificacao */}
            <div>
              <p className="text-[10px] text-gray-500 font-medium mb-1.5">Raio máximo para alertas</p>
              <div className="flex gap-1.5">
                {[5, 10, 15, 25, 50].map((r) => (
                  <button
                    key={r}
                    onClick={() => setWatchRadius(r)}
                    className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold transition-all ${
                      watchRadius === r ? 'bg-amber-400 text-white' : 'bg-white text-gray-400 border border-gray-100'
                    }`}
                  >
                    {r} km
                  </button>
                ))}
              </div>
              <p className="text-[9px] text-gray-400 mt-1">Você só será notificado quando alguém dentro deste raio tiver suas figurinhas</p>
            </div>

            {/* Minimo de figurinhas */}
            <div>
              <p className="text-[10px] text-gray-500 font-medium mb-1.5">Mínimo de figurinhas para notificar</p>
              <p className="text-[9px] text-gray-400 mb-2">Só enviar alerta se a pessoa tiver pelo menos X figurinhas que você precisa</p>
              <div className="flex gap-1.5">
                {[1, 2, 3, 5, 10].map((n) => (
                  <button
                    key={n}
                    onClick={() => setNotifyMinThreshold(n)}
                    className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold transition-all ${
                      notifyMinThreshold === n
                        ? 'bg-amber-400 text-white shadow-sm'
                        : 'bg-white text-gray-400 border border-gray-100 hover:border-amber-200'
                    }`}
                  >
                    {n}+
                  </button>
                ))}
              </div>
              {notifyMinThreshold > 1 && (
                <p className="text-[9px] text-amber-600 mt-1.5">
                  ⚡ Você só será notificado quando alguém tiver {notifyMinThreshold}+ figurinhas que você precisa
                  {notifyPriorityIds.length > 0 && ' (exceto figurinhas prioritárias, que sempre notificam)'}
                </p>
              )}
            </div>

            {/* Figurinhas prioritarias */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div>
                  <p className="text-[10px] text-gray-500 font-medium">Figurinhas prioritárias</p>
                  <p className="text-[9px] text-gray-400">Sempre notificar quando alguém tiver, independente do mínimo</p>
                </div>
                {notifyPriorityIds.length > 0 && (
                  <span className="text-[9px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full font-bold">
                    {notifyPriorityIds.length}
                  </span>
                )}
              </div>

              {/* Priority stickers chips */}
              {notifyPriorityIds.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {notifyPriorityIds.map((id) => {
                    const sticker = missingStickers.find((s) => s.id === id)
                    if (!sticker) return null
                    return (
                      <button
                        key={id}
                        onClick={() => togglePrioritySticker(id)}
                        className="inline-flex items-center gap-0.5 bg-orange-100 text-orange-700 rounded-lg px-1.5 py-0.5 text-[9px] font-medium border border-orange-200 hover:bg-orange-200 transition"
                      >
                        {getFlag(sticker.country)} {sticker.number}
                        <svg className="w-2.5 h-2.5 ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )
                  })}
                </div>
              )}

              <button
                onClick={() => setShowPriorityPicker(!showPriorityPicker)}
                className="text-[10px] font-semibold text-orange-500 hover:text-orange-600 transition"
              >
                {showPriorityPicker ? 'Fechar' : '+ Adicionar figurinhas prioritárias'}
              </button>

              {showPriorityPicker && (
                <div className="mt-2 border border-orange-100 rounded-lg p-2 bg-white">
                  <div className="relative mb-2">
                    <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      type="text"
                      value={prioritySearch}
                      onChange={(e) => setPrioritySearch(e.target.value)}
                      placeholder="Buscar figurinha faltante..."
                      className="w-full bg-gray-50 rounded-lg pl-8 pr-3 py-2 text-xs text-gray-700 placeholder-gray-300 focus:ring-1 focus:ring-orange-300 outline-none"
                    />
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-0.5">
                    {filteredPriority.map((s) => {
                      const isPriority = notifyPriorityIds.includes(s.id)
                      return (
                        <button
                          key={s.id}
                          onClick={() => togglePrioritySticker(s.id)}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition ${
                            isPriority ? 'bg-orange-50 border border-orange-200' : 'hover:bg-gray-50'
                          }`}
                        >
                          <div className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0 ${
                            isPriority ? 'bg-orange-400 border-orange-400' : 'border-gray-300'
                          }`}>
                            {isPriority && (
                              <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                          <span className="text-sm leading-none">{getFlag(s.country)}</span>
                          <span className="text-[10px] font-bold text-gray-700">{s.number}</span>
                          <span className="text-[9px] text-gray-400 truncate flex-1">{s.player_name || s.country}</span>
                          {isPriority && <span className="text-[8px] text-orange-500 font-bold">⭐</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Save button */}
            <button
              onClick={() => {
                saveNotifyPrefs(notifyChannel, notifyMinThreshold, notifyPriorityIds, watchRadius)
                setShowNotifyConfig(false)
              }}
              disabled={savingPrefs}
              className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {savingPrefs ? (
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
              Salvar configurações
            </button>
          </div>
        )}

        {/* Excluded count + manage */}
        {excluded.length > 0 && (
          <p className="text-[10px] text-gray-400 mb-2">
            {excluded.length} figurinha{excluded.length > 1 ? 's' : ''} removida{excluded.length > 1 ? 's' : ''} do monitoramento
          </p>
        )}

        <button
          onClick={() => setShowExcludeManager(!showExcludeManager)}
          className="text-[10px] font-semibold text-violet-500 hover:text-violet-600 transition"
        >
          {showExcludeManager ? 'Fechar gerenciamento' : 'Gerenciar lista (remover/adicionar figurinhas)'}
        </button>

        {/* Exclude manager */}
        {showExcludeManager && (
          <div className="border-t border-gray-100 pt-3 mt-3">
            <p className="text-[10px] text-gray-500 mb-2">Desmarque as que você <span className="font-bold">não</span> quer monitorar:</p>
            <div className="relative mb-3">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={excludeSearch}
                onChange={(e) => setExcludeSearch(e.target.value)}
                placeholder="Buscar figurinha..."
                className="w-full bg-gray-50 rounded-lg pl-8 pr-3 py-2 text-xs text-gray-700 placeholder-gray-300 focus:ring-1 focus:ring-violet-300 outline-none"
              />
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1">
              {filteredWatched.map((s) => {
                const isExcluded = excluded.includes(s.id)
                return (
                  <button
                    key={s.id}
                    onClick={() => toggleExclude(s.id)}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition ${
                      isExcluded ? 'bg-gray-100 opacity-50' : 'bg-amber-50 border border-amber-100'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                      !isExcluded ? 'bg-amber-400 border-amber-400' : 'border-gray-300'
                    }`}>
                      {!isExcluded && (
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
              {filteredWatched.length === 0 && (
                <p className="text-center text-[10px] text-gray-400 py-4">Nenhuma figurinha encontrada</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─── Nearby People ─── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center">
            <svg className="w-5 h-5 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-gray-900">Colecionadores perto de você</p>
            <p className="text-[10px] text-gray-400">Raio de {radius} km</p>
          </div>
          {hasLocation && (
            <button onClick={loadMatchesFromServer} className="text-[10px] text-violet-500 font-semibold">
              Atualizar
            </button>
          )}
        </div>

        {/* Radius selector */}
        <div className="flex gap-1.5 mb-4">
          {[5, 10, 15, 25, 50].map((r) => (
            <button
              key={r}
              onClick={() => { setRadius(r); if (hasLocation) loadMatchesFromServer() }}
              className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold transition-all ${
                radius === r ? 'bg-violet-500 text-white shadow-sm' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
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
                Obtendo localização...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                </svg>
                Ativar localização para ver trocas
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
                  {nearbyStickersAvailable} figurinha{nearbyStickersAvailable > 1 ? 's' : ''} disponive{nearbyStickersAvailable > 1 ? 'is' : 'l'} que você precisa
                </p>
              </div>
            </div>

            {/* Pending trade requests received */}
            <TradeRequestsBanner
              requests={initialPendingRequests}
              onRespond={handleRespondToRequest}
            />

            {/* Match cards */}
            <div className="space-y-2">
              {matches.map((match) => {
                const isExpanded = expandedId === match.user_id
                const matchDetails = details[match.user_id]
                const isLoadingDetail = loadingDetails === match.user_id
                const isSending = requestingTrade === match.user_id
                const alreadyRequested = requestedTrades.has(match.user_id)

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
                            {match.display_name?.split(' ')[0] || 'Usuário'}
                          </span>
                          <span className="text-[9px] text-gray-400">{match.distance_km} km</span>
                        </div>
                        <div className="flex gap-1.5 flex-wrap">
                          {match.they_have > 0 && (
                            <span className="inline-flex items-center gap-0.5 bg-emerald-100 text-emerald-700 rounded px-1.5 py-0.5 text-[9px] font-medium">
                              Tem {match.they_have} que você precisa
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
                                    <span key={d.sticker_id} className={`rounded-lg px-1.5 py-0.5 text-[10px] font-medium ${
                                      watchedIds.includes(d.sticker_id)
                                        ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                        : 'bg-emerald-50 text-emerald-800'
                                    }`}>
                                      {watchedIds.includes(d.sticker_id) && '🔔 '}{d.number}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {matchDetails.filter((d) => d.direction === 'i_have').length > 0 && (
                              <div className="mt-2">
                                <p className="text-[9px] font-semibold text-blue-600 uppercase tracking-wider mb-1.5">Você tem pra dar</p>
                                <div className="flex flex-wrap gap-1">
                                  {matchDetails.filter((d) => d.direction === 'i_have').map((d) => (
                                    <span key={d.sticker_id} className="bg-blue-50 text-blue-800 rounded-lg px-1.5 py-0.5 text-[10px] font-medium">
                                      {d.number}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {/* Trade request button */}
                            {alreadyRequested ? (
                              <div className="mt-3 w-full flex items-center justify-center gap-2 bg-gray-100 text-gray-500 rounded-xl py-2.5 text-xs font-semibold">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                Solicitação enviada — aguardando aprovação
                              </div>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); requestTrade(match) }}
                                disabled={isSending}
                                className="mt-3 w-full flex items-center justify-center gap-2 bg-violet-500 hover:bg-violet-600 text-white rounded-xl py-2.5 text-xs font-semibold transition active:scale-[0.98] disabled:opacity-50"
                              >
                                {isSending ? (
                                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                                  </svg>
                                )}
                                Solicitar troca
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

            {!isPremium && (
              <button
                onClick={() => setShowPaywall(true)}
                className="w-full mt-3 py-3 bg-violet-600 text-white rounded-xl text-sm font-bold hover:bg-violet-700 transition active:scale-[0.98]"
              >
                Desbloquear trocas — ver detalhes e notificar
              </button>
            )}
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-2xl mb-2">🔍</p>
            <p className="text-xs text-gray-500 font-medium">Ninguém encontrado em {radius} km</p>
            <p className="text-[10px] text-gray-400 mt-1">Tente aumentar o raio de busca</p>
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
          <Step num={1} title="Monitoramento automático" desc="Todas as faltantes são monitoradas. Defina raio, mínimo de figurinhas e prioridades" />
          <Step num={2} title="Alerta inteligente" desc="Quando alguém perto tiver suas figurinhas, você recebe um alerta via WhatsApp ou e-mail" />
          <Step num={3} title="Solicite com aprovação" desc="Envie uma solicitação de troca. O outro usuário aprova e os contatos são compartilhados" />
          <Step num={4} title="Colou? Sai da lista!" desc="Quando marca como colada no álbum, a figurinha sai do monitoramento automaticamente" />
        </div>
      </div>

      {/* ─── Probabilidade & Custo para completar ─── */}
      {albumStats && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-sm shadow-sm">📊</div>
            <div>
              <p className="text-sm font-bold text-gray-900">Probabilidade & custo</p>
              <p className="text-[10px] text-gray-400">Suas chances e quanto falta para completar</p>
            </div>
          </div>

          {/* Probability gauges */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-3 text-center">
              <p className="text-2xl font-black text-blue-600">{albumStats.probNova}%</p>
              <p className="text-[9px] text-blue-500 font-medium mt-0.5">chance de figurinha nova</p>
              <p className="text-[8px] text-gray-400">(por figurinha avulsa)</p>
            </div>
            <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl p-3 text-center">
              <p className="text-2xl font-black text-emerald-600">{albumStats.probPacote}%</p>
              <p className="text-[9px] text-emerald-500 font-medium mt-0.5">chance de nova no pacote</p>
              <p className="text-[8px] text-gray-400">(pelo menos 1 em {PACK_SIZE})</p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mb-3">
            <div className="flex justify-between items-baseline mb-1">
              <p className="text-[10px] font-semibold text-gray-600">Progresso do álbum</p>
              <p className="text-[10px] text-gray-400">{albumStats.owned}/{albumStats.total}</p>
            </div>
            <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${(albumStats.owned / albumStats.total) * 100}%` }}
              />
            </div>
            <p className="text-[9px] text-gray-400 mt-0.5">{Math.round((albumStats.owned / albumStats.total) * 100)}% completo</p>
          </div>

          {/* Cost comparison */}
          <div className="bg-gray-50 rounded-xl p-3 mb-3">
            <p className="text-[10px] font-bold text-gray-700 mb-2.5">Custo estimado para completar</p>

            {/* Without trading */}
            <div className="mb-2">
              <div className="flex justify-between items-center mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs">😰</span>
                  <span className="text-[10px] text-gray-500">Comprando sozinho</span>
                </div>
                <span className="text-sm font-black text-red-500">R${albumStats.expectedCost}</span>
              </div>
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-red-400 rounded-full" style={{ width: '100%' }} />
              </div>
              <p className="text-[8px] text-gray-400 mt-0.5">~{albumStats.expectedPacks} pacotes necessários (matematicamente)</p>
            </div>

            {/* With app-optimized trading */}
            <div className="mb-2">
              <div className="flex justify-between items-center mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs">🚀</span>
                  <span className="text-[10px] text-gray-500 font-semibold">Com troca otimizada</span>
                </div>
                <span className="text-sm font-black text-emerald-500">R${albumStats.optimizedCost}</span>
              </div>
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-400 to-teal-400 rounded-full"
                  style={{ width: `${albumStats.expectedCost > 0 ? Math.max(5, (albumStats.optimizedCost / albumStats.expectedCost) * 100) : 0}%` }}
                />
              </div>
              <p className="text-[8px] text-gray-400 mt-0.5">App encontra quem tem suas faltantes e troca suas {totalExtras} repetidas</p>
            </div>

            {/* Ideal scenario */}
            <div className="mb-1">
              <div className="flex justify-between items-center mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs">🎯</span>
                  <span className="text-[10px] text-gray-400">Cenário ideal (100% troca)</span>
                </div>
                <span className="text-xs font-bold text-gray-400">R${albumStats.idealCost}</span>
              </div>
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gray-300 rounded-full"
                  style={{ width: `${albumStats.expectedCost > 0 ? Math.max(3, (albumStats.idealCost / albumStats.expectedCost) * 100) : 0}%` }}
                />
              </div>
              <p className="text-[8px] text-gray-300 mt-0.5">{albumStats.missing} × R${STICKER_PRICE.toFixed(2)} se trocar todas</p>
            </div>
          </div>

          {/* Savings highlight */}
          {albumStats.savingsVsAlone > 0 && (
            <div className="bg-gradient-to-r from-emerald-500 to-teal-600 rounded-xl p-3 flex items-center gap-3">
              <div className="w-11 h-11 bg-white/20 rounded-lg flex items-center justify-center shrink-0">
                <span className="text-xl">💰</span>
              </div>
              <div>
                <p className="text-[11px] font-bold text-white">
                  Economize até R${albumStats.savingsVsAlone} com troca otimizada!
                </p>
                <p className="text-[9px] text-emerald-100">
                  {albumStats.savingsOptPercent}% mais barato que comprando sozinho. Use o app para encontrar quem tem o que você precisa perto de você.
                </p>
              </div>
            </div>
          )}

          {/* Explanation */}
          <p className="text-[8px] text-gray-300 mt-2 text-center leading-relaxed">
            Cálculo baseado no Problema do Colecionador (Coupon Collector). Pacote = {PACK_SIZE} fig. a R${PACK_PRICE.toFixed(2)}
          </p>
        </div>
      )}

      {/* ─── Premium CTA ─── */}
      {!isPremium && (
        <div className="bg-white rounded-2xl border-2 border-violet-200 p-4">
          <div className="text-center mb-3"><span className="text-3xl">🔓</span></div>
          <h3 className="text-sm font-bold text-gray-900 text-center mb-1">Desbloqueie Trocas</h3>
          <p className="text-[10px] text-gray-400 text-center mb-3">
            Veja detalhes, solicite trocas e conecte-se com colecionadores perto de você
          </p>
          <div className="flex flex-col gap-1 mb-3 px-4">
            <FeatureCheck text="Ver detalhes de cada colecionador" />
            <FeatureCheck text="Solicitar troca com aprovação segura" />
            <FeatureCheck text="Monitoramento automático das faltantes" />
            <FeatureCheck text="Scanner IA ilimitado" />
          </div>
          <button
            onClick={() => setShowPaywall(true)}
            className="w-full bg-violet-600 text-white rounded-xl py-3 text-sm font-bold hover:bg-violet-700 transition active:scale-[0.98]"
          >
            Desbloquear por R$19,90
          </button>
          <p className="text-[9px] text-gray-300 text-center mt-2">Pagamento único. Sem assinatura.</p>
        </div>
      )}

      {/* Paywall Modal */}
      {showPaywall && (
        <PaywallModal feature="trades" currentTier={tier} onClose={() => setShowPaywall(false)} />
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
