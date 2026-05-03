'use client'

// Pedro 2026-05-03: visibilidade da feature de registro por áudio.
// "Quem usa tá vendo bastante valor e agora que limitamos pode ser
// feature importante pra conversão." NÃO falar "mais rápido que foto"
// — alguns preferem foto. Foco em "outra forma" e "voz".
//
// Variants:
//  - 'banner': barra horizontal compacta (pra topo de páginas)
//  - 'card':   card destacado (pra páginas de scan/álbum)
//  - 'tip':    linha sutil (pra rodapés/aside)

import Link from 'next/link'

type Variant = 'banner' | 'card' | 'tip'

const BOT_PHONE = '5521966791113'
const WA_LINK = `https://wa.me/${BOT_PHONE}?text=${encodeURIComponent('oi quero registrar por áudio')}`

export default function AudioRegistrationCTA({
  variant = 'banner',
  audiosRemaining,
}: {
  variant?: Variant
  audiosRemaining?: number  // se passado, mostra saldo restante
}) {
  if (variant === 'tip') {
    return (
      <Link
        href={WA_LINK}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-[12px] text-blue-700 hover:text-blue-900 transition py-1"
      >
        🎤 Registre por <strong>áudio</strong> pelo WhatsApp — fale &quot;Brasil 1, Argentina 3&quot; e eu identifico tudo.
      </Link>
    )
  }

  if (variant === 'card') {
    return (
      <Link
        href={WA_LINK}
        target="_blank"
        rel="noopener noreferrer"
        className="block bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 hover:border-blue-300 active:scale-[0.99] transition-all"
      >
        <div className="flex items-start gap-3">
          <div className="text-3xl">🎤</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-blue-900">
              Registre por áudio pelo WhatsApp
            </p>
            <p className="text-[12px] text-blue-700 mt-1">
              Fale &quot;Brasil 1, Argentina 3, Espanha 5&quot; e eu identifico tudo. Pra quem prefere voz ou tá com as mãos ocupadas.
            </p>
            {audiosRemaining !== undefined && (
              <p className="text-[11px] text-blue-600 mt-2 font-semibold">
                {audiosRemaining > 0
                  ? `🎁 Você tem ${audiosRemaining} áudios disponíveis →`
                  : 'Veja quantos áudios você tem →'}
              </p>
            )}
            {audiosRemaining === undefined && (
              <p className="text-[11px] text-blue-600 mt-2 font-semibold">
                Conhecer o áudio →
              </p>
            )}
          </div>
        </div>
      </Link>
    )
  }

  // banner (default)
  return (
    <Link
      href={WA_LINK}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg px-3 py-2.5 hover:border-blue-300 active:scale-[0.99] transition-all"
    >
      <div className="text-xl flex-shrink-0">🎤</div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-blue-900 truncate">
          Conhece o áudio? Fale os códigos pelo WhatsApp.
        </p>
        <p className="text-[11px] text-blue-700 truncate">
          Ex: &quot;Brasil 1, Argentina 3&quot; — eu identifico tudo
          {audiosRemaining !== undefined && audiosRemaining > 0 && ` · ${audiosRemaining} disponíveis`}
        </p>
      </div>
      <div className="text-blue-600 flex-shrink-0">→</div>
    </Link>
  )
}
