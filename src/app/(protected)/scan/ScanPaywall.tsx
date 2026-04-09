'use client'

import PaywallModal from '@/components/PaywallModal'
import type { Tier } from '@/lib/tiers'

export default function ScanPaywall({ currentTier }: { currentTier: Tier }) {
  return (
    <div className="px-4 pt-6">
      <h1 className="text-xl font-bold mb-1 text-gray-900">Scanner</h1>
      <p className="text-xs text-gray-400 mb-8">Detecte figurinhas com IA</p>

      {/* Locked preview */}
      <div className="relative">
        <div className="bg-gray-50 rounded-2xl p-8 flex flex-col items-center opacity-30">
          <div className="w-16 h-16 bg-gray-200 rounded-2xl mb-4" />
          <div className="w-32 h-3 bg-gray-200 rounded mb-2" />
          <div className="w-24 h-3 bg-gray-200 rounded" />
        </div>
      </div>

      <PaywallModal feature="scan" currentTier={currentTier} />
    </div>
  )
}
