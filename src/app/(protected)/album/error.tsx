'use client'

import { useEffect } from 'react'

export default function AlbumError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Album error:', error)
  }, [error])

  return (
    <div className="px-4 pt-6 pb-28 flex flex-col items-center justify-center min-h-[50vh]">
      <div className="text-5xl mb-4">📖</div>
      <h2 className="text-lg font-bold text-gray-900 mb-2">Erro ao carregar o álbum</h2>
      <p className="text-sm text-gray-500 text-center mb-6 max-w-xs">
        Algo deu errado ao carregar suas figurinhas. Tente novamente.
      </p>
      <button
        onClick={reset}
        className="bg-violet-600 text-white rounded-xl px-6 py-3 text-sm font-semibold hover:bg-violet-700 transition active:scale-[0.98]"
      >
        Tentar novamente
      </button>
    </div>
  )
}
