'use client'

import { useState } from 'react'
import RankingCard from '@/components/RankingCard'
import StickerStats from '@/components/StickerStats'

type RankingData = {
  owned_count: number
  boosted_count?: number
  tier?: string
  national_rank: number
  national_total: number
  city: string | null
  city_rank: number | null
  city_total: number | null
  state: string | null
  state_rank: number | null
  state_total: number | null
  friends_rank?: number | null
  friends_total?: number | null
} | null

type FriendEntry = {
  friend_id: string
  display_name: string | null
  avatar_url: string | null
  owned_count: number
  tier: string
  rank: number
}

export default function RankingPageClient({
  ranking,
  friendsRanking,
  nationalStats,
  neighborhoodStats,
  sections,
  owned,
  duplicates,
  total,
  userId,
}: {
  ranking: RankingData
  friendsRanking: FriendEntry[]
  nationalStats: any[]
  neighborhoodStats: any[]
  sections: string[]
  owned: number
  duplicates: number
  total: number
  userId: string
}) {
  const pct = total > 0 ? Math.round((owned / total) * 100) : 0
  const [addingFriend, setAddingFriend] = useState(false)
  const [friendCode, setFriendCode] = useState('')
  const [friendError, setFriendError] = useState('')
  const [friendSuccess, setFriendSuccess] = useState('')
  const [friends, setFriends] = useState(friendsRanking)
  const [removingId, setRemovingId] = useState<string | null>(null)

  async function addFriend() {
    if (!friendCode.trim()) return
    setFriendError('')
    setFriendSuccess('')
    setAddingFriend(true)
    try {
      const res = await fetch('/api/friends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referral_code: friendCode.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        setFriendSuccess(`${data.friend.display_name || 'Amigo'} adicionado!`)
        setFriendCode('')
        // Refresh friends list
        const listRes = await fetch('/api/friends')
        const listData = await listRes.json()
        if (listData.friends) setFriends(listData.friends)
      } else {
        setFriendError(data.error || 'Erro ao adicionar')
      }
    } catch {
      setFriendError('Erro de conexão')
    }
    setAddingFriend(false)
  }

  async function removeFriend(friendId: string) {
    setRemovingId(friendId)
    try {
      await fetch('/api/friends', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friend_id: friendId }),
      })
      setFriends((prev) => prev.filter((f) => f.friend_id !== friendId))
    } catch { /* silent */ }
    setRemovingId(null)
  }

  const isPremium = ranking?.tier === 'copa_completa'

  return (
    <main className="min-h-screen bg-gray-50 px-5 py-6 max-w-md mx-auto space-y-4">
      {/* Progress summary */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center gap-4">
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
            {isPremium && (
              <span className="inline-flex items-center gap-1 mt-1 bg-yellow-50 text-yellow-700 rounded-full px-2 py-0.5 text-[9px] font-bold">
                ⭐ Prioridade nas trocas
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Ranking */}
      <RankingCard ranking={ranking} />

      {/* Friends Ranking */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-navy flex items-center gap-1.5">
              <span>👥</span> Ranking de Amigos
            </h3>
            {ranking?.friends_rank && ranking?.friends_total && (
              <p className="text-[10px] text-gray-400 mt-0.5">
                Você é #{ranking.friends_rank} de {ranking.friends_total}
              </p>
            )}
          </div>
        </div>

        {/* Friends list */}
        <div className="px-3 pb-2">
          {friends.length === 0 ? (
            <p className="text-[11px] text-gray-400 text-center py-3">
              Adicione amigos pelo código para comparar progresso!
            </p>
          ) : (
            <div className="space-y-1">
              {friends.map((f) => {
                const isMe = f.friend_id === userId
                const initial = (f.display_name || '?')[0].toUpperCase()
                return (
                  <div
                    key={f.friend_id}
                    className={`flex items-center gap-2 py-2 px-2 rounded-lg ${isMe ? 'bg-brand-light/50' : 'hover:bg-gray-50'} transition`}
                  >
                    {/* Rank */}
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                      f.rank === 1 ? 'bg-yellow-100 text-yellow-700' :
                      f.rank === 2 ? 'bg-gray-100 text-gray-500' :
                      f.rank === 3 ? 'bg-amber-50 text-amber-600' :
                      'bg-gray-50 text-gray-400'
                    }`}>
                      {f.rank}
                    </span>

                    {/* Avatar */}
                    {f.avatar_url ? (
                      <img src={f.avatar_url} alt="" className="w-7 h-7 rounded-full shrink-0" />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-500 shrink-0">
                        {initial}
                      </div>
                    )}

                    {/* Name + count */}
                    <div className="flex-1 min-w-0">
                      <span className={`text-xs font-medium truncate block ${isMe ? 'text-brand font-bold' : 'text-navy'}`}>
                        {isMe ? 'Você' : (f.display_name?.split(' ')[0] || 'Amigo')}
                      </span>
                      <span className="text-[10px] text-gray-400">{f.owned_count} figurinhas</span>
                    </div>

                    {/* Tier badge */}
                    {f.tier === 'copa_completa' && (
                      <span className="text-[8px] bg-yellow-50 text-yellow-600 rounded-full px-1.5 py-0.5 font-bold shrink-0">⭐</span>
                    )}

                    {/* Remove button (not for self) */}
                    {!isMe && (
                      <button
                        onClick={() => removeFriend(f.friend_id)}
                        disabled={removingId === f.friend_id}
                        className="text-gray-300 hover:text-red-400 transition shrink-0 p-1"
                        aria-label="Remover amigo"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Add friend */}
        <div className="px-3 pb-3 border-t border-gray-100 pt-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={friendCode}
              onChange={(e) => { setFriendCode(e.target.value.toUpperCase()); setFriendError(''); setFriendSuccess('') }}
              placeholder="Código do amigo (ex: ABC123)"
              maxLength={10}
              className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-navy placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <button
              onClick={addFriend}
              disabled={addingFriend || !friendCode.trim()}
              className="bg-brand text-white rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-brand-dark transition disabled:opacity-50 shrink-0"
            >
              {addingFriend ? '...' : 'Adicionar'}
            </button>
          </div>
          {friendError && <p className="text-red-500 text-[10px] mt-1">{friendError}</p>}
          {friendSuccess && <p className="text-brand text-[10px] mt-1">{friendSuccess}</p>}
        </div>
      </div>

      {/* Most wanted stickers */}
      <StickerStats
        nationalStats={nationalStats}
        neighborhoodStats={neighborhoodStats}
        sections={sections}
      />
    </main>
  )
}
