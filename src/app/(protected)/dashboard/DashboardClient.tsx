'use client'

import { useMemo, useState, useEffect } from 'react'
import { getFlag } from '@/lib/countries'
import Link from 'next/link'

type Sticker = {
  id: number
  number: string
  player_name: string | null
  country: string
  section: string
  type: string
}

type UserStickerInfo = { status: string; quantity: number; updated_at: string | null }

// ─── Animated Number ───
function AnimatedNumber({ value, duration = 1200 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    if (value === 0) { setDisplay(0); return }
    const start = performance.now()
    const from = 0
    function tick(now: number) {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3) // easeOutCubic
      setDisplay(Math.round(from + (value - from) * eased))
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [value, duration])
  return <>{display}</>
}

// ─── Animated Progress Ring ───
function ProgressRing({
  pct,
  size = 140,
  strokeWidth = 10,
  gradient = ['#00C896', '#00A67D'],
  delay = 0,
}: {
  pct: number
  size?: number
  strokeWidth?: number
  gradient?: string[]
  delay?: number
}) {
  const [animPct, setAnimPct] = useState(0)
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  useEffect(() => {
    const timeout = setTimeout(() => setAnimPct(pct), delay + 100)
    return () => clearTimeout(timeout)
  }, [pct, delay])

  const gradientId = `ring-grad-${size}-${delay}`

  return (
    <svg role="img" aria-label="Gráfico de progresso" width={size} height={size} className="-rotate-90">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={gradient[0]} />
          <stop offset="100%" stopColor={gradient[1]} />
        </linearGradient>
      </defs>
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke="#f3f4f6" strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke={`url(#${gradientId})`}
        strokeWidth={strokeWidth} strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference - (animPct / 100) * circumference}
        style={{ transition: 'stroke-dashoffset 1.5s cubic-bezier(0.4, 0, 0.2, 1)' }}
      />
    </svg>
  )
}

// ─── Horizontal Bar ───
function HBar({ pct, color, delay = 0 }: { pct: number; color: string; delay?: number }) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setWidth(pct), delay + 200)
    return () => clearTimeout(t)
  }, [pct, delay])

  return (
    <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full"
        style={{
          width: `${width}%`,
          background: color,
          transition: 'width 1s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      />
    </div>
  )
}

// ─── Mini Donut ───
function MiniDonut({ segments, size = 80 }: { segments: { pct: number; color: string }[]; size?: number }) {
  const sw = 8
  const r = (size - sw) / 2
  const circ = 2 * Math.PI * r
  let offset = 0

  return (
    <svg role="img" aria-label="Gráfico de progresso" width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f3f4f6" strokeWidth={sw} />
      {segments.map((seg, i) => {
        const dash = (seg.pct / 100) * circ
        const gap = circ - dash
        const currentOffset = offset
        offset += dash
        return (
          <circle
            key={i}
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke={seg.color} strokeWidth={sw}
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={-currentOffset}
            strokeLinecap="round"
            className="animate-fade-in"
            style={{ animationDelay: `${i * 100}ms` }}
          />
        )
      })}
    </svg>
  )
}

export default function DashboardClient({
  stickers,
  userStickersMap,
}: {
  stickers: Sticker[]
  userStickersMap: Record<number, UserStickerInfo>
}) {
  const [showAll, setShowAll] = useState(false)

  const TOTAL = stickers.length || 670

  // ─── Core Stats ───
  const stats = useMemo(() => {
    let owned = 0, duplicates = 0, totalExtras = 0
    Object.values(userStickersMap).forEach((us) => {
      if (us.status === 'owned') owned++
      if (us.status === 'duplicate') {
        owned++
        duplicates++
        totalExtras += us.quantity - 1
      }
    })
    return {
      owned,
      missing: TOTAL - owned,
      duplicates,
      totalExtras,
      pct: TOTAL > 0 ? Math.round((owned / TOTAL) * 100) : 0,
    }
  }, [userStickersMap, TOTAL])

  // ─── Country Breakdown ───
  const countryData = useMemo(() => {
    const map: Record<string, { total: number; owned: number; duplicates: number; extras: number }> = {}
    stickers.forEach((s) => {
      if (!map[s.country]) map[s.country] = { total: 0, owned: 0, duplicates: 0, extras: 0 }
      map[s.country].total++
      const us = userStickersMap[s.id]
      if (us && (us.status === 'owned' || us.status === 'duplicate')) {
        map[s.country].owned++
      }
      if (us?.status === 'duplicate') {
        map[s.country].duplicates++
        map[s.country].extras += us.quantity - 1
      }
    })
    return Object.entries(map)
      .map(([country, d]) => ({
        country,
        ...d,
        pct: d.total > 0 ? Math.round((d.owned / d.total) * 100) : 0,
      }))
      .sort((a, b) => b.pct - a.pct)
  }, [stickers, userStickersMap])

  // ─── Type Breakdown ───
  const typeData = useMemo(() => {
    const map: Record<string, { total: number; owned: number }> = {}
    stickers.forEach((s) => {
      const t = s.type || 'Player'
      if (!map[t]) map[t] = { total: 0, owned: 0 }
      map[t].total++
      const us = userStickersMap[s.id]
      if (us && (us.status === 'owned' || us.status === 'duplicate')) {
        map[t].owned++
      }
    })
    return Object.entries(map)
      .map(([type, d]) => ({ type, ...d, pct: d.total > 0 ? Math.round((d.owned / d.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total)
  }, [stickers, userStickersMap])

  // ─── Achievements ───
  const achievements = useMemo(() => {
    const complete = countryData.filter((c) => c.pct === 100)
    const almostComplete = countryData.filter((c) => c.pct >= 80 && c.pct < 100)
    const notStarted = countryData.filter((c) => c.pct === 0)
    const mostDupes = [...countryData].sort((a, b) => b.extras - a.extras).slice(0, 3)
    return { complete, almostComplete, notStarted, mostDupes }
  }, [countryData])

  // ─── Duplicate efficiency ───
  const dupeEfficiency = useMemo(() => {
    const totalCollected = stats.owned + stats.totalExtras
    if (totalCollected === 0) return 0
    return Math.round((stats.owned / totalCollected) * 100)
  }, [stats])

  // ─── Financial & Probability Stats ───
  const PACK_SIZE = 5
  const STICKER_PRICE = 1.50
  const PACK_PRICE = PACK_SIZE * STICKER_PRICE

  const finStats = useMemo(() => {
    const N = TOTAL
    const missing = stats.missing

    if (N === 0 || missing === 0) {
      return { costAlone: 0, costWithTrades: 0, savings: 0, savingsPct: 0, probNew: 0, packsNeeded: 0 }
    }

    // Harmonic number for Coupon Collector
    function harmonic(n: number): number {
      let h = 0
      for (let i = 1; i <= n; i++) h += 1 / i
      return h
    }

    const probNew = Math.round((missing / N) * 100)
    const expectedFigs = N * harmonic(missing)
    const expectedPacks = expectedFigs / PACK_SIZE
    const costAlone = Math.round(expectedPacks * PACK_PRICE)

    // Optimized cost with trading
    const tradeEff = Math.min(0.7, stats.totalExtras > 0 ? (stats.totalExtras / missing) * 0.8 : 0.3)
    const costWithTrades = Math.round(missing * (1 - tradeEff) * STICKER_PRICE + (missing * tradeEff * STICKER_PRICE * 0.15))
    const savings = costAlone - costWithTrades
    const savingsPct = costAlone > 0 ? Math.round((savings / costAlone) * 100) : 0

    const packsAlone = Math.round(expectedPacks)
    const packsWithTrades = Math.round(costWithTrades / PACK_PRICE)

    return { costAlone, costWithTrades, savings, savingsPct, probNew, packsNeeded: packsAlone - packsWithTrades }
  }, [TOTAL, stats])

  // Colors for country bars based on completion
  function barColor(pct: number): string {
    if (pct === 100) return 'linear-gradient(90deg, #10b981, #34d399)'
    if (pct >= 80) return 'linear-gradient(90deg, #00C896, #00A67D)'
    if (pct >= 50) return 'linear-gradient(90deg, #3b82f6, #60a5fa)'
    if (pct >= 20) return 'linear-gradient(90deg, #f59e0b, #fbbf24)'
    return 'linear-gradient(90deg, #ef4444, #f87171)'
  }

  const typeColors = ['#00C896', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899']

  const visibleCountries = showAll ? countryData : countryData.slice(0, 8)

  return (
    <main className="px-4 pt-6 pb-8">
      {/* ─── Header ─── */}
      <header className="mb-6">
        <h1 className="text-2xl font-black tracking-tight text-gray-900 mb-1">Dashboard</h1>
        <p className="text-xs text-gray-500">Estatísticas detalhadas da sua coleção</p>
      </header>

      {/* ─── Hero Progress ─── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
        <div className="flex items-center gap-5">
          <div className="relative">
            <ProgressRing pct={stats.pct} size={120} strokeWidth={10} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-black text-gray-900">
                <AnimatedNumber value={stats.pct} />
              </span>
              <span className="text-[10px] text-gray-500 -mt-0.5 font-medium">%</span>
            </div>
          </div>
          <div className="flex-1 space-y-3">
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-black text-gray-900">
                  <AnimatedNumber value={stats.owned} />
                </span>
                <span className="text-sm text-gray-400 font-medium">/ {TOTAL}</span>
              </div>
              <p className="text-[10px] text-gray-500 mt-0.5">figurinhas coladas</p>
            </div>
            <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand to-brand-dark transition-all duration-1000"
                style={{ width: `${stats.pct}%` }}
              />
            </div>
            {stats.pct >= 100 ? (
              <p className="text-xs font-bold text-emerald-600">Álbum completo!</p>
            ) : (
              <p className="text-[10px] text-gray-500">
                Faltam <span className="font-bold text-gray-700">{stats.missing}</span> para completar
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ─── Quick Stats Grid ─── */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center">
              <svg aria-hidden="true" className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <span className="text-[10px] text-gray-500 font-medium">Coladas</span>
          </div>
          <p className="text-2xl font-black text-gray-900"><AnimatedNumber value={stats.owned} /></p>
          <p className="text-[10px] text-emerald-500 font-semibold mt-0.5">
            {stats.pct}% do álbum
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-xl bg-orange-50 flex items-center justify-center">
              <svg aria-hidden="true" className="w-4 h-4 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <span className="text-[10px] text-gray-500 font-medium">Faltantes</span>
          </div>
          <p className="text-2xl font-black text-gray-900"><AnimatedNumber value={stats.missing} /></p>
          <p className="text-[10px] text-orange-400 font-semibold mt-0.5">
            {TOTAL > 0 ? Math.round((stats.missing / TOTAL) * 100) : 0}% restante
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-xl bg-brand-light flex items-center justify-center">
              <svg aria-hidden="true" className="w-4 h-4 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
              </svg>
            </div>
            <span className="text-[10px] text-gray-500 font-medium">Repetidas</span>
          </div>
          <p className="text-2xl font-black text-gray-900"><AnimatedNumber value={stats.duplicates} /></p>
          <p className="text-[10px] text-brand font-semibold mt-0.5">
            {stats.totalExtras} figurinhas extras
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center">
              <svg aria-hidden="true" className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
              </svg>
            </div>
            <span className="text-[10px] text-gray-500 font-medium">Eficiência</span>
          </div>
          <p className="text-2xl font-black text-gray-900"><AnimatedNumber value={dupeEfficiency} />%</p>
          <p className="text-[10px] text-blue-500 font-semibold mt-0.5">
            taxa de aproveitamento
          </p>
        </div>
      </div>

      {/* ─── Conquistas / Achievements ─── */}
      {(achievements.complete.length > 0 || achievements.almostComplete.length > 0) && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
          <h2 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-amber-50 flex items-center justify-center text-sm">
              🏆
            </span>
            Conquistas
          </h2>

          {achievements.complete.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider mb-2">
                Seleções completas ({achievements.complete.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {achievements.complete.map((c) => (
                  <span
                    key={c.country}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 border border-emerald-100 rounded-lg text-xs font-semibold text-emerald-700 animate-fade-in"
                  >
                    {getFlag(c.country)} {c.country}
                  </span>
                ))}
              </div>
            </div>
          )}

          {achievements.almostComplete.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wider mb-2">
                Quase la! (80%+)
              </p>
              <div className="space-y-2">
                {achievements.almostComplete.slice(0, 5).map((c) => (
                  <div key={c.country} className="flex items-center gap-2">
                    <span className="text-base">{getFlag(c.country)}</span>
                    <span className="text-xs font-medium text-gray-700 w-24 truncate">{c.country}</span>
                    <div className="flex-1">
                      <HBar pct={c.pct} color="linear-gradient(90deg, #f59e0b, #fbbf24)" delay={100} />
                    </div>
                    <span className="text-[10px] font-bold text-amber-600 w-8 text-right">{c.pct}%</span>
                    <span className="text-[10px] text-gray-500">
                      falta {c.total - c.owned}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Distribuicao por Tipo ─── */}
      {typeData.length > 1 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
          <h2 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-brand-light flex items-center justify-center text-sm">
              📊
            </span>
            Por Tipo de Figurinha
          </h2>
          <div className="flex items-center gap-4">
            <MiniDonut
              size={80}
              segments={typeData.map((t, i) => ({
                pct: TOTAL > 0 ? (t.total / TOTAL) * 100 : 0,
                color: typeColors[i % typeColors.length],
              }))}
            />
            <div className="flex-1 space-y-2">
              {typeData.map((t, i) => (
                <div key={t.type} className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: typeColors[i % typeColors.length] }}
                  />
                  <span className="text-[11px] text-gray-600 flex-1 truncate">{t.type}</span>
                  <span className="text-[10px] font-bold text-gray-900">{t.owned}/{t.total}</span>
                  <span className="text-[10px] text-gray-500 w-8 text-right">{t.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Progresso por Seleção ─── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <h2 className="text-sm font-bold text-gray-900 mb-1 flex items-center gap-2">
          <span className="w-6 h-6 rounded-lg bg-blue-50 flex items-center justify-center text-sm">
            🌍
          </span>
          Progresso por Seleção
        </h2>
        <p className="text-[10px] text-gray-500 mb-4">Ordenado por conclusão</p>

        <div className="space-y-3">
          {visibleCountries.map((c, i) => (
            <div key={c.country} className="group">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-base leading-none">{getFlag(c.country)}</span>
                <span className="text-[11px] font-semibold text-gray-700 flex-1 truncate">{c.country}</span>
                <span className="text-[10px] text-gray-500">{c.owned}/{c.total}</span>
                <span className={`text-[10px] font-bold w-9 text-right ${
                  c.pct === 100 ? 'text-emerald-600' :
                  c.pct >= 80 ? 'text-brand' :
                  c.pct >= 50 ? 'text-blue-600' :
                  'text-gray-500'
                }`}>{c.pct}%</span>
              </div>
              <HBar pct={c.pct} color={barColor(c.pct)} delay={i * 50} />
            </div>
          ))}
        </div>

        {countryData.length > 8 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="w-full mt-4 py-2.5 text-xs font-semibold text-brand bg-brand-light hover:bg-brand-light rounded-xl transition active:scale-[0.98]"
          >
            {showAll ? 'Ver menos' : `Ver todas (${countryData.length})`}
          </button>
        )}
      </div>

      {/* ─── Radar de Repetidas ─── */}
      {achievements.mostDupes.some((c) => c.extras > 0) && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
          <h2 className="text-sm font-bold text-gray-900 mb-1 flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-rose-50 flex items-center justify-center text-sm">
              🔄
            </span>
            Repetidas por Seleção
          </h2>
          <p className="text-[10px] text-gray-500 mb-4">Onde você tem mais figurinhas extras</p>

          <div className="space-y-2">
            {achievements.mostDupes.filter((c) => c.extras > 0).map((c, i) => {
              const maxExtras = achievements.mostDupes[0]?.extras || 1
              const barPct = (c.extras / maxExtras) * 100
              return (
                <div key={c.country} className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-gray-500 w-4">{i + 1}.</span>
                  <span className="text-base">{getFlag(c.country)}</span>
                  <span className="text-[11px] font-medium text-gray-700 w-24 truncate">{c.country}</span>
                  <div className="flex-1 h-6 bg-gray-50 rounded-lg overflow-hidden relative">
                    <div
                      className="h-full rounded-lg"
                      style={{
                        width: `${barPct}%`,
                        background: 'linear-gradient(90deg, #f43f5e, #fb7185)',
                        transition: 'width 1s ease-out',
                      }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-gray-700">
                      {c.extras} extras ({c.duplicates} fig.)
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ─── Insights & Financeiro ─── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <h2 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
          <span className="w-6 h-6 rounded-lg bg-indigo-50 flex items-center justify-center text-sm">📊</span>
          Raio-X da sua coleção
        </h2>

        {/* Financial overview */}
        {stats.missing > 0 && (
          <div className="bg-gradient-to-br from-gray-50 to-blue-50/50 rounded-xl p-3.5 mb-3">
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="text-center">
                <p className="text-lg font-black text-red-500">R${finStats.costAlone}</p>
                <p className="text-[9px] text-gray-500 mt-0.5">comprando sozinho</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-black text-emerald-600">R${finStats.costWithTrades}</p>
                <p className="text-[9px] text-gray-500 mt-0.5">trocando repetidas</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-black text-blue-600">{finStats.probNew}%</p>
                <p className="text-[9px] text-gray-500 mt-0.5">chance de nova</p>
              </div>
            </div>

            {/* Savings bar */}
            {finStats.savings > 0 && (
              <div className="bg-white/80 rounded-lg p-2.5">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-[10px] font-semibold text-gray-600">Economia com trocas</span>
                  <span className="text-[11px] font-black text-emerald-600">R${finStats.savings}</span>
                </div>
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-400 to-teal-400 rounded-full transition-all duration-1000"
                    style={{ width: `${finStats.savingsPct}%` }}
                  />
                </div>
                <p className="text-[8px] text-gray-400 mt-1">
                  {finStats.savingsPct}% mais barato — ~{finStats.packsNeeded} pacotes a menos
                </p>
              </div>
            )}
          </div>
        )}

        {/* Smart insights */}
        <div className="space-y-2">
          {stats.totalExtras > 0 && stats.missing > 0 && (
            <div className="flex items-start gap-2.5 p-2.5 bg-amber-50/70 rounded-lg">
              <span className="text-sm mt-0.5">🔄</span>
              <div className="flex-1">
                <p className="text-[11px] text-gray-700 leading-relaxed">
                  Suas <strong>{stats.totalExtras} repetida{stats.totalExtras > 1 ? 's' : ''}</strong> podem cobrir
                  {' '}<strong>{Math.min(stats.totalExtras, stats.missing)}</strong> das {stats.missing} faltantes por troca direta.
                </p>
                <Link href="/trades" className="inline-flex items-center gap-1 text-[10px] font-semibold text-brand mt-1 hover:text-brand-dark">
                  Encontrar quem tem suas faltantes
                  <svg aria-hidden="true" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </Link>
              </div>
            </div>
          )}

          {stats.totalExtras === 0 && stats.missing > 0 && stats.owned > 0 && (
            <div className="flex items-start gap-2.5 p-2.5 bg-blue-50/70 rounded-lg">
              <span className="text-sm mt-0.5">💡</span>
              <p className="text-[11px] text-gray-700 leading-relaxed">
                Você ainda não tem repetidas para trocar. Ao comprar pacotes, fique de olho — cada repetida vira moeda de troca para conseguir as faltantes mais barato.
              </p>
            </div>
          )}

          {finStats.probNew < 30 && stats.missing > 0 && (
            <div className="flex items-start gap-2.5 p-2.5 bg-orange-50/70 rounded-lg">
              <span className="text-sm mt-0.5">⚠️</span>
              <div className="flex-1">
                <p className="text-[11px] text-gray-700 leading-relaxed">
                  Com apenas <strong>{finStats.probNew}%</strong> de chance de figurinha nova, comprar pacotes fica caro.
                  Trocar é mais eficiente nessa fase do álbum.
                </p>
                <Link href="/trades" className="inline-flex items-center gap-1 text-[10px] font-semibold text-brand mt-1 hover:text-brand-dark">
                  Ver trocas disponíveis
                  <svg aria-hidden="true" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </Link>
              </div>
            </div>
          )}

          {achievements.complete.length > 0 && (
            <div className="flex items-start gap-2.5 p-2.5 bg-emerald-50/70 rounded-lg">
              <span className="text-sm mt-0.5">⭐</span>
              <p className="text-[11px] text-gray-700 leading-relaxed">
                <strong>{achievements.complete.length}</strong> selec{achievements.complete.length > 1 ? 'oes completas' : 'ao completa'} — parabens!
                {achievements.almostComplete.length > 0 && ` Mais ${achievements.almostComplete.length} perto de completar.`}
              </p>
            </div>
          )}

          <div className="flex items-start gap-2.5 p-2.5 bg-brand-light/50 rounded-lg">
            <span className="text-sm mt-0.5">📦</span>
            <p className="text-[11px] text-gray-700 leading-relaxed">
              {stats.owned + stats.totalExtras} figurinhas colecionadas no total. Taxa de aproveitamento: <strong>{dupeEfficiency}%</strong>
              {dupeEfficiency < 70 && ' — muitas repetidas, hora de trocar!'}
              {dupeEfficiency >= 90 && ' — excelente aproveitamento!'}
            </p>
          </div>
        </div>

        {/* CTA to trades */}
        {stats.missing > 0 && stats.totalExtras > 0 && (
          <Link
            href="/trades"
            className="flex items-center gap-3 mt-3 p-3 bg-gradient-to-r from-brand-light to-gold-light border border-brand/20 rounded-xl hover:from-brand-light/80 hover:to-gold-light/80 transition active:scale-[0.98]"
          >
            <div className="w-9 h-9 rounded-lg bg-brand flex items-center justify-center flex-shrink-0">
              <svg aria-hidden="true" className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-800">Trocar figurinhas</p>
              <p className="text-[10px] text-gray-500">
                {stats.totalExtras} repetida{stats.totalExtras > 1 ? 's' : ''} para trocar por faltantes perto de você
              </p>
            </div>
            <svg aria-hidden="true" className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </Link>
        )}
      </div>

      {/* ─── Seleções não iniciadas ─── */}
      {achievements.notStarted.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
          <h2 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-gray-50 flex items-center justify-center text-sm">
              🔍
            </span>
            Seleções não iniciadas ({achievements.notStarted.length})
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {achievements.notStarted.map((c) => (
              <span
                key={c.country}
                className="inline-flex items-center gap-1 px-2 py-1 bg-gray-50 border border-gray-100 rounded-lg text-[10px] font-medium text-gray-500"
              >
                {getFlag(c.country)} {c.country}
                <span className="text-gray-400">({c.total})</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </main>
  )
}

