'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import StickerStats from '@/components/StickerStats'
import RankingShareButton from '@/components/RankingShareButton'

type RankingData = {
  owned_count: number
  boosted_count?: number
  tier?: string
  national_rank: number
  national_total: number
  city: string | null
  city_rank: number | null
  city_total: number | null
  friends_rank?: number | null
  friends_total?: number | null
  [key: string]: unknown
} | null

type LeaderboardEntry = {
  user_id: string
  display_name: string | null
  avatar_url: string | null
  owned_count: number
  total_stickers: number
  pct: number
  tier: string
  rank: number
}

type RankingTab = 'national' | 'neighborhood' | 'friends'
type Visibility = 'public' | 'friends' | 'private'

const INITIAL_LEADERBOARD_COUNT = 15
const STATS_USER_THRESHOLD = 100

export default function RankingPageClient({
  ranking,
  nationalLeaderboard,
  neighborhoodLeaderboard,
  friendsLeaderboard,
  nationalStats,
  neighborhoodStats,
  sections,
  owned,
  duplicates,
  total,
  userId,
  userDisplayName,
  userAvatar,
  totalUsers,
  rankingVisibility,
  referralCode,
}: {
  ranking: RankingData
  nationalLeaderboard: LeaderboardEntry[]
  neighborhoodLeaderboard: LeaderboardEntry[]
  friendsLeaderboard: LeaderboardEntry[]
  nationalStats: any[]
  neighborhoodStats: any[]
  sections: string[]
  owned: number
  duplicates: number
  total: number
  userId: string
  userDisplayName: string | null
  userAvatar: string | null
  totalUsers: number
  rankingVisibility: string
  referralCode: string
}) {
  const supabase = createClient()
  const pct = total > 0 ? Math.round((owned / total) * 100) : 0
  const isPremium = ranking?.tier === 'copa_completa'

  // Ranking tab
  const [tab, setTab] = useState<RankingTab>('national')

  // Expand/collapse leaderboard (per-tab so switching tabs resets)
  const [expanded, setExpanded] = useState<Record<RankingTab, boolean>>({
    national: false,
    neighborhood: false,
    friends: false,
  })

  // Privacy
  const [visibility, setVisibility] = useState<Visibility>(rankingVisibility as Visibility)
  const [savingVisibility, setSavingVisibility] = useState(false)

  // Friends
  const [friendCode, setFriendCode] = useState('')
  const [addingFriend, setAddingFriend] = useState(false)
  const [friendMsg, setFriendMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [friends, setFriends] = useState(friendsLeaderboard)

  async function updateVisibility(v: Visibility) {
    setVisibility(v)
    setSavingVisibility(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase.from('profiles').update({ ranking_visibility: v }).eq('id', user.id)
    }
    setSavingVisibility(false)
  }

  async function addFriend() {
    if (!friendCode.trim()) return
    setFriendMsg(null)
    setAddingFriend(true)
    try {
      const res = await fetch('/api/friends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referral_code: friendCode.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        setFriendMsg({ type: 'ok', text: `${data.friend.display_name || 'Amigo'} adicionado!` })
        setFriendCode('')
        const listRes = await fetch('/api/friends')
        const listData = await listRes.json()
        if (listData.friends) setFriends(listData.friends)
      } else {
        setFriendMsg({ type: 'err', text: data.error || 'Erro ao adicionar' })
      }
    } catch {
      setFriendMsg({ type: 'err', text: 'Erro de conexão' })
    }
    setAddingFriend(false)
  }

  async function removeFriend(friendId: string) {
    await fetch('/api/friends', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ friend_id: friendId }),
    }).catch(() => {})
    setFriends((prev) => prev.filter((f) => f.user_id !== friendId))
  }

  const tabs: { key: RankingTab; label: string; icon: string }[] = [
    { key: 'national', label: 'Geral', icon: '🌍' },
    { key: 'neighborhood', label: 'Bairro', icon: '📍' },
    { key: 'friends', label: 'Amigos', icon: '👥' },
  ]

  const fullLeaderboard =
    tab === 'national' ? nationalLeaderboard :
    tab === 'neighborhood' ? neighborhoodLeaderboard :
    friends

  const isExpanded = expanded[tab]
  const visibleLeaderboard = isExpanded
    ? fullLeaderboard
    : fullLeaderboard.slice(0, INITIAL_LEADERBOARD_COUNT)
  const hiddenCount = Math.max(fullLeaderboard.length - INITIAL_LEADERBOARD_COUNT, 0)

  // Hide "Sua posição" when the rank is meaningless: total of 0 (no one in the
  // scope) or rank > total (happens when the user has 0 stickers and gets
  // appended after everyone with at least one sticker).
  const rawRank =
    tab === 'national' && ranking ? { rank: ranking.national_rank, total: ranking.national_total } :
    tab === 'neighborhood' && ranking?.city_rank != null ? { rank: ranking.city_rank, total: ranking.city_total ?? 0 } :
    tab === 'friends' && ranking?.friends_rank != null ? { rank: ranking.friends_rank, total: ranking.friends_total ?? 0 } :
    null
  const myRank = rawRank && rawRank.total > 0 && rawRank.rank <= rawRank.total ? rawRank : null

  // Whatsapp share text for the friends-invite card.
  const inviteUrl = referralCode
    ? `https://www.completeai.com.br/?ref=${referralCode}`
    : 'https://www.completeai.com.br'
  const inviteMessage = `Bora completar o álbum da Copa 2026 juntos? 🇧🇷⚽\n\nUsei o Complete Aí pra organizar e achar trocas perto. Cria sua conta com meu link e a gente ganha créditos:\n${inviteUrl}`
  const whatsappShareUrl = `https://wa.me/?text=${encodeURIComponent(inviteMessage)}`

  const [copiedInvite, setCopiedInvite] = useState(false)
  function copyInvite() {
    navigator.clipboard.writeText(inviteUrl).catch(() => {})
    setCopiedInvite(true)
    setTimeout(() => setCopiedInvite(false), 2000)
  }

  const myInitial = (userDisplayName || '?')[0].toUpperCase()
  const myFirstName = userDisplayName?.split(' ')[0] || 'Você'
  const showStats = totalUsers >= STATS_USER_THRESHOLD

  return (
    <main className="min-h-screen bg-gray-50 px-5 py-6 max-w-md mx-auto space-y-4">
      {/* Progress summary */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center gap-4">
          <div className="relative w-16 h-16 shrink-0">
            <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="28" fill="none" stroke="#F3F4F6" strokeWidth="6" />
              <circle cx="32" cy="32" r="28" fill="none" stroke="#00C896" strokeWidth="6"
                strokeLinecap="round" strokeDasharray={`${pct * 1.76} 176`} />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-navy">{pct}%</span>
          </div>
          <div>
            <p className="text-lg font-bold text-navy">{owned}/{total}</p>
            <p className="text-xs text-gray-500">figurinhas coladas</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{duplicates} repetidas · {total - owned} faltando</p>
            {isPremium && (
              <span className="inline-flex items-center gap-1 mt-1 bg-yellow-50 text-yellow-700 rounded-full px-2 py-0.5 text-[9px] font-bold">
                ⭐ Prioridade nas trocas
              </span>
            )}
          </div>
        </div>

        {/* Share */}
        {ranking && <RankingShareButton nationalRank={ranking.national_rank} ownedCount={ranking.owned_count} />}
      </div>

      {/* Privacy setting */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-navy">Visibilidade no ranking</p>
            <p className="text-[10px] text-gray-400">Quem pode ver você</p>
          </div>
          <select
            value={visibility}
            onChange={(e) => updateVisibility(e.target.value as Visibility)}
            disabled={savingVisibility}
            className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-navy focus:outline-none focus:ring-2 focus:ring-brand/30"
          >
            <option value="public">Todos</option>
            <option value="friends">Só amigos</option>
            <option value="private">Ninguém</option>
          </select>
        </div>
      </div>

      {/* Ranking tabs */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex gap-1 p-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
                tab === t.key ? 'bg-brand text-white shadow-sm' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* My position — destaque card */}
        {myRank && (
          <div className="px-3 pb-2">
            <div className="bg-gradient-to-r from-brand-light/70 to-brand-light/30 border border-brand/30 rounded-xl p-3 flex items-center gap-2.5">
              {/* Avatar */}
              {userAvatar ? (
                <img src={userAvatar} alt="" className="w-9 h-9 rounded-full object-cover shrink-0 ring-2 ring-brand/40" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-brand text-white flex items-center justify-center text-sm font-bold shrink-0">
                  {myInitial}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[9px] font-bold text-brand-dark uppercase tracking-wider leading-none">
                  Sua posição
                </p>
                <p className="text-lg font-black text-navy leading-tight mt-0.5">
                  #{myRank.rank}
                  <span className="text-xs text-gray-500 font-medium ml-1">/ {myRank.total}</span>
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xl font-black text-brand leading-none">{pct}%</p>
                <p className="text-[9px] text-gray-500 mt-1">{owned}/{total}</p>
              </div>
            </div>
          </div>
        )}

        {/* Leaderboard */}
        <div className="px-3 pb-3">
          {fullLeaderboard.length === 0 ? (
            <div className="text-center py-6 px-2">
              {tab === 'neighborhood' ? (
                <>
                  <p className="text-2xl mb-2">📍</p>
                  <p className="text-xs font-semibold text-navy">Você é o pioneiro do bairro!</p>
                  <p className="text-[11px] text-gray-400 mt-1">Sem outros colecionadores num raio de 2,5km. Convide vizinhos pra começar a competição.</p>
                </>
              ) : tab === 'friends' ? (
                <>
                  <p className="text-2xl mb-2">👥</p>
                  <p className="text-xs font-semibold text-navy">Sem amigos no ranking ainda</p>
                  <p className="text-[11px] text-gray-400 mt-1">Compartilhe seu código abaixo pra começar a comparar progresso.</p>
                </>
              ) : (
                <p className="text-[11px] text-gray-400">Nenhum colecionador encontrado</p>
              )}
            </div>
          ) : (
            <div className="space-y-1 mt-1">
              {visibleLeaderboard.map((entry) => {
                const isMe = entry.user_id === userId
                const initial = (entry.display_name || '?')[0].toUpperCase()
                const entryPct = entry.pct ?? (entry.total_stickers ? Math.round((entry.owned_count / entry.total_stickers) * 100) : 0)

                return (
                  <a
                    key={entry.user_id}
                    href={isMe ? '/album' : `/u/${entry.user_id}`}
                    className={`flex items-center gap-2 py-2 px-2 rounded-xl transition ${
                      isMe ? 'bg-brand-light/50 ring-1 ring-brand/20' : 'hover:bg-gray-50'
                    }`}
                  >
                    {/* Rank */}
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      entry.rank === 1 ? 'bg-yellow-100 text-yellow-700' :
                      entry.rank === 2 ? 'bg-gray-200 text-gray-600' :
                      entry.rank === 3 ? 'bg-amber-100 text-amber-700' :
                      'bg-gray-50 text-gray-400'
                    }`}>
                      {entry.rank <= 3 ? ['🥇','🥈','🥉'][entry.rank - 1] : entry.rank}
                    </span>

                    {/* Avatar */}
                    {entry.avatar_url ? (
                      <img src={entry.avatar_url} alt="" className="w-8 h-8 rounded-full shrink-0 object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-500 shrink-0">
                        {initial}
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs font-medium truncate ${isMe ? 'text-brand font-bold' : 'text-navy'}`}>
                          {isMe ? 'Você' : (entry.display_name?.split(' ')[0] || 'Colecionador')}
                        </span>
                        {entry.tier === 'copa_completa' && <span className="text-[8px]">⭐</span>}
                      </div>
                      <span className="text-[10px] text-gray-400">{entry.owned_count} figurinhas</span>
                    </div>

                    {/* Progress % */}
                    <div className="text-right shrink-0">
                      <span className={`text-sm font-bold ${
                        entryPct >= 80 ? 'text-brand' : entryPct >= 50 ? 'text-amber-500' : 'text-gray-400'
                      }`}>{entryPct}%</span>
                      <div className="w-12 h-1 bg-gray-100 rounded-full mt-0.5">
                        <div className={`h-full rounded-full ${
                          entryPct >= 80 ? 'bg-brand' : entryPct >= 50 ? 'bg-amber-400' : 'bg-gray-300'
                        }`} style={{ width: `${entryPct}%` }} />
                      </div>
                    </div>
                  </a>
                )
              })}

              {/* Ver mais / Mostrar menos */}
              {hiddenCount > 0 && (
                <button
                  onClick={() => setExpanded((prev) => ({ ...prev, [tab]: !isExpanded }))}
                  className="w-full mt-2 text-xs font-semibold text-brand hover:text-brand-dark transition py-2 rounded-xl bg-gray-50 hover:bg-gray-100"
                >
                  {isExpanded ? '↑ Mostrar menos' : `↓ Ver mais (+${hiddenCount})`}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Invite friends — referral card. Always shown on friends tab so users
            can grab their own code/link without leaving the ranking page. */}
        {tab === 'friends' && referralCode && (
          <div className="mx-3 mb-3 mt-1 rounded-2xl p-3.5 bg-gradient-to-br from-brand-light to-brand-light/40 border border-brand/30">
            <div className="flex items-start gap-2 mb-2.5">
              <span className="text-xl leading-none">🎁</span>
              <div className="flex-1">
                <p className="text-xs font-bold text-navy">Convide amigos pra trocar</p>
                <p className="text-[10px] text-gray-500 leading-snug mt-0.5">
                  Vocês ganham <span className="font-semibold text-brand-dark">+5 trocas e +10 scans</span> quando seu amigo fizer upgrade.
                </p>
              </div>
            </div>
            <div className="bg-white border border-brand/20 rounded-xl px-3 py-2 mb-2 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-[9px] text-gray-400 uppercase tracking-wider">Seu código</p>
                <p className="text-sm font-mono font-bold text-navy">{referralCode}</p>
              </div>
              <button
                onClick={copyInvite}
                className="shrink-0 text-[10px] font-semibold text-brand-dark bg-brand/10 hover:bg-brand/20 transition rounded-lg px-2.5 py-1.5"
              >
                {copiedInvite ? '✓ Copiado' : 'Copiar link'}
              </button>
            </div>
            <a
              href={whatsappShareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center bg-[#25D366] text-white rounded-xl py-2.5 text-xs font-bold hover:opacity-90 transition shadow-sm shadow-[#25D366]/30"
            >
              📱 Compartilhar no WhatsApp
            </a>
          </div>
        )}

        {/* Add friend by code (only on friends tab) */}
        {tab === 'friends' && (
          <div className="px-3 pb-3 border-t border-gray-100 pt-3">
            <p className="text-[10px] text-gray-400 mb-2">
              Já tem o código de um amigo? Cola aqui:
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={friendCode}
                onChange={(e) => { setFriendCode(e.target.value.toUpperCase()); setFriendMsg(null) }}
                placeholder="Digite o código (ex: ABC123)"
                maxLength={10}
                className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-navy placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              />
              <button
                onClick={addFriend}
                disabled={addingFriend || !friendCode.trim()}
                className="bg-brand text-white rounded-xl px-4 py-2.5 text-sm font-semibold hover:bg-brand-dark transition disabled:opacity-50 shrink-0"
              >
                {addingFriend ? '...' : 'Adicionar'}
              </button>
            </div>
            {friendMsg && (
              <p className={`text-xs mt-1.5 ${friendMsg.type === 'ok' ? 'text-brand' : 'text-red-500'}`}>
                {friendMsg.text}
              </p>
            )}

            {/* Remove friends */}
            {friends.length > 1 && (
              <div className="mt-3 pt-2 border-t border-gray-50">
                <p className="text-[10px] text-gray-400 mb-1">Gerenciar amigos:</p>
                <div className="flex flex-wrap gap-1">
                  {friends.filter(f => f.user_id !== userId).map((f) => (
                    <span key={f.user_id} className="inline-flex items-center gap-1 bg-gray-50 rounded-full px-2 py-1 text-[10px] text-gray-500">
                      {f.display_name?.split(' ')[0] || 'Amigo'}
                      <button
                        onClick={() => removeFriend(f.user_id)}
                        className="text-gray-300 hover:text-red-400 transition"
                        aria-label={`Remover ${f.display_name}`}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Most wanted stickers — only shown when the user base is large enough
          for the data to be statistically meaningful */}
      {showStats && (
        <StickerStats
          nationalStats={nationalStats}
          neighborhoodStats={neighborhoodStats}
          sections={sections}
        />
      )}
    </main>
  )
}
