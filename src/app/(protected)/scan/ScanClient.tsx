'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getFlag } from '@/lib/countries'

type ScanState = 'idle' | 'preview' | 'loading' | 'batch' | 'results' | 'success' | 'error'

type MatchedSticker = {
  sticker_id: number
  number: string
  player_name: string | null
  country: string
  status: string // filled | empty
}

type ScanResponse = {
  matched: MatchedSticker[]
  unmatched: string[]
  warnings: string[]
  confidence: string
}

export default function ScanClient({ userId, totalStickers }: { userId: string; totalStickers: number }) {
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
  const supabase = createClient()

  function compressImage(dataUrl: string, maxWidth = 800): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const ratio = Math.min(maxWidth / img.width, 1)
        canvas.width = img.width * ratio
        canvas.height = img.height * ratio
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.6))
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
        // skip failed image, continue batch
      }
    }

    // Deduplicate by sticker_id, keeping last occurrence
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
      // Pre-check all "filled" stickers
      const initial: Record<number, boolean> = {}
      data.matched.forEach((s: MatchedSticker) => {
        initial[s.sticker_id] = s.status === 'filled'
      })
      setChecked(initial)
      setState('results')
    } catch {
      setErrorMsg('Falha na conexão. Verifique sua internet.')
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
          // Already owned → make duplicate, increment quantity
          await supabase
            .from('user_stickers')
            .update({ status: 'duplicate', quantity: existing.quantity + 1, updated_at: new Date().toISOString() })
            .eq('id', existing.id)
        }
        // If already duplicate or missing, mark as owned
        if (existing.status === 'missing') {
          await supabase
            .from('user_stickers')
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

    // Get updated count
    const { count } = await supabase
      .from('user_stickers')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('status', ['owned', 'duplicate'])

    setSavedCount(toSave.length)
    setOwnedCount(count || 0)
    setSaving(false)
    setState('success')
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
  }

  const progressPct = totalStickers > 0 ? Math.round((ownedCount / totalStickers) * 100) : 0

  // ── IDLE ──
  if (state === 'idle') {
    return (
      <div className="px-4 pt-6">
        <h1 className="text-xl font-black tracking-tight text-gray-900 mb-1">Scan</h1>
        <p className="text-[13px] text-gray-400 mb-4">
          Fotografe ou escolha da galeria para registrar automaticamente.
        </p>

        {/* Camera input (hidden) */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileSelect}
          className="hidden"
          id="camera-input"
        />

        {/* Gallery input (hidden) */}
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileSelect}
          className="hidden"
          id="gallery-input"
        />

        {/* ── Main actions (FIRST) ── */}
        <div className="flex gap-2.5 mb-5">
          <label
            htmlFor="camera-input"
            className="flex-1 flex flex-col items-center gap-2 bg-brand text-white rounded-2xl py-5 px-3 cursor-pointer hover:bg-brand-dark transition active:scale-[0.98] shadow-sm"
          >
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
            </svg>
            <span className="text-sm font-bold">Tirar Foto</span>
          </label>

          <label
            htmlFor="gallery-input"
            className="flex-1 flex flex-col items-center gap-2 bg-white border-2 border-gray-100 text-gray-700 rounded-2xl py-5 px-3 cursor-pointer hover:bg-gray-50 transition active:scale-[0.98]"
          >
            <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
            </svg>
            <span className="text-sm font-bold">Galeria</span>
          </label>
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

        {/* ── Subtle selling banner ── */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100 mb-4">
          <span className="text-sm">✨</span>
          <p className="text-[10px] text-gray-500 flex-1">
            Boa iluminação + números visíveis = scan perfeito. <span className="text-brand font-medium">A IA identifica tudo em segundos.</span>
          </p>
        </div>

        {/* ── Disclaimer + privacy ── */}
        <div className="space-y-1.5">
          <p className="text-[9px] text-gray-300 px-1 leading-relaxed">
            Suas fotos não são armazenadas — descartadas após análise. Fotografe apenas figurinhas, páginas do álbum ou envelopes.
          </p>
        </div>
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
          <button
            onClick={reset}
            className="flex-1 bg-gray-100 text-gray-700 rounded-xl px-4 py-3 text-sm font-medium hover:bg-gray-200 transition"
          >
            Tirar Outra
          </button>
          <button
            onClick={handleAnalyze}
            className="flex-1 bg-brand text-white rounded-xl px-4 py-3 text-sm font-medium hover:bg-brand-dark transition"
          >
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
        <p className="text-sm text-gray-400 mt-2">
          Foto {batchIndex} de {batchTotal}
        </p>
        <div className="mt-6 w-48 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-brand rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-gray-300 mt-3">{pct}%</p>
      </div>
    )
  }

  // ── ERROR ──
  if (state === 'error') {
    const isTimeout = errorMsg.includes('demorou')
    const isQuota = errorMsg.includes('Limite')
    const isQuality = errorMsg.includes('nítida') || errorMsg.includes('qualidade')
    return (
      <div className="px-4 pt-6 flex flex-col items-center justify-center min-h-[60vh]">
        <div className="text-5xl mb-4">{isTimeout ? '⏱️' : isQuota ? '🚫' : isQuality ? '📷' : '😕'}</div>
        <p className="text-lg font-semibold text-gray-700 text-center">{errorMsg}</p>
        <div className="mt-4 bg-gray-50 rounded-xl p-3 max-w-xs">
          <p className="text-[11px] text-gray-500 leading-relaxed text-center">
            {isTimeout && 'Dica: use fotos menores ou com menos figurinhas por vez.'}
            {isQuota && 'Aguarde 1 minuto e tente novamente.'}
            {isQuality && 'Dica: boa iluminação e números bem visíveis ajudam a IA.'}
            {!isTimeout && !isQuota && !isQuality && 'Se o problema persistir, tente outra foto ou entre em contato.'}
          </p>
        </div>
        <button
          onClick={reset}
          className="mt-6 bg-brand text-white rounded-xl px-6 py-3 text-sm font-medium hover:bg-brand-dark transition"
        >
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

        {/* Unmatched stickers (clear error) */}
        {scanResult.unmatched.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-sm">❌</span>
              <p className="text-xs font-semibold text-red-700">
                {scanResult.unmatched.length} não encontrada{scanResult.unmatched.length > 1 ? 's' : ''} no banco
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              {scanResult.unmatched.map((num, i) => (
                <span key={i} className="bg-red-100 text-red-600 rounded px-1.5 py-0.5 text-[10px] font-medium">{num}</span>
              ))}
            </div>
            <p className="text-[10px] text-red-500 mt-1.5">Possível erro de leitura da IA. Verifique os números manualmente.</p>
          </div>
        )}

        {/* Other warnings */}
        {scanResult.warnings.filter(w => !w.includes('não encontrada')).length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-sm">⚠️</span>
              <p className="text-xs font-semibold text-amber-700">Avisos</p>
            </div>
            {scanResult.warnings.filter(w => !w.includes('não encontrada')).map((w, i) => (
              <p key={i} className="text-[11px] text-amber-600 leading-relaxed">{w}</p>
            ))}
          </div>
        )}

        {scanResult.matched.length === 0 ? (
          <div className="text-center text-gray-400 mt-8">
            <p className="text-4xl mb-2">🤷</p>
            <p className="text-sm">Nenhuma figurinha reconhecida. Tente outra foto.</p>
            <button
              onClick={reset}
              className="mt-4 bg-brand text-white rounded-xl px-6 py-3 text-sm font-medium"
            >
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
                    checked[sticker.sticker_id]
                      ? 'bg-green-50 border-green-300'
                      : 'bg-gray-50 border-gray-200 opacity-60'
                  }`}
                >
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                    checked[sticker.sticker_id]
                      ? 'bg-green-500 border-green-500 text-white'
                      : 'border-gray-300'
                  }`}>
                    {checked[sticker.sticker_id] && (
                      <span className="text-xs">✓</span>
                    )}
                  </div>
                  <span className="text-lg">{getFlag(sticker.country)}</span>
                  <div className="text-left flex-1">
                    <p className="text-sm font-semibold">{sticker.number}</p>
                    <p className="text-xs text-gray-500">{sticker.player_name || sticker.country}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    sticker.status === 'filled'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}>
                    {sticker.status === 'filled' ? 'Colada' : 'Vazia'}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex gap-3 sticky bottom-20 bg-gray-50 pt-2 pb-2">
              <button
                onClick={reset}
                className="flex-1 bg-gray-100 text-gray-700 rounded-xl px-4 py-3 text-sm font-medium"
              >
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
          <div
            className="bg-brand h-2.5 rounded-full transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="flex gap-3 mt-8">
          <button
            onClick={reset}
            className="bg-brand text-white rounded-xl px-6 py-3 text-sm font-medium hover:bg-brand-dark transition"
          >
            Escanear Mais
          </button>
          <a
            href="/album"
            className="bg-gray-100 text-gray-700 rounded-xl px-6 py-3 text-sm font-medium hover:bg-gray-200 transition"
          >
            Ver Álbum
          </a>
        </div>
      </div>
    )
  }

  return null
}
