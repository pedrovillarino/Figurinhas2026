'use client'

import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getFlag } from '@/lib/countries'
import PremiumBanner from '@/components/PremiumBanner'
import ExportModal from '@/components/ExportModal'
import { getStickerLimit, type Tier } from '@/lib/tiers'

type Sticker = {
  id: number
  number: string
  player_name: string | null
  country: string
  section: string
  type: string
}

type UserStickerInfo = { status: string; quantity: number }

type Tab = 'all' | 'missing' | 'duplicates'
type ViewMode = 'grid' | 'sections'

export default function AlbumClient({
  stickers,
  userStickersMap: initialMap,
  userId,
  tier = 'free',
}: {
  stickers: Sticker[]
  userStickersMap: Record<number, UserStickerInfo>
  userId: string
  tier?: Tier
}) {
  const [userMap, setUserMap] = useState(initialMap)
  const [activeTab, setActiveTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [showExport, setShowExport] = useState(false)
  const supabase = createClient()

  const TOTAL = stickers.length || 670

  const stats = useMemo(() => {
    let owned = 0, duplicates = 0, totalDupeQty = 0
    Object.values(userMap).forEach((us) => {
      if (us.status === 'owned') owned++
      if (us.status === 'duplicate') {
        owned++ // duplicate also counts as owned
        duplicates++
        totalDupeQty += us.quantity - 1 // extras beyond 1
      }
    })
    return { owned, missing: TOTAL - owned, duplicates, totalDupeQty }
  }, [userMap, TOTAL])

  // Section stats
  const sectionStats = useMemo(() => {
    const sections: Record<string, { total: number; owned: number }> = {}
    stickers.forEach((s) => {
      const key = s.country
      if (!sections[key]) sections[key] = { total: 0, owned: 0 }
      sections[key].total++
      const us = userMap[s.id]
      if (us && (us.status === 'owned' || us.status === 'duplicate')) {
        sections[key].owned++
      }
    })
    return sections
  }, [stickers, userMap])

  const progressPct = TOTAL > 0 ? Math.round((stats.owned / TOTAL) * 100) : 0

  const filtered = useMemo(() => {
    let list = stickers

    if (activeTab === 'missing') {
      list = list.filter((s) => {
        const us = userMap[s.id]
        return !us || us.status === 'missing'
      })
    } else if (activeTab === 'duplicates') {
      list = list.filter((s) => userMap[s.id]?.status === 'duplicate')
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (s) =>
          s.number.toLowerCase().includes(q) ||
          (s.player_name && s.player_name.toLowerCase().includes(q)) ||
          s.country.toLowerCase().includes(q)
      )
    }

    return list
  }, [stickers, activeTab, search, userMap])

  // Group by country for section view
  const groupedByCountry = useMemo(() => {
    const groups: Record<string, Sticker[]> = {}
    filtered.forEach((s) => {
      if (!groups[s.country]) groups[s.country] = []
      groups[s.country].push(s)
    })
    return groups
  }, [filtered])

  async function updateSticker(stickerId: number, newStatus: string, newQuantity: number) {
    setLoading(stickerId)
    const current = userMap[stickerId]

    if (!current) {
      await supabase.from('user_stickers').insert({
        user_id: userId,
        sticker_id: stickerId,
        status: newStatus,
        quantity: newQuantity,
      })
    } else {
      await supabase
        .from('user_stickers')
        .update({ status: newStatus, quantity: newQuantity, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('sticker_id', stickerId)
    }

    setUserMap((prev) => ({
      ...prev,
      [stickerId]: { status: newStatus, quantity: newQuantity },
    }))
    setLoading(null)
  }

  const stickerLimit = getStickerLimit(tier)
  const hasReachedFreeLimit = stats.owned >= stickerLimit
  const [showLimitBanner, setShowLimitBanner] = useState(false)

  function handleIncrement(e: React.MouseEvent, sticker: Sticker) {
    e.stopPropagation()
    const current = userMap[sticker.id]

    // Check tier sticker limit for new stickers
    const isNewSticker = !current || current.status === 'missing'
    if (isNewSticker && stats.owned >= stickerLimit) {
      setShowLimitBanner(true)
      return
    }

    if (!current) {
      // missing → owned (qty 1)
      updateSticker(sticker.id, 'owned', 1)
    } else if (current.status === 'missing') {
      updateSticker(sticker.id, 'owned', 1)
    } else if (current.status === 'owned') {
      // owned → duplicate (qty 2)
      updateSticker(sticker.id, 'duplicate', 2)
    } else {
      // duplicate → increment quantity
      updateSticker(sticker.id, 'duplicate', current.quantity + 1)
    }
  }

  function handleDecrement(e: React.MouseEvent, sticker: Sticker) {
    e.stopPropagation()
    const current = userMap[sticker.id]
    if (!current || current.status === 'missing') return

    if (current.status === 'duplicate' && current.quantity > 2) {
      updateSticker(sticker.id, 'duplicate', current.quantity - 1)
    } else if (current.status === 'duplicate' && current.quantity === 2) {
      updateSticker(sticker.id, 'owned', 1)
    } else {
      // owned (qty 1) → missing
      updateSticker(sticker.id, 'missing', 0)
    }
  }

  function getCardStyle(stickerId: number) {
    const us = userMap[stickerId]
    if (!us || us.status === 'missing')
      return 'bg-gray-50 border-gray-100 opacity-40 hover:opacity-60'
    if (us.status === 'owned')
      return 'bg-white border-gray-200 shadow-sm'
    if (us.status === 'duplicate')
      return 'bg-white border-violet-200 shadow-sm'
    return 'bg-white border-gray-200'
  }

  function getQuantity(stickerId: number): number {
    const us = userMap[stickerId]
    if (!us || us.status === 'missing') return 0
    return us.quantity || 1
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'all', label: 'Todas', count: stickers.length },
    { key: 'missing', label: 'Faltam', count: stats.missing },
    { key: 'duplicates', label: 'Repetidas', count: stats.duplicates },
  ]

  function renderCard(sticker: Sticker) {
    const qty = getQuantity(sticker.id)
    const isExpanded = expanded === sticker.id

    return (
      <div
        key={sticker.id}
        className={`relative rounded-xl border text-center transition-all duration-200 ${getCardStyle(sticker.id)}`}
      >
        {/* Quantity badge */}
        {qty > 1 && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-violet-500 rounded-full flex items-center justify-center text-white text-[8px] font-bold shadow-sm z-10">
            {qty}
          </span>
        )}
        {qty === 1 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center shadow-sm z-10">
            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </span>
        )}

        {/* Main area - tap to expand */}
        <button
          onClick={() => setExpanded(isExpanded ? null : sticker.id)}
          disabled={loading === sticker.id}
          className="w-full p-2 active:scale-95 transition-transform"
        >
          <p className="text-xl leading-none">{getFlag(sticker.country)}</p>
          <p className="text-[10px] font-bold text-gray-600 mt-1.5 tracking-tight">{sticker.number}</p>
          <p className="text-[7px] text-gray-300 truncate leading-tight mt-0.5">
            {sticker.player_name || sticker.type}
          </p>
        </button>

        {/* Expanded: +/- controls */}
        {isExpanded && (
          <div className="flex items-center justify-center gap-1 pb-2 px-1">
            <button
              onClick={(e) => handleDecrement(e, sticker)}
              className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 active:scale-90 transition"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" d="M5 12h14" />
              </svg>
            </button>
            <span className="text-xs font-bold text-gray-700 w-5 text-center">{qty}</span>
            <button
              onClick={(e) => handleIncrement(e, sticker)}
              className="w-6 h-6 rounded-lg bg-violet-100 flex items-center justify-center text-violet-600 hover:bg-violet-200 active:scale-90 transition"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" d="M12 5v14m-7-7h14" />
              </svg>
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="px-4 pt-4 pb-4">
      {/* Header with progress ring */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-black tracking-tight text-gray-900">Meu Álbum</h1>
          <p className="text-[11px] text-gray-400 mt-0.5">{stats.owned} de {TOTAL} figurinhas</p>
        </div>
        <div className="relative w-14 h-14">
          <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
            <circle cx="28" cy="28" r="24" fill="none" stroke="#f3f4f6" strokeWidth="4" />
            <circle
              cx="28" cy="28" r="24" fill="none"
              stroke="url(#progress-gradient)" strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={`${progressPct * 1.508} 150.8`}
              className="transition-all duration-700"
            />
            <defs>
              <linearGradient id="progress-gradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#8b5cf6" />
                <stop offset="100%" stopColor="#d946ef" />
              </linearGradient>
            </defs>
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-gray-700">
            {progressPct}%
          </span>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex gap-2 mb-4">
        <div className="flex-1 flex items-center gap-2.5 bg-white rounded-xl border border-gray-100 p-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
          </div>
          <div>
            <p className="text-lg font-bold text-gray-800 leading-none">{stats.owned}</p>
            <p className="text-[9px] text-gray-400 mt-0.5">Coladas</p>
          </div>
        </div>
        <div className="flex-1 flex items-center gap-2.5 bg-white rounded-xl border border-gray-100 p-3">
          <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-orange-400" />
          </div>
          <div>
            <p className="text-lg font-bold text-gray-800 leading-none">{stats.missing}</p>
            <p className="text-[9px] text-gray-400 mt-0.5">Faltam</p>
          </div>
        </div>
        <div className="flex-1 flex items-center gap-2.5 bg-white rounded-xl border border-gray-100 p-3">
          <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-violet-500" />
          </div>
          <div>
            <p className="text-lg font-bold text-gray-800 leading-none">{stats.duplicates}</p>
            <p className="text-[9px] text-gray-400 mt-0.5">Repetidas</p>
          </div>
        </div>
      </div>

      {/* Premium banner */}
      {(hasReachedFreeLimit || showLimitBanner) && <PremiumBanner />}

      {/* Search + view toggle */}
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Buscar figurinha..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white rounded-xl border border-gray-100 pl-9 pr-3 py-2.5 text-sm text-gray-700 placeholder-gray-300 focus:ring-1 focus:ring-violet-500/30 focus:border-violet-200 outline-none transition"
          />
        </div>
        <button
          onClick={() => setShowExport(true)}
          className="w-10 h-10 rounded-xl border border-gray-100 bg-white flex items-center justify-center text-gray-400 hover:text-violet-500 hover:border-violet-200 hover:bg-violet-50 transition"
          title="Exportar lista"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
        </button>
        <button
          onClick={() => setViewMode(viewMode === 'grid' ? 'sections' : 'grid')}
          className={`w-10 h-10 rounded-xl border flex items-center justify-center transition ${
            viewMode === 'sections' ? 'bg-violet-50 border-violet-200 text-violet-500' : 'bg-white border-gray-100 text-gray-400'
          }`}
          title={viewMode === 'grid' ? 'Ver por seleção' : 'Ver grade'}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            {viewMode === 'grid' ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zm0 9.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zm0 9.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z" />
            )}
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-2 text-[11px] font-semibold rounded-lg transition-all ${
              activeTab === tab.key
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {tab.label}
            <span className={`ml-1 ${activeTab === tab.key ? 'text-violet-500' : 'text-gray-300'}`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-gray-50 flex items-center justify-center mb-3">
            <div className="w-2 h-2 rounded-full bg-gray-200" />
          </div>
          <p className="text-sm text-gray-300">
            {search ? 'Nenhuma figurinha encontrada' : 'Nenhuma figurinha nesta categoria'}
          </p>
        </div>
      ) : viewMode === 'sections' ? (
        /* ── SECTION VIEW ── */
        <div className="space-y-4">
          {Object.entries(groupedByCountry).map(([country, countryStickers]) => {
            const sec = sectionStats[country]
            const pct = sec ? Math.round((sec.owned / sec.total) * 100) : 0
            return (
              <div key={country}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{getFlag(country)}</span>
                  <span className="text-xs font-semibold text-gray-700 flex-1">{country}</span>
                  <span className="text-[10px] text-gray-400">{sec?.owned}/{sec?.total}</span>
                  <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-violet-500 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-bold text-gray-500 w-8 text-right">{pct}%</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {countryStickers.map(renderCard)}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* ── GRID VIEW ── */
        <div className="grid grid-cols-4 gap-1.5">
          {filtered.map(renderCard)}
        </div>
      )}

      {/* Export Modal */}
      <ExportModal
        isOpen={showExport}
        onClose={() => setShowExport(false)}
        stickers={stickers}
        userMap={userMap}
      />
    </div>
  )
}
