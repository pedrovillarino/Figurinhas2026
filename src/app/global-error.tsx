'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <body>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', padding: '2rem' }}>
          <div style={{ textAlign: 'center', maxWidth: 400 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>😵</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1a2332', marginBottom: 8 }}>Algo deu errado</h2>
            <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 24, lineHeight: 1.5 }}>
              Um erro inesperado aconteceu. Nossa equipe já foi notificada.
            </p>
            <button
              onClick={reset}
              style={{
                background: '#00C896',
                color: 'white',
                border: 'none',
                padding: '12px 24px',
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Tentar novamente
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
