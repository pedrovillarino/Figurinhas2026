type UserRatingProps = {
  avgRating: number | null
  reviewCount: number
}

function Star({ filled }: { filled: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 ${filled ? 'text-yellow-400' : 'text-gray-200'}`}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
    </svg>
  )
}

export default function UserRating({ avgRating, reviewCount }: UserRatingProps) {
  if (reviewCount === 0 || avgRating === null) {
    return <span className="text-xs text-gray-400">Sem avaliações</span>
  }

  const rounded = Math.round(avgRating * 10) / 10

  return (
    <div className="inline-flex items-center gap-1">
      <div className="flex" aria-label={`${rounded} de 5 estrelas`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} filled={i <= Math.round(avgRating)} />
        ))}
      </div>
      <span className="text-xs font-medium text-gray-700">
        {rounded} ({reviewCount})
      </span>
    </div>
  )
}
