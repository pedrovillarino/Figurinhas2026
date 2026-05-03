'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { TIER_CONFIG, SCAN_PACK_CONFIG, SCAN_PACK_AMOUNTS, SCAN_PACK_AMOUNT, TRADE_PACK_CONFIG, TRADE_PACK_AMOUNTS, TRADE_PACK_AMOUNT, AUDIO_PACK_CONFIG, AUDIO_PACK_AMOUNTS, AUDIO_PACK_AMOUNT, getAudioLimit, isPaid } from '@/lib/tiers'
import type { Tier } from '@/lib/tiers'
import PaywallModal from '@/components/PaywallModal'
import ProfileQRCode from '@/components/ProfileQRCode'

type Profile = {
  display_name: string | null
  email: string | null
  phone: string | null
  avatar_url: string | null
  tier: Tier
  scan_credits: number
  trade_credits: number
  audio_credits: number
  audio_uses_count: number
  referral_code: string | null
  is_minor?: boolean
  // Pedro 2026-05-03: service recovery — banner de cortesia no profile
  courtesy_credits_at: string | null
  courtesy_message: string | null
  courtesy_seen_at: string | null
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

  // Localização (cidade + bairro). Source = how the location was set:
  //  'gps' (granted geolocation), 'manual' (typed below),
  //  'phone' (inferred from DDD), or null.
  const [locCity, setLocCity] = useState('')
  const [locNeighborhood, setLocNeighborhood] = useState('') // not persisted, only for forward-geocoding precision
  const [locSavedCity, setLocSavedCity] = useState<string | null>(null)
  const [locSource, setLocSource] = useState<'gps' | 'manual' | 'phone' | null>(null)
  const [locSaving, setLocSaving] = useState(false)
  const [locMsg, setLocMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [locRequestingGps, setLocRequestingGps] = useState(false)
  const [buyingScans, setBuyingScans] = useState(false)
  const [buyingTrades, setBuyingTrades] = useState(false)
  const [buyingAudios, setBuyingAudios] = useState(false)
  const [showPaywall, setShowPaywall] = useState(false)
  // Pedro 2026-05-03: pacotes avulsos colapsados por padrão pra incentivar
  // upgrade. User clica "Comprar avulso" pra expandir.
  const [showAvulso, setShowAvulso] = useState(false)
  const [scansUsedTotal, setScansUsedTotal] = useState(0)
  const [tradesUsedTotal, setTradesUsedTotal] = useState(0)
  const [stats, setStats] = useState<Stats>({ owned: 0, missing: 0, duplicates: 0, total: 638 })
  const [referralCount, setReferralCount] = useState(0)
  const [referralRewards, setReferralRewards] = useState({ trade_credits: 0, scan_credits: 0 })
  const [copied, setCopied] = useState(false)
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0) // 0=hidden, 1=first confirm, 2=final confirm
  const [deleting, setDeleting] = useState(false)
  const [suggestion, setSuggestion] = useState('')
  const [sendingSuggestion, setSendingSuggestion] = useState(false)
  const [suggestionSent, setSuggestionSent] = useState(false)

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
      .select('display_name, email, phone, avatar_url, tier, scan_credits, trade_credits, audio_credits, audio_uses_count, referral_code, is_minor, city, state, location_lat, courtesy_credits_at, courtesy_message, courtesy_seen_at')
      .eq('id', user.id)
      .single()

    if (data) {
      setProfile({
        ...data,
        tier: (data.tier || 'free') as Tier,
        scan_credits: data.scan_credits || 0,
        trade_credits: data.trade_credits || 0,
        audio_credits: data.audio_credits || 0,
        audio_uses_count: data.audio_uses_count || 0,
        referral_code: data.referral_code || null,
        courtesy_credits_at: data.courtesy_credits_at || null,
        courtesy_message: data.courtesy_message || null,
        courtesy_seen_at: data.courtesy_seen_at || null,
      })
      setPhone(data.phone || '')
      setDisplayName(data.display_name || '')
      setEmail(data.email || user.email || '')
      setLocCity(data.city || '')
      setLocSavedCity(data.city || null)
      // Source heuristic: lat present → GPS or manual forward-geocode;
      // city without lat → DDD inference (the only code path that does that);
      // nothing → never set.
      setLocSource(
        data.location_lat != null ? 'gps' : data.city ? 'phone' : null,
      )
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

    // Only completable stickers move the X/980 progress.
    const { count: totalStickers } = await supabase
      .from('stickers')
      .select('*', { count: 'exact', head: true })
      .eq('counts_for_completion', true)

    const { data: userStickers } = await supabase
      .from('user_stickers')
      .select('status, stickers!inner(counts_for_completion)')
      .eq('user_id', user.id)
      .eq('stickers.counts_for_completion', true)

    const total = totalStickers || 980
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

  async function saveLocation() {
    setLocMsg(null)
    if (!locCity.trim()) {
      setLocMsg({ type: 'err', text: 'Informe pelo menos a cidade.' })
      return
    }
    setLocSaving(true)
    try {
      const res = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city: locCity.trim(),
          neighborhood: locNeighborhood.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setLocMsg({ type: 'err', text: data.error || 'Erro ao salvar localização.' })
      } else {
        setLocSavedCity(data.city)
        setLocSource('manual')
        setLocMsg({
          type: 'ok',
          text: `Salvo! Você aparece nas trocas em ${data.city}${
            locNeighborhood.trim() ? ` / ${locNeighborhood.trim()}` : ''
          }.`,
        })
      }
    } catch {
      setLocMsg({ type: 'err', text: 'Erro de conexão.' })
    }
    setLocSaving(false)
  }

  function requestGps() {
    if (!navigator.geolocation) {
      setLocMsg({ type: 'err', text: 'Seu navegador não suporta GPS.' })
      return
    }
    setLocMsg(null)
    setLocRequestingGps(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        try {
          // Save lat/lng + reverse-geocode in one shot. Use admin route
          // through the service role isn't needed here — the geocode endpoint
          // does the profile update server-side after auth.
          const { data: { user } } = await supabase.auth.getUser()
          if (user) {
            await supabase
              .from('profiles')
              .update({ location_lat: lat, location_lng: lng })
              .eq('id', user.id)
          }
          const res = await fetch('/api/geocode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat, lng }),
          })
          const data = await res.json()
          if (res.ok) {
            setLocCity(data.city || '')
            setLocSavedCity(data.city || null)
            setLocSource('gps')
            setLocMsg({ type: 'ok', text: `Localização capturada: ${data.city}.` })
          } else {
            setLocMsg({ type: 'err', text: data.error || 'Erro ao capturar localização.' })
          }
        } catch {
          setLocMsg({ type: 'err', text: 'Erro ao salvar localização.' })
        }
        setLocRequestingGps(false)
      },
      () => {
        setLocMsg({ type: 'err', text: 'Não conseguimos obter sua localização. Verifique as permissões.' })
        setLocRequestingGps(false)
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
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

  async function handleBuyAudios() {
    setBuyingAudios(true)
    try {
      const res = await fetch('/api/stripe/audio-pack', { method: 'POST' })
      const data = await res.json()
      if (data.url && typeof data.url === 'string' && data.url.startsWith('https://')) {
        window.location.href = data.url
      } else {
        alert(data.error || `Erro ao iniciar compra (url: ${JSON.stringify(data.url)})`)
        setBuyingAudios(false)
      }
    } catch (err) {
      alert(`Erro ao conectar: ${err instanceof Error ? err.message : 'desconhecido'}`)
      setBuyingAudios(false)
    }
  }

  // Pedro 2026-05-03: dismiss banner de cortesia (service recovery).
  // Marca courtesy_seen_at = now() — banner some no próximo render.
  async function dismissCourtesy() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const now = new Date().toISOString()
    await supabase.from('profiles').update({ courtesy_seen_at: now }).eq('id', user.id)
    setProfile((p) => p ? { ...p, courtesy_seen_at: now } : p)
  }

  async function handleDeleteAccount() {
    setDeleting(true)
    try {
      const res = await fetch('/api/account/delete', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        await supabase.auth.signOut()
        router.push('/login')
        router.refresh()
      } else {
        alert(data.error || 'Erro ao excluir conta')
        setDeleting(false)
        setDeleteStep(0)
      }
    } catch {
      alert('Erro ao conectar com o servidor')
      setDeleting(false)
      setDeleteStep(0)
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

  // Pedro 2026-05-03: limite de áudio (lifetime, igual scan/trade)
  const tierAudioLimit = getAudioLimit(tier)
  const audioLimit = tierAudioLimit === Infinity ? Infinity : tierAudioLimit + (profile?.audio_credits || 0)
  const audiosUsed = profile?.audio_uses_count || 0
  const audiosRemaining = audioLimit === Infinity ? Infinity : Math.max(0, audioLimit - audiosUsed)
  const audioPct = audioLimit === Infinity ? 0 : audioLimit > 0 ? Math.min(100, Math.round((audiosUsed / audioLimit) * 100)) : 0

  const scanPackConfig = SCAN_PACK_CONFIG[tier]
  const scanPackAmount = SCAN_PACK_AMOUNTS[tier] || SCAN_PACK_AMOUNT
  const tradePackConfig = TRADE_PACK_CONFIG[tier]
  const tradePackAmount = TRADE_PACK_AMOUNTS[tier] || TRADE_PACK_AMOUNT
  const audioPackConfig = AUDIO_PACK_CONFIG[tier]
  const audioPackAmount = AUDIO_PACK_AMOUNTS[tier] || AUDIO_PACK_AMOUNT

  // Urgência: passou de 70% em qualquer barra → mostrar nudge de upgrade
  const isNearLimit = (scanPct >= 70 && scanLimit !== Infinity)
    || (audioPct >= 70 && audioLimit !== Infinity)
    || (tradePct >= 70 && tradeLimit !== Infinity)

  // Banner de cortesia: aparece se o user recebeu créditos de service
  // recovery e ainda não dismissou. Pedro 2026-05-03.
  const showCourtesyBanner = !!profile?.courtesy_credits_at && !profile?.courtesy_seen_at

  return (
    <main className="px-4 pt-6 pb-24">
      <h1 className="text-2xl font-bold mb-6">Perfil</h1>

      {/* Banner de cortesia (service recovery) — sutil, dismissable */}
      {showCourtesyBanner && (
        <div className="bg-gradient-to-br from-emerald-50 to-brand-light/40 border border-emerald-200 rounded-xl p-4 mb-4 relative">
          <button
            type="button"
            onClick={dismissCourtesy}
            aria-label="Entendi"
            className="absolute top-2 right-2 w-7 h-7 rounded-full hover:bg-emerald-100 flex items-center justify-center text-emerald-700 transition"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="flex items-start gap-3 pr-6">
            <div className="text-2xl">🎁</div>
            <div>
              <p className="text-sm font-bold text-emerald-800">Você recebeu uma cortesia!</p>
              <p className="text-[12px] text-emerald-700 mt-1">
                {profile?.courtesy_message || 'Pelo trampo, te dei créditos extras.'}
              </p>
              <p className="text-[11px] text-emerald-600 mt-2">
                ➕ <strong>1 scan IA</strong> e <strong>1 áudio</strong> de cortesia, já incluídos no seu saldo.
              </p>
            </div>
          </div>
        </div>
      )}

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

        {/* Pedro 2026-05-03 (Fix H): se phone está vazio, CTA pra conectar
            WhatsApp. Texto pré-formatado pelo wa.me — bot identifica
            automaticamente pelo email na 1ª mensagem. */}
        {!profile?.phone && profile?.email && (
          <a
            href={`https://wa.me/5521966791113?text=${encodeURIComponent(
              `oi sou ${profile.display_name || 'novo usuário'} (email: ${profile.email})`
            )}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full bg-emerald-500 text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-emerald-600 transition mb-3 active:scale-[0.98]"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
              <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 01-4.243-1.214l-.257-.154-2.87.853.853-2.87-.154-.257A8 8 0 1112 20z" />
            </svg>
            Conectar WhatsApp em 1 clique
          </a>
        )}

        {/* Quick stats — compact, since full progress is in /album and /dashboard */}
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>✅ {stats.owned} coladas</span>
          <span>·</span>
          <span>🔁 {stats.duplicates} repetidas</span>
          <span>·</span>
          <span>❌ {stats.missing} faltam</span>
        </div>
      </div>

      {/* ─── Plano & Quotas (redesign Pedro 2026-05-03) ─────────────────
          Estratégia: incentivar upgrade > pacotes avulsos.
          • Hero CTA grande "Fazer upgrade" no topo (free/estreante/colec)
          • 3 barras de quota (scan + áudio + troca)
          • Pacotes avulsos colapsados (clica pra expandir)
          • Banner de urgência se algum quota >= 70%
      */}
      <div className="bg-white rounded-xl p-4 shadow-sm mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-800">Seu plano</span>
            <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${
              tier === 'copa_completa' ? 'bg-emerald-100 text-emerald-700' :
              tier === 'colecionador' ? 'bg-gold/20 text-gold-dark' :
              tier === 'estreante' ? 'bg-brand-light text-brand-dark' :
              'bg-gray-100 text-gray-500'
            }`}>
              {tierConfig.label}
            </span>
          </div>
        </div>

        {/* Hero CTA — só aparece se não for copa_completa */}
        {tier !== 'copa_completa' && (
          <div className={`rounded-xl border p-4 mb-4 transition-all ${
            isNearLimit
              ? 'bg-gradient-to-br from-amber-50 to-yellow-100 border-amber-300'
              : 'bg-gradient-to-br from-brand-light/40 to-emerald-50 border-brand/20'
          }`}>
            {isNearLimit ? (
              <div className="flex items-start gap-2 mb-3">
                <div className="text-2xl">🚨</div>
                <div>
                  <p className="text-sm font-bold text-amber-800">Você está perto do limite</p>
                  <p className="text-[11px] text-amber-700">Upgrade evita interrupção e libera mais valor.</p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 mb-3">
                <div className="text-2xl">🚀</div>
                <div>
                  <p className="text-sm font-bold text-gray-800">Faz mais com seu álbum</p>
                  <p className="text-[11px] text-gray-600">Mais scans, áudios e trocas — desbloqueia recursos.</p>
                </div>
              </div>
            )}

            {/* Mini-comparativo dos planos disponíveis */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
              {tier === 'free' && (
                <div className="bg-white rounded-lg border border-gray-200 p-2.5 text-center">
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Estreante</p>
                  <p className="text-lg font-bold text-brand mt-0.5">R$9,90</p>
                  <p className="text-[10px] text-gray-500">/mês</p>
                  <p className="text-[10px] text-gray-700 mt-1.5 leading-tight">30 scans · 30 áudios · 5 trocas</p>
                </div>
              )}
              {(tier === 'free' || tier === 'estreante') && (
                <div className="bg-white rounded-lg border-2 border-gold/60 p-2.5 text-center relative shadow-sm">
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-gold text-[8px] font-bold text-white px-1.5 py-0.5 rounded-full whitespace-nowrap">⭐ MAIS POPULAR</span>
                  <p className="text-[10px] font-bold text-gold-dark uppercase tracking-wide mt-1">Colecionador</p>
                  <p className="text-lg font-bold text-gold-dark mt-0.5">R$19,90</p>
                  <p className="text-[10px] text-gray-500">/mês</p>
                  <p className="text-[10px] text-gray-700 mt-1.5 leading-tight">150 scans · áudio ∞ · 15 trocas</p>
                </div>
              )}
              <div className="bg-white rounded-lg border border-gray-200 p-2.5 text-center">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Copa Completa</p>
                <p className="text-lg font-bold text-emerald-600 mt-0.5">R$29,90</p>
                <p className="text-[10px] text-gray-500">/mês</p>
                <p className="text-[10px] text-gray-700 mt-1.5 leading-tight">500 scans · tudo ilimitado</p>
              </div>
            </div>

            <button
              onClick={() => setShowPaywall(true)}
              className="w-full bg-brand text-white rounded-lg px-4 py-2.5 text-sm font-bold hover:bg-brand-dark transition active:scale-[0.98]"
            >
              Fazer upgrade →
            </button>
          </div>
        )}

        {/* Quotas: 3 barras (scan, áudio, troca) */}
        <div className="space-y-3 mb-3">
          {/* Scan */}
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span className="flex items-center gap-1">📸 Scans com IA</span>
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

          {/* Áudio (NOVO Pedro 2026-05-03) */}
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span className="flex items-center gap-1">🎤 Áudios pelo WhatsApp</span>
              <span>
                {audioLimit === Infinity
                  ? `${audiosUsed} usados (ilimitado)`
                  : `${audiosUsed}/${audioLimit} usados`}
              </span>
            </div>
            {audioLimit !== Infinity && (
              <>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${audioPct >= 90 ? 'bg-red-400' : audioPct >= 70 ? 'bg-yellow-400' : 'bg-blue-500'}`}
                    style={{ width: `${audioPct}%` }}
                  />
                </div>
                <p className="text-[11px] text-gray-400 mt-1">
                  {audiosRemaining} áudio{audiosRemaining !== 1 ? 's' : ''} restante{audiosRemaining !== 1 ? 's' : ''}
                </p>
              </>
            )}
            {/* Pedro 2026-05-03: link sutil pra áudio (só se ainda tem saldo) */}
            {(audiosRemaining === Infinity || audiosRemaining > 0) && (
              <a
                href={`https://wa.me/5521966791113?text=${encodeURIComponent('oi quero registrar por áudio')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-1 text-[11px] text-blue-600 hover:text-blue-800 transition"
              >
                🎤 Como usar áudio →
              </a>
            )}
          </div>

          {/* Trocas */}
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span className="flex items-center gap-1">🔁 Trocas</span>
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
        </div>

        {/* Pacotes avulsos — colapsado por padrão pra incentivar upgrade */}
        {(scanPackConfig || tradePackConfig || audioPackConfig) && (
          <div className="border-t border-gray-100 pt-3 mt-3">
            <button
              type="button"
              onClick={() => setShowAvulso((v) => !v)}
              className="flex items-center justify-between w-full text-xs text-gray-500 hover:text-gray-700 transition"
            >
              <span>🛒 Comprar pacote avulso</span>
              <span className={`text-gray-400 transition-transform ${showAvulso ? 'rotate-180' : ''}`}>▾</span>
            </button>
            {showAvulso && (
              <div className="mt-3 space-y-2">
                <p className="text-[10px] text-gray-500 italic mb-2">
                  💡 Pacote é por unidade. Plano mensal = mais valor por real.
                </p>
                {scanPackConfig && (
                  <button
                    onClick={handleBuyScans}
                    disabled={buyingScans}
                    className="w-full border border-brand/20 text-brand rounded-lg px-3 py-2 text-xs font-medium hover:bg-brand-light/40 transition disabled:opacity-50 flex items-center justify-between"
                  >
                    <span>📸 +{scanPackAmount} scans</span>
                    <span className="font-bold">{buyingScans ? '...' : scanPackConfig.priceDisplay}</span>
                  </button>
                )}
                {audioPackConfig && (
                  <button
                    onClick={handleBuyAudios}
                    disabled={buyingAudios}
                    className="w-full border border-blue-200 text-blue-600 rounded-lg px-3 py-2 text-xs font-medium hover:bg-blue-50 transition disabled:opacity-50 flex items-center justify-between"
                  >
                    <span>🎤 +{audioPackAmount} áudios</span>
                    <span className="font-bold">{buyingAudios ? '...' : audioPackConfig.priceDisplay}</span>
                  </button>
                )}
                {tradePackConfig && (
                  <button
                    onClick={handleBuyTrades}
                    disabled={buyingTrades}
                    className="w-full border border-gold/20 text-gold-dark rounded-lg px-3 py-2 text-xs font-medium hover:bg-gold-light/40 transition disabled:opacity-50 flex items-center justify-between"
                  >
                    <span>🔁 +{tradePackAmount} trocas</span>
                    <span className="font-bold">{buyingTrades ? '...' : tradePackConfig.priceDisplay}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

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
              www.completeai.com.br/?ref={profile.referral_code}
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`https://www.completeai.com.br/?ref=${profile.referral_code}`)
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
              `Estou usando o Complete Aí para organizar meu álbum de figurinhas! Escaneia figurinhas com IA e encontra trocas perto de você. Crie sua conta com meu link e a gente ganha créditos: https://www.completeai.com.br/?ref=${profile.referral_code}`
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

          {/* QR Code */}
          <div className="mb-3">
            <ProfileQRCode referralCode={profile.referral_code!} />
          </div>

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

      {/* Localização — pra aparecer nas trocas perto */}
      <div className="bg-white rounded-xl p-4 shadow-sm mb-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-brand-light flex items-center justify-center">
            <svg className="w-4 h-4 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">Localização</p>
            <p className="text-[11px] text-gray-500">Pra você aparecer nas trocas perto</p>
          </div>
        </div>

        {locSavedCity && (
          <div className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 mb-3 text-xs">
            <p className="text-gray-500">
              Você aparece como <span className="font-semibold text-gray-800">{locSavedCity}</span>
              {locSource === 'gps' && <span className="ml-1.5 text-[10px] text-emerald-600 font-semibold">📍 GPS</span>}
              {locSource === 'manual' && <span className="ml-1.5 text-[10px] text-brand font-semibold">✏️ Manual</span>}
              {locSource === 'phone' && <span className="ml-1.5 text-[10px] text-amber-600 font-semibold">📱 Pelo DDD</span>}
            </p>
            {locSource === 'phone' && (
              <p className="text-[10px] text-gray-400 mt-1">
                Detectado pelo DDD do seu telefone. Confirme ou ajuste abaixo pra precisar nas trocas.
              </p>
            )}
          </div>
        )}

        <div className="space-y-2">
          <input
            type="text"
            value={locCity}
            onChange={(e) => { setLocCity(e.target.value); setLocMsg(null) }}
            placeholder="Cidade (ex: São Paulo)"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:border-transparent outline-none"
          />
          <input
            type="text"
            value={locNeighborhood}
            onChange={(e) => { setLocNeighborhood(e.target.value); setLocMsg(null) }}
            placeholder="Bairro (opcional, mais preciso)"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:border-transparent outline-none"
          />
        </div>

        {locMsg && (
          <p className={`text-[11px] mt-2 ${locMsg.type === 'ok' ? 'text-emerald-600' : 'text-red-500'}`}>
            {locMsg.text}
          </p>
        )}

        <div className="flex gap-2 mt-3">
          <button
            onClick={saveLocation}
            disabled={locSaving || !locCity.trim()}
            className="flex-1 bg-brand text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-brand-dark transition disabled:opacity-50"
          >
            {locSaving ? '...' : 'Salvar localização'}
          </button>
          <button
            onClick={requestGps}
            disabled={locRequestingGps}
            className="bg-gray-50 border border-gray-200 text-gray-700 rounded-lg px-3 py-2 text-xs font-medium hover:bg-gray-100 transition disabled:opacity-50"
            title="Usar GPS (mais preciso)"
          >
            {locRequestingGps ? '...' : '📍 GPS'}
          </button>
        </div>
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

      {/* FAQ & Contact */}
      <div className="bg-white rounded-xl shadow-sm mb-4 overflow-hidden">
        <Link
          href="/faq"
          className="flex items-center gap-3 px-4 py-3.5"
        >
          <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
            <svg aria-hidden="true" className="w-4 h-4 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-700">Perguntas frequentes</p>
            <p className="text-[11px] text-gray-500">Planos, scanner, trocas e mais</p>
          </div>
          <svg aria-hidden="true" className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </Link>
        <div className="border-t border-gray-100" />
        <a
          href="mailto:contato@completeai.com.br"
          className="flex items-center gap-3 px-4 py-3.5"
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
      </div>

      {/* Suggestion Box */}
      <div className="bg-white rounded-xl shadow-sm mb-4 p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-yellow-50 flex items-center justify-center">
            <span className="text-sm">💡</span>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700">Sugestões</p>
            <p className="text-[11px] text-gray-500">Ideias, bugs ou feedback</p>
          </div>
        </div>
        {suggestionSent ? (
          <p className="text-xs text-emerald-600 font-medium py-2">
            Obrigado pelo feedback! Vamos analisar com carinho.
          </p>
        ) : (
          <>
            <textarea
              value={suggestion}
              onChange={(e) => setSuggestion(e.target.value)}
              placeholder="Conte sua ideia, reporte um bug ou mande um feedback..."
              rows={3}
              maxLength={1000}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-brand focus:border-transparent outline-none mb-2"
            />
            <button
              onClick={async () => {
                if (!suggestion.trim()) return
                setSendingSuggestion(true)
                try {
                  const res = await fetch('/api/suggestion', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: suggestion }),
                  })
                  if (res.ok) {
                    setSuggestionSent(true)
                    setSuggestion('')
                  } else {
                    alert('Erro ao enviar. Tente novamente.')
                  }
                } catch {
                  alert('Erro de conexão')
                }
                setSendingSuggestion(false)
              }}
              disabled={sendingSuggestion || !suggestion.trim()}
              className="w-full bg-gray-900 text-white rounded-lg px-4 py-2 text-xs font-semibold hover:bg-gray-800 transition disabled:opacity-50"
            >
              {sendingSuggestion ? 'Enviando...' : 'Enviar sugestão'}
            </button>
          </>
        )}
      </div>

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="w-full bg-red-50 text-red-600 rounded-xl px-4 py-3 text-sm font-medium hover:bg-red-100 transition mb-4"
      >
        Sair da Conta
      </button>

      {/* Delete Account */}
      <button
        onClick={() => setDeleteStep(1)}
        className="w-full text-gray-400 text-xs py-2 hover:text-red-500 transition"
      >
        Excluir minha conta
      </button>

      {/* Delete Account Modal — Step 1 */}
      {deleteStep >= 1 && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            {deleteStep === 1 && (
              <>
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-gray-900 text-center mb-2">Excluir conta?</h3>
                <p className="text-sm text-gray-600 text-center mb-6">
                  Todos os seus dados serão apagados permanentemente e <strong>não podem ser recuperados</strong>. Isso inclui suas figurinhas, trocas, créditos e histórico.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setDeleteStep(0)}
                    className="flex-1 bg-gray-100 text-gray-700 rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-gray-200 transition"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => setDeleteStep(2)}
                    className="flex-1 bg-red-500 text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-red-600 transition"
                  >
                    Continuar
                  </button>
                </div>
              </>
            )}
            {deleteStep === 2 && (
              <>
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-red-600 text-center mb-2">Última confirmação</h3>
                {isPaid(tier) && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                    <p className="text-xs text-yellow-800">
                      <strong>Atenção:</strong> Se passados 7 dias da compra do plano, o valor <strong>não será devolvido</strong>. Para solicitar reembolso dentro do prazo, entre em contato antes de excluir.
                    </p>
                  </div>
                )}
                <p className="text-sm text-gray-600 text-center mb-4">
                  Esta ação é <strong>irreversível</strong>. Conforme a LGPD, todos os seus dados pessoais serão removidos dos nossos sistemas.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setDeleteStep(0)}
                    className="flex-1 bg-gray-100 text-gray-700 rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-gray-200 transition"
                  >
                    Voltar
                  </button>
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deleting}
                    className="flex-1 bg-red-600 text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-red-700 transition disabled:opacity-50"
                  >
                    {deleting ? 'Excluindo...' : 'Excluir definitivamente'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showPaywall && (
        <PaywallModal feature="upgrade" currentTier={tier} onClose={() => setShowPaywall(false)} isMinor={profile?.is_minor === true} />
      )}
    </main>
  )
}
