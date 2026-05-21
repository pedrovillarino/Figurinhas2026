'use client'

import UpgradePlans from './UpgradePlans'
import type { Tier } from '@/lib/tiers'

type PaywallModalProps = {
  feature: 'scan' | 'trades' | 'upgrade'
  currentTier: Tier
  onClose?: () => void
  isMinor?: boolean
  /** Pedro 21/05: muda header pra "Trial Boost de 7d acabou" quando vem
   *  de resposta 402 com trialExpired:true. */
  trialExpired?: boolean
}

export default function PaywallModal({ feature, currentTier, onClose, isMinor = false, trialExpired = false }: PaywallModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div className="bg-white rounded-3xl p-5 max-w-sm w-full shadow-2xl animate-fade-up relative max-h-[90vh] overflow-y-auto">
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-300 hover:text-gray-500 transition"
            aria-label="Fechar"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {trialExpired && (
          <div className="mb-4 -mt-1 rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-900">
            <p className="font-bold">🚫 Seu Trial Boost de 7 dias acabou</p>
            <p className="text-xs mt-1 text-red-700">
              Pra continuar escaneando e trocando figurinhas, escolha um plano abaixo.
              Pagamento único, sem mensalidade.
            </p>
          </div>
        )}

        <UpgradePlans feature={feature} currentTier={currentTier} isMinor={isMinor} />
      </div>
    </div>
  )
}
