/**
 * Scan Feedback admin — surfaces 👍/👎 ratings + comments collected after
 * each scan. Helps Pedro understand whether scan accuracy feels right.
 *
 * Pure server component. Negative comments float to the top because that's
 * where the actionable info lives.
 */
import { createClient as createAdminClient } from '@supabase/supabase-js'

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

type FeedbackRow = {
  id: number
  user_id: string | null
  rating: 'positive' | 'negative'
  comment: string | null
  scan_count_at_feedback: number | null
  created_at: string
}

export default async function ScanFeedbackAdminSection() {
  const admin = getAdmin()

  // Last 30 days of feedback
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
  const { data } = await admin
    .from('scan_feedback')
    .select('id, user_id, rating, comment, scan_count_at_feedback, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })

  const rows = (data || []) as FeedbackRow[]
  const totalCount = rows.length
  const positiveCount = rows.filter((r) => r.rating === 'positive').length
  const negativeCount = rows.filter((r) => r.rating === 'negative').length
  const positivePct = totalCount > 0 ? (positiveCount / totalCount) * 100 : 0

  // All comments (any rating), most recent first — but with negatives bumped up
  const withComments = rows.filter((r) => r.comment && r.comment.trim().length > 0)
  const negativeComments = withComments.filter((r) => r.rating === 'negative')
  const positiveComments = withComments.filter((r) => r.rating === 'positive')
  const orderedComments = [...negativeComments, ...positiveComments].slice(0, 20)

  return (
    <div>
      <h2 className="text-lg font-semibold mt-8 mb-4" style={{ color: '#0A1628' }}>
        💬 Feedback do Scan (últimos 30 dias)
      </h2>

      {/* Headline */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <AdminStat
          label="Total de feedback"
          value={totalCount}
        />
        <AdminStat
          label="👍 Positivos"
          value={positiveCount}
          sub={`${positivePct.toFixed(1)}%`}
        />
        <AdminStat
          label="👎 Negativos"
          value={negativeCount}
          sub={totalCount > 0 ? `${((negativeCount / totalCount) * 100).toFixed(1)}%` : '0%'}
        />
        <AdminStat
          label="Com comentário"
          value={withComments.length}
          sub={totalCount > 0 ? `${((withComments.length / totalCount) * 100).toFixed(0)}% engajamento` : '—'}
        />
      </div>

      {/* Comments — negative-first */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <p className="text-sm font-semibold text-gray-700">Comentários recentes</p>
          <p className="text-[10px] text-gray-500">Negativos primeiro — onde está a melhoria</p>
        </div>
        {orderedComments.length === 0 ? (
          <p className="text-sm text-gray-500 px-4 py-8 text-center">
            Sem comentários ainda. Aparecem aqui quando alguém escanear e responder.
          </p>
        ) : (
          <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
            {orderedComments.map((c) => (
              <div key={c.id} className="px-4 py-3 flex items-start gap-3">
                <span className="text-base shrink-0 mt-0.5">
                  {c.rating === 'negative' ? '👎' : '👍'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm leading-relaxed ${
                    c.rating === 'negative' ? 'text-gray-800' : 'text-gray-600'
                  }`}>
                    {c.comment}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-1">
                    {new Date(c.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                    {c.scan_count_at_feedback != null && ` · ${c.scan_count_at_feedback} scans`}
                    {c.user_id && ` · ${c.user_id.slice(0, 8)}…`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AdminStat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <p className="text-2xl font-black text-gray-800">{value}</p>
      <p className="text-[10px] text-gray-500 leading-tight mt-1">{label}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}
