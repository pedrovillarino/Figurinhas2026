'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

type ImportMode = 'coladas' | 'faltantes'
type InputMethod = null | 'camera' | 'text'
type Step = 'choose-mode' | 'choose-input' | 'text-input' | 'preview-image' | 'loading' | 'results' | 'saving' | 'success' | 'error'

type MatchedSticker = {
  sticker_id: number
  number: string
  player_name: string | null
  country: string
}

export default function ImportListModal({
  isOpen,
  onClose,
  userId,
  onImportComplete,
}: {
  isOpen: boolean
  onClose: () => void
  userId: string
  onImportComplete: (updates: Record<number, { status: string; quantity: number }>) => void
}) {
  const [step, setStep] = useState<Step>('choose-mode')
  const [mode, setMode] = useState<ImportMode>('coladas')
  const [inputMethod, setInputMethod] = useState<InputMethod>(null)
  const [textInput, setTextInput] = useState('')
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageBase64, setImageBase64] = useState<string | null>(null)
  const [imageMimeType, setImageMimeType] = useState<string | null>(null)
  const [matched, setMatched] = useState<MatchedSticker[]>([])
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [errorMessage, setErrorMessage] = useState('')
  const [savedCount, setSavedCount] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  if (!isOpen) return null

  function reset() {
    setStep('choose-mode')
    setMode('coladas')
    setInputMethod(null)
    setTextInput('')
    setImagePreview(null)
    setImageBase64(null)
    setImageMimeType(null)
    setMatched([])
    setUnmatched([])
    setWarnings([])
    setTotal(0)
    setSelected(new Set())
    setErrorMessage('')
    setSavedCount(0)
  }

  function handleClose() {
    reset()
    onClose()
  }

  function handleModeSelect(m: ImportMode) {
    setMode(m)
    setStep('choose-input')
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setImagePreview(dataUrl)
      // Extract base64 and mime
      const base64 = dataUrl.split(',')[1]
      setImageBase64(base64)
      setImageMimeType(file.type)
      setStep('preview-image')
    }
    reader.readAsDataURL(file)
  }

  async function analyzeImage() {
    if (!imageBase64 || !imageMimeType) return
    setStep('loading')

    try {
      const res = await fetch('/api/import-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageBase64, mimeType: imageMimeType }),
      })

      const data = await res.json()
      if (!res.ok) {
        setErrorMessage(data.error || 'Erro ao processar imagem.')
        setStep('error')
        return
      }

      handleApiResult(data)
    } catch {
      setErrorMessage('Erro de conexão. Tente novamente.')
      setStep('error')
    }
  }

  async function analyzeText() {
    if (!textInput.trim()) return
    setStep('loading')

    try {
      const res = await fetch('/api/import-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textInput }),
      })

      const data = await res.json()
      if (!res.ok) {
        setErrorMessage(data.error || 'Erro ao processar texto.')
        setStep('error')
        return
      }

      handleApiResult(data)
    } catch {
      setErrorMessage('Erro de conexão. Tente novamente.')
      setStep('error')
    }
  }

  function handleApiResult(data: { matched: MatchedSticker[]; unmatched: string[]; warnings: string[]; total: number }) {
    setMatched(data.matched)
    setUnmatched(data.unmatched)
    setWarnings(data.warnings || [])
    setTotal(data.total)
    // Select all matched by default
    setSelected(new Set(data.matched.map((m) => m.sticker_id)))
    setStep('results')
  }

  function toggleSticker(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === matched.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(matched.map((m) => m.sticker_id)))
    }
  }

  async function saveStickers() {
    if (selected.size === 0) return
    setStep('saving')

    try {
      const selectedStickers = matched.filter((m) => selected.has(m.sticker_id))
      const updates: Record<number, { status: string; quantity: number }> = {}

      if (mode === 'coladas') {
        // Mark selected as owned
        const upserts = selectedStickers.map((s) => ({
          user_id: userId,
          sticker_id: s.sticker_id,
          status: 'owned',
          quantity: 1,
        }))

        // Batch upsert
        const { error } = await supabase
          .from('user_stickers')
          .upsert(upserts, { onConflict: 'user_id,sticker_id' })

        if (error) {
          setErrorMessage('Erro ao salvar figurinhas. Tente novamente.')
          setStep('error')
          return
        }

        selectedStickers.forEach((s) => {
          updates[s.sticker_id] = { status: 'owned', quantity: 1 }
        })
      } else {
        // Mode: faltantes - mark everything NOT in the list as owned
        // Actually, "faltantes" means the user is telling us which ones they're MISSING.
        // So we mark the selected ones as missing (status: 'missing', qty: 0)
        const upserts = selectedStickers.map((s) => ({
          user_id: userId,
          sticker_id: s.sticker_id,
          status: 'missing',
          quantity: 0,
        }))

        const { error } = await supabase
          .from('user_stickers')
          .upsert(upserts, { onConflict: 'user_id,sticker_id' })

        if (error) {
          setErrorMessage('Erro ao salvar figurinhas. Tente novamente.')
          setStep('error')
          return
        }

        selectedStickers.forEach((s) => {
          updates[s.sticker_id] = { status: 'missing', quantity: 0 }
        })
      }

      setSavedCount(selectedStickers.length)
      onImportComplete(updates)
      setStep('success')
    } catch {
      setErrorMessage('Erro ao salvar. Tente novamente.')
      setStep('error')
    }
  }

  // Group matched by country for display
  const groupedMatched = matched.reduce<Record<string, MatchedSticker[]>>((acc, m) => {
    if (!acc[m.country]) acc[m.country] = []
    acc[m.country].push(m)
    return acc
  }, {})

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-white rounded-t-3xl shadow-2xl animate-slide-up max-h-[90vh] flex flex-col">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>

        <div className="px-5 pb-8 overflow-y-auto flex-1">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              {step !== 'choose-mode' && step !== 'success' && (
                <button
                  onClick={() => {
                    if (step === 'choose-input') setStep('choose-mode')
                    else if (step === 'text-input' || step === 'preview-image') setStep('choose-input')
                    else if (step === 'results') {
                      if (inputMethod === 'text') setStep('text-input')
                      else setStep('choose-input')
                    }
                    else if (step === 'error') setStep('choose-input')
                  }}
                  className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center"
                  aria-label="Voltar"
                >
                  <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                  </svg>
                </button>
              )}
              <h2 className="text-lg font-bold text-gray-900">
                {step === 'choose-mode' && 'Importar Lista'}
                {step === 'choose-input' && (mode === 'coladas' ? 'Importar Coladas' : 'Importar Faltantes')}
                {step === 'text-input' && 'Cole sua lista'}
                {step === 'preview-image' && 'Confirmar foto'}
                {step === 'loading' && 'Analisando...'}
                {step === 'results' && 'Resultado'}
                {step === 'saving' && 'Salvando...'}
                {step === 'success' && 'Pronto!'}
                {step === 'error' && 'Ops!'}
              </h2>
            </div>
            <button
              onClick={handleClose}
              className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center"
              aria-label="Fechar"
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* ── STEP: Choose Mode ── */}
          {step === 'choose-mode' && (
            <div>
              <p className="text-sm text-gray-500 mb-4">O que sua lista contém?</p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => handleModeSelect('coladas')}
                  className="flex items-center gap-4 p-4 rounded-2xl border-2 border-gray-100 hover:border-emerald-300 hover:bg-emerald-50/50 transition-all active:scale-[0.98]"
                >
                  <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                    <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-bold text-gray-800">Figurinhas coladas</p>
                    <p className="text-xs text-gray-500 mt-0.5">Lista das que já tenho no álbum</p>
                  </div>
                </button>
                <button
                  onClick={() => handleModeSelect('faltantes')}
                  className="flex items-center gap-4 p-4 rounded-2xl border-2 border-gray-100 hover:border-orange-300 hover:bg-orange-50/50 transition-all active:scale-[0.98]"
                >
                  <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0">
                    <svg className="w-6 h-6 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-bold text-gray-800">Figurinhas faltantes</p>
                    <p className="text-xs text-gray-500 mt-0.5">Lista das que ainda preciso</p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: Choose Input ── */}
          {step === 'choose-input' && (
            <div>
              <p className="text-sm text-gray-500 mb-4">Como você quer importar?</p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex items-center gap-4 p-4 rounded-2xl border-2 border-gray-100 hover:border-violet-300 hover:bg-violet-50/50 transition-all active:scale-[0.98]"
                >
                  <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
                    <svg className="w-6 h-6 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-bold text-gray-800">Tirar foto da lista</p>
                    <p className="text-xs text-gray-500 mt-0.5">Use a câmera para fotografar sua lista escrita</p>
                  </div>
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-4 p-4 rounded-2xl border-2 border-gray-100 hover:border-blue-300 hover:bg-blue-50/50 transition-all active:scale-[0.98]"
                >
                  <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-bold text-gray-800">Escolher da galeria</p>
                    <p className="text-xs text-gray-500 mt-0.5">Selecione uma foto ou screenshot existente</p>
                  </div>
                </button>
                <button
                  onClick={() => {
                    setInputMethod('text')
                    setStep('text-input')
                  }}
                  className="flex items-center gap-4 p-4 rounded-2xl border-2 border-gray-100 hover:border-amber-300 hover:bg-amber-50/50 transition-all active:scale-[0.98]"
                >
                  <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                    <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-bold text-gray-800">Digitar ou colar</p>
                    <p className="text-xs text-gray-500 mt-0.5">Cole ou digite os números das figurinhas</p>
                  </div>
                </button>
              </div>

              {/* Hidden file inputs */}
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  setInputMethod('camera')
                  handleFileChange(e)
                }}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  setInputMethod('camera')
                  handleFileChange(e)
                }}
              />
            </div>
          )}

          {/* ── STEP: Text Input ── */}
          {step === 'text-input' && (
            <div>
              <p className="text-xs text-gray-500 mb-3">
                Formatos aceitos: <span className="font-medium text-gray-600">BRA-1, BRA-2</span> ou <span className="font-medium text-gray-600">1, 2, 3</span> ou agrupado por país
              </p>
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={`Exemplo:\nBRA: 1, 3, 5, 12\nARG: 2, 7, 14\nFWC-1, FWC-3\n\nou simplesmente:\nBRA-1, BRA-3, ARG-2`}
                className="w-full h-40 bg-gray-50 rounded-xl border border-gray-200 p-3 text-sm text-gray-700 placeholder-gray-400 focus:ring-2 focus:ring-violet-500/30 focus:border-violet-200 outline-none transition resize-none"
                autoFocus
              />
              <div className="flex items-center justify-between mt-3">
                <p className="text-[10px] text-gray-400">
                  {textInput.trim() ? `${textInput.split(/[,\n;|]/).filter(Boolean).length} itens detectados` : 'Cole sua lista acima'}
                </p>
                <button
                  onClick={analyzeText}
                  disabled={!textInput.trim()}
                  className="px-6 py-2.5 bg-violet-500 hover:bg-violet-600 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-xl font-semibold text-sm transition active:scale-[0.98]"
                >
                  Analisar
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: Preview Image ── */}
          {step === 'preview-image' && imagePreview && (
            <div>
              <div className="rounded-xl overflow-hidden border border-gray-200 mb-4">
                <img src={imagePreview} alt="Preview da lista" className="w-full max-h-60 object-contain bg-gray-50" />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setImagePreview(null)
                    setImageBase64(null)
                    setImageMimeType(null)
                    setStep('choose-input')
                  }}
                  className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-semibold text-sm transition active:scale-[0.98]"
                >
                  Outra foto
                </button>
                <button
                  onClick={analyzeImage}
                  className="flex-1 py-2.5 bg-violet-500 hover:bg-violet-600 text-white rounded-xl font-semibold text-sm transition active:scale-[0.98]"
                >
                  Analisar lista
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: Loading ── */}
          {step === 'loading' && (
            <div className="text-center py-12">
              <div className="w-12 h-12 border-4 border-gray-200 border-t-violet-500 rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm font-semibold text-gray-700">Lendo sua lista...</p>
              <p className="text-xs text-gray-500 mt-1">Identificando figurinhas e cruzando com o banco</p>
            </div>
          )}

          {/* ── STEP: Results ── */}
          {step === 'results' && (
            <div>
              {/* Summary bar */}
              <div className="flex gap-2 mb-4">
                <div className="flex-1 bg-emerald-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-emerald-700">{matched.length}</p>
                  <p className="text-[10px] text-emerald-600">Encontradas</p>
                </div>
                <div className="flex-1 bg-orange-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-orange-600">{unmatched.length}</p>
                  <p className="text-[10px] text-orange-500">Não encontradas</p>
                </div>
                <div className="flex-1 bg-violet-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-violet-600">{selected.size}</p>
                  <p className="text-[10px] text-violet-500">Selecionadas</p>
                </div>
              </div>

              {/* Warnings */}
              {warnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
                  {warnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-700 flex items-start gap-1.5">
                      <span className="flex-shrink-0 mt-0.5">⚠️</span>
                      {w}
                    </p>
                  ))}
                </div>
              )}

              {/* Select all toggle */}
              {matched.length > 0 && (
                <button
                  onClick={toggleAll}
                  className="flex items-center gap-2 mb-3 text-xs font-medium text-violet-600 hover:text-violet-700 transition"
                >
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                    selected.size === matched.length ? 'border-violet-500 bg-violet-500' : 'border-gray-300 bg-white'
                  }`}>
                    {selected.size === matched.length && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  {selected.size === matched.length ? 'Desmarcar todas' : 'Selecionar todas'}
                </button>
              )}

              {/* Matched stickers list (grouped by country) */}
              <div className="max-h-48 overflow-y-auto space-y-3 mb-4">
                {Object.entries(groupedMatched)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([country, stickers]) => (
                    <div key={country}>
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">{country}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {stickers.map((s) => (
                          <button
                            key={s.sticker_id}
                            onClick={() => toggleSticker(s.sticker_id)}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                              selected.has(s.sticker_id)
                                ? mode === 'coladas'
                                  ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                                  : 'bg-orange-100 text-orange-700 border border-orange-300'
                                : 'bg-gray-100 text-gray-400 border border-gray-200'
                            }`}
                          >
                            {s.number}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>

              {/* Unmatched */}
              {unmatched.length > 0 && (
                <div className="bg-gray-50 rounded-xl p-3 mb-4">
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Não encontradas no banco</p>
                  <p className="text-xs text-gray-500">{unmatched.join(', ')}</p>
                </div>
              )}

              {/* Save button */}
              <button
                onClick={saveStickers}
                disabled={selected.size === 0}
                className={`w-full py-3.5 rounded-xl font-semibold text-sm transition active:scale-[0.98] ${
                  mode === 'coladas'
                    ? 'bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-200 disabled:text-gray-400 text-white'
                    : 'bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 text-white'
                }`}
              >
                {mode === 'coladas'
                  ? `Marcar ${selected.size} como coladas`
                  : `Marcar ${selected.size} como faltantes`
                }
              </button>
            </div>
          )}

          {/* ── STEP: Saving ── */}
          {step === 'saving' && (
            <div className="text-center py-12">
              <div className="w-12 h-12 border-4 border-gray-200 border-t-violet-500 rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm font-semibold text-gray-700">Salvando figurinhas...</p>
            </div>
          )}

          {/* ── STEP: Success ── */}
          {step === 'success' && (
            <div className="text-center py-8">
              <div className="text-5xl mb-4">
                {mode === 'coladas' ? '✅' : '📋'}
              </div>
              <p className="text-lg font-bold text-gray-800 mb-1">
                {savedCount} figurinhas {mode === 'coladas' ? 'marcadas como coladas' : 'marcadas como faltantes'}!
              </p>
              <p className="text-sm text-gray-500 mb-6">
                Seu álbum foi atualizado.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => reset()}
                  className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-semibold text-sm transition"
                >
                  Importar outra lista
                </button>
                <button
                  onClick={handleClose}
                  className="flex-1 py-2.5 bg-violet-500 hover:bg-violet-600 text-white rounded-xl font-semibold text-sm transition"
                >
                  Fechar
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: Error ── */}
          {step === 'error' && (
            <div className="text-center py-8">
              <div className="text-5xl mb-4">😕</div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Algo deu errado</p>
              <p className="text-xs text-gray-500 mb-6">{errorMessage}</p>
              <button
                onClick={() => setStep('choose-input')}
                className="px-6 py-2.5 bg-violet-500 hover:bg-violet-600 text-white rounded-xl font-semibold text-sm transition"
              >
                Tentar novamente
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
