'use client'

import { useState } from 'react'

type StickerStat = {
  sticker_id: number
  number: string
  player_name: string | null
  country: string
  section: string
  owners_count?: number
  total_users?: number
  ownership_pct?: number
  missing_nearby?: number
  nearby_users?: number
  missing_pct?: number
}

type Tab = 'national' | 'neighborhood' | 'team'

export default function StickerStats({
  nationalStats,
  neighborhoodStats,
  sections,
}: {
  nationalStats: StickerStat[]
  neighborhoodStats: StickerStat[]
  sections: string[]
}) {
  const [tab, setTab] = useState<Tab>('national')
  const [selectedSection, setSelectedSection] = useState(sections[0] || '')
  const [teamStats, setTeamStats] = useState<StickerStat[]>([])
  const [loadingTeam, setLoadingTeam] = useState(false)

  async function loadTeamStats(section: string) {
    setSelectedSection(section)
    setLoadingTeam(true)
    try {
      const res = await fetch(`/api/sticker-stats?section=${encodeURIComponent(section)}&limit=10`)
      if (res.ok) {
        const data = await res.json()
        setTeamStats(data.stickers || [])
      }
    } catch { /* silent */ }
    setLoadingTeam(false)
  }

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'national', label: 'Nacional', icon: '🇧🇷' },
    { key: 'neighborhood', label: 'Bairro', icon: '📍' },
    { key: 'team', label: 'Seleção', icon: '⚽' },
  ]

  const activeStats =
    tab === 'national' ? nationalStats :
    tab === 'neighborhood' ? neighborhoodStats :
    teamStats

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <h3 className="text-sm font-bold text-navy flex items-center gap-1.5">
          <span>🔥</span> Mais procuradas
        </h3>
        <p className="text-[10px] text-gray-400 mt-0.5">Figurinhas que menos pessoas têm</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-3 pb-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key)
              if (t.key === 'team' && teamStats.length === 0 && selectedSection) {
                loadTeamStats(selectedSection)
              }
            }}
            className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold transition-all ${
              tab === t.key ? 'bg-brand text-white shadow-sm' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Team selector (only for team tab) */}
      {tab === 'team' && (
        <div className="px-3 pb-2">
          <select
            value={selectedSection}
            onChange={(e) => loadTeamStats(e.target.value)}
            className="w-full text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-navy focus:outline-none focus:ring-2 focus:ring-brand/30"
          >
            {sections.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      )}

      {/* Stats list */}
      <div className="px-3 pb-3">
        {(tab === 'team' && loadingTeam) ? (
          <div className="flex justify-center py-4">
            <div className="w-5 h-5 border-2 border-gray-200 border-t-brand rounded-full animate-spin" />
          </div>
        ) : activeStats.length === 0 ? (
          <p className="text-[11px] text-gray-400 text-center py-4">
            {tab === 'neighborhood'
              ? 'Ative sua localização para ver dados do bairro'
              : 'Sem dados suficientes ainda'}
          </p>
        ) : (
          <div className="space-y-1">
            {activeStats.slice(0, 10).map((s, i) => {
              const pct = tab === 'neighborhood' ? s.missing_pct : s.ownership_pct
              const label = tab === 'neighborhood'
                ? `${s.missing_nearby}/${s.nearby_users} procuram`
                : `${s.owners_count}/${s.total_users} têm`

              return (
                <div
                  key={s.sticker_id}
                  className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 transition"
                >
                  {/* Rank */}
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                    i === 0 ? 'bg-yellow-100 text-yellow-700' :
                    i === 1 ? 'bg-gray-100 text-gray-500' :
                    i === 2 ? 'bg-amber-50 text-amber-600' :
                    'bg-gray-50 text-gray-400'
                  }`}>
                    {i + 1}
                  </span>

                  {/* Sticker info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-mono text-gray-400">{s.number}</span>
                      <span className="text-[11px] font-medium text-navy truncate">
                        {s.player_name || s.country}
                      </span>
                    </div>
                    {tab !== 'team' && (
                      <span className="text-[9px] text-gray-400">{s.country}</span>
                    )}
                  </div>

                  {/* Percentage bar */}
                  <div className="w-16 shrink-0">
                    <div className="flex items-center justify-end gap-1">
                      <span className={`text-[10px] font-semibold ${
                        (pct || 0) <= 20 ? 'text-red-500' :
                        (pct || 0) <= 50 ? 'text-amber-500' :
                        'text-brand'
                      }`}>
                        {pct ?? 0}%
                      </span>
                    </div>
                    <div className="w-full h-1 bg-gray-100 rounded-full mt-0.5">
                      <div
                        className={`h-full rounded-full transition-all ${
                          (pct || 0) <= 20 ? 'bg-red-400' :
                          (pct || 0) <= 50 ? 'bg-amber-400' :
                          'bg-brand'
                        }`}
                        style={{ width: `${Math.min(pct || 0, 100)}%` }}
                      />
                    </div>
                    <span className="text-[8px] text-gray-400">{label}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
