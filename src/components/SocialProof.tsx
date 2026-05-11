/**
 * Seção de social proof na landing page (Pedro 2026-05-11).
 *
 * Lê números agregados via `getLandingStats()` (server-side) que carrega
 * snapshot diário de `public_stats`. Esconde cards que não atingiram floor.
 * Se TUDO veio null (erro ou app muito novo), esconde a seção inteira.
 *
 * Auditoria: link pra /numeros mostra metodologia + queries.
 */
import { getLandingStats, formatBigNumber, formatShortDate } from '@/lib/landing-stats'

export default async function SocialProof() {
  const stats = await getLandingStats()

  // Decide quais cards exibir
  const cards: { value: string; label: string; sub?: string }[] = []

  if (stats.registeredTotal) {
    cards.push({
      value: formatBigNumber(stats.registeredTotal),
      label: 'figurinhas registradas no app',
      sub: stats.aiScanned ? `🤖 ${formatBigNumber(stats.aiScanned)} com IA` : undefined,
    })
  }

  if (stats.stickersTraded) {
    cards.push({
      value: formatBigNumber(stats.stickersTraded),
      label: 'figurinhas trocadas entre colecionadores',
    })
  }

  // Distância + cidades em UM card combinado (uma frase só vende melhor que dois números frios).
  if (stats.distanceMedianKm && stats.cities) {
    cards.push({
      value: `${stats.distanceMedianKm} km`,
      label: 'distância média até o trocador mais próximo',
      sub: `em ${stats.cities} cidades`,
    })
  } else if (stats.cities) {
    cards.push({
      value: stats.cities.toLocaleString('pt-BR'),
      label: 'cidades com colecionadores ativos',
    })
  } else if (stats.distanceMedianKm) {
    cards.push({
      value: `${stats.distanceMedianKm} km`,
      label: 'distância média até o trocador mais próximo',
    })
  }

  // Floor: precisa de pelo menos 2 cards pra valer a pena.
  if (cards.length < 2) return null

  return (
    <section className="px-6 py-10 bg-gradient-to-b from-white via-brand-light/30 to-white">
      <div className="max-w-md mx-auto">
        <div className="flex items-baseline justify-between mb-5">
          <h2 className="text-base font-bold text-navy">Já tá rolando</h2>
          {stats.updatedAt && (
            <span className="text-[10px] text-gray-400">
              atualizado em {formatShortDate(stats.updatedAt)}
            </span>
          )}
        </div>

        <div className={`grid gap-3 ${cards.length === 2 ? 'grid-cols-2' : cards.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2'}`}>
          {cards.map((card, i) => (
            <StatCard key={i} value={card.value} label={card.label} sub={card.sub} />
          ))}
        </div>

        {stats.prizes > 0 && (
          <div className="mt-4 rounded-xl bg-gold/10 border border-gold/30 px-4 py-3 text-center">
            <p className="text-sm font-bold text-navy">
              🏆 {stats.prizes} prêmios já entregues
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Porta-figurinhas, álbuns e premiações de embaixadores
            </p>
          </div>
        )}

        <p className="text-[10px] text-gray-400 text-center mt-3">
          <a href="/numeros" className="underline hover:text-brand transition">
            Como medimos esses números →
          </a>
        </p>
      </div>
    </section>
  )
}

function StatCard({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4 flex flex-col">
      <p className="text-2xl font-black text-navy leading-none">{value}</p>
      <p className="text-[11px] text-gray-600 leading-snug mt-1.5">{label}</p>
      {sub && <p className="text-[10px] text-brand-dark font-semibold mt-1.5">{sub}</p>}
    </div>
  )
}
