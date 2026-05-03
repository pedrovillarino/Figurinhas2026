// Badge visual de tier exclusivo, usado em ranking, profile e trades.
// Pedro 2026-05-03 (Copa Completa diferenciação): user Copa Completa
// ganha badge dourado destacado pra ter status visível.
// Outros tiers retornam null (sem poluir UI com badges desnecessários).

import type { Tier } from '@/lib/tiers'

type Size = 'xs' | 'sm' | 'md'

const SIZE_CLASSES: Record<Size, string> = {
  xs: 'text-[8px] px-1 py-0.5 gap-0.5',
  sm: 'text-[9px] px-1.5 py-0.5 gap-1',
  md: 'text-[10px] px-2 py-1 gap-1',
}

export default function UserTierBadge({
  tier,
  size = 'sm',
}: {
  tier: Tier | null | undefined
  size?: Size
}) {
  if (tier !== 'copa_completa') return null
  return (
    <span
      title="Plano Copa Completa"
      aria-label="Plano Copa Completa"
      className={`inline-flex items-center font-bold rounded-full bg-gradient-to-r from-amber-400 to-amber-500 text-white shadow-sm ${SIZE_CLASSES[size]}`}
    >
      🏆 <span className="tracking-tight">COPA</span>
    </span>
  )
}
