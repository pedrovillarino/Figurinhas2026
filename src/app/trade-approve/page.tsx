'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function TradeApproveContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const action = searchParams.get('action') // 'approve' or 'reject'

  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'already'>('loading')
  const [message, setMessage] = useState('')
  const [requesterName, setRequesterName] = useState('')

  useEffect(() => {
    if (!token || !action) {
      setStatus('error')
      setMessage('Link inválido. Verifique o link recebido no WhatsApp.')
      return
    }

    async function respond() {
      try {
        const res = await fetch('/api/trade-respond', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, action }),
        })

        const data = await res.json()

        if (res.ok) {
          setStatus('success')
          if (action === 'approve') {
            setRequesterName(data.requester_name || '')
            setMessage('Troca aprovada! Os contatos foram compartilhados via WhatsApp.')
          } else {
            setMessage('Solicitação recusada.')
          }
        } else if (data.already_responded) {
          setStatus('already')
          setMessage(data.error || 'Esta solicitação já foi respondida.')
        } else {
          setStatus('error')
          setMessage(data.error || 'Erro ao processar resposta.')
        }
      } catch {
        setStatus('error')
        setMessage('Erro de conexão. Tente novamente.')
      }
    }

    respond()
  }, [token, action])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-6 text-center">
        {status === 'loading' && (
          <>
            <div className="w-12 h-12 border-4 border-gray-200 border-t-violet-500 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm text-gray-600">
              {action === 'approve' ? 'Aprovando troca...' : 'Processando...'}
            </p>
          </>
        )}

        {status === 'success' && action === 'approve' && (
          <>
            <div className="text-5xl mb-4">🎉</div>
            <h1 className="text-lg font-bold text-gray-900 mb-2">Troca aprovada!</h1>
            {requesterName && (
              <p className="text-sm text-gray-600 mb-3">
                Você e <strong>{requesterName}</strong> agora podem trocar figurinhas.
              </p>
            )}
            <p className="text-sm text-gray-500 mb-6">
              Os contatos foram enviados para ambos via WhatsApp.
            </p>
            <a
              href="/trades"
              className="inline-block w-full py-3 bg-violet-500 hover:bg-violet-600 text-white rounded-xl font-semibold text-sm transition"
            >
              Abrir o app
            </a>
          </>
        )}

        {status === 'success' && action === 'reject' && (
          <>
            <div className="text-5xl mb-4">👍</div>
            <h1 className="text-lg font-bold text-gray-900 mb-2">Tudo certo</h1>
            <p className="text-sm text-gray-500 mb-6">{message}</p>
            <a
              href="/trades"
              className="inline-block w-full py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl font-semibold text-sm transition"
            >
              Ver outras trocas
            </a>
          </>
        )}

        {status === 'already' && (
          <>
            <div className="text-5xl mb-4">📋</div>
            <h1 className="text-lg font-bold text-gray-900 mb-2">Já respondida</h1>
            <p className="text-sm text-gray-500 mb-6">{message}</p>
            <a
              href="/trades"
              className="inline-block w-full py-3 bg-violet-500 hover:bg-violet-600 text-white rounded-xl font-semibold text-sm transition"
            >
              Abrir o app
            </a>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="text-5xl mb-4">😕</div>
            <h1 className="text-lg font-bold text-gray-900 mb-2">Ops!</h1>
            <p className="text-sm text-gray-500 mb-6">{message}</p>
            <a
              href="/trades"
              className="inline-block w-full py-3 bg-violet-500 hover:bg-violet-600 text-white rounded-xl font-semibold text-sm transition"
            >
              Ir para o app
            </a>
          </>
        )}
      </div>
    </div>
  )
}

export default function TradeApprovePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="w-12 h-12 border-4 border-gray-200 border-t-violet-500 rounded-full animate-spin" />
      </div>
    }>
      <TradeApproveContent />
    </Suspense>
  )
}
