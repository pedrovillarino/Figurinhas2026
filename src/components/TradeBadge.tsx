type TradeBadgeProps = {
  completedTrades: number
}

type TierInfo = {
  label: string
  color: string
  bg: string
}

function getTier(count: number): TierInfo | null {
  if (count >= 30) return { label: 'Mestre', color: 'text-purple-500', bg: 'bg-purple-500/10' }
  if (count >= 15) return { label: 'Veterano', color: 'text-yellow-500', bg: 'bg-yellow-500/10' }
  if (count >= 5) return { label: 'Negociador', color: 'text-gray-400', bg: 'bg-gray-400/10' }
  if (count >= 1) return { label: 'Iniciante', color: 'text-amber-600', bg: 'bg-amber-600/10' }
  return null
}

export default function TradeBadge({ completedTrades }: TradeBadgeProps) {
  const tier = getTier(completedTrades)
  if (!tier) return null

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium leading-none ${tier.bg} ${tier.color}`}
    >
      🤝 {completedTrades} · {tier.label}
    </span>
  )
}
