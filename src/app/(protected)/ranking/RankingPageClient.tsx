'use client'

import { useState } from 'react'
import RankingCard from '@/components/RankingCard'
import StickerStats from '@/components/StickerStats'

type RankingData = {
  owned_count: number
  national_rank: number
  national_total: number
  city: string | null
  city_rank: number | null
  city_total: number | null
  state: string | null
  state_rank: number | null
  state_total: number | null
} | null

export default function RankingPageClient({
  ranking,
  nationalStats,
  neighborhoodStats,
  sections,
  owned,
  duplicates,
  total,
}: {
  ranking: RankingData
  nationalStats: any[]
  neighborhoodStats: any[]
  sections: string[]
  owned: number
  duplicates: number
  total: number
}) {
  const pct = total > 0 ? Math.round((owned / total) * 100) : 0

  return (
    <main className="min-h-screen bg-gray-50 px-5 py-6 max-w-md mx-auto space-y-4">
      {/* Progress summary */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center gap-4">
          {/* Progress ring */}
          <div className="relative w-16 h-16 shrink-0">
            <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="28" fill="none" stroke="#F3F4F6" strokeWidth="6" />
              <circle
                cx="32" cy="32" r="28" fill="none"
                stroke="#00C896" strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={`${pct * 1.76} 176`}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-navy">
              {pct}%
            </span>
          </div>
          <div>
            <p className="text-lg font-bold text-navy">{owned}/{total}</p>
            <p className="text-xs text-gray-500">figurinhas coladas</p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {duplicates} repetidas · {total - owned} faltando
            </p>
          </div>
        </div>
      </div>

      {/* Ranking */}
      <RankingCard ranking={ranking} />

      {/* Most wanted stickers */}
      <StickerStats
        nationalStats={nationalStats}
        neighborhoodStats={neighborhoodStats}
        sections={sections}
      />
    </main>
  )
}
