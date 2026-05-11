/**
 * /numeros — auditoria pública dos números mostrados na home.
 *
 * Por que existe: dá credibilidade aos números da landing. Cada métrica
 * exposta vem com a query SQL que a calcula + última atualização. Diferencia
 * a gente de concorrente que infla. Custo de manutenção: zero (texto estático).
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { getLandingStats, formatBigNumber, formatShortDate, PRIZES_AWARDED } from '@/lib/landing-stats'

export const metadata: Metadata = {
  title: 'Como medimos os números — Complete Aí',
  description: 'Auditoria pública dos números mostrados na home. Cada métrica vem com a query SQL e a última atualização.',
}

export const dynamic = 'force-dynamic'

export default async function NumerosPage() {
  const stats = await getLandingStats()

  return (
    <div className="min-h-screen bg-white text-navy">
      <main className="max-w-2xl mx-auto px-6 py-10">
        <Link href="/" className="text-xs text-brand hover:underline">← Voltar pra home</Link>

        <h1 className="text-2xl font-black mt-3 mb-2">Como medimos os números</h1>
        <p className="text-sm text-gray-600 mb-6">
          Cada métrica abaixo é calculada por uma query SQL no nosso banco e
          atualizada 1×/dia (às 2h da manhã). Nada é estimado, nada é
          inventado. Se um valor estiver abaixo de um piso mínimo razoável, a
          gente esconde na home em vez de inflar.
        </p>

        <div className="space-y-5">
          <Metric
            label="Figurinhas registradas no app"
            value={stats.registeredTotal != null ? formatBigNumber(stats.registeredTotal) : '— (abaixo do piso)'}
            sql={`SELECT SUM(quantity)
FROM user_stickers us
LEFT JOIN profiles p ON p.id = us.user_id
WHERE us.quantity > 0
  AND COALESCE(p.excluded_from_campaign, false) = false`}
            note="Inclui figurinhas registradas via scan IA, áudio, texto e edição manual. Exclui contas de teste."
            floor="≥ 5.000"
          />

          <Metric
            label="Figurinhas escaneadas com IA"
            value={stats.aiScanned != null ? formatBigNumber(stats.aiScanned) : '— (abaixo do piso)'}
            sql={`SELECT SUM(matched_count)
FROM scan_results sr
LEFT JOIN profiles p ON p.id = sr.user_id
WHERE sr.user_confirmed_count > 0
  AND COALESCE(p.excluded_from_campaign, false) = false`}
            note="Só contam scans em que o usuário confirmou e salvou. IA detectou + humano validou."
            floor="≥ 1.000"
          />

          <Metric
            label="Figurinhas trocadas entre colecionadores"
            value={stats.stickersTraded != null ? formatBigNumber(stats.stickersTraded) : '— (abaixo do piso)'}
            sql={`SELECT SUM(they_have + i_have)
FROM trade_requests
WHERE status = 'approved'`}
            note="Cada troca aprovada move N figurinhas dos dois lados. Soma o total de figurinhas que mudaram de mãos."
            floor="≥ 200"
          />

          <Metric
            label="Distância mediana até o trocador mais próximo"
            value={stats.distanceMedianKm != null ? `${stats.distanceMedianKm} km` : '— (acima do piso máximo)'}
            sql={`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY distance_km)
FROM trade_requests
WHERE status = 'approved' AND distance_km IS NOT NULL`}
            note="Mediana (não média) pra evitar viés de outliers. Calculada a partir das coordenadas geográficas dos dois usuários no momento da troca."
            floor="≤ 30 km"
          />

          <Metric
            label="Cidades com colecionadores ativos"
            value={stats.cities != null ? stats.cities.toLocaleString('pt-BR') : '— (abaixo do piso)'}
            sql={`SELECT COUNT(DISTINCT lower(trim(city)) || '|' || COALESCE(lower(trim(state)),''))
FROM profiles
WHERE city IS NOT NULL
  AND length(trim(city)) > 1
  AND COALESCE(excluded_from_campaign, false) = false`}
            note="Conta pares cidade+estado distintos (sem dobrar Boa Vista RR vs Boa Vista PB). Casing normalizado."
            floor="≥ 30"
          />

          {PRIZES_AWARDED.length > 0 && (
            <Metric
              label="Prêmios já entregues"
              value={`${stats.prizes}`}
              sql={`// Constante TS em src/lib/landing-stats.ts → PRIZES_AWARDED[]`}
              note="Lista hardcoded enquanto for pequena. Inclui porta-figurinhas e álbuns de campanhas Instagram + premiações de embaixadores."
              floor="—"
            />
          )}
        </div>

        {PRIZES_AWARDED.length > 0 && (
          <>
            <h2 className="text-lg font-bold mt-10 mb-3">Histórico de prêmios</h2>
            <ul className="space-y-2 text-sm">
              {PRIZES_AWARDED.map((p, i) => (
                <li key={i} className="flex gap-3 items-baseline border-l-2 border-gold/40 pl-3">
                  <span className="text-xs text-gray-400 font-mono">{p.date}</span>
                  <span>
                    <strong className="font-semibold">{p.type}</strong>
                    {' · '}
                    <span className="text-gray-600">{p.campaign}</span>
                    {p.note && <span className="text-gray-500"> — {p.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {stats.updatedAt && (
          <p className="text-xs text-gray-400 mt-10 border-t border-gray-100 pt-4">
            Última atualização do snapshot: {formatShortDate(stats.updatedAt)}
            {' · '}
            Cron: <code className="font-mono">0 5 * * *</code> UTC (2h BRT)
            {' · '}
            <Link href="/" className="text-brand hover:underline">Voltar pra home</Link>
          </p>
        )}
      </main>
    </div>
  )
}

function Metric({
  label,
  value,
  sql,
  note,
  floor,
}: {
  label: string
  value: string
  sql: string
  note: string
  floor: string
}) {
  return (
    <div className="rounded-2xl border border-gray-100 p-4 bg-gray-50/50">
      <div className="flex items-baseline justify-between mb-2 gap-3">
        <p className="text-sm font-semibold text-navy">{label}</p>
        <p className="text-lg font-black text-brand whitespace-nowrap">{value}</p>
      </div>
      <p className="text-xs text-gray-600 mb-2 leading-relaxed">{note}</p>
      <pre className="text-[10px] bg-white border border-gray-100 rounded-lg p-2 overflow-x-auto font-mono text-gray-700 leading-snug">
        {sql}
      </pre>
      <p className="text-[10px] text-gray-400 mt-1.5">Piso pra exibir na home: {floor}</p>
    </div>
  )
}
