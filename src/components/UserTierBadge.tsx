// Badge visual de tier exclusivo, usado em ranking, profile e trades.
//
// Pedro 2026-05-03: user Copa Completa ganha badge dourado destacado.
// Pedro 2026-05-06: estendido pra Estreante (E bronze) + Colecionador
// (C prata) + Copa Completa (CP ouro+glow). Hierarquia visual cresce
// com o plano — quanto maior o plano, mais especial o selinho.
//
// Free → null (sem badge — não polui UI).

import type { Tier } from '@/lib/tiers'

type Size = 'xs' | 'sm' | 'md'

const SIZE_CLASSES: Record<Size, string> = {
  xs: 'text-[8px] min-w-[16px] h-[16px] px-1',
  sm: 'text-[9px] min-w-[20px] h-[20px] px-1.5',
  md: 'text-[11px] min-w-[24px] h-[24px] px-2',
}

const TIER_CONFIG: Partial<Record<Tier, {
  letter: string
  bg: string
  extra: string
  title: string
}>> = {
  estreante: {
    letter: 'E',
    bg: 'bg-gradient-to-br from-emerald-400 to-emerald-600', // verde (brand)
    extra: 'shadow-sm',
    title: 'Plano Estreante',
  },
  colecionador: {
    letter: 'C',
    bg: 'bg-gradient-to-br from-slate-300 to-slate-500', // prata
    extra: 'shadow-sm',
    title: 'Plano Colecionador',
  },
  copa_completa: {
    letter: 'CP',
    bg: 'bg-gradient-to-br from-amber-400 to-amber-600', // ouro
    extra: 'ring-1 ring-amber-300/70 shadow-md shadow-amber-500/30',
    title: 'Plano Copa Completa',
  },
}

export default function UserTierBadge({
  tier,
  size = 'sm',
}: {
  tier: Tier | null | undefined
  size?: Size
}) {
  if (!tier || tier === 'free') return null
  const cfg = TIER_CONFIG[tier]
  if (!cfg) return null
  return (
    <span
      title={cfg.title}
      aria-label={cfg.title}
      className={`inline-flex items-center justify-center font-black rounded-full text-white tracking-tight ${cfg.bg} ${cfg.extra} ${SIZE_CLASSES[size]}`}
    >
      {cfg.letter}
    </span>
  )
}
