import RankingShareButton from './RankingShareButton'

interface RankingData {
  owned_count: number
  national_rank: number
  national_total: number
  city: string | null
  city_rank: number | null
  city_total: number | null
  state: string | null
  state_rank: number | null
  state_total: number | null
  friends_rank?: number | null
  friends_total?: number | null
}

interface RankingCardProps {
  ranking: RankingData | null
}

export default function RankingCard({ ranking }: RankingCardProps) {
  if (!ranking) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-gray-400">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-5 w-5"
          >
            <path
              fillRule="evenodd"
              d="M9.69 18.933l.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 00.281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 103 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 002.274 1.765 11.842 11.842 0 00.976.544l.062.029.018.008.006.003zM10 11.25a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-sm">Ative sua localização para ver seu ranking</span>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <h3 className="mb-3 flex items-center gap-2 text-base font-bold text-navy">
        <span className="text-lg">{'\u{1F3C6}'}</span>
        Ranking
      </h3>

      <div className="space-y-2">
        {/* National */}
        <div className="flex items-center gap-2 text-sm">
          <span>{'\u{1F1E7}\u{1F1F7}'}</span>
          <span>
            <span className="font-bold text-navy">#{ranking.national_rank}</span>
            <span className="text-gray-500"> de {ranking.national_total.toLocaleString('pt-BR')} colecionadores</span>
          </span>
        </div>

        {/* Neighborhood (2.5km — uses city_rank data from the bounding box query) */}
        {ranking.city && ranking.city_rank != null && ranking.city_total != null && (
          <div className="flex items-center gap-2 text-sm">
            <span>{'\u{1F4CD}'}</span>
            <span>
              <span className="font-bold text-navy">#{ranking.city_rank}</span>
              <span className="text-gray-500"> no seu bairro</span>
              <span className="text-gray-400"> ({ranking.city_total.toLocaleString('pt-BR')})</span>
            </span>
          </div>
        )}

        {/* Friends */}
        {ranking.friends_rank != null && ranking.friends_total != null && ranking.friends_total > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <span>{'\u{1F465}'}</span>
            <span>
              <span className="font-bold text-navy">#{ranking.friends_rank}</span>
              <span className="text-gray-500"> entre amigos</span>
              <span className="text-gray-400"> ({ranking.friends_total.toLocaleString('pt-BR')})</span>
            </span>
          </div>
        )}
      </div>

      <RankingShareButton
        nationalRank={ranking.national_rank}
        ownedCount={ranking.owned_count}
      />
    </div>
  )
}
