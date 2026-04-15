/**
 * Logo oficial do Complete Aí
 * Grid 2×2: 3 figurinhas coladas (verde, navy, gold) + 1 faltando (pontilhada com "?")
 * Badge dourado com câmera no canto inferior direito
 */

export function LogoMark({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1080 1080" fill="none" role="img" aria-labelledby="logo-title">
      <title id="logo-title">Logo Complete Aí</title>
      <defs>
        <linearGradient id="lm-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#00C896" />
          <stop offset="100%" stopColor="#00A67D" />
        </linearGradient>
        <linearGradient id="lm-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFB800" />
          <stop offset="100%" stopColor="#E6A600" />
        </linearGradient>
      </defs>

      {/* Rounded square background */}
      <rect width="1080" height="1080" rx="240" fill="url(#lm-bg)" />

      {/* Grid 2x2 */}
      <g transform="translate(260, 240)">
        {/* Card 1 — white (top-left) */}
        <rect x="0" y="0" width="260" height="300" rx="24" fill="#FFFFFF" />
        <circle cx="130" cy="110" r="46" fill="#00C896" />
        <rect x="50" y="190" width="160" height="14" rx="7" fill="#0A1628" opacity="0.85" />
        <rect x="70" y="218" width="120" height="10" rx="5" fill="#0A1628" opacity="0.5" />

        {/* Card 2 — navy (top-right) */}
        <rect x="280" y="0" width="260" height="300" rx="24" fill="#0A1628" />
        <circle cx="410" cy="110" r="46" fill="url(#lm-gold)" />
        <rect x="330" y="190" width="160" height="14" rx="7" fill="#FFB800" />
        <rect x="350" y="218" width="120" height="10" rx="5" fill="#FFB800" opacity="0.6" />

        {/* Card 3 — gold (bottom-left) */}
        <rect x="0" y="320" width="260" height="300" rx="24" fill="url(#lm-gold)" />
        <circle cx="130" cy="430" r="46" fill="#0A1628" />
        <rect x="50" y="510" width="160" height="14" rx="7" fill="#0A1628" opacity="0.85" />
        <rect x="70" y="538" width="120" height="10" rx="5" fill="#0A1628" opacity="0.5" />

        {/* Card 4 — missing (bottom-right) */}
        <rect x="280" y="320" width="260" height="300" rx="24" fill="none" stroke="#FFFFFF" strokeWidth="6" strokeDasharray="14 10" />
        <text x="410" y="505" fontFamily="Inter, Arial, sans-serif" fontSize="180" fontWeight="800" fill="#FFFFFF" textAnchor="middle" opacity="0.9">?</text>
      </g>

      {/* Camera badge */}
      <g transform="translate(800, 760)">
        <circle cx="0" cy="0" r="92" fill="url(#lm-gold)" stroke="#0A1628" strokeWidth="6" />
        <rect x="-52" y="-34" width="104" height="72" rx="10" fill="#0A1628" />
        <rect x="-22" y="-48" width="44" height="18" rx="4" fill="#0A1628" />
        <circle cx="0" cy="6" r="22" fill="url(#lm-gold)" />
        <circle cx="0" cy="6" r="11" fill="#0A1628" />
        <circle cx="28" cy="-18" r="4" fill="#FFB800" />
      </g>
    </svg>
  )
}

export function LogoFull({
  size = 48,
  textColor = '#0A1628',
  showSubtitle = true,
}: {
  size?: number
  textColor?: string
  showSubtitle?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <LogoMark size={size} />
      <div className="flex flex-col">
        <span
          className="font-extrabold tracking-tight leading-none"
          style={{ fontSize: size * 0.45, color: textColor }}
        >
          Complete{' '}
          <span style={{ color: '#00C896' }}>Aí</span>
        </span>
        {showSubtitle && (
          <span
            className="font-semibold tracking-widest uppercase leading-none mt-0.5"
            style={{
              fontSize: Math.max(size * 0.17, 7),
              color: 'rgba(107,114,128,0.6)',
              letterSpacing: '0.12em',
            }}
          >
            Álbum Digital · Copa 2026
          </span>
        )}
      </div>
    </div>
  )
}
