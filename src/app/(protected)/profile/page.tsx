'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Profile = {
  display_name: string | null
  email: string | null
  phone: string | null
  avatar_url: string | null
}

type Stats = {
  owned: number
  missing: number
  duplicates: number
  total: number
}

export default function ProfilePage() {
  const supabase = createClient()
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [stats, setStats] = useState<Stats>({ owned: 0, missing: 0, duplicates: 0, total: 638 })

  useEffect(() => {
    loadProfile()
    loadStats()
  }, [])

  async function loadProfile() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data } = await supabase
      .from('profiles')
      .select('display_name, email, phone, avatar_url')
      .eq('id', user.id)
      .single()

    if (data) {
      setProfile(data)
      setPhone(data.phone || '')
    }
  }

  async function loadStats() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { count: totalStickers } = await supabase
      .from('stickers')
      .select('*', { count: 'exact', head: true })

    const { data: userStickers } = await supabase
      .from('user_stickers')
      .select('status')
      .eq('user_id', user.id)

    const total = totalStickers || 638
    let owned = 0, duplicates = 0
    userStickers?.forEach((us) => {
      if (us.status === 'owned') owned++
      if (us.status === 'duplicate') duplicates++
    })

    setStats({ owned, missing: total - owned - duplicates, duplicates, total })
  }

  async function savePhone() {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase
      .from('profiles')
      .update({ phone, last_active: new Date().toISOString() })
      .eq('id', user.id)

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const progressPct = stats.total > 0 ? Math.round((stats.owned / stats.total) * 100) : 0

  return (
    <div className="px-4 pt-6">
      <h1 className="text-2xl font-bold mb-6">Perfil</h1>

      {/* User info */}
      <div className="bg-white rounded-xl p-4 shadow-sm mb-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 bg-violet-100 rounded-full flex items-center justify-center text-violet-600 text-xl font-bold">
            {profile?.display_name?.[0]?.toUpperCase() || '?'}
          </div>
          <div>
            <p className="font-semibold">{profile?.display_name || 'Usuário'}</p>
            <p className="text-xs text-gray-500">{profile?.email}</p>
          </div>
        </div>

        {/* Progress */}
        <div className="mb-4">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Progresso do álbum</span>
            <span>{stats.owned}/{stats.total} ({progressPct}%)</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-violet-600 h-2 rounded-full transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <p className="text-lg font-bold text-green-600">{stats.owned}</p>
            <p className="text-[10px] text-gray-500">Coladas</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-red-500">{stats.missing}</p>
            <p className="text-[10px] text-gray-500">Faltam</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-blue-500">{stats.duplicates}</p>
            <p className="text-[10px] text-gray-500">Repetidas</p>
          </div>
        </div>
      </div>

      {/* Phone */}
      <div className="bg-white rounded-xl p-4 shadow-sm mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          WhatsApp / Telefone
        </label>
        <p className="text-xs text-gray-400 mb-2">
          Necessário para trocas via WhatsApp
        </p>
        <div className="flex gap-2">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+55 11 99999-9999"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none"
          />
          <button
            onClick={savePhone}
            disabled={saving}
            className="bg-violet-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-violet-700 transition disabled:opacity-50"
          >
            {saving ? '...' : saved ? 'Salvo!' : 'Salvar'}
          </button>
        </div>
      </div>

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="w-full bg-red-50 text-red-600 rounded-xl px-4 py-3 text-sm font-medium hover:bg-red-100 transition"
      >
        Sair da Conta
      </button>
    </div>
  )
}
