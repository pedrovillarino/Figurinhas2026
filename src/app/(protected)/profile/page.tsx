'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { TIER_CONFIG, SCAN_PACK_CONFIG, SCAN_PACK_AMOUNT, TRADE_PACK_CONFIG, TRADE_PACK_AMOUNT, isPaid } from '@/lib/tiers'
import type { Tier } from '@/lib/tiers'
import PaywallModal from '@/components/PaywallModal'

type Profile = {
  display_name: string | null
  email: string | null
  phone: string | null
  avatar_url: string | null
  tier: Tier
  scan_credits: number
  trade_credits: number
  referral_code: string | null
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
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [buyingScans, setBuyingScans] = useState(false)
  const [buyingTrades, setBuyingTrades] = useState(false)
  const [showPaywall, setShowPaywall] = useState(false)
  const [scansUsedTotal, setScansUsedTotal] = useState(0)
  const [tradesUsedTotal, setTradesUsedTotal] = useState(0)
  const [stats, setStats] = useState<Stats>({ owned: 0, missing: 0, duplicates: 0, total: 638 })
  const [referralCount, setReferralCount] = useState(0)
  const [referralRewards, setReferralRewards] = useState({ trade_credits: 0, scan_credits: 0 })
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    loadProfile()
    loadStats()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadProfile() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data } = await supabase
      .from('profiles')
      .select('display_name, email, phone, avatar_url, tier, scan_credits, trade_credits, referral_code')
      .eq('id', user.id)
      .single()

    if (data) {
      setProfile({
        ...data,
        tier: (data.tier || 'free') as Tier,
        scan_credits: data.scan_credits || 0,
        trade_credits: data.trade_credits || 0,
        referral_code: data.referral_code || null,
      })
      setPhone(data.phone || '')
      setDisplayName(data.display_name || '')
      setEmail(data.email || user.email || '')
    }

    // Fetch total scans used
    const { data: usageData } = await supabase
      .from('scan_usage')
      .select('scan_count')
      .eq('user_id', user.id)

    if (usageData) {
      const total = usageData.reduce((sum, row) => sum + (row.scan_count || 0), 0)
      setScansUsedTotal(total)
    }

    // Fetch total trades used
    const { count } = await supabase
      .from('trade_usage')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

    setTradesUsedTotal(count || 0)

    // Fetch referral stats
    const { data: rewards } = await supabase
      .from('referral_rewards')
      .select('reward_type, trade_credits, scan_credits')
      .eq('referrer_id', user.id)

    if (rewards && rewards.length > 0) {
      setReferralCount(rewards.length)
      const totals = rewards.reduce(
        (acc, r) => ({
          trade_credits: acc.trade_credits + (r.trade_credits || 0),
          scan_credits: acc.scan_credits + (r.scan_credits || 0),
        }),
        { trade_credits: 0, scan_credits: 0 }
      )
      setReferralRewards(totals)
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

    const total = totalStickers || 670
    let owned = 0, duplicates = 0
    userStickers?.forEach((us) => {
      if (us.status === 'owned') owned++
      if (us.status === 'duplicate') {
        owned++
        duplicates++
      }
    })

    setStats({ owned, missing: total - owned, duplicates, total })
  }

  async function savePhone() {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase
      .from('profiles')
      .update({
        display_name: displayName || null,
        email: email || null,
        phone,
        last_active: new Date().toISOString(),
      })
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

  async function handleBuyScans() {
    setBuyingScans(true)
    try {
      const res = await fetch('/api/stripe/scan-pack', { method: 'POST' })
      const data = await res.json()
      if (data.url && typeof data.url === 'string' && data.url.startsWith('https://')) {
        window.location.href = data.url
      } else {
        alert(data.error || `Erro ao iniciar compra (url: ${JSON.stringify(data.url)})`)
        setBuyingScans(false)
      }
    } catch {
      alert('Erro ao conectar com o servidor')
      setBuyingScans(false)
    }
  }

  async function handleBuyTrades() {
    setBuyingTrades(true)
    try {
      const res = await fetch('/api/stripe/trade-pack', { method: 'POST' })
      const data = await res.json()
      if (data.url && typeof data.url === 'string' && data.url.startsWith('https://')) {
        window.location.href = data.url
      } else {
        alert(data.error || `Erro ao iniciar compra (url: ${JSON.stringify(data.url)})`)
        setBuyingTrades(false)
      }
    } catch (err) {
      alert(`Erro ao conectar: ${err instanceof Error ? err.message : 'desconhecido'}`)
      setBuyingTrades(false)
    }
  }

  const tier = profile?.tier || 'free'
  const tierConfig = TIER_CONFIG[tier]
  const scanLimit = tierConfig.scanLimit + (profile?.scan_credits || 0)
  const scansUsed = scansUsedTotal
  const scansRemaining = Math.max(0, scanLimit - scansUsed)
  const scanPct = scanLimit > 0 ? Math.min(100, Math.round((scansUsed / scanLimit) * 100)) : 0

  const tradeLimit = tierConfig.tradeLimit === Infinity ? Infinity : tierConfig.tradeLimit + (profile?.trade_credits || 0)
  const tradesUsed = tradesUsedTotal
  const tradesRemaining = tradeLimit === Infinity ? Infinity : Math.max(0, tradeLimit - tradesUsed)
  const tradePct = tradeLimit === Infinity ? 0 : tradeLimit > 0 ? Math.min(100, Math.round((tradesUsed / tradeLimit) * 100)) : 0

  const scanPackConfig = SCAN_PACK_CONFIG[tier]
  const tradePackConfig = TRADE_PACK_CONFIG[tier]

  const progressPct = stats.total > 0 ? Math.round((stats.owned / stats.total) * 100) : 0

  return (
    <main className="px-4 pt-6 pb-24">
      <h1 className="text-2xl font-bold mb-6">Perfil</h1>

      {/* User info */}
      <div className="bg-white rounded-xl p-4 shadow-sm mb-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 bg-brand-light rounded-full flex items-center justify-center text-brand text-xl font-bold">
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
              className="bg-brand h-2 rounded-full transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <p className="text-lg font-bold text-green-600">{stats.owned}</p>
            <p className="text-[11px] text-gray-600">Coladas</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-red-500">{stats.missing}</p>
            <p className="text-[11px] text-gray-600">Faltam</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-blue-500">{stats.duplicates}</p>
            <p className="text-[11px] text-gray-600">Repetidas</p>
          </div>
        </div>
      </div>

      {/* Plan & Credits */}
      <div className="bg-white rounded-xl p-4 shadow-sm mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-800">Plano</span>
            <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${
              tier === 'copa_completa' ? 'bg-emerald-100 text-emerald-700' :
              tier === 'colecionador' ? 'bg-gold/20 text-gold-dark' :
              tier === 'estreante' ? 'bg-brand-light text-brand-dark' :
              'bg-gray-100 text-gray-500'
            }`}>
              {tierConfig.label}
            </span>
          </div>
          {tier !== 'copa_completa' && (
            <button
              onClick={() => setShowPaywall(true)}
              className="text-[11px] text-brand font-semibold hover:text-brand-dark transition"
            >
              Fazer upgrade
            </button>
          )}
        </div>

        {/* Scan usage */}
        <div className="mb-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Scans com IA</span>
            <span>{scansUsed}/{scanLimit} usados</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${scanPct >= 90 ? 'bg-red-400' : scanPct >= 70 ? 'bg-yellow-400' : 'bg-brand'}`}
              style={{ width: `${scanPct}%` }}
            />
          </div>
          <p className="text-[11px] text-gray-400 mt-1">
            {scansRemaining} scan{scansRemaining !== 1 ? 's' : ''} restante{scansRemaining !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Buy more scans */}
        {scanPackConfig && (
          <button
            onClick={handleBuyScans}
            disabled={buyingScans}
            className="w-full mb-3 border border-brand/30 text-brand rounded-lg px-4 py-2 text-xs font-semibold hover:bg-brand-light/50 transition disabled:opacity-50"
          >
            {buyingScans ? 'Redirecionando...' : `Comprar +${SCAN_PACK_AMOUNT} scans por ${scanPackConfig.priceDisplay}`}
          </button>
        )}

        {/* Trade usage */}
        <div className="mb-2">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Trocas</span>
            <span>
              {tradeLimit === Infinity
                ? `${tradesUsed} usadas (ilimitado)`
                : `${tradesUsed}/${tradeLimit} usadas`}
            </span>
          </div>
          {tradeLimit !== Infinity && (
            <>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${tradePct >= 90 ? 'bg-red-400' : tradePct >= 70 ? 'bg-yellow-400' : 'bg-gold'}`}
                  style={{ width: `${tradePct}%` }}
                />
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                {tradesRemaining} troca{tradesRemaining !== 1 ? 's' : ''} restante{tradesRemaining !== 1 ? 's' : ''}
              </p>
            </>
          )}
        </div>

        {/* Buy more trades */}
        {tradePackConfig && (
          <button
            onClick={handleBuyTrades}
            disabled={buyingTrades}
            className="w-full border border-gold/30 text-gold-dark rounded-lg px-4 py-2 text-xs font-semibold hover:bg-gold-light/50 transition disabled:opacity-50"
          >
            {buyingTrades ? 'Redirecionando...' : `Comprar +${TRADE_PACK_AMOUNT} trocas por ${tradePackConfig.priceDisplay}`}
          </button>
        )}
      </div>

      {/* Editable fields */}
      <div className="bg-white rounded-xl p-4 shadow-sm mb-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Seu nome"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:border-transparent outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seu@email.com"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:border-transparent outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp / Telefone</label>
          <p className="text-xs text-gray-500 mb-2">Necessário para trocas via WhatsApp</p>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+55 11 99999-9999"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:border-transparent outline-none"
          />
        </div>
        <button
          onClick={savePhone}
          disabled={saving}
          className="w-full bg-brand text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-brand-dark transition disabled:opacity-50"
        >
          {saving ? '...' : saved ? 'Salvo!' : 'Salvar alterações'}
        </button>
      </div>

      {/* WhatsApp Bot */}
      <div className="bg-white rounded-xl shadow-sm mb-4 overflow-hidden">
        <a
          href="https://wa.me/5521966791113?text=oi"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 px-4 py-3.5"
        >
          <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
            <svg aria-hidden="true" className="w-4 h-4 text-emerald-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
              <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 01-4.243-1.214l-.257-.154-2.87.853.853-2.87-.154-.257A8 8 0 1112 20z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-700">Bot no WhatsApp</p>
            <p className="text-[11px] text-gray-500">Use pelo WhatsApp sem abrir o app</p>
          </div>
          <svg aria-hidden="true" className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </a>
        <div className="border-t border-gray-50 px-4 py-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs">📸</span>
              <span className="text-[10px] text-gray-500">Escanear figurinhas</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs">📊</span>
              <span className="text-[10px] text-gray-500">Ver seu status</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs">🔁</span>
              <span className="text-[10px] text-gray-500">Repetidas e faltantes</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs">🤝</span>
              <span className="text-[10px] text-gray-500">Encontrar trocas</span>
            </div>
          </div>
        </div>
      </div>

      {/* Contact */}
      <a
        href="mailto:contato@completeai.com.br"
        className="flex items-center gap-3 w-full bg-white rounded-xl px-4 py-3.5 shadow-sm mb-4"
      >
        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
          <svg aria-hidden="true" className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-700">Fale conosco</p>
          <p className="text-[11px] text-gray-500">contato@completeai.com.br</p>
        </div>
        <svg aria-hidden="true" className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </a>

      {/* Referral / Indique amigos */}
      {profile?.referral_code && (
        <div className="bg-white rounded-xl p-4 shadow-sm mb-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-brand-light flex items-center justify-center">
              <svg className="w-4 h-4 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">Indique amigos</p>
              <p className="text-[11px] text-gray-500">Ganhe créditos de troca e scan</p>
            </div>
          </div>

          {/* Referral link */}
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600 truncate font-mono">
              completeai.com.br/?ref={profile.referral_code}
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`https://completeai.com.br/?ref=${profile.referral_code}`)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
              className="flex-shrink-0 bg-brand-light text-brand rounded-lg px-3 py-2 text-xs font-semibold hover:bg-brand/20 transition"
            >
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
          </div>

          {/* WhatsApp share */}
          <a
            href={`https://wa.me/?text=${encodeURIComponent(
              `Estou usando o Complete Aí para organizar meu álbum da Copa 2026! Escaneia figurinhas com IA e encontra trocas perto de você. Crie sua conta com meu link e a gente ganha créditos: https://completeai.com.br/?ref=${profile.referral_code}`
            )}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full bg-emerald-500 text-white rounded-lg px-4 py-2.5 text-xs font-semibold hover:bg-emerald-600 transition mb-3"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
              <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 01-4.243-1.214l-.257-.154-2.87.853.853-2.87-.154-.257A8 8 0 1112 20z" />
            </svg>
            Compartilhar via WhatsApp
          </a>

          {/* Referral stats */}
          <div className="grid grid-cols-3 gap-2 bg-gray-50 rounded-lg p-3">
            <div className="text-center">
              <p className="text-lg font-bold text-brand">{referralCount}</p>
              <p className="text-[10px] text-gray-500">Indicados</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-gold">{referralRewards.trade_credits}</p>
              <p className="text-[10px] text-gray-500">Trocas ganhas</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-blue-500">{referralRewards.scan_credits}</p>
              <p className="text-[10px] text-gray-500">Scans ganhos</p>
            </div>
          </div>

          {/* How it works */}
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-[11px] font-semibold text-gray-600 mb-1.5">Como funciona:</p>
            <div className="space-y-1">
              <p className="text-[10px] text-gray-500">
                <span className="font-semibold text-brand">+1 troca</span> quando seu amigo cria a conta
              </p>
              <p className="text-[10px] text-gray-500">
                <span className="font-semibold text-brand">+5 trocas +10 scans</span> quando seu amigo faz upgrade
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="w-full bg-red-50 text-red-600 rounded-xl px-4 py-3 text-sm font-medium hover:bg-red-100 transition"
      >
        Sair da Conta
      </button>

      {showPaywall && (
        <PaywallModal feature="upgrade" currentTier={tier} onClose={() => setShowPaywall(false)} />
      )}
    </main>
  )
}
