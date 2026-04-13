/**
 * Logo oficial do Complete Aí
 * Grid 2×2: 3 figurinhas coladas + 1 faltando (pontilhada com "+")
 * Badge dourado com câmera no canto superior direito
 */

export function LogoMark({ size = 48, color = '#00C896' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" role="img" aria-labelledby="logo-title">
      <title id="logo-title">Logo Complete Aí</title>
      {/* Fundo arredondado */}
      <rect width="48" height="48" rx="12" fill={color} />

      {/* Grid 2x2 — deslocado pra dar espaço ao badge */}
      {/* Figurinha colada (topo-esquerda) */}
      <rect x="8" y="12" width="12" height="12" rx="2.5" fill="rgba(255,255,255,0.9)" />
      {/* Figurinha colada (topo-direita) */}
      <rect x="22" y="12" width="12" height="12" rx="2.5" fill="rgba(255,255,255,0.9)" />
      {/* Figurinha colada (baixo-esquerda) */}
      <rect x="8" y="26" width="12" height="12" rx="2.5" fill="rgba(255,255,255,0.9)" />

      {/* Figurinha FALTANDO (baixo-direita) — contorno pontilhado + "+" */}
      <rect x="22" y="26" width="12" height="12" rx="2.5"
        fill="rgba(255,255,255,0.08)"
        stroke="rgba(255,255,255,0.5)"
        strokeWidth="1.5"
        strokeDasharray="3 2"
      />
      <line x1="28" y1="29.5" x2="28" y2="34.5" stroke="rgba(255,255,255,0.5)" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="25.5" y1="32" x2="30.5" y2="32" stroke="rgba(255,255,255,0.5)" strokeWidth="1.6" strokeLinecap="round" />

      {/* Badge câmera dourado — anel verde de separação */}
      <circle cx="38" cy="10" r="8.5" fill={color} />
      <circle cx="38" cy="10" r="7.5" fill="#FFB800" />
      {/* Câmera — corpo */}
      <rect x="33.5" y="7.5" width="9" height="6" rx="1.5" fill="none" stroke="#0A1628" strokeWidth="1.5" />
      {/* Câmera — lente */}
      <circle cx="38" cy="10.5" r="1.8" fill="none" stroke="#0A1628" strokeWidth="1.3" />
      {/* Câmera — flash/viewfinder bump */}
      <rect x="36" y="6" width="2.5" height="1.8" rx="0.5" fill="#0A1628" />
    </svg>
  )
}

export function LogoFull({
  size = 48,
  color = '#00C896',
  textColor = '#0A1628',
  showSubtitle = true,
}: {
  size?: number
  color?: string
  textColor?: string
  showSubtitle?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <LogoMark size={size} color={color} />
      <div className="flex flex-col">
        <span
          className="font-extrabold tracking-tight leading-none"
          style={{ fontSize: size * 0.45, color: textColor }}
        >
          Complete{' '}
          <span style={{ color }}>Aí</span>
        </span>
        {showSubtitle && (
          <span
            className="font-medium tracking-widest uppercase leading-none mt-0.5"
            style={{
              fontSize: Math.max(size * 0.17, 7),
              color: 'rgba(107,114,128,0.6)',
              letterSpacing: '0.12em',
            }}
          >
            Álbum da Copa 2026
          </span>
        )}
      </div>
    </div>
  )
}
