'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

type State =
  | 'idle'
  | 'uploaded'      // user escolheu foto
  | 'generating'    // chamando API
  | 'preview'       // recebeu preview WM, esperando user decidir
  | 'paying'        // chamou checkout, aguardando redirect
  | 'paid'          // figurinha liberada (após retorno Stripe)
  | 'error'

type Props = {
  tier: string
  tierLabel: string
  quotaLimit: number
  quotaLeft: number
  pricingDigital: string
  pricingWithPdf: string
  defaultName: string
}

export default function CriarFigurinhaClient(props: Props) {
  const [state, setState] = useState<State>('idle')
  const [photoBase64, setPhotoBase64] = useState<string | null>(null)
  const [photoMimeType, setPhotoMimeType] = useState<string>('image/jpeg')
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [personName, setPersonName] = useState<string>(props.defaultName)
  const [stickerId, setStickerId] = useState<number | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [cleanUrl, setCleanUrl] = useState<string | null>(null)
  const [error, setError] = useState<string>('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Detecta retorno de Stripe (?paid=N ou ?cancelled=N)
  useEffect(() => {
    const url = new URL(window.location.href)
    const paid = url.searchParams.get('paid')
    const cancelled = url.searchParams.get('cancelled')
    if (paid) {
      const id = Number(paid)
      if (Number.isFinite(id) && id > 0) {
        setStickerId(id)
        setState('paid')
        // Busca URL da imagem limpa
        fetch(`/api/generated-stickers/${id}/clean`)
          .then((r) => r.json())
          .then((data) => {
            if (data.ok && data.url) setCleanUrl(data.url)
            else setError(data.error || 'Erro ao buscar imagem liberada')
          })
          .catch(() => setError('Erro ao buscar imagem liberada'))
      }
    } else if (cancelled) {
      setError('Pagamento cancelado. A figurinha continua em preview — você pode tentar de novo.')
      setState('preview')
    }
  }, [])

  const onPickFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 8 * 1024 * 1024) {
      setError('Foto muito grande (máx 8MB).')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const [, base64] = dataUrl.split(',')
      setPhotoBase64(base64)
      setPhotoMimeType(file.type || 'image/jpeg')
      setPhotoPreview(dataUrl)
      setState('uploaded')
      setError('')
    }
    reader.readAsDataURL(file)
  }, [])

  const onGenerate = useCallback(async () => {
    if (!photoBase64) return
    setState('generating')
    setError('')
    try {
      const res = await fetch('/api/generated-stickers/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoBase64, photoMimeType, personName: personName || undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Erro ao gerar figurinha')
        setState('error')
        return
      }
      setStickerId(data.stickerId)
      setPreviewUrl(data.previewUrl)
      setState('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setState('error')
    }
  }, [photoBase64, photoMimeType, personName])

  const onCheckout = useCallback(async (withPrintPdf: boolean) => {
    if (!stickerId) return
    setState('paying')
    setError('')
    try {
      const res = await fetch('/api/generated-stickers/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stickerId, withPrintPdf }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Erro ao iniciar checkout')
        setState('preview')
        return
      }
      if (data.kind === 'quota') {
        // Liberou via cota — cleanUrl já vem
        setCleanUrl(data.cleanUrl)
        setState('paid')
      } else if (data.kind === 'stripe' && data.url) {
        window.location.href = data.url
      } else {
        setError('Resposta inesperada')
        setState('preview')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setState('preview')
    }
  }, [stickerId])

  function reset() {
    setState('idle')
    setPhotoBase64(null)
    setPhotoMimeType('image/jpeg')
    setPhotoPreview(null)
    setStickerId(null)
    setPreviewUrl(null)
    setCleanUrl(null)
    setError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  // ─── PAID STATE ───
  if (state === 'paid' && cleanUrl) {
    return (
      <div className="px-4 pt-6 pb-24 max-w-md mx-auto">
        <div className="text-center mb-5">
          <div className="text-5xl mb-2">🎉</div>
          <h1 className="text-2xl font-black text-gray-900">Figurinha liberada!</h1>
          <p className="text-sm text-gray-500 mt-1">Salve a imagem ou use como quiser</p>
        </div>
        <div className="rounded-2xl overflow-hidden bg-gray-100 shadow-lg mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cleanUrl} alt="Figurinha liberada" className="w-full" />
        </div>
        <a
          href={cleanUrl}
          download="minha-figurinha-completeai.png"
          className="block bg-brand text-white text-center font-bold py-3 rounded-xl mb-3 active:scale-[0.98] transition"
        >
          📥 Baixar imagem
        </a>
        <button
          onClick={reset}
          className="w-full bg-gray-100 text-gray-700 font-medium py-3 rounded-xl active:scale-[0.98] transition"
        >
          Criar outra
        </button>
      </div>
    )
  }

  // ─── PREVIEW STATE (mostra preview WM + botões de checkout) ───
  if ((state === 'preview' || state === 'paying') && previewUrl) {
    return (
      <div className="px-4 pt-6 pb-24 max-w-md mx-auto">
        <h1 className="text-xl font-black text-gray-900 mb-1">Sua figurinha tá pronta!</h1>
        <p className="text-xs text-gray-500 mb-4">Libere pra usar sem a marca d&apos;água.</p>

        <div className="rounded-2xl overflow-hidden bg-gray-100 shadow mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Preview com marca d'água" className="w-full" />
        </div>

        {/* Disclaimer crítico */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
          <p className="text-[11px] text-amber-900 leading-relaxed">
            <strong>⚠️ Não é a figurinha física do álbum Panini.</strong> Você recebe a IMAGEM em alta resolução pra usar no perfil/status/grupos, ou levar a uma gráfica e imprimir como adesivo (pelo PDF).
          </p>
        </div>

        {/* Botões de checkout */}
        {props.quotaLeft > 0 && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-3">
            <p className="text-xs text-emerald-800 mb-2">
              🎁 Você tem <strong>{props.quotaLeft}</strong> figurinha{props.quotaLeft > 1 ? 's' : ''} grátis no plano <strong>{props.tierLabel}</strong>!
            </p>
            <button
              onClick={() => onCheckout(false)}
              disabled={state === 'paying'}
              className="w-full bg-emerald-500 text-white font-bold py-3 rounded-xl active:scale-[0.98] transition disabled:opacity-50"
            >
              {state === 'paying' ? 'Liberando…' : '✨ Liberar digital (grátis pelo plano)'}
            </button>
          </div>
        )}

        <button
          onClick={() => onCheckout(false)}
          disabled={state === 'paying'}
          className={`w-full font-bold py-3 rounded-xl mb-2 active:scale-[0.98] transition disabled:opacity-50 ${
            props.quotaLeft > 0 ? 'bg-white border-2 border-gray-200 text-gray-700' : 'bg-brand text-white'
          }`}
        >
          {state === 'paying' ? 'Redirecionando…' : `🖼️ Imagem digital — ${props.pricingDigital}`}
        </button>

        <button
          onClick={() => onCheckout(true)}
          disabled={state === 'paying'}
          className="w-full bg-gradient-to-br from-amber-50 to-yellow-50 border-2 border-amber-300 text-amber-900 font-bold py-3 rounded-xl mb-3 active:scale-[0.98] transition disabled:opacity-50"
        >
          {state === 'paying' ? '…' : (
            <>
              📦 Imagem + PDF impressão — {props.pricingWithPdf}
              <span className="block text-[10px] font-normal text-amber-700 mt-0.5">Formato Panini 5,7×7,6cm com sangria, leva pra gráfica</span>
            </>
          )}
        </button>

        <button
          onClick={reset}
          className="w-full text-sm text-gray-500 underline mt-2"
        >
          Cancelar e criar outra
        </button>

        {error && (
          <p className="text-xs text-red-600 text-center mt-3">{error}</p>
        )}
      </div>
    )
  }

  // ─── GENERATING STATE ───
  if (state === 'generating') {
    return (
      <div className="px-4 pt-20 pb-24 max-w-md mx-auto text-center">
        <div className="text-6xl mb-4 animate-bounce">🎨</div>
        <p className="text-lg font-bold text-gray-800">Gerando sua figurinha…</p>
        <p className="text-sm text-gray-500 mt-2">Isso pode levar até 30 segundos</p>
        <div className="mt-6 mx-auto w-48 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-brand rounded-full animate-pulse" style={{ width: '70%' }} />
        </div>
      </div>
    )
  }

  // ─── IDLE / UPLOADED STATE ───
  return (
    <div className="px-4 pt-6 pb-24 max-w-md mx-auto">
      <h1 className="text-2xl font-black text-gray-900 mb-1">🎨 Criar figurinha</h1>
      <p className="text-xs text-gray-500 mb-5">
        Sua foto vira uma figurinha estilo álbum Panini Copa 2026.
      </p>

      {/* Plano + cota */}
      <div className="bg-gray-50 rounded-xl border border-gray-100 p-3 mb-4 flex items-center justify-between">
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider">Seu plano</p>
          <p className="text-sm font-bold text-gray-800">{props.tierLabel}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-gray-500">Grátis no plano</p>
          <p className="text-sm font-bold text-emerald-600">
            {props.quotaLeft}/{props.quotaLimit || '–'}
          </p>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">
        <p className="text-[11px] text-blue-900 leading-relaxed">
          <strong>📌 Importante:</strong> Esta é uma figurinha <strong>digital personalizada</strong> — não é uma figurinha do álbum oficial Panini. Você recebe a IMAGEM em alta resolução. Quer ter a figurinha física? Tem opção de gerar PDF pronto pra gráfica imprimir como adesivo.
        </p>
      </div>

      {/* Upload */}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        onChange={onPickFile}
        className="hidden"
      />

      {!photoPreview ? (
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full border-2 border-dashed border-gray-300 rounded-2xl py-12 px-4 hover:border-brand hover:bg-brand/5 transition active:scale-[0.99]"
        >
          <div className="text-5xl mb-2">📸</div>
          <p className="text-sm font-bold text-gray-700">Escolher foto</p>
          <p className="text-[11px] text-gray-500 mt-1">JPG, PNG ou WebP · até 8MB</p>
        </button>
      ) : (
        <>
          <div className="rounded-2xl overflow-hidden bg-gray-100 mb-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoPreview} alt="Sua foto" className="w-full" />
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            className="text-xs text-brand font-medium underline mb-3"
          >
            Trocar foto
          </button>

          <label className="block mb-3">
            <span className="text-[11px] font-medium text-gray-600 block mb-1">Nome (opcional)</span>
            <input
              type="text"
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
              placeholder="Como aparecerá na figurinha"
              maxLength={40}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </label>

          <button
            onClick={onGenerate}
            className="w-full bg-brand text-white font-bold py-3 rounded-xl active:scale-[0.98] transition"
          >
            🎨 Gerar figurinha
          </button>
        </>
      )}

      {error && (
        <p className="text-xs text-red-600 text-center mt-4">{error}</p>
      )}
    </div>
  )
}
