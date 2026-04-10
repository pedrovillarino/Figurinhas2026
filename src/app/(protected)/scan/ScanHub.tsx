'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getFlag } from '@/lib/countries'
import { canScan, type Tier } from '@/lib/tiers'
import PaywallModal from '@/components/PaywallModal'

type ScanState = 'idle' | 'preview' | 'loading' | 'batch' | 'results' | 'success' | 'error'

type MatchedSticker = {
  sticker_id: number
  number: string
  player_name: string | null
  country: string
  status: string
}

type ScanResponse = {
  matched: MatchedSticker[]
  unmatched: string[]
  warnings: string[]
  confidence: string
}

export default function ScanHub({
  userId,
  totalStickers,
  tier,
}: {
  userId: string
  totalStickers: number
  tier: Tier
}) {
  const hasScan = canScan(tier)
  const [showPaywall, setShowPaywall] = useState(false)
  const [state, setState] = useState<ScanState>('idle')
  const [imageData, setImageData] = useState<string | null>(null)
  const [mimeType, setMimeType] = useState<string>('image/jpeg')
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null)
  const [checked, setChecked] = useState<Record<number, boolean>>({})
  const [errorMsg, setErrorMsg] = useState('')
  const [savedCount, setSavedCount] = useState(0)
  const [ownedCount, setOwnedCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [batchIndex, setBatchIndex] = useState(0)
  const [batchTotal, setBatchTotal] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  function requireScan(action: () => void) {
    if (hasScan) {
      action()
    } else {
      setShowPaywall(true)
    }
  }

  function compressImage(dataUrl: string, maxWidth = 1200): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const ratio = Math.min(maxWidth / img.width, 1)
        canvas.width = img.width * ratio
        canvas.height = img.height * ratio
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.7))
      }
      img.src = dataUrl
    })
  }

  function readFile(file: File): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsDataURL(file)
    })
  }

  async function handleBatchFiles(files: File[]) {
    setBatchTotal(files.length)
    setBatchIndex(0)
    setState('batch')

    const accumulated: MatchedSticker[] = []
    const accWarnings: string[] = []

    for (let i = 0; i < files.length; i++) {
      setBatchIndex(i + 1)
      try {
        const dataUrl = await readFile(files[i])
        const compressed = await compressImage(dataUrl)
        const base64 = compressed.split(',')[1]

        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64, mimeType: 'image/jpeg' }),
        })

        if (res.ok) {
          const data: ScanResponse = await res.json()
          accumulated.push(...data.matched)
          accWarnings.push(...data.warnings)
        }
      } catch {
        // skip failed
      }
    }

    const deduped = accumulated.filter(
      (s, idx, arr) => arr.findLastIndex((x) => x.sticker_id === s.sticker_id) === idx
    )

    const result: ScanResponse = { matched: deduped, unmatched: [], warnings: accWarnings, confidence: 'high' }
    setScanResult(result)
    const initial: Record<number, boolean> = {}
    deduped.forEach((s) => { initial[s.sticker_id] = s.status === 'filled' })
    setChecked(initial)
    setState('results')
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    if (files.length > 1) {
      handleBatchFiles(files)
      return
    }

    const reader = new FileReader()
    reader.onload = async () => {
      const result = reader.result as string
      const compressed = await compressImage(result)
      setMimeType('image/jpeg')
      setImageData(compressed)
      setState('preview')
    }
    reader.readAsDataURL(files[0])
  }

  async function handleAnalyze() {
    if (!imageData) return
    setState('loading')

    try {
      const base64 = imageData.split(',')[1]
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mimeType }),
      })
      const data = await res.json()

      if (!res.ok) {
        setErrorMsg(data.error || 'Erro ao processar scan')
        setState('error')
        return
      }

      setScanResult(data)
      const initial: Record<number, boolean> = {}
      data.matched.forEach((s: MatchedSticker) => { initial[s.sticker_id] = s.status === 'filled' })
      setChecked(initial)
      setState('results')
    } catch {
      setErrorMsg('Falha na conexao. Verifique sua internet.')
      setState('error')
    }
  }

  function toggleCheck(stickerId: number) {
    setChecked((prev) => ({ ...prev, [stickerId]: !prev[stickerId] }))
  }

  const selectedCount = Object.values(checked).filter(Boolean).length

  async function handleSave() {
    if (!scanResult) return
    setSaving(true)

    const toSave = scanResult.matched.filter((s) => checked[s.sticker_id])

    for (const sticker of toSave) {
      const { data: existing } = await supabase
        .from('user_stickers')
        .select('id, status, quantity')
        .eq('user_id', userId)
        .eq('sticker_id', sticker.sticker_id)
        .single()

      if (existing) {
        if (existing.status === 'owned') {
          await supabase.from('user_stickers')
            .update({ status: 'duplicate', quantity: existing.quantity + 1, updated_at: new Date().toISOString() })
            .eq('id', existing.id)
        }
        if (existing.status === 'missing') {
          await supabase.from('user_stickers')
            .update({ status: 'owned', quantity: 1, updated_at: new Date().toISOString() })
            .eq('id', existing.id)
        }
      } else {
        await supabase.from('user_stickers').insert({
          user_id: userId,
          sticker_id: sticker.sticker_id,
          status: 'owned',
          quantity: 1,
        })
      }
    }

    const { count } = await supabase
      .from('user_stickers')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('status', ['owned', 'duplicate'])

    setSavedCount(toSave.length)
    setOwnedCount(count || 0)
    setSaving(false)
    setState('success')

    // Notify nearby users about new duplicates (fire & forget)
    const savedIds = toSave.map((s) => s.sticker_id)
    if (savedIds.length > 0) {
      fetch('/api/notify-matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, sticker_ids: savedIds }),
      }).catch(() => {})
    }
  }

  function reset() {
    setState('idle')
    setImageData(null)
    setScanResult(null)
    setChecked({})
    setErrorMsg('')
    setBatchIndex(0)
    setBatchTotal(0)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (galleryInputRef.current) galleryInputRef.current.value = ''
  }

  function triggerCamera() {
    requireScan(() => fileInputRef.current?.click())
  }

  function triggerGallery() {
    requireScan(() => galleryInputRef.current?.click())
  }

  const progressPct = totalStickers > 0 ? Math.round((ownedCount / totalStickers) * 100) : 0

  // ── IDLE ──
  if (state === 'idle') {
    return (
      <div className="px-4 pt-6 pb-28">
        <h1 className="text-2xl font-black tracking-tight text-gray-900 mb-1">Scanner IA</h1>
        <p className="text-xs text-gray-500 mb-6">Fotografe suas figurinhas e registre automaticamente</p>

        {/* Hidden inputs */}
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileSelect} className="hidden" aria-label="Tirar foto com câmera" />
        <input ref={galleryInputRef} type="file" accept="image/*" multiple onChange={handleFileSelect} className="hidden" aria-label="Escolher foto da galeria" />

        {/* Hero demo */}
        <div className="bg-gradient-to-br from-violet-500 to-indigo-600 rounded-2xl p-5 mb-5 shadow-lg">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center">
              <span className="text-4xl">📸</span>
            </div>
            <div>
              <p className="text-lg font-black text-white">Escanear e pronto!</p>
              <p className="text-xs text-violet-200">A IA identifica cada figurinha automaticamente</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white/15 rounded-xl p-3 text-center backdrop-blur-sm">
              <p className="text-xl font-black text-white">1s</p>
              <p className="text-[9px] text-violet-200">por figurinha</p>
            </div>
            <div className="bg-white/15 rounded-xl p-3 text-center backdrop-blur-sm">
              <p className="text-xl font-black text-white">99%</p>
              <p className="text-[9px] text-violet-200">precisão</p>
            </div>
            <div className="bg-white/15 rounded-xl p-3 text-center backdrop-blur-sm">
              <p className="text-xl font-black text-white">50+</p>
              <p className="text-[9px] text-violet-200">por foto</p>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="space-y-3 mb-6">
          <button
            onClick={triggerCamera}
            className="group flex items-center gap-4 w-full bg-white border border-gray-100 rounded-2xl p-4 hover:bg-gray-50 transition active:scale-[0.98]"
          >
            <div className="w-12 h-12 rounded-xl bg-violet-50 flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
              </svg>
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm font-semibold text-gray-800">Tirar Foto</p>
              <p className="text-[11px] text-gray-500 mt-0.5">Pagina do album, figurinha individual ou varias juntas</p>
            </div>
            {!hasScan && (
              <span className="text-[9px] bg-violet-100 text-violet-600 rounded-full px-2 py-1 font-bold shrink-0">PLUS</span>
            )}
          </button>

          <button
            onClick={triggerGallery}
            className="group flex items-center gap-4 w-full bg-white border border-gray-100 rounded-2xl p-4 hover:bg-gray-50 transition active:scale-[0.98]"
          >
            <div className="w-12 h-12 rounded-xl bg-cyan-50 flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-cyan-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
              </svg>
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm font-semibold text-gray-800">Escolher da Galeria</p>
              <p className="text-[11px] text-gray-500 mt-0.5">Selecione uma ou varias fotos de uma vez</p>
            </div>
            {!hasScan && (
              <span className="text-[9px] bg-violet-100 text-violet-600 rounded-full px-2 py-1 font-bold shrink-0">PLUS</span>
            )}
          </button>
        </div>

        {/* What you can scan */}
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-3">O que posso escanear</p>
        <div className="grid grid-cols-3 gap-2 mb-6">
          <div className="bg-white border border-gray-100 rounded-xl p-3 text-center">
            <div className="text-2xl mb-1.5">📖</div>
            <p className="text-[10px] font-medium text-gray-600">Pagina inteira</p>
            <p className="text-[10px] text-gray-500">do album</p>
          </div>
          <div className="bg-white border border-gray-100 rounded-xl p-3 text-center">
            <div className="text-2xl mb-1.5">🃏</div>
            <p className="text-[10px] font-medium text-gray-600">Uma figurinha</p>
            <p className="text-[10px] text-gray-500">individual</p>
          </div>
          <div className="bg-white border border-gray-100 rounded-xl p-3 text-center">
            <div className="text-2xl mb-1.5">🎴</div>
            <p className="text-[10px] font-medium text-gray-600">Varias juntas</p>
            <p className="text-[10px] text-gray-500">na mesa</p>
          </div>
        </div>

        {/* How it works */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Como funciona</h2>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-violet-50 flex items-center justify-center shrink-0">
                <span className="text-[10px] font-black text-violet-500">1</span>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-800">Tire uma foto</p>
                <p className="text-[10px] text-gray-500">da pagina do album ou das figurinhas soltas</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-violet-50 flex items-center justify-center shrink-0">
                <span className="text-[10px] font-black text-violet-500">2</span>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-800">IA identifica tudo</p>
                <p className="text-[10px] text-gray-500">Reconhece números, jogadores e seleções automaticamente</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-violet-50 flex items-center justify-center shrink-0">
                <span className="text-[10px] font-black text-violet-500">3</span>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-800">Confirme e salve</p>
                <p className="text-[10px] text-gray-500">Revise o resultado e salve no seu album com um toque</p>
              </div>
            </div>
          </div>
        </div>

        {/* Comparison: manual vs scan */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Manual vs Scanner IA</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-2">Manual</p>
              <p className="text-2xl font-black text-gray-400">~30min</p>
              <p className="text-[9px] text-gray-400 mt-1">para registrar 50 figurinhas</p>
            </div>
            <div className="bg-violet-50 rounded-xl p-3 text-center border border-violet-100">
              <p className="text-[10px] font-semibold text-violet-500 uppercase mb-2">Scanner IA</p>
              <p className="text-2xl font-black text-violet-600">~30s</p>
              <p className="text-[10px] text-violet-500 mt-1">para registrar 50 figurinhas</p>
            </div>
          </div>
          <p className="text-[10px] text-gray-500 text-center mt-2">60x mais rápido que marcar uma por uma</p>
        </div>

        {/* Tips */}
        <div className="flex items-start gap-2.5 px-1">
          <svg className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
          </svg>
          <p className="text-[11px] text-gray-500 leading-relaxed">
            Boa iluminação e números visíveis garantem melhor resultado.
          </p>
        </div>

        {/* Upgrade CTA for non-plus */}
        {!hasScan && (
          <div className="mt-6 bg-white rounded-2xl border-2 border-violet-200 p-4">
            <div className="text-center mb-2">
              <span className="text-2xl">⚡</span>
            </div>
            <h3 className="text-sm font-bold text-gray-900 text-center mb-1">Desbloqueie o Scanner IA</h3>
            <p className="text-[10px] text-gray-500 text-center mb-3">
              Pare de marcar figurinha por figurinha. Escaneie e pronto!
            </p>
            <button
              onClick={() => setShowPaywall(true)}
              className="w-full bg-violet-600 text-white rounded-xl py-3 text-sm font-bold hover:bg-violet-700 transition active:scale-[0.98]"
            >
              Desbloquear por R$9,90
            </button>
            <p className="text-[10px] text-gray-500 text-center mt-2">Pagamento unico. Sem assinatura.</p>
          </div>
        )}

        {/* Paywall Modal */}
        {showPaywall && (
          <PaywallModal feature="scan" currentTier={tier} onClose={() => setShowPaywall(false)} />
        )}
      </div>
    )
  }

  // ── PREVIEW ──
  if (state === 'preview') {
    return (
      <div className="px-4 pt-6">
        <h1 className="text-2xl font-bold mb-4">Confirmar Foto</h1>
        <div className="rounded-xl overflow-hidden border border-gray-200 mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageData!} alt="Preview" className="w-full" />
        </div>
        <div className="flex gap-3">
          <button onClick={reset} className="flex-1 bg-gray-100 text-gray-700 rounded-xl px-4 py-3 text-sm font-medium hover:bg-gray-200 transition">
            Tirar Outra
          </button>
          <button onClick={handleAnalyze} className="flex-1 bg-violet-600 text-white rounded-xl px-4 py-3 text-sm font-medium hover:bg-violet-700 transition">
            Analisar
          </button>
        </div>
      </div>
    )
  }

  // ── LOADING ──
  if (state === 'loading') {
    return (
      <div className="px-4 pt-6 flex flex-col items-center justify-center min-h-[60vh]">
        <div className="text-5xl mb-4 animate-bounce">📸</div>
        <p className="text-lg font-semibold text-gray-700">Analisando suas figurinhas...</p>
        <p className="text-sm text-gray-400 mt-2">Isso pode levar alguns segundos</p>
        <div className="mt-6 w-48 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-violet-600 rounded-full animate-pulse" style={{ width: '70%' }} />
        </div>
      </div>
    )
  }

  // ── BATCH ──
  if (state === 'batch') {
    const pct = batchTotal > 0 ? Math.round((batchIndex / batchTotal) * 100) : 0
    return (
      <div className="px-4 pt-6 flex flex-col items-center justify-center min-h-[60vh]">
        <div className="text-5xl mb-4 animate-bounce">🎴</div>
        <p className="text-lg font-semibold text-gray-700">Analisando fotos...</p>
        <p className="text-sm text-gray-400 mt-2">Foto {batchIndex} de {batchTotal}</p>
        <div className="mt-6 w-48 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-violet-600 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-gray-500 mt-3">{pct}%</p>
      </div>
    )
  }

  // ── ERROR ──
  if (state === 'error') {
    return (
      <div className="px-4 pt-6 flex flex-col items-center justify-center min-h-[60vh]">
        <div className="text-5xl mb-4">😕</div>
        <p className="text-lg font-semibold text-gray-700 text-center">{errorMsg}</p>
        <button onClick={reset} className="mt-6 bg-violet-600 text-white rounded-xl px-6 py-3 text-sm font-medium hover:bg-violet-700 transition">
          Tentar Novamente
        </button>
      </div>
    )
  }

  // ── RESULTS ──
  if (state === 'results' && scanResult) {
    return (
      <div className="px-4 pt-6">
        <h1 className="text-2xl font-bold mb-1">Figurinhas Detectadas</h1>
        <p className="text-gray-500 text-sm mb-4">
          {scanResult.matched.length} encontrada(s). Desmarque as incorretas.
        </p>

        {scanResult.warnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
            {scanResult.warnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-700">{w}</p>
            ))}
          </div>
        )}

        {scanResult.matched.length === 0 ? (
          <div className="text-center text-gray-400 mt-8">
            <p className="text-4xl mb-2">🤷</p>
            <p className="text-sm">Nenhuma figurinha reconhecida. Tente outra foto.</p>
            <button onClick={reset} className="mt-4 bg-violet-600 text-white rounded-xl px-6 py-3 text-sm font-medium">
              Tentar Novamente
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-2 mb-4 max-h-[50vh] overflow-y-auto">
              {scanResult.matched.map((sticker) => (
                <button
                  key={sticker.sticker_id}
                  onClick={() => toggleCheck(sticker.sticker_id)}
                  className={`w-full flex items-center gap-3 rounded-lg border p-3 transition ${
                    checked[sticker.sticker_id] ? 'bg-green-50 border-green-300' : 'bg-gray-50 border-gray-200 opacity-60'
                  }`}
                >
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                    checked[sticker.sticker_id] ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300'
                  }`}>
                    {checked[sticker.sticker_id] && <span className="text-xs">✓</span>}
                  </div>
                  <span className="text-lg">{getFlag(sticker.country)}</span>
                  <div className="text-left flex-1">
                    <p className="text-sm font-semibold">{sticker.number}</p>
                    <p className="text-xs text-gray-500">{sticker.player_name || sticker.country}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    sticker.status === 'filled' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {sticker.status === 'filled' ? 'Colada' : 'Vazia'}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex gap-3 sticky bottom-20 bg-gray-50 pt-2 pb-2">
              <button onClick={reset} className="flex-1 bg-gray-100 text-gray-700 rounded-xl px-4 py-3 text-sm font-medium">
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={selectedCount === 0 || saving}
                className="flex-1 bg-violet-600 text-white rounded-xl px-4 py-3 text-sm font-medium hover:bg-violet-700 transition disabled:opacity-50"
              >
                {saving ? 'Salvando...' : `Salvar ${selectedCount} figurinha${selectedCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  // ── SUCCESS ──
  if (state === 'success') {
    return (
      <div className="px-4 pt-6 flex flex-col items-center justify-center min-h-[60vh]">
        <div className="text-5xl mb-4">✅</div>
        <p className="text-xl font-bold text-gray-800">
          {savedCount} nova{savedCount !== 1 ? 's' : ''} figurinha{savedCount !== 1 ? 's' : ''} registrada{savedCount !== 1 ? 's' : ''}!
        </p>
        <p className="text-gray-500 mt-2">
          Coleção: {ownedCount}/{totalStickers} ({progressPct}%)
        </p>
        <div className="w-48 bg-gray-200 rounded-full h-2.5 mt-3">
          <div className="bg-violet-600 h-2.5 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="flex gap-3 mt-8">
          <button onClick={reset} className="bg-violet-600 text-white rounded-xl px-6 py-3 text-sm font-medium hover:bg-violet-700 transition">
            Escanear Mais
          </button>
          <a href="/album" className="bg-gray-100 text-gray-700 rounded-xl px-6 py-3 text-sm font-medium hover:bg-gray-200 transition">
            Ver Album
          </a>
        </div>
      </div>
    )
  }

  return null
}
