'use client'

import { useState } from 'react'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'

type Sticker = {
  id: number
  number: string
  player_name: string | null
  country: string
  section: string
  type: string
}

type UserStickerInfo = { status: string; quantity: number }

type ExportChannel = 'whatsapp' | 'email' | 'clipboard'

const SITE_URL = 'https://www.completeai.com.br'

export default function ExportModal({
  isOpen,
  onClose,
  stickers,
  userMap,
}: {
  isOpen: boolean
  onClose: () => void
  stickers: Sticker[]
  userMap: Record<number, UserStickerInfo>
}) {
  const [exportMissing, setExportMissing] = useState(true)
  const [exportDuplicates, setExportDuplicates] = useState(false)
  const [groupByCountry, setGroupByCountry] = useState(true)
  const [copied, setCopied] = useState(false)

  useBodyScrollLock(isOpen)

  if (!isOpen) return null

  const missingStickers = stickers.filter((s) => {
    const us = userMap[s.id]
    return !us || us.status === 'missing'
  })

  const duplicateStickers = stickers.filter((s) => userMap[s.id]?.status === 'duplicate')

  const totalDuplicateExtras = duplicateStickers.reduce((acc, s) => {
    const qty = userMap[s.id]?.quantity || 0
    return acc + (qty - 1)
  }, 0)

  const hasSelection = exportMissing || exportDuplicates
  const hasStickersToExport = (exportMissing && missingStickers.length > 0) || (exportDuplicates && duplicateStickers.length > 0)

  function formatSection(stickerList: Sticker[], type: 'missing' | 'duplicates'): string {
    const title = type === 'missing'
      ? `FIGURINHAS FALTANTES (${stickerList.length})`
      : `FIGURINHAS REPETIDAS (${stickerList.length})`

    const lines: string[] = [title, '']

    if (groupByCountry) {
      const groups: Record<string, Sticker[]> = {}
      stickerList.forEach((s) => {
        if (!groups[s.country]) groups[s.country] = []
        groups[s.country].push(s)
      })

      Object.entries(groups)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([country, countryStickers]) => {
          lines.push(`${country} (${countryStickers.length}):`)
          const nums = countryStickers.map((s) => {
            if (type === 'duplicates') {
              const qty = userMap[s.id]?.quantity || 0
              const extras = qty - 1
              return extras > 1 ? `${s.number} (x${extras})` : s.number
            }
            return s.number
          })
          lines.push(nums.join(', '))
          lines.push('')
        })
    } else {
      const nums = stickerList.map((s) => {
        if (type === 'duplicates') {
          const qty = userMap[s.id]?.quantity || 0
          const extras = qty - 1
          return extras > 1 ? `${s.number} (x${extras})` : s.number
        }
        return s.number
      })
      lines.push(nums.join(', '))
      lines.push('')
    }

    return lines.join('\n')
  }

  function buildFullText(): string {
    const parts: string[] = []

    if (exportMissing && missingStickers.length > 0) {
      parts.push(formatSection(missingStickers, 'missing'))
    }
    if (exportDuplicates && duplicateStickers.length > 0) {
      parts.push(formatSection(duplicateStickers, 'duplicates'))
    }

    parts.push('---')
    parts.push('Complete Aí — gerencie seu álbum da Copa 2026 de graça!')
    parts.push('Marque coladas, faltantes e repetidas, exporte e troque.')
    parts.push(SITE_URL)

    return parts.join('\n')
  }

  function handleExport(channel: ExportChannel) {
    const text = buildFullText()

    if (channel === 'whatsapp') {
      const encoded = encodeURIComponent(text)
      window.open(`https://wa.me/?text=${encoded}`, '_blank')
    } else if (channel === 'email') {
      const subjectParts: string[] = []
      if (exportMissing) subjectParts.push('faltantes')
      if (exportDuplicates) subjectParts.push('repetidas')
      const subject = encodeURIComponent(
        `Minhas figurinhas ${subjectParts.join(' e ')} - Copa 2026`
      )
      const body = encodeURIComponent(text)
      window.open(`mailto:?subject=${subject}&body=${body}`, '_blank')
    } else if (channel === 'clipboard') {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-white rounded-t-3xl shadow-2xl animate-slide-up">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>

        <div className="px-5 pb-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold text-gray-900">Exportar Lista</h2>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center"
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Type selector - checkboxes */}
          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">O que exportar?</p>
          <div className="flex gap-2 mb-5">
            <button
              onClick={() => setExportMissing(!exportMissing)}
              className={`flex-1 py-3 px-3 rounded-xl border-2 transition-all ${
                exportMissing
                  ? 'border-orange-400 bg-orange-50'
                  : 'border-gray-100 bg-white'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                  exportMissing ? 'border-orange-400 bg-orange-400' : 'border-gray-200 bg-white'
                }`}>
                  {exportMissing && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className={`text-sm font-semibold ${exportMissing ? 'text-orange-700' : 'text-gray-500'}`}>
                  Faltantes
                </span>
              </div>
              <p className={`text-xl font-bold mt-1 ${exportMissing ? 'text-orange-500' : 'text-gray-300'}`}>
                {missingStickers.length}
              </p>
            </button>
            <button
              onClick={() => setExportDuplicates(!exportDuplicates)}
              className={`flex-1 py-3 px-3 rounded-xl border-2 transition-all ${
                exportDuplicates
                  ? 'border-brand bg-brand-light'
                  : 'border-gray-100 bg-white'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                  exportDuplicates ? 'border-brand bg-brand' : 'border-gray-200 bg-white'
                }`}>
                  {exportDuplicates && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className={`text-sm font-semibold ${exportDuplicates ? 'text-brand-dark' : 'text-gray-500'}`}>
                  Repetidas
                </span>
              </div>
              <p className={`text-xl font-bold mt-1 ${exportDuplicates ? 'text-brand' : 'text-gray-300'}`}>
                {duplicateStickers.length}
                {totalDuplicateExtras > 0 && (
                  <span className="text-xs font-normal ml-1">({totalDuplicateExtras} extras)</span>
                )}
              </p>
            </button>
          </div>

          {!hasSelection && (
            <p className="text-center text-xs text-orange-500 mb-4 font-medium">Selecione pelo menos uma opção acima</p>
          )}

          {/* Group toggle */}
          <div className="flex items-center justify-between mb-5 bg-gray-50 rounded-xl px-4 py-3">
            <span className="text-sm text-gray-600">Agrupar por seleção</span>
            <button
              onClick={() => setGroupByCountry(!groupByCountry)}
              className={`w-10 h-6 rounded-full transition-colors relative ${
                groupByCountry ? 'bg-brand' : 'bg-gray-300'
              }`}
            >
              <div
                className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  groupByCountry ? 'translate-x-5' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Preview */}
          {hasStickersToExport && (
            <div className="mb-5 bg-gray-50 rounded-xl p-3 max-h-32 overflow-y-auto">
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Preview</p>
              <p className="text-xs text-gray-600 whitespace-pre-line leading-relaxed">
                {buildFullText().slice(0, 300)}
                {buildFullText().length > 300 && '...'}
              </p>
            </div>
          )}

          {/* Export buttons */}
          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Enviar via</p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => handleExport('whatsapp')}
              disabled={!hasStickersToExport}
              className="flex items-center gap-3 w-full py-3.5 px-4 bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-xl font-semibold text-sm transition active:scale-[0.98]"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              WhatsApp
            </button>
            <button
              onClick={() => handleExport('email')}
              disabled={!hasStickersToExport}
              className="flex items-center gap-3 w-full py-3.5 px-4 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-xl font-semibold text-sm transition active:scale-[0.98]"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
              E-mail
            </button>
            <button
              onClick={() => handleExport('clipboard')}
              disabled={!hasStickersToExport}
              className="flex items-center gap-3 w-full py-3.5 px-4 bg-gray-700 hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-xl font-semibold text-sm transition active:scale-[0.98]"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
              </svg>
              {copied ? 'Copiado!' : 'Copiar texto'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
