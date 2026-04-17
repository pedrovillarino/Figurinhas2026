'use client'

import { useState } from 'react'
import { getFlag } from '@/lib/countries'

type Sticker = {
  sticker_id: number
  number: string
  player_name: string | null
  country: string
}

type ComparatorClientProps = {
  iHaveForYou: Sticker[]
  youHaveForMe: Sticker[]
  targetName: string
  targetId: string
  refcode: string
}

export default function ComparatorClient({
  iHaveForYou,
  youHaveForMe,
  targetName,
  refcode,
}: ComparatorClientProps) {
  const [requestSent, setRequestSent] = useState(false)

  const hasTradeableStickers = iHaveForYou.length > 0 || youHaveForMe.length > 0

  return (
    <div className="space-y-6">
      {!hasTradeableStickers ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center">
          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-700 mb-1">
            Nenhuma troca disponível
          </p>
          <p className="text-xs text-gray-500">
            Vocês não têm figurinhas para trocar no momento.
          </p>
        </div>
      ) : (
        <>
          {/* I have for you */}
          {iHaveForYou.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-brand-light/30">
                <h3 className="text-sm font-semibold text-brand-dark">
                  Eu tenho {iHaveForYou.length} que {targetName} precisa
                </h3>
              </div>
              <ul className="divide-y divide-gray-50">
                {iHaveForYou.map((s) => (
                  <li key={s.sticker_id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-base">{getFlag(s.country)}</span>
                    <span className="text-xs font-bold text-navy w-12">{s.number}</span>
                    <span className="text-xs text-gray-600 flex-1 truncate">
                      {s.player_name || s.country}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* You have for me */}
          {youHaveForMe.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-gold-light/50">
                <h3 className="text-sm font-semibold text-gold-dark">
                  {targetName} tem {youHaveForMe.length} que eu preciso
                </h3>
              </div>
              <ul className="divide-y divide-gray-50">
                {youHaveForMe.map((s) => (
                  <li key={s.sticker_id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-base">{getFlag(s.country)}</span>
                    <span className="text-xs font-bold text-navy w-12">{s.number}</span>
                    <span className="text-xs text-gray-600 flex-1 truncate">
                      {s.player_name || s.country}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Trade CTA */}
          <a
            href="/trades"
            onClick={() => setRequestSent(true)}
            className={`block w-full text-center rounded-xl px-4 py-3 text-sm font-semibold transition ${
              requestSent
                ? 'bg-brand-light text-brand pointer-events-none'
                : 'bg-brand text-white hover:bg-brand-dark'
            }`}
          >
            {requestSent ? 'Redirecionando...' : 'Solicitar troca'}
          </a>
        </>
      )}
    </div>
  )
}
