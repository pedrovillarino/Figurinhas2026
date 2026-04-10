'use client'

import { useEffect, useState } from 'react'

type UndoToastProps = {
  message: string
  onUndo: () => void
  onDismiss: () => void
  duration?: number
}

export default function UndoToast({ message, onUndo, onDismiss, duration = 4000 }: UndoToastProps) {
  const [progress, setProgress] = useState(100)

  useEffect(() => {
    const start = Date.now()
    const interval = setInterval(() => {
      const elapsed = Date.now() - start
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100)
      setProgress(remaining)
      if (remaining <= 0) {
        clearInterval(interval)
        onDismiss()
      }
    }, 50)
    return () => clearInterval(interval)
  }, [duration, onDismiss])

  return (
    <div className="fixed bottom-24 left-4 right-4 z-50 animate-slide-up">
      <div className="bg-gray-900 rounded-xl px-4 py-3 shadow-lg flex items-center gap-3 max-w-lg mx-auto">
        <p className="text-sm text-white flex-1 truncate">{message}</p>
        <button
          onClick={onUndo}
          className="text-sm font-bold text-violet-400 hover:text-violet-300 transition shrink-0"
        >
          Desfazer
        </button>
        {/* Progress bar */}
        <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-violet-500 rounded-full transition-all duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  )
}
