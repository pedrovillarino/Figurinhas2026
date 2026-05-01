'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getFlag } from '@/lib/countries'
import { SCAN_PACK_CONFIG, SCAN_PACK_AMOUNTS, SCAN_PACK_AMOUNT, type Tier } from '@/lib/tiers'
import PaywallModal from '@/components/PaywallModal'

type ScanState = 'idle' | 'preview' | 'loading' | 'batch' | 'results' | 'success' | 'error'

type MatchedSticker = {
  sticker_id: number
  number: string
  player_name: string | null
  country: string
  status: string
  confidence: number
  quantity: number
}

type ScanResponse = {
  matched: MatchedSticker[]
  unmatched: string[]
  warnings: string[]
  confidence: string
  /** PK of the scan_results row created by /api/scan, used by handleSave to
   *  PATCH back the user's confirmation count for accuracy tracking. */
  scanResultId?: number | null
  scanUsage?: { remaining: number; limit: number }
  needsUpgrade?: boolean
  needsPack?: boolean
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
  const [scansRemaining, setScansRemaining] = useState<number | null>(null)
  const [scansLimit, setScansLimit] = useState<number>(200)
  const [needsUpgrade, setNeedsUpgrade] = useState(false)
  const [needsPack, setNeedsPack] = useState(false)
  const [buyingPack, setBuyingPack] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  function requireScan(action: () => void) {
    // All tiers can scan now (free gets 5 scans)
    // Limit is enforced server-side
    action()
  }

  function compressImage(dataUrl: string, maxWidth = 2048): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const ratio = Math.min(maxWidth / img.width, 1)
        canvas.width = img.width * ratio
        canvas.height = img.height * ratio
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        // Quality 0.85 — high enough to read small sticker numbers
        resolve(canvas.toDataURL('image/jpeg', 0.85))
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
    let processedCount = 0
    let hitLimit = false

    for (let i = 0; i < files.length; i++) {
      setBatchIndex(i + 1)

      // Small delay between calls to avoid API rate limits (skip first)
      if (i > 0) await new Promise(r => setTimeout(r, 800))

      let success = false
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const dataUrl = await readFile(files[i])
          const compressed = await compressImage(dataUrl)
          const base64 = compressed.split(',')[1]

          const res = await fetch('/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64, mimeType: 'image/jpeg' }),
          })

          const data = await res.json()

          if (res.ok) {
            const scanData = data as ScanResponse
            accumulated.push(...scanData.matched)
            accWarnings.push(...scanData.warnings)
            processedCount++
            success = true

            // Update scan usage from response
            if (scanData.scanUsage) {
              setScansRemaining(scanData.scanUsage.remaining)
              setScansLimit(scanData.scanUsage.limit || 200)
            }
            break
          } else if (res.status === 429 && (data.needsUpgrade || data.needsPack)) {
            // Scan limit hit mid-batch — stop and show what we have
            hitLimit = true
            if (data.scanUsage) {
              setScansRemaining(0)
              setScansLimit(data.scanUsage.limit || 200)
            }
            setNeedsUpgrade(!!data.needsUpgrade)
            setNeedsPack(!!data.needsPack)

            const remaining = files.length - i
            accWarnings.push(`Limite de scans atingido — ${remaining} foto${remaining !== 1 ? 's' : ''} não processada${remaining !== 1 ? 's' : ''}`)
            break
          } else if (attempt === 0 && (res.status === 429 || res.status >= 500)) {
            // Transient error — retry once after a short wait
            await new Promise(r => setTimeout(r, 1500))
            continue
          } else {
            accWarnings.push(`Foto ${i + 1}: ${data.error || 'Não foi possível analisar — tente uma foto com mais luz'}`)
            success = true // Don't retry non-transient errors
            break
          }
        } catch {
          if (attempt === 0) {
            // Network or timeout — retry once
            await new Promise(r => setTimeout(r, 1500))
            continue
          }
          // Generic — could be offline, server timeout, or aborted request.
          // Don't pretend it's certainly the user's wifi.
          accWarnings.push(`Foto ${i + 1}: Análise não terminou. Tente foto com menos cromos ou aguarde e mande de novo.`)
        }
      }

      if (hitLimit) break
    }

    // If no stickers found at all and we hit a limit, go to error screen
    if (accumulated.length === 0 && hitLimit) {
      setErrorMsg('Limite de scans atingido antes de processar suas fotos.')
      setState('error')
      return
    }

    // Deduplicate by sticker_id, summing quantities across images
    const dedupMap = new Map<number, MatchedSticker>()
    for (const s of accumulated) {
      const existing = dedupMap.get(s.sticker_id)
      if (existing) {
        existing.quantity = (existing.quantity || 1) + (s.quantity || 1)
      } else {
        dedupMap.set(s.sticker_id, { ...s, quantity: s.quantity || 1 })
      }
    }
    const deduped = Array.from(dedupMap.values())

    const result: ScanResponse = { matched: deduped, unmatched: [], warnings: accWarnings, confidence: 'high' }
    setScanResult(result)
    const initial: Record<number, boolean> = {}
    deduped.forEach((s) => { initial[s.sticker_id] = s.status === 'filled' && s.confidence >= 0.6 })
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
        setErrorMsg(data.error || 'Não foi possível analisar a foto. Tente novamente com uma imagem mais nítida.')
        if (data.scanUsage) {
          setScansRemaining(0)
          setScansLimit(data.scanUsage.limit || 200)
        }
        setNeedsUpgrade(!!data.needsUpgrade)
        setNeedsPack(!!data.needsPack)
        setState('error')
        return
      }

      if (data.scanUsage) {
        setScansRemaining(data.scanUsage.remaining)
        setScansLimit(data.scanUsage.limit || 200)
      }

      setScanResult(data)
      const initial: Record<number, boolean> = {}
      data.matched.forEach((s: MatchedSticker) => {
        // Auto-check only stickers with good confidence; low confidence = unchecked by default
        initial[s.sticker_id] = s.status === 'filled' && s.confidence >= 0.6
      })
      setChecked(initial)
      setState('results')
    } catch {
      // Pode ser offline, timeout do server, ou request abortado.
      // Não afirma que é certamente a internet do user.
      setErrorMsg('Análise não terminou — pode ter demorado demais. Tente foto com menos cromos por vez ou aguarde e tente de novo.')
      setState('error')
    }
  }

  function toggleCheck(stickerId: number) {
    setChecked((prev) => ({ ...prev, [stickerId]: !prev[stickerId] }))
  }

  const selectedCount = scanResult
    ? scanResult.matched.filter((s) => checked[s.sticker_id]).reduce((sum, s) => sum + (s.quantity || 1), 0)
    : 0

  async function handleSave() {
    if (!scanResult) return
    setSaving(true)

    const toSave = scanResult.matched.filter((s) => checked[s.sticker_id])
    let saveErrors = 0

    try {
      for (const sticker of toSave) {
        const qty = sticker.quantity || 1

        const { data: existing, error: fetchErr } = await supabase
          .from('user_stickers')
          .select('id, status, quantity')
          .eq('user_id', userId)
          .eq('sticker_id', sticker.sticker_id)
          .single()

        if (fetchErr && fetchErr.code !== 'PGRST116') {
          // PGRST116 = "not found" which is expected for new stickers
          console.error('[save] Fetch error:', fetchErr.message)
          saveErrors++
          continue
        }

        let saveErr = null

        if (existing) {
          if (existing.status === 'owned') {
            const { error } = await supabase.from('user_stickers')
              .update({ status: 'duplicate', quantity: (existing.quantity ?? 1) + qty, updated_at: new Date().toISOString() })
              .eq('id', existing.id)
            saveErr = error
          } else if (existing.status === 'duplicate') {
            const { error } = await supabase.from('user_stickers')
              .update({ quantity: (existing.quantity ?? 1) + qty, updated_at: new Date().toISOString() })
              .eq('id', existing.id)
            saveErr = error
          } else if (existing.status === 'missing') {
            const { error } = await supabase.from('user_stickers')
              .update({ status: qty > 1 ? 'duplicate' : 'owned', quantity: qty, updated_at: new Date().toISOString() })
              .eq('id', existing.id)
            saveErr = error
          }
        } else {
          const { error } = await supabase.from('user_stickers').insert({
            user_id: userId,
            sticker_id: sticker.sticker_id,
            status: qty > 1 ? 'duplicate' : 'owned',
            quantity: qty,
          })
          saveErr = error
        }

        if (saveErr) {
          console.error('[save] Write error:', saveErr.message)
          saveErrors++
        }
      }

      const { count } = await supabase
        .from('user_stickers')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('status', ['owned', 'duplicate'])

      const totalQty = toSave.reduce((sum, s) => sum + (s.quantity || 1), 0)
      setSavedCount(totalQty - saveErrors)
      setOwnedCount(count || 0)

      if (saveErrors > 0 && saveErrors === toSave.length) {
        setErrorMsg('Não foi possível salvar as figurinhas. Verifique sua conexão e tente novamente.')
        setState('error')
      } else if (saveErrors > 0) {
        setErrorMsg(`${saveErrors} figurinha(s) não puderam ser salvas. As demais foram registradas.`)
        setState('success')
      } else {
        setState('success')
      }

      // Notify nearby users about new duplicates (fire & forget)
      const savedIds = toSave.filter((_, i) => i < toSave.length - saveErrors).map((s) => s.sticker_id)
      if (savedIds.length > 0) {
        fetch('/api/notify-matches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId, sticker_ids: savedIds }),
        }).catch(() => {})
      }

      // Track Gemini accuracy: tell the server which stickers the user kept vs
      // unchecked. Best-effort, never blocks the success UI.
      if (scanResult.scanResultId) {
        const rejectedIds = scanResult.matched
          .filter((s) => !checked[s.sticker_id])
          .map((s) => s.sticker_id)
        fetch(`/api/scan/${scanResult.scanResultId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            confirmed_count: toSave.length,
            rejected_sticker_ids: rejectedIds,
          }),
        }).catch(() => {})
      }
    } catch (err) {
      console.error('[save] Unexpected error:', err)
      setErrorMsg('Erro ao salvar. Verifique sua conexão e tente novamente.')
      setState('error')
    } finally {
      setSaving(false)
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

  async function handleBuyPack() {
    setBuyingPack(true)
    try {
      const res = await fetch('/api/stripe/scan-pack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        alert(data.error || 'Erro ao iniciar compra')
      }
    } catch {
      alert('Erro ao conectar com o servidor')
    }
    setBuyingPack(false)
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
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-black tracking-tight text-gray-900">Scanner IA</h1>
          {scansRemaining !== null && (
            <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 rounded-full px-2.5 py-1">
              {scansRemaining} scans restantes
            </span>
          )}
        </div>
        <div className="flex items-center justify-between mb-6">
          <p className="text-xs text-gray-500">Cada foto detecta várias figurinhas de uma vez</p>
          <Link
            href="/historico"
            className="text-[11px] font-semibold text-brand hover:text-brand-dark transition flex items-center gap-1 shrink-0"
          >
            📜 Histórico
          </Link>
        </div>

        {/* Hidden inputs */}
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileSelect} className="hidden" aria-label="Tirar foto com câmera" />
        <input ref={galleryInputRef} type="file" accept="image/*" multiple onChange={handleFileSelect} className="hidden" aria-label="Escolher foto da galeria" />

        {/* ── Main actions (FIRST) ── */}
        <div className="flex gap-2.5 mb-5">
          <button
            onClick={triggerCamera}
            className="flex-1 flex flex-col items-center gap-2 bg-brand text-white rounded-2xl py-5 px-3 cursor-pointer hover:bg-brand-dark transition active:scale-[0.98] shadow-sm"
          >
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
            </svg>
            <span className="text-sm font-bold">Tirar Foto</span>
          </button>

          <button
            onClick={triggerGallery}
            className="flex-1 flex flex-col items-center gap-2 bg-white border-2 border-gray-100 text-gray-700 rounded-2xl py-5 px-3 cursor-pointer hover:bg-gray-50 transition active:scale-[0.98]"
          >
            <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
            </svg>
            <span className="text-sm font-bold">Galeria</span>
          </button>
        </div>

        {/* ── What you can scan ── */}
        <div className="mb-5">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">O que posso escanear</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white border border-gray-100 rounded-xl p-2.5 text-center">
              <div className="text-2xl mb-1">📖</div>
              <p className="text-[10px] font-semibold text-gray-700">Página</p>
              <p className="text-[9px] text-gray-400">do álbum aberto</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-xl p-2.5 text-center">
              <div className="text-2xl mb-1">⚽</div>
              <p className="text-[10px] font-semibold text-gray-700">Figurinha</p>
              <p className="text-[9px] text-gray-400">solta na mão</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-xl p-2.5 text-center">
              <div className="text-2xl mb-1">🃏</div>
              <p className="text-[10px] font-semibold text-gray-700">Várias</p>
              <p className="text-[9px] text-gray-400">espalhadas na mesa</p>
            </div>
          </div>
        </div>

        {/* ── WhatsApp CTA ── */}
        <a
          href="https://wa.me/5521966791113?text=oi"
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 p-4 mb-4 active:scale-[0.98] transition-transform shadow-sm"
        >
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 01-4.243-1.214l-.257-.154-2.87.853.853-2.87-.154-.257A8 8 0 1112 20z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-white leading-tight">Escaneie pelo WhatsApp</p>
              <p className="text-[11px] text-emerald-100 mt-0.5">Mande uma foto das figurinhas e a IA registra pra você — sem abrir o app!</p>
            </div>
            <svg className="w-5 h-5 text-white/70 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </div>
        </a>

        {/* ── Instruções de uso ── */}
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 mb-3 space-y-2">
          <p className="text-[11px] font-bold text-amber-900 uppercase tracking-wider">📸 Pra acertar o scan</p>
          <ul className="text-xs text-gray-700 leading-relaxed space-y-1.5">
            <li>• <span className="font-bold text-red-700">NITIDEZ é essencial</span> — o nome do jogador (frente) ou o número (verso) precisam estar <span className="font-semibold">claramente legíveis</span>. Foto borrada, com sombra ou reflexo = scan erra.</li>
            <li>• Recomendado: <span className="font-semibold">até 10 cromos por foto</span>. Pode mandar mais, mas a assertividade cai bastante.</li>
            <li>• A partir de <span className="font-semibold">5 cromos por foto</span>, prefira <span className="font-semibold">todos virados de frente</span> (foto/nome do jogador) — verso em foto cheia fica ilegível.</li>
            <li>• Boa luz, foco no centro, sem brilho. Cromos amassados atrapalham.</li>
          </ul>
        </div>

        {/* ── Disclaimer + privacy ── */}
        <p className="text-[11px] text-gray-400 px-1 leading-relaxed">
          Suas fotos são descartadas imediatamente após a análise. Fotografe apenas figurinhas ou páginas do álbum.
        </p>

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
          <button onClick={handleAnalyze} className="flex-1 bg-brand text-white rounded-xl px-4 py-3 text-sm font-medium hover:bg-brand-dark transition">
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
          <div className="h-full bg-brand rounded-full animate-pulse" style={{ width: '70%' }} />
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
          <div className="h-full bg-brand rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-gray-500 mt-3">{pct}%</p>
      </div>
    )
  }

  // ── ERROR ──
  if (state === 'error') {
    const isScanLimit = needsUpgrade || needsPack
    const isRateLimit = !isScanLimit && (errorMsg.includes('Muitos scans') || errorMsg.includes('minutinho') || errorMsg.includes('ocupados'))
    const isTimeout = errorMsg.includes('demorou') || errorMsg.includes('iluminação')
    const isNetwork = errorMsg.includes('internet') || errorMsg.includes('Wi-Fi') || errorMsg.includes('conexão')
    const isUnavailable = errorMsg.includes('indisponível') || errorMsg.includes('manutenção') || errorMsg.includes('instável')
    const emoji = isScanLimit ? '📊' : isRateLimit ? '⏳' : isTimeout ? '📷' : isNetwork ? '📶' : isUnavailable ? '🔧' : '😕'

    const hint = isScanLimit
      ? 'Fotografe várias figurinhas juntas para aproveitar melhor cada scan!'
      : isTimeout
      ? 'Dica: use boa iluminação e enquadre bem as figurinhas na foto.'
      : isNetwork
      ? 'Verifique se está conectado ao Wi-Fi ou com dados móveis ativos.'
      : isRateLimit
      ? 'Aguarde alguns instantes e tente novamente.'
      : isUnavailable
      ? 'Nosso serviço está passando por manutenção. Tente em alguns minutos.'
      : 'Tente com uma foto mais nítida e com boa iluminação.'

    return (
      <div className="px-4 pt-6 flex flex-col items-center justify-center min-h-[60vh]">
        <div className="text-5xl mb-4">{emoji}</div>
        <p className="text-base font-semibold text-gray-700 text-center leading-relaxed max-w-xs">{errorMsg}</p>
        <p className="text-xs text-gray-400 mt-3 text-center max-w-xs">
          {hint}
        </p>

        {needsUpgrade ? (
          <button
            onClick={() => setShowPaywall(true)}
            className="mt-6 bg-brand text-white rounded-xl px-6 py-3 text-sm font-medium hover:bg-brand-dark transition"
          >
            Desbloquear Scanner
          </button>
        ) : needsPack ? (
          <>
            <button
              onClick={handleBuyPack}
              disabled={buyingPack}
              className="mt-6 bg-gold text-navy rounded-xl px-6 py-3 text-sm font-bold hover:bg-gold/90 transition disabled:opacity-50"
            >
              {buyingPack ? 'Redirecionando...' : `Comprar +${SCAN_PACK_AMOUNTS[tier] || SCAN_PACK_AMOUNT} scans por ${SCAN_PACK_CONFIG[tier]?.priceDisplay || 'R$10,00'}`}
            </button>
            <button
              onClick={() => setShowPaywall(true)}
              className="mt-2 text-xs text-brand font-semibold hover:text-brand-dark transition"
            >
              Ou fazer upgrade do plano
            </button>
          </>
        ) : (
          <button onClick={reset} className="mt-6 bg-brand text-white rounded-xl px-6 py-3 text-sm font-medium hover:bg-brand-dark transition">
            {isRateLimit || isUnavailable ? 'Tentar de Novo' : 'Tirar Outra Foto'}
          </button>
        )}

        <a href="/album" className="mt-3 text-sm text-brand font-medium hover:underline">
          Marcar manualmente no álbum →
        </a>
      </div>
    )
  }

  // ── RESULTS ──
  if (state === 'results' && scanResult) {
    return (
      <div className="px-4 pt-6">
        <h1 className="text-2xl font-bold mb-1">Figurinhas Detectadas</h1>
        <div className="flex items-center justify-between mb-2">
          <p className="text-gray-500 text-sm">
            {scanResult.matched.length} encontrada(s). Desmarque as incorretas.
          </p>
          {scansRemaining !== null && (
            <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
              {scansRemaining} scans restantes
            </span>
          )}
        </div>
        <p className="text-[11px] text-gray-500 mb-3">
          O <span className="font-semibold text-emerald-600">✓ %</span> é a confiança da IA na leitura — quanto maior, mais certeza.
          Figurinhas com confiança baixa ficam <strong>desmarcadas</strong> por padrão.
          {scanResult.matched.some((s) => (s.quantity || 1) > 1) && (
            <> O badge <span className="font-bold text-amber-600">xN</span> indica cópias repetidas detectadas.</>
          )}
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
            <button onClick={reset} className="mt-4 bg-brand text-white rounded-xl px-6 py-3 text-sm font-medium">
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
                  <div className="text-left flex-1 min-w-0">
                    <p className="text-sm font-semibold">
                      {sticker.number}
                      {(sticker.quantity || 1) > 1 && (
                        <span className="ml-1.5 text-xs font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">x{sticker.quantity}</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{sticker.player_name || sticker.country}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                      sticker.confidence >= 0.85
                        ? 'bg-emerald-100 text-emerald-700'
                        : sticker.confidence >= 0.6
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-red-100 text-red-700'
                    }`}>
                      {sticker.confidence >= 0.85 ? '✓' : sticker.confidence >= 0.6 ? '~' : '?'} {Math.round(sticker.confidence * 100)}%
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      sticker.status === 'filled' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {sticker.status === 'filled' ? 'Colada' : 'Vazia'}
                    </span>
                  </div>
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
                className="flex-1 bg-brand text-white rounded-xl px-4 py-3 text-sm font-medium hover:bg-brand-dark transition disabled:opacity-50"
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
          <div className="bg-brand h-2.5 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="flex gap-3 mt-8">
          <button onClick={reset} className="bg-brand text-white rounded-xl px-6 py-3 text-sm font-medium hover:bg-brand-dark transition">
            Escanear Mais
          </button>
          <a href="/album" className="bg-gray-100 text-gray-700 rounded-xl px-6 py-3 text-sm font-medium hover:bg-gray-200 transition">
            Ver Album
          </a>
        </div>

        {/* WhatsApp hint */}
        <a
          href="https://wa.me/5521966791113?text=oi"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 mt-6 px-3 py-2 rounded-lg bg-emerald-50/60 border border-emerald-100"
        >
          <svg className="w-4 h-4 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
            <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 01-4.243-1.214l-.257-.154-2.87.853.853-2.87-.154-.257A8 8 0 1112 20z" />
          </svg>
          <p className="text-[10px] text-emerald-700">
            Sabia que pode escanear pelo <span className="font-semibold">WhatsApp</span> tambem? Mande uma foto!
          </p>
        </a>
      </div>
    )
  }

  return null
}
