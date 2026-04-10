'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
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
  const [excluded, setExcluded] = useState<number[]>([])
  const [watchRadius, setWatchRadius] = useState(50)
  const [showExcludeManager, setShowExcludeManager] = useState(false)
  const [excludeSearch, setExcludeSearch] = useState('')
  const [nearbyCount, setNearbyCount] = useState(initialNearbyCount)
  const [matches, setMatches] = useState<NearbyMatch[]>(initialMatches)
  const [hasLocation, setHasLocation] = useState(initialHasLocation)
  const [requestingLocation, setRequestingLocation] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, TradeDetail[]>>({})
  const [loadingDetails, setLoadingDetails] = useState<string | null>(null)
  const [radius, setRadius] = useState(50)
  const [loadingMatches, setLoadingMatches] = useState(false)
  const [phones, setPhones] = useState<Record<string, string | null>>({})
  const [sendingWhatsApp, setSendingWhatsApp] = useState<string | null>(null)

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
    const missingIds = new Set(missingStickers.map((s) => s.id))
    // Clean excluded: remove ids that are no longer missing (already collected)
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
  const potentialSavings = totalExtras * STICKER_PRICE
  const missingCost = missingStickers.length * STICKER_PRICE

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

  function updateWatchRadius(r: number) {
    setWatchRadius(r)
    localStorage.setItem(WATCH_RADIUS_KEY, String(r))
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
        alert('Nao foi possivel obter sua localizacao. Verifique as permissoes do navegador.')
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
        setMatches(data as NearbyMatch[])
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

  // Fetch phone number for a matched user and open WhatsApp directly
  async function notifyViaWhatsApp(match: NearbyMatch) {
    setSendingWhatsApp(match.user_id)

    // Get phone if not cached
    let phone = phones[match.user_id]
    if (phone === undefined) {
      const { data } = await supabase
        .from('profiles')
        .select('phone')
        .eq('id', match.user_id)
        .single()
      phone = data?.phone || null
      setPhones((prev) => ({ ...prev, [match.user_id]: phone }))
    }

    const matchStickers = details[match.user_id] || []
    const theyHave = matchStickers.filter((s) => s.direction === 'they_have').slice(0, 10).map((s) => s.number)
    const iHave = matchStickers.filter((s) => s.direction === 'i_have').slice(0, 10).map((s) => s.number)

    let msg = 'Oi! Vi no app Figurinhas Copa 2026 que a gente pode trocar figurinhas!\n\n'
    if (iHave.length > 0) msg += 'Tenho repetidas pra te dar:\n' + iHave.join(', ') + '\n\n'
    if (theyHave.length > 0) msg += 'Preciso dessas suas:\n' + theyHave.join(', ') + '\n\n'
    msg += 'Bora trocar?\n\nhttps://figurinhas2026.vercel.app'

    if (phone) {
      // Clean phone: remove spaces, dashes, etc. Keep + and digits
      const cleanPhone = phone.replace(/[^+\d]/g, '')
      window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank')
    } else {
      // No phone saved — open generic WhatsApp share
      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
    }

    setSendingWhatsApp(null)
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
            <p className="text-[10px] text-emerald-200">para trocar</p>
          </div>
          <div className="w-px bg-white/20" />
          <div>
            <p className="text-xl font-bold text-white">{missingStickers.length}</p>
            <p className="text-[10px] text-emerald-200">faltantes</p>
          </div>
          <div className="w-px bg-white/20" />
          <div>
            <p className="text-xl font-bold text-white">R${missingCost.toFixed(0)}</p>
            <p className="text-[10px] text-emerald-200">custo sem trocar</p>
          </div>
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
                Seja notificado quando alguem perto tiver figurinhas que voce precisa
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
              {notifyPriorityIds.length > 0 && `${notifyPriorityIds.length} prioritaria${notifyPriorityIds.length > 1 ? 's' : ''} · `}
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
          Todas as figurinhas faltantes sao monitoradas automaticamente. Quando voce cola uma no album, ela sai da lista. Configure abaixo como e quando quer ser notificado.
        </p>

        {/* ─── Notification Config Panel ─── */}
        {showNotifyConfig && (
          <div className="border border-amber-100 rounded-xl p-3 mb-3 bg-amber-50/30 space-y-4">
            <p className="text-[11px] font-bold text-gray-800 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Configuracoes de notificacao
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
              <p className="text-[10px] text-gray-500 font-medium mb-1.5">Raio maximo para alertas</p>
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
              <p className="text-[9px] text-gray-400 mt-1">Voce so sera notificado quando alguem dentro deste raio tiver suas figurinhas</p>
            </div>

            {/* Minimo de figurinhas */}
            <div>
              <p className="text-[10px] text-gray-500 font-medium mb-1.5">Minimo de figurinhas para notificar</p>
              <p className="text-[9px] text-gray-400 mb-2">So enviar alerta se a pessoa tiver pelo menos X figurinhas que voce precisa</p>
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
                  ⚡ Voce so sera notificado quando alguem tiver {notifyMinThreshold}+ figurinhas que voce precisa
                  {notifyPriorityIds.length > 0 && ' (exceto figurinhas prioritarias, que sempre notificam)'}
                </p>
              )}
            </div>

            {/* Figurinhas prioritarias */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div>
                  <p className="text-[10px] text-gray-500 font-medium">Figurinhas prioritarias</p>
                  <p className="text-[9px] text-gray-400">Sempre notificar quando alguem tiver, independente do minimo</p>
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
                {showPriorityPicker ? 'Fechar' : '+ Adicionar figurinhas prioritarias'}
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
              Salvar configuracoes
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
            <p className="text-[10px] text-gray-500 mb-2">Desmarque as que voce <span className="font-bold">nao</span> quer monitorar:</p>
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
            <p className="text-sm font-bold text-gray-900">Colecionadores perto de voce</p>
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

            {/* Match cards */}
            <div className="space-y-2">
              {matches.map((match) => {
                const isExpanded = expandedId === match.user_id
                const matchDetails = details[match.user_id]
                const isLoadingDetail = loadingDetails === match.user_id
                const isSending = sendingWhatsApp === match.user_id

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
                            {/* WhatsApp button — direct to user's phone */}
                            <button
                              onClick={(e) => { e.stopPropagation(); notifyViaWhatsApp(match) }}
                              disabled={isSending}
                              className="mt-3 w-full flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20BD5A] text-white rounded-xl py-2.5 text-xs font-semibold transition active:scale-[0.98] disabled:opacity-50"
                            >
                              {isSending ? (
                                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              ) : (
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                                </svg>
                              )}
                              Notificar via WhatsApp
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
                Desbloquear trocas — ver detalhes e notificar
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

      {/* ─── How it works ─── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <h2 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
          <span className="text-sm">💡</span>
          Como funciona
        </h2>
        <div className="space-y-3">
          <Step num={1} title="Monitoramento automatico" desc="Todas as faltantes sao monitoradas. Defina raio, minimo de figurinhas e prioridades" />
          <Step num={2} title="Alerta inteligente" desc="Quando alguem perto tiver suas figurinhas, voce recebe um alerta via WhatsApp ou e-mail" />
          <Step num={3} title="Combine a troca" desc="Veja detalhes de cada colecionador e mande mensagem direto pelo WhatsApp" />
          <Step num={4} title="Colou? Sai da lista!" desc="Quando marca como colada no album, a figurinha sai do monitoramento automaticamente" />
        </div>
      </div>

      {/* ─── Fun facts ─── */}
      <div className="bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl p-5 shadow-lg mb-4">
        <h2 className="text-sm font-bold text-white/90 mb-3">Voce sabia?</h2>
        <div className="space-y-2.5">
          <div className="flex items-start gap-2">
            <span className="text-sm">💰</span>
            <p className="text-xs text-white/85 leading-relaxed">
              Completar o album comprando custaria ~<span className="font-bold">R${(stickers.length * STICKER_PRICE).toFixed(0)}</span>. Trocando, voce economiza muito!
            </p>
          </div>
          {totalExtras > 0 && (
            <div className="flex items-start gap-2">
              <span className="text-sm">🔄</span>
              <p className="text-xs text-white/85 leading-relaxed">
                Suas <span className="font-bold">{totalExtras} extras</span> valem <span className="font-bold">R${potentialSavings.toFixed(0)}</span> em trocas
              </p>
            </div>
          )}
          <div className="flex items-start gap-2">
            <span className="text-sm">📊</span>
            <p className="text-xs text-white/85 leading-relaxed">
              Em media, colecionadores precisam trocar <span className="font-bold">3x mais</span> figurinhas do que o tamanho do album
            </p>
          </div>
        </div>
      </div>

      {/* ─── Premium CTA ─── */}
      {!isPremium && (
        <div className="bg-white rounded-2xl border-2 border-violet-200 p-4">
          <div className="text-center mb-3"><span className="text-3xl">🔓</span></div>
          <h3 className="text-sm font-bold text-gray-900 text-center mb-1">Desbloqueie Trocas</h3>
          <p className="text-[10px] text-gray-400 text-center mb-3">
            Veja detalhes, notifique via WhatsApp e troque figurinhas com quem esta perto
          </p>
          <div className="flex flex-col gap-1 mb-3 px-4">
            <FeatureCheck text="Ver detalhes de cada colecionador" />
            <FeatureCheck text="Notificar direto no WhatsApp da pessoa" />
            <FeatureCheck text="Monitoramento automatico das faltantes" />
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
