'use client'

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getFlag } from '@/lib/countries'
import Link from 'next/link'
import PremiumBanner from '@/components/PremiumBanner'
import ExportModal from '@/components/ExportModal'
import UndoToast from '@/components/UndoToast'
import OnboardingModal from '@/components/OnboardingModal'
import ImportListModal from '@/components/ImportListModal'
import LocationBanner from '@/components/LocationBanner'
import { getStickerLimit, type Tier } from '@/lib/tiers'

type Sticker = {
  id: number
  number: string
  player_name: string | null
  country: string
  section: string
  type: string
  /** False for decorative collections (Coca-Cola, PANINI Extras) — they
   *  appear in the album but don't move the X/980 progress bar. */
  counts_for_completion?: boolean
  /** Order in the physical album (intro → groups A-L → history → coca → extras). */
  display_order?: number
}

type UserStickerInfo = { status: string; quantity: number }

type Tab = 'all' | 'missing' | 'duplicates' | 'extras'
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
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [loading, setLoading] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('sections')
  const [showExport, setShowExport] = useState(false)
  // Pedro 2026-05-02: stats badges clicáveis. Ref pra scrollar até a grid
  // de figurinhas quando user clicar em "Faltam" / "Repetidas" no header.
  const tabsRef = useRef<HTMLDivElement>(null)
  const goToTab = useCallback((tab: Tab) => {
    setActiveTab(tab)
    // Scroll suave pra grid (header das tabs) — espera 1 tick pra DOM atualizar
    setTimeout(() => {
      tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 0)
  }, [])
  const [showImport, setShowImport] = useState(false)
  const [visibleCount, setVisibleCount] = useState(40)
  const [openSections, setOpenSections] = useState<Set<string>>(new Set())
  const [undoAction, setUndoAction] = useState<{ stickerId: number; prevStatus: string; prevQty: number; message: string } | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  // Debounce de busca (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  // Virtualização: renderiza mais cards ao scrollar
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => prev + 40)
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  // Reset visibleCount e fecha seções quando filtro muda
  useEffect(() => {
    setVisibleCount(40)
    setOpenSections(new Set())
  }, [activeTab, debouncedSearch])

  // Sort by display_order (physical album order) when available; fall back to
  // natural number sort for legacy data. The album opens at intro (FWC-0..8),
  // then teams in group order A-L, then FIFA history, then Coca-Cola, then
  // PANINI Extras at the bottom.
  const collator = useMemo(() => new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' }), [])
  const sortedStickers = useMemo(
    () => [...stickers].sort((a, b) => {
      const aOrder = a.display_order ?? -1
      const bOrder = b.display_order ?? -1
      if (aOrder !== bOrder) return aOrder - bOrder
      return collator.compare(a.number, b.number)
    }),
    [stickers, collator]
  )

  // Only stickers with counts_for_completion=true (treat undefined as true for
  // backward compat) move the X/980 progress bar. Decorative sections like
  // Coca-Cola and PANINI Extras still render but don't pull the percentage.
  const completableStickers = useMemo(
    () => sortedStickers.filter((s) => s.counts_for_completion !== false),
    [sortedStickers],
  )
  const completableIds = useMemo(
    () => new Set(completableStickers.map((s) => s.id)),
    [completableStickers],
  )

  const TOTAL = completableStickers.length || 980

  const stats = useMemo(() => {
    let owned = 0, duplicates = 0, totalDupeQty = 0
    Object.entries(userMap).forEach(([id, us]) => {
      const isCompletable = completableIds.has(Number(id))
      // Owned only counts the 980 completable stickers — Coca-Cola and PANINI
      // Extras don't move X/980, so they don't bump the progress bar past 100%.
      if (isCompletable) {
        if (us.status === 'owned') owned++
        if (us.status === 'duplicate') owned++
      }
      // Duplicates count EVERY duplicate sticker the user has, including
      // Coca-Cola and PANINI Extras — they're tradeable inventory just like
      // any other extra, so they belong in the "Repetidas" tab and stat card.
      if (us.status === 'duplicate') {
        duplicates++
        totalDupeQty += us.quantity - 1
      }
    })
    return { owned, missing: TOTAL - owned, duplicates, totalDupeQty }
  }, [userMap, TOTAL, completableIds])

  // Section stats (group by section name, not country — so special sections like Legends, Stadiums appear separately)
  const sectionStats = useMemo(() => {
    const sections: Record<string, { total: number; owned: number }> = {}
    sortedStickers.forEach((s) => {
      const key = s.section
      if (!sections[key]) sections[key] = { total: 0, owned: 0 }
      sections[key].total++
      const us = userMap[s.id]
      if (us && (us.status === 'owned' || us.status === 'duplicate')) {
        sections[key].owned++
      }
    })
    return sections
  }, [sortedStickers, userMap])

  const progressPct = TOTAL > 0 ? Math.round((stats.owned / TOTAL) * 100) : 0

  const matchesSearch = useCallback((s: Sticker, q: string) =>
    s.number.toLowerCase().includes(q) ||
    (s.player_name && s.player_name.toLowerCase().includes(q)) ||
    s.country.toLowerCase().includes(q),
  [])

  const filtered = useMemo(() => {
    let list = sortedStickers

    // The four tabs partition the album like this:
    //  - all:        the 980 album stickers (counts_for_completion === true)
    //  - missing:    of those 980, the ones not yet owned/duplicate
    //  - duplicates: ANY sticker marked duplicate — includes Coca-Cola and
    //                PANINI Extras, since duplicates of those are tradeable
    //                inventory the user wants visible
    //  - extras:     the decorative collections (Coca-Cola + PANINI Extras)
    //                that don't move the X/980 bar
    if (activeTab === 'extras') {
      list = list.filter((s) => s.counts_for_completion === false)
    } else if (activeTab === 'duplicates') {
      // Show duplicates from ALL sections (album + extras)
      list = list.filter((s) => userMap[s.id]?.status === 'duplicate')
    } else {
      list = list.filter((s) => s.counts_for_completion !== false)
      if (activeTab === 'missing') {
        list = list.filter((s) => {
          const us = userMap[s.id]
          return !us || us.status === 'missing'
        })
      }
    }

    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase()
      list = list.filter((s) => matchesSearch(s, q))
    }

    return list
  }, [sortedStickers, activeTab, debouncedSearch, userMap, matchesSearch])

  // Section ordering uses the display_order from each section's first sticker
  // — so sections appear in physical-album order: Intro (FWC-0..8) → teams in
  // FIFA group order (A → L) → FIFA History (FWC-9..19) → Coca-Cola →
  // PANINI Extras. No more alphabetical-by-default ordering of teams.
  const sectionOrderMap = useMemo(() => {
    const map: Record<string, number> = {}
    sortedStickers.forEach((s) => {
      const order = s.display_order ?? 999_999
      if (map[s.section] === undefined || order < map[s.section]) {
        map[s.section] = order
      }
    })
    return map
  }, [sortedStickers])

  // Group by section for accordion view
  const groupedByCountry = useMemo(() => {
    const groups: Record<string, Sticker[]> = {}
    filtered.forEach((s) => {
      const key = s.section
      if (!groups[key]) groups[key] = []
      groups[key].push(s)
    })

    const sorted: Record<string, Sticker[]> = {}
    const keys = Object.keys(groups).sort((a, b) => {
      const orderA = sectionOrderMap[a] ?? 999_999
      const orderB = sectionOrderMap[b] ?? 999_999
      if (orderA !== orderB) return orderA - orderB
      return a.localeCompare(b, 'pt-BR')
    })
    keys.forEach((k) => { sorted[k] = groups[k] })
    return sorted
  }, [filtered, sectionOrderMap])

  function toggleSection(country: string) {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(country)) next.delete(country)
      else next.add(country)
      return next
    })
  }

  async function updateSticker(stickerId: number, newStatus: string, newQuantity: number, stickerNumber?: string) {
    setLoading(stickerId)
    const current = userMap[stickerId]
    const prevStatus = current?.status || 'missing'
    const prevQty = current?.quantity || 0

    if (!current || current.status === 'missing') {
      await supabase.from('user_stickers').upsert({
        user_id: userId,
        sticker_id: stickerId,
        status: newStatus,
        quantity: newQuantity,
      }, { onConflict: 'user_id,sticker_id' })
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

    // Show undo toast
    const label = stickerNumber || `#${stickerId}`
    const statusLabel = newStatus === 'owned' ? 'colada' : newStatus === 'duplicate' ? `repetida (x${newQuantity})` : 'removida'
    setUndoAction({ stickerId, prevStatus, prevQty, message: `${label} marcada como ${statusLabel}` })

    // Notify nearby users in background (fire & forget)
    if (newStatus === 'duplicate') {
      fetch('/api/notify-matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, sticker_ids: [stickerId] }),
      }).catch(() => {}) // silent fail
    }
  }

  async function handleUndo() {
    if (!undoAction) return
    const { stickerId, prevStatus, prevQty } = undoAction
    setUndoAction(null)
    setLoading(stickerId)

    if (prevStatus === 'missing') {
      await supabase.from('user_stickers')
        .update({ status: 'missing', quantity: 0, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('sticker_id', stickerId)
    } else {
      await supabase.from('user_stickers')
        .update({ status: prevStatus, quantity: prevQty, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('sticker_id', stickerId)
    }

    setUserMap((prev) => ({
      ...prev,
      [stickerId]: { status: prevStatus, quantity: prevQty },
    }))
    setLoading(null)
  }

  const stickerLimit = getStickerLimit(tier)
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
      updateSticker(sticker.id, 'owned', 1, sticker.number)
    } else if (current.status === 'missing') {
      updateSticker(sticker.id, 'owned', 1, sticker.number)
    } else if (current.status === 'owned') {
      updateSticker(sticker.id, 'duplicate', 2, sticker.number)
    } else {
      updateSticker(sticker.id, 'duplicate', current.quantity + 1, sticker.number)
    }
  }

  function handleDecrement(e: React.MouseEvent, sticker: Sticker) {
    e.stopPropagation()
    const current = userMap[sticker.id]
    if (!current || current.status === 'missing') return

    if (current.status === 'duplicate' && current.quantity > 2) {
      updateSticker(sticker.id, 'duplicate', current.quantity - 1, sticker.number)
    } else if (current.status === 'duplicate' && current.quantity === 2) {
      updateSticker(sticker.id, 'owned', 1, sticker.number)
    } else {
      updateSticker(sticker.id, 'missing', 0, sticker.number)
    }
  }

  function getCardStyle(stickerId: number) {
    const us = userMap[stickerId]
    // Missing cards used to render with opacity 0.4, which made the number /
    // player name nearly impossible to read in bright light. Now we just dim
    // the background and keep the text fully opaque (handled in the text
    // colors below) so the user can scan the album visually even before
    // marking anything.
    if (!us || us.status === 'missing')
      return 'bg-gray-50 border-dashed border-gray-300 hover:bg-white'
    if (us.status === 'owned')
      return 'bg-white border-gray-200 shadow-sm'
    if (us.status === 'duplicate')
      return 'bg-white border-blue-200 shadow-sm'
    return 'bg-white border-gray-200'
  }

  function isStickerMissing(stickerId: number): boolean {
    const us = userMap[stickerId]
    return !us || us.status === 'missing'
  }

  function getQuantity(stickerId: number): number {
    const us = userMap[stickerId]
    if (!us || us.status === 'missing') return 0
    return us.quantity || 1
  }

  // Contadores das tabs — atualizam quando há busca ativa
  const tabCounts = useMemo(() => {
    // Counts for the four tabs:
    //  - all/missing restrict to the 980 completable stickers
    //  - duplicates spans the WHOLE album (completable + extras) because
    //    duplicates of Coca-Cola / PANINI Extras are also tradeable
    //  - extras counts only decorative stickers (Coca-Cola + PANINI Extras)
    const completable = sortedStickers.filter((s) => s.counts_for_completion !== false)
    const extrasAll = sortedStickers.filter((s) => s.counts_for_completion === false)
    if (!debouncedSearch.trim()) {
      return {
        all: completable.length,
        missing: stats.missing,
        duplicates: stats.duplicates,
        extras: extrasAll.length,
      }
    }
    const q = debouncedSearch.toLowerCase()
    const searched = completable.filter((s) => matchesSearch(s, q))
    const searchMissing = searched.filter((s) => { const us = userMap[s.id]; return !us || us.status === 'missing' })
    // Duplicates search spans the entire album, not just completable
    const searchDupes = sortedStickers.filter(
      (s) => matchesSearch(s, q) && userMap[s.id]?.status === 'duplicate',
    )
    const searchExtras = extrasAll.filter((s) => matchesSearch(s, q))
    return {
      all: searched.length,
      missing: searchMissing.length,
      duplicates: searchDupes.length,
      extras: searchExtras.length,
    }
  }, [sortedStickers, debouncedSearch, userMap, stats, matchesSearch])

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'all', label: 'Todas', count: tabCounts.all },
    { key: 'missing', label: 'Faltam', count: tabCounts.missing },
    { key: 'duplicates', label: 'Repetidas', count: tabCounts.duplicates },
    { key: 'extras', label: 'Extras', count: tabCounts.extras },
  ]

  function renderCard(sticker: Sticker) {
    const qty = getQuantity(sticker.id)
    const isExpanded = expanded === sticker.id
    // Pedro 2026-05-02: badge mostra REPETIDAS (extras), não cópias totais.
    // qty=2 (1 colada + 1 extra) → "+1". qty=3 (1 colada + 2 extras) → "+2".
    const extras = qty > 1 ? qty - 1 : 0

    return (
      <div
        key={sticker.id}
        className={`relative rounded-xl border text-center transition-all duration-200 ${getCardStyle(sticker.id)}`}
      >
        {/* Repetidas badge — mostra quantos EXTRAS o user tem (qty - 1) */}
        {qty > 1 && (
          <span className="absolute -top-1 -right-1 min-w-5 h-4 px-1 bg-blue-500 rounded-full flex items-center justify-center text-white text-[8px] font-bold shadow-sm z-10">
            +{extras}
          </span>
        )}
        {qty === 1 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center shadow-sm z-10">
            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </span>
        )}

        {/* Main area - tap to mark as owned (if zero) or expand (if already owned) */}
        <button
          onClick={(e) => {
            if (loading === sticker.id) return
            const current = userMap[sticker.id]
            const isMissing = !current || current.status === 'missing'
            if (isMissing) {
              // First click on empty sticker → mark as owned immediately
              handleIncrement(e, sticker)
            } else {
              // Already owned → toggle expand for +/- controls
              setExpanded(isExpanded ? null : sticker.id)
            }
          }}
          disabled={loading === sticker.id}
          aria-label={`${sticker.number} ${sticker.player_name || sticker.country}`}
          aria-expanded={isExpanded}
          className="w-full p-2 active:scale-95 transition-transform"
        >
          <p className={`text-xl leading-none ${isStickerMissing(sticker.id) ? 'opacity-50' : ''}`}>
            {getFlag(sticker.country)}
          </p>
          <p className="text-[11px] font-bold text-navy mt-1.5 tracking-tight">{sticker.number}</p>
          <p className="text-[9px] font-medium text-gray-700 truncate leading-tight mt-0.5">
            {sticker.player_name || sticker.type}
          </p>
        </button>

        {/* Expanded: +/- controls */}
        {isExpanded && (
          <div className="flex items-center justify-center gap-1 pb-2 px-1">
            <button
              onClick={(e) => handleDecrement(e, sticker)}
              aria-label={`Remover ${sticker.number}`}
              className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 active:scale-90 transition"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" d="M5 12h14" />
              </svg>
            </button>
            <span className="text-xs font-bold text-gray-700 w-5 text-center">{qty}</span>
            <button
              onClick={(e) => handleIncrement(e, sticker)}
              aria-label={`Adicionar ${sticker.number}`}
              className="w-6 h-6 rounded-lg bg-brand-light flex items-center justify-center text-brand hover:bg-brand-light active:scale-90 transition"
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
    <main className="px-4 pt-4 pb-28" role="main">
      {/* Header with progress ring */}
      <header className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-black tracking-tight text-gray-900">Meu Álbum</h1>
          <p className="text-[11px] text-gray-500 mt-0.5">{stats.owned} de {TOTAL} figurinhas</p>
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
                <stop offset="0%" stopColor="#00C896" />
                <stop offset="100%" stopColor="#00A67D" />
              </linearGradient>
            </defs>
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-gray-700">
            {progressPct}%
          </span>
        </div>
      </header>

      {/* Stats row — Pedro 2026-05-02: clicáveis (mudam aba + scroll) */}
      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => goToTab('all')}
          aria-label="Ver todas as figurinhas"
          className={`flex-1 flex items-center gap-2.5 bg-white rounded-xl border p-3 active:scale-[0.98] transition-all ${activeTab === 'all' ? 'border-emerald-300 ring-1 ring-emerald-200' : 'border-gray-100 hover:border-emerald-200'}`}
        >
          <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
          </div>
          <div className="text-left">
            <p className="text-lg font-bold text-gray-800 leading-none">{stats.owned}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">Coladas</p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => goToTab('missing')}
          aria-label="Ver figurinhas que faltam"
          className={`flex-1 flex items-center gap-2.5 bg-white rounded-xl border p-3 active:scale-[0.98] transition-all ${activeTab === 'missing' ? 'border-orange-300 ring-1 ring-orange-200' : 'border-gray-100 hover:border-orange-200'}`}
        >
          <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-orange-400" />
          </div>
          <div className="text-left">
            <p className="text-lg font-bold text-gray-800 leading-none">{stats.missing}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">Faltam</p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => goToTab('duplicates')}
          aria-label="Ver figurinhas repetidas"
          className={`flex-1 flex items-center gap-2.5 bg-white rounded-xl border p-3 active:scale-[0.98] transition-all ${activeTab === 'duplicates' ? 'border-blue-300 ring-1 ring-blue-200' : 'border-gray-100 hover:border-blue-200'}`}
        >
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
          </div>
          <div className="text-left">
            {/* Pedro 2026-05-02: mostra TOTAL de cromos extras pra trocar
                (totalDupeQty), não número de figurinhas distintas com extras.
                Antes: 1 figurinha c/ qty=2 → mostrava "1" (figurinhas).
                Agora: → mostra "1" (cromos extras). qty=3 → "2", e por aí. */}
            <p className="text-lg font-bold text-gray-800 leading-none">{stats.totalDupeQty}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">Repetidas</p>
          </div>
        </button>
      </div>

      {/* Scan, Export & Import — compact row */}
      <div className="flex gap-2 mb-4">
        <Link
          href="/scan"
          className="flex-1 flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg active:scale-[0.98] transition"
        >
          <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
          </svg>
          <span className="text-xs font-semibold text-gray-700">Escanear</span>
        </Link>
        <Link
          href="/export"
          className="flex-1 flex items-center gap-2 px-3 py-2 bg-brand-light/60 border border-brand/15 rounded-lg active:scale-[0.98] transition"
        >
          <svg className="w-4 h-4 text-brand flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <span className="text-xs font-semibold text-gray-700">Exportar</span>
        </Link>
        <button
          onClick={() => setShowImport(true)}
          className="flex-1 flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-lg active:scale-[0.98] transition"
        >
          <svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          <span className="text-xs font-semibold text-gray-700">Importar</span>
        </button>
      </div>

      {/* Premium banner - only shows if there's still a tier limit */}
      {showLimitBanner && <PremiumBanner />}

      {/* Location banner — shows only if user has no city set yet */}
      <LocationBanner />

      {/* Search + view toggle */}
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Buscar figurinha..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar figurinha"
            className="w-full bg-white rounded-xl border border-gray-100 pl-9 pr-3 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:ring-2 focus:ring-brand/30 focus:border-brand/30 outline-none transition"
          />
        </div>
        <button
          onClick={() => setViewMode(viewMode === 'grid' ? 'sections' : 'grid')}
          className={`w-11 h-11 rounded-xl border flex items-center justify-center transition focus-visible:ring-2 focus-visible:ring-brand ${
            viewMode === 'sections' ? 'bg-brand-light border-brand/30 text-brand' : 'bg-white border-gray-100 text-gray-500'
          }`}
          aria-label={viewMode === 'grid' ? 'Ver por seleção' : 'Ver grade'}
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

      {/* Tabs — alvo do scroll quando user clica nos stats badges */}
      <div ref={tabsRef} className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1 scroll-mt-4">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 min-h-[44px] py-2 text-[11px] font-semibold rounded-lg transition-all ${
              activeTab === tab.key
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
            <span className={`ml-1 ${activeTab === tab.key
              ? tab.key === 'missing' ? 'text-orange-400'
              : tab.key === 'duplicates' ? 'text-blue-500'
              : tab.key === 'extras' ? 'text-amber-500'
              : 'text-brand'
              : 'text-gray-400'}`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          {activeTab === 'missing' && !search ? (
            <>
              <div className="text-4xl mb-3">🎉</div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Álbum completo!</p>
              <p className="text-xs text-gray-500">Você já tem todas as figurinhas. Parabéns!</p>
            </>
          ) : activeTab === 'duplicates' && !search ? (
            <>
              <div className="text-4xl mb-3">📦</div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Nenhuma repetida ainda</p>
              <p className="text-xs text-gray-500">Quando tiver figurinhas extras, elas aparecem aqui para trocar.</p>
            </>
          ) : search ? (
            <>
              <div className="text-4xl mb-3">🔍</div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Nenhum resultado para &ldquo;{search}&rdquo;</p>
              <p className="text-xs text-gray-500">Tente buscar por número, jogador ou seleção.</p>
            </>
          ) : (
            <>
              <div className="text-4xl mb-3">📖</div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Nenhuma figurinha</p>
              <p className="text-xs text-gray-500">Comece marcando suas figurinhas coladas!</p>
            </>
          )}
        </div>
      ) : viewMode === 'sections' ? (
        /* ── SECTION VIEW com Accordion ── */
        <div className="space-y-2">
          {Object.entries(groupedByCountry).map(([country, countryStickers]) => {
            const sec = sectionStats[country]
            const pct = sec ? Math.round((sec.owned / sec.total) * 100) : 0
            const isCollapsed = !openSections.has(country)
            const filteredCount = countryStickers.length
            const showProgress = activeTab === 'all'
            return (
              <div key={country}>
                <button
                  onClick={() => toggleSection(country)}
                  aria-expanded={!isCollapsed}
                  className="w-full flex items-center gap-2 p-2.5 bg-white rounded-xl border border-gray-100 hover:bg-gray-50 transition active:scale-[0.99]"
                >
                  <span className="text-lg">{getFlag(country)}</span>
                  <span className="text-xs font-semibold text-gray-700 flex-1 text-left">{country}</span>
                  {showProgress ? (
                    <>
                      <span className="text-[10px] text-gray-500">{sec?.owned}/{sec?.total}</span>
                      <div className="w-14 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-brand'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className={`text-[10px] font-bold w-8 text-right ${pct === 100 ? 'text-emerald-600' : 'text-gray-500'}`}>{pct}%</span>
                    </>
                  ) : (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      activeTab === 'missing' ? 'bg-orange-50 text-orange-500' : 'bg-blue-50 text-blue-500'
                    }`}>
                      {filteredCount}
                    </span>
                  )}
                  <svg
                    className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-180'}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>
                {!isCollapsed && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-1.5 mt-1.5 mb-1" style={{ contentVisibility: 'auto', containIntrinsicSize: '0 120px' }}>
                    {countryStickers.map(renderCard)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        /* ── GRID VIEW (virtualizado — renderiza em chunks de 40) ── */
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-1.5">
            {filtered.slice(0, visibleCount).map(renderCard)}
          </div>
          {visibleCount < filtered.length && (
            <div ref={sentinelRef} className="flex justify-center py-6">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <div className="w-4 h-4 border-2 border-gray-200 border-t-brand rounded-full animate-spin" />
                {filtered.length - visibleCount} figurinhas restantes
              </div>
            </div>
          )}
        </>
      )}

      {/* ── WhatsApp Promo Banner ── */}
      <a
        href="https://wa.me/5521966791113?text=oi"
        target="_blank"
        rel="noopener noreferrer"
        className="block mt-6 rounded-2xl border border-emerald-100 bg-white p-4 active:scale-[0.99] transition-transform shadow-sm"
      >
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
              <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 01-4.243-1.214l-.257-.154-2.87.853.853-2.87-.154-.257A8 8 0 1112 20z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-800 leading-tight">Use pelo WhatsApp</p>
            <p className="text-[11px] text-gray-500">Mande uma foto e a IA registra tudo</p>
          </div>
          <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-2 bg-emerald-50 rounded-lg px-2.5 py-2">
            <span className="text-sm">📸</span>
            <span className="text-[10px] font-medium text-emerald-700">Escanear figurinhas</span>
          </div>
          <div className="flex items-center gap-2 bg-emerald-50 rounded-lg px-2.5 py-2">
            <span className="text-sm">📋</span>
            <span className="text-[10px] font-medium text-emerald-700">Ver faltantes</span>
          </div>
          <div className="flex items-center gap-2 bg-emerald-50 rounded-lg px-2.5 py-2">
            <span className="text-sm">📊</span>
            <span className="text-[10px] font-medium text-emerald-700">Progresso do álbum</span>
          </div>
          <div className="flex items-center gap-2 bg-emerald-50 rounded-lg px-2.5 py-2">
            <span className="text-sm">🔔</span>
            <span className="text-[10px] font-medium text-emerald-700">Alertas de trocas</span>
          </div>
        </div>
      </a>

      {/* Export Modal */}
      <ExportModal
        isOpen={showExport}
        onClose={() => setShowExport(false)}
        stickers={sortedStickers}
        userMap={userMap}
      />

      {/* Undo Toast */}
      {undoAction && (
        <UndoToast
          message={undoAction.message}
          onUndo={handleUndo}
          onDismiss={() => setUndoAction(null)}
        />
      )}

      {/* Import Modal */}
      <ImportListModal
        isOpen={showImport}
        onClose={() => setShowImport(false)}
        userId={userId}
        onImportComplete={(updates) => {
          setUserMap((prev) => ({ ...prev, ...updates }))
        }}
      />

      {/* Onboarding */}
      <OnboardingModal />
    </main>
  )
}
